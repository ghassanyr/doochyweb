// Mechanical triple-barrier outcomes for the trainer (Phase 4).
//
// A cut bar supplies the entry price and the ATR used to size the barriers. The
// reveal window is strictly `(cut, cut + H]`; nothing before the cut can resolve
// an outcome and nothing after the horizon is read. MFE/MAE use the whole reveal
// window even when a barrier resolves early, matching the triple-barrier idea.
//
// This module is pure: callers pass real bars and get numbers back. No I/O, no
// clock reads and no hand-labelled outcomes.

import type { Candle } from "../market/types";
import {
  BARRIER_ATR_MULT,
  BARRIER_HORIZON,
  CONTEXT_MAX_BARS,
} from "./config";
import { atrAt } from "./detectors";
import type { Barrier, Outcome, OutcomeResult } from "./types";

/** ATR period used to size the barriers, per the taxonomy. */
export const BARRIER_ATR_PERIOD = 20;

/**
 * Build the triple-barrier levels for a cut. The reveal window must fit inside
 * the supplied series; otherwise the caller is asking for a future that does
 * not exist.
 */
export function barrierFor(bars: readonly Candle[], cutIndex: number): Barrier {
  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= bars.length) {
    throw new Error(`cutIndex ${cutIndex} is outside the series`);
  }

  const endIndex = cutIndex + BARRIER_HORIZON;
  if (endIndex >= bars.length) {
    throw new Error(
      `cutIndex ${cutIndex} + horizon ${BARRIER_HORIZON} reaches ${endIndex}, past the last bar ${bars.length - 1}`
    );
  }

  const atr = atrAt(bars, cutIndex, BARRIER_ATR_PERIOD);
  if (atr === null) {
    throw new Error(
      `cutIndex ${cutIndex} has no ATR(${BARRIER_ATR_PERIOD}); at least ${
        BARRIER_ATR_PERIOD + 1
      } bars of context are required`
    );
  }
  if (!(atr > 0) || !Number.isFinite(atr)) {
    throw new Error(`cutIndex ${cutIndex} has non-positive ATR ${atr}`);
  }

  const entry = bars[cutIndex].close;
  return {
    cutIndex,
    endIndex,
    entry,
    upper: entry + BARRIER_ATR_MULT * atr,
    lower: entry - BARRIER_ATR_MULT * atr,
    atr,
    atrMult: BARRIER_ATR_MULT,
    horizon: BARRIER_HORIZON,
  };
}

/**
 * Resolve the outcome and excursions over `(cut, endIndex]`.
 *
 * When one bar touches both barriers the intrabar order is unknowable, so the
 * barrier nearer that bar's open wins. An exact tie is a scratch and sets
 * `ambiguousSameBar`; the flag also marks same-bar resolutions with a winner so
 * downstream consumers can filter them if they prefer.
 */
export function computeOutcome(
  bars: readonly Candle[],
  barrier: Barrier
): OutcomeResult {
  const { cutIndex, endIndex, entry, upper, lower, atr, atrMult, horizon } = barrier;

  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= bars.length) {
    throw new Error(`cutIndex ${cutIndex} is outside the series`);
  }
  if (!Number.isInteger(endIndex) || endIndex <= cutIndex || endIndex >= bars.length) {
    throw new Error(
      `reveal window (${cutIndex}, ${endIndex}] is outside the series of ${bars.length} bars`
    );
  }
  if (!Number.isInteger(horizon) || horizon <= 0) {
    throw new Error(`horizon ${horizon} must be a positive integer`);
  }
  if (!(atr > 0) || !Number.isFinite(atr)) {
    throw new Error(`ATR ${atr} must be finite and positive`);
  }
  if (!(atrMult > 0) || !Number.isFinite(atrMult)) {
    throw new Error(`ATR multiplier ${atrMult} must be finite and positive`);
  }

  let outcome: Outcome = "scratch";
  let outcomeIndex: number | null = null;
  let ambiguousSameBar = false;
  let maxHigh = -Infinity;
  let minLow = Infinity;

  for (let i = cutIndex + 1; i <= endIndex; i++) {
    const bar = bars[i];
    if (bar.high > maxHigh) maxHigh = bar.high;
    if (bar.low < minLow) minLow = bar.low;

    if (outcomeIndex !== null) continue;

    const upperHit = bar.high >= upper;
    const lowerHit = bar.low <= lower;
    if (!upperHit && !lowerHit) continue;

    outcomeIndex = i;
    if (upperHit && lowerHit) {
      ambiguousSameBar = true;
      const upperDistance = Math.abs(upper - bar.open);
      const lowerDistance = Math.abs(bar.open - lower);
      if (upperDistance < lowerDistance) outcome = "up";
      else if (lowerDistance < upperDistance) outcome = "down";
      else outcome = "scratch";
    } else {
      outcome = upperHit ? "up" : "down";
    }
  }

  const mfeAtr = Math.max(0, (maxHigh - entry) / atr);
  const maeAtr = Math.max(0, (entry - minLow) / atr);

  return {
    outcome,
    outcomeIndex,
    mfeAtr,
    maeAtr,
    mfeR: mfeAtr / atrMult,
    maeR: maeAtr / atrMult,
    ambiguousSameBar,
  };
}

/**
 * Context slice ending at the cut, inclusive. The default keeps at most 120
 * bars; the first published bar is clamped when the cut is near the start.
 */
export function contextBars(
  bars: readonly Candle[],
  cutIndex: number,
  maxContext: number = CONTEXT_MAX_BARS
): Candle[] {
  if (!Number.isInteger(cutIndex) || cutIndex < 0 || cutIndex >= bars.length) {
    throw new Error(`cutIndex ${cutIndex} is outside the series`);
  }
  if (!Number.isInteger(maxContext) || maxContext <= 0) {
    throw new Error(`maxContext ${maxContext} must be a positive integer`);
  }

  const start = Math.max(0, cutIndex - (maxContext - 1));
  const out = bars.slice(start, cutIndex + 1);

  // A defensive index check: the slice must never include a bar after the cut.
  if (start + out.length - 1 > cutIndex) {
    throw new Error(
      `context leak: slice ends at ${start + out.length - 1} but the cut is ${cutIndex}`
    );
  }
  return out;
}
