// Admin user directory and account deletion.
//
// The role check lives in adminRequired; these helpers only answer "who is
// there" and "remove this one safely". Deletion also drops the credentials and
// Telegram link owned by the user so no orphaned rows survive the account.

import crypto from "node:crypto";
import mongoose from "mongoose";

import { hashPassword } from "../auth";
import { revokeAuthTokens } from "../authTokens";
import { Credentials, User, type StoredAccount, type UserRole, type UserStatus } from "../db";
import { dropUserSockets } from "../ctrader/connection";
import { UserWatchlist } from "../market/userWatchlist";
import { Mt5AccountModel } from "../mt5/accounts";
import { TelegramLink, TelegramLinkCode } from "../telegram/store";

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: string | null;
}

export type DeleteUserResult = "deleted" | "missing" | "self" | "last_admin";
export type UserUpdateResult = "updated" | "missing" | "last_admin";

export interface AdminCtraderHealthRow {
  userId: string;
  username: string;
  mode: "oauth" | "manual";
  accounts: StoredAccount[];
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  reauthRequired: boolean;
}

export interface AdminCtraderHealth {
  connections: AdminCtraderHealthRow[];
  summary: {
    connected: number;
    reauthRequired: number;
    failing: number;
  };
}

export interface AdminMt5HealthRow {
  userId: string;
  username: string;
  accountId: string;
  login: string;
  server: string;
  mode: "demo" | "live";
  nickname: string | null;
  color: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface AdminMt5Health {
  connections: AdminMt5HealthRow[];
  summary: {
    accounts: number;
    users: number;
    failing: number;
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function rowFrom(doc: any): AdminUserRow {
  return {
    id: String(doc._id),
    username: String(doc.username ?? ""),
    email: typeof doc.email === "string" && doc.email ? doc.email : null,
    role: doc.role === "admin" ? "admin" : "user",
    status: doc.status === "pending" ? "pending" : "active",
    emailVerified: doc.emailVerified !== false,
    createdAt: iso(doc.createdAt),
  };
}

/** Every account, newest first. Never includes the password hash. */
export async function listUsers(): Promise<AdminUserRow[]> {
  const docs = await User.find({}).sort({ createdAt: -1 }).lean().exec();
  return docs.map(rowFrom);
}

/** Per-user cTrader connection state without tokens, secrets or app fields. */
export async function listCtraderHealth(): Promise<AdminCtraderHealth> {
  const docs = await Credentials.find({}).sort({ updatedAt: -1 }).lean().exec();
  if (docs.length === 0) {
    return { connections: [], summary: { connected: 0, reauthRequired: 0, failing: 0 } };
  }
  const users = await User.find({ _id: { $in: docs.map((doc: any) => doc.userId) } })
    .select({ username: 1 })
    .lean()
    .exec();
  const names = new Map(users.map((user: any) => [String(user._id), String(user.username ?? "unknown")]));
  const connections = docs.map((doc: any): AdminCtraderHealthRow => ({
    userId: String(doc.userId),
    username: names.get(String(doc.userId)) ?? "unknown",
    mode: typeof doc.clientId === "string" && doc.clientId ? "manual" : "oauth",
    accounts: Array.isArray(doc.accounts) ? (doc.accounts as StoredAccount[]) : [],
    lastOkAt: iso(doc.lastOkAt),
    lastError: typeof doc.lastError === "string" && doc.lastError ? doc.lastError : null,
    lastErrorAt: iso(doc.lastErrorAt),
    reauthRequired: doc.reauthRequired === true,
  }));
  return {
    connections,
    summary: {
      connected: connections.length,
      reauthRequired: connections.filter((row) => row.reauthRequired).length,
      failing: connections.filter((row) => row.lastError !== null).length,
    },
  };
}

/** Per-user MT5 account state without passwords or investor passwords. */
export async function listMt5Health(): Promise<AdminMt5Health> {
  const docs = await Mt5AccountModel.find({}).sort({ createdAt: -1 }).lean().exec();
  if (docs.length === 0) {
    return { connections: [], summary: { accounts: 0, users: 0, failing: 0 } };
  }
  const userIds = Array.from(new Set((docs as any[]).map((doc) => String(doc.userId))));
  const users = await User.find({ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select({ username: 1 })
    .lean()
    .exec();
  const names = new Map(users.map((user: any) => [String(user._id), String(user.username ?? "unknown")]));
  const connections = (docs as any[]).map((doc): AdminMt5HealthRow => ({
    userId: String(doc.userId),
    username: names.get(String(doc.userId)) ?? "unknown",
    accountId: String(doc.accountId),
    login: String(doc.login ?? ""),
    server: String(doc.server ?? ""),
    mode: doc.mode === "live" ? "live" : "demo",
    nickname: typeof doc.nickname === "string" && doc.nickname ? doc.nickname : null,
    color: typeof doc.color === "string" && doc.color ? doc.color : null,
    lastOkAt: iso(doc.lastOkAt),
    lastError: typeof doc.lastError === "string" && doc.lastError ? doc.lastError : null,
    lastErrorAt: iso(doc.lastErrorAt),
  }));
  return {
    connections,
    summary: {
      accounts: connections.length,
      users: new Set(connections.map((row) => row.userId)).size,
      failing: connections.filter((row) => row.lastError !== null).length,
    },
  };
}

/** Create an active account from the admin panel, bypassing registration mode. */
export async function createUser(input: {
  username: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<AdminUserRow> {
  const user = await User.create({
    username: input.username,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    status: "active",
    emailVerified: true,
    tokenVersion: 0,
  });
  return rowFrom(user.toObject ? user.toObject() : user);
}

/**
 * Create an invited account. The password hash is random and unusable until the
 * invite link is accepted; the account is pending so it cannot sign in first.
 */
export async function inviteUser(input: {
  username: string;
  email: string;
  role: UserRole;
}): Promise<AdminUserRow> {
  const user = await User.create({
    username: input.username,
    email: input.email,
    passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
    role: input.role,
    status: "pending",
    emailVerified: false,
    tokenVersion: 0,
  });
  return rowFrom(user.toObject ? user.toObject() : user);
}

/** Active admins are the ones who can actually sign in and recover the site. */
const ACTIVE_ADMIN_FILTER = { role: "admin", status: { $ne: "pending" } };

/** Change role and/or approval status, refusing to remove the last active admin. */
export async function updateUser(
  userId: string,
  patch: { role?: UserRole; status?: UserStatus }
): Promise<UserUpdateResult> {
  if (!mongoose.isValidObjectId(userId)) return "missing";
  const user = await User.findById(userId).lean().exec();
  if (!user) return "missing";

  const currentRole = ((user.role as UserRole | undefined) ?? "user");
  const currentStatus = ((user.status as UserStatus | undefined) ?? "active");
  const nextRole = patch.role ?? currentRole;
  const nextStatus = patch.status ?? currentStatus;
  const losesActiveAdmin =
    currentRole === "admin" && currentStatus === "active" &&
    (nextRole !== "admin" || nextStatus !== "active");
  if (losesActiveAdmin) {
    const admins = await User.countDocuments(ACTIVE_ADMIN_FILTER).exec();
    if (admins <= 1) return "last_admin";
  }

  const set: Record<string, unknown> = {};
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.status !== undefined) set.status = patch.status;
  if (Object.keys(set).length > 0) {
    await User.updateOne({ _id: user._id }, { $set: set }).exec();
  }
  return "updated";
}

export async function resetUserPassword(userId: string, password: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false;
  const objectId = new mongoose.Types.ObjectId(userId);
  const result = await User.updateOne(
    { _id: objectId },
    {
      $set: { passwordHash: await hashPassword(password) },
      $inc: { tokenVersion: 1 },
    }
  ).exec();
  if (result.matchedCount > 0) await revokeAuthTokens(userId);
  return result.matchedCount > 0;
}

/**
 * Delete one user plus the rows that belong to them. Refuses self-deletion and
 * removing the last admin, so the panel cannot lock itself out.
 */
export async function deleteUser(userId: string, actorId: string): Promise<DeleteUserResult> {
  if (!mongoose.isValidObjectId(userId)) return "missing";
  if (userId === actorId) return "self";

  const user = await User.findById(userId).lean().exec();
  if (!user) return "missing";

  if (user.role === "admin") {
    const admins = await User.countDocuments(ACTIVE_ADMIN_FILTER).exec();
    if (admins <= 1) return "last_admin";
  }

  const objectId = new mongoose.Types.ObjectId(userId);
  await Promise.all([
    Credentials.deleteMany({ userId: objectId }).exec(),
    Mt5AccountModel.deleteMany({ userId: objectId }).exec(),
    TelegramLink.deleteMany({ userId: objectId }).exec(),
    TelegramLinkCode.deleteMany({ userId: objectId }).exec(),
    UserWatchlist.deleteMany({ userId: objectId }).exec(),
    revokeAuthTokens(userId),
  ]);
  await User.deleteOne({ _id: objectId }).exec();
  dropUserSockets(userId);
  return "deleted";
}
