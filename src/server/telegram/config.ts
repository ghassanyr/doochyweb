// Telegram configuration, read from the environment at call time.
//
// The bot stays disabled unless a token is present, so local development and
// the test suite never reach api.telegram.org by accident.

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

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const enabledFlag = (env.TELEGRAM_ENABLED ?? "true").trim().toLowerCase();
  const enabled = token.length > 0 && !FALSY.includes(enabledFlag);
  const mode: TelegramMode =
    (env.TELEGRAM_MODE ?? "polling").trim().toLowerCase() === "webhook" ? "webhook" : "polling";
  const baseUrl =
    (env.PUBLIC_BASE_URL ?? "https://doochy.net").trim().replace(/\/+$/, "") || "https://doochy.net";
  const botUsername = (env.TELEGRAM_BOT_USERNAME ?? "DoochyBot").trim().replace(/^@+/, "") || "DoochyBot";
  const ttlRaw = Number(env.TELEGRAM_LINK_TTL_MINUTES ?? "15");
  const linkTtlMinutes = Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(60, Math.floor(ttlRaw)) : 15;
  return { enabled, token, mode, botUsername, baseUrl, linkTtlMinutes };
}

/** `t.me` deep link that opens the bot with `/start <code>` pre-filled. */
export function telegramDeepLink(code: string, config: TelegramConfig = telegramConfig()): string {
  return `https://t.me/${config.botUsername}?start=${encodeURIComponent(code)}`;
}
