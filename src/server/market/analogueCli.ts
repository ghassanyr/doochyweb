// CLI for the analogue search. OpenClaw calls it with exec and reads stdout JSON.
// No listening port: the safest option for a tool the agent can invoke.
//
//   tsx src/server/market/analogueCli.ts --symbol=XAUUSD [--k=20] [--days=730] [--asOf=ISO]
//
// Read-only with respect to markets: it reads cTrader bars and writes only the
// local history cache under data/history/.
import "dotenv/config";
import mongoose from "mongoose";

// stdout is the JSON contract with the caller. Route any library logging to stderr.
console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");

import { connectDb } from "../db";
import { H4_MS, searchAnalogues, type SearchResult } from "./analogues";
import { loadHistory, readHistory } from "./history";
import { loadCatalog, resolveMeta } from "./routes";

function arg(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main(): Promise<SearchResult & { symbol: string }> {
  const symbol = (arg("symbol") ?? "").trim().toUpperCase();
  if (!symbol) throw new Error("--symbol is required");
  const k = Math.min(100, Math.max(1, Number(arg("k") ?? 20)));
  const days = Math.min(1000, Math.max(30, Number(arg("days") ?? 730)));
  const asOf = arg("asOf") ? Date.parse(arg("asOf")!) : Date.now();
  if (!Number.isFinite(asOf)) throw new Error("--asOf must be an ISO time");

  await connectDb();
  const catalog = await loadCatalog();
  const meta = resolveMeta(symbol, catalog.items);
  if (!meta) throw new Error(`${symbol} is not tradable on the market account`);
  const bars = await loadHistory(meta, "4h", days, asOf);
  // A series whose newest bar is old (for example a delisted or re-keyed broker symbol)
  // must fail loudly. Otherwise the search runs on years-old bars and looks plausible.
  const all = readHistory(symbol, "4h");
  const newest = all.length ? all[all.length - 1].time : 0;
  if (!bars.length || newest + 2 * H4_MS < asOf) {
    throw new Error(`${symbol}: history is stale (newest cached 4H bar ${newest ? new Date(newest).toISOString() : "none"}); refusing to search`);
  }
  return { symbol, ...searchAnalogues(bars, asOf, k) };
}

main()
  .then((res) => {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  })
  .catch((err) => {
    process.stderr.write(`analogue search failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
