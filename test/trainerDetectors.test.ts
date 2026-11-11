import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ATR_PERIOD,
  MIN_PCT,
  SWING_LOOKBACK,
  meanTrueRange,
} from "../src/server/market/breakoutEngine";
import type { Candle } from "../src/server/market/types";
import {
  ENGULF_MIN_BODY_RATIO,
  ENGULF_WICK_EPS_ATR,
  SWEEP_LEVEL_LOOKBACK,
  SWEEP_PENETRATION_ATR,
} from "../src/server/trainer/config";
import {
  atrAt,
  candidateId,
  detectAll,
  detectBearishEngulfing,
  detectBos,
  detectChoch,
  detectBullishEngulfing,
  detectSrFlip,
  detectSweepDown,
  detectSweepUp,
  readTrend,
  thresholdAt,
} from "../src/server/trainer/detectors";

function bar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1
): Candle {
  return { time, open, high, low, close, volume };
}

function flat(length: number, price = 100): Candle[] {
  return Array.from({ length }, (_, i) =>
    bar(i, price, price + 0.5, price - 0.5, price)
  );
}

function twoBarSetup(prior: Candle, current: Candle): Candle[] {
  const bars = flat(19);
  bars[19] = { ...prior, time: 19 };
  bars[20] = { ...current, time: 20 };
  return bars;
}

function bearishBars(): Candle[] {
  return twoBarSetup(
    bar(0, 99.5, 100.5, 98, 100),
    bar(0, 100.5, 101, 97, 97.5)
  );
}

function bullishBars(): Candle[] {
  return twoBarSetup(
    bar(0, 100.5, 102, 99.5, 100),
    bar(0, 99.5, 103, 99, 102.5)
  );
}

function trendSeries(up: boolean): Candle[] {
  const bars = flat(31);
  const highOlder = up ? 104 : 106;
  const highNewer = up ? 106 : 104;
  const lowOlder = up ? 98 : 99;
  const lowNewer = up ? 99 : 98;
  bars[10] = bar(10, 100, 100.5, lowOlder, 100);
  bars[14] = bar(14, 100, highOlder, 99.5, 100.5);
  bars[18] = bar(18, 100, 100.5, lowNewer, 100);
  bars[22] = bar(22, 100, highNewer, 99.5, 100.5);
  return bars;
}

describe("ATR and thresholds", () => {
  test("atrAt matches meanTrueRange for the same window", () => {
    const bars = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + Math.sin(i / 3) * 2;
      return bar(i, base - 0.5, base + 1.2, base - 1.1, base + 0.3);
    });
    for (const i of [ATR_PERIOD, 25, 39]) {
      assert.equal(atrAt(bars, i), meanTrueRange(bars.slice(0, i + 1), ATR_PERIOD));
    }
    assert.equal(atrAt(bars, ATR_PERIOD - 1), null);
  });

  test("thresholdAt is max(0.2% of close, ATR20)", () => {
    const bars = flat(30);
    const i = 25;
    assert.equal(
      thresholdAt(bars, i),
      Math.max(bars[i].close * MIN_PCT, atrAt(bars, i) as number)
    );
  });
});

describe("candle patterns", () => {
  test("bullish engulfing clears the prior wick and expands the body", () => {
    const match = detectBullishEngulfing(bullishBars(), 20);
    assert.ok(match);
    assert.equal(match.tag, "bullish_engulfing");
    assert.equal(match.direction, "up");
    assert.equal(match.cutIndex, 20);
    assert.deepEqual(match.bounds, { startIndex: 19, endIndex: 20 });
    assert.deepEqual(match.levels, {
      levelUpper: null,
      levelLower: null,
      neckline: null,
    });
  });

  test("a doji next to the engulfing bar is not valid", () => {
    const bars = bullishBars();
    bars[20] = bar(20, 99, 101, 98.5, 99);
    assert.equal(detectBullishEngulfing(bars, 20), null);
  });

  test("bearish engulfing is the mirror", () => {
    const match = detectBearishEngulfing(bearishBars(), 20);
    assert.ok(match);
    assert.equal(match.tag, "bearish_engulfing");
    assert.equal(match.direction, "down");
  });

  test("bullish close between the prior body and prior wick is not valid", () => {
    const bars = twoBarSetup(
      bar(0, 100.5, 104, 99.5, 100),
      bar(0, 99.5, 103, 99, 102.5)
    );
    assert.equal(detectBullishEngulfing(bars, 20), null);
  });

  test("bearish close between the prior body and prior wick is not valid", () => {
    const bars = twoBarSetup(
      bar(0, 99.5, 100.5, 96, 100),
      bar(0, 100.5, 101, 97, 97.5)
    );
    assert.equal(detectBearishEngulfing(bars, 20), null);
  });

  test("a bullish wick clearance without body expansion is not valid", () => {
    const bars = twoBarSetup(
      bar(0, 101, 101, 99.5, 100),
      bar(0, 100, 101.5, 99.5, 101.2)
    );
    assert.equal(detectBullishEngulfing(bars, 20), null);
  });

  test("a bearish wick clearance without body expansion is not valid", () => {
    const bars = twoBarSetup(
      bar(0, 99, 100.5, 99, 100),
      bar(0, 100, 100, 98.8, 98.8)
    );
    assert.equal(detectBearishEngulfing(bars, 20), null);
  });
});

describe("liquidity sweeps", () => {
  function sweepUpBars(): Candle[] {
    const bars = flat(100);
    bars[20] = bar(20, 100, 104, 99.5, 100);
    bars[30] = bar(30, 101, 105, 100, 102);
    return bars;
  }

  function sweepDownBars(): Candle[] {
    const bars = flat(100);
    bars[20] = bar(20, 100, 100.5, 96, 100);
    bars[30] = bar(30, 99, 100, 94, 98);
    return bars;
  }

  test("a valid sweep-up rejects the prior 20-bar high", () => {
    const match = detectSweepUp(sweepUpBars(), 30);
    assert.ok(match);
    assert.equal(match.tag, "sweep_up");
    assert.equal(match.direction, "down");
    assert.deepEqual(match.bounds, { startIndex: 20, endIndex: 30 });
    assert.equal(match.levels.levelUpper, 104);
    assert.equal(match.levels.levelLower, 99.5);
    assert.match(match.notes ?? "", /20-bar high at index 20/);
  });

  test("a valid sweep-down rejects the prior 20-bar low", () => {
    const match = detectSweepDown(sweepDownBars(), 30);
    assert.ok(match);
    assert.equal(match.tag, "sweep_down");
    assert.equal(match.direction, "up");
    assert.deepEqual(match.bounds, { startIndex: 20, endIndex: 30 });
    assert.equal(match.levels.levelLower, 96);
    assert.equal(match.levels.levelUpper, 100.5);
    assert.match(match.notes ?? "", /20-bar low at index 20/);
  });

  test("touch-only rejection is not a sweep", () => {
    const bars = sweepUpBars();
    bars[30] = bar(30, 101, 104, 100, 102);
    assert.equal(detectSweepUp(bars, 30), null);
  });

  test("a close through the level is not a sweep", () => {
    const bars = sweepUpBars();
    bars[30] = bar(30, 101, 105, 100, 104.5);
    assert.equal(detectSweepUp(bars, 30), null);
  });

  test("a weak rejection close rejects the sweep", () => {
    const bars = sweepUpBars();
    bars[30] = bar(30, 101, 105, 99, 102.5);
    assert.equal(detectSweepUp(bars, 30), null);
  });

  test("a higher high inside the 20-bar range raises the swept level", () => {
    const bars = sweepUpBars();
    bars[24] = bar(24, 100, 110, 99.5, 100);
    assert.equal(detectSweepUp(bars, 30), null);
  });

  test("an immediately preceding extreme is eligible", () => {
    const bars = flat(100);
    bars[29] = bar(29, 100, 104, 99.5, 100);
    bars[30] = bar(30, 101, 105, 100, 102);
    const match = detectSweepUp(bars, 30);
    assert.ok(match);
    assert.deepEqual(match.bounds, { startIndex: 29, endIndex: 30 });
    assert.match(match.notes ?? "", /20-bar high at index 29/);
  });

  test("an older low outside the 20-bar window is ignored", () => {
    const bars = flat(100);
    bars[20] = bar(20, 100, 100.5, 90, 100);
    bars[40] = bar(40, 100, 100.5, 96, 100);
    bars[50] = bar(50, 99, 100, 94, 98);
    const match = detectSweepDown(bars, 50);
    assert.ok(match);
    assert.deepEqual(match.bounds, { startIndex: 40, endIndex: 50 });
    assert.equal(match.levels.levelLower, 96);
    assert.match(match.notes ?? "", /20-bar low at index 40/);
  });
});

describe("S/R flip", () => {
  test("a broken swing high is retested and holds as support", () => {
    const bars = flat(26);
    bars[10] = bar(10, 100, 104, 99.5, 100.5);
    bars[20] = bar(20, 100, 108, 100, 108);
    for (let i = 21; i <= 24; i++) bars[i] = bar(i, 105, 105.5, 104.5, 105);
    bars[25] = bar(25, 104.5, 105.5, 103.5, 104.5);

    const match = detectSrFlip(bars, 25);
    assert.ok(match);
    assert.equal(match.tag, "sr_flip");
    assert.equal(match.direction, "up");
    assert.equal(match.bounds.startIndex, 10);
    assert.equal(match.bounds.endIndex, 25);
    assert.equal(match.levels.levelLower, 104);
    assert.equal(match.levels.levelUpper, null);
  });
});

describe("BOS and CHoCH", () => {
  test("bullish BOS continues an uptrend through the latest swing high", () => {
    const bars = trendSeries(true);
    bars[30] = bar(30, 101, 115, 100, 115);
    const match = detectBos(bars, 30);

    assert.ok(match);
    assert.equal(match.tag, "bos");
    assert.equal(match.direction, "up");
    assert.equal(match.bounds.startIndex, 22);
    assert.equal(match.levels.levelUpper, 106);
  });

  test("bearish BOS continues a downtrend through the latest swing low", () => {
    const bars = trendSeries(false);
    bars[30] = bar(30, 100, 100.5, 90, 90);
    const match = detectBos(bars, 30);

    assert.ok(match);
    assert.equal(match.direction, "down");
    assert.equal(match.bounds.startIndex, 18);
    assert.equal(match.levels.levelLower, 98);
  });

  test("bearish CHoCH breaks the latest higher low of an uptrend", () => {
    const bars = trendSeries(true);
    bars[30] = bar(30, 100, 100.5, 90, 90);
    const match = detectChoch(bars, 30);

    assert.ok(match);
    assert.equal(match.tag, "choch");
    assert.equal(match.direction, "down");
    assert.equal(match.bounds.startIndex, 18);
    assert.equal(match.levels.levelLower, 99);
  });

  test("bullish CHoCH breaks the latest lower high of a downtrend", () => {
    const bars = trendSeries(false);
    bars[30] = bar(30, 101, 115, 100, 115);
    const match = detectChoch(bars, 30);

    assert.ok(match);
    assert.equal(match.direction, "up");
    assert.equal(match.bounds.startIndex, 22);
    assert.equal(match.levels.levelUpper, 104);
  });

  test("non-alternating swing order does not establish a trend", () => {
    const bars = flat(31);
    bars[10] = bar(10, 100, 104, 99.5, 100);
    bars[14] = bar(14, 100, 100.5, 97, 100);
    bars[18] = bar(18, 100, 100.5, 98, 100);
    bars[22] = bar(22, 100, 106, 99.5, 100);
    bars[30] = bar(30, 101, 115, 100, 115);

    assert.equal(readTrend(bars, 30), null);
    assert.equal(detectBos(bars, 30), null);
    assert.equal(detectChoch(bars, 30), null);
  });

  test("a bar that is both swing high and swing low does not establish a trend", () => {
    const bars = flat(31);
    bars[10] = bar(10, 100, 104, 99.5, 100);
    bars[14] = bar(14, 100, 110, 90, 100);
    bars[18] = bar(18, 100, 100.5, 96, 100);
    bars[30] = bar(30, 101, 115, 100, 115);

    assert.equal(readTrend(bars, 30), null);
    assert.equal(detectBos(bars, 30), null);
    assert.equal(detectChoch(bars, 30), null);
  });

  test("mixed structure does not establish a trend", () => {
    const bars = trendSeries(true);
    bars[18] = bar(18, 100, 100.5, 97, 100);
    bars[30] = bar(30, 101, 115, 100, 115);
    assert.equal(detectBos(bars, 30), null);
  });
});

describe("detector aggregation", () => {
  test("candidateId is stable and encodes the pattern span", () => {
    assert.equal(
      candidateId("BTC", "15m", "sweep_up", { startIndex: 20, endIndex: 30 }, "down"),
      "BTC:15m:sweep_up:20-30:down"
    );
    assert.equal(
      candidateId("ETH", "1h", "bos", { startIndex: 0, endIndex: 1 }, "up"),
      "ETH:1h:bos:0-1:up"
    );
  });

  test("detectAll attaches identity to sweep matches", () => {
    const bars = flat(100);
    bars[20] = bar(20, 100, 104, 99.5, 100);
    bars[30] = bar(30, 101, 105, 100, 102);
    const hits = detectAll("BTC", "15m", bars, 30);

    assert.deepEqual(hits.map((h) => h.tag), ["sweep_up"]);
    assert.equal(hits[0].symbol, "BTC");
    assert.equal(hits[0].timeframe, "15m");
    assert.equal(hits[0].family, "liquidity");
    assert.match(hits[0].id, /^BTC:15m:sweep_up:20-30:down$/);
  });

  test("detectAll returns a candle hit with the right family and id", () => {
    const hits = detectAll("ETH", "1h", bullishBars(), 20);
    const hit = hits.find((h) => h.tag === "bullish_engulfing");
    assert.ok(hit);
    assert.equal(hit.family, "candle");
    assert.equal(hit.id, "ETH:1h:bullish_engulfing:19-20:up");
  });
});

describe("taxonomy constants stay aligned", () => {
  test("detectors use the shared swing, sweep and engulfing constants", () => {
    assert.equal(SWING_LOOKBACK, 120);
    assert.equal(SWEEP_LEVEL_LOOKBACK, 20);
    assert.equal(SWEEP_PENETRATION_ATR, 0.1);
    assert.equal(ENGULF_MIN_BODY_RATIO, 1.3);
    assert.equal(ENGULF_WICK_EPS_ATR, 0.1);
  });
});
