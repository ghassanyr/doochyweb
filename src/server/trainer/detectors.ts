// Pure pattern detectors for the trainer (Phase 2).
//
// Each detector takes a closed-bar series and an index, and returns a match or
// null. Definitions live in docs/TRAINER_TAXONOMY.md. Detectors never read past
// the supplied index, so the reveal window cannot influence validity.

import { ATR_PERIOD, MIN_PCT, SWING_LOOKBACK } from "../market/breakoutEngine";
import type { Candle } from "../market/types";
import {
  SWEEP_MIN_GAP,
  SWEEP_PENETRATION_ATR,
  SWEEP_SWING_LOOKBACK,
  TAG_FAMILY,
} from "./config";
import type {
  Candidate,
  Direction,
  PatternBounds,
  ReferenceLevels,
  Tag,
  TrainerSymbol,
  TrainerTimeframe,
} from "./types";

/** A match before the scanner attaches the series identity and stable id. */
export type DetectorMatch = Omit<Candidate, "id" | "symbol" | "timeframe">;

/** S/R retests and first-break checks use this gap limit, per the taxonomy. */
const RETEST_WINDOW = 60;

/**
 * Simple mean true range over `period` bars ending at `i`, identical to
 * meanTrueRange in breakoutEngine.ts. Needs `period + 1` closed bars.
 */
export function atrAt(
  bars: readonly Candle[],
  i: number,
  period: number = ATR_PERIOD
): number | null {
  if (!Number.isInteger(i) || i < period || i >= bars.length || period <= 0) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const b = bars[j];
    const pc = bars[j - 1].close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return sum / period;
}

/** Break threshold at `i`: max(0.2% of close, ATR20), per the taxonomy. */
export function thresholdAt(bars: readonly Candle[], i: number): number | null {
  const atr = atrAt(bars, i);
  if (atr === null) return null;
  return Math.max(bars[i].close * MIN_PCT, atr);
}

export function candidateId(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  tag: Tag,
  bounds: PatternBounds,
  direction: Direction | null
): string {
  return `${symbol}:${timeframe}:${tag}:${bounds.startIndex}-${bounds.endIndex}:${
    direction ?? "none"
  }`;
}

function levels(
  levelUpper: number | null = null,
  levelLower: number | null = null,
  neckline: number | null = null
): ReferenceLevels {
  return { levelUpper, levelLower, neckline };
}

function makeMatch(
  tag: Tag,
  direction: Direction | null,
  cutIndex: number,
  startIndex: number,
  endIndex: number,
  refs: ReferenceLevels,
  notes?: string
): DetectorMatch {
  return {
    tag,
    family: TAG_FAMILY[tag],
    direction,
    cutIndex,
    bounds: { startIndex, endIndex },
    levels: refs,
    notes,
  };
}

function validIndex(bars: readonly Candle[], i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < bars.length;
}

function isSwing(bars: readonly Candle[], side: "high" | "low", s: number, i: number): boolean {
  if (s < 2 || s + 2 > i || s + 2 >= bars.length + 1) return false;
  const v = (n: number) => (side === "high" ? bars[n].high : bars[n].low);
  return side === "high"
    ? v(s) > v(s - 2) && v(s) > v(s - 1) && v(s) > v(s + 1) && v(s) > v(s + 2)
    : v(s) < v(s - 2) && v(s) < v(s - 1) && v(s) < v(s + 1) && v(s) < v(s + 2);
}

/** Confirmed swing indices in the requested window, newest eligible at i-2. */
function swingIndices(
  bars: readonly Candle[],
  side: "high" | "low",
  i: number,
  lookback: number = SWING_LOOKBACK
): number[] {
  const from = Math.max(2, i - lookback + 1);
  const to = i - 2;
  const out: number[] = [];
  for (let s = from; s <= to; s++) {
    if (isSwing(bars, side, s, i)) out.push(s);
  }
  return out;
}

function latestSwing(
  bars: readonly Candle[],
  side: "high" | "low",
  i: number,
  lookback: number,
  minGap: number
): number | null {
  const swings = swingIndices(bars, side, i, lookback);
  for (let n = swings.length - 1; n >= 0; n--) {
    const s = swings[n];
    if (i - s >= minGap) return s;
  }
  return null;
}

// ---------------------------------------------------------------- candles

export function detectBullishEngulfing(
  bars: readonly Candle[],
  i: number
): DetectorMatch | null {
  if (!validIndex(bars, i) || i < 1) return null;
  const p = i - 1;
  const prior = bars[p];
  const current = bars[i];
  const priorBody = prior.close - prior.open;
  const currentBody = current.close - current.open;
  if (priorBody === 0 || currentBody === 0) return null;

  if (
    priorBody < 0 &&
    currentBody > 0 &&
    current.open <= prior.close &&
    current.close >= prior.open
  ) {
    return makeMatch("bullish_engulfing", "up", i, p, i, levels());
  }
  return null;
}

export function detectBearishEngulfing(
  bars: readonly Candle[],
  i: number
): DetectorMatch | null {
  if (!validIndex(bars, i) || i < 1) return null;
  const p = i - 1;
  const prior = bars[p];
  const current = bars[i];
  const priorBody = prior.close - prior.open;
  const currentBody = current.close - current.open;
  if (priorBody === 0 || currentBody === 0) return null;

  if (
    priorBody > 0 &&
    currentBody < 0 &&
    current.open >= prior.close &&
    current.close <= prior.open
  ) {
    return makeMatch("bearish_engulfing", "down", i, p, i, levels());
  }
  return null;
}

// ---------------------------------------------------------------- liquidity

export function detectSweepUp(bars: readonly Candle[], i: number): DetectorMatch | null {
  if (!validIndex(bars, i)) return null;
  const atr = atrAt(bars, i);
  if (atr === null) return null;

  const s = latestSwing(bars, "high", i, SWEEP_SWING_LOOKBACK, SWEEP_MIN_GAP);
  if (s === null) return null;

  const level = bars[s].high;
  const penetration = atr * SWEEP_PENETRATION_ATR;
  if (!isFirstBreak(bars, s, i, level, penetration, "up")) return null;

  const current = bars[i];
  if (current.high <= level + penetration) return null;
  if (current.close >= level) return null;
  if (current.close >= (current.high + current.low) / 2) return null;

  let low = Number.POSITIVE_INFINITY;
  for (let j = s; j <= i; j++) low = Math.min(low, bars[j].low);

  return makeMatch(
    "sweep_up",
    "down",
    i,
    s,
    i,
    levels(level, low),
    `swept swing high at index ${s}`
  );
}

export function detectSweepDown(bars: readonly Candle[], i: number): DetectorMatch | null {
  if (!validIndex(bars, i)) return null;
  const atr = atrAt(bars, i);
  if (atr === null) return null;

  const s = latestSwing(bars, "low", i, SWEEP_SWING_LOOKBACK, SWEEP_MIN_GAP);
  if (s === null) return null;

  const level = bars[s].low;
  const penetration = atr * SWEEP_PENETRATION_ATR;
  if (!isFirstBreak(bars, s, i, level, penetration, "down")) return null;

  const current = bars[i];
  if (current.low >= level - penetration) return null;
  if (current.close <= level) return null;
  if (current.close <= (current.high + current.low) / 2) return null;

  let high = Number.NEGATIVE_INFINITY;
  for (let j = s; j <= i; j++) high = Math.max(high, bars[j].high);

  return makeMatch(
    "sweep_down",
    "up",
    i,
    s,
    i,
    levels(high, level),
    `swept swing low at index ${s}`
  );
}

// ---------------------------------------------------------------- structure

function isFirstBreak(
  bars: readonly Candle[],
  fromIndex: number,
  i: number,
  level: number,
  thr: number,
  direction: Direction
): boolean {
  for (let j = fromIndex + 1; j < i; j++) {
    const broke =
      direction === "up" ? bars[j].close > level + thr : bars[j].close < level - thr;
    if (broke) return false;
  }
  return true;
}

function detectSrFlipDirection(
  bars: readonly Candle[],
  i: number,
  direction: Direction
): DetectorMatch | null {
  if (!validIndex(bars, i) || i < 2) return null;
  const atr = atrAt(bars, i);
  if (atr === null) return null;
  const thr = Math.max(bars[i].close * MIN_PCT, atr);
  const swings = swingIndices(bars, direction === "up" ? "high" : "low", i);

  for (let n = swings.length - 1; n >= 0; n--) {
    const s = swings[n];
    const level = direction === "up" ? bars[s].high : bars[s].low;

    let breakIndex = -1;
    for (let k = s + 1; k < i; k++) {
      const kthr = thresholdAt(bars, k);
      if (kthr === null) continue;
      const broke =
        direction === "up" ? bars[k].close > level + kthr : bars[k].close < level - kthr;
      if (broke) {
        breakIndex = k;
        break;
      }
    }
    if (breakIndex < 0 || i - breakIndex > RETEST_WINDOW) continue;

    let invalid = false;
    for (let j = breakIndex; j <= i; j++) {
      const failed =
        direction === "up" ? bars[j].close < level - thr : bars[j].close > level + thr;
      if (failed) {
        invalid = true;
        break;
      }
    }
    if (invalid) continue;

    let earlierRetest = false;
    for (let j = breakIndex + 1; j < i; j++) {
      const touched = bars[j].low <= level && level <= bars[j].high;
      const held = direction === "up" ? bars[j].close > level : bars[j].close < level;
      if (touched && held) {
        earlierRetest = true;
        break;
      }
    }
    if (earlierRetest) continue;

    const touched = bars[i].low <= level && level <= bars[i].high;
    const held = direction === "up" ? bars[i].close > level : bars[i].close < level;
    if (!touched || !held) continue;

    return makeMatch(
      "sr_flip",
      direction,
      i,
      s,
      i,
      direction === "up" ? levels(null, level, null) : levels(level, null, null)
    );
  }
  return null;
}

/** S/R flip, bullish first then bearish. */
export function detectSrFlip(bars: readonly Candle[], i: number): DetectorMatch | null {
  return (
    detectSrFlipDirection(bars, i, "up") ?? detectSrFlipDirection(bars, i, "down")
  );
}

export interface Trend {
  up: boolean;
  down: boolean;
  h1: number;
  h2: number;
  l1: number;
  l2: number;
}

export function readTrend(bars: readonly Candle[], i: number): Trend | null {
  const highs = swingIndices(bars, "high", i);
  const lows = swingIndices(bars, "low", i);
  if (highs.length < 2 || lows.length < 2) return null;

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  return {
    up: bars[h2].high > bars[h1].high && bars[l2].low > bars[l1].low,
    down: bars[h2].high < bars[h1].high && bars[l2].low < bars[l1].low,
    h1,
    h2,
    l1,
    l2,
  };
}

export function detectBos(bars: readonly Candle[], i: number): DetectorMatch | null {
  if (!validIndex(bars, i)) return null;
  const thr = thresholdAt(bars, i);
  const trend = readTrend(bars, i);
  if (thr === null || !trend) return null;

  if (trend.up) {
    const level = bars[trend.h2].high;
    if (
      bars[i].close > level + thr &&
      isFirstBreak(bars, trend.h2, i, level, thr, "up")
    ) {
      return makeMatch("bos", "up", i, trend.h2, i, levels(level, null, null));
    }
  }

  if (trend.down) {
    const level = bars[trend.l2].low;
    if (
      bars[i].close < level - thr &&
      isFirstBreak(bars, trend.l2, i, level, thr, "down")
    ) {
      return makeMatch("bos", "down", i, trend.l2, i, levels(null, level, null));
    }
  }
  return null;
}

export function detectChoch(bars: readonly Candle[], i: number): DetectorMatch | null {
  if (!validIndex(bars, i)) return null;
  const thr = thresholdAt(bars, i);
  const trend = readTrend(bars, i);
  if (thr === null || !trend) return null;

  if (trend.up) {
    const level = bars[trend.l2].low;
    if (
      bars[i].close < level - thr &&
      isFirstBreak(bars, trend.l2, i, level, thr, "down")
    ) {
      return makeMatch("choch", "down", i, trend.l2, i, levels(null, level, null));
    }
  }

  if (trend.down) {
    const level = bars[trend.h2].high;
    if (
      bars[i].close > level + thr &&
      isFirstBreak(bars, trend.h2, i, level, thr, "up")
    ) {
      return makeMatch("choch", "up", i, trend.h2, i, levels(level, null, null));
    }
  }
  return null;
}

// ---------------------------------------------------------------- aggregate

/** Run every detector at `index`; a bar may produce more than one tag. */
export function detectAll(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[],
  index: number
): Candidate[] {
  const matches = [
    detectBullishEngulfing(bars, index),
    detectBearishEngulfing(bars, index),
    detectSweepUp(bars, index),
    detectSweepDown(bars, index),
    detectSrFlip(bars, index),
    detectBos(bars, index),
    detectChoch(bars, index),
  ];

  const out: Candidate[] = [];
  for (const match of matches) {
    if (!match) continue;
    out.push({
      id: candidateId(symbol, timeframe, match.tag, match.bounds, match.direction),
      symbol,
      timeframe,
      ...match,
    });
  }
  return out;
}
