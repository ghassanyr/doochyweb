// Pure target/stop resolution for automatic signal outcomes.
//
// The resolver watches price bars and decides whether a signal's target or stop
// was touched first. Keeping this pure (no I/O) makes the rule unit-testable and
// leaves the scheduler a thin loop around it.
//
// Only bars that STARTED at/after the signal was published are considered, so a
// bar's high/low can never include price action from before the idea existed.
// When a single bar touches both levels the stop wins: with only OHLC data the
// true order is unknowable, and assuming the loss is the honest choice.

import type { Candle } from "../market/types";
import type { SignalDirection } from "./types";

export type OutcomeStatus = "target_hit" | "stopped_out";

export interface OutcomeLevels {
  direction: SignalDirection;
  target: number;
  stop: number;
}

export interface Outcome {
  status: OutcomeStatus;
  /** Epoch ms of the bar that touched the level (its open). */
  at: number;
}

/**
 * First level touched across the bars that began at or after `since`.
 *
 * Returns null when neither level was touched, or when the bars do not cover the
 * signal's lifetime yet (the caller simply checks again on the next run).
 */
export function resolveOutcome(
  signal: OutcomeLevels,
  bars: Candle[],
  since: number
): Outcome | null {
  const buy = signal.direction === "buy";
  for (const bar of bars) {
    if (!Number.isFinite(bar.time) || bar.time < since) continue;
    const hitTarget = buy ? bar.high >= signal.target : bar.low <= signal.target;
    const hitStop = buy ? bar.low <= signal.stop : bar.high >= signal.stop;
    // Stop first on purpose: a bar that spans both levels is ambiguous.
    if (hitStop) return { status: "stopped_out", at: bar.time };
    if (hitTarget) return { status: "target_hit", at: bar.time };
  }
  return null;
}
