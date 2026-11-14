import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import { maskClientId, resolveConnectInput } from "./credentials";
import { connectDb, loadCredentials, saveCredentials, User } from "./db";
import { signToken, authRequired, AuthedRequest, hashPassword, verifyPassword, findUserByUsername } from "./auth";
import { accountAuthRouter } from "./accountRoutes";
import { updateOwnEmail } from "./accountEmail";
import { emailConfigured } from "./email/transport";
import { sendVerification } from "./email/accountMail";
import { userSockets } from "./ctrader/connection";
import { ctraderAppCredentials } from "./ctrader/appConfig";
import { discoverAccounts } from "./ctrader/auth";
import { ctraderOAuthAvailable, ctraderOAuthCallback, ctraderOAuthRouter } from "./ctrader/oauth";
import { reconcileAccount, listAccounts, listTradableNames, symbolQuote } from "./ctrader/reads";
import { amendPositionSLTP, cancelOrder, closePosition, modifyOrder, placeOrder, previewOrder, TicketInput } from "./ctrader/execute";
import { marketRouter } from "./market/routes";
import { signalsRouter } from "./signals/routes";
import { startSignalResolver } from "./signals/resolver";
import { promoteConfiguredAdmins } from "./admin/roles";
import { adminRouter } from "./admin/routes";
import { siteConfigRouter } from "./settings/routes";
import { getSiteSettings } from "./settings/store";
import { legalAcceptanceRequired, legalAcceptanceSatisfied } from "./legal";
import { registrationDecision } from "./registrationPolicy";
import { maintenanceGate, marketGate, moduleGate } from "./settings/access";
import { startBreakoutScheduler } from "./market/breakoutRunner";
import { startScraperScheduler } from "./market/scraperRunner";
import { createTrainerRouter } from "./trainer/routes";
import { telegramRouter } from "./telegram/routes";
import { startTelegram, stopTelegram } from "./telegram/index";

const app = express();
// The app binds to loopback behind nginx, so trust exactly one proxy hop for
// the real client IP (auth rate limits) and the forwarded protocol.
app.set("trust proxy", 1);
// Admin settings may carry an inline logo upload, so the JSON limit is larger
// than the default; ordinary request bodies are still tiny.
app.use(express.json({ limit: "1mb" }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trading data is unavailable during maintenance. Auth, /api/me, /api/config,
// /api/admin and the OAuth callback stay reachable so an admin can sign in and
// turn maintenance off again.
app.use(["/api/accounts", "/api/connect", "/api/credentials"], maintenanceGate);

app.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const settings = await getSiteSettings();
    const registration = settings.registration;
    const legalRequired = legalAcceptanceRequired(settings.legal);
    const decision = registrationDecision(registration, req.body?.inviteCode);
    if (!decision.allowed) {
      res.status(403).json({ error: decision.error });
      return;
    }

    const { username, email, password } = req.body ?? {};
    const clean = String(username ?? "").trim();
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(clean)) {
      res.status(400).json({ error: "username must be 3-32 characters (letters, digits, _, -)" });
      return;
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      res.status(400).json({ error: "email must be a valid address" });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (!legalAcceptanceSatisfied(settings.legal, req.body?.acceptedTerms)) {
      res.status(400).json({
        error: "Accept the Terms and Privacy Policy to create an account.",
      });
      return;
    }
    if (registration.requireEmailVerification && !(await emailConfigured())) {
      res.status(503).json({
        error: "Email verification is required but email delivery is not configured.",
      });
      return;
    }
    const existing = await User.findOne({
      $or: [{ username: clean }, { email: cleanEmail }],
    }).exec();
    if (existing) {
      res.status(409).json({ error: existing.username === clean ? "username taken" : "email already registered" });
      return;
    }
    const user = await User.create({
      username: clean,
      email: cleanEmail,
      passwordHash: await hashPassword(password),
      status: decision.status,
      emailVerified: !registration.requireEmailVerification,
      termsAcceptedAt: legalRequired ? new Date() : null,
    });
    if (registration.requireEmailVerification) {
      try {
        await sendVerification(String(user._id), req);
      } catch (err: any) {
        await User.deleteOne({ _id: user._id }).exec();
        res.status(502).json({
          error: err?.message ?? "Account could not be created because the verification email failed.",
        });
        return;
      }
    }
    if (decision.status === "pending") {
      res.json({
        pending: true,
        verificationSent: registration.requireEmailVerification,
        message:
          registration.message ||
          "Account created. An admin must approve it before you can sign in.",
      });
      return;
    }
    if (registration.requireEmailVerification) {
      res.json({
        verificationRequired: true,
        email: cleanEmail,
        message: "Check your inbox to verify your email before signing in.",
      });
      return;
    }
    res.json({ token: signToken(String(user._id), 0) });
  } catch (err: any) {
    // Two registrations can race past the lookup above; the unique indexes are
    // the real guard, so translate their duplicate-key error too.
    if (err?.code === 11000) {
      res.status(409).json({ error: err.keyPattern?.email ? "email already registered" : "username taken" });
      return;
    }
    res.status(500).json({ error: err.message ?? "register failed" });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body ?? {};
    const clean = String(username ?? "").trim();
    if (!clean || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const user = await findUserByUsername(clean);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "invalid username or password" });
      return;
    }
    if (user.status === "pending") {
      res.status(403).json({ error: "account is pending admin approval" });
      return;
    }
    const settings = await getSiteSettings();
    if (settings.registration.requireEmailVerification && user.emailVerified === false) {
      res.status(403).json({
        error: "verify your email before signing in",
        verificationRequired: true,
        email: user.email ?? null,
      });
      return;
    }
    res.json({
      token: signToken(
        String(user._id),
        typeof user.tokenVersion === "number" ? user.tokenVersion : 0
      ),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "login failed" });
  }
});

app.get("/api/me", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId!).lean().exec();
    if (!user) {
      res.status(401).json({ error: "user no longer exists" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    // /api/me stays reachable during maintenance so an allowed admin can be
    // recognised, but live balances must not leak around the /api/accounts
    // gate. Ordinary users get an empty list until maintenance ends.
    const settings = await getSiteSettings();
    const blocked =
      settings.maintenance.enabled &&
      !(settings.maintenance.allowAdmins && user.role === "admin");
    // listAccounts enriches each account with live balance + broker name (both
    // need a per-account broker round-trip), so /api/me returns the same shape
    // as /api/accounts rather than the raw stored rows.
    const accounts = creds && !blocked ? await listAccounts(req.userId!) : [];
    res.json({
      username: user.username,
      email: user.email ?? null,
      emailVerified: user.emailVerified !== false,
      role: (user.role as string | undefined) ?? "user",
      hasCredentials: !!creds,
      // Enough for Settings to say which OpenAPI app is connected without ever
      // sending the secret, or even the whole client id, to the browser.
      clientIdMasked: creds?.clientId ? maskClientId(creds.clientId) : null,
      ctraderOAuth: await ctraderOAuthAvailable(),
      accounts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "failed" });
  }
});

app.patch("/api/me/email", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const result = await updateOwnEmail(
      req.userId!,
      req.body?.email,
      req.body?.password,
      req
    );
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err: any) {
    console.error("[account] failed to change email:", err?.message ?? err);
    res.status(500).json({ error: "failed to change email" });
  }
});

app.put("/api/credentials", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const { clientId, clientSecret, accessToken, refreshToken } = req.body ?? {};
    if (!clientId || !clientSecret || !accessToken) {
      res.status(400).json({ error: "clientId, clientSecret, and accessToken are required" });
      return;
    }
    const existing = await loadCredentials(req.userId!);
    await saveCredentials(req.userId!, {
      clientId: String(clientId),
      clientSecret: String(clientSecret),
      accessToken: String(accessToken),
      refreshToken: String(refreshToken ?? ""),
      accounts: existing?.accounts ?? [],
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "failed" });
  }
});

app.post("/api/connect", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const existing = await loadCredentials(req.userId!);
    let platform: { clientId: string; clientSecret: string } | null = null;
    try {
      platform = await ctraderAppCredentials();
    } catch (err: any) {
      // A corrupt platform secret must not block a manual connection; the
      // fallback below simply will not be available.
      console.error("[cTrader] platform app could not be read:", err?.message ?? err);
    }
    const resolved = resolveConnectInput(req.body, existing, platform);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    const { clientId, clientSecret, accessToken, refreshToken, storeApp } = resolved.value;

    const { accounts, tokens } = await discoverAccounts({ clientId, clientSecret, accessToken, refreshToken });
    await saveCredentials(req.userId!, {
      clientId: storeApp ? clientId : undefined,
      clientSecret: storeApp ? clientSecret : undefined,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accounts,
    });
    const sockets = userSockets(req.userId!);
    if (accounts.some((a) => !a.isLive)) sockets.warm("demo").catch(() => {});
    if (accounts.some((a) => a.isLive)) sockets.warm("live").catch(() => {});
    res.json({ accounts });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "connect failed" });
  }
});

app.get("/api/accounts", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const accounts = await listAccounts(req.userId!);
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "failed" });
  }
});

const ACCOUNT_COLOR_KEYS = ["blue", "green", "red", "amber", "violet", "teal"];
const nicknameOrColor = /\/nickname|\/prefs/;

// Legacy endpoint kept for backward compatibility; canonical is /prefs now.
app.put([ "/api/accounts/:ctid/nickname", "/api/accounts/:ctid/prefs" ], authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const nickname = String(req.body?.nickname ?? "").trim();
    if (nickname.length > 40) {
      res.status(400).json({ error: "nickname must be 40 characters or fewer" });
      return;
    }
    const color = req.body?.color == null || req.body?.color === "" ? null : String(req.body.color);
    if (color != null && !ACCOUNT_COLOR_KEYS.includes(color)) {
      res.status(400).json({ error: "invalid colour" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    if (!creds || !creds.accounts.some((a) => a.ctid === ctid)) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const accounts = creds.accounts.map((a) =>
      a.ctid === ctid
        ? { ...a, nickname: nickname || a.nickname, color: req.body?.hasOwnProperty("color") ? (color || null) : a.color }
        : a,
    );
    await saveCredentials(req.userId!, {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      accounts,
    });
    res.json({ ok: true, nickname: nickname || null, color });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "failed" });
  }
});

app.get("/api/accounts/:ctid/positions", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const result = await reconcileAccount(req.userId!, ctid, account.isLive);
    res.json({ positions: result.positions });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.get("/api/accounts/:ctid/symbols", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const symbols = await listTradableNames(req.userId!, account.isLive ? "live" : "demo", ctid);
    res.json({ symbols: [...symbols].sort((a, b) => a.localeCompare(b)) });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

// Latest live bid/ask for one symbol, used by the order ticket to show the
// current price while the admin fills in levels. Returns quote:null rather
// than an error when the stream has not ticked yet.
app.get("/api/accounts/:ctid/quote", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const symbol = String(req.query.symbol ?? "").trim();
    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    const quote = await symbolQuote(req.userId!, ctid, account.isLive, symbol);
    res.json({ quote });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.get("/api/accounts/:ctid/orders", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const result = await reconcileAccount(req.userId!, ctid, account.isLive);
    res.json({ orders: result.orders });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

// -----------------------------------------------------------------------
// Order management (manual create / modify / close). All routes confirm the
// ctid belongs to the signed-in user before reaching the broker.
// -----------------------------------------------------------------------

app.post("/api/accounts/:ctid/preview", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const body = (req.body ?? {}) as TicketInput;
    const result = await previewOrder(req.userId!, ctid, account.isLive, body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ preview: result.preview });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.post("/api/accounts/:ctid/orders", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    if (!Number.isFinite(ctid) || ctid <= 0) {
      res.status(400).json({ error: "invalid account id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const result = await placeOrder(req.userId!, ctid, account.isLive, (req.body ?? {}) as TicketInput);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, note: result.note });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.patch("/api/accounts/:ctid/orders/:orderId", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(ctid) || ctid <= 0 || !Number.isFinite(orderId) || orderId <= 0) {
      res.status(400).json({ error: "invalid account or order id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const body = (req.body ?? {}) as { price?: number | null; sl?: number | null; tp?: number | null };
    const result = await modifyOrder(req.userId!, ctid, account.isLive, orderId, body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, note: result.note });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.post("/api/accounts/:ctid/orders/:orderId/cancel", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(ctid) || ctid <= 0 || !Number.isFinite(orderId) || orderId <= 0) {
      res.status(400).json({ error: "invalid account or order id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const result = await cancelOrder(req.userId!, ctid, account.isLive, orderId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, note: result.note });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.post("/api/accounts/:ctid/positions/:positionId/close", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    const positionId = Number(req.params.positionId);
    if (!Number.isFinite(ctid) || ctid <= 0 || !Number.isFinite(positionId) || positionId <= 0) {
      res.status(400).json({ error: "invalid account or position id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const result = await closePosition(req.userId!, ctid, account.isLive, positionId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, note: result.note });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

app.patch("/api/accounts/:ctid/positions/:positionId", authRequired, async (req: AuthedRequest, res: Response) => {
  try {
    const ctid = Number(req.params.ctid);
    const positionId = Number(req.params.positionId);
    if (!Number.isFinite(ctid) || ctid <= 0 || !Number.isFinite(positionId) || positionId <= 0) {
      res.status(400).json({ error: "invalid account or position id" });
      return;
    }
    const creds = await loadCredentials(req.userId!);
    const account = creds?.accounts.find((a) => a.ctid === ctid);
    if (!account) {
      res.status(404).json({ error: "account not found" });
      return;
    }
    const { sl, tp } = (req.body ?? {}) as { sl?: number | null; tp?: number | null };
    const result = await amendPositionSLTP(
      req.userId!,
      ctid,
      account.isLive,
      positionId,
      sl != null && Number(sl) > 0 ? Number(sl) : null,
      tp != null && Number(tp) > 0 ? Number(tp) : null
    );
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, note: result.note });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "failed" });
  }
});

// -----------------------------------------------------------------------
// Analysis (market technical analysis). Deliberately PUBLIC - no authRequired.
// The watchlist and settings are a single shared document and the data is
// public market quotes, so the Analysis page is usable without an account.
// Everything under /api/accounts and /api/credentials stays behind auth.
// -----------------------------------------------------------------------
app.use("/api/market", maintenanceGate, marketGate, marketRouter);
app.use("/api/signals", maintenanceGate, moduleGate("signals"), signalsRouter);
app.use("/api/trainer", maintenanceGate, moduleGate("learn"), createTrainerRouter());
app.use("/api/telegram", telegramRouter);
app.use("/api/auth", accountAuthRouter);
app.use("/api/admin", adminRouter);
app.use("/api/config", siteConfigRouter);
app.use("/api/ctrader/oauth", ctraderOAuthRouter);

// Short callback route registered on the cTrader app. The full URL is derived
// from the canonical site address (saved setting, PUBLIC_BASE_URL, or the
// request origin), so it is no longer a separate field. Handled outside /api
// so the registered URL can stay short.
app.get("/callback", (req: Request, res: Response) => {
  void ctraderOAuthCallback(req, res);
});

// -----------------------------------------------------------------------
// Static serving for the React SPA (production build)
// -----------------------------------------------------------------------
const webappDist = path.resolve(__dirname, "..", "..", "webapp", "dist");
if (fs.existsSync(webappDist)) {
  app.use(express.static(webappDist));
}

// SPA fallback: any non-API GET that didn't match a static file returns index.html
app.get("*", (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const indexPath = path.join(webappDist, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: "webapp not built" });
  }
});

// -----------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------
async function main() {
  await connectDb();
  await promoteConfiguredAdmins();
  const port = parseInt(process.env.PORT || "9111");
  app.listen(port, "127.0.0.1", () => {
    console.log(`[SERVER] Listening on http://127.0.0.1:${port}`);
  });
  startBreakoutScheduler();
  startScraperScheduler();
  startSignalResolver();

  // Telegram is optional; a missing token or a bad one must never stop the
  // web app. The feature logs its own startup failures.
  void startTelegram();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopTelegram();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[SERVER] Fatal:", err);
  const message = err instanceof Error ? err.message : String(err);
  if (
    /MongooseServerSelectionError|ECONNREFUSED|Server selection timed out|ENOTFOUND|Authentication failed/i.test(
      message
    )
  ) {
    console.error(
      "[SERVER] MongoDB is not reachable. Run `pnpm doochy:setup` to configure it, or `pnpm doochy:check` to diagnose."
    );
  }
  process.exit(1);
});
