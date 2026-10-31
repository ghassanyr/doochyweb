/**
 * Run output: out/runs/{RUN_ID}/{trades.csv, summary.json, log.txt, audit.txt}.
 * audit.txt holds 5 evenly spaced trades with full raw inputs, for hand verification.
 */
import fs from "node:fs";
import path from "node:path";
import type { Candle } from "./indicators.js";
import type { Features, SignalSpec } from "./signals.js";
import { COMMISSION_DIVISOR, COMMISSION_RAW, COMMISSION_UNIT_STATUS, ENGINE, ENGINE_VERSION, REGIME, SPREAD_TABLE, SPREAD_TABLE_DATE, roundTripCost } from "./config.js";
import { tradesToCsv, type Trade } from "./backtest.js";

export interface Summary {
  count: number;
  wins: number;
  winRate: number | null;
  totalGross: number;
  totalCost: number;
  totalNet: number;
  expectancyGross: number | null;
  expectancyNet: number | null;
  /** |mean gross| / mean cost. The headline number. */
  absGOverC: number | null;
}

export function summarize(trades: Trade[]): Summary {
  const n = trades.length;
  const totalGross = trades.reduce((s, t) => s + t.grossPnl, 0);
  const totalCost = trades.reduce((s, t) => s + t.cost, 0);
  const totalNet = trades.reduce((s, t) => s + t.netPnl, 0);
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const eG = n ? totalGross / n : null;
  const eN = n ? totalNet / n : null;
  const meanCost = n ? totalCost / n : null;
  return {
    count: n,
    wins,
    winRate: n ? wins / n : null,
    totalGross,
    totalCost,
    totalNet,
    expectancyGross: eG,
    expectancyNet: eN,
    absGOverC: n && meanCost ? Math.abs(eG!) / meanCost : null,
  };
}

const f4 = (x: number | null | undefined, d = 4) => (x == null ? "n/a" : x.toFixed(d));

function auditTrade(t: Trade, bars: Candle[], f: Features, spec: SignalSpec): string {
  const s = t.signalIdx;
  const e = t.entryIdx;
  const x = t.exitIdx;
  const b = bars[s];
  const dir = t.direction === 1 ? "LONG" : "SHORT";
  const lines: string[] = [];
  lines.push(`=== TRADE #${t.id}  ${t.variant}  ${t.symbol} ${t.timeframe}  ${dir}  split=${t.split} ===`);
  lines.push(`Signal bar  idx=${s}  ${new Date(b.time).toISOString()}  O=${b.open} H=${b.high} L=${b.low} C=${b.close} V=${b.volume}`);
  lines.push(`  RSI(${spec.rsiPeriod})=${f4(f.rsi[s], 4)}  MACDhist=${f4(f.macdHist[s], 6)}  volRatio(20)=${f4(f.volRatio[s], 4)}  ATR14=${f4(f.atr14[s], 6)}`);
  lines.push(`  ADX14=${f4(f.adx[s], 4)} -> ${f.adxReg[s]}   rangeRatio(20)=${f4(f.rangeRatio[s], 4)} -> ${f.rangeReg[s]}`);
  const p = f.pivots[s];
  lines.push(`  pivots(prev day): PP=${f4(p.pp, 4)} R1=${f4(p.r1, 4)} S1=${f4(p.s1, 4)} R2=${f4(p.r2, 4)} S2=${f4(p.s2, 4)}`);
  lines.push(`  decision: ${dir} because RSI ${t.direction === 1 ? "<=" : ">="} ${t.direction === 1 ? spec.rsiBuy : spec.rsiSell}, volRatio > ${spec.volMult}, nearest ${t.pivotLevel} at ${f4(t.pivotDistAtr, 4)} ATR (<= ${spec.pivotProximityAtr}), MACDhist ${t.direction === 1 ? ">" : "<"} 0${spec.requireMacd ? " (required)" : " (not required)"}, regimeFilter=${spec.regimeFilter}`);
  lines.push(`Fill        idx=${e}  ${new Date(bars[e].time).toISOString()}  entry = OPEN = ${t.entryPrice}`);
  lines.push(`  SL = ${t.entryPrice} ${t.direction === 1 ? "-" : "+"} ${spec.slAtr} * ${f4(t.atrAtSignal, 6)} = ${f4(t.sl, 6)}`);
  lines.push(`  TP = ${t.entryPrice} ${t.direction === 1 ? "+" : "-"} ${spec.tpAtr} * ${f4(t.atrAtSignal, 6)} = ${f4(t.tp, 6)}`);
  lines.push(`Path (idx, time, O, H, L, C):`);
  const last = Math.min(x, e + 40);
  for (let k = e; k <= last; k++) {
    const q = bars[k];
    lines.push(`  ${k}  ${new Date(q.time).toISOString()}  ${q.open}  ${q.high}  ${q.low}  ${q.close}`);
  }
  if (x > last) lines.push(`  ... (${x - last} more bars)`);
  lines.push(`Exit        idx=${x}  ${new Date(t.exitTime).toISOString()}  reason=${t.exitReason}  tie=${t.tie}  exitPrice=${t.exitPrice}  barsHeld=${t.barsHeld}`);
  const rate = COMMISSION_RAW[t.symbol]! / COMMISSION_DIVISOR / 1e6;
  lines.push(`P&L       gross = ${t.direction} * (${t.exitPrice} - ${t.entryPrice}) = ${f4(t.grossPnl, 6)}`);
  lines.push(`          cost  = spread ${SPREAD_TABLE[t.symbol]} + 2 * ${rate} * ${t.entryPrice} = ${f4(t.cost, 6)}  (check: ${f4(roundTripCost(t.symbol, t.entryPrice), 6)})`);
  lines.push(`          net   = ${f4(t.grossPnl, 6)} - ${f4(t.cost, 6)} = ${f4(t.netPnl, 6)}`);
  lines.push(`          MAE=${f4(t.mae, 6)}  MFE=${f4(t.mfe, 6)}`);
  return lines.join("\n");
}

export function writeRun(args: {
  kind: "backtest";
  symbol: string;
  timeframe: string;
  spec: SignalSpec;
  bars: Candle[];
  features: Features;
  trades: Trade[];
  testStart: number;
}): string {
  const { symbol, timeframe, spec, bars, features, trades, testStart } = args;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${stamp}_${symbol}_${timeframe}_${spec.name}_v${ENGINE_VERSION}`;
  const dir = path.join(process.cwd(), "out", "runs", runId);
  fs.mkdirSync(dir, { recursive: true });

  const train = trades.filter((t) => t.split === "train");
  const test = trades.filter((t) => t.split === "test");
  const byRegime = (reg: "regimeAdx" | "regimeRange") => {
    const keys = [...new Set(trades.map((t) => t[reg]))].sort();
    return Object.fromEntries(keys.map((k) => [k, summarize(trades.filter((t) => t[reg] === k))]));
  };
  const summary = {
    engineVersion: ENGINE_VERSION,
    runId,
    symbol,
    timeframe,
    spec,
    dataRange: { from: new Date(bars[0].time).toISOString(), to: new Date(bars[bars.length - 1].time).toISOString(), bars: bars.length },
    testStart: new Date(testStart).toISOString(),
    config: { regime: REGIME, engine: ENGINE, spread: SPREAD_TABLE[symbol], spreadDate: SPREAD_TABLE_DATE, commissionRaw: COMMISSION_RAW[symbol], commissionDivisor: COMMISSION_DIVISOR, commissionStatus: COMMISSION_UNIT_STATUS },
    all: summarize(trades),
    train: summarize(train),
    test: summarize(test),
    byRegimeAdx: byRegime("regimeAdx"),
    byRegimeRange: byRegime("regimeRange"),
    exitReasons: Object.fromEntries(
      [...new Set(trades.map((t) => t.exitReason))].sort().map((r) => [r, trades.filter((t) => t.exitReason === r).length])
    ),
    tieBars: trades.filter((t) => t.tie).length,
  };

  // audit: 5 evenly spaced trades
  const picks: Trade[] = [];
  if (trades.length) {
    for (let k = 0; k < Math.min(5, trades.length); k++) {
      picks.push(trades[Math.floor(((k + 0.5) * trades.length) / Math.min(5, trades.length))]);
    }
  }
  const audit = picks.map((t) => auditTrade(t, bars, features, spec)).join("\n\n");

  const log = [
    `RUN ${runId}`,
    `engine v${ENGINE_VERSION}  variant ${spec.name}  ${symbol} ${timeframe}`,
    `data ${summary.dataRange.from} -> ${summary.dataRange.to} (${bars.length} bars)`,
    `test period (entry >= ${summary.testStart}): ${test.length} trades; train: ${train.length} trades`,
    `trades ${trades.length}  net ${summary.all.totalNet.toFixed(4)}  gross ${summary.all.totalGross.toFixed(4)}  cost ${summary.all.totalCost.toFixed(4)}`,
    `|G|/C (all) = ${summary.all.absGOverC ?? "n/a"}`,
    `exit reasons: ${JSON.stringify(summary.exitReasons)}`,
    `tie bars (SL and TP both in range, SL taken): ${summary.tieBars}`,
    "",
    "AUDIT (5 trades, hand-verified)",
    "",
    audit,
  ].join("\n");

  fs.writeFileSync(path.join(dir, "trades.csv"), tradesToCsv(trades));
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, "log.txt"), log + "\n");
  fs.writeFileSync(path.join(dir, "audit.txt"), audit + "\n");
  console.log(log.split("\n").slice(0, 9).join("\n"));
  console.log(`[run] wrote ${dir}`);
  return dir;
}
