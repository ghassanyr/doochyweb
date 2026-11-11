// What price has done since the break. Pure and lookahead-free: only bars that
// closed after the event are used, and the window stops at HORIZON bars so the
// number means the same thing as the analogue outcome window.
//
// This is deliberately not a profit/loss figure. It reports the maximum move in
// favour and against, in ATR units, plus the first ±1 ATR touch.

import { H4_MS, HORIZON } from "./analogues";
import type { Candle } from "./types";

export type FirstTouch = "up" | "down" | "tie" | "neither";

export interface SinceBreak {
  status: "pending" | "in_progress" | "complete";
  /** Bars observed since the break, capped at `horizon`. */
  bars: number;
  horizon: number;
  entry: number | null;
  atr: number | null;
  /** Maximum favourable excursion in ATR units. */
  mfe: number | null;
  /** Maximum adverse excursion in ATR units. */
  mae: number | null;
  /** First ±1 ATR level touched, in absolute up/down terms. */
  first_touch: FirstTouch | null;
  /** Close-to-entry change at the last observed bar, percent. */
  close_change_pct: number | null;
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));

/**
 * Measure the follow-through for one event. `direction` is the break direction:
 * "above" treats a higher high as favourable, "below" treats a lower low as
 * favourable. Returns a pending record when the next bar has not closed yet.
 */
export function measureSinceBreak(
  bars: Candle[],
  timestampUtc: string,
  direction: "above" | "below",
  atr: number | null,
  horizon = HORIZON
): SinceBreak {
  const eventMs = Date.parse(timestampUtc);
  const empty: SinceBreak = {
    status: "pending",
    bars: 0,
    horizon,
    entry: null,
    atr: atr == null ? null : round(atr, 6),
    mfe: null,
    mae: null,
    first_touch: null,
    close_change_pct: null,
  };
  if (!Number.isFinite(eventMs)) return empty;

  // Bars are expected closed and sorted, but do not rely on it.
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  let eventIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].time + H4_MS <= eventMs) eventIndex = i;
  }
  if (eventIndex < 0) return empty;

  const window = sorted.slice(eventIndex + 1, eventIndex + 1 + horizon);
  if (!window.length) return empty;

  const entry = window[0].open;
  const last = window[window.length - 1];
  const status: SinceBreak["status"] = window.length >= horizon ? "complete" : "in_progress";
  const closeChange = entry > 0 ? round(((last.close - entry) / entry) * 100, 2) : null;

  if (atr == null || !(atr > 0)) {
    return {
      ...empty,
      status,
      bars: window.length,
      entry,
      close_change_pct: closeChange,
    };
  }

  const up = entry + atr;
  const down = entry - atr;
  let mfe = 0;
  let mae = 0;
  let firstTouch: FirstTouch = "neither";
  for (const bar of window) {
    const favourable = direction === "above" ? bar.high - entry : entry - bar.low;
    const adverse = direction === "above" ? entry - bar.low : bar.high - entry;
    mfe = Math.max(mfe, favourable);
    mae = Math.max(mae, adverse);
    if (firstTouch !== "neither") continue;
    const upHit = bar.high >= up;
    const downHit = bar.low <= down;
    if (upHit && downHit) firstTouch = "tie";
    else if (upHit) firstTouch = "up";
    else if (downHit) firstTouch = "down";
  }

  return {
    status,
    bars: window.length,
    horizon,
    entry,
    atr: round(atr, 6),
    mfe: round(mfe / atr, 2),
    mae: round(mae / atr, 2),
    first_touch: firstTouch,
    close_change_pct: closeChange,
  };
}
