import assert from "node:assert";
import test from "node:test";
import {
  sma,
  ema,
  rsi,
  macd,
  volumeRatio,
  atr,
  adx,
  dailyPivots,
  pivotDistance,
  type Candle,
} from "./indicators.js";

/* ------------------------------------------------------------------
 * 20-bar fixture. Expected arrays below come from an INDEPENDENT Python
 * implementation (see README "Indicator conventions"), not from this code.
 * Hand-checkable values are asserted separately with derivations in comments.
 * ------------------------------------------------------------------ */
const H = [10.6, 11.7, 12.8, 11.9, 10.7, 11.9, 12.9, 13.8, 12.9, 11.8, 10.9, 11.8, 12.9, 13.8, 14.9, 13.9, 12.8, 11.8, 12.9, 13.8];
const L = [9.4, 10.3, 11.2, 10.1, 9.3, 10.1, 11.1, 12.2, 11.1, 10.2, 9.1, 10.2, 11.1, 12.2, 13.1, 12.1, 11.2, 10.2, 11.1, 12.2];
const C = [10, 11, 12, 11, 10, 11, 12, 13, 12, 11, 10, 11, 12, 13, 14, 13, 12, 11, 12, 13];
const V = Array.from({ length: 20 }, (_, i) => 100 + 5 * i);
V[7] = 300;
const N = null;
const TOL = 1e-8;

function assertSeries(actual: (number | null)[], expected: (number | null)[], label: string) {
  assert.strictEqual(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null) {
      assert.strictEqual(a, null, `${label}[${i}] expected null, got ${a}`);
    } else {
      assert.ok(a !== null, `${label}[${i}] expected ${e}, got null`);
      assert.ok(Math.abs(a! - e) < TOL, `${label}[${i}] expected ${e}, got ${a}`);
    }
  }
}

const EXP = {
  sma5: [N, N, N, N, 10.8, 11.0, 11.2, 11.4, 11.6, 11.8, 11.6, 11.4, 11.2, 11.4, 12.0, 12.6, 12.8, 12.6, 12.4, 12.2],
  ema5: [N, N, N, N, 10.8, 10.8666666667, 11.2444444444, 11.8296296296, 11.8864197531, 11.5909465021, 11.0606310014, 11.0404206676, 11.3602804451, 11.90685363, 12.6045690867, 12.7363793911, 12.4909195941, 11.9939463961, 11.995964264, 12.3306428427],
  rsi14: [N, N, N, N, N, N, N, N, N, N, N, N, N, N, 64.2857142857, 59.693877551, 55.4300291545, 51.4707413578, 54.9371169751, 58.155894334],
  macdLine: [N, N, N, N, N, -0.0833333333, 0.2083333333, 0.4970238095, 0.3148384354, -0.0094904033, -0.3382520738, -0.193059517, 0.1006606129, 0.405466286, 0.6706874141, 0.4553110435, 0.0990607621, -0.256608733, -0.1326894479, 0.1448087893],
  macdSignal: [N, N, N, N, N, N, N, 0.2073412698, 0.2610898526, 0.1257997247, -0.1062261746, -0.1496428458, -0.0244911165, 0.1904875848, 0.4305874994, 0.4429492715, 0.2710050168, 0.0071981419, -0.062745653, 0.0410315681],
  macdHist: [N, N, N, N, N, N, N, 0.2896825397, 0.0537485828, -0.135290128, -0.2320258992, -0.0434166712, 0.1251517293, 0.2149787012, 0.2400999147, 0.0123617721, -0.1719442547, -0.2638068749, -0.0699437949, 0.1037772211],
  volRatio20: [N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 1.2520064205],
  atr14: [N, N, N, N, N, N, N, N, N, N, N, N, N, 1.7857142857, 1.793877551, 1.8014577259, 1.8013536027, 1.8012569168, 1.8083099941, 1.8077164231],
  adx5: [N, N, N, N, N, N, N, N, N, 28.7871120285, 27.5592411579, 22.1659331552, 21.9501779655, 24.6280563917, 29.5670354373, 27.6268375113, 22.482311349, 22.3187492558, 18.7999375604, 19.4444516802],
  plusDI5: [N, N, N, N, N, 37.7777777778, 40.8791208791, 42.6872246696, 33.8367525098, 27.1666374628, 21.5591594097, 27.1455509229, 33.4744805601, 36.7130359068, 41.0648354672, 32.6737668767, 26.3078441619, 21.1555896977, 28.6997572938, 32.8661957832],
  minusDI5: [N, N, N, N, N, 21.1111111111, 16.7032967033, 13.3920704846, 22.6189436927, 28.0164710005, 34.1836575064, 27.4692534937, 21.8154136488, 17.5401819521, 13.936535751, 21.8433679076, 27.3292044346, 32.8571885095, 26.1101582674, 21.0028752252],
};

test("20-bar SMA(5) matches reference", () => {
  assertSeries(sma(C, 5), EXP.sma5, "sma5");
});

test("SMA(5) hand check: bar 4 = (10+11+12+11+10)/5 = 10.8", () => {
  assert.strictEqual(sma(C, 5)[4], 10.8);
});

test("20-bar EMA(5) matches reference (SMA-seeded)", () => {
  assertSeries(ema(C, 5), EXP.ema5, "ema5");
});

test("EMA(5) hand check: seed 10.8 at bar 4, bar 5 = (1/3)*11 + (2/3)*10.8 = 10.8667", () => {
  const e = ema(C, 5);
  assert.ok(Math.abs(e[4]! - 10.8) < TOL);
  assert.ok(Math.abs(e[5]! - (11 / 3 + (2 / 3) * 10.8)) < TOL);
});

test("20-bar RSI(14) matches reference", () => {
  assertSeries(rsi(C, 14), EXP.rsi14, "rsi14");
});

test("RSI(14) hand check at bar 14: 9 gains of 1 and 5 losses of 1 over changes 1..14 -> 100 - 100/(1+9/5) = 64.2857", () => {
  assert.ok(Math.abs(rsi(C, 14)[14]! - 100 + 100 / 2.8) < TOL);
});

test("RSI is 100 on a strictly rising series after warm-up", () => {
  const up = Array.from({ length: 20 }, (_, i) => 10 + i);
  assert.strictEqual(rsi(up, 5)[19], 100);
});

test("20-bar MACD(3,6,3) line/signal/hist match reference", () => {
  const m = macd(C, 3, 6, 3);
  assertSeries(m.line, EXP.macdLine, "macdLine");
  assertSeries(m.signal, EXP.macdSignal, "macdSignal");
  assertSeries(m.hist, EXP.macdHist, "macdHist");
});

test("MACD line hand check at bar 5: EMA3=10.75, EMA6=65/6 -> 10.75-10.8333 = -0.0833", () => {
  assert.ok(Math.abs(macd(C, 3, 6, 3).line[5]! - (10.75 - 65 / 6)) < TOL);
});

test("20-bar volume ratio(20) matches reference", () => {
  assertSeries(volumeRatio(V, 20), EXP.volRatio20, "volRatio20");
});

test("volume ratio hand check: bar 19 = 195 / mean(V0..19)=155.75 -> 1.2520", () => {
  // Sum V = 20*100 + 5*190 = 2950; replacing V7=135 with 300 adds 165 -> 3115; mean = 155.75.
  assert.ok(Math.abs(volumeRatio(V, 20)[19]! - 195 / 155.75) < TOL);
});

test("20-bar ATR(14) matches reference", () => {
  assertSeries(atr(H, L, C, 14), EXP.atr14, "atr14");
});

test("20-bar ADX(5) and +DI/-DI match reference", () => {
  const d = adx(H, L, C, 5);
  assertSeries(d.adx, EXP.adx5, "adx5");
  assertSeries(d.diPlus, EXP.plusDI5, "plusDI5");
  assertSeries(d.diMinus, EXP.minusDI5, "minusDI5");
});

test("ADX hand check: strict up-trend (DM- = 0, DX = 100 every bar) gives ADX = 100 at index 2p-1", () => {
  // H_i = 2i+1, L_i = 2i, C_i = 2i+0.5. +DM = 2, -DM = 0, TR = 2.5 -> +DI = 80, -DI = 0, DX = 100.
  const hi = Array.from({ length: 20 }, (_, i) => 2 * i + 1);
  const lo = Array.from({ length: 20 }, (_, i) => 2 * i);
  const cl = Array.from({ length: 20 }, (_, i) => 2 * i + 0.5);
  const d = adx(hi, lo, cl, 5);
  assert.strictEqual(d.adx[8], null, "no ADX before index 2p-1");
  assert.ok(Math.abs(d.adx[9]! - 100) < TOL);
  assert.ok(Math.abs(d.diPlus[9]! - 80) < TOL);
  assert.strictEqual(d.diMinus[9], 0);
});

test("ATR hand check: constant true range 2 gives ATR 2 everywhere after warm-up", () => {
  const hi = Array.from({ length: 20 }, (_, i) => 101 + i);
  const lo = Array.from({ length: 20 }, (_, i) => 99 + i);
  const cl = Array.from({ length: 20 }, (_, i) => 100 + i);
  // Each bar: H-L = 2, |H_i - C_{i-1}| = 2, |L_i - C_{i-1}| = 0, so TR = 2 for every bar.
  const a = atr(hi, lo, cl, 5);
  assert.ok(Math.abs(a[4]! - 2) < TOL, "seed");
  assert.ok(Math.abs(a[19]! - 2) < TOL, "steady");
});

test("Daily pivots: first day null, next day uses prior day's H/L/C", () => {
  const DAY = 86_400_000;
  const bars: Candle[] = [
    { time: 0, open: 10, high: 12, low: 9, close: 10.5, volume: 1 },
    { time: 12 * 3600_000, open: 10.5, high: 12.5, low: 9.5, close: 11, volume: 1 },
    { time: DAY, open: 11, high: 13, low: 10, close: 12, volume: 1 },
  ];
  const p = dailyPivots(bars);
  assert.strictEqual(p[0].pp, null);
  const pp = (12.5 + 9.0 + 11) / 3;
  assert.ok(Math.abs(p[2].pp! - pp) < TOL);
  assert.ok(Math.abs(p[2].r1! - (2 * pp - 9)) < TOL);
  assert.ok(Math.abs(p[2].s1! - (2 * pp - 12.5)) < TOL);
});

test("Daily pivots: weekend gap, Monday uses Friday", () => {
  const DAY = 86_400_000;
  // day index 2 = Friday, day index 5 = Monday (Sat/Sun absent)
  const bars: Candle[] = [
    { time: 2 * DAY, open: 10, high: 12, low: 9, close: 11, volume: 1 },
    { time: 2 * DAY + 3600_000, open: 11, high: 12.5, low: 9.5, close: 11.2, volume: 1 },
    { time: 5 * DAY, open: 11, high: 13, low: 10, close: 12, volume: 1 },
  ];
  const p = dailyPivots(bars);
  // Friday H = max(12, 12.5) = 12.5, L = min(9, 9.5) = 9, C = 11.2 (last bar close).
  assert.ok(Math.abs(p[2].pp! - (12.5 + 9 + 11.2) / 3) < TOL);
});

test("Daily pivots: same-day bars never see that day's own high/low (no look-ahead)", () => {
  const DAY = 86_400_000;
  const bars: Candle[] = [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 },
    { time: DAY, open: 11, high: 100, low: 1, close: 50, volume: 1 }, // huge day 1 range
    { time: DAY + 3600_000, open: 50, high: 50, low: 50, close: 50, volume: 1 },
  ];
  const p = dailyPivots(bars);
  // Bar 1 (day 1 opens) must use day 0 only, not the 100/1 extremes of day 1.
  assert.ok(Math.abs(p[1].pp! - (12 + 9 + 11) / 3) < TOL);
  assert.ok(Math.abs(p[2].pp! - (12 + 9 + 11) / 3) < TOL);
});

test("pivotDistance returns nearest level name and ATR distance", () => {
  const pivots = { pp: 100, r1: 105, s1: 95, r2: 110, s2: 90, r3: 115, s3: 85 };
  const d = pivotDistance(104, pivots, 2);
  assert.strictEqual(d.level, "r1");
  assert.ok(Math.abs(d.distanceAtr! - 0.5) < TOL);
});
