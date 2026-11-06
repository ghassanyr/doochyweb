import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  breakoutKey,
  breakoutsEnabled,
  classifyAsset,
  dedupe,
  filterBreakouts,
  normalizeBreakout,
  normalizeBreakouts,
  sortNewestFirst,
  type Breakout,
} from "../src/server/market/breakouts";
import { normalizeCapture } from "../src/server/market/captures";
import {
  ALL_TYPES,
  breakPct,
  breakoutDirection,
  breakoutMeterPct,
  breakoutSummary,
  loadTypeSelection,
  noneSelected,
  pageCount,
  typesParam,
} from "../src/webapp/src/market/breakouts";

const SAMPLE = {
  symbol: "EURJPY",
  type: "resistance_break",
  level_price: 176.2,
  level_type: "swing_high",
  break_price: 176.45,
  break_atr_mult: 1.3,
  confirmation: "1h_close_and_volume",
  session: "London",
  timestamp_utc: "2026-10-28T13:04:00Z",
};

function mk(over: Partial<Breakout>): Breakout {
  return { ...(normalizeBreakout(SAMPLE) as Breakout), ...over };
}

describe("normalizeBreakout", () => {
  test("accepts the documented payload and lowercases session", () => {
    const b = normalizeBreakout(SAMPLE)!;
    assert.equal(b.symbol, "EURJPY");
    assert.equal(b.type, "resistance_break");
    assert.equal(b.session, "london");
    assert.equal(b.level_price, 176.2);
    assert.equal(b.break_atr_mult, 1.3);
    assert.equal(b.asset_class, "forex");
  });

  test("rejects rows missing identity fields", () => {
    assert.equal(normalizeBreakout({ ...SAMPLE, symbol: "" }), null);
    assert.equal(normalizeBreakout({ ...SAMPLE, type: "sideways_break" }), null);
    assert.equal(normalizeBreakout({ ...SAMPLE, timestamp_utc: "not a date" }), null);
    assert.equal(normalizeBreakout(null), null);
    assert.equal(normalizeBreakout([SAMPLE]), null);
  });

  test("non-numeric prices become null, not zero", () => {
    const b = normalizeBreakout({ ...SAMPLE, level_price: "abc", break_atr_mult: "" })!;
    assert.equal(b.level_price, null);
    assert.equal(b.break_atr_mult, null);
  });

  test("normalizeBreakouts tolerates a non-array and drops bad entries", () => {
    assert.deepEqual(normalizeBreakouts(undefined), []);
    assert.deepEqual(normalizeBreakouts("x"), []);
    assert.equal(normalizeBreakouts([SAMPLE, { symbol: "" }, SAMPLE]).length, 2);
  });
});

describe("classifyAsset", () => {
  test("maps the instrument families", () => {
    assert.equal(classifyAsset("EURJPY"), "forex");
    assert.equal(classifyAsset("XAUUSD"), "commodity");
    assert.equal(classifyAsset("BTCUSD"), "crypto");
    assert.equal(classifyAsset("US100"), "index");
    assert.equal(classifyAsset("SPX"), "index");
    assert.equal(classifyAsset("AAPL"), "stock");
  });
});

describe("dedupe, ordering and filters", () => {
  test("duplicate writes collapse to one event", () => {
    const a = mk({});
    const b = mk({});
    assert.equal(breakoutKey(a), breakoutKey(b));
    assert.equal(dedupe([a, b, mk({ session: "ny" })]).length, 2);
  });

  test("newest first, stable for equal timestamps", () => {
    const older = mk({ timestamp_utc: "2026-10-28T10:00:00Z", symbol: "A" });
    const newer = mk({ timestamp_utc: "2026-10-28T12:00:00Z", symbol: "B" });
    const tieFirst = mk({ timestamp_utc: "2026-10-28T12:00:00Z", symbol: "C" });
    assert.deepEqual(sortNewestFirst([older, newer, tieFirst]).map((b) => b.symbol), ["B", "C", "A"]);
  });

  test("filters combine on type, session and symbol search", () => {
    const list = [
      mk({ symbol: "EURJPY", type: "resistance_break", session: "london", asset_class: "forex" }),
      mk({ symbol: "XAUUSD", type: "support_break", session: "ny", asset_class: "commodity" }),
      mk({ symbol: "GBPUSD", type: "resistance_break", session: "ny", asset_class: "forex" }),
    ];
    assert.deepEqual(filterBreakouts(list, { types: ["resistance_break"] }).map((b) => b.symbol), ["EURJPY", "GBPUSD"]);
    assert.deepEqual(filterBreakouts(list, { types: ["resistance_break", "support_break"] }).map((b) => b.symbol), ["EURJPY", "XAUUSD", "GBPUSD"]);
    assert.equal(filterBreakouts(list, { types: [] }).length, 0, "empty type list matches nothing");
    assert.deepEqual(filterBreakouts(list, { session: "ny", symbol: "usd" }).map((b) => b.symbol), ["XAUUSD", "GBPUSD"]);
    assert.deepEqual(filterBreakouts(list, { symbol: "eur" }).map((b) => b.symbol), ["EURJPY"]);
    assert.deepEqual(filterBreakouts(list, { symbol: "  xau " }).map((b) => b.symbol), ["XAUUSD"]);
    assert.equal(filterBreakouts(list, { symbol: "zzz" }).length, 0);
    assert.deepEqual(filterBreakouts(list, { symbol: "" }).length, 3);
    assert.equal(filterBreakouts(list, {}).length, 3);
  });
});

describe("ENABLE_BREAKOUTS flag", () => {
  test("defaults on; false-like values disable", () => {
    assert.equal(breakoutsEnabled({}), true);
    assert.equal(breakoutsEnabled({ ENABLE_BREAKOUTS: "true" }), true);
    for (const v of ["false", "FALSE", "0", "off", "no"]) assert.equal(breakoutsEnabled({ ENABLE_BREAKOUTS: v }), false, v);
  });
});

describe("capture integration", () => {
  test("normalizeCapture carries breakouts; absent field reads as empty", () => {
    const withB = normalizeCapture({ timestamp_utc: "2026-10-28T13:04:00Z", breakouts: [SAMPLE] });
    assert.equal(withB.breakouts.length, 1);
    assert.equal(withB.breakouts[0].symbol, "EURJPY");
    const without = normalizeCapture({ timestamp_utc: "2026-10-28T13:04:00Z" });
    assert.deepEqual(without.breakouts, []);
  });
});

describe("webapp helpers", () => {
  test("break percent and summary", () => {
    const b = normalizeBreakout(SAMPLE)!;
    assert.ok(Math.abs(breakPct(b)! - ((176.45 - 176.2) / 176.2) * 100) < 1e-9);
    const s = breakoutSummary(b);
    assert.ok(s.includes("EURJPY") && s.includes("Resistance") && s.includes("1.3x ATR"), s);
    assert.equal(breakPct({ ...b, level_price: null }), null);
  });

  test("card direction and ATR meter", () => {
    const resistance = normalizeBreakout(SAMPLE)!;
    const support = normalizeBreakout({ ...SAMPLE, type: "support_break", level_type: "swing_low", break_price: 175.9 })!;
    const patternUp = normalizeBreakout({ ...SAMPLE, type: "pattern_break" })!;
    const patternDown = normalizeBreakout({ ...SAMPLE, type: "pattern_break", break_price: 175.9 })!;
    assert.equal(breakoutDirection(resistance), "above");
    assert.equal(breakoutDirection(support), "below");
    assert.equal(breakoutDirection(patternUp), "above");
    assert.equal(breakoutDirection(patternDown), "below");
    assert.equal(breakoutMeterPct({ ...resistance, break_atr_mult: null }), 0);
    assert.ok(Math.abs(breakoutMeterPct(resistance) - (1.3 / 3) * 100) < 1e-9);
    assert.equal(breakoutMeterPct({ ...resistance, break_atr_mult: 9 }), 100);
  });

  test("type selection maps to the API parameter", () => {
    assert.equal(typesParam(ALL_TYPES), undefined, "all selected = no filter");
    assert.equal(typesParam({ ...ALL_TYPES, support_break: false }), "resistance_break,pattern_break");
    assert.equal(typesParam({ resistance_break: false, support_break: false, pattern_break: true }), "pattern_break");
    assert.equal(noneSelected({ resistance_break: false, support_break: false, pattern_break: false }), true);
    assert.equal(noneSelected(ALL_TYPES), false);
  });

  test("corrupt or missing stored selection falls back to all selected", () => {
    assert.deepEqual(loadTypeSelection({ getItem: () => "{not json" }, "k"), ALL_TYPES);
    assert.deepEqual(loadTypeSelection(undefined, "k"), ALL_TYPES);
    const partial = loadTypeSelection({ getItem: () => '{"support_break":false}' }, "k");
    assert.equal(partial.support_break, false);
    assert.equal(partial.resistance_break, true);
  });

  test("page count never returns zero", () => {
    assert.equal(pageCount(0, 25), 1);
    assert.equal(pageCount(25, 25), 1);
    assert.equal(pageCount(26, 25), 2);
  });
});
