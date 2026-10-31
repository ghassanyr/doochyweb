/**
 * Per-variant, per-regime report rows for the sweep.
 *
 * Definitions:
 *   gross, costs, net  : sums over trades in the regime (regime = ADX regime at the signal bar).
 *   |G|/C              : |sum gross| / sum costs  (= |mean gross| / mean cost).
 *   G/C (signed)       : sum gross / sum costs.   Negative means the signal lost money gross.
 *   tieRate            : variant-level, SL-first run: tie trades / trades.
 *   slFirstNet, tpFirstNet : variant-level net under each tie policy (the band).
 *   band_width         : per regime, |net(TP-first) - net(SL-first)|.
 *   identityResidual   : |aggregate residual| of N' = -N - 2C - 2*sum(tieLoss), SL-first. Must be ~0.
 *   qualified          : tieRate <= QUALIFY.MAX_TIE_RATE and trades >= QUALIFY.MIN_REGIME_TRADES.
 *
 * The aggregate ("all") row is context only. Shortlists are ranked on regime-specific |G|/C.
 */
import type { Trade, TiePolicy } from "./backtest.js";
import { simulate } from "./backtest.js";
import { mirrorCheck } from "./mirror.js";
import type { SignalSpec, Features } from "./signals.js";
import type { Candle } from "./indicators.js";
import { QUALIFY } from "./config.js";

export const REGIMES = ["ranging", "trending", "ambiguous", "all"] as const;
export type RegimeName = (typeof REGIMES)[number];

export interface RegimeRow {
  variant: string;
  regime: RegimeName;
  trades: number;
  gross: number;
  costs: number;
  net: number;
  absGOverC: number | null;
  gOverC: number | null;
  winrate: number | null;
  tieRate: number;
  slFirstNet: number;
  tpFirstNet: number;
  bandWidth: number;
  trainGOverC: number | null;
  testGOverC: number | null;
  identityResidual: number;
  qualified: boolean;
  excludeReason: string;
  rsi: string;
  macd: string;
  volMult: number;
  pivotProx: number;
  regimeFilter: string;
  slAtr: number;
  tpAtr: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function regimeSubset(trades: Trade[], r: RegimeName): Trade[] {
  return r === "all" ? trades : trades.filter((t) => t.regimeAdx === r);
}

function ratio(g: number, c: number): number | null {
  return c > 0 ? g / c : null;
}

/** Build the report rows for one variant. Runs SL-first and TP-first simulations. */
export function variantRows(spec: SignalSpec, bars: Candle[], f: Features, testStart: number, symbol: string, timeframe: string, commissionDivisor?: number): RegimeRow[] {
  const slTrades = simulate(bars, f, spec, { symbol, timeframe, testStart, tiePolicy: "SL", commissionDivisor });
  const tpTrades = simulate(bars, f, spec, { symbol, timeframe, testStart, tiePolicy: "TP", commissionDivisor });
  const tieRate = slTrades.length ? slTrades.filter((t) => t.tie).length / slTrades.length : 0;
  const slFirstNet = sum(slTrades.map((t) => t.netPnl));
  const tpFirstNet = sum(tpTrades.map((t) => t.netPnl));
  const identityResidual = Math.abs(mirrorCheck(slTrades, bars, { tiePolicy: "SL" as TiePolicy }).summary.aggregateFormulaResidual);

  return REGIMES.map((r) => {
    const s = regimeSubset(slTrades, r);
    const tp = regimeSubset(tpTrades, r);
    const gross = sum(s.map((t) => t.grossPnl));
    const costs = sum(s.map((t) => t.cost));
    const net = sum(s.map((t) => t.netPnl));
    const tpNet = sum(tp.map((t) => t.netPnl));
    const train = s.filter((t) => t.split === "train");
    const test = s.filter((t) => t.split === "test");
    const trainG = sum(train.map((t) => t.grossPnl));
    const trainC = sum(train.map((t) => t.cost));
    const testG = sum(test.map((t) => t.grossPnl));
    const testC = sum(test.map((t) => t.cost));
    const wins = s.filter((t) => t.netPnl > 0).length;

    let excludeReason = "";
    if (tieRate > QUALIFY.MAX_TIE_RATE) excludeReason = `tieRate ${(tieRate * 100).toFixed(1)}% > ${QUALIFY.MAX_TIE_RATE * 100}%`;
    else if (s.length < QUALIFY.MIN_REGIME_TRADES) excludeReason = `trades ${s.length} < ${QUALIFY.MIN_REGIME_TRADES}`;
    const qualified = excludeReason === "";

    const absG = ratio(Math.abs(gross), costs);
    return {
      variant: spec.name,
      regime: r,
      trades: s.length,
      gross,
      costs,
      net,
      absGOverC: absG,
      gOverC: ratio(gross, costs),
      winrate: s.length ? wins / s.length : null,
      tieRate,
      slFirstNet,
      tpFirstNet,
      bandWidth: Math.abs(tpNet - net),
      trainGOverC: ratio(trainG, trainC),
      testGOverC: ratio(testG, testC),
      identityResidual,
      qualified,
      excludeReason,
      rsi: `${spec.rsiPeriod}:${spec.rsiBuy}/${spec.rsiSell}`,
      macd: spec.requireMacd ? "on" : "off",
      volMult: spec.volMult,
      pivotProx: spec.pivotProximityAtr,
      regimeFilter: spec.regimeFilter,
      slAtr: spec.slAtr,
      tpAtr: spec.tpAtr,
    };
  });
}

export const CSV_COLUMNS: (keyof RegimeRow | string)[] = [
  "variant", "regime", "trades", "gross", "costs", "net", "|G|/C", "winrate", "tieRate", "band_width", "qualified",
  "G_over_C", "slFirstNet", "tpFirstNet", "train_G_over_C", "test_G_over_C", "identityResidual", "excludeReason",
  "rsi", "macd", "volMult", "pivotProx", "regimeFilter", "slAtr", "tpAtr",
];

function cell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: RegimeRow[]): string {
  const map = (r: RegimeRow): unknown[] => [
    r.variant, r.regime, r.trades, r.gross, r.costs, r.net, r.absGOverC, r.winrate, r.tieRate, r.bandWidth, r.qualified,
    r.gOverC, r.slFirstNet, r.tpFirstNet, r.trainGOverC, r.testGOverC, r.identityResidual, r.excludeReason,
    r.rsi, r.macd, r.volMult, r.pivotProx, r.regimeFilter, r.slAtr, r.tpAtr,
  ];
  return [CSV_COLUMNS.join(","), ...rows.map((r) => map(r).map(cell).join(","))].join("\n") + "\n";
}

/** Top-N qualified rows in a regime, by |G|/C descending. Ties broken by variant name (deterministic). */
export function topQualified(rows: RegimeRow[], regime: RegimeName, n = 20): RegimeRow[] {
  return rows
    .filter((r) => r.regime === regime && r.qualified && r.trades > 0 && r.absGOverC != null)
    .sort((a, b) => (b.absGOverC! - a.absGOverC!) || a.variant.localeCompare(b.variant))
    .slice(0, n);
}

export function fmtRow(r: RegimeRow): string {
  const f = (x: number | null, d = 3) => (x == null ? "n/a" : x.toFixed(d));
  return `${r.variant.padEnd(44)} n=${String(r.trades).padStart(4)}  |G|/C=${f(r.absGOverC).padStart(7)}  G/C=${f(r.gOverC).padStart(7)}  net=${r.net.toFixed(2).padStart(9)}  win=${f(r.winrate).padStart(6)}  tie=${(r.tieRate * 100).toFixed(1).padStart(5)}%  band=${r.bandWidth.toFixed(2).padStart(8)}  trainG/C=${f(r.trainGOverC).padStart(7)}  testG/C=${f(r.testGOverC).padStart(7)}`;
}

