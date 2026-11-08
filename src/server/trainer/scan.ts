// Historical scanner for the trainer (Phase 2).
//
// Walks every closed bar, runs the detectors, applies the context/horizon guards
// from docs/TRAINER_TAXONOMY.md, assigns stable ids, and emits the reviewable
// candidates CSV under data/trainer/candidates/.

import type { Candle } from "../market/types";
import type { Candidate, TrainerSymbol, TrainerTimeframe } from "./types";

/** Scan one stored series and return its valid candidates. */
export function scanHistory(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[]
): Candidate[] {
  throw new Error("scan.ts: implemented in Phase 2");
}
