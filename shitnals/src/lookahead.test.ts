import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { rsi, macd, volumeRatio, atr, adx, dailyPivots, type Candle } from "./indicators.js";

/**
 * No-look-ahead test on REAL cached candles.
 * For each window [s, e) of three NON-OVERLAPPING windows, compute indicators on the prefix
 * [0, e) and on the full series, then require identical values for every bar in [s, e).
 * Any dependence on bars after i would make the two differ.
 */
const CACHE = path.join(process.cwd(), "data", "candles", "XAUUSD_15m.json");
const WINDOWS: [number, number][] = [
  [2_000, 7_000],
  [20_000, 25_000],
  [40_000, 45_000],
];

function indicatorSet(bars: Candle[]) {
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const V = bars.map((b) => b.volume);
  return {
    rsi14: rsi(C, 14),
    macdHist: macd(C, 12, 26, 9).hist,
    macdLine: macd(C, 12, 26, 9).line,
    atr14: atr(H, L, C, 14),
    adx14: adx(H, L, C, 14).adx,
    volRatio20: volumeRatio(V, 20),
    pp: dailyPivots(bars).map((p) => p.pp),
    r1: dailyPivots(bars).map((p) => p.r1),
    s1: dailyPivots(bars).map((p) => p.s1),
  };
}

test("prefix equality: indicators at bar i do not depend on bars after i (3 non-overlapping windows)", { skip: !fs.existsSync(CACHE) && "no cache" }, () => {
  const bars: Candle[] = JSON.parse(fs.readFileSync(CACHE, "utf-8"));
  const full = indicatorSet(bars);
  let compared = 0;

  for (const [s, e] of WINDOWS) {
    const pre = indicatorSet(bars.slice(0, e));
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      for (let i = s; i < e; i++) {
        const a = full[key][i];
        const b = pre[key][i];
        const same = a === b || (a != null && b != null && Math.abs(a - b) < 1e-9);
        assert.ok(same, `${key}[${i}] window [${s},${e}): full=${a} prefix=${b}`);
        compared++;
      }
    }
  }
  assert.ok(compared > 0);
  console.log(`[lookahead] compared ${compared} values across ${WINDOWS.length} windows`);
});
