import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  computePerformance,
  scoreResolvedSignal,
} from "../src/server/signals/performance";
import type { ResolvedSignalRow } from "../src/server/signals/types";

function row(overrides: Partial<ResolvedSignalRow> = {}): ResolvedSignalRow {
  return {
    id: "s1",
    symbol: "EURUSD",
    direction: "buy",
    status: "target_hit",
    resolvedAt: "2026-01-10T10:00:00.000Z",
    entry: 100,
    entryMax: null,
    target: 110,
    stop: 95,
    ...overrides,
  };
}

describe("scoreResolvedSignal", () => {
  test("a stop out is always exactly -1R", () => {
    assert.equal(scoreResolvedSignal(row({ status: "stopped_out" })), -1);
  });

  test("a win is scored at its planned R:R", () => {
    assert.equal(scoreResolvedSignal(row()), 2);
  });

  test("an entry range uses its midpoint", () => {
    // Entry 100 to 104 gives a 102 reference: 8 reward over 7 risk.
    assert.equal(scoreResolvedSignal(row({ entryMax: 104 })), 8 / 7);
  });

  test("a win without a usable entry still counts as 1R", () => {
    assert.equal(scoreResolvedSignal(row({ entry: null })), 1);
  });

  test("a zero-risk plan cannot divide by zero", () => {
    assert.equal(scoreResolvedSignal(row({ stop: 100 })), 1);
  });
});

describe("computePerformance", () => {
  const rows: ResolvedSignalRow[] = [
    row({ id: "a", resolvedAt: "2026-01-05T10:00:00.000Z" }),
    row({
      id: "b",
      symbol: "GBPUSD",
      direction: "sell",
      status: "stopped_out",
      resolvedAt: "2026-02-02T10:00:00.000Z",
    }),
    row({ id: "c", entry: null, resolvedAt: "2026-02-20T10:00:00.000Z" }),
  ];

  test("overall bucket counts wins, losses and R", () => {
    const result = computePerformance(rows, new Date("2026-03-01T00:00:00.000Z"));
    assert.equal(result.overall.resolved, 3);
    assert.equal(result.overall.wins, 2);
    assert.equal(result.overall.losses, 1);
    assert.equal(result.overall.winRate, 2 / 3);
    assert.equal(result.overall.totalR, 2);
    assert.equal(result.overall.avgR, 2 / 3);
    assert.equal(result.overall.profitFactor, 3);
    assert.equal(result.updatedAt, "2026-03-01T00:00:00.000Z");
  });

  test("open, expired and invalidated signals are excluded", () => {
    const result = computePerformance(
      [
        row({ id: "open", status: "active" as unknown as ResolvedSignalRow["status"] }),
        ...rows,
      ]
    );
    assert.equal(result.overall.resolved, 3);
    assert.equal(result.curve.length, 3);
  });

  test("the curve is cumulative in resolution order", () => {
    const result = computePerformance(rows);
    // +2R, then -1R for the stop out, then +1R for the win with no entry.
    assert.deepEqual(
      result.curve.map((point) => point.cumulativeR),
      [2, 1, 2]
    );
    assert.deepEqual(
      result.curve.map((point) => point.id),
      ["a", "b", "c"]
    );
  });

  test("symbol and direction buckets are grouped", () => {
    const result = computePerformance(rows);
    const eurusd = result.bySymbol.find((bucket) => bucket.key === "EURUSD");
    assert.ok(eurusd);
    assert.equal(eurusd!.resolved, 2);
    assert.equal(eurusd!.totalR, 3);

    const sell = result.byDirection.find((bucket) => bucket.key === "sell");
    assert.ok(sell);
    assert.equal(sell!.label, "Sell");
    assert.equal(sell!.totalR, -1);
    // No gross win at all, so the factor bottoms out at zero rather than null.
    assert.equal(sell!.profitFactor, 0);
  });

  test("months are sorted newest first", () => {
    const result = computePerformance(rows);
    assert.deepEqual(
      result.byMonth.map((bucket) => bucket.key),
      ["2026-02", "2026-01"]
    );
    assert.equal(result.byMonth[0].label, "Feb 2026");
  });

  test("an empty history yields empty buckets rather than NaN", () => {
    const result = computePerformance([]);
    assert.equal(result.overall.resolved, 0);
    assert.equal(result.overall.winRate, null);
    assert.equal(result.overall.avgR, null);
    assert.equal(result.overall.totalR, 0);
    assert.equal(result.overall.profitFactor, null);
    assert.deepEqual(result.curve, []);
  });

  test("R values are rounded to two decimals", () => {
    const result = computePerformance([row({ entryMax: 104 })]);
    assert.equal(result.overall.totalR, 1.14);
  });
});
