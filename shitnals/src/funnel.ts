/**
 * Funnel diagnostic: for a SignalSpec, count bars surviving each condition in order, per side.
 * Used to explain zero-trade variants. Counts are cumulative (each row is ANDed with the previous).
 *   tsx src/funnel.ts --variant=minisig_c_vol15 [--symbol=XAUUSD --tf=15m]
 * With --variant omitted, runs all baseline variants.
 */
import { BASELINE_VARIANTS, computeFeatures, decide, type SignalSpec, type Features } from "./signals.js";
import { loadCandles } from "./backtest.js";

function funnel(spec: SignalSpec, f: Features) {
  const n = f.closes.length;
  const out: string[] = [];
  let validBars = 0;
  for (let i = 0; i < n; i++) {
    if (f.rsi[i] != null && f.volRatio[i] != null && f.atr14[i] != null && f.macdHist[i] != null) validBars++;
  }
  out.push(`variant ${spec.name}  (rsi ${spec.rsiPeriod} buy<=${spec.rsiBuy} sell>=${spec.rsiSell}, macd ${spec.macdFast}/${spec.macdSlow}/${spec.macdSignal} required=${spec.requireMacd}, volMult>${spec.volMult}, pivotProx<=${spec.pivotProximityAtr}ATR levels=${spec.pivotLevels.join("|")}, regime=${spec.regimeFilter})`);
  out.push(`  bars with all indicators defined: ${validBars}`);

  for (const side of [1, -1] as const) {
    const label = side === 1 ? "LONG " : "SHORT";
    const steps: [string, (i: number) => boolean][] = [];
    const regimeOk = (i: number) =>
      spec.regimeFilter === "any" || f.adxReg[i] === spec.regimeFilter;
    const rsiOk = (i: number) => (side === 1 ? f.rsi[i]! <= spec.rsiBuy : f.rsi[i]! >= spec.rsiSell);
    const volOk = (i: number) => f.volRatio[i]! > spec.volMult;
    const pivotOk = (i: number) => {
      const p = f.pivots[i];
      let best = Infinity;
      for (const name of spec.pivotLevels) {
        const lvl = p[name.toLowerCase() as keyof typeof p];
        if (lvl == null) continue;
        best = Math.min(best, Math.abs(f.closes[i] - lvl));
      }
      return best / f.atr14[i]! <= spec.pivotProximityAtr;
    };
    const macdOk = (i: number) => (side === 1 ? f.macdHist[i]! > 0 : f.macdHist[i]! < 0);
    steps.push(["regime filter", regimeOk]);
    steps.push(["RSI threshold", rsiOk]);
    steps.push(["volume > volMult", volOk]);
    steps.push(["pivot proximity", pivotOk]);
    if (spec.requireMacd) steps.push(["MACD histogram sign", macdOk]);

    let mask: boolean[] = new Array(n).fill(false).map((_, i) => f.rsi[i] != null && f.volRatio[i] != null && f.atr14[i] != null && f.macdHist[i] != null);
    out.push(`  ${label}`);
    for (const [name, fn] of steps) {
      let c = 0;
      mask = mask.map((m, i) => {
        const v = m && fn(i);
        if (v) c++;
        return v;
      });
      out.push(`    after ${name.padEnd(22)} ${String(c).padStart(7)}`);
    }
    const decided = Array.from({ length: n }, (_, i) => decide(spec, f, i).direction === side).filter(Boolean).length;
    out.push(`    engine decide() count (must match last row): ${decided}`);
  }

  // Marginal distribution hints: how often each raw condition holds on its own.
  const cnt = (fn: (i: number) => boolean) => Array.from({ length: n }, (_, i) => fn(i)).filter(Boolean).length;
  out.push(`  marginals: RSI<=${spec.rsiBuy}: ${cnt((i) => f.rsi[i] != null && f.rsi[i]! <= spec.rsiBuy)}  RSI>=${spec.rsiSell}: ${cnt((i) => f.rsi[i] != null && f.rsi[i]! >= spec.rsiSell)}  volRatio>${spec.volMult}: ${cnt((i) => f.volRatio[i] != null && f.volRatio[i]! > spec.volMult)}  ADX ranging(<20): ${cnt((i) => f.adxReg[i] === "ranging")}  ADX trending(>25): ${cnt((i) => f.adxReg[i] === "trending")}`);
  const valid = (i: number) => f.rsi[i] != null && f.macdHist[i] != null;
  const pos = cnt((i) => valid(i) && f.macdHist[i]! > 0);
  const pSum = cnt((i) => valid(i));
  const oversoldPos = cnt((i) => valid(i) && f.rsi[i]! <= spec.rsiBuy && f.macdHist[i]! > 0);
  const oversold = cnt((i) => valid(i) && f.rsi[i]! <= spec.rsiBuy);
  const overboughtNeg = cnt((i) => valid(i) && f.rsi[i]! >= spec.rsiSell && f.macdHist[i]! < 0);
  const overbought = cnt((i) => valid(i) && f.rsi[i]! >= spec.rsiSell);
  out.push(`  MACD sign: P(hist>0)=${(100*pos/pSum).toFixed(1)}% overall; P(hist>0 | RSI<=${spec.rsiBuy})=${(100*oversoldPos/Math.max(1,oversold)).toFixed(2)}% (${oversoldPos}/${oversold}); P(hist<0 | RSI>=${spec.rsiSell})=${(100*overboughtNeg/Math.max(1,overbought)).toFixed(2)}% (${overboughtNeg}/${overbought})`);
  return out.join("\n");
}

if (process.argv[1]?.endsWith("funnel.ts")) {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const symbol = get("symbol", "XAUUSD");
  const tf = get("tf", "15m");
  const only = get("variant", "");
  const bars = loadCandles(symbol, tf);
  for (const spec of BASELINE_VARIANTS) {
    if (only && spec.name !== only) continue;
    console.log(funnel(spec, computeFeatures(bars, spec)));
    console.log("");
  }
}
