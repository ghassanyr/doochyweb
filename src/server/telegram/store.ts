// Persistence for Telegram links, one-time link codes and the delivery outbox.
//
// Kept feature-local, mirroring `signals/store.ts`, rather than growing `db.ts`.
// The unique indexes are the real guards: one chat per Doochy user, one user
// per chat, and one delivery per (signal, event, chat).

import mongoose from "mongoose";

const linkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  chatId: { type: String, required: true, unique: true },
  telegramUserId: { type: String, required: true },
  username: { type: String, default: null },
  firstName: { type: String, default: null },
  notificationsEnabled: { type: Boolean, default: true },
  linkedAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  lastError: { type: String, default: null },
  lastErrorAt: { type: Date, default: null },
});

export const TelegramLink = mongoose.model("TelegramLink", linkSchema);

const linkCodeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  usedByChatId: { type: String, default: null },
});

// Expired codes disappear without a cleanup job.
linkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TelegramLinkCode = mongoose.model("TelegramLinkCode", linkCodeSchema);

const deliverySchema = new mongoose.Schema({
  signalId: { type: mongoose.Schema.Types.ObjectId, ref: "Signal", default: null },
  event: { type: String, required: true },
  chatId: { type: String, required: true },
  text: { type: String, required: true },
  buttonUrl: { type: String, default: null },
  status: {
    type: String,
    enum: ["pending", "sending", "sent", "failed", "skipped"],
    default: "pending",
  },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  sentAt: { type: Date, default: null },
});

// Dedupe: a re-published or retried event can never double-send to one chat.
deliverySchema.index({ signalId: 1, event: 1, chatId: 1 }, { unique: true });
deliverySchema.index({ status: 1, nextAttemptAt: 1 });

export const TelegramDelivery = mongoose.model("TelegramDelivery", deliverySchema);

const stateSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  offset: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

export const TelegramState = mongoose.model("TelegramState", stateSchema);

export interface TelegramLinkRecord {
  userId: string;
  chatId: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  notificationsEnabled: boolean;
  linkedAt: string;
  lastError: string | null;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toLinkView(doc: any): TelegramLinkRecord {
  return {
    userId: String(doc.userId),
    chatId: String(doc.chatId),
    telegramUserId: String(doc.telegramUserId),
    username: doc.username ?? null,
    firstName: doc.firstName ?? null,
    notificationsEnabled: Boolean(doc.notificationsEnabled),
    linkedAt: iso(doc.linkedAt) ?? new Date(0).toISOString(),
    lastError: doc.lastError ?? null,
  };
}

export async function findLinkByUserId(userId: string): Promise<TelegramLinkRecord | null> {
  if (!mongoose.isValidObjectId(userId)) return null;
  const doc = await TelegramLink.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean().exec();
  return doc ? toLinkView(doc) : null;
}

export async function findLinkByChatId(chatId: string): Promise<TelegramLinkRecord | null> {
  const doc = await TelegramLink.findOne({ chatId }).lean().exec();
  return doc ? toLinkView(doc) : null;
}

export async function listEnabledLinks(): Promise<TelegramLinkRecord[]> {
  const docs = await TelegramLink.find({ notificationsEnabled: true }).lean().exec();
  return docs.map(toLinkView);
}

export async function linkChat(params: {
  userId: string;
  chatId: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
}): Promise<{ ok: true; link: TelegramLinkRecord } | { ok: false; reason: "chat_taken" }> {
  if (!mongoose.isValidObjectId(params.userId)) return { ok: false, reason: "chat_taken" };
  const userObjectId = new mongoose.Types.ObjectId(params.userId);

  const chatOwner = await TelegramLink.findOne({ chatId: params.chatId }).lean().exec();
  if (chatOwner && String(chatOwner.userId) !== params.userId) {
    return { ok: false, reason: "chat_taken" };
  }

  // Linking a different chat replaces the old one for this user.
  await TelegramLink.deleteMany({ userId: userObjectId, chatId: { $ne: params.chatId } }).exec();

  try {
    const doc = await TelegramLink.findOneAndUpdate(
      { userId: userObjectId },
      {
        $set: {
          chatId: params.chatId,
          telegramUserId: params.telegramUserId,
          username: params.username,
          firstName: params.firstName,
          lastSeenAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
        $setOnInsert: { linkedAt: new Date(), notificationsEnabled: true },
      },
      { upsert: true, new: true }
    ).exec();
    return { ok: true, link: toLinkView(doc) };
  } catch (err: any) {
    // Two chats can race for the same user; the unique index decides.
    if (err?.code === 11000) return { ok: false, reason: "chat_taken" };
    throw err;
  }
}

export async function deleteLinkByUserId(userId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false;
  const result = await TelegramLink.deleteOne({ userId: new mongoose.Types.ObjectId(userId) }).exec();
  return result.deletedCount > 0;
}

export async function setNotifications(userId: string, enabled: boolean): Promise<boolean> {
  if (!mongoose.isValidObjectId(userId)) return false;
  const result = await TelegramLink.updateOne(
    { userId: new mongoose.Types.ObjectId(userId) },
    { $set: { notificationsEnabled: enabled } }
  ).exec();
  return result.matchedCount > 0;
}

export async function touchLink(chatId: string): Promise<void> {
  await TelegramLink.updateOne({ chatId }, { $set: { lastSeenAt: new Date() } }).exec();
}

export async function syncTelegramIndexes(): Promise<void> {
  await Promise.all([
    TelegramLink.createIndexes(),
    TelegramLinkCode.createIndexes(),
    TelegramDelivery.createIndexes(),
    TelegramState.createIndexes(),
  ]);
}
