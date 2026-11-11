// Port of the doochy-scraper alignment, change and needle rules (SKILL.md, steps 3 and 6,
// and the Rules section). Pure: no I/O, no clock, no network. Callers pass closed bars.
//
// Where this differs from the browser-scraped version, it is deliberate and listed in
// AI_PLAN.md ("Port decisions"):
//  - Engulf timeframe comes from the bar set, not from a "1H" tag in a pattern string.
//    The recorded CSVs never carried that tag, so the written rule could never fire.
//  - alignment_1h_4h requires the 1H and 4H engulfs to point the same way. The spec says
//    "do not list contradictory engulf+4H combos", which this enforces.
//  - "4H low" is rebuilt from bars: the last closed 4H bar's low is below the prior 5 lows.
//    A sweep is that break closing back above the prior low; a true break closes at or below it.

import { engulfingAt } from "./engulf";
import type { Candle } from "./types";

export type Signal = "Strong Sell" | "Sell" | "Neutral" | "Buy" | "Strong Buy";
export type Engulf = "bullish" | "bearish" | null;
export type Category = "crypto" | "forex" | "commodity" | "index" | "stock" | "unknown";

export interface Structure4h {
  low4h: boolean;
  high4h: boolean;
  sweepLow: boolean;
  sweepHigh: boolean;
  trueLow: boolean;
  trueHigh: boolean;
}

export interface Obs {
  symbol: string;
  category: Category;
  price: number | null;
  signal: Signal | null;
  engulf1h: Engulf;
  engulf4h: Engulf;
  structure4h: Structure4h;
  /** Timestamp of the 4H bar the structure is read from (ISO). */
  asOf: string;
}

export interface Alignment {
  alignment_1h_4h: boolean;
  alignment_triple: boolean;
  triple_type: "4H low" | "4H high" | null;
}

const NO_STRUCTURE: Structure4h = { low4h: false, high4h: false, sweepLow: false, sweepHigh: false, trueLow: false, trueHigh: false };
const REF_BARS = 5;

// ---- session and capture type -------------------------------------------

/** Session label from UTC hour, per the Rules section of the skill. */
export function sessionLabel(iso: string): string {
  const h = new Date(iso).getUTCHours();
  if (h === 0) return "tokyo";
  if (h === 8) return "london";
  if (h === 12) return "pre_ny";
  if (h === 13) return "ny";
  if (h === 16) return "ny_afternoon";
  if (h === 4 || h === 20) return "4h_close";
  return "hourly";
}

/** Full captures at session and 4H anchors; lightweight otherwise. */
export function captureType(iso: string): "full" | "lightweight" {
  const h = new Date(iso).getUTCHours();
  return [0, 4, 8, 12, 13, 16, 20].includes(h) ? "full" : "lightweight";
}

// ---- weekend filter (SKILL.md step 3, unchanged) -------------------------

export function isWeekendClosed(iso: string): boolean {
  const dt = new Date(iso);
  const wd = dt.getUTCDay(); // 0 = Sunday
  const h = dt.getUTCHours();
  if (wd === 5 && h >= 21) return true; // Fri after 21:00 UTC
  if (wd === 6) return true; // Sat
  if (wd === 0 && h < 21) return true; // Sun before 21:00 UTC
  return false;
}

// ---- bar-derived patterns (closed bars only; last element = bar under test) ----

/**
 * Engulf on the last closed bar, using the shared trainer definition in
 * engulf.ts. Mirrors detectEngulfing() in patterns.ts.
 */
export function engulfClosed(bars: Candle[]): Engulf {
  if (bars.length < 2) return null;
  return engulfingAt(bars, bars.length - 1);
}

/** 4H structure on the last closed bar against the prior REF_BARS closed bars. */
export function structureClosed(bars: Candle[]): Structure4h {
  if (bars.length < REF_BARS + 1) return NO_STRUCTURE;
  const cur = bars[bars.length - 1];
  const ref = bars.slice(bars.length - 1 - REF_BARS, bars.length - 1);
  const refHigh = Math.max(...ref.map((b) => b.high));
  const refLow = Math.min(...ref.map((b) => b.low));
  const high4h = cur.high > refHigh;
  const low4h = cur.low < refLow;
  const sweepHigh = high4h && cur.close < refHigh;
  const sweepLow = low4h && cur.close > refLow;
  return {
    high4h,
    low4h,
    sweepHigh,
    sweepLow,
    trueHigh: high4h && !sweepHigh,
    trueLow: low4h && !sweepLow,
  };
}

// ---- alignment rules (SKILL.md step 3) -----------------------------------

export function detectAlignments(o: Obs): Alignment {
  const s = o.structure4h;
  const aligned = o.engulf1h !== null && o.engulf1h === o.engulf4h;
  let triple = false;
  if (o.signal === "Strong Sell") triple = aligned && o.engulf4h === "bearish" && s.trueLow;
  else if (o.signal === "Strong Buy") triple = aligned && o.engulf4h === "bullish" && s.trueHigh;

  const tripleType: Alignment["triple_type"] = s.trueLow ? "4H low" : s.trueHigh ? "4H high" : null;

  // Weekend filter: suppress non-crypto alignments while forex is closed.
  if (isWeekendClosed(o.asOf) && o.category !== "crypto") {
    return { alignment_1h_4h: false, alignment_triple: false, triple_type: tripleType };
  }
  return { alignment_1h_4h: aligned, alignment_triple: triple, triple_type: tripleType };
}

// ---- pattern labels, changes and needles (SKILL.md step 6 and 7) -----------

const dirWord = (e: Engulf) => (e === "bullish" ? "Bull" : e === "bearish" ? "Bear" : "");

/** Human pattern labels for one observation. Stable order, so diffs are meaningful. */
export function patternLabels(o: Obs): string[] {
  const out: string[] = [];
  if (o.engulf1h) out.push(`1H ${dirWord(o.engulf1h)} engulf`);
  if (o.engulf4h) out.push(`4H ${dirWord(o.engulf4h)} engulf`);
  if (o.structure4h.sweepLow) out.push("4H low (sweep)");
  else if (o.structure4h.trueLow) out.push("4H low");
  if (o.structure4h.sweepHigh) out.push("4H high (sweep)");
  else if (o.structure4h.trueHigh) out.push("4H high");
  return out;
}

export interface Change {
  symbol: string;
  field: "signal" | "patterns";
  old: string;
  new: string;
}

/** Changes versus the previous observation of the same symbol. Cleared patterns use "". */
export function diffObservations(prev: Obs[], cur: Obs[]): Change[] {
  const before = new Map(prev.map((o) => [o.symbol, o]));
  const out: Change[] = [];
  for (const o of cur) {
    const p = before.get(o.symbol);
    if (!p) continue; // first sighting is not a change
    if ((p.signal ?? "") !== (o.signal ?? "")) {
      out.push({ symbol: o.symbol, field: "signal", old: p.signal ?? "", new: o.signal ?? "" });
    }
    const pl = patternLabels(p).join("; ");
    const cl = patternLabels(o).join("; ");
    if (pl !== cl) out.push({ symbol: o.symbol, field: "patterns", old: pl, new: cl });
  }
  return out;
}

export interface Needle {
  symbol: string;
  kind: "engulf_1h_4h" | "triple";
  level: string;
  key: string;
}

/**
 * Needles fire when an alignment becomes true versus the previous observation. The key
 * is symbol:session:kind. A key already in `fired` is never returned again.
 */
export function newNeedles(prev: Obs[], cur: Obs[], session: string, fired: ReadonlySet<string>): Needle[] {
  const before = new Map(prev.map((o) => [o.symbol, detectAlignments(o)]));
  const out: Needle[] = [];
  for (const o of cur) {
    const a = detectAlignments(o);
    const was = before.get(o.symbol);
    const kinds: { kind: Needle["kind"]; on: boolean; was: boolean | undefined; level: string }[] = [
      { kind: "engulf_1h_4h", on: a.alignment_1h_4h, was: was?.alignment_1h_4h, level: o.signal ?? "" },
      { kind: "triple", on: a.alignment_triple, was: was?.alignment_triple, level: o.signal ?? "" },
    ];
    for (const k of kinds) {
      if (!k.on || k.was) continue; // only a fresh flip to true
      const key = `${o.symbol}:${session}:${k.kind}`;
      if (fired.has(key)) continue;
      out.push({ symbol: o.symbol, kind: k.kind, level: k.level, key });
    }
  }
  return out;
}

// ---- capture payload (SKILL.md step 6 schema) ----------------------------

export interface CapturePayload {
  timestamp_utc: string;
  session: string;
  capture_type: "full" | "lightweight";
  market_count: number;
  changes: Change[];
  true_alignments: {
    engulf_1h_4h: { symbol: string; details: string; signal: string }[];
    triple: { symbol: string; type: string }[];
  };
  needles_fired: { symbol: string; kind: string; level: string }[];
  summary: { strong_buy: number; strong_sell: number; engulf_alignments: number; triple_alignments: number };
  next_check_utc: string;
}

export function buildCapture(args: {
  timestamp_utc: string;
  obs: Obs[];
  changes: Change[];
  needles: Needle[];
}): CapturePayload {
  const { timestamp_utc, obs, changes, needles } = args;
  const engulfRows: CapturePayload["true_alignments"]["engulf_1h_4h"] = [];
  const tripleRows: CapturePayload["true_alignments"]["triple"] = [];
  let strongBuy = 0;
  let strongSell = 0;
  for (const o of obs) {
    if (o.signal === "Strong Buy") strongBuy++;
    if (o.signal === "Strong Sell") strongSell++;
    const a = detectAlignments(o);
    if (a.alignment_1h_4h) {
      const word = dirWord(o.engulf4h);
      const structure = o.structure4h.trueLow ? "4H low" : o.structure4h.trueHigh ? "4H high" : "";
      engulfRows.push({
        symbol: o.symbol,
        details: [`${word} engulf`, structure].filter(Boolean).join(" + "),
        signal: o.signal ?? "",
      });
    }
    if (a.alignment_triple) {
      const word = dirWord(o.engulf4h).toLowerCase();
      tripleRows.push({
        symbol: o.symbol,
        type: `${o.signal} + ${word} engulf + ${a.triple_type}`,
      });
    }
  }
  const next = new Date(Date.parse(timestamp_utc) + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    timestamp_utc,
    session: sessionLabel(timestamp_utc),
    capture_type: captureType(timestamp_utc),
    market_count: obs.length,
    changes,
    true_alignments: { engulf_1h_4h: engulfRows, triple: tripleRows },
    needles_fired: needles.map((n) => ({ symbol: n.symbol, kind: n.kind, level: n.level })),
    summary: {
      strong_buy: strongBuy,
      strong_sell: strongSell,
      engulf_alignments: engulfRows.length,
      triple_alignments: tripleRows.length,
    },
    next_check_utc: next,
  };
}

/** Map the analysis rating (strong_sell, ...) to the label the skill and the table use. */
export function signalFromRating(r: string | null | undefined): Signal | null {
  switch (r) {
    case "strong_sell": return "Strong Sell";
    case "sell": return "Sell";
    case "neutral": return "Neutral";
    case "buy": return "Buy";
    case "strong_buy": return "Strong Buy";
    default: return null;
  }
}

// ---- freshness -----------------------------------------------------------

/**
 * True when the newest bar closed more than one bar ago. Bars are stamped by open time
 * and a bar closes at time + tfMs. Brokers may grid 4H bars off UTC midnight (cTrader
 * FX opens at 02:00, 06:00, ...), so this uses each bar's own close time, not a UTC floor.
 * Stale series must not produce alignments or needles.
 */
export function isStale(bars: Candle[], tfMs: number, now: number): boolean {
  if (!bars.length) return true;
  const newestClose = Math.max(...bars.map((b) => b.time)) + tfMs;
  return newestClose < now - 2 * tfMs;
}
