import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { BriefingWatchlistRow } from "../src/webapp/src/api";
import { greetingFor, topMovers } from "../src/webapp/src/today/today";

function row(symbol: string, changePct: number | null): BriefingWatchlistRow {
  return {
    symbol,
    name: null,
    type: null,
    last: 1,
    previousClose: null,
    changePct,
    dayHigh: null,
    dayLow: null,
    barTime: null,
    quote: null,
  };
}

describe("today dashboard helpers", () => {
  test("greets by local time of day", () => {
    assert.equal(greetingFor(new Date(2026, 0, 1, 7)), "Good morning");
    assert.equal(greetingFor(new Date(2026, 0, 1, 11, 59)), "Good morning");
    assert.equal(greetingFor(new Date(2026, 0, 1, 12)), "Good afternoon");
    assert.equal(greetingFor(new Date(2026, 0, 1, 17, 59)), "Good afternoon");
    assert.equal(greetingFor(new Date(2026, 0, 1, 18)), "Good evening");
    assert.equal(greetingFor(new Date(2026, 0, 1, 23)), "Good evening");
  });

  test("ranks movers by absolute change and drops unknown rows", () => {
    const movers = topMovers([
      row("EURUSD", 0.4),
      row("NAS100", -2.1),
      row("GOLD", null),
      row("BTCUSD", 1.2),
      row("US30", -0.2),
    ]);
    assert.deepEqual(
      movers.map((item) => item.symbol),
      ["NAS100", "BTCUSD", "EURUSD", "US30"]
    );
  });

  test("respects the mover limit", () => {
    const movers = topMovers([row("A", 1), row("B", 2), row("C", 3)], 2);
    assert.deepEqual(
      movers.map((item) => item.symbol),
      ["C", "B"]
    );
    assert.deepEqual(topMovers([row("A", 1)], 0), []);
  });
});
