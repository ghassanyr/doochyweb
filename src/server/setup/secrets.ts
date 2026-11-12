// Secret generation and validation for the setup CLI.
//
// The formats match what the server already expects:
//   JWT_SECRET                     any long random string
//   INTEGRATIONS_ENCRYPTION_KEY    base64 that decodes to exactly 32 bytes
//   TRAINER_ITEM_SECRET            any random string used as an HMAC key

import crypto from "node:crypto";

import { parseEncryptionKey } from "../integrations/crypto";

export const JWT_SECRET_BYTES = 48;
export const ENCRYPTION_KEY_BYTES = 32;
export const TRAINER_SECRET_BYTES = 32;

export function generateJwtSecret(): string {
  return crypto.randomBytes(JWT_SECRET_BYTES).toString("base64url");
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(ENCRYPTION_KEY_BYTES).toString("base64");
}

export function generateTrainerSecret(): string {
  return crypto.randomBytes(TRAINER_SECRET_BYTES).toString("base64url");
}

export function isValidEncryptionKey(value: string): boolean {
  try {
    parseEncryptionKey(value);
    return true;
  } catch {
    return false;
  }
}

export function isUsableJwtSecret(value: string): boolean {
  return value.trim().length >= 32;
}

/** Short, non-reversible hint for logs. Never returns the full secret. */
export function secretHint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "(empty)";
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
