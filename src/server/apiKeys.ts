// Admin API keys for automation and integrations.
//
// Only a SHA-256 hash of the secret is stored. The plain key is returned once
// when it is created and cannot be recovered afterwards.

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  prefix: { type: String, required: true, unique: true, index: true },
  hash: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
});

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);

export interface ApiKeyView {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function apiKeyView(row: any): ApiKeyView {
  return {
    id: String(row._id ?? row.id ?? ""),
    label: String(row.label ?? ""),
    prefix: String(row.prefix ?? ""),
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    lastUsedAt: iso(row.lastUsedAt),
  };
}

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const rows = await ApiKey.find({}).sort({ createdAt: -1 }).lean().exec();
  return rows.map(apiKeyView);
}

export async function createApiKey(
  label: string
): Promise<{ key: string; record: ApiKeyView }> {
  const clean = label.trim();
  if (!clean) throw new Error("Give the key a label");
  const key = `dky_${randomBytes(24).toString("base64url")}`;
  const prefix = key.slice(0, 12);
  const row = await ApiKey.create({ label: clean, prefix, hash: hashApiKey(key) });
  return { key, record: apiKeyView(row) };
}

export async function revokeApiKey(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const result = await ApiKey.deleteOne({ _id: id }).exec();
  return result.deletedCount === 1;
}

/** Resolve a presented admin API key, updating its last-used timestamp. */
export async function verifyApiKey(key: string): Promise<ApiKeyView | null> {
  if (!key.startsWith("dky_")) return null;
  const row = await ApiKey.findOneAndUpdate(
    { hash: hashApiKey(key) },
    { $set: { lastUsedAt: new Date() } },
    { new: false }
  )
    .lean()
    .exec();
  return row ? apiKeyView(row) : null;
}
