import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Radio, Search } from "lucide-react";

import { marketApi } from "../api";
import { Card, inputCls } from "../components/ui";
import {
  BREAKOUT_STYLE,
  BREAKOUT_TYPE_KEYS,
  SESSION_OPTIONS,
  fmtPrice,
  loadTypeSelection,
  noneSelected,
  pageCount,
  typesParam,
  type TypeSelection,
} from "./breakoutFormat";
import { SESSION_LABEL, fmtCaptureTime, relativeTime } from "./captures";
import { BreakoutCard, BreakoutCardSkeleton } from "./BreakoutCard";
import { BreakoutNoteModal } from "./BreakoutNoteModal";
import type { Breakout, BreakoutRunStatus } from "./types";

const TYPE_KEY = "doochyweb_breakouts_types";
const LIVE_N = 20;
const PAGE = 25;
const POLL_MS = 15_000;
const DEBOUNCE_MS = 250;

type ViewMode = "recent" | "history";

interface Filters {
  types: TypeSelection;
  session: string;
  symbol: string;
}

function rowKey(b: Breakout): string {
  return `${b.symbol}|${b.type}|${b.session}|${b.timestamp_utc}|${b.level_price ?? ""}`;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[210px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
        <input
          type="search"
          aria-label="Search symbol"
          placeholder="Search symbol (e.g. EUR, XAU)"
          className={`${inputCls} h-9 pl-8`}
          value={filters.symbol}
          onChange={(e) => onChange({ ...filters, symbol: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-[170px]">
        <select
          aria-label="Session"
          className={`${inputCls} h-9`}
          value={filters.session}
          onChange={(e) => onChange({ ...filters, session: e.target.value })}
        >
          <option value="">All sessions</option>
          {SESSION_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SESSION_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Breakout types">
        {BREAKOUT_TYPE_KEYS.map((t) => {
          const active = filters.types[t];
          const style = BREAKOUT_STYLE[t];
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...filters, types: { ...filters.types, [t]: !active } })}
              className={
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition " +
                (active
                  ? "bg-soft"
                  : "border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
              style={active ? { color: style.color, borderColor: `${style.color}66` } : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.color }} />
              {style.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GridMessage({ children }: { children: ReactNode }) {
  return (
    <Card flat className="col-span-full p-8 text-center text-[12.5px] text-fg-faint">
      {children}
    </Card>
  );
}

export function Breakouts({ onOpenSymbol }: { onOpenSymbol?: (symbol: string) => void }) {
  // The type selection is remembered between visits, so it is read once, up front.
  const [filters, setFilters] = useState<Filters>(() => ({
    types: loadTypeSelection(typeof window !== "undefined" ? window.localStorage : undefined, TYPE_KEY),
    session: "",
    symbol: "",
  }));
  const [query, setQuery] = useState<Filters>(filters);
  const [live, setLive] = useState<Breakout[]>([]);
  const [logRows, setLogRows] = useState<Breakout[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<ViewMode>("recent");
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [logLoaded, setLogLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<BreakoutRunStatus | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("note")
  );

  // Debounce every filter change so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(filters), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [filters]);

  // Persist the type selection.
  useEffect(() => {
    try {
      window.localStorage.setItem(TYPE_KEY, JSON.stringify(filters.types));
    } catch {
      /* storage unavailable: selection applies for this session only */
    }
  }, [filters.types]);

  // A new view starts at the first page and waits for its own data.
  useEffect(() => {
    setPage(0);
    setLogLoaded(false);
  }, [mode]);

  const load = useCallback(async () => {
    const base = { session: query.session || undefined, symbol: query.symbol || undefined, types: typesParam(query.types) };
    if (noneSelected(query.types)) {
      setLive([]);
      setLogRows([]);
      setLogTotal(0);
      setError(null);
      setLoaded(true);
      setLogLoaded(true);
      return;
    }
    try {
      const [l, h] = await Promise.all([
        marketApi.breakouts({ limit: LIVE_N, ...base }),
        mode === "history" ? marketApi.breakouts({ limit: PAGE, offset: page * PAGE, ...base }) : Promise.resolve(null),
      ]);
      setEnabled(l.enabled);
      setLive(l.breakouts);
      if (h) {
        setLogRows(h.breakouts);
        setLogTotal(h.total);
      }
      setLastRun(l.lastRun);
      setError(null);
    } catch {
      setError("Could not load breakouts");
    } finally {
      setLoaded(true);
      if (mode === "history") setLogLoaded(true);
    }
  }, [query, page, mode]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // A changed filter restarts the historical log at page 1.
  useEffect(() => setPage(0), [query]);

  const pages = pageCount(logTotal, PAGE);

  const openNote = (eventKey: string) => {
    setNoteKey(eventKey);
    const url = new URL(window.location.href);
    url.searchParams.set("note", eventKey);
    window.history.replaceState(null, "", url);
  };
  const closeNote = () => {
    setNoteKey(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("note");
    window.history.replaceState(null, "", url);
  };
  const openChart = (symbol: string) => {
    if (!symbol) return;
    if (noteKey) closeNote();
    onOpenSymbol?.(symbol);
  };

  const noteBreakout = noteKey ? [...live, ...logRows].find((b) => b.event_key === noteKey) : undefined;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Radio className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-fg">Breakouts</h3>
          {enabled && !error && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Live
            </span>
          )}
          {lastRun && (
            <span
              className="text-[11px] text-fg-faint"
              title={Object.entries(lastRun.skippedDetail)
                .map(([k, v]) => k + ": " + v)
                .join("\n")}
            >
              checked {relativeTime(lastRun.timestamp_utc)} · {lastRun.evaluated} evaluated
              {lastRun.skipped > 0 ? ` · ${lastRun.skipped} skipped` : ""}
            </span>
          )}

          <div
            role="group"
            aria-label="Breakout view"
            className="ml-auto flex items-center rounded-lg border border-hairline-strong bg-soft p-[3px]"
          >
            {(["recent", "history"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  if (v === mode) return;
                  setPage(0);
                  setMode(v);
                }}
                aria-pressed={mode === v}
                className={
                  "h-7 rounded-md px-2.5 text-[11.5px] font-semibold transition " +
                  (mode === v ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")
                }
              >
                {v === "recent" ? "Recent" : "History"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <FilterBar filters={filters} onChange={setFilters} />
        </div>

        {!enabled && <p className="mt-3 text-[12.5px] text-fg-muted">Breakout detection is turned off (ENABLE_BREAKOUTS=false).</p>}
        {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
      </Card>

      {mode === "recent" ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {!loaded ? (
            Array.from({ length: 6 }, (_, i) => <BreakoutCardSkeleton key={i} />)
          ) : noneSelected(query.types) ? (
            <GridMessage>Select at least one breakout type.</GridMessage>
          ) : live.length === 0 ? (
            <GridMessage>
              {error
                ? "Could not load breakouts."
                : lastRun
                  ? `No breakouts match these filters. The last check covered ${lastRun.evaluated} symbols.`
                  : "No breakouts yet. The first check runs shortly after the server starts."}
            </GridMessage>
          ) : (
            live.map((b) => (
              <BreakoutCard
                key={rowKey(b)}
                breakout={b}
                onOpenNote={(item) => {
                  if (item.event_key) openNote(item.event_key);
                }}
                onOpenChart={openChart}
              />
            ))
          )}
        </div>
      ) : (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-fg">Breakout history</h4>
            <span className="text-[11px] text-fg-faint">{logTotal} total</span>
          </div>

          {!logLoaded ? (
            <p className="py-2 text-[12px] text-fg-faint">Loading history…</p>
          ) : logTotal === 0 ? (
            <p className="py-2 text-[12px] text-fg-faint">No logged breakouts.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-fg-faint">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Time (local)</th>
                      <th className="py-1 pr-2 font-medium">Symbol</th>
                      <th className="py-1 pr-2 font-medium">Type</th>
                      <th className="py-1 pr-2 font-medium">Level</th>
                      <th className="py-1 pr-2 font-medium">Break</th>
                      <th className="py-1 pr-2 font-medium">ATR x</th>
                      <th className="py-1 pr-2 font-medium">Session</th>
                      <th className="py-1 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {logRows.map((b) => (
                      <tr key={rowKey(b)}>
                        <td className="py-1 pr-2 text-fg-muted">{fmtCaptureTime(b.timestamp_utc)}</td>
                        <td className="py-1 pr-2">
                          <button
                            type="button"
                            className="font-semibold hover:text-accent"
                            onClick={() => openChart(b.symbol)}
                          >
                            {b.symbol}
                          </button>
                        </td>
                        <td className="py-1 pr-2" style={{ color: BREAKOUT_STYLE[b.type].color }}>
                          {BREAKOUT_STYLE[b.type].short}
                        </td>
                        <td className="py-1 pr-2">{fmtPrice(b.level_price)}</td>
                        <td className="py-1 pr-2">{fmtPrice(b.break_price)}</td>
                        <td className="py-1 pr-2">{b.break_atr_mult == null ? "-" : b.break_atr_mult.toFixed(1)}</td>
                        <td className="py-1 pr-2">{SESSION_LABEL[b.session] ?? b.session}</td>
                        <td className="py-1">
                          {b.event_key && (
                            <button
                              type="button"
                              onClick={() => openNote(b.event_key!)}
                              className="text-[11px] font-medium text-accent hover:underline"
                            >
                              Note
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex items-center justify-between text-[12px] text-fg-muted">
                <span>
                  {logTotal} total · page {page + 1} of {pages}
                </span>
                <span className="flex gap-2">
                  <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
                    Prev
                  </button>
                  <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">
                    Next
                  </button>
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      {noteKey && (
        <BreakoutNoteModal
          eventKey={noteKey}
          breakout={noteBreakout}
          onClose={closeNote}
          onOpenChart={openChart}
        />
      )}
    </div>
  );
}
