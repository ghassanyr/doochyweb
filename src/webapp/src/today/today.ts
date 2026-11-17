// Pure helpers for the signed-in Today dashboard, kept out of the .tsx so the
// greeting and mover selection can be covered by the test suite.

import type { BriefingWatchlistRow } from "../api";

/** Local-time greeting. The page renders this once on open. */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The watchlist rows that moved most today, by absolute percentage change.
 * Rows without a change are dropped, so a stale snapshot never invents a mover.
 */
export function topMovers(
  watchlist: BriefingWatchlistRow[],
  limit = 4
): BriefingWatchlistRow[] {
  return watchlist
    .filter((row) => row.changePct != null && Number.isFinite(row.changePct))
    .slice()
    .sort((a, b) => Math.abs(b.changePct as number) - Math.abs(a.changePct as number))
    .slice(0, Math.max(0, limit));
}
