// Mongo-backed outbox for signal notifications.
//
// Publishing writes delivery rows and returns; a small in-process worker sends
// them with retries. That keeps a Telegram outage or a PM2 restart from losing
// a signal alert, and the unique (signalId, event, chatId) index prevents
// duplicates.

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import type { SignalView } from "../signals/types";
import { TelegramApiError, sendMessage } from "./client";
import { telegramConfig } from "./config";
import { buildPublishedMessage, buildTestMessage, signalButtonUrl } from "./messages";
import { TelegramDelivery, TelegramLink } from "./store";

const MAX_ATTEMPTS = 5;
const MAX_RATE_LIMIT_ATTEMPTS = 10;
const BATCH_SIZE = 10;
const POLL_MS = 5_000;

/** Exponential retry delay, capped at 30 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Queue one message per linked, enabled chat. Safe to call more than once:
 * the unique delivery key means only the first insert wins.
 */
export async function enqueueSignalPublished(
  signal: SignalView,
  now: Date = new Date()
): Promise<number> {
  const config = telegramConfig();
  if (!config.enabled || !mongoose.isValidObjectId(signal.id)) return 0;

  const links = await TelegramLink.find({ notificationsEnabled: true })
    .select({ chatId: 1 })
    .lean()
    .exec();
  if (!links.length) return 0;

  const signalId = new mongoose.Types.ObjectId(signal.id);
  const text = buildPublishedMessage(signal);
  const buttonUrl = signalButtonUrl(config.baseUrl, signal.id);

  let queued = 0;
  for (const link of links) {
    const result = await TelegramDelivery.updateOne(
      { signalId, event: "published", chatId: link.chatId },
      {
        $setOnInsert: {
          signalId,
          event: "published",
          chatId: link.chatId,
          text,
          buttonUrl,
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          error: null,
          createdAt: now,
          sentAt: null,
        },
      },
      { upsert: true }
    ).exec();
    if (result.upsertedCount) queued++;
  }
  return queued;
}

/** Queue a one-off test message. Each call gets its own event key. */
export async function enqueueTest(chatId: string, now: Date = new Date()): Promise<void> {
  if (!telegramConfig().enabled) throw new Error("Telegram notifications are not configured");
  await TelegramDelivery.create({
    signalId: null,
    event: `test:${randomUUID()}`,
    chatId,
    text: buildTestMessage(),
    buttonUrl: null,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    error: null,
    createdAt: now,
    sentAt: null,
  });
}

export interface OutboxRun {
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Send every due row once. Exported so a test or CLI can drive the worker
 * without starting the timer.
 */
export async function processOutboxOnce(now: Date = new Date()): Promise<OutboxRun> {
  if (!telegramConfig().enabled) return { sent: 0, failed: 0, retried: 0 };

  const due = await TelegramDelivery.find({ status: "pending", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(BATCH_SIZE)
    .select({ _id: 1 })
    .lean()
    .exec();

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    // Claim atomically so two ticks can never send the same row.
    const claimed = await TelegramDelivery.findOneAndUpdate(
      { _id: row._id, status: "pending" },
      { $set: { status: "sending" }, $inc: { attempts: 1 } },
      { new: true }
    )
      .lean()
      .exec();
    if (!claimed) continue;

    // Re-check the link at send time: a chat unlinked (or paused) after the
    // publish was queued must not receive the alert. Test messages still go to
    // a linked chat even while notifications are paused.
    const link = await TelegramLink.findOne({ chatId: claimed.chatId })
      .select({ notificationsEnabled: 1 })
      .lean()
      .exec();
    const isPublished = String(claimed.event) === "published";
    if (!link || (isPublished && !(link as any).notificationsEnabled)) {
      await TelegramDelivery.updateOne(
        { _id: claimed._id },
        { $set: { status: "skipped", error: "chat unlinked or notifications disabled" } }
      ).exec();
      continue;
    }

    try {
      await sendMessage(
        String(claimed.chatId),
        String(claimed.text),
        claimed.buttonUrl ? String(claimed.buttonUrl) : null
      );
      await TelegramDelivery.updateOne(
        { _id: claimed._id },
        { $set: { status: "sent", sentAt: new Date(), error: null } }
      ).exec();
      await TelegramLink.updateOne(
        { chatId: claimed.chatId },
        { $unset: { lastError: "", lastErrorAt: "" } }
      ).exec();
      sent++;
    } catch (err) {
      const apiError = err instanceof TelegramApiError ? err : null;
      const message = errorText(err);
      const attempts = Number(claimed.attempts ?? 1);
      const rateLimited = apiError?.status === 429 && apiError.retryAfter != null;
      const permanent = apiError != null && (apiError.status === 400 || apiError.status === 403);
      const exhausted = rateLimited
        ? attempts >= MAX_RATE_LIMIT_ATTEMPTS
        : attempts >= MAX_ATTEMPTS;

      if (rateLimited && !exhausted) {
        const next = new Date(Date.now() + (apiError.retryAfter ?? 30) * 1000);
        await TelegramDelivery.updateOne(
          { _id: claimed._id },
          { $set: { status: "pending", nextAttemptAt: next, error: message } }
        ).exec();
        retried++;
      } else if (permanent || exhausted) {
        await TelegramDelivery.updateOne(
          { _id: claimed._id },
          { $set: { status: "failed", error: message } }
        ).exec();
        if (permanent) {
          await TelegramLink.updateOne(
            { chatId: claimed.chatId },
            { $set: { lastError: message, lastErrorAt: new Date() } }
          ).exec();
        }
        failed++;
      } else {
        const next = new Date(Date.now() + retryDelayMs(attempts));
        await TelegramDelivery.updateOne(
          { _id: claimed._id },
          { $set: { status: "pending", nextAttemptAt: next, error: message } }
        ).exec();
        retried++;
      }
    }
  }

  return { sent, failed, retried };
}

let stopFn: (() => void) | null = null;

/** Start the in-process worker. Idempotent. */
export function startOutbox(log: (msg: string) => void = console.log): void {
  if (stopFn) return;

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  // A crash during send leaves rows in "sending"; put them back in the queue.
  void TelegramDelivery.updateMany(
    { status: "sending" },
    { $set: { status: "pending", nextAttemptAt: new Date() } }
  )
    .exec()
    .catch((err) => log(`[telegram] outbox recovery failed: ${errorText(err)}`));

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const run = await processOutboxOnce();
      if (run.sent || run.failed) {
        log(`[telegram] outbox sent=${run.sent} failed=${run.failed} retried=${run.retried}`);
      }
    } catch (err) {
      log(`[telegram] outbox failed: ${errorText(err)}`);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };

  timer = setTimeout(tick, 1_000);
  stopFn = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopFn = null;
  };
}

export function stopOutbox(): void {
  stopFn?.();
}
