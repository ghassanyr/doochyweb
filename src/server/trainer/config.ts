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

/**
 * Maximum candidates kept per tag per series. Larger match sets are sampled
 * deterministically so the review CSV stays small and evenly spread in time.
 */
export const SCAN_CAP_PER_TAG_PER_SERIES = 10;

/** Mechanical pattern tags, grouped in taxonomy order. */
export const TAGS = [
  "bullish_engulfing",
  "bearish_engulfing",
  "inside_bar",
  "outside_bar",
  "sweep_up",
  "sweep_down",
  "double_top",
  "double_bottom",
  "sr_flip",
  "bos",
  "choch",
] as const satisfies readonly Tag[];

/** Tag-to-family mapping. Exhaustive by type: adding a tag forces an entry here. */
export const TAG_FAMILY: Record<Tag, TagFamily> = {
  bullish_engulfing: "candle",
  bearish_engulfing: "candle",
  inside_bar: "candle",
  outside_bar: "candle",
  sweep_up: "liquidity",
  sweep_down: "liquidity",
  double_top: "reversal",
  double_bottom: "reversal",
  sr_flip: "structure",
  bos: "structure",
  choch: "structure",
};
