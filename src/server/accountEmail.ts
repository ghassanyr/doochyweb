// Self-service email changes for signed-in users.
//
// Registration and admin-created accounts normally arrive with an email, but
// accounts that predate email support have none. This keeps the change scoped
// to the current user, requires the current password, and reuses the normal
// verification flow so a new address is not trusted just because it was typed
// into an already-authenticated session.

import type { Request } from "express";

import { verifyPassword } from "./auth";
import { revokeAuthTokens } from "./authTokens";
import { User } from "./db";
import { emailConfigured as deliveryConfigured } from "./email/transport";
import { AccountEmailLinkError, sendVerification as sendVerifyEmail } from "./email/accountMail";
import { getSiteSettings as loadSiteSettings } from "./settings/store";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OwnEmailResult =
  | { ok: true; email: string; emailVerified: boolean; verificationSent: boolean }
  | { ok: false; status: number; error: string };

export interface OwnEmailDeps {
  emailConfigured?: () => Promise<boolean>;
  getSiteSettings?: typeof loadSiteSettings;
  sendVerification?: (userId: string, req: Request) => Promise<void>;
}

function failure(status: number, error: string): OwnEmailResult {
  return { ok: false, status, error };
}

export async function updateOwnEmail(
  userId: string,
  rawEmail: unknown,
  password: unknown,
  req: Request,
  deps: OwnEmailDeps = {}
): Promise<OwnEmailResult> {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return failure(400, "email must be a valid address");
  if (typeof password !== "string" || password.length === 0) {
    return failure(400, "Enter your current password to change your email.");
  }

  const user: any = await User.findById(userId).lean().exec();
  if (!user) return failure(401, "user no longer exists");
  if (!(await verifyPassword(password, String(user.passwordHash ?? "")))) {
    return failure(401, "Current password is incorrect.");
  }

  const previousEmail = typeof user.email === "string" && user.email ? user.email : null;
  const previousVerified = user.emailVerified !== false;
  if (previousEmail?.toLowerCase() === email) {
    return failure(400, "That is already your email address.");
  }

  const configured = await (deps.emailConfigured ?? deliveryConfigured)();
  const settings = await (deps.getSiteSettings ?? loadSiteSettings)();
  if (settings.registration.requireEmailVerification && !configured) {
    return failure(503, "Email verification is required but email delivery is not configured.");
  }

  const existing: any = await User.findOne({ email, _id: { $ne: userId } }).lean().exec();
  if (existing) return failure(409, "email already registered");

  const emailVerified = !configured;
  try {
    const updated = await User.updateOne(
      { _id: userId },
      { $set: { email, emailVerified } }
    ).exec();
    if (updated.matchedCount === 0) return failure(401, "user no longer exists");
  } catch (err: any) {
    if (err?.code === 11000) return failure(409, "email already registered");
    throw err;
  }

  await revokeAuthTokens(userId, "email_verification");

  if (!configured) {
    return { ok: true, email, emailVerified, verificationSent: false };
  }

  try {
    await (deps.sendVerification ?? sendVerifyEmail)(userId, req);
  } catch (err) {
    const restore: Record<string, unknown> = { emailVerified: previousVerified };
    const unset: Record<string, unknown> = {};
    if (previousEmail) restore.email = previousEmail;
    else unset.email = "";
    await User.updateOne(
      { _id: userId },
      Object.keys(unset).length > 0 ? { $set: restore, $unset: unset } : { $set: restore }
    ).exec().catch(() => {});
    await revokeAuthTokens(userId, "email_verification").catch(() => {});
    if (err instanceof AccountEmailLinkError) return failure(503, err.message);
    const message = err instanceof Error ? err.message : "";
    if (/not configured/i.test(message)) {
      return failure(503, "Email delivery is not configured.");
    }
    return failure(502, "The email could not be sent, so it was not changed.");
  }

  return { ok: true, email, emailVerified, verificationSent: true };
}
