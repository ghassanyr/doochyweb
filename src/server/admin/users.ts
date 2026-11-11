// Admin user directory and account deletion.
//
// The role check lives in adminRequired; these helpers only answer "who is
// there" and "remove this one safely". Deletion also drops the credentials and
// Telegram link owned by the user so no orphaned rows survive the account.

import mongoose from "mongoose";

import { Credentials, User, type UserRole } from "../db";
import { dropUserSockets } from "../ctrader/connection";
import { TelegramLink, TelegramLinkCode } from "../telegram/store";

export interface AdminUserRow {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  createdAt: string | null;
}

export type DeleteUserResult = "deleted" | "missing" | "self" | "last_admin";

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Every account, newest first. Never includes the password hash. */
export async function listUsers(): Promise<AdminUserRow[]> {
  const docs = await User.find({}).sort({ createdAt: -1 }).lean().exec();
  return docs.map((doc: any) => ({
    id: String(doc._id),
    username: String(doc.username ?? ""),
    email: typeof doc.email === "string" && doc.email ? doc.email : null,
    role: doc.role === "admin" ? "admin" : "user",
    createdAt: iso(doc.createdAt),
  }));
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
    const admins = await User.countDocuments({ role: "admin" }).exec();
    if (admins <= 1) return "last_admin";
  }

  const objectId = new mongoose.Types.ObjectId(userId);
  await Promise.all([
    Credentials.deleteMany({ userId: objectId }).exec(),
    TelegramLink.deleteMany({ userId: objectId }).exec(),
    TelegramLinkCode.deleteMany({ userId: objectId }).exec(),
  ]);
  await User.deleteOne({ _id: objectId }).exec();
  dropUserSockets(userId);
  return "deleted";
}
