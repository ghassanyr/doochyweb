// Bar access for the Analysis page. Two sources, routed by asset class:
//
//   crypto  -> Binance   (about 500 liquid pairs, years of daily history)
//   all else-> cTrader   (forex, metals, indices, stocks)
//
// Crypto keeps cTrader as a fallback, so a Binance outage or a geo-block shows
// the broker's line instead of an empty card.
//
// The read path is three layers, so a page load never waits on the broker:
//
//   memory  - same-process repeat reads and the detail view's all-timeframe sweep
//   Mongo   - survives restarts, so a cold process still renders instantly
//   source  - the only network hop, and only when both caches miss or go stale
//
// When Mongo holds a stale series it is returned immediately and refreshed in
// the background, so the page is never blocked waiting for the network. Only a
// first-ever fetch for a symbol/timeframe blocks, and that is unavoidable.

import { getTimeframe } from "../timeframes";
import * as breaker from "./breaker";
import {
  readSeries,
  readBinanceSeries,
  writeSeries,
  writeBinanceSeries,
  type StoredBar,
} from "../persist";
import * as rateLimit from "./rateLimit";
import { binance } from "./binance";
import { ctrader, cTraderCatalog, marketSymbolRef } from "./ctrader";
import type {
  AnalysisSettings,
  Candle,
  MarketProvider,
  ProviderId,
  ProviderWarning,
  SymbolMeta,
  Timeframe,
} from "../types";

const REGISTRY: Record<ProviderId, MarketProvider> = { ctrader, binance };

/** Bars actually returned before a result is trusted. */
export const MIN_CANDLES = 30;

/** How long to skip the network after cTrader says "You are being rate limited".
 *  Short, because the limit is a pacing window rather than an outage. */
const RATE_LIMIT_COOLDOWN_MS = 20_000;

let lastRateLimitAt = 0;

function inRateLimitWindow(now: number): boolean {
  return now - lastRateLimitAt < RATE_LIMIT_COOLDOWN_MS;
}

/** Background refreshes already in flight, so a poll does not stack duplicates. */
const refreshing = new Set<string>();

interface CacheEntry {
  at: number;
  series: Candle[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(pid: ProviderId, meta: SymbolMeta, tf: Timeframe): string {
  return `${pid}:${meta.symbol}:${tf.id}`;
}

/** Where a series can be read from: a broker symbol id, or a Binance pair. */
type SourceRef = { kind: "ctrader"; ctid: number; symbolId: number } | { kind: "binance"; pair: string };

/**
 * Which sources to try, in order.
 *
 * Crypto goes to Binance first and falls back to the broker. Everything else is
 * broker-only: Binance carries no forex, metals, or indices, and offering it
 * first would only add failed lookups.
 */
export function providerOrder(meta: SymbolMeta): ProviderId[] {
  const order: ProviderId[] = [];
  if (meta.providers?.binance) order.push("binance");
  if (meta.providers?.ctrader) order.push("ctrader");
  return order;
}

async function resolveRef(pid: ProviderId, meta: SymbolMeta): Promise<SourceRef | null> {
  if (pid === "binance") {
    const pair = meta.providers?.binance;
    return pair ? { kind: "binance", pair } : null;
  }
  const resolved = await marketSymbolRef(meta);
  return resolved ? { kind: "ctrader", ...resolved } : null;
}

function readPersist(ref: SourceRef, tf: Timeframe) {
  return ref.kind === "binance"
    ? readBinanceSeries(ref.pair, tf.id)
    : readSeries(ref.ctid, ref.symbolId, tf.id);
}

function writePersist(ref: SourceRef, tf: Timeframe, bars: Candle[]) {
  const payload = bars as StoredBar[];
  return ref.kind === "binance"
    ? writeBinanceSeries(ref.pair, tf.id, payload)
    : writeSeries(ref.ctid, ref.symbolId, tf.id, payload);
}

export interface BarsResult {
  provider: ProviderId;
  bars: Candle[];
  warnings: ProviderWarning[];
  cached: boolean;
  /** True when the source is updating this series but we served stored bars. */
  stale: boolean;
}

export async function getCandles(
  meta: SymbolMeta,
  timeframeId: string,
  settings: AnalysisSettings = {} as AnalysisSettings,
  { force = false }: { force?: boolean } = {}
): Promise<BarsResult> {
  const tf: Timeframe = getTimeframe(timeframeId);
  const warnings: ProviderWarning[] = [];
  const order = providerOrder(meta);

  if (!order.length) {
    throw new Error(noSourceError([{ provider: "ctrader", message: "no source configured" }]));
  }

  // A non-ctrader result is always trustworthy, so a later source is only tried
  // when the earlier one produced nothing at all.
  for (const pid of order) {
    const ref = await resolveRef(pid, meta);
    if (!ref) continue;
    const hit = await readThrough(pid, meta, tf, settings, ref, warnings, force);
    if (hit) return hit;
  }

  throw new Error(noSourceError(warnings));
}

/** One source's full cache chain. Returns null when it cannot serve the series. */
async function readThrough(
  pid: ProviderId,
  meta: SymbolMeta,
  tf: Timeframe,
  settings: AnalysisSettings,
  ref: SourceRef,
  warnings: ProviderWarning[],
  force: boolean
): Promise<BarsResult | null> {
  const key = cacheKey(pid, meta, tf);

  // 1. Hot memory cache.
  const hot = cache.get(key);
  if (!force && hot && Date.now() - hot.at < tf.ttl * 1000) {
    breaker.recordSuccess(pid);
    return { provider: pid, bars: hot.series, warnings, cached: true, stale: false };
  }

  const freshAfter = Date.now() - tf.ttl * 1000;

  // 2. Mongo. A fresh stored series needs no network call at all; a stale one is
  //    still the best answer available, so return it and refresh behind it.
  if (!force) {
    const stored = await readPersist(ref, tf).catch(() => null);
    if (stored && stored.bars.length >= MIN_CANDLES) {
      const fresh = stored.fetchedAt >= freshAfter;
      cache.set(key, { at: stored.fetchedAt, series: stored.bars });
      if (fresh) {
        breaker.recordSuccess(pid);
        return { provider: pid, bars: stored.bars, warnings, cached: true, stale: false };
      }
      void refreshInBackground(pid, meta, tf, key, ref);
      return { provider: pid, bars: stored.bars, warnings, cached: true, stale: true };
    }
  }

  // 3. Network. Nothing usable stored, so this one has to wait.
  const candles = await fetchFromSource(pid, meta, tf, settings, warnings, ref);
  if (!candles.length) return null;
  cache.set(key, { at: Date.now(), series: candles });
  void writePersist(ref, tf, candles).catch(() => {});
  return { provider: pid, bars: candles, warnings, cached: false, stale: false };
}

/** Read the bars behind a resolved symbol, or null. */
export function cachedBars(meta: SymbolMeta, timeframeId: string): Candle[] | null {
  for (const pid of providerOrder(meta)) {
    const entry = cache.get(`${pid}:${meta.symbol}:${timeframeId}`);
    if (entry) return entry.series;
  }
  return null;
}

async function fetchFromSource(
  pid: ProviderId,
  meta: SymbolMeta,
  tf: Timeframe,
  settings: AnalysisSettings,
  warnings: ProviderWarning[],
  ref: SourceRef
): Promise<Candle[]> {
  const p = REGISTRY[pid];
  try {
    const release = await rateLimit.acquire(pid);
    try {
      const candles = await p.fetchCandles(meta, tf, { settings });
      if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
        throw new Error(
          `only ${candles ? candles.length : 0} bars (the source may not keep that much history)`
        );
      }
      breaker.recordSuccess(pid);
      return candles;
    } finally {
      release();
    }
  } catch (err) {
    const message = describeError(err);
    const rateLimited = /rate limit|BLOCKED_PAYLOAD_TYPE|429|418/i.test(message);
    if (rateLimited && pid === "ctrader") lastRateLimitAt = Date.now();
    breaker.recordFailure(pid, rateLimited ? "rate limit" : message);
    warnings.push({ provider: pid, message });
    // A previous run may have left usable bars in memory even when the source
    // is refusing; stale data beats an empty card.
    const stale = cache.get(cacheKey(pid, meta, tf));
    if (stale) return stale.series;
    return [];
  }
}

async function refreshInBackground(
  pid: ProviderId,
  meta: SymbolMeta,
  tf: Timeframe,
  key: string,
  ref: SourceRef
): Promise<void> {
  if (refreshing.has(key)) return;
  if (pid === "ctrader" && inRateLimitWindow(Date.now())) return;
  refreshing.add(key);
  try {
    const release = await rateLimit.acquire(pid);
    let bars: Candle[];
    try {
      bars = await REGISTRY[pid].fetchCandles(meta, tf, { settings: {} as AnalysisSettings });
      if (!Array.isArray(bars) || bars.length < MIN_CANDLES) throw new Error("too few bars");
      breaker.recordSuccess(pid);
    } finally {
      release();
    }
    cache.set(key, { at: Date.now(), series: bars });
    await writePersist(ref, tf, bars).catch(() => {});
  } catch {
    // Silent by design: the caller already has usable stored bars.
  } finally {
    refreshing.delete(key);
  }
}

/** Display names, so an error reads "from cTrader" rather than "from ctrader". */
const PROVIDER_LABEL: Record<ProviderId, string> = { ctrader: "cTrader", binance: "Binance" };

function listProviders(names: ProviderId[]): string {
  const labels = names.map((n) => PROVIDER_LABEL[n] || n);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** The only diagnostic a user gets when bars cannot be read, so it has to name
 *  every source that was tried and say why each one failed. Exported for testing. */
/** Readable text for any thrown value. cTrader rejects with plain {errorCode, description} objects. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const text = [o.errorCode, o.description ?? o.message].filter((x) => x != null && x !== "").join(": ");
    if (text) return text;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

export function noSourceError(warnings: ProviderWarning[]): string {
  if (!warnings.length) return "Could not read bars from any configured source.";
  const detail = warnings.map((w) => `${PROVIDER_LABEL[w.provider] || w.provider}: ${w.message}`).join("; ");
  const names = [...new Set(warnings.map((w) => w.provider))];
  return (
    `Could not read bars from ${listProviders(names)} (${detail}). ` +
    "Check that the source is reachable and lists this symbol."
  );
}

export function clearCache(): void {
  cache.clear();
  breaker.reset();
  rateLimit.reset();
  refreshing.clear();
  lastRateLimitAt = 0;
}

export { ctrader, cTraderCatalog, binance };
export { REGISTRY };