// The single engulfing definition, shared by the live Analysis badge and the
// trainer detectors. The trainer taxonomy (docs/TRAINER_TAXONOMY.md) is the
// source of truth: a body engulf must also clear the prior wick and expand the
// body by at least ENGULF_MIN_BODY_RATIO. Keeping the rule here means the two
// paths can never disagree about the same candle.

import { ATR_PERIOD } from "./breakoutEngine";
import type { Candle } from "./types";

export type Engulfing = "bullish" | "bearish";

/** Minimum current/prior body-size ratio for an engulfing match. */
export const ENGULF_MIN_BODY_RATIO = 1.3;

/** Close clearance beyond the prior wick, in ATR20 units. */
export const ENGULF_WICK_EPS_ATR = 0.1;

/**
 * Simple mean true range over `period` bars ending at `i`, identical to
 * meanTrueRange in breakoutEngine.ts. Needs `period + 1` closed bars.
 */
export function atrAt(
  bars: readonly Candle[],
  i: number,
  period: number = ATR_PERIOD
): number | null {
  if (!Number.isInteger(i) || i < period || i >= bars.length || period <= 0) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const b = bars[j];
    const pc = bars[j - 1].close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return sum / period;
}

/**
 * Engulfing at index `i`, which must be a CLOSED bar. Bullish: prior bar red,
 * current bar green, the current body covers the prior body, the current close
 * clears the prior high, and the current body is at least 1.3x the prior body.
 * Bearish is the mirror. Wicks on the current bar are irrelevant beyond that
 * close clearance; a doji on either bar is never a match.
 *
 * Returns null when there is not enough history for ATR20.
 */
export function engulfingAt(bars: readonly Candle[], i: number): Engulfing | null {
  if (!Number.isInteger(i) || i < 1 || i >= bars.length) return null;
  const atr = atrAt(bars, i);
  if (atr === null) return null;

  const prior = bars[i - 1];
  const current = bars[i];
  const priorBody = prior.close - prior.open;
  const currentBody = current.close - current.open;
  if (priorBody === 0 || currentBody === 0) return null;

  const bodyRatio = Math.abs(currentBody) / Math.abs(priorBody);
  if (bodyRatio < ENGULF_MIN_BODY_RATIO) return null;

  if (
    priorBody < 0 &&
    currentBody > 0 &&
    current.open <= prior.close &&
    current.close >= prior.open &&
    current.close >= prior.high - atr * ENGULF_WICK_EPS_ATR
  ) {
    return "bullish";
  }
  if (
    priorBody > 0 &&
    currentBody < 0 &&
    current.open >= prior.close &&
    current.close <= prior.open &&
    current.close <= prior.low + atr * ENGULF_WICK_EPS_ATR
  ) {
    return "bearish";
  }
  return null;
}
