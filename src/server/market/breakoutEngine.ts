// Breakout engine. Pure: no I/O, no clock. Given closed 4H and 1H bars and an
// as-of time, it returns the breakouts that fire at that time.
//
// Rules (all on CLOSED bars only; a bar counts as closed at open + duration):
//
//  Level      Confirmed swing high/low on 4H: a bar whose high (low) is above
//             (below) the two bars on each side. Scanned over the last
//             SWING_LOOKBACK 4H bars. The newest 2 bars cannot yet be levels.
//  Price      The last closed 4H close is beyond the level by at least
//             thr = max(close * 0.2%, ATR20).
//  Fresh      No 4H close between the swing and the break bar was already
//             beyond the level. A level breaks once.
//  Sweep      Rejected if, within the 5 bars before the break bar, a bar pierced
//             the level and closed back on the original side.
//  Confirm    The last closed 1H bar closed beyond the level, OR its volume was
//             above 1.5x the mean of the 20 prior 1H bars. At least one required.
//  Pattern    Double top / double bottom on 4H: two confirmed swings of the same
//             side, 5 to 60 bars apart, within 0.5 ATR of each other. The
//             neckline is the extreme between them (min low for tops, max high
//             for bottoms). A pattern_break is a close through the neckline by
//             thr, not already broken. Same confirmation as above.
//
// Session and dedup: a breakout's session and timestamp come from the 4H bar's
// close time, not the run time, so a breakout first confirmed on a later hourly
// run keeps the same identity. The id is symbol|levelKey|type|session-start.
// The caller passes the set of ids already fired; those are never returned again.

import type { Candle } from "./types";

export const H1_MS = 3_600_000;
export const H4_MS = 4 * H1_MS;
export const ATR_PERIOD = 20;
export const VOL_PERIOD = 20;
export const VOL_MULT = 1.5;
export const MIN_PCT = 0.002;
export const SWEEP_WINDOW = 5;
export const SWING_LOOKBACK = 120;
export const PATTERN_GAP_MIN = 5;
export const PATTERN_GAP_MAX = 60;
export const PATTERN_TOL_ATR = 0.5;

export type BreakoutType = "resistance_break" | "support_break" | "pattern_break";
export type LevelType = "swing_high" | "swing_low" | "double_top" | "double_bottom";
export type Confirmation = "1h_close" | "1h_volume" | "1h_close_and_volume";

export interface EngineBreakout {
  id: string;
  symbol: string;
  type: BreakoutType;
  level_price: number;
  level_type: LevelType;
  break_price: number;
  break_atr_mult: number;
  confirmation: Confirmation;
  session: string;
  /** 4H bar close, ISO UTC. */
  timestamp_utc: string;
}

export interface SymbolEvaluation {
  symbol: string;
  status: "evaluated" | "skipped";
  reason?: string;
  lastClose4h?: string;
  atr?: number;
  /** Structures that passed the price and freshness tests. */
  candidates: number;
  sweepsRejected: number;
  /** Ids of candidates still waiting for 1H confirmation. */
  awaitingConfirmation: string[];
  breakouts: EngineBreakout[];
}

// ---- session -------------------------------------------------------------

const DAY_MS = 86_400_000;

/** UTC session window for a timestamp. Key is stable across the whole session. */
export function sessionOf(ms: number): { name: string; key: string } {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (h >= 22 || h < 7) {
    // Tokyo spans midnight: 22:00 to 07:00 UTC.
    const start = h >= 22 ? dayStart + 22 * H1_MS : dayStart - 2 * H1_MS;
    return { name: "tokyo", key: `tokyo@${start}` };
  }
  const name = h < 12 ? "london" : h < 17 ? "ny" : "ny_afternoon";
  const startHour = h < 12 ? 7 : h < 17 ? 12 : 17;
  return { name, key: `${name}@${dayStart + startHour * H1_MS}` };
}

// ---- bar helpers ---------------------------------------------------------

export function closedBars(bars: Candle[], tfMs: number, asOf: number): Candle[] {
  return bars.filter((b) => b.time + tfMs <= asOf).sort((a, b) => a.time - b.time);
}

/** Simple mean true range over the last `n` bars. Null when too short. */
export function meanTrueRange(bars: Candle[], n: number): number | null {
  if (bars.length < n + 1) return null;
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    sum += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return sum / n;
}

/** Indices of confirmed swing highs (or lows) in [from, to]. Needs 2 bars each side. */
function swingIndices(bars: Candle[], side: "high" | "low", from: number, to: number): number[] {
  const out: number[] = [];
  const v = (i: number) => (side === "high" ? bars[i].high : bars[i].low);
  const lo = Math.max(2, from);
  const hi = Math.min(bars.length - 3, to);
  for (let i = lo; i <= hi; i++) {
    const isSwing =
      side === "high"
        ? v(i) > v(i - 1) && v(i) > v(i - 2) && v(i) > v(i + 1) && v(i) > v(i + 2)
        : v(i) < v(i - 1) && v(i) < v(i - 2) && v(i) < v(i + 1) && v(i) < v(i + 2);
    if (isSwing) out.push(i);
  }
  return out;
}

// ---- evaluation ----------------------------------------------------------

/**
 * Evaluate one symbol at `asOf` (ms). `fired` holds ids already reported and is
 * not mutated. The returned `breakouts` contains only new ids.
 */
export function evaluateSymbol(
  symbol: string,
  bars4hIn: Candle[],
  bars1hIn: Candle[],
  asOf: number,
  fired: ReadonlySet<string>
): SymbolEvaluation {
  const empty = (reason: string): SymbolEvaluation => ({
    symbol, status: "skipped", reason, candidates: 0, sweepsRejected: 0, awaitingConfirmation: [], breakouts: [],
  });

  const b4 = closedBars(bars4hIn, H4_MS, asOf);
  const b1 = closedBars(bars1hIn, H1_MS, asOf);
  if (b4.length < ATR_PERIOD + SWEEP_WINDOW + 3) return empty("insufficient 4H history");
  if (b1.length < VOL_PERIOD + 1) return empty("insufficient 1H history");

  const n = b4.length;
  const last = b4[n - 1];
  const close = last.close;
  const atr = meanTrueRange(b4, ATR_PERIOD);
  if (atr == null || atr <= 0) return empty("ATR unavailable");
  const thr = Math.max(close * MIN_PCT, atr);

  const closeTime = last.time + H4_MS;
  const sess = sessionOf(closeTime);
  const stamp = new Date(closeTime).toISOString();

  const last1 = b1[b1.length - 1];
  const priorVol = b1.slice(b1.length - 1 - VOL_PERIOD, b1.length - 1);
  const avgVol = priorVol.reduce((s, b) => s + b.volume, 0) / priorVol.length;
  const volOk = avgVol > 0 && last1.volume > VOL_MULT * avgVol;

  const result: SymbolEvaluation = {
    symbol, status: "evaluated", lastClose4h: stamp, atr,
    candidates: 0, sweepsRejected: 0, awaitingConfirmation: [], breakouts: [],
  };
  const seen = new Set<string>();
  // Alert budget: at most one breakout per symbol and type per session. Once a
  // move has fired, later levels crossed in the same session are not reported
  // (a single flush through a cluster otherwise fires once per hourly run).
  const firedSymbolTypeSession = new Set<string>();
  for (const id of fired) {
    const parts = id.split("|");
    if (parts.length === 4 && parts[0] === symbol) firedSymbolTypeSession.add(`${parts[0]}|${parts[2]}|${parts[3]}`);
  }
  const sessionTaken = (type: BreakoutType) => firedSymbolTypeSession.has(`${symbol}|${type}|${sess.key}`);
  // Single-level candidates are collected, then only the nearest one per type is
  // reported (see "One per type" below).
  const levelCands: { id: string; type: BreakoutType; levelType: LevelType; level: number; dirUp: boolean }[] = [];

  const confirm = (dirUp: boolean, level: number): Confirmation | null => {
    const closeOk = dirUp ? last1.close > level : last1.close < level;
    if (closeOk && volOk) return "1h_close_and_volume";
    if (closeOk) return "1h_close";
    if (volOk) return "1h_volume";
    return null;
  };

  const emit = (
    id: string,
    type: BreakoutType,
    levelType: LevelType,
    level: number,
    dirUp: boolean
  ) => {
    if (fired.has(id) || seen.has(id)) return;
    const conf = confirm(dirUp, level);
    if (!conf) {
      result.awaitingConfirmation.push(id);
      return;
    }
    seen.add(id);
    result.breakouts.push({
      id, symbol, type, level_price: level, level_type: levelType,
      break_price: close,
      break_atr_mult: Math.abs(close - level) / atr,
      confirmation: conf, session: sess.name, timestamp_utc: stamp,
    });
  };

  // ---- single levels: swing highs (resistance) and lows (support) ----
  const lb = n - SWING_LOOKBACK;
  for (const side of ["high", "low"] as const) {
    const resistance = side === "high";
    for (const i of swingIndices(b4, side, lb, n - 3)) {
      const L = resistance ? b4[i].high : b4[i].low;
      const beyondPrice = resistance ? close > L + thr : close < L - thr;
      if (!beyondPrice) continue;

      let stale = false;
      for (let j = i + 1; j <= n - 2; j++) {
        if (resistance ? b4[j].close > L : b4[j].close < L) { stale = true; break; }
      }
      if (stale) continue;
      result.candidates++;

      let swept = false;
      for (let j = Math.max(0, n - 1 - SWEEP_WINDOW); j <= n - 2; j++) {
        const pierced = resistance ? b4[j].high > L : b4[j].low < L;
        const back = resistance ? b4[j].close < L : b4[j].close > L;
        if (pierced && back) { swept = true; break; }
      }
      if (swept) { result.sweepsRejected++; continue; }

      const levelKey = `${resistance ? "swing_high" : "swing_low"}@${L}`;
      const type: BreakoutType = resistance ? "resistance_break" : "support_break";
      const id = `${symbol}|${levelKey}|${type}|${sess.key}`;
      levelCands.push({ id, type, levelType: resistance ? "swing_high" : "swing_low", level: L, dirUp: resistance });
    }
  }

  // One per type. Several old swings are often crossed in the same bar (a flush
  // through a whole cluster). Reporting each would be noise, so the level nearest
  // the close represents the break. Already-fired levels are skipped first.
  for (const type of ["resistance_break", "support_break"] as const) {
    if (sessionTaken(type)) continue;
    const pool = levelCands.filter((c) => c.type === type && !fired.has(c.id));
    if (!pool.length) continue;
    pool.sort((a, b) => Math.abs(close - a.level) - Math.abs(close - b.level) || a.id.localeCompare(b.id));
    const best = pool[0];
    emit(best.id, best.type, best.levelType, best.level, best.dirUp);
  }

  // ---- double top / double bottom neckline breaks ----
  for (const top of [true, false]) {
    const side = top ? "high" : "low";
    const swings = swingIndices(b4, side, lb, n - 3);
    let found = false;
    for (let bi = swings.length - 1; bi >= 0 && !found; bi--) {
      for (let ai = bi - 1; ai >= 0 && !found; ai--) {
        const a = swings[ai];
        const b = swings[bi];
        const gap = b - a;
        if (gap < PATTERN_GAP_MIN) continue;
        if (gap > PATTERN_GAP_MAX) break;
        const pa = top ? b4[a].high : b4[a].low;
        const pb = top ? b4[b].high : b4[b].low;
        if (Math.abs(pa - pb) > PATTERN_TOL_ATR * atr) continue;

        let neck = top ? Infinity : -Infinity;
        for (let k = a; k <= b; k++) {
          neck = top ? Math.min(neck, b4[k].low) : Math.max(neck, b4[k].high);
        }
        // Not broken between the second top and the last closed bar.
        let broken = false;
        for (let j = b + 1; j <= n - 2; j++) {
          if (top ? b4[j].close < neck : b4[j].close > neck) { broken = true; break; }
        }
        if (broken) continue;
        found = true;

        const beyond = top ? close < neck - thr : close > neck + thr;
        if (!beyond) continue;
        result.candidates++;
        const levelKey = `${top ? "double_top" : "double_bottom"}@${b4[a].time}-${b4[b].time}`;
        const id = `${symbol}|${levelKey}|pattern_break|${sess.key}`;
        if (sessionTaken("pattern_break")) continue;
        emit(id, "pattern_break", top ? "double_top" : "double_bottom", neck, !top);
      }
    }
  }

  return result;
}
