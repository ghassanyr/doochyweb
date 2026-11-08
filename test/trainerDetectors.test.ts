import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ATR_PERIOD,
  MIN_PCT,
  PATTERN_GAP_MAX,
  PATTERN_GAP_MIN,
  SWEEP_WINDOW,
  SWING_LOOKBACK,
  meanTrueRange,
} from "../src/server/market/breakoutEngine";
import type { Candle } from "../src/server/market/types";
import {
  atrAt,
  candidateId,
  detectAll,
  detectBearishEngulfing,
  detectBos,
  detectChoch,
  detectDoubleBottom,
  detectDoubleTop,
  detectBullishEngulfing,
  detectInsideBar,
  detectOutsideBar,
  detectSrFlip,
  detectSweepDown,
  detectSweepUp,
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

function bearishBars(): Candle[] {
  return [bar(0, 100, 102.5, 98, 102), bar(1, 102, 102.5, 98.5, 99)];
}

function bullishBars(): Candle[] {
  return [bar(0, 102, 103, 98.5, 99), bar(1, 99, 102.5, 98.5, 102)];
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
  test("bullish engulfing covers the prior red body and ignores wicks", () => {
    const match = detectBullishEngulfing(bullishBars(), 1);
    assert.ok(match);
    assert.equal(match.tag, "bullish_engulfing");
    assert.equal(match.direction, "up");
    assert.equal(match.cutIndex, 1);
    assert.deepEqual(match.bounds, { startIndex: 0, endIndex: 1 });
    assert.deepEqual(match.levels, {
      levelUpper: null,
      levelLower: null,
      neckline: null,
    });
  });

  test("a doji next to the engulfing bar is not valid", () => {
    const bars = bullishBars();
    bars[1] = bar(1, 99, 101, 98.5, 99);
    assert.equal(detectBullishEngulfing(bars, 1), null);
  });

  test("bearish engulfing is the mirror", () => {
    const match = detectBearishEngulfing(bearishBars(), 1);
    assert.ok(match);
    assert.equal(match.tag, "bearish_engulfing");
    assert.equal(match.direction, "down");
  });

  test("inside bar requires a strictly smaller range", () => {
    const inside = [bar(0, 100, 101, 99, 100), bar(1, 100, 100.5, 99.5, 100)];
    const match = detectInsideBar(inside, 1);
    assert.ok(match);
    assert.deepEqual(match.levels, {
      levelUpper: 101,
      levelLower: 99,
      neckline: null,
    });

    const equal = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100)];
    assert.equal(detectInsideBar(equal, 1), null);
  });

  test("outside bar requires both edges to expand", () => {
    const outside = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 98, 100)];
    const match = detectOutsideBar(outside, 1);
    assert.ok(match);
    assert.deepEqual(match.levels, {
      levelUpper: 101,
      levelLower: 99,
      neckline: null,
    });

    const oneSide = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 99, 100)];
    assert.equal(detectOutsideBar(oneSide, 1), null);
  });
});

describe("liquidity sweeps", () => {
  function sweepBars(): Candle[] {
    const bars = flat(SWEEP_WINDOW, 100);
    bars.push(bar(SWEEP_WINDOW, 100, 102, 98, 100));
    return bars;
  }

  test("a bar can sweep both sides of the prior five-bar range", () => {
    const bars = sweepBars();
    const up = detectSweepUp(bars, SWEEP_WINDOW);
    const down = detectSweepDown(bars, SWEEP_WINDOW);

    assert.ok(up);
    assert.equal(up.tag, "sweep_up");
    assert.equal(up.direction, "down");
    assert.equal(up.bounds.startIndex, 0);
    assert.equal(up.bounds.endIndex, SWEEP_WINDOW);

    assert.ok(down);
    assert.equal(down.tag, "sweep_down");
    assert.equal(down.direction, "up");
  });

  test("touching the prior extreme is not a sweep", () => {
    const bars = Array.from({ length: SWEEP_WINDOW }, (_, i) =>
      bar(i, 100, 101, 99, 100)
    );
    bars.push(bar(SWEEP_WINDOW, 100, 101, 99, 100));
    assert.equal(detectSweepUp(bars, SWEEP_WINDOW), null);
    assert.equal(detectSweepDown(bars, SWEEP_WINDOW), null);
  });
});

describe("double tops and bottoms", () => {
  function doubleTopBars(): Candle[] {
    const bars = flat(31);
    bars[20] = bar(20, 100, 105, 99.5, 100.5);
    bars[28] = bar(28, 100, 105, 99.5, 100.5);
    return bars;
  }

  test("two equal confirmed swing highs leave the neckline intact", () => {
    const match = detectDoubleTop(doubleTopBars(), 30);
    assert.ok(match);
    assert.equal(match.tag, "double_top");
    assert.equal(match.direction, "down");
    assert.equal(match.cutIndex, 30);
    assert.deepEqual(match.bounds, { startIndex: 20, endIndex: 28 });
    assert.equal(match.levels.levelUpper, 105);
    assert.equal(match.levels.neckline, 99.5);
    assert.equal(match.levels.levelLower, 99.5);
  });

  test("a close through the neckline before the cut invalidates the pattern", () => {
    const bars = doubleTopBars();
    bars[29] = bar(29, 100, 100.5, 98, 98);
    assert.equal(detectDoubleTop(bars, 30), null);
  });

  test("a gap below the minimum is not a double top", () => {
    const bars = flat(31);
    bars[24] = bar(24, 100, 105, 99.5, 100.5);
    bars[28] = bar(28, 100, 105, 99.5, 100.5);
    assert.equal(detectDoubleTop(bars, 30), null);
  });

  test("double bottom mirrors the top", () => {
    const bars = flat(31);
    bars[20] = bar(20, 100, 100.5, 95, 99.5);
    bars[28] = bar(28, 100, 100.5, 95, 99.5);
    const match = detectDoubleBottom(bars, 30);

    assert.ok(match);
    assert.equal(match.tag, "double_bottom");
    assert.equal(match.direction, "up");
    assert.equal(match.levels.levelUpper, 100.5);
    assert.equal(match.levels.levelLower, 95);
    assert.equal(match.levels.neckline, 100.5);
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
      candidateId("BTC", "15m", "double_top", { startIndex: 20, endIndex: 28 }, "down"),
      "BTC:15m:double_top:20-28:down"
    );
    assert.equal(
      candidateId("ETH", "1h", "inside_bar", { startIndex: 0, endIndex: 1 }, null),
      "ETH:1h:inside_bar:0-1:none"
    );
  });

  test("detectAll attaches identity and can return both sweep tags", () => {
    const bars = flat(SWEEP_WINDOW, 100);
    bars.push(bar(SWEEP_WINDOW, 100, 102, 98, 100));
    const hits = detectAll("BTC", "15m", bars, SWEEP_WINDOW);

    assert.deepEqual(
      hits.map((h) => h.tag).sort(),
      ["outside_bar", "sweep_down", "sweep_up"]
    );
    for (const hit of hits) {
      assert.equal(hit.symbol, "BTC");
      assert.equal(hit.timeframe, "15m");
    }

    const sweeps = hits.filter((h) => h.family === "liquidity");
    assert.equal(sweeps.length, 2);
    for (const hit of sweeps) {
      assert.match(hit.id, /^BTC:15m:sweep_(up|down):0-5:(up|down)$/);
    }
  });

  test("detectAll returns a candle hit with the right family and id", () => {
    const hits = detectAll("ETH", "1h", bullishBars(), 1);
    const hit = hits.find((h) => h.tag === "bullish_engulfing");
    assert.ok(hit);
    assert.equal(hit.family, "candle");
    assert.equal(hit.id, "ETH:1h:bullish_engulfing:0-1:up");
  });
});

describe("taxonomy constants stay aligned", () => {
  test("detectors use the shared breakout constants", () => {
    assert.equal(PATTERN_GAP_MIN, 5);
    assert.equal(PATTERN_GAP_MAX, 60);
    assert.equal(SWING_LOOKBACK, 120);
  });
});
