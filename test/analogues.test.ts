import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildRows, H4_MS, HORIZON, searchAnalogues, WARMUP } from "../src/server/market/analogues";
import type { Candle } from "../src/server/market/types";

// Deterministic pseudo-random walk, so tests are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walk(n: number, seed = 7): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = o + (r() - 0.5) * 2;
    const h = Math.max(o, c) + r() * 0.8;
    const l = Math.min(o, c) - r() * 0.8;
    out.push({ time: i * H4_MS, open: o, high: h, low: l, close: c, volume: 100 + r() * 50 });
    p = c;
  }
  return out;
}

describe("outcome classification", () => {
  // Flat bars at 100 with range 1, then we shape the bars after the signal bar.
  function flat(n: number): Candle[] {
    return Array.from({ length: n }, (_, i) => ({ time: i * H4_MS, open: 100, high: 100.5, low: 99.5, close: 100, volume: 100 }));
  }

  test("up_first when the high touches +ATR before the low touches -ATR", () => {
    const bars = flat(WARMUP + 20);
    const i = WARMUP + 5;
    bars[i + 2] = { ...bars[i + 2], high: 102 };
    const { rows } = buildRows(bars);
    const r = rows[i]!;
    assert.equal(r.outcome, "up_first");
    assert.ok(Math.abs(r.mfe - (102 - 100) / r.atr) < 1e-9);
  });

  test("down_first when the low touches -ATR first", () => {
    const bars = flat(WARMUP + 20);
    const i = WARMUP + 5;
    bars[i + 1] = { ...bars[i + 1], low: 98 };
    bars[i + 3] = { ...bars[i + 3], high: 102 };
    const r = buildRows(bars).rows[i]!;
    assert.equal(r.outcome, "down_first");
  });

  test("tie when one bar touches both levels", () => {
    const bars = flat(WARMUP + 20);
    const i = WARMUP + 5;
    bars[i + 2] = { ...bars[i + 2], high: 102, low: 98 };
    assert.equal(buildRows(bars).rows[i]!.outcome, "tie");
  });

  test("neither when no level is touched within the horizon", () => {
    const bars = flat(WARMUP + 20);
    assert.equal(buildRows(bars).rows[WARMUP + 5]!.outcome, "neither");
  });

  test("the outcome window never extends past the horizon", () => {
    const bars = flat(WARMUP + 20);
    const i = WARMUP + 5;
    bars[i + HORIZON + 1] = { ...bars[i + HORIZON + 1], high: 150 };
    assert.equal(buildRows(bars).rows[i]!.outcome, "neither");
  });
});

describe("search", () => {
  const bars = walk(400);
  const asOf = bars[bars.length - 1].time + H4_MS; // the last bar is closed exactly here

  test("returns k matches sorted by distance, with a base rate", () => {
    const res = searchAnalogues(bars, asOf, 15);
    assert.equal(res.matches.length, 15);
    for (let j = 1; j < res.matches.length; j++) {
      assert.ok(res.matches[j].distance >= res.matches[j - 1].distance);
    }
    assert.ok(res.baseRate.n >= res.matchSummary.n);
    assert.equal(res.matchSplit.train + res.matchSplit.test, res.matches.length);
  });

  test("is deterministic for the same input", () => {
    const a = searchAnalogues(bars, asOf, 10);
    const b = searchAnalogues(bars, asOf, 10);
    assert.deepEqual(a, b);
  });

  test("no lookahead: changing bars after asOf does not change the answer", () => {
    const base = searchAnalogues(bars, asOf, 10);
    const future = [
      ...bars,
      ...walk(30, 99).map((b, j) => ({ ...b, time: bars[bars.length - 1].time + (j + 1) * H4_MS, open: 500, high: 900, low: 10, close: 700, volume: 1e9 })),
    ];
    const after = searchAnalogues(future, asOf, 10);
    assert.deepEqual(after, base);
  });

  test("a bar that closes after asOf is ignored entirely", () => {
    const base = searchAnalogues(bars, asOf, 10);
    const withOpenBar = [...bars, { time: asOf - 1, open: 1, high: 999, low: 0, close: 1, volume: 1 }];
    assert.deepEqual(searchAnalogues(withOpenBar, asOf, 10), base);
  });

  test("throws on too little history rather than guessing", () => {
    assert.throws(() => searchAnalogues(walk(20), asOf, 5), /need more closed 4H bars/);
  });
});

import { wilson } from "../src/server/market/analogues";
describe("wilson interval", () => {
  test("is wide for small samples and narrow for large ones", () => {
    const small = wilson(8, 20)!;
    const large = wilson(800, 2000)!;
    assert.ok(small[1] - small[0] > 0.35);
    assert.ok(large[1] - large[0] < 0.05);
    assert.ok(small[0] < 0.4 && small[1] > 0.4);
  });
  test("null for an empty sample", () => assert.equal(wilson(0, 0), null));
});
