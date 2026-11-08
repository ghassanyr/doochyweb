import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import {
  QUESTION_PROMPT,
  anonymizeItem,
  isValidSessionId,
  meanVolume,
  normalizeBar,
  pctFromEntry,
  publicItemId,
  revealItem,
  round,
} from "../src/server/trainer/payload";
import type {
  TrainerBatch,
  TrainerItem,
  TrainerSymbol,
  TrainerTimeframe,
} from "../src/server/trainer/types";

function bar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): Candle {
  return { time, open, high, low, close, volume };
}

function flatBars(length: number): Candle[] {
  return Array.from({ length }, (_, i) =>
    bar(1_700_000_000_000 + i * 60_000, 100, 101, 99, 100, 10)
  );
}

function makeItem(overrides: Partial<TrainerItem> = {}): TrainerItem {
  const cutIndex = 60;
  return {
    id: "BTC:15m:inside_bar:55-60:none",
    batchVersion: "test-v1",
    symbol: "BTC" as TrainerSymbol,
    timeframe: "15m" as TrainerTimeframe,
    tag: "inside_bar",
    family: "candle",
    direction: null,
    contextStartIndex: 50,
    cutIndex,
    bounds: { startIndex: 55, endIndex: cutIndex },
    levels: { levelUpper: 101, levelLower: 99, neckline: null },
    barrier: {
      cutIndex,
      endIndex: cutIndex + 20,
      entry: 100,
      upper: 101,
      lower: 99,
      atr: 1,
      atrMult: 1,
      horizon: 20,
    },
    outcome: "up",
    outcomeIndex: cutIndex + 1,
    mfeAtr: 2,
    maeAtr: 1,
    mfeR: 2,
    maeR: 1,
    why: "inside_bar: upper barrier reached after 1 bar(s).",
    ...overrides,
  };
}

function makeBatch(item: TrainerItem): TrainerBatch {
  return {
    version: "test-v1",
    createdAt: 1,
    symbols: ["BTC"],
    timeframes: ["15m"],
    barrierAtrMult: 1,
    barrierHorizon: 20,
    baseRates: {
      inside_bar: { up: 0.5, down: 0.25, scratch: 0.25 },
      all: { up: 0.4, down: 0.4, scratch: 0.2 },
    },
    baseRateCounts: {
      inside_bar: { up: 2, down: 1, scratch: 1 },
      all: { up: 4, down: 4, scratch: 2 },
    },
    items: [item],
  };
}

function pricedBars(): Candle[] {
  const bars = flatBars(120);
  bars[61] = bar(bars[61].time, 100, 102, 99, 101, 20);
  bars[62] = bar(bars[62].time, 101, 101.5, 98, 99, 30);
  bars[85] = bar(bars[85].time, 100, 200, 50, 150, 1000);
  return bars;
}

describe("payload normalization", () => {
  test("rounds to the requested precision and normalizes negative zero", () => {
    assert.equal(round(1.23456, 4), 1.2346);
    assert.equal(round(-1.23456, 4), -1.2346);
    assert.equal(round(-0.00001, 4), 0);
    assert.ok(!Object.is(round(-0.00001, 4), -0));
  });

  test("expresses prices as percent moves from the cut close", () => {
    assert.equal(pctFromEntry(100, 100), 0);
    assert.equal(pctFromEntry(101.23456, 100), 1.2346);
    assert.equal(pctFromEntry(99, 100), -1);
    assert.throws(() => pctFromEntry(100, 0), /positive/);
  });

  test("normalizes one bar and its volume ratio", () => {
    const normalized = normalizeBar(
      bar(0, 100, 101.23456, 99, 100, 15),
      -3,
      100,
      10
    );
    assert.deepEqual(normalized, {
      offset: -3,
      open: 0,
      high: 1.2346,
      low: -1,
      close: 0,
      volume: 1.5,
    });
  });

  test("computes the context mean volume", () => {
    const bars = [bar(0, 100, 100, 100, 100, 10), bar(1, 100, 100, 100, 100, 20)];
    assert.equal(meanVolume(bars, 0, 1), 15);
    assert.throws(() => meanVolume(bars, 0, 2), /outside/);
  });

  test("validates opaque session ids", () => {
    assert.equal(isValidSessionId("abcdefgh"), true);
    assert.equal(isValidSessionId("A-Z_a-z-09"), true);
    assert.equal(isValidSessionId("abc"), false);
    assert.equal(isValidSessionId("abcdefg!"), false);
    assert.equal(isValidSessionId("has space"), false);
    assert.equal(isValidSessionId("a".repeat(64)), true);
    assert.equal(isValidSessionId("a".repeat(65)), false);
    assert.equal(isValidSessionId(123), false);
  });
});

describe("anonymizeItem", () => {
  test("returns only context through the cut with normalized values", () => {
    const item = makeItem();
    const bars = pricedBars();
    const payload = anonymizeItem(item, bars);

    assert.equal(payload.itemId, publicItemId(item.id));
    assert.deepEqual(payload.question, {
      kind: "probability_and_trade",
      prompt: QUESTION_PROMPT,
      barrierPct: { upperPct: 1, lowerPct: -1 },
    });

    assert.equal(payload.context.length, 11);
    assert.equal(payload.context[0].offset, -10);
    assert.equal(payload.context.at(-1)?.offset, 0);
    assert.deepEqual(payload.context.at(-1), {
      offset: 0,
      open: 0,
      high: 1,
      low: -1,
      close: 0,
      volume: 1,
    });
    assert.ok(payload.context.every((entry) => entry.offset <= 0));

    const keys = Object.keys(payload).sort();
    assert.deepEqual(keys, ["context", "itemId", "question"]);
    assert.equal("symbol" in payload, false);
    assert.equal("timeframe" in payload, false);
    assert.equal("tag" in payload, false);
    assert.equal("outcome" in payload, false);
    assert.equal("bounds" in payload, false);
    assert.equal("levels" in payload, false);

    const json = JSON.stringify(payload);
    assert.equal(json.includes("BTC"), false);
    assert.equal(json.includes("15m"), false);
    assert.equal(json.includes("inside_bar"), false);
    assert.equal(json.includes("1700000000000"), false);
    assert.equal(json.includes('"time"'), false);
  });

  test("rejects a cut outside the stored series", () => {
    assert.throws(
      () => anonymizeItem(makeItem({ cutIndex: 999 }), pricedBars()),
      /cutIndex/
    );
  });
});

describe("revealItem", () => {
  test("reveals only the horizon window plus outcome metadata", () => {
    const item = makeItem();
    const batch = makeBatch(item);
    const payload = revealItem(item, pricedBars(), batch);

    assert.equal(payload.itemId, publicItemId(item.id));
    assert.equal(payload.outcome, "up");
    assert.equal(payload.outcomeOffset, 1);
    assert.deepEqual(payload.barrierPct, { upperPct: 1, lowerPct: -1 });
    assert.equal(payload.mfeAtr, 2);
    assert.equal(payload.maeAtr, 1);
    assert.equal(payload.mfeR, 2);
    assert.equal(payload.maeR, 1);
    assert.equal(payload.tag, "inside_bar");
    assert.deepEqual(payload.bounds, { startOffset: -5, endOffset: 0 });
    assert.deepEqual(payload.levels, {
      levelUpperPct: 1,
      levelLowerPct: -1,
      necklinePct: null,
    });
    assert.equal(payload.why, item.why);

    assert.equal(payload.reveal.length, 20);
    assert.equal(payload.reveal[0].offset, 1);
    assert.equal(payload.reveal.at(-1)?.offset, 20);
    assert.deepEqual(payload.reveal[0], {
      offset: 1,
      open: 0,
      high: 2,
      low: -1,
      close: 1,
      volume: 2,
    });
    assert.deepEqual(payload.reveal[1], {
      offset: 2,
      open: 1,
      high: 1.5,
      low: -2,
      close: -1,
      volume: 3,
    });

    const extreme = payload.reveal.find((entry) => entry.offset === 25);
    assert.equal(extreme, undefined);

    assert.deepEqual(payload.baseRates.tag, {
      n: 4,
      counts: { up: 2, down: 1, scratch: 1 },
      rates: { up: 0.5, down: 0.25, scratch: 0.25 },
    });
    assert.deepEqual(payload.baseRates.all, {
      n: 10,
      counts: { up: 4, down: 4, scratch: 2 },
      rates: { up: 0.4, down: 0.4, scratch: 0.2 },
    });

    const json = JSON.stringify(payload);
    assert.equal(json.includes("BTC"), false);
    assert.equal(json.includes("15m"), false);
    assert.equal(json.includes('"time"'), false);
    assert.equal(json.includes("1700000000000"), false);
    assert.equal(json.includes('"context"'), false);
  });

  test("keeps a timeout outcome offset null", () => {
    const item = makeItem({
      outcome: "scratch",
      outcomeIndex: null,
      why: "inside_bar: neither barrier reached within 20 bars.",
    });
    const payload = revealItem(item, pricedBars(), makeBatch(item));
    assert.equal(payload.outcome, "scratch");
    assert.equal(payload.outcomeOffset, null);
  });

  test("refuses a reveal window outside the series", () => {
    const item = makeItem({
      barrier: {
        cutIndex: 60,
        endIndex: 999,
        entry: 100,
        upper: 101,
        lower: 99,
        atr: 1,
        atrMult: 1,
        horizon: 20,
      },
    });
    assert.throws(
      () => revealItem(item, pricedBars(), makeBatch(item)),
      /reveal window/
    );
  });
});
