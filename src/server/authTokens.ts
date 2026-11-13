// Single-use tokens for email-driven account actions.
//
// Only the SHA-256 hash is stored, so a database or backup leak cannot be
// replayed as a reset/invite/verification link. MongoDB's TTL index removes
// expired rows; consume() also checks the timestamp so a stale index cannot
// make an expired token valid.

import crypto from "node:crypto";
import mongoose from "mongoose";

export type AuthTokenPurpose = "password_reset" | "email_verification" | "admin_invite";

const authTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  purpose: {
    type: String,
    enum: ["password_reset", "email_verification", "admin_invite"],
    required: true,
    index: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

// TTL cleanup. The explicit expiry check in consume() is still authoritative.
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = mongoose.model("AuthToken", authTokenSchema);

export function hashAuthToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newAuthToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Replace any outstanding token for this user/purpose and return the plaintext. */
export async function createAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number
): Promise<string> {
  const token = newAuthToken();
  await AuthToken.deleteMany({ userId, purpose, usedAt: null }).exec();
  await AuthToken.create({
    tokenHash: hashAuthToken(token),
    purpose,
    userId: new mongoose.Types.ObjectId(userId),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
}

/**
 * Atomically consume a token. Returns the owning user id, or null when the
 * token is unknown, expired, already used, or for a different purpose.
 */
export async function consumeAuthToken(
  token: unknown,
  purpose: AuthTokenPurpose
): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const now = new Date();
  const doc: any = await AuthToken.findOneAndUpdate(
    {
      tokenHash: hashAuthToken(token),
      purpose,
      usedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
    { new: true }
  )
    .lean()
    .exec();
  return doc?.userId ? String(doc.userId) : null;
}

/** Drop every outstanding token for a user, optionally for one purpose. */
export async function revokeAuthTokens(
  userId: string,
  purpose?: AuthTokenPurpose
): Promise<void> {
  const filter: Record<string, unknown> = { userId };
  if (purpose) filter.purpose = purpose;
  await AuthToken.deleteMany(filter).exec();
}
