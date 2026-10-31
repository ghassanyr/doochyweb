import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { BASELINE_VARIANTS, computeFeatures, type SignalSpec } from "./signals.js";
import { simulate, testStartFor, type Trade, type TiePolicy } from "./backtest.js";
import { mirrorCheck } from "./mirror.js";
import type { Candle } from "./indicators.js";

/**
 * Correctness check of the mirror engine against the corrected identity
 *   N' = -N - 2C - 2 * sum(tieLoss),   tieLoss = policySign * (s + t) / 2 on tie trades.
 * Run on real cached bars at tight levels, where tie bars occur. Residual must be ~0.
 */
const CACHE = path.join(process.cwd(), "data", "candles", "XAUUSD_15m.json");
const base = BASELINE_VARIANTS.find((v) => v.name === "minisig_b_nomacd")!;
const LEVELS: [number, number][] = [
  [1.0, 1.0],
  [0.5, 0.5],
  [0.3, 0.3],
];

for (const [sl, tp] of LEVELS) {
  for (const policy of ["SL", "TP"] as TiePolicy[]) {
    test(`identity N' = -N - 2C - 2*sum(tieLoss) holds, sl=${sl} tp=${tp} policy=${policy}`, { skip: !fs.existsSync(CACHE) && "no cache" }, () => {
      const bars: Candle[] = JSON.parse(fs.readFileSync(CACHE, "utf-8"));
      const spec: SignalSpec = { ...base, name: `id_${sl}_${tp}`, slAtr: sl, tpAtr: tp };
      const f = computeFeatures(bars, spec);
      const trades: Trade[] = simulate(bars, f, spec, {
        symbol: "XAUUSD",
        timeframe: "15m",
        testStart: testStartFor(bars[bars.length - 1].time),
        tiePolicy: policy,
      });
      const { summary, rows } = mirrorCheck(trades, bars, { tiePolicy: policy });
      assert.ok(trades.length > 0, "no trades");
      assert.ok(Math.abs(summary.aggregateFormulaResidual) < 1e-6, `aggregate residual ${summary.aggregateFormulaResidual}`);
      assert.ok(summary.maxAbsTradeFormulaResidual < 1e-9, `per-trade residual ${summary.maxAbsTradeFormulaResidual}`);
      // Non-tie trades must match the plain algebraic identity exactly.
      assert.strictEqual(summary.divergingNotTie, 0);
      if (policy === "SL") {
        // Divergence on tie trades equals -(s+t) summed over tie trades.
        const expected = rows.filter((r) => r.tie).reduce((acc, r) => acc - 2 * r.tieLoss, 0);
        assert.ok(Math.abs(summary.sumSimMirrorNet - summary.sumAlgMirrorNet - expected) < 1e-6);
      }
      if (sl === 0.5 && tp === 0.5) {
        console.log(`[identity] sl=${sl} tp=${tp} ${policy}-first: trades=${trades.length} ties=${summary.tieTrades} divergence=${(summary.sumSimMirrorNet - summary.sumAlgMirrorNet).toFixed(6)} formula=${(-2 * summary.sumTieLoss).toFixed(6)}`);
      }
    });
  }
}
