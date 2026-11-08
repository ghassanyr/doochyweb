// Pure pattern detectors for the trainer (Phase 2).
//
// Each detector takes a closed-bar series and an index, and returns a match or
// null. Definitions live in docs/TRAINER_TAXONOMY.md. Detectors never read past
// the supplied index, so the reveal window cannot influence validity.

import type { Candle } from "../market/types";
import type { Candidate, TrainerSymbol, TrainerTimeframe } from "./types";

/** Run every detector at `index` for one series. */
export function detectAll(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[],
  index: number
): Candidate[] {
  throw new Error("detectors.ts: implemented in Phase 2");
}
