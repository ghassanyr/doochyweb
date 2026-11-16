// Pure pieces of the daily briefing: the day key, snapshot rows, the prompt,
// the structured parser and the deterministic fallback. Everything here is
// deterministic and unit-tested; the network and database work lives in
// service.ts.

import type { JournalEntryView } from "../journal/types";
import type { Candle } from "../market/types";
import type { SignalView } from "../signals/types";
import type { AiMessage } from "../ai/client";
import { buildSessionRows, focusSessionLabel } from "./sessions";
import {
  BRIEFING_SNAPSHOT_VERSION,
  type BriefingFocusSession,
  type BriefingJournalIdea,
  type BriefingJournalSection,
  type BriefingQuote,
  type BriefingSections,
  type BriefingSignal,
  type BriefingSnapshot,
  type BriefingWatchlistRow,
  type BriefingWatchlistSection,
} from "./types";

export const MAX_MOVERS = 6;
export const MAX_SIGNALS = 6;
export const MAX_JOURNAL_IDEAS = 6;

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

/** Percent distance from a reference price to a level. */
export function levelDistancePct(reference: number | null, level: number | null): number | null {
  if (reference == null || level == null) return null;
  if (!Number.isFinite(reference) || !Number.isFinite(level) || reference <= 0) return null;
  return Math.round(((level - reference) / reference) * 10_000) / 100;
}

function round(value: number): number {
  const digits = Math.abs(value) >= 1000 ? 2 : Math.abs(value) >= 10 ? 3 : 5;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unset";
  return String(round(value));
}

function signedPct(value: number | null): string {
  if (value == null) return "n/a";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function quoteMap(quotes: Record<string, BriefingQuote | null | undefined> | undefined, symbol: string) {
  return quotes?.[symbol.toUpperCase()] ?? null;
}

export interface WatchlistInput {
  symbol: string;
  name?: string | null;
  type?: string | null;
  bars: Candle[];
  quote?: BriefingQuote | null;
}

export function buildWatchlistRows(
  input: WatchlistInput[],
  limit: number = 12
): BriefingWatchlistRow[] {
  return input.slice(0, limit).map((entry) => {
    const bars = entry.bars ?? [];
    const lastBar = bars[bars.length - 1];
    const previousBar = bars[bars.length - 2];
    const last = lastBar && Number.isFinite(lastBar.close) ? round(lastBar.close) : null;
    const previousClose =
      previousBar && Number.isFinite(previousBar.close) ? round(previousBar.close) : null;
    const barTime = lastBar ? new Date(lastBar.time) : null;
    return {
      symbol: entry.symbol.toUpperCase(),
      name: entry.name ?? null,
      type: entry.type ?? null,
      last,
      previousClose,
      changePct: percentChange(previousClose, last),
      dayHigh: lastBar && Number.isFinite(lastBar.high) ? round(lastBar.high) : null,
      dayLow: lastBar && Number.isFinite(lastBar.low) ? round(lastBar.low) : null,
      barTime: barTime && Number.isFinite(barTime.getTime()) ? barTime.toISOString() : null,
      quote: entry.quote ?? null,
    };
  });
}

function prioritize<T extends { symbol: string }>(
  rows: T[],
  watchlist: Set<string>,
  time: (row: T) => number
): T[] {
  return [...rows].sort((a, b) => {
    const aw = watchlist.has(a.symbol.toUpperCase()) ? 0 : 1;
    const bw = watchlist.has(b.symbol.toUpperCase()) ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return time(b) - time(a);
  });
}

export function buildSignalRows(
  signals: SignalView[],
  now: Date,
  quotes: Record<string, BriefingQuote | null | undefined> = {},
  options: { limit?: number; watchlist?: string[] } = {}
): BriefingSignal[] {
  const watchlist = new Set((options.watchlist ?? []).map((symbol) => symbol.toUpperCase()));
  const limit = options.limit ?? MAX_SIGNALS;
  const selected = prioritize(signals, watchlist, (signal) => {
    const time = new Date(signal.createdAt).getTime();
    return Number.isFinite(time) ? time : 0;
  }).slice(0, limit);

  return selected.map((signal) => {
    const quote = quoteMap(quotes, signal.symbol);
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
      target2: signal.target2,
      target3: signal.target3,
      stop: signal.stop,
      timeframe: signal.timeframe,
      note: signal.note,
      createdAt: signal.createdAt,
      ageHours,
      quote,
      toEntryPct: levelDistancePct(quote?.price ?? null, signal.entry ?? signal.entryMax),
      toStopPct: levelDistancePct(quote?.price ?? null, signal.stop),
      toTargetPct: levelDistancePct(quote?.price ?? null, signal.target),
    };
  });
}

export function buildJournalIdeas(
  entries: JournalEntryView[],
  quotes: Record<string, BriefingQuote | null | undefined> = {},
  options: { limit?: number; watchlist?: string[] } = {}
): BriefingJournalIdea[] {
  const watchlist = new Set((options.watchlist ?? []).map((symbol) => symbol.toUpperCase()));
  const limit = options.limit ?? MAX_JOURNAL_IDEAS;
  const open = entries.filter((entry) => entry.status === "open");
  const selected = prioritize(open, watchlist, (entry) => {
    const value = new Date(entry.openedAt ?? entry.createdAt).getTime();
    return Number.isFinite(value) ? value : 0;
  }).slice(0, limit);

  return selected.map((entry) => {
    const quote = quoteMap(quotes, entry.symbol);
    return {
      id: entry.id,
      symbol: entry.symbol,
      side: entry.side,
      entryPrice: entry.entryPrice,
      stop: entry.stop,
      target: entry.target,
      verified: entry.verified,
      openedAt: entry.openedAt,
      note: entry.note,
      quote,
      toEntryPct: levelDistancePct(quote?.price ?? null, entry.entryPrice),
      toStopPct: levelDistancePct(quote?.price ?? null, entry.stop),
      toTargetPct: levelDistancePct(quote?.price ?? null, entry.target),
    };
  });
}

function missingPlanLevels(idea: BriefingJournalIdea): string[] {
  const missing: string[] = [];
  if (idea.entryPrice == null) missing.push("entry");
  if (idea.stop == null) missing.push("stop");
  if (idea.target == null) missing.push("target");
  return missing;
}

function buildDataNotes(
  watchlist: BriefingWatchlistRow[],
  signals: BriefingSignal[],
  ideas: BriefingJournalIdea[],
  extra: string[]
): string[] {
  const notes: string[] = [
    "No news feed is connected, so this brief covers price, signal and journal data only.",
    ...extra,
  ];

  if (!watchlist.length) notes.push("The effective watchlist is empty.");
  for (const row of watchlist) {
    if (row.last == null) notes.push(`${row.symbol}: no daily bars were available.`);
    else if (row.changePct == null) {
      notes.push(`${row.symbol}: there were not enough daily bars for a change.`);
    }
  }
  for (const signal of signals) {
    if (!signal.quote) notes.push(`${signal.symbol}: no current quote for the active signal.`);
  }
  for (const idea of ideas) {
    const missing = missingPlanLevels(idea);
    if (missing.length) {
      notes.push(`${idea.symbol}: the open idea has no ${missing.join(", ")} recorded.`);
    }
    if (!idea.quote) notes.push(`${idea.symbol}: no current quote for the open idea.`);
  }

  return [...new Set(notes)].slice(0, 12);
}

export function buildSnapshot(params: {
  now: Date;
  focusSessions: BriefingFocusSession[];
  watchlist: WatchlistInput[];
  signals: SignalView[];
  journalEntries: JournalEntryView[];
  quotes?: Record<string, BriefingQuote | null | undefined>;
  dataNotes?: string[];
}): BriefingSnapshot {
  const watchlist = buildWatchlistRows(params.watchlist);
  const symbols = watchlist.map((row) => row.symbol);
  const signals = buildSignalRows(params.signals, params.now, params.quotes, {
    limit: MAX_SIGNALS,
    watchlist: symbols,
  });
  const journalIdeas = buildJournalIdeas(params.journalEntries, params.quotes, {
    limit: MAX_JOURNAL_IDEAS,
    watchlist: symbols,
  });
  const dataNotes = buildDataNotes(watchlist, signals, journalIdeas, params.dataNotes ?? []);

  return {
    version: BRIEFING_SNAPSHOT_VERSION,
    dateKey: briefingDateKey(params.now),
    generatedAt: params.now.toISOString(),
    focusSessions: [...params.focusSessions],
    sessions: buildSessionRows(params.focusSessions, params.now),
    watchlist,
    signals,
    journalIdeas,
    dataNotes,
  };
}

function directionWord(value: number | null): string {
  if (value == null || value === 0) return "unchanged";
  return value > 0 ? "higher" : "lower";
}

function levelText(label: string, value: number | null): string {
  return `${label} ${fmt(value)}`;
}

function distanceText(value: number | null): string {
  if (value == null) return "not available";
  return `${Math.abs(value).toFixed(2)}% ${value >= 0 ? "above" : "below"}`;
}

function fallbackWatchlistNote(
  row: BriefingWatchlistRow,
  snapshot: BriefingSnapshot
): BriefingWatchlistSection {
  let whatHappened: string;
  if (row.changePct == null) {
    whatHappened =
      row.last == null
        ? `No daily bars were available for ${row.symbol}.`
        : `${row.symbol} had a daily close of ${fmt(row.last)}, but there were not enough bars for a change.`;
  } else {
    whatHappened = `${row.symbol} closed at ${fmt(row.last)}, ${Math.abs(
      row.changePct
    )}% ${directionWord(row.changePct)} than the previous close.`;
    if (row.dayLow != null && row.dayHigh != null) {
      whatHappened += ` The daily range was ${fmt(row.dayLow)} to ${fmt(row.dayHigh)}.`;
    }
  }

  const signals = snapshot.signals.filter((signal) => signal.symbol === row.symbol);
  const ideas = snapshot.journalIdeas.filter((idea) => idea.symbol === row.symbol);
  const why: string[] = [];
  for (const signal of signals) {
    why.push(
      `There is an active ${signal.direction} signal with ${levelText("entry", signal.entry)}, ${levelText(
        "target",
        signal.target
      )} and ${levelText("stop", signal.stop)}.`
    );
  }
  for (const idea of ideas) {
    why.push(
      `There is an open ${idea.side} journal idea${
        idea.verified ? "" : " marked unverified"
      } with ${levelText("entry", idea.entryPrice)}, ${levelText("target", idea.target)} and ${levelText(
        "stop",
        idea.stop
      )}.`
    );
  }
  if (!why.length) why.push("No active signal or open journal idea is attached to this symbol.");

  const watch: string[] = [];
  if (row.dayHigh != null && row.dayLow != null) {
    watch.push(`Watch the daily high at ${fmt(row.dayHigh)} and the daily low at ${fmt(row.dayLow)}.`);
  }
  for (const signal of signals) {
    watch.push(
      `For the active signal, watch ${levelText("entry", signal.entry)}, ${levelText(
        "stop",
        signal.stop
      )} and ${levelText("target", signal.target)}.`
    );
  }
  for (const idea of ideas) {
    watch.push(
      `For the open idea, watch ${levelText("entry", idea.entryPrice)}, ${levelText(
        "stop",
        idea.stop
      )} and ${levelText("target", idea.target)}.`
    );
  }
  if (!watch.length) watch.push("No plan or daily levels are available.");

  return {
    symbol: row.symbol,
    whatHappened,
    whyItMatters: why.join(" "),
    watchFor: watch.join(" "),
  };
}

function fallbackIdeaNote(idea: BriefingJournalIdea): BriefingJournalSection {
  const parts: string[] = [
    `${idea.side === "buy" ? "Long" : "Short"} idea${idea.verified ? "" : " marked unverified"}.`,
    `${levelText("Entry", idea.entryPrice)}, ${levelText("Stop", idea.stop)}, ${levelText(
      "Target",
      idea.target
    )}.`,
  ];
  if (idea.quote) {
    parts.push(
      `The latest quote is ${fmt(idea.quote.price)} from the ${idea.quote.source} source, ${distanceText(
        idea.toEntryPct
      )} entry, ${distanceText(idea.toStopPct)} stop and ${distanceText(
        idea.toTargetPct
      )} target.`
    );
  } else {
    parts.push("No current quote is available, so level proximity is unknown.");
  }
  const missing = missingPlanLevels(idea);
  if (missing.length) parts.push(`No ${missing.join(", ")} is recorded.`);
  return { id: idea.id, update: parts.join(" ") };
}

export function buildFallbackSections(snapshot: BriefingSnapshot): BriefingSections {
  const top = [...snapshot.watchlist]
    .filter((row) => row.changePct != null)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));

  const headline = top.length
    ? `${top[0].symbol} leads watchlist ${(top[0].changePct ?? 0) >= 0 ? "gains" : "declines"}`
    : "Watchlist briefing";

  const overview: string[] = [`${focusSessionLabel(snapshot.focusSessions)} focus.`];
  if (top.length) {
    overview.push(
      `The largest watchlist moves were ${top
        .slice(0, 3)
        .map((row) => `${row.symbol} ${signedPct(row.changePct)}`)
        .join(", ")}.`
    );
  } else {
    overview.push("No daily watchlist moves were available.");
  }
  overview.push(`${plural(snapshot.signals.length, "active published signal", "active published signals")}.`);
  overview.push(`${plural(snapshot.journalIdeas.length, "open journal idea", "open journal ideas")}.`);
  overview.push("No news feed is connected, so headline context is unavailable.");

  const risks: string[] = [];
  for (const idea of snapshot.journalIdeas) {
    if (idea.stop == null) risks.push(`${idea.symbol}: the open idea has no stop recorded.`);
    if (!idea.quote) risks.push(`${idea.symbol}: the open idea has no current quote.`);
  }
  for (const signal of snapshot.signals) {
    if (!signal.quote) risks.push(`${signal.symbol}: the active signal has no current quote.`);
  }
  risks.push("Headline and event risk is not covered because no news feed is connected.");
  if (risks.length === 1) {
    risks.push("Coverage is limited to watchlist prices, active signals and open journal ideas.");
  }

  const monitor: string[] = [];
  for (const idea of snapshot.journalIdeas.slice(0, 3)) {
    monitor.push(
      `${idea.symbol}: open ${idea.side} idea, ${levelText("entry", idea.entryPrice)}, ${levelText(
        "stop",
        idea.stop
      )}, ${levelText("target", idea.target)}.`
    );
  }
  for (const signal of snapshot.signals.slice(0, 3)) {
    monitor.push(
      `${signal.symbol}: active ${signal.direction} signal, ${levelText("entry", signal.entry)}, ${levelText(
        "stop",
        signal.stop
      )}, ${levelText("target", signal.target)}.`
    );
  }
  for (const row of top.slice(0, 2)) {
    if (row.dayHigh != null && row.dayLow != null) {
      monitor.push(
        `${row.symbol}: daily high ${fmt(row.dayHigh)} and low ${fmt(row.dayLow)}.`
      );
    }
  }
  if (!monitor.length) monitor.push("Watch for the next daily close on the watchlist.");

  return {
    headline,
    overview: overview.join(" "),
    watchlist: snapshot.watchlist.map((row) => fallbackWatchlistNote(row, snapshot)),
    journalIdeas: snapshot.journalIdeas.map(fallbackIdeaNote),
    risks: risks.slice(0, 5),
    monitor: [...new Set(monitor)].slice(0, 6),
    caveats: snapshot.dataNotes.slice(0, 5),
  };
}

function quoteLine(quote: BriefingQuote | null): string {
  if (!quote) return "quote unavailable";
  return `quote ${fmt(quote.price)} (${quote.source}, ${quote.at})`;
}

/** System and user messages for the structured briefing. Data only, no advice. */
export function buildBriefingPrompt(
  snapshot: BriefingSnapshot,
  brandName: string
): AiMessage[] {
  const system = [
    `You write the daily market briefing for ${brandName}, a trading workspace.`,
    "Return only a JSON object with this exact shape:",
    '{"headline":"...","overview":"...","watchlist":[{"symbol":"...","whatHappened":"...","whyItMatters":"...","watchFor":"..."}],"journalIdeas":[{"id":"...","update":"..."}],"risks":["..."],"monitor":["..."],"caveats":["..."]}',
    "Use only the data in the user message. Do not invent symbols, prices, levels, headlines, news, events, forecasts or recommendations.",
    "No news feed is supplied. Never write a headline or claim that an event happened. If dataNotes says news is unavailable, say that headline context is unavailable.",
    "The headline must be 6 to 14 words and must not include a date.",
    "Write 3 to 6 short sentences for overview. Cover the focus sessions, the main watchlist moves, active signals, open journal ideas and missing data.",
    "Return exactly one watchlist entry for every supplied watchlist symbol, in the same order. Write one short sentence for each of whatHappened, whyItMatters and watchFor.",
    "Return exactly one journalIdeas entry for every supplied open journal idea id. Use only that id and describe the recorded plan and its current-price relationship.",
    "Return 2 to 5 short risks, 2 to 6 short monitor bullets and at most 5 caveats. Risks and monitor items must use only supplied facts.",
    "Never give financial advice, predictions, probabilities or trade recommendations. Do not mention being an AI or a model.",
    "Plain text inside JSON strings only. No markdown, no code fence, no text outside the JSON object. Never use an em dash.",
  ].join(" ");

  const lines: string[] = [
    `Date: ${snapshot.dateKey}`,
    `Focus sessions: ${focusSessionLabel(snapshot.focusSessions)}`,
    "",
    "Session status:",
  ];
  for (const session of snapshot.sessions) {
    lines.push(
      `- ${session.label}: ${session.status}${session.nextChange ? `, ${session.nextChange}` : ""}`
    );
  }

  lines.push("", "Watchlist:");
  if (snapshot.watchlist.length) {
    for (const row of snapshot.watchlist) {
      lines.push(
        `- ${row.symbol}${row.type ? ` (${row.type})` : ""}: last ${fmt(row.last)}, previous ${fmt(
          row.previousClose
        )}, change ${signedPct(row.changePct)}, day range ${fmt(row.dayLow)} to ${fmt(
          row.dayHigh
        )}, ${quoteLine(row.quote)}`
      );
    }
  } else {
    lines.push("- no watchlist symbols");
  }

  lines.push("", "Active signals:");
  if (snapshot.signals.length) {
    for (const signal of snapshot.signals) {
      const entry =
        signal.entryMax != null
          ? `${fmt(signal.entry)} to ${fmt(signal.entryMax)}`
          : fmt(signal.entry);
      lines.push(
        `- id ${signal.id}, ${signal.symbol} ${signal.direction}, entry ${entry}, target ${fmt(
          signal.target
        )}, target2 ${fmt(signal.target2)}, target3 ${fmt(signal.target3)}, stop ${fmt(
          signal.stop
        )}, timeframe ${signal.timeframe ?? "unset"}, published ${signal.ageHours} hours ago, ${quoteLine(
          signal.quote
        )}, distance to entry ${distanceText(signal.toEntryPct)}, stop ${distanceText(
          signal.toStopPct
        )}, target ${distanceText(signal.toTargetPct)}`
      );
      if (signal.note) lines.push(`  note: ${signal.note}`);
    }
  } else {
    lines.push("- no active signals");
  }

  lines.push("", "Open journal ideas:");
  if (snapshot.journalIdeas.length) {
    for (const idea of snapshot.journalIdeas) {
      lines.push(
        `- id ${idea.id}, ${idea.symbol} ${idea.side}, entry ${fmt(idea.entryPrice)}, stop ${fmt(
          idea.stop
        )}, target ${fmt(idea.target)}, ${idea.verified ? "verified" : "unverified"}, opened ${
          idea.openedAt ?? "unset"
        }, ${quoteLine(idea.quote)}, distance to entry ${distanceText(
          idea.toEntryPct
        )}, stop ${distanceText(idea.toStopPct)}, target ${distanceText(idea.toTargetPct)}`
      );
      if (idea.note) lines.push(`  note: ${idea.note}`);
    }
  } else {
    lines.push("- no open journal ideas");
  }

  lines.push("", "Data notes:");
  for (const note of snapshot.dataNotes) lines.push(`- ${note}`);

  return [
    { role: "system", content: system },
    { role: "user", content: lines.join("\n") },
  ];
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanText(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function objectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface ParsedBriefing {
  sections: BriefingSections;
  error: string | null;
}

export function parseBriefingSections(raw: string, snapshot: BriefingSnapshot): ParsedBriefing {
  const fallback = buildFallbackSections(snapshot);
  const parsed = extractJson(raw);
  if (!parsed) {
    return {
      sections: fallback,
      error: "The AI response was not valid briefing JSON, so the data summary is shown.",
    };
  }

  const fallbackWatch = new Map(fallback.watchlist.map((note) => [note.symbol, note]));
  const watchlistRaw = objectList(parsed.watchlist);
  const watchlistBySymbol = new Map<string, Record<string, unknown>>();
  for (const item of watchlistRaw) {
    const symbol = cleanText(item.symbol, 32).toUpperCase();
    if (symbol) watchlistBySymbol.set(symbol, item);
  }
  const watchlist = snapshot.watchlist.map((row) => {
    const base = fallbackWatch.get(row.symbol);
    const item = watchlistBySymbol.get(row.symbol);
    return {
      symbol: row.symbol,
      whatHappened: cleanText(item?.whatHappened, 420) || base?.whatHappened || "",
      whyItMatters: cleanText(item?.whyItMatters, 420) || base?.whyItMatters || "",
      watchFor: cleanText(item?.watchFor, 420) || base?.watchFor || "",
    };
  });

  const fallbackIdeas = new Map(fallback.journalIdeas.map((note) => [note.id, note]));
  const ideasById = new Map<string, Record<string, unknown>>();
  for (const item of objectList(parsed.journalIdeas)) {
    const id = cleanText(item.id, 80);
    if (id) ideasById.set(id, item);
  }
  const journalIdeas = snapshot.journalIdeas.map((idea) => ({
    id: idea.id,
    update:
      cleanText(ideasById.get(idea.id)?.update, 600) || fallbackIdeas.get(idea.id)?.update || "",
  }));

  const risks = textList(parsed.risks, 5, 320);
  const monitor = textList(parsed.monitor, 6, 320);
  const caveats = textList(parsed.caveats, 5, 320);

  return {
    sections: {
      headline: cleanText(parsed.headline, 140) || fallback.headline,
      overview: cleanText(parsed.overview, 1400) || fallback.overview,
      watchlist,
      journalIdeas,
      risks: risks.length ? risks : fallback.risks,
      monitor: monitor.length ? monitor : fallback.monitor,
      caveats: caveats.length ? caveats : fallback.caveats,
    },
    error: null,
  };
}
