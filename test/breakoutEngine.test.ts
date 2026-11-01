import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  H1_MS,
  H4_MS,
  closedBars,
  evaluateSymbol,
  meanTrueRange,
  sessionOf,
} from "../src/server/market/breakoutEngine";
import type { Candle } from "../src/server/market/types";

// ---- fixtures -----------------------------------------------------------

type Ov = Partial<Omit<Candle, "time">>;

/** n bars, default flat 100 with range 1. Overrides keyed by index. */
function series(n: number, tfMs: number, ov: Record<number, Ov> = {}, base = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const d: Candle = { time: i * tfMs, open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 100 };
    out.push({ ...d, ...(ov[i] ?? {}), time: i * tfMs });
  }
  return out;
}

const N4 = 40;
const SWING_IDX = 20;
const asOf = N4 * H4_MS; // last 4H bar (index N4-1) closes exactly here

/** 4H with a resistance swing at 102 and a break on the last bar to 104. */
function resistanceSetup(extra: Record<number, Ov> = {}, last1Ov: Ov = { close: 104, volume: 100 }) {
  const b4 = series(N4, H4_MS, {
    [SWING_IDX]: { high: 102, close: 100, open: 100 },
    [N4 - 1]: { open: 102.4, high: 104.2, low: 102.4, close: 104 },
    ...extra,
  });
  const b1 = series(N4 * 4, H1_MS, { [N4 * 4 - 1]: last1Ov });
  return { b4, b1 };
}

// ---- helpers ------------------------------------------------------------

describe("primitives", () => {
  test("meanTrueRange of a constant range-1 series is 1 after the first bar", () => {
    const b = series(30, H4_MS);
    assert.ok(Math.abs(meanTrueRange(b, 20)! - 1) < 1e-9);
  });

  test("closed bars: a bar counts as closed only at open + duration", () => {
    const b4 = series(5, H4_MS);
    // Bar 3 opens at 12h and closes at 16h.
    assert.equal(closedBars(b4, H4_MS, 4 * H4_MS).length, 4, "at 16h bar 3 has closed");
    assert.equal(closedBars(b4, H4_MS, 4 * H4_MS - 1).length, 3, "one ms earlier it has not");
  });

  test("sessions map by UTC hour and keep a stable key across the session", () => {
    const day = Date.UTC(2026, 0, 5);
    assert.equal(sessionOf(day + 23 * H1_MS).name, "tokyo");
    assert.equal(sessionOf(day + 6 * H1_MS).name, "tokyo");
    assert.equal(sessionOf(day + 8 * H1_MS).name, "london");
    assert.equal(sessionOf(day + 14 * H1_MS).name, "ny");
    assert.equal(sessionOf(day + 18 * H1_MS).name, "ny_afternoon");
    // Tokyo at 23:00 and 06:00 belong to the same session window.
    assert.equal(sessionOf(day + 23 * H1_MS).key, sessionOf(day + 30 * H1_MS).key);
    // Different sessions produce different keys.
    assert.notEqual(sessionOf(day + 8 * H1_MS).key, sessionOf(day + 14 * H1_MS).key);
  });
});

describe("resistance break", () => {
  test("fires on 4H break with 1H close confirmation", () => {
    const { b4, b1 } = resistanceSetup();
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.status, "evaluated");
    assert.equal(r.breakouts.length, 1);
    const b = r.breakouts[0];
    assert.equal(b.type, "resistance_break");
    assert.equal(b.level_type, "swing_high");
    assert.equal(b.level_price, 102);
    assert.equal(b.break_price, 104);
    assert.equal(b.confirmation, "1h_close");
    assert.equal(b.timestamp_utc, new Date(asOf).toISOString());
    assert.ok(b.break_atr_mult > 0);
  });

  test("1H volume alone confirms when the 1H close is inside the level", () => {
    const { b4, b1 } = resistanceSetup({}, { close: 101, volume: 300 });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.breakouts.length, 1);
    assert.equal(r.breakouts[0].confirmation, "1h_volume");
  });

  test("no confirmation: reported as awaiting, not fired", () => {
    const { b4, b1 } = resistanceSetup({}, { close: 101, volume: 100 });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.breakouts.length, 0);
    assert.equal(r.awaitingConfirmation.length, 1);
  });

  test("below threshold (0.2% or 1 ATR): no candidate", () => {
    // Break bar closes 102.5, only 0.5 above the level. ATR is about 1.1, so the threshold is larger.
    const { b4, b1 } = resistanceSetup({ [N4 - 1]: { open: 102.4, high: 102.6, low: 102.4, close: 102.5 } });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.candidates, 0);
    assert.equal(r.breakouts.length, 0);
  });

  test("freshness: a level already closed beyond earlier does not fire again", () => {
    const { b4, b1 } = resistanceSetup({ [N4 - 5]: { close: 103 } });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.candidates, 0);
    assert.equal(r.breakouts.length, 0);
  });

  test("sweep: a bar that pierced the level and closed back below rejects the break", () => {
    const { b4, b1 } = resistanceSetup({ [N4 - 3]: { open: 101, high: 103, low: 100.5, close: 101 } });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    assert.equal(r.sweepsRejected, 1);
    assert.equal(r.breakouts.length, 0);
  });

  test("dedup: an id already fired is not returned again", () => {
    const { b4, b1 } = resistanceSetup();
    const first = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    const again = evaluateSymbol("EURJPY", b4, b1, asOf, new Set([first.breakouts[0].id]));
    assert.equal(again.breakouts.length, 0);
  });
});

describe("one breakout per type per bar", () => {
  test("two swing highs broken in the same bar report only the nearest to the close", () => {
    const { b4, b1 } = resistanceSetup({ [SWING_IDX - 5]: { high: 101.5, close: 100, open: 100 } });
    const r = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    const res = r.breakouts.filter((b) => b.type === "resistance_break");
    assert.equal(res.length, 1);
    assert.equal(res[0].level_price, 102, "102 is nearer to the 104 close than 101.5");
  });
});

describe("support break", () => {
  test("mirror: support swing low broken down", () => {
    const b4 = series(N4, H4_MS, {
      [SWING_IDX]: { low: 98, close: 100, open: 100 },
      [N4 - 1]: { open: 97.6, high: 97.6, low: 95.8, close: 96 },
    });
    const b1 = series(N4 * 4, H1_MS, { [N4 * 4 - 1]: { close: 96, volume: 100 } });
    const r = evaluateSymbol("XAUUSD", b4, b1, asOf, new Set());
    assert.equal(r.breakouts.length, 1);
    assert.equal(r.breakouts[0].type, "support_break");
    assert.equal(r.breakouts[0].level_price, 98);
  });
});

describe("double top neckline break", () => {
  test("two tops 10 bars apart, neckline 97, close through it fires pattern_break", () => {
    const b4 = series(N4, H4_MS, {
      10: { high: 102, close: 100, open: 100 },
      20: { high: 102.1, close: 100, open: 100 },
      15: { low: 97, close: 99, open: 99, high: 99.5 },
      [N4 - 1]: { open: 97, high: 99, low: 94.5, close: 95 },
    });
    const b1 = series(N4 * 4, H1_MS, { [N4 * 4 - 1]: { close: 95, volume: 100 } });
    const r = evaluateSymbol("BTCUSD", b4, b1, asOf, new Set());
    const pat = r.breakouts.filter((b) => b.type === "pattern_break");
    assert.equal(pat.length, 1);
    assert.equal(pat[0].level_type, "double_top");
    assert.equal(pat[0].level_price, 97);
    assert.equal(pat[0].confirmation, "1h_close");
  });
});

describe("no lookahead", () => {
  test("result at an as-of time ignores bars that close later", () => {
    const { b4, b1 } = resistanceSetup();
    // Evaluate one 4H bar earlier: the break bar has not closed yet, so nothing may fire.
    const before = evaluateSymbol("EURJPY", b4, b1, asOf - H4_MS, new Set());
    assert.equal(before.breakouts.length, 0);
  });

  test("changing bars after the as-of time does not change the result", () => {
    const { b4, b1 } = resistanceSetup();
    const base = evaluateSymbol("EURJPY", b4, b1, asOf, new Set());
    const mutated4 = [...b4, { time: asOf, open: 1, high: 999, low: 0.1, close: 1, volume: 1 }];
    const mutated1 = [...b1, { time: asOf, open: 1, high: 999, low: 0.1, close: 1, volume: 9e9 }];
    const after = evaluateSymbol("EURJPY", mutated4, mutated1, asOf, new Set());
    assert.deepEqual(after.breakouts, base.breakouts);
    assert.equal(after.atr, base.atr);
  });
});
