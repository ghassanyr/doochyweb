// Twelve Data, used as an independent SECOND source for cross-checking the
// broker's bars. It is deliberately NOT in the production provider order: the
// Analysis page keeps using cTrader (forex/metals/indices) and Binance (crypto).
//
// Free plan (verified 2026-11-03): FX pairs, XAU/USD, and crypto. XAG/USD,
// US100/SPX/FTSE/DAX indices are paid. Unsupported symbols are reported, not
// guessed.
//
// Shaped like a MarketProvider so it can be promoted later with a small change
// to types.ts, the registry and persist.

import { getTimeframe } from "../timeframes";
import type { Candle, SymbolMeta, Timeframe } from "../types";

const BASE = "https://api.twelvedata.com";

/** Watchlist symbol -> Twelve Data symbol. Missing means "not on the free plan". */
export const SYMBOLS: Record<string, string> = {
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD",
  XAUUSD: "XAU/USD",
  EURJPY: "EUR/JPY",
  NZDUSD: "NZD/USD",
  EURUSD: "EUR/USD",
  LTCUSD: "LTC/USD",
  BNBUSD: "BNB/USD",
  EURCAD: "EUR/CAD",
  GBPCHF: "GBP/CHF",
  BCHUSD: "BCH/USD",
  XRPUSD: "XRP/USD",
  // Paid only: XAGUSD (XAG/USD), USTECH100, GER40, US500, FTSERAFIUS1000.
};

/** Our timeframe id -> Twelve Data interval. 3m has no Twelve Data equivalent. */
export const INTERVALS: Record<string, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
  "1M": "1month",
};

/** Free plan: 8 API credits per minute, one per time_series call. */
const MIN_SPACING_MS = 8_000;
const RETRY_AFTER_MS = 60_000;

let nextAllowedAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pace(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextAllowedAt - now);
  nextAllowedAt = Math.max(now, nextAllowedAt) + MIN_SPACING_MS;
  if (wait) await sleep(wait);
}

export function apiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env.TWELVE_DATA_API_KEY ?? "").trim();
  return key || null;
}

export function tdSymbol(symbol: string): string | null {
  return SYMBOLS[symbol] ?? null;
}

export function supportsSymbol(symbol: string): boolean {
  return Boolean(SYMBOLS[symbol]);
}

export function supports(meta: SymbolMeta, tf: Timeframe): boolean {
  return Boolean(SYMBOLS[meta.symbol]) && Boolean(INTERVALS[tf.id]);
}

interface TdValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TdResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: TdValue[];
}

/** Parse a Twelve Data datetime ("YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD") as UTC. */
export function parseDatetime(dt: string): number {
  const iso = dt.includes("T") ? dt : dt.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(withZone);
}

/** Newest-first values to ascending Candle[]. Pure, so it is unit tested. */
export function parseValues(values: TdValue[]): Candle[] {
  const out: Candle[] = [];
  for (const v of values) {
    const time = parseDatetime(v.datetime);
    const open = Number(v.open), high = Number(v.high), low = Number(v.low), close = Number(v.close);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    out.push({ time, open, high, low, close, volume: Number(v.volume) || 0 });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Rebuild bars on another source's grid. Trading sessions and brokers do not share
 * bar boundaries: Twelve Data is UTC while cTrader's 4H bars sit on broker-server
 * time. Grouping the finer source into the grid bars makes the two comparable.
 */
export function resampleToGrid(fine: Candle[], grid: Candle[], ms: number): Candle[] {
  const src = [...fine].sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  let i = 0;
  for (const g of [...grid].sort((a, b) => a.time - b.time)) {
    const start = g.time, end = g.time + ms;
    while (i < src.length && src[i].time < start) i++;
    let first = -1, last = -1, high = -Infinity, low = Infinity, volume = 0;
    for (let j = i; j < src.length && src[j].time < end; j++) {
      if (first < 0) first = j;
      last = j;
      high = Math.max(high, src[j].high);
      low = Math.min(low, src[j].low);
      volume += src[j].volume;
    }
    if (first < 0) continue;
    out.push({ time: start, open: src[first].open, high, low, close: src[last].close, volume });
  }
  return out;
}

async function request(tdSymbolValue: string, interval: string, outputSize: number, key: string): Promise<Candle[]> {
  const url = new URL(`${BASE}/time_series`);
  url.searchParams.set("symbol", tdSymbolValue);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputSize));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", key);

  let res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  let body = (await res.json().catch(() => ({}))) as TdResponse;
  if (res.status === 429 || body.code === 429) {
    await sleep(RETRY_AFTER_MS);
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    body = (await res.json().catch(() => ({}))) as TdResponse;
  }
  if (!res.ok || body.status === "error" || body.code) {
    throw new Error(`Twelve Data ${tdSymbolValue} ${interval}: ${body.code ?? res.status} ${body.message ?? ""}`.trim());
  }
  if (!Array.isArray(body.values)) throw new Error(`Twelve Data ${tdSymbolValue}: no values`);
  return parseValues(body.values);
}

/** Fetch one series. Pass a timeframe id our app knows (1h, 4h, ...). */
export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  opts: { outputSize?: number; key?: string | null } = {}
): Promise<Candle[]> {
  const key = opts.key ?? apiKey();
  if (!key) throw new Error("TWELVE_DATA_API_KEY is not set");
  const symbol = SYMBOLS[meta.symbol];
  if (!symbol) throw new Error(`${meta.symbol} is not on the Twelve Data free plan`);
  const interval = INTERVALS[tf.id];
  if (!interval) throw new Error(`Twelve Data has no ${tf.id} interval`);
  await pace();
  return request(symbol, interval, opts.outputSize ?? 500, key);
}

/** Timeframe helper for callers that only have an id. */
export function withTimeframe(id: string): Timeframe {
  return getTimeframe(id);
}

export const twelveData = { id: "twelvedata" as const, supports, fetchCandles, supportsSymbol, tdSymbol };
