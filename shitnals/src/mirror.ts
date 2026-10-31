/**
 * Mirror (inverted twin) and the identity check.
 *
 * Per original trade: fill E, direction d, stop S, target T, cost C, net N = G - C.
 * Mirror: direction -d, same fill E, stop' = T, target' = S, re-simulated with the same walkExit
 * path rules and the same tiePolicy as the original.
 *
 *   Algebraic:   N'_alg = -N - 2C           (exact if the mirror exits at the same bar and price)
 *   Simulated:   N'_sim = dir' * (exit' - E) - C
 *
 * Tie bars break the algebra. On a tie bar both levels are in range, so the original and the mirror
 * each take the policy's choice, and each takes the level the other gave up:
 *   SL-first:  G = -s, G' = -t   ->  N'_sim = N'_alg - (s + t)
 *   TP-first:  G = +t, G' = +s   ->  N'_sim = N'_alg + (s + t)
 * with s = |E - S| and t = |T - E|. Writing tieLoss = policySign * (s + t) / 2 (policySign = +1 for
 * SL-first, -1 for TP-first) gives the corrected identity used in the README:
 *
 *   N' = -N - 2C - 2 * sum(tieLoss)
 *
 * `formulaResidual` checks this per trade and in aggregate. It must be ~0. A nonzero residual is a
 * bug in the mirror engine, not a tie effect.
 */
import { simulate, walkExit, loadCandles, testStartFor, type Trade, type TiePolicy } from "./backtest.js";
import { computeFeatures, BASELINE_VARIANTS, type SignalSpec } from "./signals.js";
import type { Candle } from "./indicators.js";
import { COMMISSION_DIVISOR } from "./config.js";

export interface MirrorRow {
  id: number;
  direction: number;
  tie: boolean;
  origExit: string;
  origExitPrice: number;
  mirrorExit: string;
  mirrorExitPrice: number;
  origNet: number;
  cost: number;
  tieLoss: number;
  algMirrorNet: number;
  simMirrorNet: number;
  divergence: number;
  formulaResidual: number;
}

export function mirrorCheck(
  trades: Trade[],
  bars: Candle[],
  opts: { maxHoldBars?: number; tiePolicy?: TiePolicy } = {}
) {
  const tiePolicy = opts.tiePolicy ?? "SL";
  const policySign = tiePolicy === "SL" ? 1 : -1;
  const opens = bars.map((b) => b.open);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);

  const rows: MirrorRow[] = trades.map((t) => {
    const mDir = (-t.direction) as 1 | -1;
    // Mirror stop sits at the original target; mirror target sits at the original stop.
    const ex = walkExit(opens, highs, lows, closes, t.entryIdx, mDir, t.tp, t.sl, t.entryPrice, opts.maxHoldBars, tiePolicy);
    const simGross = mDir * (ex.exitPrice - t.entryPrice);
    const simNet = simGross - t.cost;
    const algNet = -t.netPnl - 2 * t.cost;
    const s = Math.abs(t.entryPrice - t.sl);
    const tt = Math.abs(t.tp - t.entryPrice);
    const tieLoss = t.tie ? (policySign * (s + tt)) / 2 : 0;
    return {
      id: t.id,
      direction: t.direction,
      tie: t.tie,
      origExit: t.exitReason,
      origExitPrice: t.exitPrice,
      mirrorExit: ex.reason,
      mirrorExitPrice: ex.exitPrice,
      origNet: t.netPnl,
      cost: t.cost,
      tieLoss,
      algMirrorNet: algNet,
      simMirrorNet: simNet,
      divergence: simNet - algNet,
      formulaResidual: simNet - (-t.netPnl - 2 * t.cost - 2 * tieLoss),
    };
  });

  const TOL = 1e-9;
  const diverging = rows.filter((r) => Math.abs(r.divergence) > TOL);
  const sum = (f: (r: MirrorRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const sumN = sum((r) => r.origNet);
  const sumC = sum((r) => r.cost);
  const sumTie = sum((r) => r.tieLoss);
  const sumSim = sum((r) => r.simMirrorNet);
  const summary = {
    trades: rows.length,
    tiePolicy,
    tieTrades: rows.filter((r) => r.tie).length,
    sumOrigNet: sumN,
    sumCost: sumC,
    sumTieLoss: sumTie,
    sumAlgMirrorNet: sum((r) => r.algMirrorNet),
    sumSimMirrorNet: sumSim,
    /** Corrected identity in aggregate: N' = -N - 2C - 2*sum(tieLoss). */
    formulaMirrorNet: -sumN - 2 * sumC - 2 * sumTie,
    aggregateFormulaResidual: sumSim - (-sumN - 2 * sumC - 2 * sumTie),
    maxAbsTradeFormulaResidual: rows.reduce((m, r) => Math.max(m, Math.abs(r.formulaResidual)), 0),
    divergingTrades: diverging.length,
    divergingOnTie: diverging.filter((r) => r.tie).length,
    divergingNotTie: diverging.filter((r) => !r.tie).length,
    tolerance: TOL,
  };
  return { rows, summary };
}

// ---- CLI: tsx src/mirror.ts --symbol=XAUUSD --tf=15m --variant=minisig_b_nomacd [--tiePolicy=SL|TP] [--commissionDivisor=100] ----
function cli() {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const timeframe = get("tf", "15m");
  const variant = get("variant", "minisig_b_nomacd");
  const tiePolicy = get("tiePolicy", "SL") as TiePolicy;
  const divisor = Number(get("commissionDivisor", String(COMMISSION_DIVISOR)));
  const spec = BASELINE_VARIANTS.find((v) => v.name === variant) as SignalSpec | undefined;
  if (!spec) throw new Error(`Unknown variant ${variant}`);

  const bars = loadCandles(symbol, timeframe);
  const f = computeFeatures(bars, spec);
  const testStart = testStartFor(bars[bars.length - 1].time);
  const trades = simulate(bars, f, spec, { symbol, timeframe, testStart, tiePolicy, commissionDivisor: divisor });
  const { rows, summary } = mirrorCheck(trades, bars, { tiePolicy });

  const twin = simulate(bars, f, spec, { symbol, timeframe, testStart, invert: true, tiePolicy, commissionDivisor: divisor });
  const out = {
    symbol, timeframe, variant, tiePolicy, commissionDivisor: divisor,
    original: { trades: trades.length, net: summary.sumOrigNet, gross: trades.reduce((s, t) => s + t.grossPnl, 0), cost: summary.sumCost },
    identity: summary,
    invertedTwinFullRun: { trades: twin.length, net: twin.reduce((s, t) => s + t.netPnl, 0) },
    divergingRows: rows.filter((r) => Math.abs(r.divergence) > summary.tolerance).slice(0, 20),
  };
  console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1]?.endsWith("mirror.ts")) cli();
