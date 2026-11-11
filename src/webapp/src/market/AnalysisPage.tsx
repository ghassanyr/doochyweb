import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, RefreshCw, Settings2 } from "lucide-react";

import { marketApi } from "../api";
import { FadeRise } from "../components/motion";
import { Card } from "../components/ui";
import { ASSET_FILTERS, assetClass, type AssetFilter } from "./assetClass";
import { MarketCard, MarketCardError, MarketCardSkeleton } from "./MarketCard";
import { MarketDetail } from "./MarketDetail";
import { MarketSettingsSheet } from "./MarketSettingsSheet";
import { SortableGrid } from "./SortableGrid";
import { applyOrder } from "./order";
import { SymbolSearch } from "./SymbolSearch";
import { DEFAULT_TIMEFRAME, timeframes as staticTimeframes } from "./timeframes";
import type { CatalogEntry, MarketResult, MarketSettings, SymbolType } from "./types";

export default function AnalysisPage({
  canRefresh,
  canManageWatchlist,
}: {
  /** Signed-in users can force a broker read; anonymous visitors cannot. */
  canRefresh: boolean;
  /** Only admins can change the shared watchlist. */
  canManageWatchlist: boolean;
}) {
  const [config, setConfig] = useState<{
    timeframes: { id: string; label: string }[];
    settings: MarketSettings;
    catalog: CatalogEntry[];
  } | null>(null);

  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [results, setResults] = useState<MarketResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");

  const [detail, setDetail] = useState<{ symbol: string; timeframe: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const timeframes = config?.timeframes ?? staticTimeframes;
  const settings = config?.settings;
  const strongRatio = settings?.strongRatio ?? 0.25;
  const refreshSeconds = settings?.refreshSeconds ?? 60;

  // Failed analyses may omit the type (an unresolvable symbol never reaches the
  // resolver), so fall back to the catalog the config request already sent.
  const catalogTypes = useMemo(() => {
    const map = new Map<string, SymbolType>();
    for (const entry of config?.catalog ?? []) map.set(entry.symbol, entry.type);
    return map;
  }, [config?.catalog]);

  const assetCounts = useMemo(() => {
    const counts: Record<AssetFilter, number> = {
      all: results.length,
      crypto: 0,
      forex: 0,
      metals: 0,
      indices: 0,
    };
    for (const r of results) {
      const bucket = assetClass(r.type ?? catalogTypes.get(r.symbol));
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [results, catalogTypes]);

  // Filtering is purely visual: the full result set keeps polling and feeding
  // the MTF confluence strip, so switching filters is instant.
  const visibleResults = useMemo(
    () =>
      assetFilter === "all"
        ? results
        : results.filter((r) => assetClass(r.type ?? catalogTypes.get(r.symbol)) === assetFilter),
    [results, assetFilter, catalogTypes]
  );

  // Guards against a slow response from an earlier request overwriting a newer
  // one (switching timeframe mid-flight is common).
  const reqId = useRef(0);

  // Confluence runs separately from the card grid: one request per symbol,
  // three at a time. A batch id plus a per-symbol id stop an older reply from
  // overwriting a newer one.
  const confluenceBatch = useRef(0);
  const confluenceSeq = useRef(0);
  const confluenceSeqBySymbol = useRef(new Map<string, number>());
  const symbolsRef = useRef<string[]>([]);

  // Unique symbols drive both the confluence effect and its request pool.
  const symbols = Array.from(new Set(results.map((r) => r.symbol)));
  const symbolsKey = [...symbols].sort().join("|");
  symbolsRef.current = symbols;

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await marketApi.analysis(timeframe);
      if (id !== reqId.current) return;
      // The list endpoint does not carry the MTF strip. Keep the copy already
      // merged in from the confluence endpoint so it does not flash a skeleton
      // on every poll.
      setResults((prev) => {
        const previous = new Map(prev.map((r) => [r.symbol, r]));
        return res.results.map((r) => {
          if (!r.ok) return r;
          const old = previous.get(r.symbol);
          if (old?.ok && old.timeframeRatings && r.timeframeRatings === undefined) {
            return { ...r, timeframeRatings: old.timeframeRatings };
          }
          return r;
        });
      });
      setUpdatedAt(res.updatedAt);
      setError(null);
      setSecondsLeft(refreshSeconds);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load analysis");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [timeframe, refreshSeconds]);

  const applyConfluence = useCallback(async (symbol: string) => {
    const seq = ++confluenceSeq.current;
    confluenceSeqBySymbol.current.set(symbol, seq);
    try {
      const res = await marketApi.confluence(symbol);
      if (confluenceSeqBySymbol.current.get(symbol) !== seq) return;
      setResults((prev) => {
        let changed = false;
        const next = prev.map((r) => {
          if (r.symbol !== symbol || !r.ok) return r;
          changed = true;
          return { ...r, timeframeRatings: res.timeframes };
        });
        return changed ? next : prev;
      });
    } catch {
      // The strip is additive; a 404 or a provider failure must leave the card
      // exactly as it was.
    }
  }, []);

  const loadConfluence = useCallback(async () => {
    const current = symbolsRef.current;
    if (current.length === 0) return;
    const batch = ++confluenceBatch.current;
    await mapPool(current, 3, async (symbol) => {
      if (batch !== confluenceBatch.current) return;
      await applyConfluence(symbol);
    });
  }, [applyConfluence]);

  // One-shot bootstrap: config + watchlist drives the initial render.
  useEffect(() => {
    let alive = true;
    // The saved card layout comes from the watchlist read; failing to load it
    // just leaves the grid in watchlist order.
    marketApi
      .watchlist()
      .then((r) => {
        if (alive && Array.isArray(r.order)) setOrder(r.order);
      })
      .catch(() => {});
    marketApi
      .config()
      .then((c) => {
        if (!alive) return;
        setConfig({ timeframes: c.timeframes, settings: c.settings, catalog: c.catalog });
        setTimeframe(c.settings.defaultTimeframe || c.defaultTimeframe || DEFAULT_TIMEFRAME);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Auto-refresh loop, re-created whenever the interval or timeframe changes.
  useEffect(() => {
    void load();
    const poll = window.setInterval(load, Math.max(10, refreshSeconds) * 1000);
    return () => window.clearInterval(poll);
  }, [load, refreshSeconds]);

  // MTF confluence: deliberately NOT keyed to the selected timeframe. It
  // restarts when the symbol set, sensitivity or cadence changes, and otherwise
  // just polls alongside the main grid.
  useEffect(() => {
    void loadConfluence();
    const poll = window.setInterval(() => void loadConfluence(), Math.max(10, refreshSeconds) * 1000);
    return () => window.clearInterval(poll);
  }, [loadConfluence, symbolsKey, strongRatio, refreshSeconds]);

  // Countdown ticker. Lives in StatusLine so a tick re-renders only that strip
  // and not the whole grid.
  useEffect(() => {
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const addSymbol = useCallback(
    async (raw: string) => {
      const symbol = raw.trim();
      if (!symbol || !canManageWatchlist) return;
      try {
        await marketApi.addSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add market");
      }
    },
    [load, canManageWatchlist]
  );

  const removeSymbol = useCallback(
    async (symbol: string) => {
      if (!canManageWatchlist) return;
      setResults((prev) => prev.filter((r) => r.symbol !== symbol));
      try {
        await marketApi.removeSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove market");
      }
    },
    [load, canManageWatchlist]
  );

  // Stable per-card handlers: the cards are memoised, so handing them a fresh
  // closure each render would defeat the memo entirely.
  const persistOrder = useCallback(
    (next: MarketResult[]) => {
      const symbols = next.map((r) => r.symbol);
      setResults(next);
      setOrder(symbols);
      marketApi.saveOrder(symbols).catch((err) => {
        // Layout is cosmetic; a failed save should not disrupt the page.
        setError(err instanceof Error ? err.message : "Failed to save layout");
      });
    },
    []
  );

  const openDetail = useCallback(
    (symbol: string) => setDetail({ symbol, timeframe }),
    [timeframe]
  );

  const refreshOne = useCallback(
    async (symbol: string) => {
      if (!canRefresh) return;
      setRefreshing((prev) => new Set(prev).add(symbol));
      try {
        const result = await marketApi.refreshSymbol(symbol, timeframe);
        // Splice just this card in, so the rest of the grid is untouched.
        setResults((prev) => prev.map((r) => (r.symbol === symbol ? result : r)));
        setError(null);
        void applyConfluence(symbol);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to refresh ${symbol}`);
      } finally {
        setRefreshing((prev) => {
          const next = new Set(prev);
          next.delete(symbol);
          return next;
        });
      }
    },
    [timeframe, canRefresh, applyConfluence]
  );

  const okCount = visibleResults.filter((r) => r.ok).length;
  // Cards whose read fell back to a cached set because cTrader is throttling.
  const throttled = results.filter((r) => r.ok && (r.warnings?.length ?? 0) > 0).length;

  return (
    <FadeRise>
      <div className="space-y-3">
        {/* Toolbar: timeframes + add market + refresh + settings */}
        <Card className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-wrap items-center gap-1">
            {timeframes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeframe(t.id)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                  (t.id === timeframe
                    ? "border border-accent/20 bg-accent-soft text-accent"
                    : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Filter by asset class"
            className="flex flex-wrap items-center gap-1 border-t border-hairline pt-2.5"
          >
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
              Asset class
            </span>
            {ASSET_FILTERS.map((f) => {
              const active = f.id === assetFilter;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAssetFilter(f.id)}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition " +
                    (active
                      ? "border border-accent/20 bg-accent-soft text-accent"
                      : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
                  }
                >
                  {f.label}
                  <span
                    className={
                      "tabular-nums text-[10px] " + (active ? "opacity-70" : "text-fg-faint")
                    }
                  >
                    {assetCounts[f.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {canManageWatchlist ? (
            <SymbolSearch catalog={config?.catalog ?? []} onAdd={(s) => void addSymbol(s)} />
          ) : (
            <p className="flex-1 self-center px-1 text-sm text-fg-faint">
              The watchlist is curated by an admin.
            </p>
          )}
        </Card>

        <StatusLine
          loading={loading}
          okCount={okCount}
          total={visibleResults.length}
          secondsLeft={secondsLeft}
          onOpenSettings={() => setShowSettings(true)}
          onRefresh={() => void load()}
        />

        {settings?.accountError && (
          <Card className="border-danger/30 bg-danger-soft p-3.5 text-[13px] leading-relaxed text-fg-muted">
            <AlertCircle className="mr-2 inline h-4 w-4 align-[-3px] text-danger" />
            <span className="text-fg">{settings.accountError}</span>
          </Card>
        )}

        {throttled > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-gradient-to-r from-accent/12 to-blue-500/8 p-3.5 text-[13px] leading-relaxed text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              cTrader throttled the last sweep, so {throttled} card
              {throttled === 1 ? "" : "s"} {throttled === 1 ? "is" : "are"} showing cached bars.
              Figures stay correct, just a few minutes behind.
            </span>
          </div>
        )}

        {error && (
          <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </Card>
        )}

        {loading && results.length === 0 ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
            {Array.from({ length: 10 }, (_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">Your watchlist is empty.</div>
            <div className="mt-1 text-xs text-fg-faint">Add a market above to start analysing.</div>
          </Card>
        ) : visibleResults.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">No markets match this filter.</div>
            <button
              type="button"
              onClick={() => setAssetFilter("all")}
              className="mt-2 text-xs font-medium text-accent hover:underline"
            >
              Show all markets
            </button>
          </Card>
        ) : (
          <SortableGrid
            items={applyOrder(visibleResults, order)}
            onReorder={persistOrder}
            // A filtered grid is only part of the watchlist, so a drag would
            // have no well-defined place for the hidden cards. Reorder on All.
            canReorder={canManageWatchlist && assetFilter === "all"}
            className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]"
            renderItem={(r) =>
              r.ok ? (
                <MarketCard
                  analysis={r}
                  strongRatio={strongRatio}
                  refreshing={refreshing.has(r.symbol)}
                  canRefresh={canRefresh}
                  canRemove={canManageWatchlist}
                  onOpen={openDetail}
                  onRefresh={refreshOne}
                  onRemove={removeSymbol}
                />
              ) : (
                <MarketCardError
                  symbol={r.symbol}
                  error={r.error}
                  refreshing={refreshing.has(r.symbol)}
                  canRefresh={canRefresh}
                  canRemove={canManageWatchlist}
                  onRefresh={refreshOne}
                  onRemove={removeSymbol}
                />
              )
            }
          />
        )}

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Indicators computed server-side (RSI, STOCH, MACD, ADX, CCI, Williams %R, ATR, Ultimate
          Oscillator, ROC, Bull/Bear Power, SMA/EMA 5-200). Read from your cTrader account. Not financial advice.
        </p>
      </div>

      {detail && (
        <MarketDetail
          symbol={detail.symbol}
          timeframe={detail.timeframe}
          strongRatio={strongRatio}
          timeframes={timeframes}
          canRefresh={canRefresh}
          canRemove={canManageWatchlist}
          onClose={() => setDetail(null)}
          onRemove={(s) => void removeSymbol(s)}
          onTimeframeChange={(tf) => setDetail((d) => (d ? { ...d, timeframe: tf } : d))}
        />
      )}

      {showSettings && settings && (
        <MarketSettingsSheet
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setConfig((c) => (c ? { ...c, settings: s } : c));
            void load();
          }}
        />
      )}
    </FadeRise>
  );
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

// Split out so the per-second countdown tick re-renders only this strip. It is
// memoised and takes primitives, so the grid below is untouched.
function StatusLine({
  loading,
  okCount,
  total,
  secondsLeft,
  onOpenSettings,
  onRefresh,
}: {
  loading: boolean;
  okCount: number;
  total: number;
  secondsLeft: number;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-fg-muted">
        {loading
          ? "Updating…"
          : `${okCount}/${total} markets analyzed`}
      </span>
      <span className="flex items-center gap-2 text-fg-faint">
        {secondsLeft > 0 && !loading && <span>Next refresh in {secondsLeft}s</span>}
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded p-1 transition hover:bg-surface-hover hover:text-fg"
          aria-label="Analysis settings"
          title="Analysis settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded p-1 transition hover:bg-surface-hover hover:text-fg"
          aria-label="Refresh now"
          title="Refresh now"
        >
          <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
        </button>
      </span>
    </div>
  );
}
