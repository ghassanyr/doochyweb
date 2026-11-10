// Weighted multi-timeframe confluence for the Analysis cards. The card's main
// rating is for the selected timeframe only; this helper folds every timeframe
// into one verdict so the ribbon can summarise the whole stack before the card
// is opened.
//
// The weights are deliberately tiered: shorter timeframes react fast but carry
// less conviction, so they move the score less than the daily/weekly/monthly
// bars. They are fixed for this pass (not adaptive).

import { RATINGS } from "./ratings";
import { timeframes } from "./timeframes";
import type { Rating, TimeframeRating } from "./types";

export const CONFLUENCE_WEIGHTS: Record<string, number> = {
  "1m": 0.5,
  "3m": 0.6,
  "5m": 0.7,
  "15m": 0.9,
  "30m": 1.0,
  "1h": 1.1,
  "4h": 1.3,
  "1d": 1.6,
  "1w": 1.8,
  "1M": 2.0,
};

const RATING_VALUES: Record<Rating, number> = {
  strong_sell: -1.0,
  sell: -0.5,
  neutral: 0,
  buy: 0.5,
  strong_buy: 1.0,
};

export interface ConfluenceSegment {
  id: string;
  weight: number;
  /** Null when the timeframe is missing or failed. */
  rating: Rating | null;
  available: boolean;
  error: boolean;
  selected: boolean;
}

export interface ConfluenceSummary {
  /** Weighted score in [-1, 1], normalised over available timeframes. */
  score: number;
  rating: Rating;
  /** Display verdict. "Mixed" is a label, never a Rating. */
  label: string;
  mixed: boolean;
  available: number;
  bullish: number;
  bearish: number;
  neutral: number;
  /** Timeframes on the dominant side. */
  aligned: number;
  segments: ConfluenceSegment[];
}

function isBullish(rating: Rating): boolean {
  return rating === "buy" || rating === "strong_buy";
}

function isBearish(rating: Rating): boolean {
  return rating === "sell" || rating === "strong_sell";
}

/** Fold a per-timeframe rating map into one weighted verdict. */
export function computeConfluence(
  ratings: Record<string, TimeframeRating> | undefined,
  selected?: string
): ConfluenceSummary {
  const segments: ConfluenceSegment[] = timeframes.map((tf) => {
    const entry = ratings?.[tf.id];
    const rating = entry && !entry.error && entry.rating ? entry.rating : null;
    return {
      id: tf.id,
      weight: CONFLUENCE_WEIGHTS[tf.id] ?? 0,
      rating,
      available: rating !== null,
      error: Boolean(entry?.error),
      selected: tf.id === selected,
    };
  });

  let totalWeight = 0;
  let weighted = 0;
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const segment of segments) {
    if (!segment.available) continue;
    const rating = segment.rating as Rating;
    totalWeight += segment.weight;
    weighted += segment.weight * RATING_VALUES[rating];
    if (isBullish(rating)) bullish++;
    else if (isBearish(rating)) bearish++;
    else neutral++;
  }

  const available = bullish + bearish + neutral;
  const score = totalWeight > 0 ? weighted / totalWeight : 0;

  let rating: Rating;
  if (score <= -0.6) rating = "strong_sell";
  else if (score <= -0.2) rating = "sell";
  else if (score >= 0.6) rating = "strong_buy";
  else if (score >= 0.2) rating = "buy";
  else rating = "neutral";

  // Genuine conflict: both directions are present and the minority side is at
  // least a third of the decided timeframes. A neutral weighted score with
  // both directions present is always conflict, even if the count is lopsided.
  // All-neutral is not mixed.
  const decided = bullish + bearish;
  const minority = Math.min(bullish, bearish);
  const mixed =
    bullish > 0 &&
    bearish > 0 &&
    (rating === "neutral" || minority / decided >= 1 / 3);

  const aligned = decided === 0 ? available : Math.max(bullish, bearish);

  return {
    score,
    rating,
    label: mixed ? "Mixed" : RATINGS[rating].label,
    mixed,
    available,
    bullish,
    bearish,
    neutral,
    aligned,
    segments,
  };
}
