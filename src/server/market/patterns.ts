// Candle patterns for the Analysis card. Kept out of the rating engine on
// purpose: a pattern is a badge, not a vote, so it must not move the dial.

import { getTimeframe } from "./timeframes";
import { engulfingAt, type Engulfing } from "./engulf";
import type { Candle } from "./types";

export type { Engulfing };

/** A 4H candle that took a prior extreme and closed back through it. */
export type Sweep = "high" | "low" | "both";

/** Closed bars whose extreme the sweep candle has to beat. */
const SWEEP_LOOKBACK = 5;

/** Patterns are noise below this. 1m, 3m and 5m are excluded. */
const MIN_MS = 15 * 60 * 1000;

/** A match plus the bar it printed on. */
export interface EngulfingMatch {
  kind: Engulfing;
  /** Open time of the matched bar. */
  time: number;
  /** Close time of the matched bar (open time + timeframe). */
  closeTime: number;
}

/**
 * Engulfing on the last CLOSED bar, using the shared trainer definition in
 * engulf.ts (body cover + close clears the prior wick + body ratio >= 1.3).
 *
 * The newest bar from Binance is still forming, so a pattern printed on it can
 * vanish before the bar closes. The check therefore compares
 * candles[length - 2] with candles[length - 3] and ignores the live bar. A
 * cTrader series contains no forming bar, so there the last element is the bar
 * under test. `lastBarForming` selects between the two.
 *
 * Returns the matched bar's close time as well, so the UI can show when the
 * pattern actually printed instead of when the analysis was refreshed.
 */
export function detectEngulfingMatch(
  candles: Candle[],
  timeframeId: string,
  lastBarForming: boolean = true
): EngulfingMatch | null {
  const tf = getTimeframe(timeframeId);
  if (tf.ms < MIN_MS) return null;
  if (!Array.isArray(candles) || candles.length < 3) return null;
  // The bar under test is the last CLOSED one. When the last element is still forming
  // (Binance includes the live bar) that is length - 2; when it has closed (cTrader
  // series contain no forming bar) it is length - 1.
  const cur = lastBarForming ? candles.length - 2 : candles.length - 1;
  if (cur < 1) return null;
  const kind = engulfingAt(candles, cur);
  if (!kind) return null;
  const bar = candles[cur];
  return { kind, time: bar.time, closeTime: bar.time + tf.ms };
}

/** Direction-only wrapper for callers that do not need the bar timestamp. */
export function detectEngulfing(
  candles: Candle[],
  timeframeId: string,
  lastBarForming: boolean = true
): Engulfing | null {
  return detectEngulfingMatch(candles, timeframeId, lastBarForming)?.kind ?? null;
}

/**
 * Liquidity sweep on the last CLOSED bar.
 *
 * The wick must trade strictly beyond the highest high, or lowest low, of the
 * five closed bars before it, and the close must come back through that level.
 * Touching the level is not a sweep. The still-forming bar is ignored, same as
 * engulfing: a wick that has not closed can pull back inside before the bar ends.
 *
 * "high" is a failed break above. "low" is a failed break below. A single candle
 * can do both and still close back inside the prior range.
 */
export function detectSweep(candles: Candle[], lastBarForming: boolean = true): Sweep | null {
  const min = SWEEP_LOOKBACK + (lastBarForming ? 2 : 1);
  if (!Array.isArray(candles) || candles.length < min) return null;
  const end = lastBarForming ? candles.length - 1 : candles.length; // exclusive end of closed bars
  const sweep = candles[end - 1];
  const ref = candles.slice(end - 1 - SWEEP_LOOKBACK, end - 1);
  const refHigh = Math.max(...ref.map((c) => c.high));
  const refLow = Math.min(...ref.map((c) => c.low));
  const high = sweep.high > refHigh && sweep.close < refHigh;
  const low = sweep.low < refLow && sweep.close > refLow;
  if (high && low) return "both";
  if (high) return "high";
  if (low) return "low";
  return null;
}

/**
 * True when the newest bar is still forming at `now`. Bars are stamped by open time,
 * so a bar closes at time + tfMs. Use this to pick lastBarForming for a series.
 */
export function isLastBarForming(candles: Candle[], tfMs: number, now: number = Date.now()): boolean {
  if (!candles.length) return false;
  const last = candles[candles.length - 1];
  return last.time + tfMs > now;
}
