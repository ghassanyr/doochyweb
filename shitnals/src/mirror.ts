/**
 * Mirror (inverted twin) and the identity check N' = -N - 2C.
 *
 * Per original trade with fill E, direction d, stop S, target T, net N = G - C:
 *   algebraic mirror net:  N'_alg = -N - 2C   (= -G - C)
 *   re-simulated mirror:   direction -d, stop' = T, target' = S, same fill E, same walkExit path rules.
 *                          N'_sim = dir' * (exit' - E) - C
 * The identity holds exactly when the mirror exits at the same bar and price as the original (G' = -G).
 * It is expected to break only on tie bars (both levels in one bar, SL taken), where each side
 * is penalized by the conservative rule. Divergences are logged, not hidden.
 */
import { simulate, walkExit, loadCandles, testStartFor, type Trade } from "./backtest.js";
import { computeFeatures, BASELINE_VARIANTS, type SignalSpec } from "./signals.js";
import type { Candle } from "./indicators.js";

export interface MirrorRow {
  id: number;
  direction: number;
  mirrorDirection: number;
  tie: boolean;
  origExit: string;
  origExitPrice: number;
  mirrorExit: string;
  mirrorExitPrice: number;
  origNet: number;
  cost: number;
  algMirrorNet: number;
  simMirrorNet: number;
  divergence: number;
}

export function mirrorCheck(trades: Trade[], bars: Candle[], opts?: { maxHoldBars?: number }) {
  const opens = bars.map((b) => b.open);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);
  const rows: MirrorRow[] = trades.map((t) => {
    const mDir = (-t.direction) as 1 | -1;
    // Mirror stop sits at the original target; mirror target sits at the original stop.
    const ex = walkExit(opens, highs, lows, closes, t.entryIdx, mDir, t.tp, t.sl, t.entryPrice, opts?.maxHoldBars);
    const simGross = mDir * (ex.exitPrice - t.entryPrice);
    const simNet = simGross - t.cost;
    const algNet = -t.netPnl - 2 * t.cost;
    return {
      id: t.id,
      direction: t.direction,
      mirrorDirection: mDir,
      tie: t.tie,
      origExit: t.exitReason,
      origExitPrice: t.exitPrice,
      mirrorExit: ex.reason,
      mirrorExitPrice: ex.exitPrice,
      origNet: t.netPnl,
      cost: t.cost,
      algMirrorNet: algNet,
      simMirrorNet: simNet,
      divergence: simNet - algNet,
    };
  });

  const TOL = 1e-9;
  const diverging = rows.filter((r) => Math.abs(r.divergence) > TOL);
  const sum = (f: (r: MirrorRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const summary = {
    trades: rows.length,
    sumOrigNet: sum((r) => r.origNet),
    sumAlgMirrorNet: sum((r) => r.algMirrorNet),
    sumSimMirrorNet: sum((r) => r.simMirrorNet),
    sumDivergence: sum((r) => r.divergence),
    divergingTrades: diverging.length,
    divergingOnTie: diverging.filter((r) => r.tie).length,
    divergingNotTie: diverging.filter((r) => !r.tie).length,
    maxAbsDivergence: diverging.reduce((m, r) => Math.max(m, Math.abs(r.divergence)), 0),
    tolerance: TOL,
    /** Exact match on every trade with no tie: the identity holds there to 1e-9 (below 0.01 = 1 cent). */
    identityHoldsOnNonTie: diverging.every((r) => r.tie),
  };
  return { rows, summary };
}

// ---- CLI: tsx src/mirror.ts --symbol=XAUUSD --tf=15m --variant=minisig_a ----
function cli() {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const timeframe = get("tf", "15m");
  const variant = get("variant", "minisig_a");
  const spec = BASELINE_VARIANTS.find((v) => v.name === variant) as SignalSpec | undefined;
  if (!spec) throw new Error(`Unknown variant ${variant}`);

  const bars = loadCandles(symbol, timeframe);
  const f = computeFeatures(bars, spec);
  const testStart = testStartFor(bars[bars.length - 1].time);
  const trades = simulate(bars, f, spec, { symbol, timeframe, testStart });
  const { rows, summary } = mirrorCheck(trades, bars);

  // Full inverted twin, independent entries and position management (reference only).
  const twin = simulate(bars, f, spec, { symbol, timeframe, testStart, invert: true });
  const twinNet = twin.reduce((s, t) => s + t.netPnl, 0);

  const cents = (x: number) => `${(x * 100).toFixed(2)}c`;
  const out = {
    symbol, timeframe, variant, spec,
    original: { trades: trades.length, net: summary.sumOrigNet, gross: trades.reduce((s, t) => s + t.grossPnl, 0), cost: trades.reduce((s, t) => s + t.cost, 0) },
    identityPerTrade: summary,
    invertedTwinFullRun: { trades: twin.length, net: twinNet },
    divergingRows: rows.filter((r) => Math.abs(r.divergence) > summary.tolerance).slice(0, 50),
  };
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nidentity sum: N=${cents(summary.sumOrigNet)}  N'_alg=${cents(summary.sumAlgMirrorNet)}  N'_sim=${cents(summary.sumSimMirrorNet)}  divergence=${cents(summary.sumDivergence)} over ${summary.divergingTrades} trades (${summary.divergingOnTie} tie, ${summary.divergingNotTie} non-tie)`);
}

if (process.argv[1]?.endsWith("mirror.ts")) cli();
