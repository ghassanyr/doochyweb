import "dotenv/config";
// Breakout runner: fetches 1H and 4H bars for the watchlist through the existing
// bar cache (cTrader for FX, metals, indices; Binance for crypto), runs the
// engine, and appends one run line to the breakouts JSONL.
//
// Schedule: once per hour at HH:02 UTC, evaluating the last closed 1H boundary.
// On first start, it backfills the past 7 days by replaying the engine at every
// hourly boundary, using only bars closed by each boundary.

import fs from "node:fs";
import path from "node:path";

import { breakoutsEnabled } from "./breakouts";
import { connectDb } from "../db";
import mongoose from "mongoose";
import { evaluateSymbol, H1_MS, type EngineBreakout } from "./breakoutEngine";
import { backfillDone, breakoutsFile, firedIds, readRuns, type RunRecord, type SymbolDiagnostic } from "./breakoutFeed";
import { describeError, getCandles } from "./providers/index";
import { getWatchlist, publicSettings } from "./store";
import { loadCatalog, resolveMeta } from "./routes";
import type { Candle } from "./types";

export const BACKFILL_DAYS = 7;
const FIRST_RUN_DELAY_MS = 20_000;
const RUN_MINUTE_OFFSET_MS = 2 * 60_000;

export interface BarSet {
  bars: Record<string, { h4: Candle[]; h1: Candle[] }>;
  order: string[];
  skipped: Record<string, string>;
}

const REQUEST_GAP_MS = 1_500;
const RATE_LIMIT_RETRY_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRateLimited = (msg: string) => /rate limit|BLOCKED_PAYLOAD_TYPE/i.test(msg);

/**
 * Fetch 4H and 1H bars for every watchlist symbol. Sequential and paced, because
 * cTrader refuses bursts. Rate-limited symbols get one retry after a pause.
 */
export async function loadWatchlistBars(): Promise<BarSet> {
  const [watchlist, settings, catalog] = await Promise.all([getWatchlist(), publicSettings(), loadCatalog()]);
  const out: BarSet = { bars: {}, order: [], skipped: {} };
  const retry: { symbol: string; meta: NonNullable<ReturnType<typeof resolveMeta>> }[] = [];

  const fetchOne = async (symbol: string, meta: NonNullable<ReturnType<typeof resolveMeta>>) => {
    const h4 = await getCandles(meta, "4h", settings, { force: true });
    await sleep(REQUEST_GAP_MS);
    const h1 = await getCandles(meta, "1h", settings, { force: true });
    out.bars[symbol] = { h4: h4.bars, h1: h1.bars };
  };

  for (const symbol of watchlist) {
    const meta = resolveMeta(symbol, catalog.items);
    if (!meta) {
      out.skipped[symbol] = "not tradable on this account";
      continue;
    }
    try {
      await fetchOne(symbol, meta);
      out.order.push(symbol);
    } catch (err) {
      const msg = describeError(err);
      if (isRateLimited(msg)) retry.push({ symbol, meta });
      else out.skipped[symbol] = msg;
    }
    await sleep(REQUEST_GAP_MS);
  }

  if (retry.length) {
    await sleep(RATE_LIMIT_RETRY_MS);
    for (const { symbol, meta } of retry) {
      try {
        await fetchOne(symbol, meta);
        out.order.push(symbol);
      } catch (err) {
        out.skipped[symbol] = describeError(err);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }
  out.order.sort((a, b) => watchlist.indexOf(a) - watchlist.indexOf(b));
  return out;
}

/** Evaluate all symbols at one as-of boundary. Mutates `fired` with new ids. */
export function runAt(asOf: number, data: BarSet, fired: Set<string>, backfilled: boolean): RunRecord {
  const started = Date.now();
  const evaluated: string[] = [];
  const skipped: Record<string, string> = { ...data.skipped };
  const breakouts: EngineBreakout[] = [];
  const diagnostics: Record<string, SymbolDiagnostic> = {};
  for (const symbol of data.order) {
    const { h4, h1 } = data.bars[symbol];
    const ev = evaluateSymbol(symbol, h4, h1, asOf, fired);
    if (ev.status === "skipped") {
      skipped[symbol] = ev.reason ?? "skipped";
      continue;
    }
    evaluated.push(symbol);
    diagnostics[symbol] = {
      lastClose4h: ev.lastClose4h ?? null,
      atr: ev.atr ?? null,
      candidates: ev.candidates,
      sweepsRejected: ev.sweepsRejected,
      awaiting: ev.awaitingConfirmation.length,
    };
    for (const b of ev.breakouts) {
      fired.add(b.id);
      breakouts.push(b);
    }
  }
  return {
    kind: "breakout_run",
    timestamp_utc: new Date(asOf).toISOString(),
    asOf: new Date(asOf).toISOString(),
    backfilled,
    evaluated,
    skipped,
    breakouts,
    diagnostics,
    durationMs: Date.now() - started,
  };
}

function appendRuns(records: RunRecord[]): void {
  if (!records.length) return;
  const file = breakoutsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** Latest closed 1H boundary at or before `now`. */
export function lastBoundary(now: number): number {
  return Math.floor(now / H1_MS) * H1_MS;
}

/** One live run: evaluates the latest closed hour and appends the result. */
export async function runOnce(now = Date.now()): Promise<RunRecord> {
  const fired = firedIds(readRuns());
  const data = await loadWatchlistBars();
  const record = runAt(lastBoundary(now), data, fired, false);
  record.timestamp_utc = new Date(now).toISOString();
  appendRuns([record]);
  return record;
}

/**
 * Replay the engine at every hourly boundary of the past BACKFILL_DAYS, once.
 * Writes one run line per boundary, flagged backfilled. Writes nothing if it fails.
 */
export async function backfill(now = Date.now()): Promise<number> {
  const runs = readRuns();
  if (backfillDone(runs)) return 0;
  const fired = firedIds(runs);
  const data = await loadWatchlistBars();
  const end = lastBoundary(now);
  const start = end - BACKFILL_DAYS * 24 * H1_MS;
  const records: RunRecord[] = [];
  for (let t = start; t <= end; t += H1_MS) {
    const rec = runAt(t, data, fired, true);
    rec.timestamp_utc = new Date(t).toISOString();
    records.push(rec);
  }
  appendRuns(records);
  return records.reduce((n, r) => n + r.breakouts.length, 0);
}

// ---- schedule ------------------------------------------------------------

/** Next HH:02 UTC after `now`. */
export function nextRunAt(now: number): number {
  return lastBoundary(now) + H1_MS + RUN_MINUTE_OFFSET_MS;
}

/**
 * Start the in-process scheduler. Does nothing when ENABLE_BREAKOUTS is false.
 * Runs once shortly after boot (backfilling first if needed), then hourly.
 */
export function startBreakoutScheduler(log: (msg: string) => void = console.log): void {
  if (!breakoutsEnabled()) {
    log("[breakouts] disabled (ENABLE_BREAKOUTS=false)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const filled = await backfill();
      if (filled) log(`[breakouts] backfill wrote ${filled} breakouts over ${BACKFILL_DAYS} days`);
      const rec = await runOnce();
      log(`[breakouts] run ${rec.asOf}: ${rec.evaluated.length} evaluated, ${Object.keys(rec.skipped).length} skipped, ${rec.breakouts.length} new`);
    } catch (err) {
      log(`[breakouts] run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      setTimeout(tick, Math.max(1_000, nextRunAt(Date.now()) - Date.now()));
    }
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS);
}

// CLI: tsx src/server/market/breakoutRunner.ts [--once] [--backfill]
if (process.argv[1]?.endsWith("breakoutRunner.ts")) {
  const args = process.argv.slice(2);
  (async () => {
    await connectDb();
    if (args.includes("--backfill")) console.log("backfilled:", await backfill());
    if (args.includes("--once")) {
      const rec = await runOnce();
      console.log(JSON.stringify({ asOf: rec.asOf, evaluated: rec.evaluated, skipped: rec.skipped, breakouts: rec.breakouts }, null, 2));
    }
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      // Provider timers keep the event loop alive; the CLI is one-shot.
      process.exit(process.exitCode ?? 0);
    });
}
