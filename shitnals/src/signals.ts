/**
 * Signal variants. A signal decision at bar t uses features[t] only, which are computed from
 * bars[0..t] (closed bars). Entries are filled at bar t+1 open (see README "Fill rules").
 */
import { rsi, macd, volumeRatio, atr, adx, dailyPivots, rangeAtrRatio, adxRegime, rangeRegime, type PivotLevels, type Candle, type AdxRegime, type RangeRegime } from "./indicators.js";
import { REGIME } from "./config.js";

export type PivotName = "PP" | "R1" | "S1" | "R2" | "S2";

export type SignalSpec = {
  name: string;
  rsiPeriod: number;
  rsiBuy: number;
  rsiSell: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  requireMacd: boolean;
  volMult: number; // volume > volMult * 20-bar average
  pivotProximityAtr: number; // within N ATR of a pivot level
  pivotLevels: PivotName[];
  regimeFilter: "any" | "ranging" | "trending";
  slAtr: number;
  tpAtr: number;
};

/** Hand-written baselines. These are approximations of the old MiniSig described in the brief
 *  (RSI + MACD + volume + pivot proximity). The actual MiniSig source was NOT inspected. */
export const BASELINE_VARIANTS: SignalSpec[] = [
  {
    name: "minisig_a",
    rsiPeriod: 14, rsiBuy: 30, rsiSell: 70,
    macdFast: 12, macdSlow: 26, macdSignal: 9, requireMacd: true,
    volMult: 1.0, pivotProximityAtr: 0.5, pivotLevels: ["PP", "R1", "S1"],
    regimeFilter: "any", slAtr: 1.5, tpAtr: 2.0,
  },
  {
    name: "minisig_b_nomacd",
    rsiPeriod: 14, rsiBuy: 30, rsiSell: 70,
    macdFast: 12, macdSlow: 26, macdSignal: 9, requireMacd: false,
    volMult: 1.0, pivotProximityAtr: 0.5, pivotLevels: ["PP", "R1", "S1"],
    regimeFilter: "any", slAtr: 1.5, tpAtr: 2.0,
  },
  {
    name: "minisig_c_vol15",
    rsiPeriod: 14, rsiBuy: 30, rsiSell: 70,
    macdFast: 12, macdSlow: 26, macdSignal: 9, requireMacd: true,
    volMult: 1.5, pivotProximityAtr: 0.5, pivotLevels: ["PP", "R1", "S1"],
    regimeFilter: "any", slAtr: 1.5, tpAtr: 2.0,
  },
  {
    name: "minisig_d_ranging",
    rsiPeriod: 14, rsiBuy: 30, rsiSell: 70,
    macdFast: 12, macdSlow: 26, macdSignal: 9, requireMacd: true,
    volMult: 1.0, pivotProximityAtr: 0.5, pivotLevels: ["PP", "R1", "S1"],
    regimeFilter: "ranging", slAtr: 1.5, tpAtr: 2.0,
  },
];

/** All per-bar features needed by any spec. Index i uses bars[0..i] only. */
export interface Features {
  times: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  rsi: (number | null)[];
  macdHist: (number | null)[];
  volRatio: (number | null)[];
  atr14: (number | null)[];
  rangeRatio: (number | null)[];
  adx: (number | null)[];
  adxReg: AdxRegime[];
  rangeReg: RangeRegime[];
  pivots: PivotLevels[];
}

export function computeFeatures(bars: Candle[], spec: Pick<SignalSpec, "rsiPeriod" | "macdFast" | "macdSlow" | "macdSignal">): Features {
  const opens = bars.map((b) => b.open);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const atr14 = atr(highs, lows, closes, 14);
  const atrRange = atr(highs, lows, closes, REGIME.RANGE_BARS);
  const adxSeries = adx(highs, lows, closes, REGIME.ADX_PERIOD).adx;
  const rangeRatio = closes.map((_, i) => rangeAtrRatio(highs, lows, atrRange, REGIME.RANGE_BARS, i));
  return {
    times: bars.map((b) => b.time),
    opens, highs, lows, closes,
    rsi: rsi(closes, spec.rsiPeriod),
    macdHist: macd(closes, spec.macdFast, spec.macdSlow, spec.macdSignal).hist,
    volRatio: volumeRatio(volumes, 20),
    atr14,
    rangeRatio,
    adx: adxSeries,
    adxReg: adxSeries.map((v) => adxRegime(v, REGIME.ADX_TRENDING, REGIME.ADX_RANGING)),
    rangeReg: rangeRatio.map((r) => rangeRegime(r, REGIME.RANGE_ATR_RANGING)),
    pivots: dailyPivots(bars),
  };
}

export interface Decision {
  direction: 1 | -1 | 0;
  pivotLevel: PivotName | null;
  pivotDistAtr: number | null;
}

const NO_SIGNAL: Decision = { direction: 0, pivotLevel: null, pivotDistAtr: null };

/**
 * Decision for bar t, evaluated after bar t closes.
 *   long  : rsi <= rsiBuy, volRatio > volMult, near listed pivot, (macdHist > 0 if requireMacd), regime ok
 *   short : rsi >= rsiSell, volRatio > volMult, near listed pivot, (macdHist < 0 if requireMacd), regime ok
 * Any null input (warm-up) -> no signal.
 */
export function decide(spec: SignalSpec, f: Features, t: number): Decision {
  const r = f.rsi[t];
  const vr = f.volRatio[t];
  const a = f.atr14[t];
  const h = f.macdHist[t];
  if (r == null || vr == null || a == null || a === 0 || h == null) return NO_SIGNAL;

  if (spec.regimeFilter === "ranging" && f.adxReg[t] !== "ranging") return NO_SIGNAL;
  if (spec.regimeFilter === "trending" && f.adxReg[t] !== "trending") return NO_SIGNAL;
  if (vr <= spec.volMult) return NO_SIGNAL;

  // Nearest listed pivot to the close.
  const close = f.closes[t];
  const p = f.pivots[t];
  let best: PivotName | null = null;
  let bestDist = Infinity;
  for (const name of spec.pivotLevels) {
    const lvl = p[name.toLowerCase() as keyof PivotLevels];
    if (lvl == null) continue;
    const d = Math.abs(close - lvl);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  if (best == null) return NO_SIGNAL;
  const pivotDistAtr = bestDist / a;
  if (pivotDistAtr > spec.pivotProximityAtr) return NO_SIGNAL;

  if (r <= spec.rsiBuy && (!spec.requireMacd || h > 0)) return { direction: 1, pivotLevel: best, pivotDistAtr };
  if (r >= spec.rsiSell && (!spec.requireMacd || h < 0)) return { direction: -1, pivotLevel: best, pivotDistAtr };
  return NO_SIGNAL;
}
