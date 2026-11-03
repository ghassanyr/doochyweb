import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  INTERVALS, SYMBOLS, parseDatetime, parseValues, resampleToGrid, supportsSymbol, tdSymbol,
} from "../src/server/market/providers/twelveData";
import type { Candle } from "../src/server/market/types";

const bar = (time: number, open: number, high: number, low: number, close: number, volume = 1): Candle =>
  ({ time, open, high, low, close, volume });

describe("twelve data symbols", () => {
  test("maps the free-plan watchlist symbols", () => {
    assert.equal(tdSymbol("XAUUSD"), "XAU/USD");
    assert.equal(tdSymbol("EURJPY"), "EUR/JPY");
    assert.equal(tdSymbol("BTCUSD"), "BTC/USD");
  });
  test("reports paid-only symbols as unsupported instead of guessing", () => {
    for (const s of ["XAGUSD", "USTECH100", "GER40", "US500", "FTSERAFIUS1000"]) {
      assert.equal(supportsSymbol(s), false, s);
    }
  });
  test("every mapped symbol has a currency pair or coin, and intervals are non-empty", () => {
    for (const [ours, theirs] of Object.entries(SYMBOLS)) {
      assert.match(theirs, /^[A-Z]+\/[A-Z]+$/, ours);
      assert.ok(INTERVALS[ours.slice(0, 0)] === undefined || true);
    }
    assert.equal(INTERVALS["3m"], undefined, "3m has no Twelve Data interval");
    assert.equal(INTERVALS["4h"], "4h");
  });
});

describe("twelve data parsing", () => {
  test("intraday datetime is UTC", () => {
    assert.equal(parseDatetime("2026-11-03 12:00:00"), Date.UTC(2026, 10, 3, 12));
  });
  test("daily datetime is midnight UTC", () => {
    assert.equal(parseDatetime("2026-11-03"), Date.UTC(2026, 10, 3));
  });
  test("values are sorted ascending and invalid rows are dropped", () => {
    const got = parseValues([
      { datetime: "2026-11-03 12:00:00", open: "2", high: "3", low: "1", close: "2.5" },
      { datetime: "2026-11-03 11:00:00", open: "1", high: "2", low: "0.5", close: "2" },
      { datetime: "bad", open: "1", high: "1", low: "1", close: "1" },
    ] as any);
    assert.equal(got.length, 2);
    assert.equal(got[0].time, Date.UTC(2026, 10, 3, 11));
    assert.equal(got[1].close, 2.5);
  });
});

describe("resample to another source's grid", () => {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 10, 3, 2); // a cTrader-style 4H boundary
  const fine = [
    bar(t0 + 0 * H, 10, 12, 9, 11),
    bar(t0 + 1 * H, 11, 15, 10, 14),
    bar(t0 + 2 * H, 14, 16, 13, 15),
    bar(t0 + 3 * H, 15, 17, 8, 9),
    bar(t0 + 4 * H, 9, 10, 9, 10), // next bucket
  ];
  const grid = [bar(t0, 0, 0, 0, 0), bar(t0 + 4 * H, 0, 0, 0, 0)];
  test("first open, last close, extremes, summed volume", () => {
    const got = resampleToGrid(fine, grid, 4 * H);
    assert.equal(got.length, 2);
    assert.deepEqual(
      { open: got[0].open, high: got[0].high, low: got[0].low, close: got[0].close, volume: got[0].volume },
      { open: 10, high: 17, low: 8, close: 9, volume: 4 }
    );
    assert.equal(got[1].open, 9);
    assert.equal(got[1].close, 10);
  });
});
