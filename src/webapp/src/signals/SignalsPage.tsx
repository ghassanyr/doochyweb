import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Radio, Search } from "lucide-react";

import { marketApi, signalsApi, telegramApi, type TelegramStatus } from "../api";
import { AnimatedModal } from "../components/Modal";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, inputCls } from "../components/ui";
import { MarketDetail } from "../market/MarketDetail";
import { DEFAULT_TIMEFRAME, timeframes as staticTimeframes } from "../market/timeframes";
import type { CatalogEntry } from "../market/types";
import TelegramNotifications from "../telegram/TelegramNotifications";
import { detectedTimeZone, timeZoneLabel } from "../time";
import { DeleteSignalModal } from "./DeleteSignalModal";
import { InvalidateModal } from "./InvalidateModal";
import { PostUpdateModal } from "./PostUpdateModal";
import { SignalCard, SignalCardSkeleton } from "./SignalCard";
import { SignalDetailModal } from "./SignalDetailModal";
import { SignalFormModal } from "./SignalFormModal";
import { signalShareText } from "./signalFormat";
import type { PricePoint, Signal, SignalListResponse, SignalStats } from "./types";

const PAGE = 25;
const POLL_MS = 30_000;
const DEBOUNCE_MS = 250;

type Mode = "all" | "active";

export default function SignalsPage({
  canRefresh,
  canManageSignals,
}: {
  /** Signed-in users can force a broker read in the analysis sheet. */
  canRefresh: boolean;
  /** Only admins can publish or change signals. */
  canManageSignals: boolean;
}) {
  const [mode, setMode] = useState<Mode>("all");
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [direction, setDirection] = useState("");
  const [page, setPage] = useState(0);

  const [data, setData] = useState<SignalListResponse | null>(null);
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [prices, setPrices] = useState<Record<string, PricePoint>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [timeframes, setTimeframes] = useState(staticTimeframes);
  const [defaultTimeframe, setDefaultTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [strongRatio, setStrongRatio] = useState(0.25);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Signal | null>(null);
  const [updateTarget, setUpdateTarget] = useState<Signal | null>(null);
  const [invalidateTarget, setInvalidateTarget] = useState<Signal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Signal | null>(null);
  const [detail, setDetail] = useState<Signal | null>(null);
  const [chart, setChart] = useState<{ symbol: string; timeframe: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [telegramOpen, setTelegramOpen] = useState(false);

  // Only offer the shortcut to signed-in users who can still link Telegram.
  useEffect(() => {
    let alive = true;
    telegramApi
      .status()
      .then((s) => {
        if (alive) setTelegram(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    marketApi
      .config()
      .then((c) => {
        if (!alive) return;
        setTimeframes(c.timeframes);
        setCatalog(c.catalog);
        setStrongRatio(c.settings.strongRatio);
        setDefaultTimeframe(c.settings.defaultTimeframe || c.defaultTimeframe);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Debounce the symbol box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSymbolQuery(symbolInput.trim().toUpperCase()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [symbolInput]);

  useEffect(() => setPage(0), [mode, symbolQuery, direction]);

  const load = useCallback(async () => {
    try {
      const res = await signalsApi.list({
        status: mode,
        symbol: symbolQuery || undefined,
        direction: direction || undefined,
        limit: PAGE,
        offset: page * PAGE,
      });
      setData(res);
      setError(null);
      if (mode === "all") {
        signalsApi.stats().then(setStats).catch(() => {});
      }
      const symbols = res.signals
        .filter((s) => s.status === "active" && s.entry != null)
        .map((s) => s.symbol);
      if (symbols.length) {
        signalsApi
          .prices(symbols)
          .then((p) => setPrices((prev) => ({ ...prev, ...p.prices })))
          .catch(() => {});
      }
    } catch {
      setError("Could not load signals.");
    } finally {
      setLoaded(true);
    }
  }, [mode, symbolQuery, direction, page]);

  useEffect(() => {
    void load();
    // Both views include active signals, so keep them fresh while open.
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Deep link: /signals?signal=<id> opens the detail sheet.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("signal");
    if (!id) return;
    signalsApi
      .get(id)
      .then((r) => setDetail(r.signal))
      .catch(() => {});
  }, []);

  const openDetail = useCallback((signal: Signal) => {
    setDetail(signal);
    const url = new URL(window.location.href);
    url.searchParams.set("signal", signal.id);
    window.history.replaceState(null, "", url);
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("signal");
    window.history.replaceState(null, "", url);
  }, []);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const copy = async (signal: Signal) => {
    try {
      await navigator.clipboard.writeText(signalShareText(signal));
      flash("Signal copied to clipboard");
    } catch {
      flash("Could not copy");
    }
  };

  const openChart = (signal: Signal) => {
    const tf = signal.timeframe && timeframes.some((t) => t.id === signal.timeframe)
      ? signal.timeframe
      : defaultTimeframe;
    setChart({ symbol: signal.symbol, timeframe: tf });
  };

  const saved = (signal: Signal) => {
    // Keep an open detail sheet in sync, then refresh the list and counts.
    setDetail((current) => (current?.id === signal.id ? signal : current));
    void load();
  };

  const counts = data?.counts;
  const rows = data?.signals ?? [];
  const pages = Math.ceil((data?.total ?? 0) / PAGE);
  const zone = detectedTimeZone();
  const zoneLabel = timeZoneLabel();

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <Radio className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Signals</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Public
            </span>
            <span className="text-[11px] text-fg-faint">
              Times in {zone} ({zoneLabel})
            </span>

            <div className="ml-auto flex items-center gap-2">
              {telegram?.enabled && !telegram.linked && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Bell className="h-3.5 w-3.5" />}
                  onClick={() => setTelegramOpen(true)}
                >
                  Connect Telegram
                </Button>
              )}
              <div
                role="group"
                aria-label="Signals view"
                className="flex items-center rounded-lg border border-hairline-strong bg-soft p-[3px]"
              >
                {(["all", "active"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      if (v === mode) return;
                      setMode(v);
                    }}
                    aria-pressed={mode === v}
                    className={
                      "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-semibold transition " +
                      (mode === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")
                    }
                  >
                    {v === "all" ? (
                      <>
                        All
                        {counts && <span className="tabular-nums opacity-60">{counts.total}</span>}
                      </>
                    ) : (
                      <>
                        Active
                        {counts && <span className="tabular-nums opacity-60">{counts.active}</span>}
                      </>
                    )}
                  </button>
                ))}
              </div>
              {canManageSignals && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  New signal
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
              <input
                className={inputCls + " py-1.5 pl-9"}
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                placeholder="Filter by symbol…"
                spellCheck={false}
                aria-label="Filter by symbol"
              />
            </div>
            <select
              className={inputCls + " !w-auto py-1.5"}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              aria-label="Filter by direction"
            >
              <option value="">All directions</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>

          {mode === "all" && stats && <StatsStrip stats={stats} />}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
        </Card>

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {!loaded ? (
            Array.from({ length: 6 }, (_, i) => <SignalCardSkeleton key={i} />)
          ) : rows.length === 0 ? (
            <GridMessage>
              {mode === "active"
                ? "No active signals match these filters."
                : "No signals yet. Published signals appear here."}
            </GridMessage>
          ) : (
            rows.map((signal) => (
              <SignalCard
                key={signal.id}
                signal={signal}
                price={prices[signal.symbol] ?? null}
                canManage={canManageSignals}
                onOpen={openDetail}
                onEdit={(s) => {
                  setEditing(s);
                  setFormOpen(true);
                }}
                onPostUpdate={setUpdateTarget}
                onInvalidate={setInvalidateTarget}
                onRestore={(s) => {
                  signalsApi
                    .restore(s.id)
                    .then((r) => {
                      saved(r.signal);
                      flash("Signal restored");
                    })
                    .catch(() => flash("Could not restore the signal"));
                }}
                onDelete={setDeleteTarget}
                onOpenChart={openChart}
                onCopy={copy}
              />
            ))
          )}
        </div>

        {pages > 1 && (
          <Card className="flex items-center justify-between p-3">
            <span className="text-[11.5px] text-fg-muted">
              Page {page + 1} of {pages} · {data?.total ?? 0} signals
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </Card>
        )}
      </div>

      {canManageSignals && (
        <SignalFormModal
          open={formOpen}
          signal={editing}
          catalog={catalog}
          timeframes={timeframes}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={saved}
        />
      )}

      <PostUpdateModal signal={updateTarget} onClose={() => setUpdateTarget(null)} onSaved={saved} />
      <InvalidateModal signal={invalidateTarget} onClose={() => setInvalidateTarget(null)} onSaved={saved} />
      <DeleteSignalModal
        signal={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) => {
          setDeleteTarget(null);
          setDetail((current) => (current?.id === id ? null : current));
          void load();
          flash("Signal deleted");
        }}
      />
      <SignalDetailModal signal={detail} onClose={closeDetail} onOpenChart={openChart} onCopy={copy} />

      <AnimatedModal
        open={telegramOpen}
        onClose={() => setTelegramOpen(false)}
        title="Telegram notifications"
        subtitle={`Get a direct message from @${telegram?.botUsername ?? "DoochyBot"} when a new signal is published.`}
      >
        <TelegramNotifications showHeading={false} onStatusChange={setTelegram} />
      </AnimatedModal>

      {chart && (
        <MarketDetail
          symbol={chart.symbol}
          timeframe={chart.timeframe}
          strongRatio={strongRatio}
          timeframes={timeframes}
          canRefresh={canRefresh}
          canRemove={false}
          onClose={() => setChart(null)}
          onRemove={() => {}}
          onTimeframeChange={(tf) => setChart((c) => (c ? { ...c, timeframe: tf } : c))}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-xs font-medium text-fg shadow-overlay">
          {toast}
        </div>
      )}
    </FadeRise>
  );
}

function StatsStrip({ stats }: { stats: SignalStats }) {
  const items = [
    { label: "Active", value: stats.active },
    { label: "Invalidated", value: stats.invalidated },
    { label: "Expired", value: stats.expired },
    { label: "Target hit", value: stats.targetHit },
    { label: "Stopped out", value: stats.stoppedOut },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft/50 px-3 py-2">
      {items.map((item) => (
        <Badge key={item.label} tone={item.label === "Active" ? "accent" : "muted"}>
          {item.label} <span className="tabular-nums opacity-70">{item.value}</span>
        </Badge>
      ))}
      {stats.resolved > 0 && (
        <span className="ml-auto text-[11px] text-fg-muted">
          Win rate{" "}
          <span className="font-semibold text-fg">
            {stats.winRate == null ? "-" : `${Math.round(stats.winRate * 100)}%`}
          </span>{" "}
          · Avg{" "}
          <span className="font-semibold text-fg">
            {stats.avgR == null ? "-" : `${stats.avgR.toFixed(2)}R`}
          </span>
        </span>
      )}
    </div>
  );
}

function GridMessage({ children }: { children: React.ReactNode }) {
  return (
    <Card className="col-span-full p-8 text-center text-sm text-fg-muted">{children}</Card>
  );
}
