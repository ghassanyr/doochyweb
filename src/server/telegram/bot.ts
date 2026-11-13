// Long-polling bot.
//
// Polling is outbound-only, so it needs no public route, nginx change, or
// Cloudflare WAF exception. Only one process may poll a bot at a time.

import { User } from "../db";
import {
  deleteWebhook,
  getMe,
  getUpdates,
  sendMessage,
  setMyCommands,
  type TelegramUpdate,
} from "./client";
import { loadTelegramConfig } from "./config";
import { consumeLinkCode, isValidLinkCodeFormat, normalizeLinkCode } from "./link";
import {
  buildAlreadyLinkedMessage,
  buildChatTakenMessage,
  buildHelpMessage,
  buildInvalidCodeMessage,
  buildLinkedMessage,
  buildNotLinkedMessage,
  buildResumedMessage,
  buildStatusMessage,
  buildStoppedMessage,
  buildUnknownMessage,
  buildUnlinkedMessage,
  buildWelcomeMessage,
} from "./messages";
import {
  deleteLinkByUserId,
  findLinkByChatId,
  linkChat,
  setNotifications,
  TelegramState,
  touchLink,
} from "./store";

export type BotCommand =
  | { kind: "start"; code: string | null; hasCodeArg: boolean }
  | { kind: "status" }
  | { kind: "stop" }
  | { kind: "resume" }
  | { kind: "unlink" }
  | { kind: "help" }
  | { kind: "unknown" };

const COMMAND_RE = /^\/([a-zA-Z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

/**
 * Parse a message into a command. `/start CODE`, `/start@Bot CODE` and a bare
 * code all link; anything else is an unknown command.
 */
export function parseCommand(text: string): BotCommand {
  const raw = text.trim();
  if (!raw) return { kind: "unknown" };

  const match = raw.match(COMMAND_RE);
  if (match) {
    const command = match[1].toLowerCase();
    const arg = (match[2] ?? "").trim();
    switch (command) {
      case "start": {
        if (!arg) return { kind: "start", code: null, hasCodeArg: false };
        const token = arg.split(/\s+/)[0] ?? "";
        const code = normalizeLinkCode(token);
        return { kind: "start", code: code || null, hasCodeArg: true };
      }
      case "status":
        return { kind: "status" };
      case "stop":
      case "mute":
        return { kind: "stop" };
      case "resume":
      case "unmute":
        return { kind: "resume" };
      case "unlink":
        return { kind: "unlink" };
      case "help":
        return { kind: "help" };
      default:
        return { kind: "unknown" };
    }
  }

  // A bare code is accepted only when the whole message is one token.
  if (/^[0-9A-Za-z-]{8,16}$/.test(raw)) {
    const code = normalizeLinkCode(raw);
    if (isValidLinkCodeFormat(code)) return { kind: "start", code, hasCodeArg: true };
  }
  return { kind: "unknown" };
}

const BOT_COMMANDS = [
  { command: "status", description: "Connection and notification state" },
  { command: "stop", description: "Pause signal notifications" },
  { command: "resume", description: "Resume signal notifications" },
  { command: "unlink", description: "Disconnect this chat" },
  { command: "help", description: "Show commands" },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// In-memory per-chat limiter; the app is a single PM2 instance. Silently drop
// excess commands so a spammer cannot amplify replies or hammer Mongo.
const commandBuckets = new Map<string, { count: number; resetAt: number }>();

function allowCommand(chatId: string): boolean {
  const now = Date.now();
  if (commandBuckets.size > 1_000) commandBuckets.clear();
  const bucket = commandBuckets.get(chatId);
  if (!bucket || bucket.resetAt <= now) {
    commandBuckets.set(chatId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 10) return false;
  bucket.count++;
  return true;
}

/** Handle one update. Exported so a future webhook can reuse it. */
export async function handleUpdate(update: TelegramUpdate, log: (msg: string) => void = console.log): Promise<void> {
  const message = update.message;
  if (!message || typeof message.text !== "string") return;
  if (message.chat?.type !== "private") return;

  const chatId = String(message.chat.id);
  if (!allowCommand(chatId)) return;

  const command = parseCommand(message.text);
  const from = message.from;
  const identity = {
    chatId,
    telegramUserId: String(from?.id ?? chatId),
    username: from?.username ?? null,
    firstName: from?.first_name ?? null,
  };
  const config = await loadTelegramConfig();
  const settingsUrl = config.baseUrl ? `${config.baseUrl}/settings` : "";

  await touchLink(chatId).catch(() => undefined);

  switch (command.kind) {
    case "start": {
      if (command.hasCodeArg) {
        if (!command.code || !isValidLinkCodeFormat(command.code)) {
          await sendMessage(chatId, buildInvalidCodeMessage(settingsUrl));
          return;
        }
        const userId = await consumeLinkCode(command.code, chatId);
        if (!userId) {
          await sendMessage(chatId, buildInvalidCodeMessage(settingsUrl));
          return;
        }
        const result = await linkChat({ userId, ...identity });
        await sendMessage(chatId, result.ok ? buildLinkedMessage(config.brandName) : buildChatTakenMessage(config.brandName));
        return;
      }

      const existing = await findLinkByChatId(chatId);
      await sendMessage(
        chatId,
        existing ? buildAlreadyLinkedMessage(config.brandName) : buildWelcomeMessage(settingsUrl, config.brandName)
      );
      return;
    }

    case "status": {
      const link = await findLinkByChatId(chatId);
      if (!link) {
        await sendMessage(chatId, buildWelcomeMessage(settingsUrl, config.brandName));
        return;
      }
      const user = await User.findById(link.userId).lean().exec();
      const account = user && typeof (user as any).username === "string" ? (user as any).username : null;
      await sendMessage(
        chatId,
        buildStatusMessage({
          account,
          notificationsEnabled: link.notificationsEnabled,
          linkedAt: link.linkedAt,
        })
      );
      return;
    }

    case "stop":
    case "resume": {
      const link = await findLinkByChatId(chatId);
      if (!link) {
        await sendMessage(chatId, buildWelcomeMessage(settingsUrl, config.brandName));
        return;
      }
      const enabled = command.kind === "resume";
      await setNotifications(link.userId, enabled);
      await sendMessage(chatId, enabled ? buildResumedMessage() : buildStoppedMessage());
      return;
    }

    case "unlink": {
      const link = await findLinkByChatId(chatId);
      if (!link) {
        await sendMessage(chatId, buildNotLinkedMessage(settingsUrl));
        return;
      }
      await deleteLinkByUserId(link.userId);
      await sendMessage(chatId, buildUnlinkedMessage());
      return;
    }

    case "help":
      await sendMessage(chatId, buildHelpMessage(config.brandName));
      return;

    default:
      await sendMessage(chatId, buildUnknownMessage());
  }
}

let stopFn: (() => void) | null = null;

/** Start the long-poll loop. Idempotent; failures are logged, never thrown. */
export async function startPolling(log: (msg: string) => void = console.log): Promise<void> {
  if (stopFn) return;
  const config = await loadTelegramConfig();
  if (!config.enabled) return;

  const me = await getMe();
  log(`[telegram] getMe ok @${me.username ?? config.botUsername}`);

  // A leftover webhook makes getUpdates return 409. The old project is off, so
  // clearing it is safe and keeps a reused bot idempotent.
  try {
    await deleteWebhook();
    log("[telegram] webhook cleared");
  } catch (err) {
    log(`[telegram] deleteWebhook failed: ${errorText(err)}`);
  }

  try {
    await setMyCommands(BOT_COMMANDS);
  } catch (err) {
    log(`[telegram] setMyCommands failed: ${errorText(err)}`);
  }

  const state = await TelegramState.findOneAndUpdate(
    { key: "polling" },
    { $setOnInsert: { offset: 0 } },
    { upsert: true, new: true }
  )
    .lean()
    .exec();
  let offset = Number((state as any)?.offset ?? 0);

  let stopped = false;
  const abort = new AbortController();
  stopFn = () => {
    stopped = true;
    abort.abort();
    stopFn = null;
  };

  log("[telegram] polling started");

  void (async () => {
    let backoff = 1_000;
    while (!stopped) {
      try {
        const updates = await getUpdates(offset, 50, abort.signal);
        backoff = 1_000;
        for (const update of updates) {
          if (stopped) break;
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            await handleUpdate(update, log);
          } catch (err) {
            log(`[telegram] update ${update.update_id} failed: ${errorText(err)}`);
          }
          await TelegramState.updateOne(
            { key: "polling" },
            { $set: { offset, updatedAt: new Date() } }
          ).exec();
        }
      } catch (err) {
        if (stopped) break;
        log(`[telegram] polling failed: ${errorText(err)}; retrying in ${backoff}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
    log("[telegram] polling stopped");
  })();
}

export function stopPolling(): void {
  stopFn?.();
}
