// Account-action emails. Links always use the saved canonical site URL so a
// forged Host header cannot poison a reset or invite link.

import type { Request } from "express";

import { createAuthToken, revokeAuthTokens } from "../authTokens";
import { User } from "../db";
import { DEFAULT_BRANDING, DEFAULT_THEME } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { publicBaseUrlFor } from "../settings/siteUrl";
import { sendEmail } from "./transport";
import {
  adminInviteEmail,
  passwordResetEmail,
  renderEmailTemplate,
  verifyEmailEmail,
  DARK_EMAIL_THEME,
  type EmailContent,
  type EmailTheme,
} from "./templates";
import type { SiteSettings } from "../settings/types";

export const ACCOUNT_TOKEN_TTL_MINUTES = 45;
const TTL_MS = ACCOUNT_TOKEN_TTL_MINUTES * 60_000;

// Verification mail always uses a dark shell. A site in dark mode supplies its
// own palette, a site in light mode falls back to the compiled dark palette.
function verificationTheme(theme: SiteSettings["theme"]): EmailTheme {
  const source = theme.mode === "dark" ? theme : DEFAULT_THEME;
  return {
    canvas: source.canvas || DARK_EMAIL_THEME.canvas,
    surface: source.surface || DARK_EMAIL_THEME.surface,
    border: source.borderStrong || DARK_EMAIL_THEME.border,
    text: source.text || DARK_EMAIL_THEME.text,
    muted: source.ratingNeutral || DARK_EMAIL_THEME.muted,
    accent: source.accent || DARK_EMAIL_THEME.accent,
    accentFg: source.accentFg || DARK_EMAIL_THEME.accentFg,
    radius: source.radius,
    dark: true,
  };
}

export class AccountEmailLinkError extends Error {
  constructor() {
    super("Set the canonical site URL before sending account emails.");
    this.name = "AccountEmailLinkError";
  }
}

function requestOrigin(req: Request): string | null {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host") || "";
  if (!host) return null;
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

async function context(
  req: Request
): Promise<{ base: string; brand: string; settings: SiteSettings }> {
  const settings = await getSiteSettings();
  const base = publicBaseUrlFor(settings, process.env, requestOrigin(req));
  if (!base) throw new AccountEmailLinkError();
  return { base, brand: settings.branding.name || DEFAULT_BRANDING.name, settings };
}

function link(base: string, path: string, token: string): string {
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

async function deliver(to: string, content: EmailContent): Promise<void> {
  await sendEmail({ to, ...content });
}

async function userFor(userId: string): Promise<any | null> {
  return User.findById(userId).lean().exec();
}

export async function sendPasswordReset(userId: string, req: Request): Promise<void> {
  const user = await userFor(userId);
  const to = typeof user?.email === "string" ? user.email.trim() : "";
  if (!to) return;
  const { base, brand, settings } = await context(req);
  const token = await createAuthToken(userId, "password_reset", TTL_MS);
  const url = link(base, "/reset-password", token);
  try {
    const custom = settings.templates.email.passwordReset;
    await deliver(
      to,
      custom.body.trim()
        ? renderEmailTemplate(custom, {
            brand,
            url,
            username: String((await userFor(userId))?.username ?? ""),
            expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES,
          })
        : passwordResetEmail({ brand, url, expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES })
    );
  } catch (err) {
    await revokeAuthTokens(userId, "password_reset").catch(() => {});
    throw err;
  }
}

export async function sendVerification(userId: string, req: Request): Promise<void> {
  const user = await userFor(userId);
  const to = typeof user?.email === "string" ? user.email.trim() : "";
  if (!to) throw new Error("This account has no email address.");
  const { base, brand, settings } = await context(req);
  const theme = verificationTheme(settings.theme);
  const token = await createAuthToken(userId, "email_verification", TTL_MS);
  const url = link(base, "/verify-email", token);
  try {
    const custom = settings.templates.email.verifyEmail;
    await deliver(
      to,
      custom.body.trim()
        ? renderEmailTemplate(
            custom,
            {
              brand,
              url,
              username: String(user.username ?? ""),
              expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES,
            },
            theme
          )
        : verifyEmailEmail({ brand, url, expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES }, theme)
    );
  } catch (err) {
    await revokeAuthTokens(userId, "email_verification").catch(() => {});
    throw err;
  }
}

export async function sendAdminInvite(userId: string, req: Request): Promise<void> {
  const user = await userFor(userId);
  const to = typeof user?.email === "string" ? user.email.trim() : "";
  if (!to) throw new Error("This account has no email address.");
  const { base, brand, settings } = await context(req);
  const token = await createAuthToken(userId, "admin_invite", TTL_MS);
  const url = link(base, "/accept-invite", token);
  const username = String(user.username ?? "");
  try {
    const custom = settings.templates.email.adminInvite;
    await deliver(
      to,
      custom.body.trim()
        ? renderEmailTemplate(custom, {
            brand,
            url,
            username,
            expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES,
          })
        : adminInviteEmail({
            brand,
            url,
            username,
            expiresMinutes: ACCOUNT_TOKEN_TTL_MINUTES,
          })
    );
  } catch (err) {
    await revokeAuthTokens(userId, "admin_invite").catch(() => {});
    throw err;
  }
}
