// Telegram configuration.
//
// Effective values come from the integrations store (database, then environment,
// then default), so a buyer can configure the bot from the admin panel while an
// existing .env deployment keeps working. The bot stays disabled unless a token
// is present, so local development and the test suite never reach
// api.telegram.org by accident. Updates are always fetched by long polling.

import { resolveIntegration } from "../integrations/store";
import { DEFAULT_BRANDING } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { canonicalPublicBaseUrl, normalizePublicBaseUrl } from "../settings/siteUrl";

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  botUsername: string;
  baseUrl: string;
  brandName: string;
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

function fallbackBotUsername(brandName: string): string {
  const compact = brandName.replace(/[^A-Za-z0-9_]/g, "");
  return `${compact || "Market"}Bot`;
}

/**
 * Normalise resolved integration values (or raw environment values) into the
 * shape the bot uses. Defensive on purpose: a bad admin value must not take
 * notifications down with a type error.
 */
export function telegramConfigFromValues(
  values: Record<string, unknown>,
  canonicalBaseUrl: string | null = null,
  brandName = DEFAULT_BRANDING.name
): TelegramConfig {
  const token = text(values.botToken);
  const enabled = token.length > 0 && asBoolean(values.enabled, true);
  const baseUrl = normalizePublicBaseUrl(canonicalBaseUrl) ?? "";
  const brand = text(brandName) || DEFAULT_BRANDING.name;
  const botUsername =
    text(values.botUsername).replace(/^@+/, "") || fallbackBotUsername(brand);
  const ttlRaw = Number(values.linkTtlMinutes);
  const linkTtlMinutes =
    Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(60, Math.floor(ttlRaw)) : 15;
  return { enabled, token, botUsername, baseUrl, brandName: brand, linkTtlMinutes };
}

/** Environment-only view, kept for tests and bootstrap callers. */
export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  return telegramConfigFromValues(
    {
      botToken: env.TELEGRAM_BOT_TOKEN,
      enabled: env.TELEGRAM_ENABLED,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      linkTtlMinutes: env.TELEGRAM_LINK_TTL_MINUTES,
    },
    env.PUBLIC_BASE_URL ?? null
  );
}

/**
 * Store-backed config for runtime consumers. Reads Mongo on each call; the
 * callers are low-frequency (a long-poll cycle, a queued send, a settings
 * request), so there is no cache to invalidate when an admin saves.
 */
export async function loadTelegramConfig(
  env: NodeJS.ProcessEnv = process.env
): Promise<TelegramConfig> {
  const [resolved, canonicalBaseUrl, settings] = await Promise.all([
    resolveIntegration("telegram", env),
    canonicalPublicBaseUrl(env),
    getSiteSettings(),
  ]);
  return telegramConfigFromValues(resolved.values, canonicalBaseUrl, settings.branding.name);
}

/** `t.me` deep link that opens the bot with `/start <code>` pre-filled. */
export function telegramDeepLink(code: string, config: TelegramConfig): string {
  return `https://t.me/${config.botUsername}?start=${encodeURIComponent(code)}`;
}
