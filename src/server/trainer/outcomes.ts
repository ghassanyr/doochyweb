// Triple-barrier outcome engine for the trainer (Phase 4).
//
// Resolves the upper, lower and time barriers from the cut bar using
// BARRIER_ATR_MULT and BARRIER_HORIZON, then reports the label plus MFE/MAE in
// ATR units. It only reads the reveal window (cutIndex, cutIndex + horizon].

import type { Candle } from "../market/types";
import type { Barrier, Outcome } from "./types";

/** Mechanical result of one barrier resolution. */
export interface OutcomeResult {
  outcome: Outcome;
  /** Bar index that resolved the item; null for a time-barrier scratch. */
  outcomeIndex: number | null;
  mfeAtr: number;
  maeAtr: number;
}

/** Resolve the barriers for one item. */
export function computeOutcome(
  bars: readonly Candle[],
  barrier: Barrier
): OutcomeResult {
  throw new Error("outcomes.ts: implemented in Phase 4");
}
