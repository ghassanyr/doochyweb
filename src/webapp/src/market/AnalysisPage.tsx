import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, RefreshCw, Settings2 } from "lucide-react";

import { marketApi } from "../api";
import { FadeRise } from "../components/motion";
import { Card } from "../components/ui";
import { MarketCard, MarketCardError, MarketCardSkeleton } from "./MarketCard";
import { MarketDetail } from "./MarketDetail";
import { MarketSettingsSheet } from "./MarketSettingsSheet";
import { SortableGrid } from "./SortableGrid";
import { applyOrder } from "./order";
import { SymbolSearch } from "./SymbolSearch";
import { DEFAULT_TIMEFRAME, timeframes as staticTimeframes } from "./timeframes";
import type { CatalogEntry, MarketResult, MarketSettings } from "./types";

export default function AnalysisPage({ canWrite }: { canWrite: boolean }) {
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

  const [detail, setDetail] = useState<{ symbol: string; timeframe: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const timeframes = config?.timeframes ?? staticTimeframes;
  const settings = config?.settings;
  const strongRatio = settings?.strongRatio ?? 0.25;
  const refreshSeconds = settings?.refreshSeconds ?? 60;

  // Guards against a slow response from an earlier request overwriting a newer
  // one (switching timeframe mid-flight is common).
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await marketApi.analysis(timeframe);
      if (id !== reqId.current) return;
      setResults(res.results);
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

  // Countdown ticker. Lives in StatusLine so a tick re-renders only that strip
  // and not the whole grid.
  useEffect(() => {
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const addSymbol = useCallback(
    async (raw: string) => {
      const symbol = raw.trim();
      if (!symbol || !canWrite) return;
      try {
        await marketApi.addSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add market");
      }
    },
    [load, canWrite]
  );

  const removeSymbol = useCallback(
    async (symbol: string) => {
      if (!canWrite) return;
      setResults((prev) => prev.filter((r) => r.symbol !== symbol));
      try {
        await marketApi.removeSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove market");
      }
    },
    [load, canWrite]
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
      if (!canWrite) return;
      setRefreshing((prev) => new Set(prev).add(symbol));
      try {
        const result = await marketApi.refreshSymbol(symbol, timeframe);
        // Splice just this card in, so the rest of the grid is untouched.
        setResults((prev) => prev.map((r) => (r.symbol === symbol ? result : r)));
        setError(null);
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
    [timeframe, canWrite]
  );

  const okCount = results.filter((r) => r.ok).length;
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

          {canWrite ? (
            <SymbolSearch catalog={config?.catalog ?? []} onAdd={(s) => void addSymbol(s)} />
          ) : (
            <p className="flex-1 self-center px-1 text-sm text-fg-faint">
              Viewing a shared watchlist. Sign in to add markets.
            </p>
          )}
        </Card>

        <StatusLine
          loading={loading}
          okCount={okCount}
          total={results.length}
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
        ) : (
          <SortableGrid
            items={applyOrder(results, order)}
            onReorder={persistOrder}
            canReorder={canWrite}
            className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]"
            renderItem={(r) =>
              r.ok ? (
                <MarketCard
                  analysis={r}
                  strongRatio={strongRatio}
                  refreshing={refreshing.has(r.symbol)}
                  canWrite={canWrite}
                  onOpen={openDetail}
                  onRefresh={refreshOne}
                  onRemove={removeSymbol}
                />
              ) : (
                <MarketCardError
                  symbol={r.symbol}
                  error={r.error}
                  refreshing={refreshing.has(r.symbol)}
                  canWrite={canWrite}
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
          canWrite={canWrite}
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
          : `${okCount}/${total} markets analysed from cTrader`}
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
