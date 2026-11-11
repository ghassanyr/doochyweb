// Express router for the Analysis page: watchlist, broker symbol catalog and
// technical analysis. Bars come from cTrader (ProtoOAGetTrendbarsReq) via
// src/server/market/providers/ctrader.
//
// Mounted at /api/market by index.ts. The page is public, so the read routes are
// deliberately open. The watchlist and card layout are curated by an admin and
// sit behind adminRequired. Analysis settings remain open to signed-in users,
// and a forced refresh sits behind authRequired because it spends the shared
// account's rate limit.

import { Router } from "express";

import { analyze, applyLatestPrice, setStrongRatio } from "./analysis";
import { readCaptures } from "./captures";
import {
  BREAKOUT_TYPES,
  breakoutKey,
  breakoutsEnabled,
  dedupe,
  filterBreakouts,
  normalizeBreakouts,
  sortNewestFirst,
  type BreakoutType,
} from "./breakouts";
import { latestRun, readRuns } from "./breakoutFeed";
import { TEMPLATE_MODEL } from "./narration";
import { listNarrations } from "./narrationStore";
import { detectSweep, isLastBarForming, type Sweep } from "./patterns";
import { authRequired, adminRequired } from "../auth";
import { resolveMarketAccount } from "./account";
import {
  cachedCatalog,
  cachedCatalogFull,
  resolveMeta,
  unresolvableError,
} from "./catalog";
import { clearCache, getCandles } from "./providers/index";
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
import { DEFAULT_TIMEFRAME, getTimeframe, timeframeLabels, TIMEFRAMES } from "./timeframes";
import type {
  AnalysisError,
  AnalysisSettings,
  AnalysisResponse,
  Candle,
  CatalogEntry,
  ConfluenceResponse,
  ProviderId,
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

// ---------------------------------------------------------------- config

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

// Saved drag-and-drop layout. Admin only: the layout is shared state.
marketRouter.post("/watchlist/order", adminRequired, async (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order must be an array of symbols" });
    return;
  }
  res.json({ order: await saveCardOrder(order) });
});

marketRouter.post("/watchlist", adminRequired, async (req, res) => {
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

marketRouter.delete("/watchlist", adminRequired, async (req, res) => {
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

// OpenClaw capture log. Written by the doochy-scraper cron, read here so the
// browser never needs filesystem access. Public like the rest of the analysis
// reads: it is market commentary, not account data.
marketRouter.get("/captures", async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 40));
  try {
    res.json({ captures: await readCaptures(limit), updatedAt: Date.now() });
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

// Breakout feed, newest first. Served from the same JSONL as /captures. Filters:
// types (comma list), session, symbol (substring). Pagination: limit (max 200) and offset. The live
// sidebar asks for limit=20; the historical log pages with offset.
marketRouter.get("/breakouts", async (req, res) => {
  const updatedAt = Date.now();
  if (!breakoutsEnabled()) {
    res.json({ enabled: false, total: 0, breakouts: [], updatedAt, lastRun: null });
    return;
  }
  const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string).trim() : "");
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  // Absent = no type filter. Present but empty = no types selected = nothing matches.
  const types = typeof req.query.types === "string"
    ? (req.query.types as string)
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is BreakoutType => (BREAKOUT_TYPES as readonly string[]).includes(t))
    : undefined;
  try {
    // Captures are capped at 1000 lines; the writer appends about one per hour.
    const captures = await readCaptures(1000);
    const runs = readRuns();
    const all = dedupe(
      sortNewestFirst([
        ...normalizeBreakouts(runs.flatMap((r) => r.breakouts)),
        ...captures.flatMap((c) => c.breakouts),
      ])
    );
    const last = latestRun(runs);
    const lastRun = last
      ? {
          timestamp_utc: last.timestamp_utc,
          asOf: last.asOf,
          evaluated: last.evaluated.length,
          skipped: Object.keys(last.skipped).length,
          skippedDetail: last.skipped,
          newBreakouts: last.breakouts.length,
          error: last.error ?? null,
        }
      : null;
    const matched = filterBreakouts(all, {
      types,
      session: q("session").toLowerCase() || undefined,
      symbol: q("symbol") || undefined,
    });
    const page = matched.slice(offset, offset + limit).map((b) => ({ ...b, event_key: breakoutKey(b) }));
    res.json({ enabled: true, total: matched.length, breakouts: page, updatedAt, lastRun });
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

// Public research note for one breakout event. Reads saved, published records
// only; a page view never spends a model call. 404 keeps the feed quiet when a
// note is still being generated or was withheld by the guard.
marketRouter.get("/narrations", async (req, res) => {
  const event = typeof req.query.event === "string" ? req.query.event.trim() : "";
  if (!event) {
    res.status(400).json({ error: "event is required" });
    return;
  }
  if (event.length > 300) {
    res.status(400).json({ error: "event key is too long" });
    return;
  }
  try {
    const note = listNarrations().find(
      (r) =>
        r.event_key === event &&
        r.published !== false &&
        !r.error &&
        r.model !== TEMPLATE_MODEL &&
        r.output.trim().length > 0
    );
    if (!note) {
      res.status(404).json({ error: "no published research note" });
      return;
    }
    res.json({
      event_key: event,
      symbol: note.symbol ?? note.input.breakouts[0]?.symbol ?? null,
      text: note.output,
      model: note.model,
      created_at: note.created_at,
      prompt_version: note.prompt_version,
      brief: note.input.breakouts[0]?.brief ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

// Force-refresh a single symbol, bypassing the bar cache. Gated: it spends the
// shared account's cTrader rate limit. `all=1` also attaches the per-timeframe
// strip the detail sheet renders, so opening a card is one request.
marketRouter.post("/analysis/:symbol/refresh", authRequired, async (req, res) => {
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  const settings = await publicSettings();
  const catalog = await cachedCatalog();
  const result = await analyzeSymbol(req.params.symbol, timeframe, catalog, settings, true);
  if (result.ok && (req.query.all === "1" || req.query.all === "true")) {
    const snapshot = await ratingsForAllTimeframes(req.params.symbol, catalog, settings);
    result.timeframeRatings = pinSelectedRating(snapshot.timeframes, result);
  }
  res.json(result);
});

// Compact all-timeframe verdict for the card ribbon. Reading ten cached series
// is cheap; the expensive part is rerunning the indicators. Cache one snapshot
// per symbol and reuse it until any timeframe's bars change, so the ribbon
// cannot lag behind the card's selected-timeframe analysis.
interface ConfluenceCacheEntry {
  version: string;
  value: ConfluenceResponse;
}
const confluenceCache = new Map<string, ConfluenceCacheEntry>();
const confluenceInFlight = new Map<string, Promise<ConfluenceResponse>>();

interface TimeframeSeries {
  id: string;
  bars?: Candle[];
  provider?: ProviderId;
  version: string;
  error?: string;
}

async function readTimeframes(
  meta: SymbolMeta,
  settings: AnalysisSettings
): Promise<TimeframeSeries[]> {
  return mapPool(TIMEFRAMES, MAX_SWEEP, async (tf) => {
    try {
      const { bars, provider, version } = await getCandles(meta, tf.id, settings);
      return { id: tf.id, bars, provider, version };
    } catch (err) {
      const error = message(err);
      return { id: tf.id, error, version: `error:${error}` };
    }
  });
}

async function confluenceFor(
  meta: SymbolMeta,
  settings: AnalysisSettings
): Promise<ConfluenceResponse> {
  const key = `${normalizeSymbol(meta.symbol)}|${settings.strongRatio}`;
  const running = confluenceInFlight.get(key);
  if (running) return running;
  const task = (async () => {
    try {
      const reads = await readTimeframes(meta, settings);
      const version = reads.map((r) => `${r.id}=${r.version}`).join("|");
      const cached = confluenceCache.get(key);
      if (cached && cached.version === version) return cached.value;
      const value: ConfluenceResponse = {
        symbol: meta.symbol,
        updatedAt: Date.now(),
        timeframes: ratingsFromReads(meta, reads),
      };
      confluenceCache.set(key, { version, value });
      return value;
    } finally {
      confluenceInFlight.delete(key);
    }
  })();
  confluenceInFlight.set(key, task);
  return task;
}

marketRouter.get("/analysis/:symbol/confluence", async (req, res) => {
  const symbol = req.params.symbol;
  // The rating engine reads its sensitivity from module state.
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  const settings = await publicSettings();
  const { items: catalog, brokerError } = await cachedCatalogFull();
  const meta = resolveMeta(symbol, catalog);
  if (!meta) {
    res.status(404).json({ error: unresolvableError(symbol, brokerError) });
    return;
  }
  try {
    res.json(await confluenceFor(meta, settings));
  } catch (err) {
    res.status(500).json({ error: message(err) });
  }
});

marketRouter.get("/analysis/:symbol", async (req, res) => {
  const symbol = req.params.symbol;
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const settings = await publicSettings();
  const { items: catalog, brokerError } = await cachedCatalogFull();
  const result = await analyzeSymbol(symbol, timeframe, catalog, settings, false, brokerError);
  if ((req.query.all === "1" || req.query.all === "true") && result.ok) {
    const snapshot = await ratingsForAllTimeframes(symbol, catalog, settings);
    result.timeframeRatings = pinSelectedRating(snapshot.timeframes, result);
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
    return detectSweep(series, isLastBarForming(series, getTimeframe("4h").ms));
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
    // cTrader bars stop at the last closed bar, so the newest close can be a
    // full timeframe old. Show the latest 1-minute close instead, which is at
    // most a minute old; the rating and patterns above still come from the
    // selected timeframe's closed bars only.
    if (provider === "ctrader" && timeframe !== "1m") {
      try {
        const minute = await getCandles(meta, "1m", settings, { force });
        const latest = minute.bars[minute.bars.length - 1]?.close;
        if (latest != null) applyLatestPrice(result, latest);
      } catch {
        // A missing minute bar must not blank the card: the bar close is valid.
      }
    }
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

function ratingsFromReads(
  meta: SymbolMeta,
  reads: TimeframeSeries[]
): Record<string, TimeframeRating> {
  return Object.fromEntries(
    reads.map((read) => {
      if (read.error || !read.bars || !read.provider) {
        return [read.id, { error: read.error ?? "bars unavailable" }] as const;
      }
      try {
        const a = analyze(read.bars, meta, read.id);
        const rating: TimeframeRating = {
          rating: a.summary.rating,
          score: a.summary.score,
          buy: a.summary.buy,
          sell: a.summary.sell,
          neutral: a.summary.neutral,
          price: a.price,
          provider: read.provider,
        };
        return [read.id, rating] as const;
      } catch (err) {
        return [read.id, { error: message(err) }] as const;
      }
    })
  );
}

function pinSelectedRating(
  ratings: Record<string, TimeframeRating>,
  result: AnalysisResponse
): Record<string, TimeframeRating> {
  return {
    ...ratings,
    [result.timeframe]: {
      rating: result.summary.rating,
      score: result.summary.score,
      buy: result.summary.buy,
      sell: result.summary.sell,
      neutral: result.summary.neutral,
      price: result.price,
      provider: result.provider,
    },
  };
}

// Compact verdict per timeframe, so the detail view can show every timeframe at
// once without a second round of user input.
async function ratingsForAllTimeframes(
  symbol: string,
  catalog: CatalogEntry[],
  settings: AnalysisSettings
): Promise<{ timeframes: Record<string, TimeframeRating>; version: string }> {
  const meta = resolveMeta(symbol, catalog);
  if (!meta) return { timeframes: {}, version: "unresolved" };
  const reads = await readTimeframes(meta, settings);
  return {
    timeframes: ratingsFromReads(meta, reads),
    version: reads.map((r) => `${r.id}=${r.version}`).join("|"),
  };
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