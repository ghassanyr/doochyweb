// Feature entry point. A bad token must not take the web app down, so startup
// failures are logged and the rest of the server keeps running.

import { startPolling, stopPolling } from "./bot";
import { loadTelegramConfig, type TelegramConfig } from "./config";
import { startOutbox, stopOutbox } from "./notify";
import { syncTelegramIndexes } from "./store";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function startTelegram(log: (msg: string) => void = console.log): Promise<void> {
  let config: TelegramConfig;
  try {
    config = await loadTelegramConfig();
  } catch (err) {
    log(`[telegram] configuration could not be read: ${errorText(err)}`);
    return;
  }
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

  try {
    await startPolling(log);
  } catch (err) {
    log(`[telegram] bot failed to start: ${errorText(err)}`);
  }
}

export function stopTelegram(): void {
  stopPolling();
  stopOutbox();
}
