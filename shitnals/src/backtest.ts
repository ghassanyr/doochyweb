/**
 * Backtest engine. Hand-rolled (no framework) so every fill can be audited.
 *
 * FILL RULES (see README "Fill rules"):
 *   - Signal decided on bar t from CLOSED bars only (features[t]).
 *   - Entry fills at bar t+1 OPEN. SL/TP sized from ATR(14) at bar t.
 *   - Bar t+1 is also checked for SL/TP against its high/low (fill bar included).
 *   - Gap: if bar's OPEN is already beyond SL or TP, exit at that OPEN (SL_GAP / TP_GAP).
 *   - Intrabar: if both SL and TP are inside the bar's range -> SL first (conservative), flagged tie=true.
 *   - Time stop: position open at entry+MAX_HOLD_BARS closes at that bar's OPEN (TIME).
 *   - End of data: closes at the last bar's CLOSE (EOD).
 *   - One position at a time. A new signal is evaluated on the exit bar's close.
 *
 * COSTS: netPnl = grossPnl - roundTripCost(symbol, entryPrice). Charged once per trade.
 */
import fs from "node:fs";
import path from "node:path";
import { computeFeatures, decide, type Features, type SignalSpec } from "./signals.js";
import { ENGINE, roundTripCost } from "./config.js";
import type { Candle } from "./indicators.js";

export type ExitReason = "SL" | "TP" | "SL_GAP" | "TP_GAP" | "TIME" | "EOD";

export interface Trade {
  id: number;
  symbol: string;
  timeframe: string;
  variant: string;
  direction: 1 | -1;
  signalIdx: number;
  signalTime: number;
  entryIdx: number;
  entryTime: number;
  entryPrice: number;
  sl: number;
  tp: number;
  atrAtSignal: number;
  exitIdx: number;
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;
  tie: boolean;
  barsHeld: number;
  grossPnl: number;
  cost: number;
  netPnl: number;
  mae: number;
  mfe: number;
  adxAtSignal: number | null;
  regimeAdx: string;
  regimeRange: string;
  rangeRatioAtSignal: number | null;
  rsiAtSignal: number | null;
  macdHistAtSignal: number | null;
  volRatioAtSignal: number | null;
  pivotLevel: string | null;
  pivotDistAtr: number | null;
  split: "train" | "test";
}

export interface ExitResult {
  exitIdx: number;
  exitPrice: number;
  reason: ExitReason;
  tie: boolean;
  mae: number;
  mfe: number;
}

/** Exit check on one bar, given the position levels. Returns null if the position stays open. */
export function checkExit(
  dir: 1 | -1,
  sl: number,
  tp: number,
  o: number,
  h: number,
  l: number
): { price: number; reason: ExitReason; tie: boolean } | null {
  if (dir === 1) {
    if (o <= sl) return { price: o, reason: "SL_GAP", tie: false };
    if (o >= tp) return { price: o, reason: "TP_GAP", tie: false };
    const slHit = l <= sl;
    const tpHit = h >= tp;
    if (slHit) return { price: sl, reason: "SL", tie: slHit && tpHit };
    if (tpHit) return { price: tp, reason: "TP", tie: false };
  } else {
    if (o >= sl) return { price: o, reason: "SL_GAP", tie: false };
    if (o <= tp) return { price: o, reason: "TP_GAP", tie: false };
    const slHit = h >= sl;
    const tpHit = l <= tp;
    if (slHit) return { price: sl, reason: "SL", tie: slHit && tpHit };
    if (tpHit) return { price: tp, reason: "TP", tie: false };
  }
  return null;
}

/**
 * Walk a position forward from `entryIdx` (its fill bar) until it exits.
 * Shared by the engine and by the mirror re-simulation, so both use identical path rules.
 */
export function walkExit(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  entryIdx: number,
  dir: 1 | -1,
  sl: number,
  tp: number,
  entryPrice: number,
  maxHoldBars: number = ENGINE.MAX_HOLD_BARS
): ExitResult {
  const n = opens.length;
  let mae = 0;
  let mfe = 0;
  for (let b = entryIdx; b < n; b++) {
    // Time stop: fills at the open of the bar that reaches the hold limit, before any intrabar move.
    if (b - entryIdx >= maxHoldBars) {
      return { exitIdx: b, exitPrice: opens[b], reason: "TIME", tie: false, mae, mfe };
    }
    // Excursions over this bar (the bar's range is within the holding period).
    if (dir === 1) {
      mae = Math.max(mae, entryPrice - lows[b]);
      mfe = Math.max(mfe, highs[b] - entryPrice);
    } else {
      mae = Math.max(mae, highs[b] - entryPrice);
      mfe = Math.max(mfe, entryPrice - lows[b]);
    }
    const hit = checkExit(dir, sl, tp, opens[b], highs[b], lows[b]);
    if (hit) return { exitIdx: b, exitPrice: hit.price, reason: hit.reason, tie: hit.tie, mae, mfe };
    if (b === n - 1) {
      return { exitIdx: b, exitPrice: closes[b], reason: "EOD", tie: false, mae, mfe };
    }
  }
  // Unreachable: loop always returns at the last bar.
  throw new Error("walkExit: ran past end of data");
}

export interface SimOptions {
  symbol: string;
  timeframe: string;
  /** Signal bars with time in [from, to) are considered. Defaults to all bars. */
  from?: number;
  to?: number;
  /** Trades with entry time >= testStart are "test"; earlier are "train". */
  testStart: number;
  maxHoldBars?: number;
  /** Inverted twin: trade the opposite direction, with SL and TP distances swapped. */
  invert?: boolean;
}

/** Simulate one SignalSpec over one series. Pure function of inputs. */
export function simulate(bars: Candle[], f: Features, spec: SignalSpec, opts: SimOptions): Trade[] {
  const n = bars.length;
  const trades: Trade[] = [];
  const hold = opts.maxHoldBars ?? ENGINE.MAX_HOLD_BARS;
  const inRange = (t: number) => (opts.from == null || t >= opts.from) && (opts.to == null || t < opts.to);

  let i = 0;
  while (i < n - 1) {
    if (!inRange(f.times[i])) {
      i++;
      continue;
    }
    const d = decide(spec, f, i);
    if (d.direction === 0) {
      i++;
      continue;
    }

    const e = i + 1;
    const dir = (opts.invert ? -d.direction : d.direction) as 1 | -1;
    const entry = f.opens[e];
    const atrSig = f.atr14[i]!;
    const slDist = (opts.invert ? spec.tpAtr : spec.slAtr) * atrSig;
    const tpDist = (opts.invert ? spec.slAtr : spec.tpAtr) * atrSig;
    const sl = dir === 1 ? entry - slDist : entry + slDist;
    const tp = dir === 1 ? entry + tpDist : entry - tpDist;

    const ex = walkExit(f.opens, f.highs, f.lows, f.closes, e, dir, sl, tp, entry, hold);
    const gross = dir * (ex.exitPrice - entry);
    const cost = roundTripCost(opts.symbol, entry);

    trades.push({
      id: trades.length,
      symbol: opts.symbol,
      timeframe: opts.timeframe,
      variant: opts.invert ? `${spec.name}__mirror` : spec.name,
      direction: dir,
      signalIdx: i,
      signalTime: f.times[i],
      entryIdx: e,
      entryTime: f.times[e],
      entryPrice: entry,
      sl,
      tp,
      atrAtSignal: atrSig,
      exitIdx: ex.exitIdx,
      exitTime: f.times[ex.exitIdx],
      exitPrice: ex.exitPrice,
      exitReason: ex.reason,
      tie: ex.tie,
      barsHeld: ex.exitIdx - e,
      grossPnl: gross,
      cost,
      netPnl: gross - cost,
      mae: ex.mae,
      mfe: ex.mfe,
      adxAtSignal: f.adx[i],
      regimeAdx: f.adxReg[i],
      regimeRange: f.rangeReg[i],
      rangeRatioAtSignal: f.rangeRatio[i],
      rsiAtSignal: f.rsi[i],
      macdHistAtSignal: f.macdHist[i],
      volRatioAtSignal: f.volRatio[i],
      pivotLevel: d.pivotLevel,
      pivotDistAtr: d.pivotDistAtr,
      split: f.times[e] >= opts.testStart ? "test" : "train",
    });

    // Resume scanning on the exit bar: its close is known, so a new signal may fire there.
    // exitIdx >= e = i+1, so this always makes progress.
    i = ex.exitIdx;
  }
  return trades;
}

/** Test-period start: TEST_MONTHS calendar months before the last bar's time. */
export function testStartFor(lastTimeMs: number, months = ENGINE.TEST_MONTHS): number {
  const d = new Date(lastTimeMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

export function loadCandles(symbol: string, timeframe: string): Candle[] {
  const dir = process.env.CACHE_DIR || path.join(process.cwd(), "data", "candles");
  return JSON.parse(fs.readFileSync(path.join(dir, `${symbol}_${timeframe}.json`), "utf-8"));
}

export function tradesToCsv(trades: Trade[]): string {
  if (!trades.length) return "";
  const cols = Object.keys(trades[0]) as (keyof Trade)[];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = trades.map((t) => cols.map((c) => esc(t[c])).join(","));
  return [cols.join(","), ...rows].join("\n") + "\n";
}

// ---- CLI: tsx src/backtest.ts --symbol=XAUUSD --tf=15m --variant=minisig_a ----
async function cli() {
  const { BASELINE_VARIANTS } = await import("./signals.js");
  const { writeRun } = await import("./runlog.js");
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const timeframe = get("tf", "15m");
  const variant = get("variant", "minisig_a");
  const spec = BASELINE_VARIANTS.find((v) => v.name === variant);
  if (!spec) throw new Error(`Unknown variant ${variant}`);

  const bars = loadCandles(symbol, timeframe);
  const f = computeFeatures(bars, spec);
  const testStart = testStartFor(bars[bars.length - 1].time);
  const trades = simulate(bars, f, spec, { symbol, timeframe, testStart });
  writeRun({ kind: "backtest", symbol, timeframe, spec, bars, features: f, trades, testStart });
}

if (process.argv[1]?.endsWith("backtest.ts")) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
