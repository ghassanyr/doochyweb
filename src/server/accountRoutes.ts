// Public email-driven account actions: forgot/reset password, resend and
// confirm email verification, and invite acceptance.

import { Router, type Request, type Response } from "express";

import { hashPassword, signToken } from "./auth";
import { consumeAuthToken, revokeAuthTokens } from "./authTokens";
import { User } from "./db";
import { EmailNotConfiguredError, emailConfigured } from "./email/transport";
import {
  AccountEmailLinkError,
  sendPasswordReset,
  sendVerification,
} from "./email/accountMail";
import { getSiteSettings } from "./settings/store";
import { legalAcceptanceRequired, legalAcceptanceSatisfied } from "./legal";

export const accountAuthRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In-memory limiter; the app runs as one PM2 instance.
const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size >= 512) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

function email(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function fail(res: Response, err: unknown, fallback: string, status = 500): void {
  if (err instanceof EmailNotConfiguredError) {
    res.status(503).json({ error: "Email delivery is not configured." });
    return;
  }
  if (err instanceof AccountEmailLinkError) {
    res.status(503).json({ error: err.message });
    return;
  }
  console.error("[account]", fallback, err instanceof Error ? err.message : err);
  res.status(status).json({ error: fallback });
}

async function requireEmail(res: Response): Promise<boolean> {
  if (await emailConfigured()) return true;
  res.status(503).json({ error: "Email delivery is not configured." });
  return false;
}

accountAuthRouter.post("/forgot-password", async (req: Request, res: Response) => {
  if (!allow(`forgot:${req.ip}`, 5, 15 * 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  const address = email(req.body?.email);
  if (!EMAIL_RE.test(address)) {
    res.status(400).json({ error: "email must be a valid address" });
    return;
  }
  try {
    if (!(await requireEmail(res))) return;
    const user: any = await User.findOne({ email: address }).lean().exec();
    if (user) {
      try {
        await sendPasswordReset(String(user._id), req);
      } catch (err) {
        // Do not turn account existence into an enumeration oracle.
        console.error("[email] password reset failed:", err instanceof Error ? err.message : err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "failed to start password reset");
  }
});

accountAuthRouter.post("/reset-password", async (req: Request, res: Response) => {
  if (!allow(`reset:${req.ip}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  const token = req.body?.token;
  const password = String(req.body?.password ?? "");
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }
  try {
    const userId = await consumeAuthToken(token, "password_reset");
    if (!userId) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }
    const updated = await User.updateOne(
      { _id: userId },
      {
        $set: {
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
        $inc: { tokenVersion: 1 },
      }
    ).exec();
    if (updated.matchedCount === 0) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }
    await revokeAuthTokens(userId);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "failed to reset password");
  }
});

accountAuthRouter.post("/verify-email", async (req: Request, res: Response) => {
  if (!allow(`verify:${req.ip}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  try {
    const userId = await consumeAuthToken(req.body?.token, "email_verification");
    if (!userId) {
      res.status(400).json({ error: "This verification link is invalid or has expired." });
      return;
    }
    const updated = await User.updateOne(
      { _id: userId },
      { $set: { emailVerified: true } }
    ).exec();
    if (updated.matchedCount === 0) {
      res.status(400).json({ error: "This verification link is invalid or has expired." });
      return;
    }
    await revokeAuthTokens(userId, "email_verification");
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "failed to verify email");
  }
});

accountAuthRouter.post("/resend-verification", async (req: Request, res: Response) => {
  if (!allow(`resend:${req.ip}`, 5, 15 * 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  const address = email(req.body?.email);
  if (!EMAIL_RE.test(address)) {
    res.status(400).json({ error: "email must be a valid address" });
    return;
  }
  try {
    if (!(await requireEmail(res))) return;
    const user: any = await User.findOne({ email: address, emailVerified: false }).lean().exec();
    if (user) {
      try {
        await sendVerification(String(user._id), req);
      } catch (err) {
        console.error("[email] verification resend failed:", err instanceof Error ? err.message : err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "failed to resend verification");
  }
});

accountAuthRouter.post("/accept-invite", async (req: Request, res: Response) => {
  if (!allow(`invite:${req.ip}`, 10, 15 * 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  const token = req.body?.token;
  const password = String(req.body?.password ?? "");
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }
  try {
    const settings = await getSiteSettings();
    const legalRequired = legalAcceptanceRequired(settings.legal);
    if (!legalAcceptanceSatisfied(settings.legal, req.body?.acceptedTerms)) {
      res.status(400).json({
        error: "Accept the Terms and Privacy Policy to create an account.",
      });
      return;
    }
    const userId = await consumeAuthToken(token, "admin_invite");
    if (!userId) {
      res.status(400).json({ error: "This invite link is invalid or has expired." });
      return;
    }
    const updated = await User.updateOne(
      { _id: userId },
      {
        $set: {
          passwordHash: await hashPassword(password),
          status: "active",
          emailVerified: true,
          termsAcceptedAt: legalRequired ? new Date() : null,
        },
        $inc: { tokenVersion: 1 },
      }
    ).exec();
    if (updated.matchedCount === 0) {
      res.status(400).json({ error: "This invite link is invalid or has expired." });
      return;
    }
    await revokeAuthTokens(userId);
    const user: any = await User.findById(userId).lean().exec();
    res.json({
      token: signToken(userId, typeof user?.tokenVersion === "number" ? user.tokenVersion : 1),
      username: String(user?.username ?? ""),
    });
  } catch (err) {
    fail(res, err, "failed to accept invite");
  }
});
