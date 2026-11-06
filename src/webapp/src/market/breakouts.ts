// Pure presentation helpers for the Breakouts panel. Kept out of the .tsx so the
// test suite (no JSX) can cover them.

import type { Breakout, BreakoutType } from "./types";

export const BREAKOUT_STYLE: Record<BreakoutType, { label: string; short: string; color: string; bias: string; prefix: string }> = {
  resistance_break: { label: "Resistance", short: "Resistance", color: "#16a34a", bias: "long bias", prefix: "🚀" },
  support_break: { label: "Support", short: "Support", color: "#dc2626", bias: "short bias", prefix: "🛑" },
  pattern_break: { label: "Pattern", short: "Pattern", color: "#2563eb", bias: "pattern", prefix: "📐" },
};

export const SESSION_OPTIONS = ["tokyo", "london", "pre_ny", "ny", "ny_afternoon", "hourly", "4h_close"] as const;

export const BREAKOUT_TYPE_KEYS = Object.keys(BREAKOUT_STYLE) as BreakoutType[];

/** Which breakout types are selected. Drives the type filter sent to the API. */
export type TypeSelection = Record<BreakoutType, boolean>;

export const ALL_TYPES: TypeSelection = {
  resistance_break: true,
  support_break: true,
  pattern_break: true,
};

/**
 * Query value for the selected types. Undefined when every type is selected
 * (no filter). An empty string when none is selected: the caller should show an
 * empty state instead of asking the API, because the API reads "" as "no filter".
 */
export function typesParam(sel: TypeSelection): string | undefined {
  const chosen = BREAKOUT_TYPE_KEYS.filter((t) => sel[t]);
  if (chosen.length === BREAKOUT_TYPE_KEYS.length) return undefined;
  return chosen.join(",");
}

export function noneSelected(sel: TypeSelection): boolean {
  return BREAKOUT_TYPE_KEYS.every((t) => !sel[t]);
}

export function fmtPct(n: number | null, d = 2): string {
  return n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
}

/** Break as a percent of the level, when both prices are known. */
export function breakPct(b: Breakout): number | null {
  if (b.level_price == null || b.break_price == null || b.level_price === 0) return null;
  return ((b.break_price - b.level_price) / b.level_price) * 100;
}

export function fmtPrice(n: number | null): string {
  if (n == null) return "-";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 100 ? 2 : abs >= 1 ? 4 : 6);
}

/** Whether the event broke above or below its reference level. */
export function breakoutDirection(b: Breakout): "above" | "below" {
  if (b.type === "resistance_break") return "above";
  if (b.type === "support_break") return "below";
  if (b.level_price == null || b.break_price == null) return "above";
  return b.break_price >= b.level_price ? "above" : "below";
}

/** Meter fill for the ATR distance; 3 ATR or more fills the bar. */
export function breakoutMeterPct(b: Breakout): number {
  if (b.break_atr_mult == null) return 0;
  return Math.max(0, Math.min(100, (Math.abs(b.break_atr_mult) / 3) * 100));
}

/** One-line summary used in tooltips. */
export function breakoutSummary(b: Breakout): string {
  const style = BREAKOUT_STYLE[b.type];
  const level = b.level_type ? `${fmtPrice(b.level_price)} (${b.level_type.replace(/_/g, " ")})` : fmtPrice(b.level_price);
  const atr = b.break_atr_mult == null ? "" : `, ${b.break_atr_mult.toFixed(1)}x ATR`;
  return `${style.prefix} ${b.symbol} ${style.short} | level ${level} | break ${fmtPrice(b.break_price)} (${fmtPct(breakPct(b))}${atr})`;
}

/** Parse stored selection. Corrupt or missing values fall back to all selected. */
export function loadTypeSelection(storage: Pick<Storage, "getItem"> | undefined, key: string): TypeSelection {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return { ...ALL_TYPES };
    const parsed = JSON.parse(raw) as Partial<TypeSelection>;
    return { ...ALL_TYPES, ...parsed };
  } catch {
    return { ...ALL_TYPES };
  }
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
