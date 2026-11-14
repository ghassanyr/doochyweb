// Personal price alerts.
//
// One row per level to watch: a symbol, a direction and a price. The server
// checks active rows every minute against the same price cache the Analysis
// page uses, and messages the owner on Telegram when a level is reached. The
// watchlist strip on top is the shared market watchlist with live prices, so
// creating an alert starts from a symbol the site already follows.

import { useCallback, useEffect, useState } from "react";
import { BellRing, Pause, Play, Plus, Trash2 } from "lucide-react";

import { alertsApi, marketApi, signalsApi, type AlertCounts, type AlertView } from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, inputCls, Skeleton } from "../components/ui";
import { formatLocalDateTime } from "../time";

interface WatchRow {
  symbol: string;
  price: number | null;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [level, setLevel] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

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

  const create = useCallback(async () => {
    const value = Number(level);
    if (!symbol.trim() || !Number.isFinite(value) || value <= 0) {
      setNotice("Enter a symbol and a price above zero.");
      return;
    }
    setCreating(true);
    try {
      await alertsApi.create({ symbol: symbol.trim().toUpperCase(), condition, level: value, note: note.trim() });
      setSymbol("");
      setLevel("");
      setNote("");
      await load();
      setNotice("Alert created.");
    } catch (err: any) {
      setNotice(err?.message || "Could not create that alert.");
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
        setNotice("Could not change that alert.");
      }
    },
    [load]
  );

  const remove = useCallback(
    async (alert: AlertView) => {
      try {
        await alertsApi.remove(alert.id);
        await load();
      } catch {
        setNotice("Could not delete that alert.");
      }
    },
    [load]
  );

  return (
    <FadeRise>
      <div className="space-y-3">
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

          <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_0.9fr_0.9fr_1.4fr_auto]">
            <input
              className={inputCls + " py-1.5"}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="Symbol"
              spellCheck={false}
              list="alert-symbols"
              aria-label="Alert symbol"
            />
            <datalist id="alert-symbols">
              {watchlist.map((row) => (
                <option key={row.symbol} value={row.symbol} />
              ))}
            </datalist>
            <select
              className={inputCls + " py-1.5"}
              value={condition}
              onChange={(event) => setCondition(event.target.value === "below" ? "below" : "above")}
              aria-label="Alert condition"
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              className={inputCls + " py-1.5"}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              placeholder="Price level"
              inputMode="decimal"
              aria-label="Price level"
            />
            <input
              className={inputCls + " py-1.5"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note (optional)"
              aria-label="Alert note"
            />
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

          {notice && (
            <div className="mt-3">
              <Flash tone="success">{notice}</Flash>
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
                onClick={() => setSymbol(row.symbol)}
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
              <p className="text-sm font-medium text-fg">No alerts yet</p>
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
                      <td className="px-3 py-2 text-fg-muted">{alert.note || "-"}</td>
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
