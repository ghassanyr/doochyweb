// Dry run of the ported scraper rules on live bars. Writes nothing (no captures, no CSV,
// no Telegram, no state). It prints the observations, the capture that would be written,
// and a parity table against the public doochy.net analysis API.
//
//   tsx src/server/market/scraperDryRun.ts [--compare=https://doochy.net]
import "dotenv/config";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { collectObservations } from "./scraperCollect";
import { buildCapture, engulfClosed, structureClosed, type Obs } from "./scraperRules";

// stdout is the report. Library logging goes to stderr.
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const out = (s: string) => process.stdout.write(s + "\n");

const base = (process.argv.find((a) => a.startsWith("--compare=")) ?? "--compare=https://doochy.net").split("=")[1];

async function apiRows(tf: string): Promise<Map<string, any>> {
  const res = await fetch(`${base}/api/market/analysis?timeframe=${tf}`);
  if (!res.ok) throw new Error(`API ${tf}: HTTP ${res.status}`);
  const j = (await res.json()) as { results: any[] };
  return new Map(j.results.map((r) => [r.symbol, r]));
}

const sweepOf = (s: ReturnType<typeof structureClosed>): string | null =>
  s.sweepLow && s.sweepHigh ? "both" : s.sweepLow ? "low" : s.sweepHigh ? "high" : null;

async function main() {
  await connectDb();
  const now = Date.now();
  const [coll, api4, api1] = await Promise.all([collectObservations(now), apiRows("4h"), apiRows("1h")]);

  const obs: Obs[] = coll.symbols.map((s) => s.obs);
  const table: string[] = [];
  const diffs: { symbol: string; e4: string; e1: string; sw: string }[] = [];

  for (const s of coll.symbols) {
    const { symbol, obs: o } = s;
    const a4 = api4.get(symbol), a1 = api1.get(symbol);
    const ourSweep = sweepOf(o.structure4h);
    const apiSweep = a4?.sweep4h ?? null;

    // The API ran the legacy detectors, which treated the last bar as still forming.
    // cTrader series have no forming bar, so the API read one bar too far back. If the
    // API matches our value one bar earlier, the difference is that, not the rules.
    const c4p = s.closed4h.slice(0, -1), c1p = s.closed1h.slice(0, -1);
    const lag = { e4: engulfClosed(c4p), e1: engulfClosed(c1p), sw: sweepOf(structureClosed(c4p)) };
    const cmp = (ours: unknown, api: unknown, lagged: unknown) => {
      const a = api ?? null, o2 = ours ?? null;
      if (a === o2) return "=";
      return a === lagged ? "lag" : "DIFF";
    };
    const e4 = cmp(o.engulf4h, a4?.engulfing, lag.e4);
    const e1 = cmp(o.engulf1h, a1?.engulfing, lag.e1);
    const sw = cmp(ourSweep, apiSweep, lag.sw);
    diffs.push({ symbol, e4, e1, sw });
    table.push([
      symbol.padEnd(15),
      `rating ${s.rating ?? "-"}/${a4?.summary?.rating ?? "-"}`.padEnd(30),
      `4h engulf ${o.engulf4h ?? "-"}/${a4?.engulfing ?? "-"} [${e4}]`.padEnd(38),
      `1h engulf ${o.engulf1h ?? "-"}/${a1?.engulfing ?? "-"} [${e1}]`.padEnd(38),
      `sweep ${ourSweep ?? "-"}/${apiSweep ?? "-"} [${sw}]`,
    ].join(" "));
  }

  const capture = buildCapture({ timestamp_utc: new Date(now - (now % 3_600_000)).toISOString(), obs, changes: [], needles: [] });
  out(`DRY RUN ${new Date(now).toISOString()}  watchlist ${coll.watchlist.length}, evaluated ${obs.length}`);
  out("\nPARITY  (ours / doochy.net API, same bars class; differences are timing or cache)");
  out(table.join("\n"));
  const all = diffs.flatMap((d) => [d.e4, d.e1, d.sw]);
  out(`\nSUMMARY  comparisons ${all.length}: equal ${all.filter((x) => x === "=").length}, explained by one-bar lag ${all.filter((x) => x === "lag").length}, unexplained ${all.filter((x) => x === "DIFF").length}`);
  out("\nSKIPPED");
  const skipped = Object.entries(coll.skipped).map(([k, v]) => `${k}: ${v}`);
  out(skipped.length ? skipped.join("\n") : "(none)");
  out("\nCAPTURE THAT WOULD BE WRITTEN (not written)");
  out(JSON.stringify(capture, null, 2));
}

main()
  .catch((err) => { process.stderr.write(`dry run failed: ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
