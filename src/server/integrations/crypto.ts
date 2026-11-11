// Envelope encryption for integration secrets.
//
// Telegram bot tokens, SMTP passwords and (later) cTrader app secrets must
// survive a database dump, so they are encrypted before they reach Mongo. The
// key lives only in the server environment; nothing in this module reads or
// writes the database.
//
// Each value is AES-256-GCM with its own random IV and authentication tag. The
// caller supplies an AAD string such as `telegram:botToken`; it is bound into
// the tag, so a ciphertext cannot be moved to another provider or field and
// still decrypt. Values carry a `v1.` prefix so the format can change later
// without guessing.

import crypto from "node:crypto";

/** Environment variable holding the base64-encoded 32-byte key. */
export const ENCRYPTION_KEY_ENV = "INTEGRATIONS_ENCRYPTION_KEY";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const B64URL = /^[A-Za-z0-9_-]+$/;
const B64URL_MAYBE_EMPTY = /^[A-Za-z0-9_-]*$/;

export class IntegrationCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationCryptoError";
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new IntegrationCryptoError(`encryption key must be ${KEY_BYTES} bytes`);
  }
}

function assertAad(aad: string): void {
  if (typeof aad !== "string" || aad.trim() === "") {
    throw new IntegrationCryptoError("an integration field name is required");
  }
}

/**
 * Decode a key from the environment. Accepts standard or URL-safe base64,
 * with or without padding. `openssl rand -base64 32` is the intended source.
 */
export function parseEncryptionKey(raw: string | null | undefined): Buffer {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new IntegrationCryptoError(`${ENCRYPTION_KEY_ENV} is not set`);
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(normalized)) {
    throw new IntegrationCryptoError(`${ENCRYPTION_KEY_ENV} must be base64-encoded`);
  }

  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const key = Buffer.from(padded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new IntegrationCryptoError(
      `${ENCRYPTION_KEY_ENV} must decode to ${KEY_BYTES} bytes`
    );
  }
  return key;
}

/** Key from the environment, or null when unset. Invalid values throw. */
export function encryptionKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env[ENCRYPTION_KEY_ENV];
  return raw && raw.trim() ? parseEncryptionKey(raw) : null;
}

/** Key for writes; throws a message that tells a self-hoster how to make one. */
export function requireEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const key = encryptionKeyFromEnv(env);
  if (!key) {
    throw new IntegrationCryptoError(
      `${ENCRYPTION_KEY_ENV} is not set; generate one with "openssl rand -base64 32"`
    );
  }
  return key;
}

/** Encrypt a secret into the `v1.iv.tag.ciphertext` storage format. */
export function encryptSecret(plaintext: string, aad: string, key: Buffer): string {
  assertKey(key);
  assertAad(aad);
  if (typeof plaintext !== "string") {
    throw new IntegrationCryptoError("secret must be a string");
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a stored secret. Every failure (wrong key, tampered tag, moved
 * ciphertext) reports the same message so callers cannot probe the reason and
 * errors never echo plaintext.
 */
export function decryptSecret(payload: string, aad: string, key: Buffer): string {
  assertKey(key);
  assertAad(aad);

  const parts = typeof payload === "string" ? payload.split(".") : [];
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new IntegrationCryptoError("secret is not a recognised encrypted value");
  }

  const [, ivPart, tagPart, dataPart] = parts;
  if (
    !B64URL.test(ivPart) ||
    !B64URL.test(tagPart) ||
    !B64URL_MAYBE_EMPTY.test(dataPart)
  ) {
    throw new IntegrationCryptoError("secret is not a recognised encrypted value");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new IntegrationCryptoError("secret is not a recognised encrypted value");
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new IntegrationCryptoError("secret could not be decrypted");
  }
}

/**
 * Structural check used by migrations to tell an encrypted value from a legacy
 * plaintext one. It does not (and cannot) verify the key.
 */
export function isEncryptedSecret(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  const [, ivPart, tagPart, dataPart] = parts;
  if (!B64URL.test(ivPart) || !B64URL.test(tagPart) || !B64URL_MAYBE_EMPTY.test(dataPart)) {
    return false;
  }
  return (
    Buffer.from(ivPart, "base64url").length === IV_BYTES &&
    Buffer.from(tagPart, "base64url").length === TAG_BYTES
  );
}

/**
 * Safe display value for an admin card. Never returns the secret; the last
 * four characters are only a recognition hint.
 */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}
