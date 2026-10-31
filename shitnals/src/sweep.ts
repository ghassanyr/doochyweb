/**
 * Parameter sweep. One row per (variant, regime) written to out/sweep_summary.csv.
 *
 *   tsx src/sweep.ts [--symbol=XAUUSD] [--tf=15m] [--commissionDivisor=100] [--csv=out/sweep_summary.csv]
 *
 * Grid (fixed order, deduplicated; baseline names kept where a grid point equals a baseline):
 *   rsiBuy in [20,25,30], rsiSell = 100 - rsiBuy, requireMacd in [false,true],
 *   volMult in [1.0,1.5,2.0], pivotProximityAtr in [0.25,0.5,1.0], regimeFilter in [any,ranging,trending]
 *   SL/TP fixed at 1.5 / 2.0 ATR (not swept).
 * Ranking: qualified rows only (tieRate <= 5%, regime trades >= 30), by regime-specific |G|/C.
 */
import fs from "node:fs";
import path from "node:path";
import { BASELINE_VARIANTS, computeFeatures, type SignalSpec } from "./signals.js";
import { loadCandles, testStartFor } from "./backtest.js";
import { variantRows, rowsToCsv, topQualified, fmtRow, type RegimeRow } from "./report.js";
import { COMMISSION_DIVISOR, ENGINE_VERSION, QUALIFY } from "./config.js";

export function buildSpecs(): SignalSpec[] {
  const specs: SignalSpec[] = [...BASELINE_VARIANTS];
  const seen = new Set(specs.map(paramKey));
  for (const rsiBuy of [20, 25, 30]) {
    for (const requireMacd of [false, true]) {
      for (const volMult of [1.0, 1.5, 2.0]) {
        for (const pivotProximityAtr of [0.25, 0.5, 1.0]) {
          for (const regimeFilter of ["any", "ranging", "trending"] as const) {
            const s: SignalSpec = {
              name: `g_rsi${rsiBuy}_${requireMacd ? "macd" : "nomacd"}_vol${volMult}_prox${pivotProximityAtr}_${regimeFilter}`,
              rsiPeriod: 14, rsiBuy, rsiSell: 100 - rsiBuy,
              macdFast: 12, macdSlow: 26, macdSignal: 9, requireMacd,
              volMult, pivotProximityAtr, pivotLevels: ["PP", "R1", "S1"],
              regimeFilter, slAtr: 1.5, tpAtr: 2.0,
            };
            const k = paramKey(s);
            if (!seen.has(k)) {
              seen.add(k);
              specs.push(s);
            }
          }
        }
      }
    }
  }
  return specs;
}

function paramKey(s: SignalSpec): string {
  return [s.rsiPeriod, s.rsiBuy, s.rsiSell, s.macdFast, s.macdSlow, s.macdSignal, s.requireMacd, s.volMult, s.pivotProximityAtr, s.pivotLevels.join("|"), s.regimeFilter, s.slAtr, s.tpAtr].join(",");
}

const REGIME_ORDER: Record<string, number> = { ranging: 0, trending: 1, ambiguous: 2, all: 3 };

export function runSweep(symbol: string, timeframe: string, commissionDivisor: number) {
  const bars = loadCandles(symbol, timeframe);
  const specs = buildSpecs();
  const f = computeFeatures(bars, specs[0]);
  const testStart = testStartFor(bars[bars.length - 1].time);
  const rows: RegimeRow[] = [];
  const t0 = Date.now();
  for (const spec of specs) {
    rows.push(...variantRows(spec, bars, f, testStart, symbol, timeframe, commissionDivisor));
  }
  const seconds = (Date.now() - t0) / 1000;
  rows.sort(
    (a, b) =>
      REGIME_ORDER[a.regime] - REGIME_ORDER[b.regime] ||
      (b.absGOverC ?? -1) - (a.absGOverC ?? -1) ||
      a.variant.localeCompare(b.variant)
  );
  return { rows, specs, seconds, bars };
}

if (process.argv[1]?.endsWith("sweep.ts")) {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const timeframe = get("tf", "15m");
  const divisor = Number(get("commissionDivisor", String(COMMISSION_DIVISOR)));
  const csvPath = get("csv", path.join("out", "sweep_summary.csv"));

  const { rows, specs, seconds, bars } = runSweep(symbol, timeframe, divisor);
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, rowsToCsv(rows));

  const top = (regime: "ranging" | "trending") => topQualified(rows, regime, 20);
  const topR = top("ranging");
  const topT = top("trending");
  const zeroVariants = new Set(rows.filter((r) => r.regime === "all" && r.trades === 0).map((r) => r.variant)).size;
  const tieExcluded = rows.filter((r) => r.regime === "all" && r.tieRate > QUALIFY.MAX_TIE_RATE).length;

  const lines: string[] = [];
  lines.push(`SWEEP ${symbol} ${timeframe}  engine v${ENGINE_VERSION}  commissionDivisor=${divisor}`);
  lines.push(`bars ${bars.length} (${new Date(bars[0].time).toISOString()} -> ${new Date(bars[bars.length - 1].time).toISOString()})`);
  lines.push(`variants ${specs.length} (4 baselines + grid, deduplicated)  wall ${seconds.toFixed(1)}s`);
  lines.push(`variants with zero trades: ${zeroVariants}   variants with tieRate > ${QUALIFY.MAX_TIE_RATE * 100}%: ${tieExcluded}`);
  lines.push(`CSV ${csvPath}`);
  lines.push("");
  lines.push(`TOP 20 RANGING by |G|/C (qualified only)`);
  for (const r of topR) lines.push(fmtRow(r));
  lines.push("");
  lines.push(`TOP 20 TRENDING by |G|/C (qualified only)`);
  for (const r of topT) lines.push(fmtRow(r));
  const text = lines.join("\n");
  console.log(text);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join("out", "runs", `sweep_${stamp}_${symbol}_${timeframe}_div${divisor}`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "log.txt"), text + "\n");
}
