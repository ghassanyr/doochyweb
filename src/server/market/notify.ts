// Telegram notifications for the scraper. Configuration lives in the environment:
//   TELEGRAM_BOT_TOKEN  bot token from @BotFather
//   TELEGRAM_CHAT_ID    numeric chat id to post to
// Missing config is not an error: notifications are skipped and the caller logs it.

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? "").trim();
  return token && chatId ? { token, chatId } : null;
}

/** Send one message. Returns an error string on failure; never throws. */
export async function sendTelegram(text: string, cfg: TelegramConfig | null = telegramConfig()): Promise<string | null> {
  if (!cfg) return "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set";
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Telegram HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
