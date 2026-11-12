// Pure presentation helpers for the Signals feed. Kept out of the .tsx so the
// test suite can cover the derived values without JSX.

import { formatLocalDate } from "../time";
import type { Signal, SignalDirection, SignalStatus } from "./types";

export const SIGNAL_STATUS: Record<
  SignalStatus,
  { label: string; tone: "muted" | "success" | "danger" | "accent"; blurb: string }
> = {
  active: { label: "Active", tone: "accent", blurb: "Open idea" },
  invalidated: { label: "Invalidated", tone: "danger", blurb: "Closed by an admin" },
  expired: { label: "Expired", tone: "muted", blurb: "Validity window ended" },
  target_hit: { label: "Target hit", tone: "success", blurb: "Resolved at target" },
  stopped_out: { label: "Stopped out", tone: "danger", blurb: "Resolved at stop" },
};

export const SIGNAL_DIRECTION: Record<SignalDirection, { label: string; tone: "success" | "danger" }> = {
  buy: { label: "BUY", tone: "success" },
  sell: { label: "SELL", tone: "danger" },
};

export const EXPIRY_PRESETS = [
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "30m", label: "30m", ms: 30 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "4h", label: "4h", ms: 4 * 60 * 60_000 },
  { id: "1d", label: "1d", ms: 24 * 60 * 60_000 },
] as const;

export type ExpiryPresetId = (typeof EXPIRY_PRESETS)[number]["id"];

/** ISO expiry for a quick preset, measured from the moment it is published. */
export function expiryIsoForPreset(id: ExpiryPresetId, now: Date = new Date()): string {
  const preset = EXPIRY_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown expiry preset: ${id}`);
  return new Date(now.getTime() + preset.ms).toISOString();
}

/** Price decimals scale with magnitude, matching the Analysis cards. */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** A range ("entry" to "entryMax") is represented by its midpoint. */
export function computeRR(
  entry: number | null | undefined,
  target: number | null | undefined,
  stop: number | null | undefined,
  entryMax?: number | null
): number | null {
  if (entry == null || target == null || stop == null) return null;
  const ref = entryMax != null && Number.isFinite(entryMax) ? (entry + entryMax) / 2 : entry;
  const risk = Math.abs(ref - stop);
  const reward = Math.abs(target - ref);
  if (!(risk > 0) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

/** Entry price, or "low–high" when a range is set. */
export function fmtEntry(entry: number | null | undefined, entryMax?: number | null): string {
  if (entry == null) return "-";
  if (entryMax == null || !Number.isFinite(entryMax)) return fmtPrice(entry);
  return `${fmtPrice(entry)}–${fmtPrice(entryMax)}`;
}

export function fmtRR(rr: number | null | undefined): string {
  return rr == null || !Number.isFinite(rr) ? "-" : `${rr.toFixed(2)}R`;
}

export function fmtPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** Distance from the current price to target/stop, in percent of price. */
export function distances(signal: Signal, price: number | null | undefined): { toTarget: number | null; toStop: number | null } {
  if (price == null || !Number.isFinite(price) || price <= 0) return { toTarget: null, toStop: null };
  return {
    toTarget: ((signal.target - price) / price) * 100,
    toStop: ((signal.stop - price) / price) * 100,
  };
}

export interface Progress {
  /** Where price sits between stop (0) and target (100). */
  pricePct: number;
  /** Where the entry (range low) sits on the same scale, when entry exists. */
  entryPct: number | null;
  /** Where the entry range high sits, when a range exists. */
  entryMaxPct: number | null;
  /** True when price is on the profitable side of entry. */
  profitable: boolean;
}

/** Map a live price onto the stop→target range, clamped to the bar. */
export function progressFor(signal: Signal, price: number | null | undefined): Progress | null {
  if (price == null || !Number.isFinite(price)) return null;
  const low = Math.min(signal.stop, signal.target);
  const high = Math.max(signal.stop, signal.target);
  if (!(high > low)) return null;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const pricePct = clamp(((price - low) / (high - low)) * 100);
  const entryPct =
    signal.entry == null ? null : clamp(((signal.entry - low) / (high - low)) * 100);
  const entryMaxPct =
    signal.entryMax == null ? null : clamp(((signal.entryMax - low) / (high - low)) * 100);
  const ref =
    signal.entry == null
      ? null
      : signal.entryMax == null
        ? signal.entry
        : (signal.entry + signal.entryMax) / 2;
  const profitable =
    ref == null ? false : signal.direction === "buy" ? price >= ref : price <= ref;
  return { pricePct, entryPct, entryMaxPct, profitable };
}

/** Coarse relative age, independent of zone. */
export function relativeAgo(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return formatLocalDate(iso);
}

/** The timestamp that best describes the signal's current state. */
export function statusTimestamp(signal: Signal): { label: string; iso: string } | null {
  if (signal.status === "target_hit" || signal.status === "stopped_out") {
    return signal.resolvedAt ? { label: "Resolved", iso: signal.resolvedAt } : null;
  }
  if (signal.status === "invalidated") {
    return signal.invalidatedAt ? { label: "Invalidated", iso: signal.invalidatedAt } : null;
  }
  if (signal.status === "expired") {
    return signal.expiresAt ? { label: "Expired", iso: signal.expiresAt } : null;
  }
  return null;
}

/** Plain-text version for the clipboard. */
export function signalShareText(signal: Signal): string {
  const lines = [
    `${signal.symbol} ${signal.direction.toUpperCase()}${signal.timeframe ? ` (${signal.timeframe})` : ""}`,
  ];
  if (signal.entry != null) lines.push(`Entry: ${fmtEntry(signal.entry, signal.entryMax)}`);
  lines.push(`Target: ${fmtPrice(signal.target)}`);
  lines.push(`Stop: ${fmtPrice(signal.stop)}`);
  const rr = computeRR(signal.entry, signal.target, signal.stop, signal.entryMax);
  if (rr != null) lines.push(`R:R ${rr.toFixed(2)}`);
  if (signal.note) lines.push(`Note: ${signal.note}`);
  return lines.join("\n");
}

/** Human label for a timeframe id ("4h" → "4h"); unknown ids fall back to raw. */
export function timeframeLabel(id: string | null | undefined): string {
  return id ? id : "-";
}
