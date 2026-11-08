// Shared types for the Doochy Learn trainer.
//
// Everything here is pointer-based: candidates, review rows and published items
// refer to bars by index into the stored series. Bar arrays are never copied into
// these structures, so context and reveal windows stay auditable and leak-free.

/** Directional implication of a setup. Not the same as the realized outcome. */
export type Direction = "up" | "down";

/** Realized triple-barrier result at the cut bar. */
export type Outcome = "up" | "down" | "scratch";

/** Coarse grouping used to keep drills and base rates balanced. */
export type TagFamily = "candle" | "liquidity" | "reversal" | "structure";

/** Every mechanical pattern tag the pilot can mine. */
export type Tag =
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "inside_bar"
  | "outside_bar"
  | "sweep_up"
  | "sweep_down"
  | "double_top"
  | "double_bottom"
  | "sr_flip"
  | "bos"
  | "choch";

/** Locked pilot symbols. */
export type TrainerSymbol = "BTC" | "ETH" | "SOL";

/** Locked pilot timeframes. */
export type TrainerTimeframe = "15m" | "1h";

/** Inclusive bar-index span of a detected pattern. */
export interface PatternBounds {
  startIndex: number;
  endIndex: number;
}

/** Reference prices inferred by a detector. Missing levels are null. */
export interface ReferenceLevels {
  levelUpper: number | null;
  levelLower: number | null;
  neckline: number | null;
}

/** One detector hit before human review. */
export interface Candidate {
  id: string;
  symbol: TrainerSymbol;
  timeframe: TrainerTimeframe;
  /** Bar index of the proposed cut. Context ends here; reveal starts after it. */
  cutIndex: number;
  tag: Tag;
  family: TagFamily;
  direction: Direction | null;
  bounds: PatternBounds;
  levels: ReferenceLevels;
  notes?: string;
}

/** Human decision on a candidate. Blank status in the CSV means "pending". */
export type ReviewStatus = "pending" | "accept" | "reject";

/**
 * One row in the review CSV. Candidate identity and pattern bounds are
 * read-only; only status, ambiguity, cutIndex, levels and notes are editable.
 */
export interface ReviewRow {
  id: string;
  symbol: TrainerSymbol;
  timeframe: TrainerTimeframe;
  cutIndex: number;
  tag: Tag;
  family: TagFamily;
  direction: Direction | null;
  startIndex: number;
  endIndex: number;
  status: ReviewStatus;
  /** 1 = unambiguous, 5 = very ambiguous. Null for untouched pending rows. */
  ambiguity: number | null;
  levelUpper: number | null;
  levelLower: number | null;
  neckline: number | null;
  notes: string;
}

/** Mechanical triple-barrier result for one cut, including excursions. */
export interface OutcomeResult {
  outcome: Outcome;
  /** Bar index that resolved the outcome; null for a time-barrier scratch. */
  outcomeIndex: number | null;
  /** Maximum favourable excursion in ATR units (clamped at 0). */
  mfeAtr: number;
  /** Maximum adverse excursion in ATR units (clamped at 0). */
  maeAtr: number;
  /** MFE expressed in R multiples of the barrier width. */
  mfeR: number;
  /** MAE expressed in R multiples of the barrier width. */
  maeR: number;
  /** True when both barriers were touched on the resolving bar. */
  ambiguousSameBar: boolean;
}

/** Triple-barrier levels for one item, all anchored to the cut bar. */
export interface Barrier {
  /** Bar index of the cut; the reveal window starts after this bar. */
  cutIndex: number;
  /** Bar index where the time barrier expires (cutIndex + horizon). */
  endIndex: number;
  /** Cut close, the reference price for barrier sizing. */
  entry: number;
  /** Upper price barrier. */
  upper: number;
  /** Lower price barrier. */
  lower: number;
  /** ATR used to size the barriers. */
  atr: number;
  /** Multiplier k applied to ATR. */
  atrMult: number;
  /** Time barrier in bars (H). */
  horizon: number;
}

/** One labelled, publishable drill item. */
export interface TrainerItem {
  id: string;
  batchVersion: string;
  symbol: TrainerSymbol;
  timeframe: TrainerTimeframe;
  tag: Tag;
  family: TagFamily;
  direction: Direction | null;
  /** First bar index shown as context. */
  contextStartIndex: number;
  /** Last context/cut bar index. */
  cutIndex: number;
  bounds: PatternBounds;
  levels: ReferenceLevels;
  barrier: Barrier;
  outcome: Outcome;
  /** Bar index that resolved the item; null for a time-barrier scratch. */
  outcomeIndex: number | null;
  /** Maximum favourable excursion in ATR units from the cut close. */
  mfeAtr: number;
  /** Maximum adverse excursion in ATR units from the cut close. */
  maeAtr: number;
  /** MFE expressed in R multiples of the barrier width. */
  mfeR: number;
  /** MAE expressed in R multiples of the barrier width. */
  maeR: number;
  /** Short explainer shown after reveal. */
  why: string;
}

/** Immutable published batch. */
export interface TrainerBatch {
  version: string;
  createdAt: number;
  symbols: readonly TrainerSymbol[];
  timeframes: readonly TrainerTimeframe[];
  barrierAtrMult: number;
  barrierHorizon: number;
  /** Empirical outcome frequencies keyed by tag, plus "all". */
  baseRates: Record<string, Record<Outcome, number>>;
  /** Raw outcome counts backing `baseRates`, keyed by tag plus "all". */
  baseRateCounts: Record<string, Record<Outcome, number>>;
  items: TrainerItem[];
}
