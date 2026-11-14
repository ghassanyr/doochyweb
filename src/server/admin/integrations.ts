// Admin integration setup.
//
// Secrets never leave the server: reads return field metadata only, and the
// test endpoint accepts a draft patch but never persists it. Testing is rate
// limited because both providers make an outbound request.

import { Router, type Request, type Response } from "express";

import { adminRequired, type AuthedRequest } from "../auth";
import { User } from "../db";
import { buildAuthorizeUrl, ctraderOAuthConfigFrom } from "../ctrader/oauth";
import { callbackCandidates, providerIssuesFromValues } from "../integrations/ctraderSetup";
import { canonicalPublicBaseUrl } from "../settings/siteUrl";
import { IntegrationCryptoError, encryptionKeyFromEnv } from "../integrations/crypto";
import { INTEGRATION_DEFS, isIntegrationProvider } from "../integrations/registry";
import { validateSmtpSetup } from "../integrations/smtpSetup";
import { asSmtpValues, sendTestEmail } from "../email/transport";
import {
  getIntegrationStates,
  recordIntegrationTest,
  resolveDraftIntegration,
  saveIntegration,
} from "../integrations/store";
import type {
  IntegrationProvider,
  IntegrationTestResult,
  ResolvedIntegration,
} from "../integrations/types";
import { IntegrationValidationError } from "../integrations/validate";

export const integrationAdminRouter = Router();

// In-memory limiter; the app is a single PM2 instance, so this is sufficient.
const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

function fail(res: Response, err: unknown, fallback: string, status = 500): void {
  res.status(status).json({ error: err instanceof Error ? err.message : fallback });
}

function requestOrigin(req: Request): string | null {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host") || "";
  if (!host) return null;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

function hasDraft(patch: unknown): boolean {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const body = patch as Record<string, unknown>;
  const values = body.values;
  const hasValues =
    !!values && typeof values === "object" && !Array.isArray(values) &&
    Object.keys(values as Record<string, unknown>).length > 0;
  const hasClear = Array.isArray(body.clear) && body.clear.length > 0;
  return hasValues || hasClear;
}

async function testCtrader(
  values: ResolvedIntegration,
  publicBaseUrl: string | null
): Promise<IntegrationTestResult> {
  const issues = providerIssuesFromValues("ctrader", values.values, publicBaseUrl);
  if (issues.errors.length > 0) {
    return { ok: false, message: issues.errors[0] };
  }
  if (values.missing.length > 0) {
    return { ok: false, message: `Missing required fields: ${values.missing.join(", ")}` };
  }
  const cfg = ctraderOAuthConfigFrom(values.values, publicBaseUrl);
  if (!cfg) {
    return { ok: false, message: "The cTrader OAuth configuration is incomplete." };
  }

  try {
    const url = buildAuthorizeUrl(cfg, "setup-test");
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 200 && res.status < 400) {
      return {
        ok: true,
        message:
          `cTrader authorize endpoint reachable (HTTP ${res.status}). ` +
          "This checks the configuration shape and reachability, not that the app is approved.",
      };
    }
    return { ok: false, message: `cTrader authorize endpoint returned HTTP ${res.status}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { ok: false, message: `Could not reach cTrader: ${message}` };
  }
}

async function testTelegram(values: ResolvedIntegration): Promise<IntegrationTestResult> {
  if (values.missing.includes("botToken")) {
    return { ok: false, message: "A bot token is required." };
  }
  const token = String(values.values.botToken ?? "");
  if (!token) return { ok: false, message: "A bot token is required." };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { username?: string } }
      | null;
    if (res.ok && data?.ok && data.result?.username) {
      return { ok: true, message: `Connected as @${data.result.username}.` };
    }
    return { ok: false, message: `Telegram rejected the token (HTTP ${res.status}).` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { ok: false, message: `Could not reach Telegram: ${message}` };
  }
}

async function testSmtp(
  values: ResolvedIntegration,
  adminId: string
): Promise<IntegrationTestResult> {
  if (values.missing.length > 0) {
    return { ok: false, message: `Missing required fields: ${values.missing.join(", ")}` };
  }
  const issues = validateSmtpSetup(values.values);
  if (issues.errors.length > 0) {
    return { ok: false, message: issues.errors[0] };
  }
  const admin: any = await User.findById(adminId).lean().exec();
  const to = typeof admin?.email === "string" ? admin.email.trim() : "";
  if (!to) {
    return {
      ok: false,
      message: "Add an email address to your admin account before sending a test.",
    };
  }
  try {
    await sendTestEmail(asSmtpValues(values.values), to);
    return {
      ok: true,
      message: `Test email sent to ${to}. Check the inbox and spam folder.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMTP send failed";
    return { ok: false, message: `Could not send email: ${message}` };
  }
}

function testProvider(
  provider: IntegrationProvider,
  values: ResolvedIntegration,
  publicBaseUrl: string | null
): Promise<IntegrationTestResult> {
  if (provider === "smtp") throw new Error("SMTP tests need the acting admin account");
  return provider === "ctrader"
    ? testCtrader(values, publicBaseUrl)
    : testTelegram(values);
}

/** A network error can quote the request URL; never echo a secret back. */
function redactSecrets(
  provider: IntegrationProvider,
  values: ResolvedIntegration,
  result: IntegrationTestResult
): IntegrationTestResult {
  let message = result.message;
  for (const field of INTEGRATION_DEFS[provider].fields) {
    if (field.kind !== "secret") continue;
    const secret = String(values.values[field.key] ?? "");
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return { ...result, message };
}

integrationAdminRouter.get("/integrations", adminRequired, async (req, res) => {
  try {
    const origin = requestOrigin(req);
    const integrations = await getIntegrationStates(process.env, origin);
    let encryptionAvailable = false;
    try {
      encryptionAvailable = encryptionKeyFromEnv() !== null;
    } catch {
      encryptionAvailable = false;
    }

    const publicBaseUrl = await canonicalPublicBaseUrl(process.env, origin);
    res.json({
      integrations,
      encryptionAvailable,
      requestOrigin: origin,
      callbacks: callbackCandidates(publicBaseUrl),
    });
  } catch (err) {
    fail(res, err, "failed to load integrations");
  }
});

integrationAdminRouter.put(
  "/integrations/:provider",
  adminRequired,
  async (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider;
    if (!isIntegrationProvider(provider)) {
      res.status(404).json({ error: "unknown integration provider" });
      return;
    }
    try {
      const integration = await saveIntegration(
        provider,
        req.body,
        req.username ?? req.userId ?? "admin"
      );
      res.json({ integration });
    } catch (err) {
      if (err instanceof IntegrationValidationError) {
        fail(res, err, "invalid integration settings", 400);
        return;
      }
      if (err instanceof IntegrationCryptoError) {
        fail(res, err, "encryption key is not configured", 400);
        return;
      }
      fail(res, err, "failed to save integration");
    }
  }
);

integrationAdminRouter.post(
  "/integrations/:provider/test",
  adminRequired,
  async (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider;
    if (!isIntegrationProvider(provider)) {
      res.status(404).json({ error: "unknown integration provider" });
      return;
    }
    if (!allow(`integration-test:${req.userId}`, 10, 5 * 60_000)) {
      res.status(429).json({ error: "Too many tests. Try again in a few minutes." });
      return;
    }

    try {
      const values = await resolveDraftIntegration(provider, req.body ?? {});
      const publicBaseUrl = await canonicalPublicBaseUrl(
        process.env,
        requestOrigin(req)
      );
      const result = redactSecrets(
        provider,
        values,
        provider === "smtp"
          ? await testSmtp(values, req.userId!)
          : await testProvider(provider, values, publicBaseUrl)
      );
      const integration = await recordIntegrationTest(provider, result, hasDraft(req.body));
      res.json({ result, integration });
    } catch (err) {
      if (err instanceof IntegrationValidationError) {
        fail(res, err, "invalid integration settings", 400);
        return;
      }
      if (err instanceof IntegrationCryptoError) {
        fail(res, err, "encryption key is not configured", 400);
        return;
      }
      fail(res, err, "failed to test integration");
    }
  }
);
