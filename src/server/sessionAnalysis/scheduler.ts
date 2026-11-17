// Polls the dedicated analysis mailbox on the cadence configured in Admin,
// Integrations (360 minutes by default).
//
// The first check runs shortly after startup so a fresh deployment does not
// wait six hours for its first session. A failed check is logged and the next
// one is still scheduled; a missing or disabled IMAP integration is not an
// error, it simply means there is nothing to read.

import { asImapValues } from "../integrations/imapSetup";
import { resolveIntegration } from "../integrations/store";
import { syncSessionAnalysis } from "./ingest";

const DEFAULT_POLL_MINUTES = 360;
const FIRST_CHECK_DELAY_MS = 30_000;
const MINUTE_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let stopped = true;

async function configuredPollMinutes(): Promise<number> {
  try {
    const resolved = await resolveIntegration("imap");
    const values = asImapValues(resolved.values);
    if (!values.enabled) return DEFAULT_POLL_MINUTES;
    return Number.isFinite(values.pollMinutes) && values.pollMinutes >= 5
      ? values.pollMinutes
      : DEFAULT_POLL_MINUTES;
  } catch {
    return DEFAULT_POLL_MINUTES;
  }
}

function schedule(delayMs: number): void {
  if (stopped) return;
  timer = setTimeout(() => {
    void tick();
  }, Math.max(1_000, delayMs));
  timer.unref?.();
}

async function tick(): Promise<void> {
  timer = null;
  if (stopped) return;

  try {
    const result = await syncSessionAnalysis();
    if (result.imported) {
      console.log(`[session-analysis] ${result.message}`);
    } else if (!result.configured) {
      console.log(`[session-analysis] ${result.message}`);
    }
  } catch (err) {
    console.error(
      `[session-analysis] check failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const minutes = await configuredPollMinutes();
  schedule(minutes * MINUTE_MS);
}

export function startSessionAnalysisScheduler(
  log: (message: string) => void = console.log
): void {
  if (timer) return;
  stopped = false;
  log(
    `[session-analysis] first mailbox check in ${Math.round(FIRST_CHECK_DELAY_MS / 1000)}s`
  );
  schedule(FIRST_CHECK_DELAY_MS);
}

export function stopSessionAnalysisScheduler(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Run a check shortly after the IMAP settings are saved. The normal cadence can
 * be six hours, so without this the first import would look broken until the
 * next scheduled poll.
 */
export function wakeSessionAnalysisScheduler(): void {
  if (stopped) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  schedule(1_000);
}
