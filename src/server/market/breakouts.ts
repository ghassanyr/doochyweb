// Breakout events emitted by the doochy-breakout-storage writer, carried in each
// OpenClaw capture line under `breakouts[]`. This module is pure (no fs) so the
// route and the tests share one normaliser. Reading the JSONL is in captures.ts.
//
// The writer owns detection (level, ATR and volume rules, dedup). This side only
// validates and presents what it receives. Nothing here fires or alters alerts.

import { inferType } from "./symbols";
import type { SymbolType } from "./types";

export const BREAKOUT_TYPES = ["resistance_break", "support_break", "pattern_break"] as const;
export type BreakoutType = (typeof BREAKOUT_TYPES)[number];

export interface Breakout {
  symbol: string;
  type: BreakoutType;
  level_price: number | null;
  level_type: string;
  break_price: number | null;
  break_atr_mult: number | null;
  confirmation: string;
  session: string;
  timestamp_utc: string;
  asset_class: SymbolType;
}

// Index names the broker-name heuristic in inferType does not catch.
const INDEX_ALIASES = new Set(["SPX", "NDX", "DJI", "DJIA", "NAS100", "UK100", "GER40", "FRA40", "JPN225"]);

/** Asset class for a symbol. Reuses the catalog classifier, plus a small index alias list. */
export function classifyAsset(symbol: string): SymbolType {
  const s = symbol.trim().toUpperCase();
  if (INDEX_ALIASES.has(s)) return "index";
  // Compact index names ("US100"). inferType needs a space before the number.
  if (/^(US|NAS|GER|UK|FRA|JPN|AUS|ESP|ITA)\d{2,3}$/.test(s)) return "index";
  return inferType(s);
}

function str(v: unknown): string {
  return v == null ? "" : typeof v === "string" ? v : String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise one raw breakout. Returns null for rows missing the fields that
 * identify an event (symbol, known type, timestamp). Unknown extra fields are
 * dropped. Prices that are missing or non-numeric become null, not zero.
 */
export function normalizeBreakout(raw: unknown): Breakout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const symbol = str(r.symbol).trim().toUpperCase();
  const type = str(r.type) as BreakoutType;
  const timestamp = str(r.timestamp_utc);
  if (!symbol || !(BREAKOUT_TYPES as readonly string[]).includes(type)) return null;
  if (!Number.isFinite(Date.parse(timestamp))) return null;
  return {
    symbol,
    type,
    level_price: numOrNull(r.level_price),
    level_type: str(r.level_type),
    break_price: numOrNull(r.break_price),
    break_atr_mult: numOrNull(r.break_atr_mult),
    confirmation: str(r.confirmation),
    session: str(r.session).toLowerCase(),
    timestamp_utc: timestamp,
    asset_class: classifyAsset(symbol),
  };
}

export function normalizeBreakouts(raw: unknown): Breakout[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeBreakout).filter((b): b is Breakout => b !== null);
}

/** Identity used to drop a duplicate event written twice. */
export function breakoutKey(b: Breakout): string {
  return [b.symbol, b.type, b.session, b.timestamp_utc, b.level_price ?? "", b.level_type].join("|");
}

/** Newest first. Stable for equal timestamps (keeps input order). */
export function sortNewestFirst(list: Breakout[]): Breakout[] {
  return list
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Date.parse(y.b.timestamp_utc) - Date.parse(x.b.timestamp_utc) || x.i - y.i)
    .map((x) => x.b);
}

export function dedupe(list: Breakout[]): Breakout[] {
  const seen = new Set<string>();
  const out: Breakout[] = [];
  for (const b of list) {
    const k = breakoutKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out;
}

export interface BreakoutFilter {
  /** Keep only these types. Undefined = all types; an empty array matches nothing. */
  types?: BreakoutType[];
  session?: string;
  /** Case-insensitive substring match on the symbol, e.g. "eur" matches EURJPY and EURUSD. */
  symbol?: string;
}

export function filterBreakouts(list: Breakout[], f: BreakoutFilter): Breakout[] {
  return list.filter(
    (b) =>
      (!f.types || f.types.includes(b.type)) &&
      (!f.session || b.session === f.session) &&
      (!f.symbol || b.symbol.includes(f.symbol.trim().toUpperCase()))
  );
}

/** ENABLE_BREAKOUTS=false disables the feature on the read side. Default on. */
export function breakoutsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.ENABLE_BREAKOUTS ?? "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(v);
}
