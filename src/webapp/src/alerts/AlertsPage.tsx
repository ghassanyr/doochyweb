// Personal price alerts.
//
// One row per level to watch: a symbol, a direction and a price. The server
// checks active rows every minute against the same price cache the Analysis
// page uses, and messages the owner on Telegram when a level is reached. The
// watchlist strip on top is the shared market watchlist with live prices, so
// creating an alert starts from a symbol the site already follows.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Check, Pause, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";

import { alertsApi, marketApi, signalsApi, type AlertCounts, type AlertView } from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, inputCls, Skeleton } from "../components/ui";
import type { CatalogEntry } from "../market/types";
import { formatLocalDateTime } from "../time";
import { useSiteConfig } from "../siteConfig";

interface WatchRow {
  symbol: string;
  price: number | null;
}

export default function AlertsPage() {
  const { content } = useSiteConfig();
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [level, setLevel] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  // Symbol picker: the alert checker resolves symbols through the market
  // catalog, so the dropdown offers exactly the symbols that can actually be
  // watched rather than free text.
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [symOpen, setSymOpen] = useState(false);
  const [activeSym, setActiveSym] = useState(-1);

  const load = useCallback(async () => {
    try {
      const result = await alertsApi.list();
      setAlerts(result.alerts);
      setCounts(result.counts);
      setError(null);
    } catch {
      setError("Could not load your alerts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  // The strip is a convenience prefill, not part of the alert state.
  useEffect(() => {
    let alive = true;
    marketApi
      .watchlist()
      .then(async (list) => {
        const rows: WatchRow[] = list.symbols.map((item) => ({ symbol: item, price: null }));
        if (!alive) return;
        setWatchlist(rows);
        if (!list.symbols.length) return;
        const prices = await signalsApi
          .prices(list.symbols)
          .catch(() => ({ prices: {} as Record<string, { price: number; at: string }> }));
        if (!alive) return;
        setWatchlist(
          rows.map((row) => ({ ...row, price: prices.prices[row.symbol]?.price ?? null }))
        );
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
      .then((config) => {
        if (alive) setCatalog(config.catalog);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => {
    const query = symbol.trim().toUpperCase();
    const pool = query
      ? catalog.filter(
          (entry) => entry.symbol.includes(query) || entry.name.toUpperCase().includes(query)
        )
      : catalog;
    return [...pool]
      .sort((a, b) => {
        const aStarts = query && a.symbol.startsWith(query) ? 0 : 1;
        const bStarts = query && b.symbol.startsWith(query) ? 0 : 1;
        return aStarts - bStarts || a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 8);
  }, [catalog, symbol]);

  const pickSymbol = useCallback((next: string) => {
    setSymbol(next);
    setSymOpen(false);
    setActiveSym(-1);
  }, []);

  const onSymbolKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSymOpen(true);
        setActiveSym((index) => Math.min(matches.length - 1, index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSym((index) => Math.max(-1, index - 1));
      } else if (event.key === "Enter" && symOpen) {
        const picked = matches[activeSym >= 0 ? activeSym : 0];
        if (picked) {
          event.preventDefault();
          pickSymbol(picked.symbol);
        }
      } else if (event.key === "Escape") {
        setSymOpen(false);
      }
    },
    [matches, activeSym, symOpen, pickSymbol]
  );

  const create = useCallback(async () => {
    const value = Number(level);
    if (!symbol.trim() || !Number.isFinite(value) || value <= 0) {
      setNotice({ tone: "danger", text: "Enter a symbol and a target price above zero." });
      return;
    }
    setCreating(true);
    try {
      await alertsApi.create({ symbol: symbol.trim().toUpperCase(), condition, level: value, note: note.trim() });
      setSymbol("");
      setLevel("");
      setNote("");
      await load();
      setNotice({ tone: "success", text: "Alert created." });
    } catch (err: any) {
      setNotice({ tone: "danger", text: err?.message || "Could not create that alert." });
    } finally {
      setCreating(false);
    }
  }, [symbol, condition, level, note, load]);

  const toggle = useCallback(
    async (alert: AlertView) => {
      try {
        await alertsApi.update(alert.id, {
          symbol: alert.symbol,
          condition: alert.condition,
          level: alert.level,
          note: alert.note,
          status: alert.status === "paused" ? "active" : "paused",
        });
        await load();
      } catch {
        setNotice({ tone: "danger", text: "Could not change that alert." });
      }
    },
    [load]
  );

  const startNoteEdit = useCallback((alert: AlertView) => {
    setEditingNoteId(alert.id);
    setNoteDraft(alert.note ?? "");
    setNotice(null);
  }, []);

  const cancelNoteEdit = useCallback(() => {
    setEditingNoteId(null);
    setNoteDraft("");
  }, []);

  const saveNote = useCallback(
    async (alert: AlertView) => {
      if (savingNoteId) return;
      const next = noteDraft.trim();
      if (next === (alert.note ?? "")) {
        cancelNoteEdit();
        return;
      }
      setSavingNoteId(alert.id);
      try {
        await alertsApi.update(alert.id, {
          symbol: alert.symbol,
          condition: alert.condition,
          level: alert.level,
          note: next,
          status: alert.status,
        });
        setAlerts((current) =>
          current.map((item) => (item.id === alert.id ? { ...item, note: next } : item))
        );
        cancelNoteEdit();
        setNotice({ tone: "success", text: "Note saved." });
      } catch {
        setNotice({ tone: "danger", text: "Could not save that note." });
      } finally {
        setSavingNoteId(null);
      }
    },
    [cancelNoteEdit, noteDraft, savingNoteId]
  );

  const remove = useCallback(
    async (alert: AlertView) => {
      try {
        await alertsApi.remove(alert.id);
        await load();
      } catch {
        setNotice({ tone: "danger", text: "Could not delete that alert." });
      }
    },
    [load]
  );

  return (
    <FadeRise>
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Alerts</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Price levels you want to hear about, checked every minute.
          </p>
        </header>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <BellRing className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Price alerts</h3>
            <span className="text-[11px] text-fg-faint">
              Checked every minute. Fired alerts go to Telegram when your chat is linked.
            </span>
            {counts && (
              <div className="ml-auto flex items-center gap-2">
                <Badge tone="success">{counts.active} active</Badge>
                <Badge tone="accent">{counts.triggered} triggered</Badge>
                {counts.paused > 0 && <Badge tone="muted">{counts.paused} paused</Badge>}
              </div>
            )}
          </div>

          <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1.1fr_1fr_1.3fr_auto]">
            <label className="relative block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Symbol</span>
              <Search className="pointer-events-none absolute left-3 top-[27px] h-3.5 w-3.5 text-fg-faint" />
              <input
                type="text"
                role="combobox"
                aria-expanded={symOpen}
                aria-controls="alert-symbol-suggestions"
                aria-label="Symbol"
                className={inputCls + " py-1.5 pl-8"}
                value={symbol}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search a symbol"
                onChange={(event) => {
                  setSymbol(event.target.value);
                  setActiveSym(-1);
                  setSymOpen(true);
                }}
                onFocus={() => setSymOpen(true)}
                onBlur={() => window.setTimeout(() => setSymOpen(false), 150)}
                onKeyDown={onSymbolKey}
              />
              {symOpen && (
                <ul
                  id="alert-symbol-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-60 overflow-y-auto rounded-lg border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface py-1 shadow-overlay"
                >
                  {matches.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-fg-muted">
                      {symbol.trim() ? "No matching symbols" : "No symbols in the catalog"}
                    </li>
                  ) : (
                    matches.map((entry, index) => (
                      <li key={entry.symbol}>
                        <button
                          type="button"
                          onMouseEnter={() => setActiveSym(index)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            pickSymbol(entry.symbol);
                          }}
                          className={
                            "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition " +
                            (index === activeSym ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-hover")
                          }
                        >
                          <span className="font-semibold">{entry.symbol}</span>
                          <span className="truncate text-[11px] text-fg-faint">{entry.name}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Condition</span>
              <select
                className={inputCls + " py-1.5"}
                value={condition}
                onChange={(event) => setCondition(event.target.value === "below" ? "below" : "above")}
              >
                <option value="above">Crosses above the price</option>
                <option value="below">Crosses below the price</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Price level</span>
              <input
                className={inputCls + " py-1.5"}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                placeholder="e.g. 1.0850"
                inputMode="decimal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Note (optional)</span>
              <input
                className={inputCls + " py-1.5"}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this level matters"
              />
            </label>

            <Button
              variant="primary"
              size="sm"
              disabled={creating}
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => void create()}
            >
              Add
            </Button>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Checked every minute against the last traded price. An alert fires once, the first time the
            price reaches the level, then stops watching until you resume it.
          </p>

          {notice && (
            <div className="mt-3">
              <Flash tone={notice.tone}>{notice.text}</Flash>
            </div>
          )}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
        </Card>

        {watchlist.length > 0 && (
          <Card className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-[10.5px] uppercase tracking-wider text-fg-faint">Watchlist</span>
            {watchlist.slice(0, 12).map((row) => (
              <button
                key={row.symbol}
                type="button"
                onClick={() => pickSymbol(row.symbol)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-soft px-2 py-1 text-[11.5px] font-medium text-fg-muted transition hover:border-accent/40 hover:text-fg"
                title={row.price == null ? "Price unavailable" : `Last ${row.price}`}
              >
                {row.symbol}
                {row.price != null && <span className="tabular-nums text-fg-faint">{row.price}</span>}
              </button>
            ))}
          </Card>
        )}

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-6">
              <p className="text-sm font-medium text-fg">{content.emptyStates.alerts}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                Add a level above and it will be checked every minute, even while this page is closed.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Condition</th>
                    <th className="px-3 py-2 text-right font-medium">Level</th>
                    <th className="px-3 py-2 text-right font-medium">Last</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Fired</th>
                    <th className="px-3 py-2 font-medium">Note</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.id} className="border-b border-hairline last:border-0 hover:bg-surface-hover">
                      <td className="px-3 py-2 font-medium text-fg">{alert.symbol}</td>
                      <td className="px-3 py-2 text-fg-muted">{alert.condition}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg">{alert.level}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                        {alert.lastPrice ?? "-"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            alert.status === "active"
                              ? "success"
                              : alert.status === "triggered"
                                ? "accent"
                                : "muted"
                          }
                        >
                          {alert.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {alert.triggeredAt ? formatLocalDateTime(alert.triggeredAt) : "-"}
                        {alert.triggeredPrice != null && (
                          <span className="ml-1 text-fg-faint">@ {alert.triggeredPrice}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {editingNoteId === alert.id ? (
                          <div className="flex min-w-[180px] items-center gap-1">
                            <input
                              autoFocus
                              className={inputCls + " py-1 text-[11px]"}
                              value={noteDraft}
                              maxLength={500}
                              aria-label={`Note for ${alert.symbol} alert`}
                              onChange={(event) => setNoteDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void saveNote(alert);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelNoteEdit();
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => void saveNote(alert)}
                              disabled={savingNoteId === alert.id}
                              aria-label={`Save note for ${alert.symbol} alert`}
                              title="Save note"
                              className="rounded-md p-1 text-fg-faint transition hover:bg-surface-hover hover:text-accent"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelNoteEdit}
                              aria-label={`Cancel note edit for ${alert.symbol} alert`}
                              title="Cancel"
                              className="rounded-md p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startNoteEdit(alert)}
                            aria-label={`Edit note for ${alert.symbol} alert`}
                            title="Click to edit note"
                            className="flex max-w-[240px] items-center gap-1.5 text-left transition hover:text-fg"
                          >
                            <span className="truncate">{alert.note || "Add note"}</span>
                            <Pencil className="h-3 w-3 shrink-0 text-fg-faint" />
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void toggle(alert)}
                            aria-label={
                              alert.status === "paused" ? `Resume ${alert.symbol} alert` : `Pause ${alert.symbol} alert`
                            }
                            className="rounded-md p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
                          >
                            {alert.status === "paused" ? (
                              <Play className="h-3.5 w-3.5" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(alert)}
                            aria-label={`Delete ${alert.symbol} alert`}
                            className="rounded-md p-1 text-fg-faint transition hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </FadeRise>
  );
}
