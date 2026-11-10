// Locked pilot configuration for the Doochy Learn trainer.
//
// These values are deliberately explicit: later phases (ingestion, scan, outcome
// and publish) must read them from here instead of re-declaring magic numbers.
// Pattern definitions live in docs/TRAINER_TAXONOMY.md.

import type { Tag, TagFamily, TrainerSymbol, TrainerTimeframe } from "./types";

export const SYMBOLS = ["BTC", "ETH", "SOL"] as const satisfies readonly TrainerSymbol[];

export const TIMEFRAMES = ["15m", "1h"] as const satisfies readonly TrainerTimeframe[];

/** Binance spot pair for each trainer symbol. */
export const BINANCE_PAIR: Record<TrainerSymbol, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
};

/** Two years of history to mine for candidates. */
export const HISTORY_DAYS = 730;

/** Triple-barrier width, k in `+/- k * ATR`. */
export const BARRIER_ATR_MULT = 1.0;

/** Triple-barrier time horizon, H bars. */
export const BARRIER_HORIZON = 20;

/** First published batch version. */
export const BATCH_VERSION = "v1";

/** Approximate number of curated items in the pilot batch. */
export const BATCH_TARGET = 50;

/** Maximum context bars shown before the cut (the cut bar is included). */
export const CONTEXT_MAX_BARS = 120;

/** Balance caps an over-represented outcome at this share of the batch. */
export const BALANCE_MAX_SHARE = 0.7;

/**
 * Maximum candidates kept per tag per series. Larger match sets are sampled
 * deterministically so the review CSV stays small and evenly spread in time.
 */
export const SCAN_CAP_PER_TAG_PER_SERIES = 10;

/** Prior bars used for the trainer sweep range extreme. */
export const SWEEP_LEVEL_LOOKBACK = 20;

/** Wick penetration beyond the swept range extreme, in ATR20 units. */
export const SWEEP_PENETRATION_ATR = 0.1;

/** Minimum current/prior body-size ratio for an engulfing match. */
export const ENGULF_MIN_BODY_RATIO = 1.3;

/** Close clearance beyond the prior wick, in ATR20 units. */
export const ENGULF_WICK_EPS_ATR = 0.1;

/** Mechanical pattern tags, grouped in taxonomy order. */
export const TAGS = [
  "bullish_engulfing",
  "bearish_engulfing",
  "sweep_up",
  "sweep_down",
  "sr_flip",
  "bos",
  "choch",
] as const satisfies readonly Tag[];

/** Tag-to-family mapping. Exhaustive by type: adding a tag forces an entry here. */
export const TAG_FAMILY: Record<Tag, TagFamily> = {
  bullish_engulfing: "candle",
  bearish_engulfing: "candle",
  sweep_up: "liquidity",
  sweep_down: "liquidity",
  sr_flip: "structure",
  bos: "structure",
  choch: "structure",
};
