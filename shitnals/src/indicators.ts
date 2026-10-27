/** Pure indicator functions. No I/O, no look-ahead.
 *  Every value at index `i` uses only bars[0..i] inclusive.
 *  Conventions (see README "Indicator conventions"):
 *   - EMA seeded with SMA of first `p` values, alpha = 2/(p+1).
 *   - RSI: Wilder smoothing, seed = mean of changes 1..p.
 *   - TR[0] = H0 - L0 (no prior close). ATR: seed mean TR[0..p-1], then Wilder.
 *   - ADX: DM/TR from bar 1; Wilder-smoothed sums seeded over bars 1..p (DI at index p);
 *          DX from index p; ADX seeded as mean DX[p..2p-1]; first ADX at index 2p-1.
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function smaAt(values: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let sum = 0;
  for (let j = 0; j < period; j++) sum += values[i - j];
  return sum / period;
}

/** Simple moving average series. */
export function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => smaAt(values, period, i));
}

/** Exponential moving average series, seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Relative Strength Index, Wilder smoothing. */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD: line = EMA(fast) - EMA(slow); signal = EMA(signalPeriod) of the valid line values; hist = line - signal. */
export interface MacdResult {
  line: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

export function macd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const line: (number | null)[] = fast.map((f, i) => (f == null || slow[i] == null ? null : f - slow[i]));

  const validIdx: number[] = [];
  const validVals: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] != null) {
      validIdx.push(i);
      validVals.push(line[i]!);
    }
  }
  const validSig = ema(validVals, signalPeriod);
  const signal: (number | null)[] = new Array(line.length).fill(null);
  for (let j = 0; j < validIdx.length; j++) signal[validIdx[j]] = validSig[j];

  const hist = line.map((m, i) => (m == null || signal[i] == null ? null : m - signal[i]!));
  return { line, signal, hist };
}

/** Volume ratio: volume / SMA(volume, period), same bar included. */
export function volumeRatio(volumes: number[], period = 20): (number | null)[] {
  return volumes.map((v, i) => {
    const avg = smaAt(volumes, period, i);
    return avg == null || avg === 0 ? null : v / avg;
  });
}

/** True range. TR[0] = H0 - L0. */
export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      out.push(highs[i] - lows[i]);
    } else {
      out.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
  }
  return out;
}

/** Average True Range, Wilder smoothing. */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const tr = trueRange(highs, lows, closes);
  const out: (number | null)[] = new Array(tr.length).fill(null);
  if (tr.length < period) return out;
  let val = 0;
  for (let i = 0; i < period; i++) val += tr[i];
  val /= period;
  out[period - 1] = val;
  for (let i = period; i < tr.length; i++) {
    val = (val * (period - 1) + tr[i]) / period;
    out[i] = val;
  }
  return out;
}

/** Average Directional Index with +DI / -DI, Wilder smoothing throughout. */
export interface AdxResult {
  adx: (number | null)[];
  diPlus: (number | null)[];
  diMinus: (number | null)[];
}

export function adx(highs: number[], lows: number[], closes: number[], period = 14): AdxResult {
  const n = highs.length;
  const adxOut: (number | null)[] = new Array(n).fill(null);
  const diPlus: (number | null)[] = new Array(n).fill(null);
  const diMinus: (number | null)[] = new Array(n).fill(null);
  if (n <= 2 * period - 1) return { adx: adxOut, diPlus, diMinus };

  const tr = trueRange(highs, lows, closes);
  const pdm: number[] = new Array(n).fill(0);
  const mdm: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
  }

  // Seed: sums over bars 1..period.
  let sTr = 0;
  let sPdm = 0;
  let sMdm = 0;
  for (let i = 1; i <= period; i++) {
    sTr += tr[i];
    sPdm += pdm[i];
    sMdm += mdm[i];
  }
  const dx: number[] = new Array(n).fill(NaN);
  const setDi = (i: number) => {
    diPlus[i] = sTr === 0 ? 0 : (100 * sPdm) / sTr;
    diMinus[i] = sTr === 0 ? 0 : (100 * sMdm) / sTr;
    const s = diPlus[i]! + diMinus[i]!;
    dx[i] = s === 0 ? 0 : (100 * Math.abs(diPlus[i]! - diMinus[i]!)) / s;
  };
  setDi(period);

  for (let i = period + 1; i < n; i++) {
    sTr = sTr - sTr / period + tr[i];
    sPdm = sPdm - sPdm / period + pdm[i];
    sMdm = sMdm - sMdm / period + mdm[i];
    setDi(i);
  }

  let a = 0;
  for (let i = period; i <= 2 * period - 1; i++) a += dx[i];
  a /= period;
  adxOut[2 * period - 1] = a;
  for (let i = 2 * period; i < n; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    adxOut[i] = a;
  }
  return { adx: adxOut, diPlus, diMinus };
}

/** Regime from ADX. `null` input (warm-up) -> "unknown". Bounds inclusive on the ambiguous side. */
export type AdxRegime = "trending" | "ranging" | "ambiguous" | "unknown";

export function adxRegime(adxValue: number | null, trending = 25, ranging = 20): AdxRegime {
  if (adxValue == null) return "unknown";
  if (adxValue > trending) return "trending";
  if (adxValue < ranging) return "ranging";
  return "ambiguous";
}

/** Range/ATR ratio at bar i: (highest high - lowest low over last `bars` bars) / ATR(bars) at i.
 *  Uses only bars[0..i]. `atrSeries` must be ATR with the same period as `bars`. */
export function rangeAtrRatio(
  highs: number[],
  lows: number[],
  atrSeries: (number | null)[],
  bars: number,
  i: number
): number | null {
  const hh = highestHigh(highs, bars, i);
  const ll = lowestLow(lows, bars, i);
  const a = atrSeries[i];
  if (hh == null || ll == null || a == null || a === 0) return null;
  return (hh - ll) / a;
}

/** Range regime: "ranging" when ratio < threshold, otherwise "not_ranging". */
export type RangeRegime = "ranging" | "not_ranging" | "unknown";

export function rangeRegime(ratio: number | null, threshold: number): RangeRegime {
  if (ratio == null) return "unknown";
  return ratio < threshold ? "ranging" : "not_ranging";
}

/** Traditional daily pivot levels.
 *  Each bar gets the levels computed from the PREVIOUS trading day that has bars
 *  (weekends/holidays skipped). Day boundary = UTC midnight. Null before the first full day.
 */
export interface PivotLevels {
  pp: number | null;
  r1: number | null;
  s1: number | null;
  r2: number | null;
  s2: number | null;
  r3: number | null;
  s3: number | null;
}

const EMPTY_PIVOTS: PivotLevels = { pp: null, r1: null, s1: null, r2: null, s2: null, r3: null, s3: null };

export function dailyPivots(bars: Candle[]): PivotLevels[] {
  const out: PivotLevels[] = bars.map(() => ({ ...EMPTY_PIVOTS }));
  const dayKey = (t: number) => Math.floor(t / 86_400_000);

  let curKey: number | null = null;
  let curH = -Infinity;
  let curL = Infinity;
  let curC = 0;
  let levels: PivotLevels | null = null;

  for (let i = 0; i < bars.length; i++) {
    const key = dayKey(bars[i].time);
    if (key !== curKey) {
      // Previous day is complete: compute its levels for the new day.
      if (curKey !== null) {
        const pp = (curH + curL + curC) / 3;
        levels = {
          pp,
          r1: 2 * pp - curL,
          s1: 2 * pp - curH,
          r2: pp + (curH - curL),
          s2: pp - (curH - curL),
          r3: curH + 2 * (pp - curL),
          s3: curL - 2 * (curH - pp),
        };
      }
      curKey = key;
      curH = -Infinity;
      curL = Infinity;
    }
    curH = Math.max(curH, bars[i].high);
    curL = Math.min(curL, bars[i].low);
    curC = bars[i].close;
    out[i] = levels ? { ...levels } : { ...EMPTY_PIVOTS };
  }
  return out;
}

/** Highest value over the last `period` bars ending at i. */
export function highestHigh(values: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let max = -Infinity;
  for (let j = 0; j < period; j++) max = Math.max(max, values[i - j]);
  return max;
}

/** Lowest value over the last `period` bars ending at i. */
export function lowestLow(values: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let min = Infinity;
  for (let j = 0; j < period; j++) min = Math.min(min, values[i - j]);
  return min;
}

/** Nearest pivot level to `close`, and its distance in ATR multiples. */
export function pivotDistance(
  close: number,
  pivots: PivotLevels,
  atrValue: number | null
): { level: keyof PivotLevels | null; distanceAtr: number | null } {
  if (atrValue == null || atrValue === 0) return { level: null, distanceAtr: null };
  let best: keyof PivotLevels | null = null;
  let bestDist = Infinity;
  for (const k of Object.keys(pivots) as (keyof PivotLevels)[]) {
    const v = pivots[k];
    if (v == null) continue;
    const d = Math.abs(close - v);
    if (d < bestDist) {
      bestDist = d;
      best = k;
    }
  }
  if (best == null) return { level: null, distanceAtr: null };
  return { level: best, distanceAtr: bestDist / atrValue };
}
