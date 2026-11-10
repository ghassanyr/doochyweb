// Cross-check the production bars against Twelve Data, an independent source.
// Reads only: no captures, no state.
//
//   tsx src/server/market/crossCheck.ts [--timeframe=1h] [--symbols=BTCUSD,XAUUSD] [--output=400]
//
// Primary source is whatever getCandles() uses: Binance for crypto, cTrader for
// FX, metals and indices. Twelve Data's free plan covers FX, XAU and crypto;
// silver and indices are skipped.
//
// 1H grids line up on the hour, so bars are compared directly. 4H bars do not:
// cTrader sits on broker-server time while Twelve Data is UTC, so Twelve Data 1H
// bars are folded onto the primary 4H grid before comparing.

import "dotenv/config";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { getCandles } from "./providers/index";
import { twelveData, resampleToGrid, supportsSymbol } from "./providers/twelveData";
import { loadCatalog, resolveMeta } from "./catalog";
import { closedBars } from "./scraperCollect";
import { engulfClosed, structureClosed } from "./scraperRules";
import { getWatchlist, publicSettings } from "./store";
import { getTimeframe } from "./timeframes";
import type { Candle } from "./types";

console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const out = (s: string) => process.stdout.write(s + "\n");

const arg = (name: string, fallback: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const sweep = (b: Candle[]) => {
  const s = structureClosed(b);
  return s.sweepLow && s.sweepHigh ? "both" : s.sweepLow ? "low" : s.sweepHigh ? "high" : "-";
};

function compare(primary: Candle[], other: Candle[]) {
  const m = new Map(other.map((b) => [b.time, b]));
  const pairs: { a: number; b: number }[] = [];
  for (const p of primary) {
    const o = m.get(p.time);
    if (o) pairs.push({ a: p.close, b: o.close });
  }
  if (!pairs.length) return null;
  const bps = pairs.map((p) => ((p.b - p.a) / p.a) * 10_000);
  const abs = bps.map(Math.abs);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  let cov = 0, va = 0, vb = 0, ma = 0, mb = 0;
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    ra.push((pairs[i].a - pairs[i - 1].a) / pairs[i - 1].a);
    rb.push((pairs[i].b - pairs[i - 1].b) / pairs[i - 1].b);
  }
  ma = mean(ra); mb = mean(rb);
  for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
  return {
    n: pairs.length,
    meanAbsBps: mean(abs),
    maxAbsBps: Math.max(...abs),
    corr: va && vb ? cov / Math.sqrt(va * vb) : NaN,
    first: iso(primary.find((p) => m.has(p.time))!.time),
    last: iso([...primary].reverse().find((p) => m.has(p.time))!.time),
  };
}

async function main() {
  await connectDb();
  const now = Date.now();
  const tfId = arg("timeframe", "1h");
  const tf = getTimeframe(tfId);
  const output = Number(arg("output", "400")) || 400;
  const only = arg("symbols", "").split(",").map((s) => s.trim()).filter(Boolean);

  const [watchlist, settings, catalog] = await Promise.all([getWatchlist(), publicSettings(), loadCatalog()]);
  const symbols = only.length ? watchlist.filter((s) => only.includes(s)) : watchlist;
  if (only.length && symbols.length !== only.length) {
    for (const s of only) if (!watchlist.includes(s)) out(`note: ${s} is not on the watchlist`);
  }

  out(`CROSS-CHECK ${new Date(now).toISOString()}  timeframe ${tfId}  primary vs Twelve Data`);
  const rows: string[] = [];
  const skipped: string[] = [];

  for (const symbol of symbols) {
    const meta = resolveMeta(symbol, catalog.items);
    if (!meta) { skipped.push(`${symbol}: not tradable`); continue; }
    if (!supportsSymbol(symbol)) { skipped.push(`${symbol}: not on the Twelve Data free plan`); continue; }
    try {
      const primary = await getCandles(meta, tfId, settings, { force: true });
      const pClosed = closedBars(primary.bars, tfId, now);
      if (primary.bars.length < 40) { skipped.push(`${symbol}: too few primary bars`); continue; }

      let td: Candle[];
      if (tfId === "4h") {
        const fine = await twelveData.fetchCandles(meta, getTimeframe("1h"), { outputSize: 5000 });
        const fineClosed = closedBars(fine, "1h", now);
        td = resampleToGrid(fineClosed, pClosed, tf.ms);
      } else {
        td = closedBars(await twelveData.fetchCandles(meta, tf, { outputSize: Math.min(5000, Math.max(output, 100)) }), tfId, now);
      }

      const cmp = compare(pClosed.slice(-output), td);
      if (!cmp) { skipped.push(`${symbol}: no overlapping bars`); continue; }

      const pe = engulfClosed(pClosed) ?? "-";
      const te = engulfClosed(td) ?? "-";
      const ps = sweep(pClosed);
      const ts = sweep(td);
      const agree = pe === te && ps === ts ? "yes" : "NO";
      rows.push([
        symbol.padEnd(15),
        primary.provider.padEnd(8),
        String(cmp.n).padStart(4),
        cmp.meanAbsBps.toFixed(2).padStart(8),
        cmp.maxAbsBps.toFixed(2).padStart(8),
        cmp.corr.toFixed(4).padStart(8),
        `engulf ${pe}/${te}`.padEnd(20),
        `sweep ${ps}/${ts}`.padEnd(18),
        agree,
      ].join(" "));
    } catch (err) {
      skipped.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  out("");
  out("SYMBOL          PRIMARY     N   meanBps   maxBps     corr   pattern (primary/TD)  agree");
  out(rows.join("\n") || "(none)");
  out("\nSKIPPED");
  out(skipped.length ? skipped.join("\n") : "(none)");
  out("\nmeanBps/maxBps are absolute close gaps in basis points. corr is the 1-step return correlation.");
}

main()
  .catch((err) => { process.stderr.write(`cross-check failed: ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
