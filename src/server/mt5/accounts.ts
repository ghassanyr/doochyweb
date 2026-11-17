import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import type { BrokerAccountRef, BrokerAccountView, BrokerMode } from "../broker/types";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  requireEncryptionKey,
} from "../integrations/crypto";
import type { Mt5BridgeConfig } from "./bridge";

const mt5AccountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  accountId: { type: String, required: true, trim: true },
  login: { type: String, required: true, trim: true },
  server: { type: String, required: true, trim: true },
  mode: { type: String, enum: ["demo", "live"], default: "demo" },
  password: { type: String, required: true },
  investorPassword: { type: String, default: null },
  currency: { type: String, default: null },
  nickname: { type: String, default: null },
  color: { type: String, default: null },
  lastOkAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  lastErrorAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

mt5AccountSchema.index({ userId: 1, accountId: 1 }, { unique: true });

export const Mt5AccountModel = mongoose.model("Mt5Account", mt5AccountSchema);

export interface Mt5StoredAccount {
  id: string;
  login: string;
  server: string;
  mode: BrokerMode;
  password: string;
  investorPassword: string | null;
  currency: string | null;
  nickname: string | null;
  color: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Mt5AccountView {
  id: string;
  broker: "mt5";
  login: string;
  server: string;
  name: string;
  mode: BrokerMode;
  balance: null;
  currency: string | null;
  nickname: string | null;
  color: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Mt5AccountInput {
  login: string;
  server: string;
  password: string;
  investorPassword?: string | null;
  mode: BrokerMode;
  currency?: string | null;
  nickname?: string | null;
  color?: string | null;
}

export interface Mt5AccountPrefs {
  nickname?: string;
  color?: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown, max = 120): string | null {
  return text(value).slice(0, max) || null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function aad(userId: string, accountId: string, field: string): string {
  return `mt5:${userId}:${accountId}:${field}`;
}

function seal(userId: string, accountId: string, field: string, value: string): string {
  return encryptSecret(value, aad(userId, accountId, field), requireEncryptionKey());
}

function open(userId: string, accountId: string, field: string, value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!isEncryptedSecret(value)) {
    throw new Error("MT5 account credentials need to be saved again");
  }
  return decryptSecret(value, aad(userId, accountId, field), requireEncryptionKey());
}

function storedFrom(doc: any): Mt5StoredAccount {
  return {
    id: String(doc.accountId),
    login: String(doc.login ?? ""),
    server: String(doc.server ?? ""),
    mode: doc.mode === "live" ? "live" : "demo",
    password: String(doc.password ?? ""),
    investorPassword: typeof doc.investorPassword === "string" ? doc.investorPassword : null,
    currency: typeof doc.currency === "string" && doc.currency ? doc.currency : null,
    nickname: typeof doc.nickname === "string" && doc.nickname ? doc.nickname : null,
    color: typeof doc.color === "string" && doc.color ? doc.color : null,
    lastOkAt: iso(doc.lastOkAt),
    lastError: typeof doc.lastError === "string" && doc.lastError ? doc.lastError : null,
    lastErrorAt: iso(doc.lastErrorAt),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function viewFrom(row: Mt5StoredAccount): Mt5AccountView {
  return {
    id: row.id,
    broker: "mt5",
    login: row.login,
    server: row.server,
    name: row.server || "MetaTrader 5",
    mode: row.mode,
    balance: null,
    currency: row.currency,
    nickname: row.nickname,
    color: row.color,
    lastOkAt: row.lastOkAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function normalizeMt5AccountInput(value: unknown): { ok: true; value: Mt5AccountInput } | { ok: false; error: string } {
  const raw = (value ?? {}) as Record<string, unknown>;
  const login = text(raw.login);
  const server = text(raw.server);
  const password = text(raw.password);
  const investorPassword = text(raw.investorPassword);
  if (!login || login.length > 120) return { ok: false, error: "login is required" };
  if (!server || server.length > 120) return { ok: false, error: "server is required" };
  if (!password || password.length > 500) return { ok: false, error: "password is required" };
  if (investorPassword.length > 500) return { ok: false, error: "investor password is too long" };
  return {
    ok: true,
    value: {
      login,
      server,
      password,
      investorPassword: investorPassword || null,
      mode: raw.mode === "live" ? "live" : "demo",
      currency: nullableText(raw.currency, 12),
      nickname: nullableText(raw.nickname, 40),
      color: nullableText(raw.color, 24),
    },
  };
}

export async function listMt5Accounts(userId: string): Promise<Mt5AccountView[]> {
  if (!mongoose.isValidObjectId(userId)) return [];
  const docs = await Mt5AccountModel.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
  return (docs as any[]).map((doc) => viewFrom(storedFrom(doc)));
}

export async function findMt5Account(userId: string, accountId: string): Promise<Mt5StoredAccount | null> {
  if (!mongoose.isValidObjectId(userId) || !accountId) return null;
  const doc = await Mt5AccountModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    accountId: text(accountId),
  })
    .lean()
    .exec();
  return doc ? storedFrom(doc) : null;
}

export async function getMt5Account(userId: string, accountId: string): Promise<Mt5AccountView | null> {
  const row = await findMt5Account(userId, accountId);
  return row ? viewFrom(row) : null;
}

export async function addMt5Account(userId: string, input: Mt5AccountInput): Promise<Mt5AccountView> {
  if (!mongoose.isValidObjectId(userId)) throw new Error("invalid user id");
  const owner = new mongoose.Types.ObjectId(userId);
  const accountId = randomUUID();
  await Mt5AccountModel.create({
    userId: owner,
    accountId,
    login: input.login,
    server: input.server,
    mode: input.mode,
    password: seal(userId, accountId, "password", input.password),
    investorPassword: input.investorPassword
      ? seal(userId, accountId, "investorPassword", input.investorPassword)
      : null,
    currency: input.currency ?? null,
    nickname: input.nickname ?? null,
    color: input.color ?? null,
    lastOkAt: null,
    lastError: null,
    lastErrorAt: null,
    updatedAt: new Date(),
  });
  const row = await findMt5Account(userId, accountId);
  if (!row) throw new Error("failed to save MT5 account");
  return viewFrom(row);
}

export async function updateMt5AccountPrefs(
  userId: string,
  accountId: string,
  prefs: Mt5AccountPrefs
): Promise<Mt5AccountView | null> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (prefs.nickname !== undefined) $set.nickname = nullableText(prefs.nickname, 40);
  if (prefs.color !== undefined) $set.color = nullableText(prefs.color, 24);
  const doc = await Mt5AccountModel.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId), accountId: text(accountId) },
    { $set },
    { new: true }
  )
    .lean()
    .exec();
  return doc ? viewFrom(storedFrom(doc)) : null;
}

export async function removeMt5Account(userId: string, accountId: string): Promise<boolean> {
  const result = await Mt5AccountModel.deleteOne({
    userId: new mongoose.Types.ObjectId(userId),
    accountId: text(accountId),
  }).exec();
  return result.deletedCount > 0;
}

export async function recordMt5AccountHealth(
  userId: string,
  accountId: string,
  outcome: { ok: boolean; error?: unknown }
): Promise<void> {
  const now = new Date();
  const message =
    outcome.error instanceof Error
      ? outcome.error.message
      : String(outcome.error ?? "MT5 connection failed");
  await Mt5AccountModel.updateOne(
    { userId: new mongoose.Types.ObjectId(userId), accountId: text(accountId) },
    {
      $set: outcome.ok
        ? { lastOkAt: now, lastError: null, lastErrorAt: null, updatedAt: now }
        : { lastError: message.slice(0, 500), lastErrorAt: now, updatedAt: now },
    }
  ).exec();
}

export function mt5AccountRef(userId: string, account: Mt5StoredAccount): BrokerAccountRef {
  return { userId, broker: "mt5", accountId: account.id, mode: account.mode };
}

export async function resolveMt5AccountConfig(userId: string, accountId: string): Promise<Mt5BridgeConfig> {
  const account = await findMt5Account(userId, accountId);
  if (!account) throw new Error("MT5 account not found");
  const { resolveIntegration } = await import("../integrations/store");
  const resolved = await resolveIntegration("mt5");
  if (!resolved.values.enabled) {
    throw new Error("MT5 is disabled. Enable it in the MT5 integration.");
  }
  if (!resolved.values.bridgeUrl) {
    throw new Error("MT5 bridge URL is not configured.");
  }
  const password = open(userId, account.id, "password", account.password);
  if (!password) throw new Error("MT5 account credentials need to be saved again");
  const investorPassword = open(userId, account.id, "investorPassword", account.investorPassword);
  return {
    bridgeUrl: text(resolved.values.bridgeUrl).replace(/\/+$/, ""),
    apiKey: text(resolved.values.apiKey) || null,
    accountId: account.id,
    mode: account.mode,
    enabled: true,
    userId,
    credentials: {
      login: account.login,
      server: account.server,
      password,
      investorPassword,
    },
  };
}

export function brokerAccountView(account: Mt5AccountView): BrokerAccountView {
  return {
    id: account.id,
    broker: "mt5",
    login: account.login,
    name: account.name,
    mode: account.mode,
    balance: account.balance,
    currency: account.currency,
    nickname: account.nickname,
    color: account.color,
  };
}
