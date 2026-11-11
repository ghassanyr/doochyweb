import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import {
  MAX_LIMIT,
  assertBarsValid,
  filterClosedBars,
  inspectBars,
  mergeBars,
  nextFetchStart,
  planFetchWindow,
} from "../src/server/trainer/ingest";

const TF = 15 * 60 * 1000;
const DAY_MS = 86_400_000;

function bar(
  time: number,
  prices: Partial<Pick<Candle, "open" | "high" | "low" | "close" | "volume">> = {}
): Candle {
  return {
    time,
    open: prices.open ?? 100,
    high: prices.high ?? 101,
    low: prices.low ?? 99,
    close: prices.close ?? 100,
    volume: prices.volume ?? 10,
  };
}

describe("pagination planning", () => {
  test("a cold series starts HISTORY_DAYS before now", () => {
    const now = Date.UTC(2026, 10, 8);
    const window = planFetchWindow(null, TF, now, 730);
    assert.equal(window.startTime, now - 730 * DAY_MS);
    assert.equal(window.limit, MAX_LIMIT);
  });

  test("an existing series resumes one bar after its newest open", () => {
    const now = Date.UTC(2026, 10, 8);
    const newest = now - 10 * TF;
    const window = planFetchWindow(newest, TF, now);
    assert.equal(window.startTime, newest + TF);
  });

  test("the page limit is clamped to Binance's maximum", () => {
    assert.equal(planFetchWindow(null, TF, Date.now(), 730, 5000).limit, MAX_LIMIT);
    assert.equal(planFetchWindow(null, TF, Date.now(), 730, 250).limit, 250);
  });

  test("the next page starts at the following open time", () => {
    assert.equal(nextFetchStart(1_000, TF), 1_000 + TF);
  });
});

describe("closed-bar filtering", () => {
  test("drops the still-forming bar and sorts ascending", () => {
    const now = 2 * TF + TF - 1; // bar at 2*TF closes at 3*TF, so it is still open
    const bars = [bar(2 * TF), bar(0), bar(TF)];
    const closed = filterClosedBars(bars, TF, now);
    assert.deepEqual(
      closed.map((b) => b.time),
      [0, TF]
    );
  });

  test("includes a bar whose close time equals now", () => {
    const now = 3 * TF;
    const closed = filterClosedBars([bar(0), bar(TF), bar(2 * TF)], TF, now);
    assert.equal(closed.length, 3);
  });
});

describe("merge and de-duplicate", () => {
  test("overlapping fresh bars replace cached values at the same open time", () => {
    const cached = [bar(0, { close: 100 }), bar(TF, { close: 101 })];
    const fresh = [bar(TF, { close: 111 }), bar(2 * TF, { close: 102 })];
    const merged = mergeBars(cached, fresh);

    assert.deepEqual(
      merged.map((b) => b.time),
      [0, TF, 2 * TF]
    );
    assert.equal(merged[1].close, 111);
    assert.equal(merged.length, 3);
  });

  test("an incremental merge appends only newer bars", () => {
    const cached = [bar(0), bar(TF)];
    const fresh = [bar(2 * TF), bar(3 * TF)];
    const merged = mergeBars(cached, fresh);
    assert.deepEqual(
      merged.map((b) => b.time),
      [0, TF, 2 * TF, 3 * TF]
    );
  });
});

describe("bar QA", () => {
  test("reports a gap with its index and expected open time", () => {
    const bars = [bar(0), bar(TF), bar(4 * TF)];
    const qa = inspectBars(bars, TF);

    assert.equal(qa.invalid.length, 0);
    assert.deepEqual(qa.gaps, [
      { index: 2, expectedTime: 2 * TF, actualTime: 4 * TF, missingBars: 2 },
    ]);
  });

  test("gaps are allowed by the validator", () => {
    const bars = [bar(0), bar(4 * TF)];
    const qa = assertBarsValid(bars, TF, "BTC:15m");
    assert.equal(qa.gaps.length, 1);
  });

  test("flags non-finite, zero and negative prices", () => {
    const bars = [
      bar(0, { close: NaN }),
      bar(TF, { open: 0 }),
      bar(2 * TF, { low: -1 }),
    ];
    const qa = inspectBars(bars, TF);

    assert.equal(qa.invalid.length, 3);
    assert.ok(qa.invalid[0].reasons.includes("non-finite price"));
    assert.ok(qa.invalid[1].reasons.includes("zero price"));
    assert.ok(qa.invalid[2].reasons.includes("negative price"));
  });

  test("flags high below low and open/close outside the range", () => {
    const bars = [
      bar(0, { high: 98, low: 99 }),
      bar(TF, { open: 105 }),
      bar(2 * TF, { close: 95 }),
    ];
    const qa = inspectBars(bars, TF);

    assert.equal(qa.invalid.length, 3);
    assert.ok(qa.invalid[0].reasons.includes("high < low"));
    assert.ok(qa.invalid[1].reasons.includes("open outside [low, high]"));
    assert.ok(qa.invalid[2].reasons.includes("close outside [low, high]"));
  });

  test("structural invalid bars throw instead of being dropped", () => {
    const bars = [bar(0), bar(TF, { close: NaN })];
    assert.throws(
      () => assertBarsValid(bars, TF, "BTC:15m"),
      /BTC:15m: 1 invalid bar\(s\).*#1 t=/
    );
  });
});
