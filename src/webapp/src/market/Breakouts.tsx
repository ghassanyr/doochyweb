import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Radio } from "lucide-react";

import { ApiError, marketApi } from "../api";
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
import type { Breakout, BreakoutRunStatus, NarrationBrief, NarrationNote } from "./types";

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

function noteUrl(eventKey: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("note", eventKey);
  return url.toString();
}

const fmtPct = (r: number | null): string => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);
const fmtAtr = (x: number | null): string => (x == null ? "—" : `${Math.abs(x).toFixed(2)} ATR`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="text-fg-muted">{value}</div>
    </div>
  );
}

function NarrationStats({ brief }: { brief: NarrationBrief }) {
  const [open, setOpen] = useState(false);
  const h = brief.history;
  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] font-medium text-accent hover:underline"
      >
        {open ? "Hide historical data" : "Historical data"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[11px]">
          {h ? (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <Stat label="Sample" value={`${h.sample_size} / ${h.pool_size} bars`} />
                <Stat label="Split" value={`${h.match_train} older / ${h.match_test} recent`} />
                <Stat label="Up first" value={`${fmtPct(h.decisive_up_share)} (${h.up_first})`} />
                <Stat label="Down first" value={`${fmtPct(h.decisive_down_share)} (${h.down_first})`} />
                <Stat label="Tie / neither" value={`${h.tie} / ${h.neither}`} />
                <Stat label="Base up first" value={`${fmtPct(h.base_up_share)} (n=${h.base_n})`} />
                <Stat label="Recent up first" value={`${fmtPct(h.recent_up_share)} (n=${h.recent_n})`} />
                <Stat label="Recent down first" value={fmtPct(h.recent_down_share)} />
                <Stat label="Median MFE" value={fmtAtr(h.median_mfe)} />
                <Stat label="Median MAE" value={fmtAtr(h.median_mae)} />
                <Stat label="Base MFE / MAE" value={`${fmtAtr(h.base_median_mfe)} / ${fmtAtr(h.base_median_mae)}`} />
              </div>
              <p className="text-fg-faint">
                First-touch race: ±1 ATR over 6 bars from the next open. Not a win rate. Decisions exclude ties and
                neither-touched cases.
              </p>
            </>
          ) : (
            <p className="text-fg-faint">No analogue history was available for this event.</p>
          )}
          <ul className="list-disc space-y-0.5 pl-4 text-fg-faint">
            {[...brief.limits, ...brief.quality].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotePanel({ eventKey, onClose }: { eventKey: string; onClose?: () => void }) {
  const [note, setNote] = useState<NarrationNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setNote(null);
    setError(null);
    setCopied(false);
    marketApi
      .narration(eventKey)
      .then((n) => alive && setNote(n))
      .catch((err: unknown) => {
        if (!alive) return;
        const api = err instanceof ApiError ? err : null;
        setError(api?.status === 404 ? "The research note for this event is not available yet." : "Could not load the research note.");
      });
    return () => {
      alive = false;
    };
  }, [eventKey]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(noteUrl(eventKey));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the address bar still holds the link */
    }
  };

  return (
    <div className="mt-1.5 rounded-lg border border-hairline bg-soft p-2.5 text-[12px]">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium text-fg">Research note</span>
        <span className="ml-auto flex items-center gap-2 text-[11px]">
          {note && (
            <button type="button" onClick={() => void copy()} className="text-accent hover:underline">
              {copied ? "Link copied" : "Copy link"}
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className="text-fg-muted hover:text-fg">
              Close
            </button>
          )}
        </span>
      </div>
      {!note && !error && <p className="text-fg-faint">Loading note…</p>}
      {error && <p className="text-fg-faint">{error}</p>}
      {note && (
        <>
          <p className="whitespace-pre-line leading-relaxed text-fg-muted">{note.text}</p>
          {note.brief && <NarrationStats brief={note.brief} />}
          <p className="mt-1 text-[10.5px] text-fg-faint">
            {note.symbol ?? "—"} · generated {relativeTime(note.created_at)} · {note.model.split("/").pop()}
          </p>
        </>
      )}
    </div>
  );
}

function BreakoutRow({
  b, onOpen, onNote, noteOpen, note,
}: {
  b: Breakout;
  onOpen: (symbol: string) => void;
  onNote?: () => void;
  noteOpen?: boolean;
  note?: ReactNode;
}) {
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
        {onNote && (
          <button
            type="button"
            onClick={onNote}
            aria-expanded={noteOpen}
            className="ml-1.5 text-[11px] font-medium text-accent hover:underline"
          >
            {noteOpen ? "Hide note" : "Note"}
          </button>
        )}
        <div className="truncate text-fg-muted" title={breakoutSummary(b)}>
          Level {fmtPrice(b.level_price)} {b.level_type ? `(${b.level_type.replace(/_/g, " ")})` : ""} · break{" "}
          {fmtPrice(b.break_price)}
        </div>
        <div className="text-[11px] text-fg-faint">
          {SESSION_LABEL[b.session] ?? b.session} · {b.confirmation.replace(/_/g, " ") || "confirmed"} ·{" "}
          {fmtUtc3(b.timestamp_utc)} · {relativeTime(b.timestamp_utc)}
        </div>
        {note}
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
  const [lastRun, setLastRun] = useState<BreakoutRunStatus | null>(null);
  const [showLog, setShowLog] = useState(false);
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
      setLastRun(l.lastRun);
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

  const visibleKeys = new Set([...live, ...logRows].map((b) => b.event_key).filter(Boolean));

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Radio className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Breakouts</h3>
        {lastRun && (
          <span className="text-[11px] text-fg-faint" title={Object.entries(lastRun.skippedDetail).map(([k, v]) => k + ": " + v).join("\n")}>
            checked {relativeTime(lastRun.timestamp_utc)} · {lastRun.evaluated} evaluated
            {lastRun.skipped > 0 ? ` · ${lastRun.skipped} skipped` : ""}
          </span>
        )}
      </div>

      {!enabled && <p className="mb-3 text-[12.5px] text-fg-muted">Breakout detection is turned off (ENABLE_BREAKOUTS=false).</p>}
      {error && <p className="mb-3 text-[12.5px] text-danger">{error}</p>}

      {noteKey && !visibleKeys.has(noteKey) && (
        <div className="mb-3">
          <NotePanel eventKey={noteKey} onClose={closeNote} />
        </div>
      )}

      <FilterBar filters={filters} onChange={setFilters} />

      <div className="mt-3">
        {noneSelected(filters.types) && (
          <p className="py-4 text-center text-[12.5px] text-fg-faint">Select at least one breakout type.</p>
        )}
        {enabled && !noneSelected(filters.types) && live.length === 0 && !error && (
          <p className="py-4 text-center text-[12.5px] text-fg-faint">
            {lastRun
              ? `No breakouts match these filters. The last check covered ${lastRun.evaluated} symbols.`
              : "No breakouts yet. The first check runs shortly after the server starts."}
          </p>
        )}
        <ul className="divide-y divide-hairline">
          {live.map((b) => {
            const key = b.event_key;
            const open = Boolean(key) && key === noteKey;
            return (
              <BreakoutRow
                key={rowKey(b)}
                b={b}
                onOpen={(s) => onOpenSymbol?.(s)}
                onNote={key ? () => (open ? closeNote() : openNote(key)) : undefined}
                noteOpen={open}
                note={key && open ? <NotePanel eventKey={key} onClose={closeNote} /> : undefined}
              />
            );
          })}
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
                  <th className="py-1 pr-2 font-medium">Session</th>
                  <th className="py-1 font-medium">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {logRows.map((b) => {
                  const key = b.event_key;
                  const open = Boolean(key) && key === noteKey;
                  return (
                    <Fragment key={rowKey(b)}>
                      <tr>
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
                        <td className="py-1 pr-2">{SESSION_LABEL[b.session] ?? b.session}</td>
                        <td className="py-1">
                          {key && (
                            <button
                              type="button"
                              onClick={() => (open ? closeNote() : openNote(key))}
                              aria-expanded={open}
                              className="text-[11px] font-medium text-accent hover:underline"
                            >
                              {open ? "Hide" : "Note"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {key && open && (
                        <tr>
                          <td colSpan={8}>
                            <NotePanel eventKey={key} onClose={closeNote} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
