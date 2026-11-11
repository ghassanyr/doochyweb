// Feature entry point. A bad token must not take the web app down, so startup
// failures are logged and the rest of the server keeps running.

import { startPolling, stopPolling } from "./bot";
import { telegramConfig } from "./config";
import { startOutbox, stopOutbox } from "./notify";
import { syncTelegramIndexes } from "./store";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function startTelegram(log: (msg: string) => void = console.log): Promise<void> {
  const config = telegramConfig();
  if (!config.enabled) {
    log("[telegram] disabled (set TELEGRAM_BOT_TOKEN to enable)");
    return;
  }

  try {
    await syncTelegramIndexes();
  } catch (err) {
    log(`[telegram] index sync failed: ${errorText(err)}`);
  }

  startOutbox(log);

  if (config.mode === "polling") {
    try {
      await startPolling(log);
    } catch (err) {
      log(`[telegram] bot failed to start: ${errorText(err)}`);
    }
  } else {
    log("[telegram] webhook mode selected; polling not started");
  }
}

export function stopTelegram(): void {
  stopPolling();
  stopOutbox();
}
