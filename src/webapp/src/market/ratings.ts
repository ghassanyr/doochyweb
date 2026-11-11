// Rating / signal presentation metadata for the Analysis page. The five-step
// scale and its hexes are the ones from the standalone Gauge project, kept as
// explicit values rather than Tailwind classes because the SVG dial and
// sparkline need them as fill/stroke attributes, and the dial's coloured zones
// must line up exactly with the rating colours used elsewhere in the UI.

export type Rating = "strong_sell" | "sell" | "neutral" | "buy" | "strong_buy";
export type Signal = "buy" | "sell" | "neutral";

export const RATINGS: Record<Rating, { label: string; color: string }> = {
  strong_sell: { label: "Strong Sell", color: "#dc2626" },
  sell: { label: "Sell", color: "#f87171" },
  neutral: { label: "Neutral", color: "#94a3b8" },
  buy: { label: "Buy", color: "#34d399" },
  strong_buy: { label: "Strong Buy", color: "#16a34a" },
};

export const SIGNALS: Record<Signal, string> = {
  buy: "Buy",
  sell: "Sell",
  neutral: "Neutral",
};

// Zone order for the dial, left (bearish) to right (bullish).
export const ZONE_ORDER: Rating[] = ["strong_sell", "sell", "neutral", "buy", "strong_buy"];
export const ZONE_COLORS = ZONE_ORDER.map((r) => RATINGS[r].color);

export const PROVIDERS: Record<string, string> = {
  ctrader: "cTrader",
  binance: "Binance",
};

export function ratingColor(rating: string | undefined): string {
  return (RATINGS[rating as Rating]?.color ?? RATINGS.neutral.color);
}

export function ratingLabel(rating: string | undefined): string {
  return RATINGS[rating as Rating]?.label ?? "-";
}

export function signalColor(signal: Signal | undefined): string {
  if (signal === "buy") return RATINGS.buy.color;
  if (signal === "sell") return RATINGS.sell.color;
  return RATINGS.neutral.color;
}

export function providerName(id: string | undefined): string {
  return PROVIDERS[id ?? ""] ?? id ?? "-";
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Price decimals scale with magnitude so big values don't trail zeros. */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtChangePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function changeTone(v: number | null | undefined): string {
  if (v == null || Math.abs(v) < 1e-9) return "text-fg-muted";
  return v > 0 ? "text-success" : "text-danger";
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Age of a completed bar. Unlike timeAgo this never falls back to a clock
 * time, so a badge always reads as "how long ago the pattern printed".
 */
export function barAge(ts: number | null | undefined): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// A few indicators are quoted in price units rather than an index value, so
// they read better with adaptive precision than a flat two decimals.
export const PRICE_STYLE_INDICATORS = ["ATR(14)", "Highs/Lows(14)", "Bull/Bear Power(13)"];

export function indicatorValue(name: string, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (PRICE_STYLE_INDICATORS.includes(name)) return fmtPrice(value);
  return value.toFixed(2);
}