// Paper trading, shown as the Paper trading tab inside /trading.
//
// A virtual 100,000 USD book: positions fill at the current market price,
// close automatically when a stop or target is reached, and can be closed by
// hand at any time. Sizing uses cTrader lots when a spec is available and falls
// back to USD notional otherwise. Nothing here places broker orders.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlaskConical, RefreshCw, Search, X } from "lucide-react";

import {
  marketApi,
  simulationApi,
  type AccountView,
  type PaperAccount,
  type PaperListResponse,
  type PaperPosition,
  type PaperSide,
  type PaperSymbolSpec,
} from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, inputCls, Skeleton } from "../components/ui";
import type { CatalogEntry } from "../market/types";
import { formatLocalDateTime } from "../time";

const POLL_MS = 30_000;
const DEFAULT_SIZE = "10000";

export default function SimulationTab({ accounts }: { accounts: AccountView[] }) {
  const [data, setData] = useState<PaperListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [symbol, setSymbol] = useState("");
  const [symOpen, setSymOpen] = useState(false);
  const [activeSym, setActiveSym] = useState(-1);
  const [side, setSide] = useState<PaperSide>("buy");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [ctid, setCtid] = useState<number | null>(null);
  const [spec, setSpec] = useState<PaperSymbolSpec | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await simulationApi.list());
      setError(null);
    } catch {
      setError("Could not load the paper book.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

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

  useEffect(() => {
    if (!ctid && accounts.length) setCtid(accounts[0].ctid);
  }, [accounts, ctid]);

  useEffect(() => {
    let alive = true;
    const query = symbol.trim().toUpperCase();
    if (!ctid || !query) {
      setSpec(null);
      setSpecLoading(false);
      return;
    }
    setSpecLoading(true);
    const id = window.setTimeout(() => {
      simulationApi
        .spec(query, ctid)
        .then((result) => {
          if (!alive) return;
          setSpec(result.spec);
          const initial = result.spec.minLots ?? 0.1;
          setSize((current) => (current === DEFAULT_SIZE ? String(initial) : current));
        })
        .catch(() => {
          if (alive) setSpec(null);
        })
        .finally(() => {
          if (alive) setSpecLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [ctid, symbol]);

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

  const openPosition = useCallback(async () => {
    const value = Number(size);
    if (!symbol.trim() || !Number.isFinite(value) || value <= 0) {
      setNotice({ tone: "danger", text: "Pick a symbol and a size above zero." });
      return;
    }
    if (specLoading) {
      setNotice({ tone: "danger", text: "Wait for the lot specification to load." });
      return;
    }
    const stopValue = stop.trim() ? Number(stop) : null;
    const targetValue = target.trim() ? Number(target) : null;
    if (stopValue != null && (!Number.isFinite(stopValue) || stopValue <= 0)) {
      setNotice({ tone: "danger", text: "The stop must be a positive price." });
      return;
    }
    if (targetValue != null && (!Number.isFinite(targetValue) || targetValue <= 0)) {
      setNotice({ tone: "danger", text: "The target must be a positive price." });
      return;
    }

    setSubmitting(true);
    try {
      const payload = spec
        ? {
            symbol: symbol.trim().toUpperCase(),
            side,
            sizeMode: "lots" as const,
            lots: value,
            ctid: spec.account.ctid,
            stop: stopValue,
            target: targetValue,
          }
        : {
            symbol: symbol.trim().toUpperCase(),
            side,
            sizeMode: "usd" as const,
            notional: value,
            stop: stopValue,
            target: targetValue,
          };
      const result = await simulationApi.open(payload);
      setSymbol("");
      setStop("");
      setTarget("");
      setSize(DEFAULT_SIZE);
      setNotice({
        tone: "success",
        text: `Opened ${result.position.side} ${result.position.symbol} at ${result.position.entryPrice}.`,
      });
      await load();
    } catch (err: any) {
      setNotice({ tone: "danger", text: err?.message || "Could not open that position." });
    } finally {
      setSubmitting(false);
    }
  }, [symbol, side, size, stop, target, spec, specLoading, load]);

  const closePosition = useCallback(
    async (row: PaperPosition) => {
      setClosing(row.id);
      try {
        await simulationApi.close(row.id);
        await load();
      } catch (err: any) {
        setNotice({ tone: "danger", text: err?.message || "Could not close that position." });
      } finally {
        setClosing(null);
      }
    },
    [load]
  );

  const removePosition = useCallback(
    async (row: PaperPosition) => {
      try {
        await simulationApi.remove(row.id);
        await load();
      } catch {
        setNotice({ tone: "danger", text: "Could not delete that row." });
      }
    },
    [load]
  );

  const account = data?.account;
  const open = data?.open ?? [];
  const closed = data?.closed ?? [];

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <FlaskConical className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Paper trading</h3>
            <span className="text-[11px] text-fg-faint">
              Virtual book. No real money and no broker connection.
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>

          <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_auto]">
            <label className="relative block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Symbol</span>
              <Search className="pointer-events-none absolute left-3 top-[27px] h-3.5 w-3.5 text-fg-faint" />
              <input
                type="text"
                role="combobox"
                aria-expanded={symOpen}
                aria-controls="paper-symbol-suggestions"
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
                  id="paper-symbol-suggestions"
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
                            (index === activeSym
                              ? "bg-accent-soft text-accent"
                              : "text-fg hover:bg-surface-hover")
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

            <div>
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Side</span>
              <div className="flex rounded-lg border border-hairline-strong bg-soft p-[3px]">
                {(["buy", "sell"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSide(value)}
                    aria-pressed={side === value}
                    className={
                      "h-7 flex-1 rounded-md text-[11.5px] font-semibold uppercase tracking-wide transition " +
                      (side === value
                        ? value === "buy"
                          ? "bg-success-soft text-success"
                          : "bg-danger-soft text-danger"
                        : "text-fg-muted hover:text-fg")
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            {accounts.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-fg-muted">Lot spec account</span>
                <select
                  className={inputCls + " py-1.5"}
                  value={ctid ?? ""}
                  onChange={(event) => setCtid(Number(event.target.value))}
                >
                  {accounts.map((account) => (
                    <option key={account.ctid} value={account.ctid}>
                      {account.broker} {account.login}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">
                {spec ? "Size (Lots)" : "Size (USD)"}
              </span>
              <input
                className={inputCls + " py-1.5 tabular-nums"}
                value={size}
                onChange={(event) => setSize(event.target.value)}
                inputMode="decimal"
              />
              {specLoading ? (
                <span className="mt-1 block text-[10.5px] text-fg-faint">Loading lot spec...</span>
              ) : spec ? (
                <span className="mt-1 block text-[10.5px] text-fg-faint">
                  Min {spec.minLots ?? "-"}
                  {spec.lotStep != null ? ` step ${spec.lotStep}` : ""}
                  {spec.maxLots != null ? ` max ${spec.maxLots}` : ""}
                </span>
              ) : (
                <span className="mt-1 block text-[10.5px] text-fg-faint">
                  Connect a cTrader account for lot sizing. USD fallback stays available.
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Stop (optional)</span>
              <input
                className={inputCls + " py-1.5 tabular-nums"}
                value={stop}
                onChange={(event) => setStop(event.target.value)}
                placeholder="price"
                inputMode="decimal"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-fg-muted">Target (optional)</span>
              <input
                className={inputCls + " py-1.5 tabular-nums"}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="price"
                inputMode="decimal"
              />
            </label>

            <Button
              variant="primary"
              size="sm"
              disabled={submitting || specLoading}
              onClick={() => void openPosition()}
            >
              {submitting ? "Opening" : "Open"}
            </Button>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Filled at the current market price. A stop or target closes the position automatically at that
            level; anything without a level stays open until you close it.
          </p>

          {notice && (
            <div className="mt-3">
              <Flash tone={notice.tone}>{notice.text}</Flash>
            </div>
          )}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
        </Card>

        {account && <AccountStrip account={account} />}

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
            <h3 className="text-sm font-semibold text-fg">Open positions</h3>
            <Badge tone="accent">{open.length}</Badge>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : open.length === 0 ? (
            <p className="p-6 text-[12.5px] text-fg-muted">
              No open paper positions. Open one above to start the book.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Entry</th>
                    <th className="px-3 py-2 text-right font-medium">Stop</th>
                    <th className="px-3 py-2 text-right font-medium">Target</th>
                    <th className="px-3 py-2 text-right font-medium">Last</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 text-right font-medium">Opened</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {open.map((row) => {
                    const live = unrealized(row);
                    return (
                      <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-surface-hover">
                        <td className="px-3 py-2 font-medium text-fg">{row.symbol}</td>
                        <td className="px-3 py-2">
                          <Badge tone={row.side === "buy" ? "success" : "danger"}>
                            {row.side.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{formatSize(row)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.entryPrice}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.stop ?? "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.target ?? "-"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.lastPrice ?? "-"}</td>
                        <td
                          className={
                            "px-3 py-2 text-right tabular-nums " +
                            (live == null
                              ? "text-fg-faint"
                              : live > 0
                                ? "text-success"
                                : live < 0
                                  ? "text-danger"
                                  : "text-fg-muted")
                          }
                        >
                          {live == null ? "-" : formatMoney(live)}
                        </td>
                        <td className="px-3 py-2 text-right text-fg-faint">
                          {formatLocalDateTime(row.openedAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={closing === row.id}
                            icon={closing === row.id ? undefined : <X className="h-3.5 w-3.5" />}
                            onClick={() => void closePosition(row)}
                          >
                            Close
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
            <h3 className="text-sm font-semibold text-fg">Closed trades</h3>
            <Badge tone="muted">{closed.length}</Badge>
          </div>
          {closed.length === 0 ? (
            <p className="p-6 text-[12.5px] text-fg-muted">Nothing closed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Entry</th>
                    <th className="px-3 py-2 text-right font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 font-medium">Closed by</th>
                    <th className="px-3 py-2 font-medium">Closed</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {closed.map((row) => (
                    <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-surface-hover">
                      <td className="px-3 py-2 font-medium text-fg">{row.symbol}</td>
                      <td className="px-3 py-2">
                        <Badge tone={row.side === "buy" ? "success" : "danger"}>
                          {row.side.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{formatSize(row)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.entryPrice}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{row.exitPrice ?? "-"}</td>
                      <td
                        className={
                          "px-3 py-2 text-right tabular-nums " +
                          ((row.pnl ?? 0) > 0
                            ? "text-success"
                            : (row.pnl ?? 0) < 0
                              ? "text-danger"
                              : "text-fg-muted")
                        }
                      >
                        {row.pnl == null ? "-" : formatMoney(row.pnl)}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{row.closeReason ?? "-"}</td>
                      <td className="px-3 py-2 text-fg-muted">
                        {row.closedAt ? formatLocalDateTime(row.closedAt) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void removePosition(row)}
                          aria-label={`Delete ${row.symbol} paper trade`}
                          className="rounded-md p-1 text-fg-faint transition hover:bg-danger-soft hover:text-danger"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
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

function formatSize(row: PaperPosition): string {
  if (row.sizeMode === "lots" && row.lots != null) return `${row.lots} lots`;
  return `${row.notional} USD`;
}

function unrealized(row: PaperPosition): number | null {
  if (row.lastPrice == null || !(row.entryPrice > 0)) return null;
  if (row.sizeMode === "lots" && row.volume != null && row.spec) {
    const diff = row.side === "buy" ? row.lastPrice - row.entryPrice : row.entryPrice - row.lastPrice;
    return Math.round(diff * (row.volume / 100) * (row.spec.quoteUsdFactor ?? 1) * 100) / 100;
  }
  const move = (row.lastPrice - row.entryPrice) / row.entryPrice;
  const signed = row.side === "buy" ? move : -move;
  return Math.round(row.notional * signed * 100) / 100;
}

function formatMoney(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function AccountStrip({ account }: { account: PaperAccount }) {
  const items = [
    { label: "Equity", value: account.equity.toFixed(2) },
    { label: "Realized", value: formatMoney(account.realizedPnl) },
    { label: "Open P&L", value: formatMoney(account.unrealizedPnl) },
    { label: "Exposure", value: account.exposure.toFixed(0) },
    {
      label: "Win rate",
      value: account.winRate == null ? "-" : `${Math.round(account.winRate * 100)}%`,
    },
    { label: "Closed", value: String(account.closedCount) },
  ];
  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[10.5px] uppercase tracking-wider text-fg-faint">{item.label}</div>
          <div className="text-sm font-semibold tabular-nums text-fg">{item.value}</div>
        </div>
      ))}
      <span className="ml-auto text-[10.5px] text-fg-faint">
        Started at {account.startBalance.toLocaleString()} USD
      </span>
    </Card>
  );
}
