// Thin Bot API client. Every request is outbound, which is what lets polling
// run behind nginx/Cloudflare without any inbound route.
//
// The token is part of the URL, so it must never appear in a log or an error
// message. All failures are normalized to TelegramApiError with the token
// redacted.

import { telegramConfig } from "./config";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number | string; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramApiError extends Error {
  status: number;
  retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "TelegramApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join("<redacted>") : text;
}

async function apiCall<T>(
  method: string,
  payload: Record<string, unknown> = {},
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const config = telegramConfig();
  if (!config.token) throw new TelegramApiError("Telegram bot token is not configured", 0);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    // An external abort is a deliberate shutdown, not a delivery failure.
    if (opts.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : "network error";
    throw new TelegramApiError(`Telegram request failed: ${redact(reason, config.token)}`, 0);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !data?.ok) {
    const description =
      typeof data?.description === "string" ? data.description : `HTTP ${res.status}`;
    const retryRaw = Number(data?.parameters?.retry_after);
    const retryAfter = Number.isFinite(retryRaw) ? retryRaw : null;
    throw new TelegramApiError(redact(description, config.token), res.status, retryAfter);
  }

  return data.result as T;
}

export async function getMe(): Promise<TelegramUser> {
  return apiCall<TelegramUser>("getMe");
}

export async function getUpdates(
  offset: number,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<TelegramUpdate[]> {
  return apiCall<TelegramUpdate[]>(
    "getUpdates",
    { offset, timeout: timeoutSeconds, allowed_updates: ["message"] },
    { timeoutMs: (timeoutSeconds + 10) * 1000, signal }
  );
}

export async function sendMessage(
  chatId: string,
  text: string,
  buttonUrl?: string | null
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttonUrl) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: "Open on Doochy", url: buttonUrl }]],
    };
  }
  await apiCall("sendMessage", payload);
}

export async function setMyCommands(
  commands: { command: string; description: string }[]
): Promise<void> {
  await apiCall("setMyCommands", { commands });
}

export async function deleteWebhook(): Promise<void> {
  await apiCall("deleteWebhook", { drop_pending_updates: false });
}
