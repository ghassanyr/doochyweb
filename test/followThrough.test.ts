import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { H4_MS } from "../src/server/market/breakoutEngine";
import { measureSinceBreak } from "../src/server/market/followThrough";
import type { Candle } from "../src/server/market/types";

const START = Date.UTC(2026, 0, 1);
const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  time: START + i * H4_MS, open, high, low, close, volume: 1000,
});
const eventAt = (i: number): string => new Date(START + i * H4_MS + H4_MS).toISOString();

describe("since the break", () => {
  test("is pending until the next bar closes", () => {
    const sb = measureSinceBreak([bar(0, 100, 101, 99, 100)], eventAt(0), "above", 1);
    assert.equal(sb.status, "pending");
    assert.equal(sb.bars, 0);
    assert.equal(sb.entry, null);
  });

  test("reports favourable and adverse excursions in ATR units", () => {
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 100.5, 99.8, 100.2),
      bar(2, 100.2, 101.4, 99.9, 101.2),
    ];
    const sb = measureSinceBreak(bars, eventAt(0), "above", 1, 2);
    assert.equal(sb.status, "complete");
    assert.equal(sb.bars, 2);
    assert.equal(sb.entry, 100);
    assert.equal(sb.mfe, 1.4);
    assert.equal(sb.mae, 0.2);
    assert.equal(sb.first_touch, "up");
  });

  test("mirrors favourable and adverse for a support break", () => {
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 100.1, 98.8, 99),
      bar(2, 99, 99.2, 98.2, 98.4),
    ];
    const sb = measureSinceBreak(bars, eventAt(0), "below", 1, 2);
    assert.equal(sb.mfe, 1.8);
    assert.equal(sb.mae, 0.1);
    assert.equal(sb.first_touch, "down");
  });

  test("is in progress before the horizon is filled", () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 100.4, 99.7, 100.1)];
    const sb = measureSinceBreak(bars, eventAt(0), "above", 1, 6);
    assert.equal(sb.status, "in_progress");
    assert.equal(sb.bars, 1);
  });

  test("stops at the horizon and ignores later bars", () => {
    const bars = [
      bar(0, 100, 101, 99, 100),
      bar(1, 100, 100.2, 99.8, 100),
      bar(2, 100, 100.2, 99.8, 100),
      bar(3, 100, 110, 90, 100),
    ];
    const sb = measureSinceBreak(bars, eventAt(0), "above", 1, 2);
    assert.equal(sb.bars, 2);
    assert.equal(sb.mfe, 0.2);
    assert.equal(sb.first_touch, "neither");
  });

  test("reports a same-bar tie", () => {
    const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 101.5, 98.5, 100)];
    const sb = measureSinceBreak(bars, eventAt(0), "above", 1, 1);
    assert.equal(sb.first_touch, "tie");
  });
});
