import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import {
  BARRIER_ATR_MULT,
  BARRIER_HORIZON,
  CONTEXT_MAX_BARS,
} from "../src/server/trainer/config";
import {
  barrierFor,
  computeOutcome,
  contextBars,
} from "../src/server/trainer/outcomes";
import type { Barrier } from "../src/server/trainer/types";

function bar(
  time: number,
  open = 100,
  high = 101,
  low = 99,
  close = 100,
  volume = 1
): Candle {
  return { time, open, high, low, close, volume };
}

function flatBars(length: number): Candle[] {
  return Array.from({ length }, (_, i) => bar(i));
}

function manualBarrier(overrides: Partial<Barrier> = {}): Barrier {
  return {
    cutIndex: 0,
    endIndex: BARRIER_HORIZON,
    entry: 100,
    upper: 102,
    lower: 98,
    atr: 2,
    atrMult: BARRIER_ATR_MULT,
    horizon: BARRIER_HORIZON,
    ...overrides,
  };
}

describe("barrier sizing", () => {
  test("anchors entry, ATR and horizon to the cut bar", () => {
    const bars = flatBars(60);
    const barrier = barrierFor(bars, 20);

    assert.equal(barrier.cutIndex, 20);
    assert.equal(barrier.endIndex, 20 + BARRIER_HORIZON);
    assert.equal(barrier.entry, 100);
    assert.equal(barrier.atr, 2);
    assert.equal(barrier.atrMult, BARRIER_ATR_MULT);
    assert.equal(barrier.horizon, BARRIER_HORIZON);
    assert.equal(barrier.upper, 100 + BARRIER_ATR_MULT * 2);
    assert.equal(barrier.lower, 100 - BARRIER_ATR_MULT * 2);
  });

  test("throws when the ATR window is incomplete or the reveal is out of range", () => {
    const bars = flatBars(60);
    assert.throws(() => barrierFor(bars, 19), /no ATR\(20\)/);
    assert.throws(() => barrierFor(bars, 40), /past the last bar/);
    assert.throws(() => barrierFor(bars, -1), /outside the series/);
    assert.throws(() => barrierFor(bars, 60), /outside the series/);
    assert.throws(() => barrierFor(flatBars(21), 20), /past the last bar/);
  });
});

describe("outcome resolution", () => {
  test("resolves up when only the upper barrier is touched first", () => {
    const bars = flatBars(25);
    bars[1] = bar(1, 100.5, 102.5, 99, 101);
    bars[5] = bar(5, 100, 100, 97.5, 98.5);

    const result = computeOutcome(bars, manualBarrier());

    assert.equal(result.outcome, "up");
    assert.equal(result.outcomeIndex, 1);
    assert.equal(result.ambiguousSameBar, false);
    assert.equal(result.mfeAtr, (102.5 - 100) / 2);
    assert.equal(result.maeAtr, (100 - 97.5) / 2);
    assert.equal(result.mfeR, result.mfeAtr / BARRIER_ATR_MULT);
    assert.equal(result.maeR, result.maeAtr / BARRIER_ATR_MULT);
  });

  test("resolves down when only the lower barrier is touched first", () => {
    const bars = flatBars(25);
    bars[1] = bar(1, 100, 100.5, 97.5, 98.5);
    bars[3] = bar(3, 100, 104, 99, 103);

    const result = computeOutcome(bars, manualBarrier());

    assert.equal(result.outcome, "down");
    assert.equal(result.outcomeIndex, 1);
    assert.equal(result.mfeAtr, (104 - 100) / 2);
    assert.equal(result.maeAtr, (100 - 97.5) / 2);
  });

  test("times out as a scratch with no outcome index", () => {
    const result = computeOutcome(flatBars(25), manualBarrier());

    assert.equal(result.outcome, "scratch");
    assert.equal(result.outcomeIndex, null);
    assert.equal(result.ambiguousSameBar, false);
    assert.equal(result.mfeAtr, 0.5);
    assert.equal(result.maeAtr, 0.5);
  });

  test("uses the resolving bar, not a later touch, for the outcome index", () => {
    const bars = flatBars(25);
    bars[1] = bar(1, 100, 101.5, 99.5, 101);
    bars[2] = bar(2, 100, 103, 99, 102);
    bars[3] = bar(3, 100, 100.5, 97, 98);

    const result = computeOutcome(bars, manualBarrier());

    assert.equal(result.outcome, "up");
    assert.equal(result.outcomeIndex, 2);
    assert.equal(result.ambiguousSameBar, false);
  });
});

describe("same-bar touches", () => {
  test("an exact distance tie is a scratch and is flagged ambiguous", () => {
    const bars = flatBars(25);
    bars[1] = bar(1, 100, 103, 97, 100);

    const result = computeOutcome(bars, manualBarrier());

    assert.equal(result.outcome, "scratch");
    assert.equal(result.outcomeIndex, 1);
    assert.equal(result.ambiguousSameBar, true);
  });

  test("the barrier nearer the open wins", () => {
    const upperNear = flatBars(25);
    upperNear[1] = bar(1, 100.5, 103, 97, 100);
    const upper = computeOutcome(upperNear, manualBarrier());
    assert.equal(upper.outcome, "up");
    assert.equal(upper.outcomeIndex, 1);
    assert.equal(upper.ambiguousSameBar, true);

    const lowerNear = flatBars(25);
    lowerNear[1] = bar(1, 99.5, 103, 97, 100);
    const lower = computeOutcome(lowerNear, manualBarrier());
    assert.equal(lower.outcome, "down");
    assert.equal(lower.outcomeIndex, 1);
    assert.equal(lower.ambiguousSameBar, true);
  });
});

describe("excursions", () => {
  test("MFE and MAE are clamped at zero", () => {
    const noHigh = flatBars(25);
    for (let i = 1; i <= 20; i++) {
      noHigh[i] = bar(i, 99.6, 99.8, 99.5, 99.7);
    }
    const timeout = computeOutcome(noHigh, manualBarrier());
    assert.equal(timeout.mfeAtr, 0);
    assert.equal(timeout.mfeR, 0);
    assert.equal(timeout.maeAtr, 0.25);

    const noLow = flatBars(25);
    for (let i = 1; i <= 20; i++) {
      noLow[i] = bar(i, 100, i === 1 ? 102.5 : 100.5, 100.1, 100.4);
    }
    const up = computeOutcome(noLow, manualBarrier());
    assert.equal(up.outcome, "up");
    assert.equal(up.maeAtr, 0);
    assert.equal(up.maeR, 0);
  });
});

describe("context leakage", () => {
  test("returns only bars up to the cut and caps the window", () => {
    const bars = flatBars(200);
    const context = contextBars(bars, 150);

    assert.equal(context.length, CONTEXT_MAX_BARS);
    assert.equal(context[0].time, 150 - (CONTEXT_MAX_BARS - 1));
    assert.equal(context[context.length - 1].time, 150);
    assert.ok(context.every((b) => b.time <= 150));
  });

  test("clamps at the start and honours a custom cap", () => {
    const bars = flatBars(20);
    assert.deepEqual(
      contextBars(bars, 5).map((b) => b.time),
      [0, 1, 2, 3, 4, 5]
    );
    assert.deepEqual(
      contextBars(bars, 10, 1).map((b) => b.time),
      [10]
    );
  });

  test("rejects a cut outside the series", () => {
    const bars = flatBars(20);
    assert.throws(() => contextBars(bars, -1), /outside the series/);
    assert.throws(() => contextBars(bars, 20), /outside the series/);
  });
});
