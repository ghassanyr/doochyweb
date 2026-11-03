// Historical analogue search: "when did the market look like this before, and
// what happened next?" Deterministic, no model. The AI (later phase) only reads
// this output; it never computes it.
//
// Feature vector at closed 4H bar i (uses bars 0..i only):
//   rsi14, atrPct (ATR14 / close * 100), adx14, volRatio (vol_i / mean of prior 20),
//   rangeRatio ((HH20 - LL20) / ATR20). Scaled by z-score over the candidate pool.
//
// Outcome of a candidate at bar i, horizon H bars after the fill bar:
//   entry = open[i+1]; up = entry + ATR_i; down = entry - ATR_i.
//   up_first / down_first: the first bar in the window that touches that level.
//   tie: one bar touches both. neither: no touch within H bars.
//   mfe / mae: max favourable / adverse excursion in ATR_i units over the window.
//
// No lookahead: a candidate is eligible only if its whole outcome window closed
// at or before asOf, and the query uses only the last closed bar before asOf.

import { adx, atr, rsi } from "./indicators";
import type { Candle } from "./types";

export const H4_MS = 4 * 3_600_000;
export const HORIZON = 6; // 24 hours on 4H
export const TEST_MS = 182 * 86_400_000; // last ~6 months before asOf is "test"
export const WARMUP = 40;

export type Outcome = "up_first" | "down_first" | "tie" | "neither";
export const FEATURES = ["rsi14", "atrPct", "adx14", "volRatio", "rangeRatio"] as const;
type Feature = (typeof FEATURES)[number];

export interface Row {
  i: number;
  time: number;
  f: Record<Feature, number>;
  atr: number;
  entry: number;
  outcome: Outcome;
  mfe: number;
  mae: number;
  split: "train" | "test";
}

export interface Match extends Row {
  distance: number;
}

/** Wilson 95% interval for a proportion. Small samples give wide intervals, on purpose. */
export function wilson(k: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.96, p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export interface Summary {
  n: number;
  up_first: number;
  down_first: number;
  tie: number;
  neither: number;
  upFirstRate: number | null;
  downFirstRate: number | null;
  upFirstCI95: [number, number] | null;
  downFirstCI95: [number, number] | null;
  medianMfe: number | null;
  medianMae: number | null;
}

export interface SearchResult {
  asOf: string;
  lastBarTime: string;
  query: Record<Feature, number>;
  k: number;
  poolSize: number;
  matches: Match[];
  matchSummary: Summary;
  baseRate: Summary;
  bySplit: { train: Summary; test: Summary };
  matchSplit: { train: number; test: number };
  note: string;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Feature vectors and outcomes for every bar index that is computable. Index-aligned to `bars`. */
export function buildRows(bars: Candle[]): { rows: (Row | null)[]; feats: (Record<Feature, number> | null)[] } {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const rsiS = rsi(closes, 14);
  const atrS = atr(bars, 14);
  const atr20 = atr(bars, 20);
  const adxS = adx(bars, 14).adx;
  const feats: (Record<Feature, number> | null)[] = new Array(n).fill(null);
  const rows: (Row | null)[] = new Array(n).fill(null);

  for (let i = WARMUP; i < n; i++) {
    const r = rsiS[i], a = atrS[i], a20 = atr20[i], d = adxS[i];
    if (r == null || a == null || a20 == null || d == null || a <= 0 || a20 <= 0) continue;
    let vs = 0;
    for (let j = i - 20; j < i; j++) vs += bars[j].volume;
    const vAvg = vs / 20;
    if (vAvg <= 0) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 19; j <= i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
    feats[i] = {
      rsi14: r,
      atrPct: (a / bars[i].close) * 100,
      adx14: d,
      volRatio: bars[i].volume / vAvg,
      rangeRatio: (hh - ll) / a20,
    };
  }

  for (let i = WARMUP; i + 1 + HORIZON - 1 < n; i++) {
    const f = feats[i];
    if (!f) continue;
    const atrI = atrS[i]!;
    const entry = bars[i + 1].open;
    const up = entry + atrI, down = entry - atrI;
    let outcome: Outcome = "neither";
    let mfe = 0, mae = 0;
    for (let j = i + 1; j <= i + HORIZON; j++) {
      const b = bars[j];
      mfe = Math.max(mfe, (b.high - entry) / atrI);
      mae = Math.max(mae, (entry - b.low) / atrI);
      if (outcome !== "neither") continue;
      const upHit = b.high >= up, downHit = b.low <= down;
      if (upHit && downHit) outcome = "tie";
      else if (upHit) outcome = "up_first";
      else if (downHit) outcome = "down_first";
    }
    rows[i] = { i, time: bars[i].time, f, atr: atrI, entry, outcome, mfe, mae, split: "train" };
  }
  return { rows, feats };
}

export function summarize(rows: Row[]): Summary {
  const c = { up_first: 0, down_first: 0, tie: 0, neither: 0 } as Record<Outcome, number>;
  for (const r of rows) c[r.outcome]++;
  const n = rows.length;
  return {
    n,
    up_first: c.up_first, down_first: c.down_first, tie: c.tie, neither: c.neither,
    upFirstRate: n ? c.up_first / n : null,
    downFirstRate: n ? c.down_first / n : null,
    upFirstCI95: wilson(c.up_first, n),
    downFirstCI95: wilson(c.down_first, n),
    medianMfe: median(rows.map((r) => r.mfe)),
    medianMae: median(rows.map((r) => r.mae)),
  };
}

/**
 * Search for the k nearest historical moments to the last closed bar before asOf.
 * Pure: the same bars and asOf always give the same answer.
 */
export function searchAnalogues(bars: Candle[], asOf: number, k = 20): SearchResult {
  const closed = bars.filter((b) => b.time + H4_MS <= asOf).sort((a, b) => a.time - b.time);
  if (closed.length < WARMUP + HORIZON + 2) throw new Error(`need more closed 4H bars (have ${closed.length})`);
  const q = closed.length - 1;

  // Rows are built only from bars that closed before asOf, so no future data enters.
  const { rows, feats } = buildRows(closed);
  const qFeat = feats[q];
  if (!qFeat) throw new Error("query bar has no complete feature vector");

  // Eligible: outcome window fully closed by asOf. buildRows requires i+HORIZON < n,
  // which for closed bars means the outcome bars are all closed. Split by age.
  const pool: Row[] = [];
  for (const r of rows) {
    if (!r) continue;
    if (r.i + HORIZON > q) continue;
    r.split = r.time >= asOf - TEST_MS ? "test" : "train";
    pool.push(r);
  }
  if (pool.length < 10) throw new Error(`pool too small (${pool.length})`);

  // Z-score each feature over the eligible pool only.
  const stats = FEATURES.map((name) => {
    const xs = pool.map((r) => r.f[name]);
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1;
    return { name, m, sd };
  });
  const z = (f: Record<Feature, number>) => stats.map((s) => (f[s.name] - s.m) / s.sd);
  const qz = z(qFeat);

  const scored: Match[] = pool.map((r) => {
    const rz = z(r.f);
    const d = Math.sqrt(rz.reduce((s, v, j) => s + (v - qz[j]) ** 2, 0));
    return { ...r, distance: d };
  });
  scored.sort((a, b) => a.distance - b.distance || a.time - b.time);
  const matches = scored.slice(0, Math.max(1, k));

  const queryRaw = Object.fromEntries(FEATURES.map((f) => [f, qFeat[f]])) as Record<Feature, number>;
  return {
    asOf: new Date(asOf).toISOString(),
    lastBarTime: new Date(closed[q].time).toISOString(),
    query: queryRaw,
    k: matches.length,
    poolSize: pool.length,
    matches,
    matchSummary: summarize(matches),
    baseRate: summarize(pool),
    bySplit: {
      train: summarize(pool.filter((r) => r.split === "train")),
      test: summarize(pool.filter((r) => r.split === "test")),
    },
    matchSplit: {
      train: matches.filter((r) => r.split === "train").length,
      test: matches.filter((r) => r.split === "test").length,
    },
    note: "Historical base rates for similar bars. Not a forecast. Outcomes are measured in ATR units over 6 bars after entry at the next bar's open.",
  };
}
