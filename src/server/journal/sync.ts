// Automatic cTrader import for the journal.
//
// Importing is deliberately not a button: the journal keeps itself current by
// reading closed deals for every connected account, so a verified P&L appears
// without the member doing anything. Two entry points share one guard:
//
// - the scheduler ticks every ten minutes for every user with credentials, and
// - opening the journal triggers a sync when the last run is older than the
//   minimum gap, which makes a fresh visit show new trades on the next poll.
//
// The unique (userId, dealId) index keeps both paths idempotent, so overlapping
// runs can never duplicate a trade.

import { Credentials, loadCredentials } from "../db";
import { listMt5Accounts, Mt5AccountModel } from "../mt5/accounts";
import { importCtraderHistory, importMt5History, readSyncState, recordSync } from "./store";

/** How often the background pass looks at every user. */
const SYNC_INTERVAL_MS = 10 * 60_000;
/** Never broker-read the same user more often than this. */
const MIN_GAP_MS = 5 * 60_000;
/** The broker caps a page at seven days; one week is the useful default. */
const SYNC_DAYS = 7;

export interface JournalSyncResult {
  imported: number;
  accounts: number;
  skipped: boolean;
  error: string | null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Import closed deals for one user's accounts. Safe to call often: a recent run
 * short-circuits unless `force` is set.
 */
export async function syncUserJournal(
  userId: string,
  options: { force?: boolean; now?: Date } = {}
): Promise<JournalSyncResult> {
  const now = options.now ?? new Date();

  if (!options.force) {
    const last = await readSyncState(userId);
    if (last && now.getTime() - last.getTime() < MIN_GAP_MS) {
      return { imported: 0, accounts: 0, skipped: true, error: null };
    }
  }

  const [credentials, mt5Accounts] = await Promise.all([
    loadCredentials(userId),
    listMt5Accounts(userId),
  ]);
  const accounts = credentials?.accounts ?? [];
  if (!accounts.length && !mt5Accounts.length) {
    await recordSync(userId, { at: now, imported: 0, error: null });
    return { imported: 0, accounts: 0, skipped: false, error: null };
  }

  let imported = 0;
  let error: string | null = null;

  for (const account of accounts) {
    try {
      const result = await importCtraderHistory(userId, account.ctid, SYNC_DAYS);
      imported += result.imported;
    } catch (err) {
      // One bad account (expired token, broker refusal) must not stop the rest.
      error = errorText(err);
    }
  }

  for (const account of mt5Accounts) {
    try {
      const result = await importMt5History(userId, account.id, SYNC_DAYS);
      imported += result.imported;
    } catch (err) {
      error = errorText(err);
    }
  }

  await recordSync(userId, { at: now, imported, error });
  return { imported, accounts: accounts.length + mt5Accounts.length, skipped: false, error };
}

let stopFn: (() => void) | null = null;

/** Start the ten-minute background import. Idempotent. */
export function startJournalSync(log: (msg: string) => void = console.log): void {
  if (stopFn) return;

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const [credentialRows, mt5Rows] = await Promise.all([
        Credentials.find({}).select({ userId: 1 }).lean().exec(),
        Mt5AccountModel.find({}).select({ userId: 1 }).lean().exec(),
      ]);
      const userIds = new Set([
        ...credentialRows.map((row: any) => String(row.userId)),
        ...mt5Rows.map((row: any) => String(row.userId)),
      ]);
      let imported = 0;
      let users = 0;
      for (const userId of userIds) {
        if (stopped) break;
        try {
          const result = await syncUserJournal(userId);
          if (result.skipped) continue;
          users++;
          imported += result.imported;
          if (result.imported) {
            log(`[journal] imported ${result.imported} trade(s) for ${userId}`);
          }
        } catch (err) {
          log(`[journal] sync failed for ${userId}: ${errorText(err)}`);
        }
      }
      if (imported) log(`[journal] background import: ${imported} trade(s) across ${users} user(s)`);
    } catch (err) {
      log(`[journal] background import failed: ${errorText(err)}`);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, SYNC_INTERVAL_MS);
    }
  };

  // A short delay lets the broker sockets and Mongo lines settle after boot.
  timer = setTimeout(tick, 20_000);
  stopFn = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopFn = null;
  };
}

export function stopJournalSync(): void {
  stopFn?.();
}
