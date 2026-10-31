import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";

import { marketApi } from "../api";
import { Card, inputCls } from "../components/ui";
import {
  BREAKOUT_STYLE,
  BREAKOUT_TYPE_KEYS,
  SESSION_OPTIONS,
  breakoutSummary,
  fmtPrice,
  loadTypeSelection,
  noneSelected,
  pageCount,
  typesParam,
  type TypeSelection,
} from "./breakouts";
import { SESSION_LABEL, fmtUtc3, relativeTime } from "./captures";
import type { Breakout } from "./types";

const TYPE_KEY = "doochyweb_breakouts_types";
const LIVE_N = 20;
const PAGE = 25;
const POLL_MS = 15_000;
const DEBOUNCE_MS = 250;

interface Filters {
  types: TypeSelection;
  session: string;
  symbol: string;
}

function rowKey(b: Breakout): string {
  return `${b.symbol}|${b.type}|${b.session}|${b.timestamp_utc}|${b.level_price ?? ""}`;
}

function BreakoutRow({ b, onOpen }: { b: Breakout; onOpen: (symbol: string) => void }) {
  const style = BREAKOUT_STYLE[b.type];
  return (
    <li className="flex items-start gap-2 py-1.5 text-[12.5px]">
      <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: style.color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(b.symbol)}
          title={`Open ${b.symbol} analysis`}
          className="font-semibold text-fg underline-offset-2 hover:text-accent hover:underline"
        >
          {b.symbol}
        </button>
        <span className="ml-1.5 font-medium" style={{ color: style.color }}>
          {style.short}
        </span>
        <div className="truncate text-fg-muted" title={breakoutSummary(b)}>
          Level {fmtPrice(b.level_price)} {b.level_type ? `(${b.level_type.replace(/_/g, " ")})` : ""} · break{" "}
          {fmtPrice(b.break_price)}
        </div>
        <div className="text-[11px] text-fg-faint">
          {SESSION_LABEL[b.session] ?? b.session} · {b.confirmation.replace(/_/g, " ") || "confirmed"} ·{" "}
          {fmtUtc3(b.timestamp_utc)} · {relativeTime(b.timestamp_utc)}
        </div>
      </div>
    </li>
  );
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <input
        type="search"
        aria-label="Search symbol"
        placeholder="Search symbol (e.g. EUR, XAU)"
        className={inputCls}
        value={filters.symbol}
        onChange={(e) => onChange({ ...filters, symbol: e.target.value })}
      />
      <select aria-label="Session" className={inputCls} value={filters.session} onChange={(e) => onChange({ ...filters, session: e.target.value })}>
        <option value="">All sessions</option>
        {SESSION_OPTIONS.map((s) => (
          <option key={s} value={s}>{SESSION_LABEL[s] ?? s}</option>
        ))}
      </select>
      <fieldset className="flex items-center gap-3 rounded-lg border border-hairline-strong bg-soft px-3 py-2 text-[12.5px]">
        <legend className="sr-only">Breakout types</legend>
        {BREAKOUT_TYPE_KEYS.map((t) => (
          <label key={t} className="flex items-center gap-1.5 whitespace-nowrap" style={{ color: BREAKOUT_STYLE[t].color }}>
            <input
              type="checkbox"
              checked={filters.types[t]}
              onChange={(e) => onChange({ ...filters, types: { ...filters.types, [t]: e.target.checked } })}
            />
            {BREAKOUT_STYLE[t].label}
          </label>
        ))}
      </fieldset>
    </div>
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
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);

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

  const load = useCallback(async () => {
    const base = { session: query.session || undefined, symbol: query.symbol || undefined, types: typesParam(query.types) };
    if (noneSelected(query.types)) {
      setLive([]);
      setLogRows([]);
      setLogTotal(0);
      setError(null);
      return;
    }
    try {
      const [l, h] = await Promise.all([
        marketApi.breakouts({ limit: LIVE_N, ...base }),
        showLog ? marketApi.breakouts({ limit: PAGE, offset: page * PAGE, ...base }) : Promise.resolve(null),
      ]);
      setEnabled(l.enabled);
      setLive(l.breakouts);
      if (h) {
        setLogRows(h.breakouts);
        setLogTotal(h.total);
      }
      setUpdatedAt(l.updatedAt);
      setError(null);
    } catch {
      setError("Could not load breakouts");
    }
  }, [query, page, showLog]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // A changed filter restarts the historical log at page 1.
  useEffect(() => setPage(0), [query]);

  const pages = pageCount(logTotal, PAGE);

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Breakouts</h3>
        {updatedAt && <span className="text-[11px] text-fg-faint">updated {relativeTime(new Date(updatedAt).toISOString())}</span>}
      </div>

      {!enabled && <p className="mb-3 text-[12.5px] text-fg-muted">Breakout detection is turned off (ENABLE_BREAKOUTS=false).</p>}
      {error && <p className="mb-3 text-[12.5px] text-danger">{error}</p>}

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="mt-3">
        {noneSelected(filters.types) && (
          <p className="py-4 text-center text-[12.5px] text-fg-faint">Select at least one breakout type.</p>
        )}
        {enabled && !noneSelected(filters.types) && live.length === 0 && !error && (
          <p className="py-4 text-center text-[12.5px] text-fg-faint">No breakouts match these filters.</p>
        )}
        <ul className="divide-y divide-hairline">
          {live.map((b) => (
            <BreakoutRow key={rowKey(b)} b={b} onOpen={(s) => onOpenSymbol?.(s)} />
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setShowLog((s) => !s)}
        aria-expanded={showLog}
        className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-fg-muted hover:text-fg"
      >
        <ChevronDown className={"h-3.5 w-3.5 transition " + (showLog ? "rotate-180" : "")} />
        Historical log
      </button>

      {showLog && (
        <div className="mt-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-fg-faint">
                <tr>
                  <th className="py-1 pr-2 font-medium">Time (UTC+3)</th>
                  <th className="py-1 pr-2 font-medium">Symbol</th>
                  <th className="py-1 pr-2 font-medium">Type</th>
                  <th className="py-1 pr-2 font-medium">Level</th>
                  <th className="py-1 pr-2 font-medium">Break</th>
                  <th className="py-1 pr-2 font-medium">ATR x</th>
                  <th className="py-1 font-medium">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {logRows.map((b) => (
                  <tr key={rowKey(b)}>
                    <td className="py-1 pr-2 text-fg-muted">{fmtUtc3(b.timestamp_utc)}</td>
                    <td className="py-1 pr-2">
                      <button type="button" className="font-semibold hover:text-accent" onClick={() => onOpenSymbol?.(b.symbol)}>
                        {b.symbol}
                      </button>
                    </td>
                    <td className="py-1 pr-2" style={{ color: BREAKOUT_STYLE[b.type].color }}>{BREAKOUT_STYLE[b.type].short}</td>
                    <td className="py-1 pr-2">{fmtPrice(b.level_price)}</td>
                    <td className="py-1 pr-2">{fmtPrice(b.break_price)}</td>
                    <td className="py-1 pr-2">{b.break_atr_mult == null ? "-" : b.break_atr_mult.toFixed(1)}</td>
                    <td className="py-1">{SESSION_LABEL[b.session] ?? b.session}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logTotal === 0 && <p className="py-3 text-center text-[12px] text-fg-faint">No logged breakouts.</p>}
          {logTotal > 0 && (
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
          )}
        </div>
      )}
    </Card>
  );
}
