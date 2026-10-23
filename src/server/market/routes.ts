// Express router for the Analysis page: watchlist, broker symbol catalog and
// technical analysis. Bars come from cTrader (ProtoOAGetTrendbarsReq) via
// src/server/market/providers/ctrader.
//
// Mounted at /api/market by index.ts. The page is public, so the read routes are
// deliberately open. Anything that mutates shared state, or forces a fresh
// broker request, sits behind authRequired: the watchlist and settings are ONE
// global document, and a forced refresh spends the shared account's rate limit.

import { Router } from "express";

import { analyze, setStrongRatio } from "./analysis";
import { detectSweep, type Sweep } from "./patterns";
import { authRequired } from "../auth";
import { resolveMarketAccount } from "./account";
import { clearCache, cTraderCatalog, getCandles } from "./providers/index";
import { cryptoPairs } from "./crypto";
import { buildCatalog, normalizeSymbol, resolveAgainstBroker, searchCatalog, toSymbolMeta } from "./symbols";
import {
  addToWatchlist,
  getSettings,
  getWatchlist,
  publicSettings,
  removeFromWatchlist,
  saveCardOrder,
  updateSettings,
} from "./store";
import { DEFAULT_TIMEFRAME, timeframeLabels, TIMEFRAMES } from "./timeframes";
import type {
  AnalysisError,
  AnalysisSettings,
  AnalysisResponse,
  CatalogEntry,
  ProviderWarning,
  SymbolMeta,
  TimeframeRating,
} from "./types";

export const marketRouter = Router();

// Bars are paced by the provider, but a wide watchlist still costs one request
// per symbol. Six at a time keeps a cold sweep responsive without tripping
// cTrader's per-payload-type throttle.
const SWEEP_CONCURRENCY = 6;

// The detail view asks for every timeframe at once; fewer in parallel because
// each is a separate payload type.
const MAX_SWEEP = 4;

/**
 * The full catalog: every symbol the account can trade, with the Binance crypto
 * universe merged in.
 *
 * Each source is optional. Without an account the crypto list still serves, so
 * the page is not blank just because cTrader credentials are missing.
 *
 * `brokerError` is kept because a missing broker catalog must not be reported as
 * "that symbol is not tradable": with an expired cTrader token the whole list
 * comes back empty, and every forex and metals symbol would otherwise claim it
 * does not exist.
 */
async function loadCatalog(): Promise<{ items: CatalogEntry[]; brokerError: string | null }> {
  const crypto = await cryptoPairs();
  let broker: string[] = [];
  let brokerError: string | null = null;
  try {
    broker = await cTraderCatalog();
  } catch (err) {
    brokerError = message(err);
  }
  return { items: buildCatalog(broker, crypto), brokerError };
}

/**
 * Resolve a requested symbol to the sources that can serve it.
 *
 * The two universes are kept apart on purpose. A crypto catalog entry carries the
 * Binance pair as its `name`, so handing the whole catalog to the broker
 * resolver would let it match "SOLUSDT" as though it were a broker symbol.
 */
function resolveMeta(symbol: string, catalog: CatalogEntry[]): SymbolMeta | null {
  const short = normalizeSymbol(symbol);
  const entry = catalog.find((c) => c.symbol === short);
  const pair = entry?.provider === "binance" ? entry.name : null;
  const brokerNames = catalog.filter((c) => c.provider !== "binance").map((c) => c.name);
  const brokerName = resolveAgainstBroker(symbol, brokerNames);
  if (!brokerName && !pair) return null;
  return toSymbolMeta(brokerName, symbol, pair);
}

/**
 * Why a symbol could not be resolved. Distinguishes "the broker is unreachable"
 * from "this symbol genuinely is not offered", which look identical when the
 * catalog is empty but call for very different fixes.
 */
function unresolvableError(symbol: string, brokerError: string | null): string {
  if (brokerError) {
    return (
      `Could not read the cTrader symbol list, so "${symbol}" cannot be checked. ` +
      `${brokerError.slice(0, 200)}`
    );
  }
  return `"${symbol}" is neither tradable on the connected cTrader account nor listed on Binance`;
}

// ---------------------------------------------------------------- config

let catalogCache: { at: number; items: CatalogEntry[]; brokerError: string | null } | null = null;
const CATALOG_TTL_MS = 60_000;

async function cachedCatalog(): Promise<CatalogEntry[]> {
  return (await cachedCatalogFull()).items;
}

/** The catalog plus whatever went wrong reading the broker half. */
async function cachedCatalogFull(): Promise<{ items: CatalogEntry[]; brokerError: string | null }> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache;
  const loaded = await loadCatalog();
  catalogCache = { at: Date.now(), ...loaded };
  return catalogCache;
}

/** Force the catalog to be re-read, e.g. after credentials change. */
export function clearCatalogCache(): void {
  catalogCache = null;
  clearCache();
}

marketRouter.get("/config", async (_req, res) => {
  const settings = await publicSettings();
  res.json({
    timeframes: timeframeLabels(),
    defaultTimeframe: DEFAULT_TIMEFRAME,
    settings,
    catalog: await cachedCatalog(),
    source: "ctrader+binance",
  });
});

marketRouter.get("/catalog", async (_req, res) => {
  res.json({ items: await cachedCatalog() });
});

marketRouter.get("/search", async (req, res) => {
  res.json({ items: searchCatalog(await cachedCatalog(), req.query.q ?? "") });
});

marketRouter.get("/account", async (_req, res) => {
  const settings = await publicSettings();
  res.json({ account: settings.account, error: settings.accountError });
});

// ---------------------------------------------------------------- watchlist

marketRouter.get("/watchlist", async (_req, res) => {
  const { watchlist, cardOrder } = await getSettings();
  res.json({ symbols: watchlist, order: cardOrder });
});

// Saved drag-and-drop layout. Auth required: the layout is shared state.
marketRouter.post("/watchlist/order", authRequired, async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order must be an array of symbols" });
    return;
  }
  res.json({ order: await saveCardOrder(order) });
});

marketRouter.post("/watchlist", authRequired, async (req, res) => {
  const symbol = req.body?.symbol;
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  const { items: catalog, brokerError } = await cachedCatalogFull();
  const typed = normalizeSymbol(symbol);
  const meta = resolveMeta(typed, catalog);
  if (!meta) {
    res.status(400).json({ error: unresolvableError(typed, brokerError) });
    return;
  }
  // Store the short form the user typed, so the watchlist stays readable.
  res.json({ symbols: await addToWatchlist(meta.symbol) });
});

marketRouter.delete("/watchlist", authRequired, async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  res.json({ symbols: await removeFromWatchlist(String(symbol)) });
});

// ---------------------------------------------------------------- settings

marketRouter.get("/settings", async (_req, res) => {
  res.json(await publicSettings());
});

marketRouter.post("/settings", authRequired, async (req, res) => {
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (body.refreshSeconds !== undefined) patch.refreshSeconds = Number(body.refreshSeconds);
  if (body.defaultTimeframe !== undefined) patch.defaultTimeframe = String(body.defaultTimeframe);
  if (body.strongRatio !== undefined) patch.strongRatio = Number(body.strongRatio);
  await updateSettings(patch);
  // A settings change can invalidate cached bars (new timeframe, new
  // sensitivity), so drop them.
  clearCache();
  res.json(await publicSettings());
});

// ---------------------------------------------------------------- analysis

marketRouter.get("/analysis", async (req, res) => {
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const symbols = req.query.symbols
    ? String(req.query.symbols).split(",").map((s) => s.trim()).filter(Boolean)
    : await getWatchlist();
  // The rating engine reads the strong-buy sensitivity from module state, so
  // prime it from the stored settings before every sweep.
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  const { items: catalog, brokerError } = await cachedCatalogFull();
  // Resolved once per sweep: it hits Mongo, and per-symbol it was pure overhead.
  const settings = await publicSettings();
  const results = await mapPool(symbols, SWEEP_CONCURRENCY, (symbol) =>
    analyzeSymbol(symbol, timeframe, catalog, settings, false, brokerError)
  );
  res.json({ timeframe, results, updatedAt: Date.now() });
});

// Force-refresh a single symbol, bypassing the bar cache. Gated: it spends the
// shared account's cTrader rate limit.
marketRouter.post("/analysis/:symbol/refresh", authRequired, async (req, res) => {
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  const settings = await publicSettings();
  res.json(await analyzeSymbol(req.params.symbol, timeframe, await cachedCatalog(), settings, true));
});

marketRouter.get("/analysis/:symbol", async (req, res) => {
  const symbol = req.params.symbol;
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const settings = await publicSettings();
  const { items: catalog, brokerError } = await cachedCatalogFull();
  const result = await analyzeSymbol(symbol, timeframe, catalog, settings, false, brokerError);
  if ((req.query.all === "1" || req.query.all === "true") && result.ok) {
    result.timeframeRatings = await ratingsForAllTimeframes(symbol, catalog, settings);
  }
  res.json(result);
});

/**
 * 4H sweep, regardless of the tab the card is showing.
 *
 * When the tab is already 4H the bars in hand are the series. Otherwise this is
 * a second read, which is a cache hit once the series has been stored. A miss
 * or a broker error must not blank the card: the sweep is a badge, not the
 * analysis.
 */
async function sweep4h(
  meta: SymbolMeta,
  timeframe: string,
  bars: Parameters<typeof detectSweep>[0],
  settings: AnalysisSettings,
  force: boolean
): Promise<Sweep | null> {
  try {
    const series = timeframe === "4h" ? bars : (await getCandles(meta, "4h", settings, { force })).bars;
    return detectSweep(series);
  } catch {
    return null;
  }
}

async function analyzeSymbol(
  symbol: string,
  timeframe: string,
  catalog: CatalogEntry[],
  settings: AnalysisSettings,
  force = false,
  brokerError: string | null = null
): Promise<AnalysisResponse | AnalysisError> {
  const meta = resolveMeta(symbol, catalog);
  if (!meta) {
    return { ok: false, symbol, error: unresolvableError(symbol, brokerError) };
  }
  try {
    const { bars, provider, warnings, cached } = await getCandles(meta, timeframe, settings, { force });
    const result = analyze(bars, meta, timeframe);
    return {
      ok: true,
      ...result,
      provider,
      cached,
      warnings,
      meta: { note: meta.note },
      sweep4h: await sweep4h(meta, timeframe, bars, settings, force),
    };
  } catch (err) {
    return {
      ok: false,
      symbol: meta.symbol,
      name: meta.name,
      type: meta.type,
      timeframe,
      error: message(err),
    };
  }
}

// Compact verdict per timeframe, so the detail view can show every timeframe at
// once without a second round of user input.
async function ratingsForAllTimeframes(
  symbol: string,
  catalog: CatalogEntry[],
  settings: AnalysisSettings
): Promise<Record<string, TimeframeRating>> {
  const meta = resolveMeta(symbol, catalog);
  if (!meta) return {};
  const entries = await mapPool(TIMEFRAMES, MAX_SWEEP, async (tf) => {
    try {
      const { bars, provider } = await getCandles(meta, tf.id, settings);
      const a = analyze(bars, meta, tf.id);
      const rating: TimeframeRating = {
        rating: a.summary.rating,
        score: a.summary.score,
        buy: a.summary.buy,
        sell: a.summary.sell,
        neutral: a.summary.neutral,
        price: a.price,
        provider,
      };
      return [tf.id, rating] as const;
    } catch (err) {
      return [tf.id, { error: message(err) }] as const;
    }
  });
  return Object.fromEntries(entries);
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Extract a usable message from anything that was thrown.
 *
 * cTrader rejects with a bare PROTO_OA_ERROR_RES object rather than an Error,
 * so the naive `String(err)` produced "[object Object]" and hid both the code
 * and the description.
 */
function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as { errorCode?: string; description?: string; message?: string; msg?: string };
    const text = o.description || o.message || o.msg;
    if (o.errorCode && text) return `${o.errorCode}: ${text}`;
    if (text) return text;
    if (o.errorCode) return o.errorCode;
  }
  return String(err);
}

// Re-exported so tests can exercise resolution without a live account.
export { resolveMarketAccount, resolveAgainstBroker, buildCatalog, toSymbolMeta };
export type { ProviderWarning };