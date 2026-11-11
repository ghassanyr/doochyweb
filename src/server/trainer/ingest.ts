// Long-history ingestion for the trainer (Phase 1).
//
// Fetches closed BTC/ETH/SOL bars at 15m and 1h from Binance, paginates back
// HISTORY_DAYS, de-duplicates by open time, and persists flat arrays in the
// dedicated TrainerBars collection. The 480-bar UI cache is never reused.
//
// The module is split into pure helpers (planning, closed-bar filtering, merge,
// QA) and the I/O path. Tests exercise the helpers with no network and no Mongo.
//
// CLI: `pnpm trainer:ingest`. It reads MONGO_URI/MONGO_DB via connectDb, ingests
// every configured pair, prints a per-pair summary, and exits non-zero on error.

import "dotenv/config";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { getTimeframe } from "../market/timeframes";
import type { Candle } from "../market/types";
import { acquire } from "../market/providers/rateLimit";
import { readTrainerBars, writeTrainerBars } from "./bars";
import { BINANCE_PAIR, HISTORY_DAYS, SYMBOLS, TIMEFRAMES } from "./config";
import type { TrainerSymbol, TrainerTimeframe } from "./types";

const BINANCE_BASE = "https://api.binance.com/api/v3";
const DAY_MS = 86_400_000;

/** Binance caps a single klines request at 1000 rows. */
export const MAX_LIMIT = 1000;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 1_000;

/** [openTime, open, high, low, close, volume, closeTime, ...] */
type BinanceKline = (number | string)[];

export interface FetchWindow {
  startTime: number;
  limit: number;
}

export interface BarGap {
  /** Index of the first bar after the missing range. */
  index: number;
  /** Open time the next bar should have had. */
  expectedTime: number;
  actualTime: number;
  missingBars: number;
}

export interface InvalidBar {
  index: number;
  time: number;
  reasons: string[];
}

export interface BarQA {
  gaps: BarGap[];
  invalid: InvalidBar[];
}

export interface IngestSeriesResult {
  symbol: TrainerSymbol;
  timeframe: TrainerTimeframe;
  cachedBars: number;
  fetchedBars: number;
  totalBars: number;
  firstTime: number | null;
  lastTime: number | null;
  gaps: number;
  invalid: number;
}

/**
 * First page to request. With a cached series, resume one bar after the newest
 * stored open. Without one, start HISTORY_DAYS before `now`.
 */
export function planFetchWindow(
  newestCachedOpen: number | null,
  tfMs: number,
  now: number,
  historyDays: number = HISTORY_DAYS,
  limit: number = MAX_LIMIT
): FetchWindow {
  const startTime =
    newestCachedOpen == null ? now - historyDays * DAY_MS : newestCachedOpen + tfMs;
  return { startTime, limit: Math.min(limit, MAX_LIMIT) };
}

/** Open time of the page after one that ended at `lastOpenTime`. */
export function nextFetchStart(lastOpenTime: number, tfMs: number): number {
  return lastOpenTime + tfMs;
}

/** Keep only fully closed bars, sorted ascending. */
export function filterClosedBars(
  bars: readonly Candle[],
  tfMs: number,
  now: number
): Candle[] {
  return bars.filter((b) => b.time + tfMs <= now).sort((a, b) => a.time - b.time);
}

/** Merge cached and freshly fetched bars, with fresh values winning a time clash. */
export function mergeBars(
  cached: readonly Candle[],
  fresh: readonly Candle[]
): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const b of cached) byTime.set(b.time, b);
  for (const b of fresh) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Inspect a sorted series. Gaps are allowed and reported. Structurally invalid
 * bars are reported so the caller can refuse to persist a non-contiguous series.
 */
export function inspectBars(bars: readonly Candle[], tfMs: number): BarQA {
  const gaps: BarGap[] = [];
  const invalid: InvalidBar[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (i > 0) {
      const delta = bar.time - bars[i - 1].time;
      if (delta > tfMs) {
        gaps.push({
          index: i,
          expectedTime: bars[i - 1].time + tfMs,
          actualTime: bar.time,
          missingBars: Math.max(0, Math.round(delta / tfMs) - 1),
        });
      }
    }

    const reasons: string[] = [];
    const add = (reason: string) => {
      if (!reasons.includes(reason)) reasons.push(reason);
    };
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (prices.some((p) => !Number.isFinite(p))) add("non-finite price");
    if (prices.some((p) => Number.isFinite(p) && p === 0)) add("zero price");
    if (prices.some((p) => Number.isFinite(p) && p < 0)) add("negative price");

    const finiteRange = Number.isFinite(bar.high) && Number.isFinite(bar.low);
    if (finiteRange && bar.high < bar.low) add("high < low");
    if (
      finiteRange &&
      Number.isFinite(bar.open) &&
      (bar.open < bar.low || bar.open > bar.high)
    ) {
      add("open outside [low, high]");
    }
    if (
      finiteRange &&
      Number.isFinite(bar.close) &&
      (bar.close < bar.low || bar.close > bar.high)
    ) {
      add("close outside [low, high]");
    }

    if (reasons.length) invalid.push({ index: i, time: bar.time, reasons });
  }

  return { gaps, invalid };
}

/**
 * Throw when the series contains structurally invalid bars. Dropping them would
 * shift every later bar index, so the series is rejected instead.
 */
export function assertBarsValid(
  bars: readonly Candle[],
  tfMs: number,
  label: string
): BarQA {
  const qa = inspectBars(bars, tfMs);
  if (qa.invalid.length) {
    const examples = qa.invalid
      .slice(0, 5)
      .map((b) => `#${b.index} t=${b.time} (${b.reasons.join(", ")})`)
      .join("; ");
    throw new Error(
      `${label}: ${qa.invalid.length} invalid bar(s); indices must stay contiguous, so nothing was dropped. Examples: ${examples}`
    );
  }
  return qa;
}

function parseKlines(rows: readonly BinanceKline[]): Candle[] {
  return rows.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]) || 0,
  }));
}

class BinanceHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Binance HTTP ${status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    this.name = "BinanceHttpError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestKlines(
  pair: string,
  interval: string,
  startTime: number,
  limit: number
): Promise<BinanceKline[]> {
  const release = await acquire("binance");
  try {
    const url = `${BINANCE_BASE}/klines?symbol=${encodeURIComponent(
      pair
    )}&interval=${encodeURIComponent(interval)}&startTime=${startTime}&limit=${Math.min(
      limit,
      MAX_LIMIT
    )}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BinanceHttpError(res.status, body);
    }
    const data = (await res.json()) as BinanceKline[] | { msg?: string };
    if (!Array.isArray(data)) {
      throw new Error((data as { msg?: string })?.msg || "Unexpected Binance response");
    }
    return data;
  } finally {
    release();
  }
}

/** One paginated klines request, with retry for throttling and server errors. */
export async function fetchKlinesPage(
  pair: string,
  interval: string,
  startTime: number,
  limit: number = MAX_LIMIT
): Promise<BinanceKline[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestKlines(pair, interval, startTime, limit);
    } catch (err) {
      const status = err instanceof BinanceHttpError ? err.status : null;
      if (status === 451 || status === 403) {
        throw new Error(
          `Binance geo-blocked this host (HTTP ${status}); the trainer history cannot be ingested from here`
        );
      }
      const retryable =
        status === 429 || status === 418 || (status != null && status >= 500 && status <= 599);
      if (!retryable || attempt >= MAX_ATTEMPTS - 1) throw err;
      const wait = BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
      process.stderr.write(
        `[trainer] Binance HTTP ${status}; retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})\n`
      );
      await sleep(wait);
    }
  }
}

/** Fetch, merge, validate and persist one symbol/timeframe pair. */
export async function ingestSeries(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  now: number = Date.now()
): Promise<IngestSeriesResult> {
  const tf = getTimeframe(timeframe);
  const interval = tf.binance;
  if (!interval) {
    throw new Error(`Binance cannot serve trainer timeframe ${timeframe}`);
  }

  const pair = BINANCE_PAIR[symbol];
  const cached = await readTrainerBars(symbol, timeframe);
  const existing = cached?.bars ?? [];
  const newestCachedOpen = existing.length
    ? existing[existing.length - 1].time
    : null;

  const first = planFetchWindow(newestCachedOpen, tf.ms, now);
  const fetched: Candle[] = [];
  let startTime = first.startTime;

  while (startTime + tf.ms <= now) {
    const rows = await fetchKlinesPage(pair, interval, startTime, first.limit);
    if (!rows.length) break;

    const page = parseKlines(rows);
    const lastOpen = Math.max(...page.map((b) => b.time));
    fetched.push(...filterClosedBars(page, tf.ms, now));

    if (rows.length < first.limit) break;
    const next = nextFetchStart(lastOpen, tf.ms);
    if (next <= startTime) {
      throw new Error(`${symbol}:${timeframe} pagination did not advance past ${startTime}`);
    }
    startTime = next;
  }

  const merged = mergeBars(existing, fetched);
  const label = `${symbol}:${timeframe}`;
  const qa = assertBarsValid(merged, tf.ms, label);

  if (qa.gaps.length) {
    const examples = qa.gaps
      .slice(0, 5)
      .map((g) => `#${g.index} expected ${new Date(g.expectedTime).toISOString()}`)
      .join("; ");
    process.stderr.write(
      `[trainer] ${label}: ${qa.gaps.length} gap(s), allowed (${examples})\n`
    );
  }

  await writeTrainerBars(symbol, timeframe, merged);

  return {
    symbol,
    timeframe,
    cachedBars: existing.length,
    fetchedBars: fetched.length,
    totalBars: merged.length,
    firstTime: merged.length ? merged[0].time : null,
    lastTime: merged.length ? merged[merged.length - 1].time : null,
    gaps: qa.gaps.length,
    invalid: qa.invalid.length,
  };
}

/** Ingest every configured symbol/timeframe pair, logging per-pair counts. */
export async function ingestHistory(now: number = Date.now()): Promise<IngestSeriesResult[]> {
  const results: IngestSeriesResult[] = [];
  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const result = await ingestSeries(symbol, timeframe, now);
      results.push(result);
      process.stderr.write(
        `[trainer] ${symbol} ${timeframe}: cached=${result.cachedBars} fetched=${result.fetchedBars} total=${result.totalBars} gaps=${result.gaps}\n`
      );
    }
  }
  return results;
}

async function main(): Promise<void> {
  await connectDb();
  const results = await ingestHistory();
  const out = (line: string) => process.stdout.write(line + "\n");
  const iso = (t: number | null) => (t == null ? "-" : new Date(t).toISOString());

  out(`TRAINER INGEST ${new Date().toISOString()}`);
  for (const r of results) {
    out(
      `${r.symbol.padEnd(4)} ${r.timeframe.padEnd(3)} cached=${String(r.cachedBars).padStart(6)} ` +
        `fetched=${String(r.fetchedBars).padStart(5)} total=${String(r.totalBars).padStart(6)} ` +
        `gaps=${String(r.gaps).padStart(3)} ${iso(r.firstTime)} .. ${iso(r.lastTime)}`
    );
  }
  out(`TOTAL pairs=${results.length} bars=${results.reduce((s, r) => s + r.totalBars, 0)}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(
        `trainer ingest failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
