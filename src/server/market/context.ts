// Deterministic 4H market context for one breakout event. Pure: bars in, facts
// out. The model only rewrites these values; it never derives them.
//
// Everything here is measured from bars that had CLOSED at the event timestamp,
// so a note can never cite a bar that formed after the break. Missing pieces are
// null rather than guessed, and the prose only uses rounded values that are also
// stored on the object so the groundedness lint can verify them.

import { adx, atr, ema } from "./indicators";
import { closedBars, H4_MS } from "./breakoutEngine";
import type { Candle } from "./types";

export const RANGE_BARS = 120;
export const ATR_PERCENTILE_BARS = 250;
export const VOLUME_AVG_BARS = 20;
export const TOUCH_LOOKBACK = 60;
export const TOUCH_ATR_TOL = 0.25;
export const TREND_ADX = 20;

/** What the 4H chart looked like at the break. All values are rounded for prose. */
export interface MarketContext {
  /** Hours per bar. Present so the lint can verify "4H". */
  bar_hours: number;
  /** Closed 4H bars available before the event. */
  bars: number;
  trend: "up" | "down" | "sideways" | null;
  /** ADX(14), one decimal. */
  adx: number | null;
  ema50: number | null;
  ema200: number | null;
  /** Close position inside the last RANGE_BARS bars, 0..1. */
  range_position: number | null;
  range_bars: number;
  /** How many times price came within TOUCH_ATR_TOL ATR of the level before the break. */
  level_touches: number | null;
  /** Bars between the most recent prior touch and the break bar. */
  level_age_bars: number | null;
  touch_lookback: number;
  /** ATR(14) at the break, in price units. */
  atr: number | null;
  /** ATR percentile over the last ATR_PERCENTILE_BARS bars, 0..1. */
  atr_percentile: number | null;
  atr_percentile_bars: number;
  /** Break-bar volume divided by the mean of the prior VOLUME_AVG_BARS bars. */
  volume_ratio: number | null;
  volume_avg_bars: number;
}

export interface ContextBreakout {
  level_price: number | null;
  break_price: number | null;
  break_atr_mult: number | null;
  level_type: string;
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Index of the bar whose close is the event timestamp. Falls back to the newest
 * bar that had closed at most one bar earlier, which covers a timestamp that is
 * slightly off the bar boundary without pretending a distant bar is the event.
 */
export function findEventBarIndex(bars: Candle[], timestampUtc: string): number {
  const eventMs = Date.parse(timestampUtc);
  if (!Number.isFinite(eventMs)) return -1;
  let fallback = -1;
  for (let i = 0; i < bars.length; i++) {
    const close = bars[i].time + H4_MS;
    if (close === eventMs) return i;
    if (close < eventMs && eventMs - close <= H4_MS) fallback = i;
  }
  return fallback;
}

/** ATR implied by the break distance, used when the context cannot supply one. */
export function atrFromBreak(b: ContextBreakout): number | null {
  if (b.level_price == null || b.break_price == null || b.break_atr_mult == null) return null;
  const mult = Math.abs(b.break_atr_mult);
  if (!Number.isFinite(mult) || mult <= 0) return null;
  const atr = Math.abs(b.break_price - b.level_price) / mult;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

function percentile(values: number[], value: number): number | null {
  if (!values.length) return null;
  let atOrBelow = 0;
  for (const v of values) if (v <= value) atOrBelow++;
  return atOrBelow / values.length;
}

/**
 * Build the context snapshot. Returns null when the event bar is not in `bars`
 * or there are too few closed bars to compute anything meaningful.
 */
export function buildMarketContext(
  bars: Candle[],
  b: ContextBreakout,
  timestampUtc: string
): MarketContext | null {
  const closed = closedBars(bars, H4_MS, Date.parse(timestampUtc));
  const i = findEventBarIndex(closed, timestampUtc);
  if (i < 0) return null;

  const closes = closed.map((c) => c.close);
  const atrS = atr(closed, 14);
  const adxS = adx(closed, 14).adx;
  const ema50S = ema(closes, 50);
  const ema200S = ema(closes, 200);
  const currentAtr = atrS[i];

  const rawAdx = adxS[i];
  const rawEma50 = ema50S[i];
  const rawEma200 = ema200S[i];
  const close = closed[i].close;

  let trend: MarketContext["trend"] = null;
  if (rawAdx != null && rawEma50 != null && rawEma200 != null) {
    trend = rawAdx < TREND_ADX ? "sideways" : rawEma50 > rawEma200 ? "up" : "down";
  }

  const rangeFrom = Math.max(0, i - RANGE_BARS + 1);
  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  for (let j = rangeFrom; j <= i; j++) {
    rangeHigh = Math.max(rangeHigh, closed[j].high);
    rangeLow = Math.min(rangeLow, closed[j].low);
  }
  const rangeSpan = rangeHigh - rangeLow;
  const rangePosition = rangeSpan > 0 ? clamp01((close - rangeLow) / rangeSpan) : null;

  let levelTouches: number | null = null;
  let levelAge: number | null = null;
  if (b.level_price != null && currentAtr != null && currentAtr > 0) {
    const tol = TOUCH_ATR_TOL * currentAtr;
    const from = Math.max(0, i - TOUCH_LOOKBACK);
    let touches = 0;
    let last = -1;
    for (let j = from; j < i; j++) {
      if (closed[j].low <= b.level_price + tol && closed[j].high >= b.level_price - tol) {
        touches++;
        last = j;
      }
    }
    levelTouches = touches;
    levelAge = last >= 0 ? i - last : null;
  }

  let atrPercentile: number | null = null;
  if (currentAtr != null) {
    const from = Math.max(0, i - ATR_PERCENTILE_BARS + 1);
    const values: number[] = [];
    for (let j = from; j <= i; j++) {
      const v = atrS[j];
      if (v != null) values.push(v);
    }
    const p = percentile(values, currentAtr);
    atrPercentile = p == null ? null : round(p, 2);
  }

  let volumeRatio: number | null = null;
  if (i >= VOLUME_AVG_BARS) {
    let sum = 0;
    for (let j = i - VOLUME_AVG_BARS; j < i; j++) sum += closed[j].volume;
    const avg = sum / VOLUME_AVG_BARS;
    if (avg > 0) volumeRatio = round(closed[i].volume / avg, 1);
  }

  return {
    bar_hours: 4,
    bars: i + 1,
    trend,
    adx: rawAdx == null ? null : round(rawAdx, 1),
    ema50: rawEma50 == null ? null : round(rawEma50, 4),
    ema200: rawEma200 == null ? null : round(rawEma200, 4),
    range_position: rangePosition == null ? null : round(rangePosition, 2),
    range_bars: i + 1 >= RANGE_BARS ? RANGE_BARS : i + 1,
    level_touches: levelTouches,
    level_age_bars: levelAge,
    touch_lookback: TOUCH_LOOKBACK,
    atr: currentAtr == null ? null : round(currentAtr, 6),
    atr_percentile: atrPercentile,
    atr_percentile_bars: ATR_PERCENTILE_BARS,
    volume_ratio: volumeRatio,
    volume_avg_bars: VOLUME_AVG_BARS,
  };
}

const pct = (x: number | null): string => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

const ordinal = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
};

/** Plain-English context facts. Every number here is also a field above. */
export function contextFacts(ctx: MarketContext): string[] {
  const facts: string[] = [];
  if (ctx.trend != null) {
    const adxText = ctx.adx == null ? "" : ` with ADX ${ctx.adx.toFixed(1)}`;
    const trendText = ctx.trend === "up" ? "an up trend" : ctx.trend === "down" ? "a down trend" : "a sideways trend";
    facts.push(`On 4H bars the backdrop was ${trendText}${adxText}.`);
  }
  if (ctx.range_position != null) {
    facts.push(`The break sat at ${pct(ctx.range_position)} of the ${ctx.range_bars}-bar range.`);
  }
  if (ctx.atr_percentile != null) {
    facts.push(
      `ATR was in the ${ordinal(Math.round(ctx.atr_percentile * 100))} percentile ` +
        `of the last ${ctx.atr_percentile_bars} bars.`
    );
  }
  if (ctx.level_touches != null) {
    const age = ctx.level_age_bars == null ? "" : `, most recently ${ctx.level_age_bars} bars before the break`;
    facts.push(`The level had been tested on ${ctx.level_touches} prior bars${age}.`);
  }
  if (ctx.volume_ratio != null) {
    facts.push(`Break-bar volume was ${ctx.volume_ratio.toFixed(1)}x the ${ctx.volume_avg_bars}-bar average.`);
  }
  return facts;
}
