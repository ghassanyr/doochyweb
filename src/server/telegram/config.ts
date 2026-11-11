// Telegram configuration.
//
// Effective values come from the integrations store (database → environment →
// default), so a buyer can configure the bot from the admin panel while an
// existing .env deployment keeps working. The bot stays disabled unless a token
// is present, so local development and the test suite never reach
// api.telegram.org by accident.

import { resolveIntegration } from "../integrations/store";

export type TelegramMode = "polling" | "webhook";

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  mode: TelegramMode;
  botUsername: string;
  baseUrl: string;
  linkTtlMinutes: number;
}

const FALSY = ["false", "0", "off", "no"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (FALSY.includes(normalized)) return false;
    return true;
  }
  return fallback;
}

/**
 * Normalise resolved integration values (or raw environment values) into the
 * shape the bot uses. Defensive on purpose: a bad admin value must not take
 * notifications down with a type error.
 */
export function telegramConfigFromValues(
  values: Record<string, unknown>
): TelegramConfig {
  const token = text(values.botToken);
  const enabled = token.length > 0 && asBoolean(values.enabled, true);
  const mode: TelegramMode =
    text(values.mode).toLowerCase() === "webhook" ? "webhook" : "polling";
  const baseUrl =
    (text(values.baseUrl) || "https://doochy.net").replace(/\/+$/, "") || "https://doochy.net";
  const botUsername =
    (text(values.botUsername) || "DoochyBot").replace(/^@+/, "") || "DoochyBot";
  const ttlRaw = Number(values.linkTtlMinutes);
  const linkTtlMinutes =
    Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(60, Math.floor(ttlRaw)) : 15;
  return { enabled, token, mode, botUsername, baseUrl, linkTtlMinutes };
}

/** Environment-only view, kept for tests and bootstrap callers. */
export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  return telegramConfigFromValues({
    botToken: env.TELEGRAM_BOT_TOKEN,
    enabled: env.TELEGRAM_ENABLED,
    mode: env.TELEGRAM_MODE,
    baseUrl: env.PUBLIC_BASE_URL,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    linkTtlMinutes: env.TELEGRAM_LINK_TTL_MINUTES,
  });
}

/**
 * Store-backed config for runtime consumers. Reads Mongo on each call; the
 * callers are low-frequency (a long-poll cycle, a queued send, a settings
 * request), so there is no cache to invalidate when an admin saves.
 */
export async function loadTelegramConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<TelegramConfig> {
  const resolved = await resolveIntegration("telegram", env);
  return telegramConfigFromValues(resolved.values);
}

/** `t.me` deep link that opens the bot with `/start <code>` pre-filled. */
export function telegramDeepLink(code: string, config: TelegramConfig): string {
  return `https://t.me/${config.botUsername}?start=${encodeURIComponent(code)}`;
}
