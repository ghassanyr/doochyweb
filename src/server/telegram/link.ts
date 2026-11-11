// One-time link codes.
//
// A bot cannot trust a typed Doochy username, so linking is proven by a
// short-lived code minted while signed in. Only the SHA-256 hash is stored;
// the raw code exists in the browser and in the Telegram message.

import crypto from "node:crypto";
import mongoose from "mongoose";

import { TelegramLinkCode } from "./store";

// Crockford base32: no I, L, O or U, so the code survives being read aloud.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

/** Random code. 10 base32 characters is 50 bits of entropy. */
export function generateLinkCode(
  length: number = CODE_LENGTH,
  random: (size: number) => Buffer = crypto.randomBytes
): string {
  const bytes = random(length);
  let code = "";
  for (let i = 0; i < length; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** Uppercase, strip separators, and undo Crockford's ambiguous characters. */
export function normalizeLinkCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function hashLinkCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeLinkCode(code)).digest("hex");
}

export function isValidLinkCodeFormat(code: string): boolean {
  const normalized = normalizeLinkCode(code);
  return normalized.length === CODE_LENGTH && [...normalized].every((ch) => ALPHABET.includes(ch));
}

export async function createLinkCode(
  userId: string,
  ttlMinutes: number,
  now: Date = new Date()
): Promise<{ code: string; expiresAt: Date }> {
  if (!mongoose.isValidObjectId(userId)) throw new Error("invalid user id");
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Only one live code per user; generating a new one invalidates the old.
  await TelegramLinkCode.deleteMany({ userId: userObjectId, usedAt: null }).exec();

  const code = generateLinkCode();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  await TelegramLinkCode.create({
    codeHash: hashLinkCode(code),
    userId: userObjectId,
    createdAt: now,
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Atomically consume a code. Returns the owning user id, or null when the code
 * is unknown, expired, or already used.
 */
export async function consumeLinkCode(
  rawCode: string,
  chatId: string,
  now: Date = new Date()
): Promise<string | null> {
  const doc = await TelegramLinkCode.findOneAndUpdate(
    { codeHash: hashLinkCode(rawCode), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now, usedByChatId: chatId } },
    { new: true }
  )
    .lean()
    .exec();
  return doc ? String(doc.userId) : null;
}
