import crypto from "node:crypto";
import mongoose from "mongoose";

import { hashPassword, signDemoToken } from "../auth";
import { isDemoUser, User } from "../db";

export const DEMO_USERNAME = "doochy-demo";
export const DEMO_SEED_VERSION = 1;

const demoStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "demo" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seedVersion: { type: Number, required: true, default: DEMO_SEED_VERSION },
    resetCount: { type: Number, required: true, default: 0 },
    seededAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const DemoState = mongoose.model("DemoState", demoStateSchema);

export interface DemoStatus {
  seeded: boolean;
  userId: string | null;
  seedVersion: number;
  resetCount: number;
  seededAt: string | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function getDemoUser(): Promise<any | null> {
  const state = await DemoState.findOne({ key: "demo" }).lean().exec();
  if (state?.userId) {
    const byState = await User.findById(state.userId).lean().exec();
    if (byState) return byState;
  }
  return User.findOne({ username: DEMO_USERNAME }).lean().exec();
}

export async function resolveDemoUserId(): Promise<string | null> {
  const user = await getDemoUser();
  return user ? String(user._id) : null;
}

export async function isDemoUserId(userId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false;
  const demoId = await resolveDemoUserId();
  return demoId === userId;
}

export async function demoStatus(): Promise<DemoStatus> {
  const [state, user] = await Promise.all([
    DemoState.findOne({ key: "demo" }).lean().exec(),
    getDemoUser(),
  ]);
  return {
    seeded: !!user && isDemoUser(user),
    userId: user ? String(user._id) : null,
    seedVersion: typeof state?.seedVersion === "number" ? state.seedVersion : 0,
    resetCount: typeof state?.resetCount === "number" ? state.resetCount : 0,
    seededAt: iso(state?.seededAt),
  };
}

export async function ensureDemoUser(): Promise<DemoStatus> {
  let user: any = await getDemoUser();
  if (user && !isDemoUser(user)) {
    throw new Error(`Username ${DEMO_USERNAME} is reserved for the demo account`);
  }

  if (!user) {
    user = await User.create({
      username: DEMO_USERNAME,
      passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
      role: "user",
      accountType: "demo",
      status: "active",
      emailVerified: true,
      termsAcceptedAt: null,
      tokenVersion: 0,
    });
  } else if (!isDemoUser(user)) {
    throw new Error(`Username ${DEMO_USERNAME} is reserved for the demo account`);
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { role: "user", accountType: "demo", status: "active", emailVerified: true } }
  ).exec();

  const now = new Date();
  await DemoState.findOneAndUpdate(
    { key: "demo" },
    {
      $setOnInsert: { key: "demo", seededAt: now },
      $set: { userId: user._id, seedVersion: DEMO_SEED_VERSION },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean().exec();

  return demoStatus();
}

export async function resetDemoUser(): Promise<DemoStatus> {
  const user = await getDemoUser();
  if (!user || !isDemoUser(user)) {
    return ensureDemoUser();
  }
  await User.updateOne({ _id: user._id, accountType: "demo" }, { $inc: { tokenVersion: 1 } }).exec();
  await DemoState.updateOne(
    { key: "demo" },
    { $inc: { resetCount: 1 }, $set: { seedVersion: DEMO_SEED_VERSION, userId: user._id } },
    { upsert: true }
  ).exec();
  return demoStatus();
}

export async function issueDemoToken(): Promise<{ token: string; username: string }> {
  const user = await getDemoUser();
  if (!user || !isDemoUser(user)) {
    throw new Error("Demo account is not seeded");
  }
  const version = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  return {
    token: signDemoToken(String(user._id), version),
    username: String(user.username ?? DEMO_USERNAME),
  };
}
