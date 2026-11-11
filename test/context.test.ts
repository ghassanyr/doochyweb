import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { H4_MS } from "../src/server/market/breakoutEngine";
import {
  ATR_PERCENTILE_BARS, RANGE_BARS, atrFromBreak, buildMarketContext, contextFacts,
  findEventBarIndex,
} from "../src/server/market/context";
import type { Candle } from "../src/server/market/types";

const START = Date.UTC(2026, 0, 1);
const bar = (i: number, close: number, spread = 0.5, volume = 1000): Candle => ({
  time: START + i * H4_MS,
  open: close - 0.1,
  high: close + spread,
  low: close - spread,
  close,
  volume,
});
const rising = (n: number): Candle[] => Array.from({ length: n }, (_, i) => bar(i, 100 + i * 0.1));
const at = (i: number): string => new Date(START + i * H4_MS + H4_MS).toISOString();

const breakout = {
  level_price: 124.9,
  break_price: 125,
  break_atr_mult: 1,
  level_type: "swing_high",
};

describe("event bar lookup", () => {
  test("finds the bar whose close is the event timestamp", () => {
    const bars = rising(10);
    assert.equal(findEventBarIndex(bars, at(4)), 4);
  });

  test("falls back to the newest bar closed by the timestamp", () => {
    const bars = rising(10);
    const between = new Date(Date.parse(at(4)) + 60_000).toISOString();
    assert.equal(findEventBarIndex(bars, between), 4);
  });

  test("returns -1 before the first close", () => {
    assert.equal(findEventBarIndex(rising(3), at(-1)), -1);
  });
});

describe("ATR from the break distance", () => {
  test("divides the break gap by the ATR multiple", () => {
    assert.equal(atrFromBreak({ level_price: 100, break_price: 103, break_atr_mult: 1.5, level_type: "x" }), 2);
  });

  test("returns null for a missing or zero multiple", () => {
    assert.equal(atrFromBreak({ level_price: 100, break_price: 103, break_atr_mult: 0, level_type: "x" }), null);
    assert.equal(atrFromBreak({ level_price: null, break_price: 103, break_atr_mult: 1, level_type: "x" }), null);
  });
});

describe("market context", () => {
  test("reads the trend, range position and volatility at the break", () => {
    const bars = rising(ATR_PERCENTILE_BARS + 20);
    const ctx = buildMarketContext(bars, breakout, at(250));
    assert.ok(ctx);
    assert.equal(ctx!.trend, "up");
    assert.equal(ctx!.bar_hours, 4);
    assert.equal(ctx!.range_bars, RANGE_BARS);
    assert.ok(ctx!.range_position != null && ctx!.range_position > 0.95);
    assert.ok(ctx!.adx != null && ctx!.adx > 20);
    assert.ok(ctx!.atr != null && ctx!.atr > 0);
    assert.ok(ctx!.atr_percentile != null && ctx!.atr_percentile >= 0 && ctx!.atr_percentile <= 1);
    assert.ok(ctx!.volume_ratio != null);
  });

  test("counts prior level tests and their age", () => {
    // Flat bars far below the level, with three explicit wicks up to it.
    const flat = (i: number): Candle => ({ time: START + i * H4_MS, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 });
    const bars = Array.from({ length: 80 }, (_, i) => flat(i));
    for (const i of [70, 72, 75]) bars[i] = { ...bars[i], high: 105.1 };
    const ctx = buildMarketContext(bars, { ...breakout, level_price: 105, break_price: 105.1 }, at(79));
    assert.ok(ctx);
    assert.equal(ctx!.level_touches, 3);
    assert.equal(ctx!.level_age_bars, 4);
  });

  test("does not look at bars after the event", () => {
    const bars = rising(300);
    const before = buildMarketContext(bars, breakout, at(250));
    const changed = bars.map((b, i) => (i > 250 ? { ...b, close: 1, high: 2, low: 0, volume: 99_999 } : b));
    const after = buildMarketContext(changed, breakout, at(250));
    assert.deepEqual(after, before);
  });

  test("returns null when the event bar is missing", () => {
    assert.equal(buildMarketContext(rising(10), breakout, at(50)), null);
  });

  test("context facts use only values stored on the context", () => {
    const ctx = buildMarketContext(rising(300), breakout, at(250));
    assert.ok(ctx);
    const facts = contextFacts(ctx!);
    assert.ok(facts.some((f) => f.includes("4H bars")));
    assert.ok(facts.some((f) => f.includes("120-bar range")));
    assert.ok(facts.some((f) => f.includes("percentile")));
    assert.ok(facts.some((f) => f.includes("Break-bar volume")));
  });
});
