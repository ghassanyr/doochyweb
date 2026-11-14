// cTrader "Connect" OAuth flow.
//
// The manual credential form works, but it makes every user register their own
// Open API app and paste four secrets. This module lets Doochy own one
// approved app and send the user through cTrader's consent screen instead.
//
// Flow:
//   POST /api/ctrader/oauth/start  (signed-in user) -> consent URL + state
//   GET  /callback                 (cTrader redirect) -> exchange code, save
//   GET  /api/ctrader/oauth/callback is the same handler, for the localhost
//   redirect URI used in development.
//
// cTrader authorization codes live for 60 seconds and must be exchanged
// server-side; the client secret never reaches the browser.

import { Router, type Request, type Response } from "express";

import { authRequired, signOAuthState, verifyOAuthState, type AuthedRequest } from "../auth";
import { loadCredentials, saveCredentials, type StoredAccount } from "../db";
import { callbackCandidates, validateCtraderSetup } from "../integrations/ctraderSetup";
import { resolveIntegration } from "../integrations/store";
import { canonicalPublicBaseUrl } from "../settings/siteUrl";
import { discoverAccounts } from "./auth";
import { userSockets } from "./connection";

const AUTHORIZE_URL = "https://openapi.ctrader.com/apps/auth";
const TOKEN_URL = "https://openapi.ctrader.com/apps/token";
const STATE_COOKIE = "ctrader_oauth_state";
const STATE_TTL_MS = 10 * 60_000;
const TOKEN_TIMEOUT_MS = 20_000;

export interface CtraderOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

/** Why a configuration cannot be used, or null when it can. */
export type CtraderOAuthIssue =
  | "app_not_configured"
  | "redirect_missing"
  | "redirect_invalid"
  | "invalid_config";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Judge the OAuth-relevant values without touching the database. The callback
 * is derived from the canonical site URL and must be one of the routes this
 * server mounts; there is no stored callback or compiled-in fallback, because
 * a redirect to someone else's domain cannot complete the flow.
 */
export function ctraderOAuthIssueFrom(
  values: Record<string, unknown>,
  publicBaseUrl: string | null = null
): CtraderOAuthIssue | null {
  const clientId = text(values.clientId);
  const clientSecret = text(values.clientSecret);
  if (!clientId || !clientSecret) return "app_not_configured";

  const baseRaw = text(publicBaseUrl) || text(values.publicBaseUrl);
  const candidates = callbackCandidates(baseRaw);
  if (!candidates.primary) return baseRaw ? "redirect_invalid" : "redirect_missing";

  const scope = text(values.scope) || "trading";
  const issues = validateCtraderSetup({
    publicBaseUrl: candidates.baseUrl,
    redirectUri: candidates.primary,
    scope,
  });
  if (issues.errors.some((error) => /^Scope must be/.test(error))) return "invalid_config";
  if (issues.errors.length > 0) return "redirect_invalid";
  return null;
}

/**
 * Map resolved integration values to an OAuth config. Kept pure so the admin
 * form preview and tests can exercise it without a database.
 */
export function ctraderOAuthConfigFrom(
  values: Record<string, unknown>,
  publicBaseUrl: string | null = null
): CtraderOAuthConfig | null {
  if (ctraderOAuthIssueFrom(values, publicBaseUrl)) return null;
  const baseRaw = text(publicBaseUrl) || text(values.publicBaseUrl);
  const redirectUri = callbackCandidates(baseRaw).primary;
  if (!redirectUri) return null;
  return {
    clientId: text(values.clientId),
    clientSecret: text(values.clientSecret),
    redirectUri,
    scope: text(values.scope) || "trading",
  };
}

/**
 * The platform-owned Open API app, or null when OAuth is not configured.
 * Database values win over the environment, so a buyer can configure the app
 * from the admin panel; .env still bootstraps existing deployments. The
 * callback follows the canonical site URL, with the request origin as the
 * last-resort bootstrap fallback.
 */
export async function ctraderOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): Promise<CtraderOAuthConfig | null> {
  const [resolved, publicBaseUrl] = await Promise.all([
    resolveIntegration("ctrader", env),
    canonicalPublicBaseUrl(env, requestOrigin),
  ]);
  return ctraderOAuthConfigFrom(resolved.values, publicBaseUrl);
}

/** Availability check for the browser; corrupt stored secrets mean "off". */
export async function ctraderOAuthAvailable(
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): Promise<boolean> {
  try {
    return (await ctraderOAuthConfig(env, requestOrigin)) !== null;
  } catch (err: any) {
    console.error("[cTrader OAuth] configuration could not be read:", err?.message ?? err);
    return false;
  }
}

/** Consent URL. State is echoed back by cTrader and binds the callback to a user. */
export function buildAuthorizeUrl(cfg: CtraderOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    response_type: "code",
    state,
    product: "web",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  accessToken?: string;
  refreshToken?: string;
  errorCode?: string | null;
  description?: string | null;
}

/**
 * Exchange the one-minute authorization code for access + refresh tokens.
 * Exported so the callback and the route tests share one implementation.
 */
export async function exchangeAuthorizationCode(
  cfg: CtraderOAuthConfig,
  code: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(`${TOKEN_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });

  let data: TokenResponse | null = null;
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    data = null;
  }

  if (!res.ok) throw new Error(`cTrader token exchange failed (HTTP ${res.status})`);
  if (!data) throw new Error("cTrader token exchange returned an empty response");
  if (data.errorCode) {
    throw new Error(
      `cTrader token exchange rejected: ${data.errorCode}${data.description ? ` (${data.description})` : ""}`
    );
  }
  if (!data.accessToken || !data.refreshToken) {
    throw new Error("cTrader token exchange response missing tokens");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken };
}

function requestOrigin(req: Request): string | null {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host") || "";
  if (!host) return null;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

function isSecure(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return proto === "https";
}

function stateCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecure(req),
    maxAge: STATE_TTL_MS,
    path: "/",
  };
}

function redirectError(res: Response, code: string): void {
  const safe = (code || "oauth_failed").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  res.redirect(`/trading?ctrader_error=${encodeURIComponent(safe)}`);
}

/** Public callback: verify state, exchange the code, persist tokens + accounts. */
export async function ctraderOAuthCallback(req: Request, res: Response): Promise<void> {
  let cfg: CtraderOAuthConfig | null;
  try {
    cfg = await ctraderOAuthConfig(process.env, requestOrigin(req));
  } catch (err: any) {
    console.error("[cTrader OAuth] configuration could not be read:", err?.message ?? err);
    redirectError(res, "not_configured");
    return;
  }
  if (!cfg) {
    redirectError(res, "not_configured");
    return;
  }

  const queryState = typeof req.query.state === "string" ? req.query.state : "";
  const cookieState = readCookie(req, STATE_COOKIE) ?? "";
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (typeof req.query.error === "string") {
    redirectError(res, req.query.error);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    redirectError(res, "missing_code");
    return;
  }

  const state = queryState || cookieState;
  const userId = verifyOAuthState(state);
  if (!userId) {
    redirectError(res, "invalid_state");
    return;
  }
  // If both channels carried a state they must agree. A mismatch means the
  // callback was grafted onto a different browser's flow.
  if (queryState && cookieState && queryState !== cookieState) {
    redirectError(res, "state_mismatch");
    return;
  }

  try {
    const tokens = await exchangeAuthorizationCode(cfg, code);
    const { accounts: discovered, tokens: rotated } = await discoverAccounts({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

    // Keep the user's nicknames/colours across a reconnect.
    const existing = await loadCredentials(userId);
    const prefs = new Map((existing?.accounts ?? []).map((a) => [a.ctid, a]));
    const accounts: StoredAccount[] = discovered.map((a) => ({
      ...a,
      nickname: prefs.get(a.ctid)?.nickname ?? null,
      color: prefs.get(a.ctid)?.color ?? null,
    }));

    await saveCredentials(userId, {
      // The tokens belong to the platform app, so a manual app pair left over
      // from an earlier connection must not keep overriding it.
      clientId: null,
      clientSecret: null,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      accounts,
    });

    // The old sockets still hold the previous grant; force a fresh connection
    // on the next request.
    userSockets(userId).close();
    res.redirect("/trading?ctrader=connected");
  } catch (err: any) {
    console.error(`[cTrader OAuth] callback failed for user ${userId}:`, err?.message ?? err);
    redirectError(res, "exchange_failed");
  }
}

function startErrorMessage(issue: CtraderOAuthIssue): string {
  if (issue === "redirect_missing") {
    return "cTrader OAuth needs the site URL. Set it under Admin → Site settings.";
  }
  if (issue === "redirect_invalid") {
    return "cTrader OAuth callback is not valid for this deployment. Check the site URL and cTrader setup.";
  }
  if (issue === "invalid_config") {
    return "cTrader OAuth settings are invalid. Check the cTrader setup.";
  }
  return "cTrader OAuth is not configured";
}

export const ctraderOAuthRouter = Router();

ctraderOAuthRouter.post("/start", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const [resolved, publicBaseUrl] = await Promise.all([
      resolveIntegration("ctrader"),
      canonicalPublicBaseUrl(process.env, requestOrigin(req)),
    ]);
    const issue = ctraderOAuthIssueFrom(resolved.values, publicBaseUrl);
    if (issue) {
      res.status(503).json({ error: startErrorMessage(issue), code: issue });
      return;
    }
    const cfg = ctraderOAuthConfigFrom(resolved.values, publicBaseUrl)!;
    const state = signOAuthState(req.userId!);
    res.cookie(STATE_COOKIE, state, stateCookieOptions(req));
    res.json({ url: buildAuthorizeUrl(cfg, state) });
  } catch (err: any) {
    console.error("[cTrader OAuth] start failed:", err?.message ?? err);
    res.status(503).json({
      error: "cTrader OAuth is not configured",
      code: "not_configured",
    });
  }
});

ctraderOAuthRouter.get("/callback", (req: Request, res: Response) => {
  void ctraderOAuthCallback(req, res);
});
