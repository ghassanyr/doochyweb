// Candle patterns for the Analysis card. Kept out of the rating engine on
// purpose: a pattern is a badge, not a vote, so it must not move the dial.

import { getTimeframe } from "./timeframes";
import type { Candle } from "./types";

export type Engulfing = "bullish" | "bearish";

/** A 4H candle that took a prior extreme and closed back through it. */
export type Sweep = "high" | "low" | "both";

/** Closed bars whose extreme the sweep candle has to beat. */
const SWEEP_LOOKBACK = 5;

/** Patterns are noise below this. 1m, 3m and 5m are excluded. */
const MIN_MS = 15 * 60 * 1000;

/**
 * Classic body engulfing on the last CLOSED bar.
 *
 * The newest bar from both Binance and cTrader is still forming, so a pattern
 * printed on it can vanish before the bar closes. The check therefore compares
 * candles[length - 2] with candles[length - 3] and ignores the live bar.
 *
 * Bullish: prior bar red, current bar green, and the current body covers the
 * prior body (open at or below the prior close, close at or above the prior
 * open). Bearish is the mirror. Wicks are ignored. A doji (open === close) has
 * no direction, so either bar being a doji is not a match.
 */
export function detectEngulfing(candles: Candle[], timeframeId: string): Engulfing | null {
  if (getTimeframe(timeframeId).ms < MIN_MS) return null;
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const prior = candles[candles.length - 3];
  const current = candles[candles.length - 2];
  const priorBody = prior.close - prior.open;
  const currentBody = current.close - current.open;
  if (priorBody === 0 || currentBody === 0) return null;

  if (
    priorBody < 0 &&
    currentBody > 0 &&
    current.open <= prior.close &&
    current.close >= prior.open
  ) {
    return "bullish";
  }
  if (
    priorBody > 0 &&
    currentBody < 0 &&
    current.open >= prior.close &&
    current.close <= prior.open
  ) {
    return "bearish";
  }
  return null;
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
export function detectSweep(candles: Candle[]): Sweep | null {
  if (!Array.isArray(candles) || candles.length < SWEEP_LOOKBACK + 2) return null;
  const sweep = candles[candles.length - 2];
  const ref = candles.slice(candles.length - 2 - SWEEP_LOOKBACK, candles.length - 2);
  const refHigh = Math.max(...ref.map((c) => c.high));
  const refLow = Math.min(...ref.map((c) => c.low));
  const high = sweep.high > refHigh && sweep.close < refHigh;
  const low = sweep.low < refLow && sweep.close > refLow;
  if (high && low) return "both";
  if (high) return "high";
  if (low) return "low";
  return null;
}
