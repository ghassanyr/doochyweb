// Pure formatting and filtering helpers for the market snapshots panel. Kept
// out of the .tsx so they can be unit tested (the test tsconfig has no JSX).

import {
  detectedTimeZone,
  formatLocalTime,
  localDayKey,
  timeZoneLabel,
  type TimeOptions,
} from "../time";
import type { CaptureChange, MarketSnapshot } from "./types";

// The cron writes UTC. Everything the trader reads is rendered in their own
// zone through the shared local-time helpers, so DST is handled by the platform.

export const SESSION_LABEL: Record<string, string> = {
  tokyo: "Tokyo",
  london: "London",
  pre_ny: "Pre-NY",
  ny: "New York",
  ny_afternoon: "NY afternoon",
  hourly: "Hourly",
  "4h_close": "4H close",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function yearOf(key: string): number {
  return Number(key.slice(0, 4));
}

/** "20:04 GMT+3", or "26 Oct 20:04 GMT+3" when it is not today locally. */
export function fmtCaptureTime(iso: string, now = Date.now(), opts: TimeOptions = {}): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso || "-";
  const local = { ...opts, timeZone: opts.timeZone ?? detectedTimeZone() };
  const hhmm = formatLocalTime(date, local);
  const label = timeZoneLabel({ ...local, at: date });
  const key = localDayKey(date, local);
  const todayKey = localDayKey(new Date(now), local);
  if (key === todayKey) return `${hhmm} ${label}`;
  const [y, m, d] = key.split("-").map(Number);
  const year = y === yearOf(todayKey) ? "" : ` ${y}`;
  return `${d} ${MONTHS[m - 1]}${year} ${hhmm} ${label}`;
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** YYYY-MM-DD of the capture in the visitor's zone, used for day dividers. */
export function dayKey(iso: string, opts: TimeOptions = {}): string {
  return localDayKey(iso, opts);
}

/** "Today", "Yesterday", or "26 Oct 2026" for a dayKey. */
export function dayLabel(key: string, now = Date.now(), opts: TimeOptions = {}): string {
  if (!key) return "";
  const todayKey = localDayKey(new Date(now), opts);
  const yesterdayKey = localDayKey(new Date(now - 86_400_000), opts);
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Collapse changes so a symbol that flipped signal and lost a pattern is one row. */
export function groupChanges(changes: CaptureChange[]): { symbol: string; changes: CaptureChange[] }[] {
  const map = new Map<string, CaptureChange[]>();
  for (const c of changes) {
    const list = map.get(c.symbol);
    if (list) list.push(c);
    else map.set(c.symbol, [c]);
  }
  return [...map.entries()].map(([symbol, list]) => ({ symbol, changes: list }));
}

export function changedSymbolCount(changes: CaptureChange[]): number {
  return new Set(changes.map((c) => c.symbol)).size;
}

/** True when the free-text query matches any symbol, session or type. */
export function matchesCapture(cap: MarketSnapshot, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const symbols = [
    ...cap.changes.map((c) => c.symbol),
    ...cap.true_alignments.engulf_1h_4h.map((a) => a.symbol),
    ...cap.true_alignments.triple.map((a) => a.symbol),
    ...cap.needles_fired.map((n) => n.symbol),
  ];
  if (symbols.some((s) => s.toLowerCase().includes(q))) return true;
  return cap.session.toLowerCase().includes(q) || cap.capture_type.toLowerCase().includes(q);
}
