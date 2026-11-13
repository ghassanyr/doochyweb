// Admin-only user management. Mounted at /api/admin by index.ts.
//
// The watchlist stays under /api/market; this router is for account-level
// administration. Every route reads the role from the database, so a demoted
// admin loses access immediately.

import { Router } from "express";

import { adminRequired, type AuthedRequest } from "../auth";
import { encryptionKeyFromEnv } from "../integrations/crypto";
import { getIntegrationStates } from "../integrations/store";
import { getSiteSettings, saveSiteSettings } from "../settings/store";
import { canonicalPublicBaseUrl } from "../settings/siteUrl";
import { SettingsValidationError } from "../settings/validate";
import { integrationAdminRouter } from "./integrations";
import { sendAdminInvite } from "../email/accountMail";
import { emailConfigured } from "../email/transport";
import {
  createUser,
  deleteUser,
  inviteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from "./users";

export const adminRouter = Router();

adminRouter.use(integrationAdminRouter);

adminRouter.get("/status", adminRequired, async (_req, res) => {
  try {
    const [settings, integrations, publicBaseUrl, users] = await Promise.all([
      getSiteSettings(),
      getIntegrationStates(),
      canonicalPublicBaseUrl(),
      listUsers(),
    ]);
    const ctrader = integrations.find((entry) => entry.provider === "ctrader");
    const telegram = integrations.find((entry) => entry.provider === "telegram");
    const smtp = integrations.find((entry) => entry.provider === "smtp");
    let encryptionReady = false;
    try {
      encryptionReady = encryptionKeyFromEnv() !== null;
    } catch {
      encryptionReady = false;
    }
    const legalReady = Boolean(
      settings.legal.termsUrl || settings.legal.privacyUrl || settings.legal.riskDisclaimer
    );
    const checks = [
      {
        key: "siteUrl",
        label: "Canonical site URL",
        status: publicBaseUrl ? "ok" : "todo",
        detail: publicBaseUrl ?? "Set it in Site settings so callbacks and bot links use your domain.",
      },
      {
        key: "database",
        label: "Database",
        status: "ok",
        detail: "Connected; the admin API is reading site settings.",
      },
      {
        key: "encryption",
        label: "Integration encryption",
        status: encryptionReady ? "ok" : "todo",
        detail: encryptionReady
          ? "INTEGRATIONS_ENCRYPTION_KEY is available."
          : "Generate INTEGRATIONS_ENCRYPTION_KEY before saving integration secrets.",
      },
      {
        key: "ctrader",
        label: "cTrader",
        status: ctrader?.ready ? "ok" : "todo",
        detail: ctrader?.ready
          ? "Platform app and callback are configured."
          : ctrader?.errors[0] ?? "Add the platform Open API app and callback URL.",
      },
      {
        key: "telegram",
        label: "Telegram",
        status: telegram?.ready ? "ok" : "optional",
        detail: telegram?.ready
          ? "Bot token is configured."
          : "Optional: add a bot token to enable signal notifications.",
      },
      {
        key: "email",
        label: "Email delivery",
        status: smtp?.ready ? "ok" : settings.registration.requireEmailVerification ? "todo" : "optional",
        detail: smtp?.ready
          ? "Password reset, verification and invite emails are ready."
          : settings.registration.requireEmailVerification
            ? "Required while email verification is on; configure SMTP in Integrations."
            : "Optional: configure SMTP to enable password reset and invite emails.",
      },
      {
        key: "admin",
        label: "Admin account",
        status: users.some((user) => user.role === "admin" && user.status !== "pending") ? "ok" : "todo",
        detail: "At least one active admin can sign in.",
      },
      {
        key: "legal",
        label: "Legal and risk content",
        status: legalReady ? "ok" : "optional",
        detail: legalReady
          ? "Terms, privacy or risk copy is configured."
          : "Recommended: add terms, privacy and a risk disclaimer in Site settings.",
      },
      {
        key: "marketData",
        label: "Twelve Data key",
        status: process.env.TWELVE_DATA_API_KEY ? "ok" : "optional",
        detail: process.env.TWELVE_DATA_API_KEY
          ? "Live market-data quotes are configured."
          : "Optional: set TWELVE_DATA_API_KEY for live quote refreshes.",
      },
      {
        key: "narration",
        label: "Narration model",
        status: process.env.NVIDIA_API_KEY ? "ok" : "optional",
        detail: process.env.NVIDIA_API_KEY
          ? "NVIDIA narration is configured."
          : "Optional: set NVIDIA_API_KEY to enable model-written market narration.",
      },
    ] as const;
    res.json({
      checks,
      registrationMode: settings.registration.mode,
      requireEmailVerification: settings.registration.requireEmailVerification,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to build setup status" });
  }
});

adminRouter.get("/users", adminRequired, async (_req, res) => {
  try {
    res.json({ users: await listUsers() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to list users" });
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

adminRouter.post("/users", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "username must be 3-32 characters (letters, digits, _, -)" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "email must be a valid address" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    const user = await createUser({ username, email, password, role });
    res.json({ user });
  } catch (err: any) {
    if (err?.code === 11000) {
      res.status(409).json({ error: err.keyPattern?.email ? "email already registered" : "username taken" });
      return;
    }
    res.status(500).json({ error: err?.message ?? "failed to create user" });
  }
});

adminRouter.post("/users/invite", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "username must be 3-32 characters (letters, digits, _, -)" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "email must be a valid address" });
      return;
    }
    if (!(await emailConfigured())) {
      res.status(503).json({ error: "Configure SMTP before inviting users by email." });
      return;
    }
    const user = await inviteUser({ username, email, role });
    try {
      await sendAdminInvite(user.id, req);
    } catch (err: any) {
      await deleteUser(user.id, req.userId!).catch(() => {});
      res.status(502).json({ error: err?.message ?? "failed to send invite email" });
      return;
    }
    res.json({ user });
  } catch (err: any) {
    if (err?.code === 11000) {
      res.status(409).json({ error: err.keyPattern?.email ? "email already registered" : "username taken" });
      return;
    }
    res.status(500).json({ error: err?.message ?? "failed to invite user" });
  }
});

adminRouter.patch("/users/:id", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const role = req.body?.role;
    const status = req.body?.status;
    if (role !== undefined && role !== "user" && role !== "admin") {
      res.status(400).json({ error: "role must be user or admin" });
      return;
    }
    if (status !== undefined && status !== "active" && status !== "pending") {
      res.status(400).json({ error: "status must be active or pending" });
      return;
    }
    const result = await updateUser(req.params.id, { role, status });
    if (result === "missing") {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (result === "last_admin") {
      res.status(409).json({ error: "cannot remove the last active admin" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to update user" });
  }
});

adminRouter.post("/users/:id/password", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const password = String(req.body?.password ?? "");
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    const ok = await resetUserPassword(req.params.id, password);
    if (!ok) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to reset password" });
  }
});

adminRouter.delete("/users/:id", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const result = await deleteUser(req.params.id, req.userId!);
    if (result === "missing") {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (result === "self") {
      res.status(400).json({ error: "you cannot delete your own account" });
      return;
    }
    if (result === "last_admin") {
      res.status(409).json({ error: "cannot delete the last active admin" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to delete user" });
  }
});

// ---------------------------------------------------------------------------
// Site settings: branding and theme for every visitor.
// ---------------------------------------------------------------------------

adminRouter.get("/settings", adminRequired, async (_req, res) => {
  try {
    res.json({ settings: await getSiteSettings() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to load site settings" });
  }
});

adminRouter.put("/settings", adminRequired, async (req: AuthedRequest, res) => {
  try {
    const settings = await saveSiteSettings(
      {
        site: req.body?.site,
        branding: req.body?.branding,
        theme: req.body?.theme,
        navigation: req.body?.navigation,
        maintenance: req.body?.maintenance,
        announcement: req.body?.announcement,
        registration: req.body?.registration,
        legal: req.body?.legal,
      },
      req.username ?? req.userId ?? "admin"
    );
    res.json({ settings });
  } catch (err: any) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err?.message ?? "failed to save site settings" });
  }
});
