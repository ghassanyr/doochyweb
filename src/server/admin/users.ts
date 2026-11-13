// Admin user directory and account deletion.
//
// The role check lives in adminRequired; these helpers only answer "who is
// there" and "remove this one safely". Deletion also drops the credentials and
// Telegram link owned by the user so no orphaned rows survive the account.

import crypto from "node:crypto";
import mongoose from "mongoose";

import { hashPassword } from "../auth";
import { revokeAuthTokens } from "../authTokens";
import { Credentials, User, type UserRole, type UserStatus } from "../db";
import { dropUserSockets } from "../ctrader/connection";
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
    TelegramLink.deleteMany({ userId: objectId }).exec(),
    TelegramLinkCode.deleteMany({ userId: objectId }).exec(),
    revokeAuthTokens(userId),
  ]);
  await User.deleteOne({ _id: objectId }).exec();
  dropUserSockets(userId);
  return "deleted";
}
