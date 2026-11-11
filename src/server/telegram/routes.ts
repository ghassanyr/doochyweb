// Authenticated API for the Settings card. No admin gate: any signed-in user
// may link their own chat.

import { Router, type Response } from "express";

import { authRequired, type AuthedRequest } from "../auth";
import { loadTelegramConfig, telegramDeepLink } from "./config";
import { createLinkCode } from "./link";
import { enqueueTest } from "./notify";
import {
  deleteLinkByUserId,
  findLinkByUserId,
  setNotifications,
} from "./store";

export const telegramRouter = Router();

// In-memory limiter; the app is a single PM2 instance, so this is sufficient.
const buckets = new Map<string, { count: number; resetAt: number }>();

function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

function fail(res: Response, err: unknown, fallback: string): void {
  res.status(500).json({ error: err instanceof Error ? err.message : fallback });
}

telegramRouter.post("/link", authRequired, async (req: AuthedRequest, res) => {
  try {
    const config = await loadTelegramConfig();
    if (!config.enabled) {
      res.status(503).json({ error: "Telegram notifications are not configured" });
      return;
    }
    if (!allow(`link:${req.userId}`, 5, 60 * 60_000)) {
      res.status(429).json({ error: "Too many codes requested. Try again later." });
      return;
    }
    const { code, expiresAt } = await createLinkCode(req.userId!, config.linkTtlMinutes);
    res.json({
      code,
      expiresAt: expiresAt.toISOString(),
      deepLink: telegramDeepLink(code, config),
      botUsername: config.botUsername,
    });
  } catch (err) {
    fail(res, err, "could not create a link code");
  }
});

telegramRouter.get("/status", authRequired, async (req: AuthedRequest, res) => {
  try {
    const config = await loadTelegramConfig();
    const link = await findLinkByUserId(req.userId!);
    res.json({
      enabled: config.enabled,
      botUsername: config.botUsername,
      linked: !!link,
      username: link?.username ?? null,
      firstName: link?.firstName ?? null,
      notificationsEnabled: link?.notificationsEnabled ?? false,
      linkedAt: link?.linkedAt ?? null,
      lastError: link?.lastError ?? null,
    });
  } catch (err) {
    fail(res, err, "could not read Telegram status");
  }
});

telegramRouter.post("/unlink", authRequired, async (req: AuthedRequest, res) => {
  try {
    await deleteLinkByUserId(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "could not disconnect Telegram");
  }
});

telegramRouter.patch("/prefs", authRequired, async (req: AuthedRequest, res) => {
  const enabled = req.body?.notificationsEnabled;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "notificationsEnabled must be a boolean" });
    return;
  }
  try {
    const updated = await setNotifications(req.userId!, enabled);
    if (!updated) {
      res.status(404).json({ error: "Telegram is not linked" });
      return;
    }
    res.json({ ok: true, notificationsEnabled: enabled });
  } catch (err) {
    fail(res, err, "could not update notifications");
  }
});

telegramRouter.post("/test", authRequired, async (req: AuthedRequest, res) => {
  try {
    if (!(await loadTelegramConfig()).enabled) {
      res.status(503).json({ error: "Telegram notifications are not configured" });
      return;
    }
    if (!allow(`test:${req.userId}`, 3, 10 * 60_000)) {
      res.status(429).json({ error: "Too many test messages. Try again later." });
      return;
    }
    const link = await findLinkByUserId(req.userId!);
    if (!link) {
      res.status(404).json({ error: "Telegram is not linked" });
      return;
    }
    await enqueueTest(link.chatId);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "could not queue a test message");
  }
});
