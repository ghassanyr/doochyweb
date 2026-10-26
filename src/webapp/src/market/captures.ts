// Pure formatting and filtering helpers for the OpenClaw captures panel. Kept
// out of the .tsx so they can be unit tested (the test tsconfig has no JSX).

import type { CaptureChange, OpenclawCapture } from "./types";

// The cron writes UTC. Everything the trader reads is UTC+3 (fixed offset, no
// DST) to match the Telegram messages.
export const UTC3_MS = 3 * 3_600_000;

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

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shift3(iso: string): Date | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + UTC3_MS);
}

/** "20:04 UTC+3", or "26 Oct 20:04 UTC+3" when it is not today in UTC+3. */
export function fmtUtc3(iso: string, now = Date.now()): string {
  const d = shift3(iso);
  if (!d) return iso || "-";
  const today = new Date(now + UTC3_MS);
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  if (sameDay) return `${hh}:${mm} UTC+3`;
  const year = d.getUTCFullYear() === today.getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} ${hh}:${mm} UTC+3`;
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

/** YYYY-MM-DD of the capture in UTC+3, used for day dividers. */
export function dayKey(iso: string): string {
  const d = shift3(iso);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "Today", "Yesterday", or "26 Oct 2026" for a dayKey. */
export function dayLabel(key: string, now = Date.now()): string {
  if (!key) return "";
  const todayKey = dayKey(new Date(now).toISOString());
  const yesterdayKey = dayKey(new Date(now - 86_400_000).toISOString());
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
export function matchesCapture(cap: OpenclawCapture, query: string): boolean {
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
