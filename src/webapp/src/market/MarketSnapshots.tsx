import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Radio, Search, Target, Zap } from "lucide-react";

import { marketApi } from "../api";
import { Badge, Card, Collapse } from "../components/ui";
import { RATINGS } from "./ratings";
import {
  SESSION_LABEL,
  changedSymbolCount,
  dayKey,
  dayLabel,
  fmtUtc3,
  groupChanges,
  matchesCapture,
  relativeTime,
} from "./captures";
import type { CaptureAlignment, CaptureChange, MarketSnapshot } from "./types";

// Keep the old key so existing users do not lose their read marker.
const SEEN_KEY = "doochyweb_openclaw_seen";
const PAGE = 40;
const MAX = 1000;

function labelColor(label: string): string {
  const key = label.trim().toLowerCase();
  if (key === "strong buy") return RATINGS.strong_buy.color;
  if (key === "buy") return RATINGS.buy.color;
  if (key === "sell") return RATINGS.sell.color;
  if (key === "strong sell") return RATINGS.strong_sell.color;
  return RATINGS.neutral.color;
}

function SymbolButton({ symbol, onOpen }: { symbol: string; onOpen: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(symbol)}
      title={`Open ${symbol} analysis`}
      className="shrink-0 font-semibold text-fg underline-offset-2 hover:text-accent hover:underline"
    >
      {symbol}
    </button>
  );
}

function FieldChip({ field }: { field: string }) {
  const isPattern = field === "patterns" || field === "pattern";
  return (
    <span
      className={
        "shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide " +
        (isPattern
          ? "border-hairline-strong bg-soft text-fg-muted"
          : "border-accent/25 bg-accent-soft text-accent")
      }
    >
      {isPattern ? "pattern" : field === "signal" ? "signal" : field}
    </span>
  );
}

function ChangeDetail({ c }: { c: CaptureChange }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <FieldChip field={c.field} />
      {c.new ? (
        <>
          <span className="truncate text-fg-muted">{c.old || "none"}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-fg-faint" />
          <span className="shrink-0 font-medium" style={{ color: labelColor(c.new) }}>
            {c.new}
          </span>
        </>
      ) : (
        <span className="truncate text-fg-muted">
          <span className="line-through">{c.old || "none"}</span> removed
        </span>
      )}
    </span>
  );
}

function ChangeGroup({
  symbol,
  changes,
  onOpenSymbol,
}: {
  symbol: string;
  changes: CaptureChange[];
  onOpenSymbol: (s: string) => void;
}) {
  return (
    <li className="flex min-w-0 items-start gap-2 py-1">
      <span className="w-[76px] shrink-0 truncate">
        <SymbolButton symbol={symbol} onOpen={onOpenSymbol} />
      </span>
      <ul className="min-w-0 flex-1 space-y-0.5">
        {changes.map((c, i) => (
          <li key={`${c.field}-${i}`} className="min-w-0">
            <ChangeDetail c={c} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function AlignmentLine({ a, onOpenSymbol }: { a: CaptureAlignment; onOpenSymbol: (s: string) => void }) {
  const text = a.details || a.type;
  const tone = a.signal || text;
  const showSignal = a.signal && a.signal !== a.type;
  return (
    <li className="flex items-start gap-1.5">
      <Target className="mt-[2px] h-3 w-3 shrink-0" style={{ color: labelColor(tone) }} />
      <span className="min-w-0">
        <SymbolButton symbol={a.symbol} onOpen={onOpenSymbol} />
        <span className="text-fg-muted"> {text}</span>
        {showSignal && (
          <span className="ml-1 font-medium" style={{ color: labelColor(a.signal) }}>
            ({a.signal})
          </span>
        )}
      </span>
    </li>
  );
}

function NeedleChip({
  symbol,
  kind,
  level,
  onOpenSymbol,
}: {
  symbol: string;
  kind: string;
  level: string;
  onOpenSymbol: (s: string) => void;
}) {
  if (!symbol) return null;
  const color = labelColor(level) === RATINGS.neutral.color && !level ? RATINGS.neutral.color : labelColor(level);
  const label = kind === "triple" ? "triple" : kind === "engulf_1h_4h" ? "1H+4H" : kind || "needle";
  return (
    <button
      type="button"
      onClick={() => onOpenSymbol(symbol)}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition hover:brightness-110"
      style={{ color, borderColor: color }}
      title={`Open ${symbol} analysis`}
    >
      <Zap className="h-3 w-3" />
      {symbol} {label}{level ? ` (${level})` : ""}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-soft px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function SnapshotRow({
  cap,
  open,
  unseen,
  onToggle,
  onOpenSymbol,
}: {
  cap: MarketSnapshot;
  open: boolean;
  unseen: boolean;
  onToggle: () => void;
  onOpenSymbol: (s: string) => void;
}) {
  const { summary } = cap;
  const sessionLabel = SESSION_LABEL[cap.session] ?? cap.session ?? "-";
  const typeLabel = cap.capture_type === "full" ? "full" : "hourly";
  // The cron has sometimes written the changed-row count instead of the total
  // market count. When the number matches the distinct changed symbols it is
  // almost certainly that, so label it honestly.
  const distinctChanged = changedSymbolCount(cap.changes);
  const changedCount = cap.market_count > 0 && cap.market_count === distinctChanged;
  const alignments = cap.true_alignments.engulf_1h_4h.length + cap.true_alignments.triple.length;
  const hasDetail = cap.changes.length > 0 || alignments > 0 || cap.needles_fired.length > 0;
  const groups = groupChanges(cap.changes);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${fmtUtc3(cap.timestamp_utc)} ${sessionLabel} snapshot`}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-surface-hover/60"
      >
        <span
          className={
            "h-1.5 w-1.5 shrink-0 rounded-full " +
            (cap.needles_fired.length ? "bg-accent" : "bg-fg-faint/60")
          }
        />
        <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-fg">{fmtUtc3(cap.timestamp_utc)}</span>
        <span className="hidden shrink-0 text-[10.5px] text-fg-faint md:inline">{relativeTime(cap.timestamp_utc)}</span>
        {unseen && <Badge tone="accent">new</Badge>}
        <Badge tone="accent">{sessionLabel}</Badge>
        {typeLabel !== cap.session && (
          <Badge tone={cap.capture_type === "full" ? "success" : "muted"}>{typeLabel}</Badge>
        )}
        {cap.market_count > 0 && (
          <span className="hidden shrink-0 text-[11px] text-fg-faint sm:inline">
            {cap.market_count} {changedCount ? "changed" : "markets"}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-fg-faint">
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="flex items-center gap-0.5" title="Strong Buy">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: RATINGS.strong_buy.color }} />
              {summary.strong_buy}
            </span>
            <span className="flex items-center gap-0.5" title="Strong Sell">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: RATINGS.strong_sell.color }} />
              {summary.strong_sell}
            </span>
          </span>
          {cap.changes.length > 0 && (
            <span className="hidden tabular-nums sm:inline">
              {cap.changes.length} {cap.changes.length === 1 ? "change" : "changes"}
            </span>
          )}
          {alignments > 0 && <Badge tone="accent">{alignments} align</Badge>}
          <ChevronDown className={"h-4 w-4 transition " + (open ? "rotate-180" : "")} />
        </span>
      </button>

      <Collapse open={open}>
        <div className="space-y-3 px-3.5 pb-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Strong Buy" value={summary.strong_buy} color={RATINGS.strong_buy.color} />
            <Stat label="Strong Sell" value={summary.strong_sell} color={RATINGS.strong_sell.color} />
            <Stat label="1H+4H align" value={summary.engulf_alignments} />
            <Stat label="Triple align" value={summary.triple_alignments} />
          </div>

          {groups.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-fg-faint">
                Changes ({cap.changes.length})
              </div>
              <ul className="divide-y divide-hairline/60 rounded-lg border border-hairline bg-soft/40 px-2.5 py-1">
                {groups.map((g) => (
                  <ChangeGroup
                    key={g.symbol}
                    symbol={g.symbol}
                    changes={g.changes}
                    onOpenSymbol={onOpenSymbol}
                  />
                ))}
              </ul>
            </div>
          )}

          {(cap.true_alignments.engulf_1h_4h.length > 0 || cap.true_alignments.triple.length > 0) && (
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-fg-faint">True alignments</div>
              <ul className="space-y-1 rounded-lg border border-hairline bg-soft/40 px-2.5 py-2 text-[12px]">
                {cap.true_alignments.engulf_1h_4h.map((a, i) => (
                  <AlignmentLine key={`e-${a.symbol}-${i}`} a={a} onOpenSymbol={onOpenSymbol} />
                ))}
                {cap.true_alignments.triple.map((a, i) => (
                  <AlignmentLine key={`t-${a.symbol}-${i}`} a={a} onOpenSymbol={onOpenSymbol} />
                ))}
              </ul>
            </div>
          )}

          {cap.true_alignments.engulf_1h_4h.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-fg-faint">1H+4H align</div>
              <ul className="space-y-1 rounded-lg border border-hairline bg-soft/40 px-2.5 py-2 text-[12px]">
                {cap.true_alignments.engulf_1h_4h.map((a, i) => (
                  <AlignmentLine key={`e2-${a.symbol}-${i}`} a={a} onOpenSymbol={onOpenSymbol} />
                ))}
              </ul>
            </div>
          )}

          {cap.true_alignments.triple.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-fg-faint">Triple alignments</div>
              <ul className="space-y-1 rounded-lg border border-hairline bg-soft/40 px-2.5 py-2 text-[12px]">
                {cap.true_alignments.triple.map((a, i) => (
                  <AlignmentLine key={`t2-${a.symbol}-${i}`} a={a} onOpenSymbol={onOpenSymbol} />
                ))}
              </ul>
            </div>
          )}

          {cap.needles_fired.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-fg-faint">Needles fired</div>
              <div className="flex flex-wrap gap-1.5">
                {cap.needles_fired.map((n, i) => (
                  <NeedleChip
                    key={`${n.symbol}-${i}`}
                    symbol={n.symbol}
                    kind={n.kind}
                    level={n.level}
                    onOpenSymbol={onOpenSymbol}
                  />
                ))}
              </div>
            </div>
          )}

          {!hasDetail && <div className="text-[12px] text-fg-muted">No pattern changes or alignments this snapshot.</div>}

          {cap.next_check_utc && (
            <div className="text-[11px] text-fg-faint">
              Next check: <span className="tabular-nums text-fg-muted">{fmtUtc3(cap.next_check_utc)}</span>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}

type Filter = "all" | "full" | "hourly";

export function MarketSnapshots({ onOpenSymbol }: { onOpenSymbol?: (symbol: string) => void }) {
  const [captures, setCaptures] = useState<MarketSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(SEEN_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  // Unread is computed against the timestamp from the previous visit and is not
  // advanced while the page is open, so the "new" pills stay visible. It is
  // persisted on hide/leave only if the section was actually on screen, plus
  // immediately via the explicit Mark read control.
  const cardRef = useRef<HTMLDivElement>(null);
  const capturesRef = useRef<MarketSnapshot[]>([]);
  const inViewRef = useRef(false);
  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      inViewRef.current = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) inViewRef.current = true;
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const persist = () => {
      if (!inViewRef.current) return;
      const newest = capturesRef.current.reduce(
        (max, c) => Math.max(max, Date.parse(c.timestamp_utc) || 0),
        0
      );
      if (!newest) return;
      try {
        localStorage.setItem(SEEN_KEY, String(newest));
      } catch {
        // Storage disabled: the marker just will not persist.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const searching = query.trim().length > 0 || filter !== "all";
  const requestLimit = searching ? MAX : limit;

  const load = useCallback(async () => {
    try {
      const res = await marketApi.captures(requestLimit);
      if (Array.isArray(res.captures)) {
        setCaptures(res.captures);
        setStale(false);
        setError(null);
      }
    } catch (err) {
      // Keep the last good list on screen; the header says it is reconnecting.
      setStale(true);
      setError(err instanceof Error ? err.message : "Failed to read snapshots");
    } finally {
      setLoaded(true);
    }
  }, [requestLimit]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(load, 15_000);
    return () => window.clearInterval(poll);
  }, [load]);

  const visible = useMemo(
    () =>
      captures.filter(
        (c) => (filter === "all" || c.capture_type === filter) && matchesCapture(c, query)
      ),
    [captures, filter, query]
  );

  const unread = useMemo(
    () => captures.filter((c) => Date.parse(c.timestamp_utc) > seen).length,
    [captures, seen]
  );

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: MarketSnapshot[] }[] = [];
    for (const cap of visible) {
      const key = dayKey(cap.timestamp_utc);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(cap);
      else out.push({ key, label: dayLabel(key), items: [cap] });
    }
    return out;
  }, [visible]);

  const markRead = useCallback(() => {
    const newest = captures.reduce((max, c) => Math.max(max, Date.parse(c.timestamp_utc) || 0), 0);
    const at = newest || Date.now();
    setSeen(at);
    try {
      localStorage.setItem(SEEN_KEY, String(at));
    } catch {
      // Private mode or storage disabled: the marker just will not persist.
    }
  }, [captures]);

  const openSymbol = useCallback(
    (symbol: string) => {
      onOpenSymbol?.(symbol);
    },
    [onOpenSymbol]
  );

  const firstVisible = visible[0];
  const canLoadOlder = !searching && captures.length >= requestLimit && requestLimit < MAX;

  return (
    <div ref={cardRef}>
      <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <Radio className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-fg">Market Snapshots</h2>
        {captures.length > 0 && (
          <Badge tone="muted">
            {captures.length} {captures.length === 1 ? "snapshot" : "snapshots"}
          </Badge>
        )}
        {unread > 0 && (
          <button type="button" onClick={markRead} title="Mark all read">
            <Badge tone="accent">{unread} new</Badge>
          </button>
        )}
        {stale && (
          <span className="flex items-center gap-1 text-[10.5px] text-amber-500" title={error ?? undefined}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            reconnecting
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-fg-faint">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          live · times UTC+3
        </span>
      </div>

      {captures.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-3.5 py-2">
          {(["all", "full", "hourly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                "rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition " +
                (filter === f
                  ? "border border-accent/20 bg-accent-soft text-accent"
                  : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
            >
              {f}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbol"
              aria-label="Filter snapshots by symbol"
              className="h-7 w-40 rounded-md border border-hairline-strong bg-soft pl-7 pr-2 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="px-3.5 py-6 text-center text-[12px] text-fg-muted">Loading snapshots…</div>
      ) : error && captures.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-[12px] text-fg-muted">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="ml-2 font-medium text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      ) : captures.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-[12px] text-fg-muted">
          No snapshots yet. The next cron run will append one here.
        </div>
      ) : visible.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-[12px] text-fg-muted">
          No snapshots match this filter.
        </div>
      ) : (
        <div className="max-h-[460px] overflow-y-auto overscroll-contain">
          {groups.map((group) => (
            <Fragment key={group.key}>
              <div className="sticky top-0 z-10 border-t border-hairline bg-surface/95 px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint backdrop-blur first:border-t-0">
                {group.label}
              </div>
              {group.items.map((cap) => (
                <div key={cap.timestamp_utc} className="border-t border-hairline/60 first:border-t-0">
                  <SnapshotRow
                    cap={cap}
                    open={open[cap.timestamp_utc] ?? cap === firstVisible}
                    unseen={Date.parse(cap.timestamp_utc) > seen}
                    onToggle={() =>
                      setOpen((prev) => ({
                        ...prev,
                        [cap.timestamp_utc]: !(prev[cap.timestamp_utc] ?? cap === firstVisible),
                      }))
                    }
                    onOpenSymbol={openSymbol}
                  />
                </div>
              ))}
            </Fragment>
          ))}
          {canLoadOlder && (
            <div className="border-t border-hairline p-2 text-center">
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))}
                className="rounded-md px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent-soft"
              >
                Load older snapshots
              </button>
            </div>
          )}
        </div>
      )}
      </Card>
    </div>
  );
}
