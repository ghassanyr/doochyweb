// Pure pieces of the daily briefing: the day key, the mover maths, the signal
// rows and the prompt. Everything here is deterministic and unit-tested; the
// network and database work lives in service.ts.

import type { Candle } from "../market/types";
import type { SignalView } from "../signals/types";
import type { AiMessage } from "../ai/client";
import type { BriefingMover, BriefingSignal, BriefingSnapshot } from "./types";

export const MAX_MOVERS = 6;
export const MAX_SIGNALS = 6;

/** UTC day key, so one brief exists per user per calendar day. */
export function briefingDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Percent change from `previous` to `last`, or null when a value is unusable. */
export function percentChange(previous: number | null, last: number | null): number | null {
  if (previous == null || last == null) return null;
  if (!Number.isFinite(previous) || !Number.isFinite(last) || previous <= 0) return null;
  return Math.round(((last - previous) / previous) * 10_000) / 100;
}

/**
 * Biggest daily moves across the watchlist, by absolute percent change. Symbols
 * without two daily closes are dropped rather than shown at zero.
 */
export function buildMovers(
  input: { symbol: string; bars: Candle[] }[],
  limit: number = MAX_MOVERS
): BriefingMover[] {
  const rows: BriefingMover[] = [];
  for (const entry of input) {
    const bars = entry.bars ?? [];
    if (bars.length < 2) continue;
    const last = bars[bars.length - 1].close;
    const previous = bars[bars.length - 2].close;
    const changePct = percentChange(previous, last);
    if (changePct == null) continue;
    rows.push({ symbol: entry.symbol, last: round(last), changePct });
  }
  return rows
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

/** Active published signals, newest first, with their age in hours. */
export function buildSignalRows(
  signals: SignalView[],
  now: Date,
  limit: number = MAX_SIGNALS
): BriefingSignal[] {
  return signals.slice(0, limit).map((signal) => {
    const created = new Date(signal.createdAt).getTime();
    const ageHours = Number.isFinite(created)
      ? Math.max(0, Math.round(((now.getTime() - created) / 3_600_000) * 10) / 10)
      : 0;
    return {
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entry,
      entryMax: signal.entryMax,
      target: signal.target,
      stop: signal.stop,
      createdAt: signal.createdAt,
      ageHours,
    };
  });
}

export function buildSnapshot(params: {
  now: Date;
  movers: { symbol: string; bars: Candle[] }[];
  signals: SignalView[];
}): BriefingSnapshot {
  return {
    dateKey: briefingDateKey(params.now),
    generatedAt: params.now.toISOString(),
    movers: buildMovers(params.movers),
    signals: buildSignalRows(params.signals, params.now),
  };
}

function round(value: number): number {
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 10 ? 3 : 5;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unset";
  return String(round(value));
}

/** System and user messages for the narrative. Data only, no advice. */
export function buildBriefingPrompt(
  snapshot: BriefingSnapshot,
  brandName: string
): AiMessage[] {
  const system = [
    `You write the daily market briefing for ${brandName}, a trading workspace.`,
    "Use only the data in the user message. Do not invent symbols, prices or signals.",
    "Write 3 to 5 short sentences of plain prose, no lists, no headings, no markdown.",
    "Describe what moved and which signals are live. Never give financial advice, never predict, never recommend a trade.",
    "Do not mention being an AI or a model. Never use an em dash.",
  ].join(" ");

  const lines: string[] = [`Date: ${snapshot.dateKey}`, "", "Watchlist moves (percent, daily close):"];
  if (snapshot.movers.length) {
    for (const mover of snapshot.movers) {
      const sign = mover.changePct > 0 ? "+" : "";
      lines.push(`- ${mover.symbol}: ${fmt(mover.last)} (${sign}${mover.changePct}%)`);
    }
  } else {
    lines.push("- no daily data available");
  }

  lines.push("", "Active signals (unresolved published ideas):");
  if (snapshot.signals.length) {
    for (const signal of snapshot.signals) {
      const entry =
        signal.entryMax != null
          ? `${fmt(signal.entry)} to ${fmt(signal.entryMax)}`
          : fmt(signal.entry);
      lines.push(
        `- ${signal.symbol} ${signal.direction}, entry ${entry}, target ${fmt(signal.target)}, stop ${fmt(
          signal.stop
        )}, published ${signal.ageHours} hours ago`
      );
    }
  } else {
    lines.push("- no active signals");
  }

  return [
    { role: "system", content: system },
    { role: "user", content: lines.join("\n") },
  ];
}
