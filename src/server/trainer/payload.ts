// Anonymous payloads for the public trainer API (Phase 5).
//
// Everything a client receives before answering is built here. Context bars stop
// at the cut and every price is expressed as a percentage move from the cut
// close; symbols, timeframes, timestamps and absolute prices never leave the
// server. Reveal adds only the `(cut, cut + H]` window plus outcome metadata.

import { createHmac, randomBytes } from "node:crypto";

import type { Candle } from "../market/types";
import type { Outcome, TrainerBatch, TrainerItem } from "./types";

/** Opaque client session id: URL-safe, 8-64 characters. */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

export const QUESTION_PROMPT =
  "Will price reach the upper barrier before the lower barrier?";

// Keyed hash, not a plain hash: internal ids are low-entropy, so an attacker
// could otherwise enumerate the known symbol/timeframe/tag/id space and match a
// token back to its identity. The key is shared by every request in this
// process; attempts are in memory, so a restart only invalidates live drills.
const ITEM_ID_KEY: string | Buffer =
  process.env.TRAINER_ITEM_SECRET || randomBytes(32);

/**
 * Opaque public item id. Internal ids encode symbol, timeframe and tag, so they
 * are keyed-hashed before leaving the server. The token is stable per item and
 * lets the routes map an answer/reveal request back to the stored item.
 */
export function publicItemId(itemId: string): string {
  return createHmac("sha256", ITEM_ID_KEY).update(itemId).digest("hex").slice(0, 24);
}

/** One context/reveal bar, normalized so identity and absolute price are gone. */
export interface NormalizedBar {
  /** Bar index relative to the cut (negative before it, positive after). */
  offset: number;
  /** Percent move from the cut close, 4dp. */
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume relative to the context's mean volume, 3dp. */
  volume: number;
}

export interface BarrierPercent {
  upperPct: number;
  lowerPct: number;
}

export interface TrainerQuestion {
  kind: "probability_and_trade";
  prompt: string;
  barrierPct: BarrierPercent;
}

/** Pre-answer payload. Contains no outcome, tag, symbol or absolute prices. */
export interface AnonymizedItem {
  itemId: string;
  question: TrainerQuestion;
  context: NormalizedBar[];
}

export interface RevealBaseRate {
  n: number;
  counts: Record<Outcome, number>;
  /** Frequencies in [0, 1] from the published batch. */
  rates: Record<Outcome, number>;
}

/** Post-answer payload. Adds only the reveal window and outcome metadata. */
export interface RevealedItem {
  itemId: string;
  reveal: NormalizedBar[];
  outcome: Outcome;
  /** Bars after the cut until resolution; null for a time-barrier scratch. */
  outcomeOffset: number | null;
  barrierPct: BarrierPercent;
  mfeAtr: number;
  maeAtr: number;
  mfeR: number;
  maeR: number;
  tag: TrainerItem["tag"];
  /** Pattern bounds relative to the cut. */
  bounds: { startOffset: number; endOffset: number };
  /** Reference levels as percent moves from the cut close; nulls preserved. */
  levels: {
    levelUpperPct: number | null;
    levelLowerPct: number | null;
    necklinePct: number | null;
  };
  why: string;
  baseRates: { tag: RevealBaseRate; all: RevealBaseRate };
}

/** Round to `decimals` places, normalizing negative zero to zero. */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) throw new Error(`cannot round non-finite value ${value}`);
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Percent move of `price` from `entry`, 4dp. */
export function pctFromEntry(price: number, entry: number): number {
  if (!Number.isFinite(entry) || !(entry > 0)) {
    throw new Error("entry must be finite and positive");
  }
  if (!Number.isFinite(price)) throw new Error(`price ${price} must be finite`);
  return round(((price / entry) - 1) * 100, 4);
}

/** Mean volume over an inclusive index range. */
export function meanVolume(
  bars: readonly Candle[],
  startIndex: number,
  endIndex: number
): number {
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex >= bars.length
  ) {
    throw new Error(
      `volume range ${startIndex}..${endIndex} is outside the series of ${bars.length} bars`
    );
  }

  let total = 0;
  for (let i = startIndex; i <= endIndex; i++) {
    const volume = bars[i].volume;
    total += Number.isFinite(volume) ? volume : 0;
  }
  return total / (endIndex - startIndex + 1);
}

/** Normalize one bar against the cut entry and the context mean volume. */
export function normalizeBar(
  bar: Candle,
  offset: number,
  entry: number,
  contextMeanVolume: number
): NormalizedBar {
  const volumeRatio =
    Number.isFinite(contextMeanVolume) && contextMeanVolume > 0
      ? round((Number.isFinite(bar.volume) ? bar.volume : 0) / contextMeanVolume, 3)
      : 0;

  return {
    offset,
    open: pctFromEntry(bar.open, entry),
    high: pctFromEntry(bar.high, entry),
    low: pctFromEntry(bar.low, entry),
    close: pctFromEntry(bar.close, entry),
    volume: volumeRatio,
  };
}

/** Normalize an inclusive bar range, keeping offsets relative to the cut. */
export function normalizeBars(
  bars: readonly Candle[],
  startIndex: number,
  endIndex: number,
  cutIndex: number,
  entry: number,
  contextMeanVolume: number
): NormalizedBar[] {
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex >= bars.length
  ) {
    throw new Error(
      `bar range ${startIndex}..${endIndex} is outside the series of ${bars.length} bars`
    );
  }

  const out: NormalizedBar[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    out.push(normalizeBar(bars[i], i - cutIndex, entry, contextMeanVolume));
  }
  return out;
}

function emptyOutcomeCounts(): Record<Outcome, number> {
  return { up: 0, down: 0, scratch: 0 };
}

function validateItemWindow(item: TrainerItem, bars: readonly Candle[]): number {
  if (
    !Number.isInteger(item.cutIndex) ||
    item.cutIndex < 0 ||
    item.cutIndex >= bars.length
  ) {
    throw new Error(`cutIndex ${item.cutIndex} is outside the series`);
  }
  if (
    !Number.isInteger(item.contextStartIndex) ||
    item.contextStartIndex < 0 ||
    item.contextStartIndex > item.cutIndex
  ) {
    throw new Error(
      `contextStartIndex ${item.contextStartIndex} is outside the context window`
    );
  }

  const entry = bars[item.cutIndex].close;
  if (!Number.isFinite(entry) || !(entry > 0)) {
    throw new Error("cut close must be finite and positive");
  }
  return entry;
}

function barrierPercent(item: TrainerItem, entry: number): BarrierPercent {
  return {
    upperPct: pctFromEntry(item.barrier.upper, entry),
    lowerPct: pctFromEntry(item.barrier.lower, entry),
  };
}

function baseRateFor(
  batch: TrainerBatch,
  key: string
): RevealBaseRate {
  const rawCounts = batch.baseRateCounts[key];
  const rawRates = batch.baseRates[key];
  const counts = rawCounts
    ? {
        up: Number(rawCounts.up) || 0,
        down: Number(rawCounts.down) || 0,
        scratch: Number(rawCounts.scratch) || 0,
      }
    : emptyOutcomeCounts();
  const rates = rawRates
    ? {
        up: Number(rawRates.up) || 0,
        down: Number(rawRates.down) || 0,
        scratch: Number(rawRates.scratch) || 0,
      }
    : emptyOutcomeCounts();

  return {
    n: counts.up + counts.down + counts.scratch,
    counts,
    rates,
  };
}

/**
 * Build the pre-answer payload. Only bars from `contextStartIndex` through the
 * cut are read; the returned object contains no identity or outcome fields.
 */
export function anonymizeItem(
  item: TrainerItem,
  bars: readonly Candle[]
): AnonymizedItem {
  const entry = validateItemWindow(item, bars);
  const contextMeanVolume = meanVolume(
    bars,
    item.contextStartIndex,
    item.cutIndex
  );

  return {
    itemId: publicItemId(item.id),
    question: {
      kind: "probability_and_trade",
      prompt: QUESTION_PROMPT,
      barrierPct: barrierPercent(item, entry),
    },
    context: normalizeBars(
      bars,
      item.contextStartIndex,
      item.cutIndex,
      item.cutIndex,
      entry,
      contextMeanVolume
    ),
  };
}

/**
 * Build the post-answer payload. Reads only `(cut, endIndex]`; the reveal window
 * may not extend past the stored series.
 */
export function revealItem(
  item: TrainerItem,
  bars: readonly Candle[],
  batch: TrainerBatch
): RevealedItem {
  const entry = validateItemWindow(item, bars);
  const endIndex = item.barrier.endIndex;
  if (
    !Number.isInteger(endIndex) ||
    endIndex <= item.cutIndex ||
    endIndex >= bars.length
  ) {
    throw new Error(
      `reveal window (${item.cutIndex}, ${endIndex}] is outside the series of ${bars.length} bars`
    );
  }

  const contextMeanVolume = meanVolume(
    bars,
    item.contextStartIndex,
    item.cutIndex
  );
  const outcomeOffset =
    item.outcomeIndex === null ? null : item.outcomeIndex - item.cutIndex;

  return {
    itemId: publicItemId(item.id),
    reveal: normalizeBars(
      bars,
      item.cutIndex + 1,
      endIndex,
      item.cutIndex,
      entry,
      contextMeanVolume
    ),
    outcome: item.outcome,
    outcomeOffset,
    barrierPct: barrierPercent(item, entry),
    mfeAtr: item.mfeAtr,
    maeAtr: item.maeAtr,
    mfeR: item.mfeR,
    maeR: item.maeR,
    tag: item.tag,
    bounds: {
      startOffset: item.bounds.startIndex - item.cutIndex,
      endOffset: item.bounds.endIndex - item.cutIndex,
    },
    levels: {
      levelUpperPct:
        item.levels.levelUpper === null
          ? null
          : pctFromEntry(item.levels.levelUpper, entry),
      levelLowerPct:
        item.levels.levelLower === null
          ? null
          : pctFromEntry(item.levels.levelLower, entry),
      necklinePct:
        item.levels.neckline === null
          ? null
          : pctFromEntry(item.levels.neckline, entry),
    },
    why: item.why,
    baseRates: {
      tag: baseRateFor(batch, item.tag),
      all: baseRateFor(batch, "all"),
    },
  };
}
