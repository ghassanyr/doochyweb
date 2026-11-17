// Daily briefing generation.
//
// The brief is built once per user per UTC day and stored, so reopening the page
// shows the same numbers the prose was written about. `refresh` rebuilds it on
// demand, which is what the page's Refresh button calls.
//
// Data sources are the member's effective watchlist and daily bars, active
// published signals, and the member's open journal ideas. Latest quotes are read
// through the same cached price helper the Signals page uses. No broker or
// account data is read, and no news source exists, so the snapshot says that
// headline context is unavailable.

import { aiChat, loadAiConfig, type AiConfig } from "../ai/client";
import { listJournal } from "../journal/store";
import type { JournalEntryView } from "../journal/types";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { cachedBars, getCandles } from "../market/providers/index";
import { publicSettings } from "../market/store";
import type { Candle } from "../market/types";
import { getBriefingWatchlist } from "../market/userWatchlist";
import { DEFAULT_BRANDING } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { signalPrices } from "../signals/prices";
import { listSignals } from "../signals/store";
import type { SignalView } from "../signals/types";
import {
  briefingDateKey,
  buildBriefingPrompt,
  buildFallbackSections,
  buildSnapshot,
  parseBriefingSections,
  type WatchlistInput,
} from "./build";
import {
  findBriefing,
  getBriefingPreference,
  saveBriefing,
} from "./store";
import {
  BRIEFING_SNAPSHOT_VERSION,
  type BriefingFocusSession,
  type BriefingPreferences,
  type BriefingQuote,
  type BriefingRecord,
  type BriefingResponse,
} from "./types";

const MAX_SYMBOLS = 12;
const MAX_SIGNAL_CANDIDATES = 24;
const MAX_JOURNAL_CANDIDATES = 24;
const NO_AI_MESSAGE =
  "No AI provider key is saved yet. The market summary below is live; add a key in Admin, Integrations to turn on the written brief.";

async function brandName(): Promise<string> {
  try {
    const settings = await getSiteSettings();
    return settings.branding.name.trim() || DEFAULT_BRANDING.name;
  } catch {
    return DEFAULT_BRANDING.name;
  }
}

async function gatherWatchlist(userId: string): Promise<{
  rows: WatchlistInput[];
  notes: string[];
}> {
  let symbols: string[] = [];
  try {
    symbols = (await getBriefingWatchlist(userId)).slice(0, MAX_SYMBOLS);
  } catch {
    return { rows: [], notes: [] };
  }
  if (!symbols.length) return { rows: [], notes: [] };

  let catalog: Awaited<ReturnType<typeof cachedCatalogFull>>["items"] = [];
  try {
    catalog = (await cachedCatalogFull()).items;
  } catch {
    return {
      rows: symbols.map((symbol) => ({ symbol, bars: [] })),
      notes: ["The market catalog was unavailable, so no daily bars were loaded."],
    };
  }
  const analysis = await publicSettings().catch(() => ({}) as any);
  const rows: WatchlistInput[] = [];
  const notes: string[] = [];

  for (const symbol of symbols) {
    const meta = resolveMeta(symbol, catalog);
    if (!meta) {
      rows.push({ symbol, bars: [] });
      notes.push(`${symbol}: the market catalog could not resolve this symbol.`);
      continue;
    }
    try {
      let bars = cachedBars(meta, "1d");
      if (!bars?.length) {
        const result = await getCandles(meta, "1d", analysis);
        bars = result.bars;
      }
      rows.push({ symbol, name: meta.name, type: meta.type, bars: bars ?? [] });
    } catch (err) {
      rows.push({ symbol, name: meta.name, type: meta.type, bars: [] });
      notes.push(
        `${symbol}: daily bars were unavailable (${err instanceof Error ? err.message : "provider error"}).`
      );
    }
  }

  return { rows, notes };
}

async function gatherSignals(now: Date): Promise<SignalView[]> {
  try {
    const result = await listSignals({ status: "active", limit: MAX_SIGNAL_CANDIDATES, now });
    return result.signals;
  } catch {
    return [];
  }
}

async function gatherJournal(userId: string): Promise<JournalEntryView[]> {
  try {
    const result = await listJournal(userId, { status: "open", limit: MAX_JOURNAL_CANDIDATES });
    return result.entries;
  } catch {
    return [];
  }
}

function uniqueSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of symbols) {
    const symbol = String(raw ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

async function gatherQuotes(symbols: string[]): Promise<Record<string, BriefingQuote>> {
  const unique = uniqueSymbols(symbols);
  const quotes: Record<string, BriefingQuote> = {};

  for (let i = 0; i < unique.length; i += 16) {
    const chunk = unique.slice(i, i + 16);
    try {
      const points = await signalPrices(chunk);
      for (const [symbol, point] of Object.entries(points)) {
        quotes[symbol.toUpperCase()] = {
          price: point.price,
          at: point.at,
          source: "latest",
        };
      }
    } catch {
      // Missing quotes are reported as a data note instead of failing the brief.
    }
  }

  return quotes;
}

function withDailyQuote(row: WatchlistInput, quotes: Record<string, BriefingQuote>): WatchlistInput {
  if (quotes[row.symbol.toUpperCase()]) return { ...row, quote: quotes[row.symbol.toUpperCase()] };
  const last = row.bars[row.bars.length - 1];
  if (!last || !Number.isFinite(last.close)) return { ...row, quote: null };
  const at = new Date(last.time);
  if (!Number.isFinite(at.getTime())) return { ...row, quote: null };
  return {
    ...row,
    quote: { price: last.close, at: at.toISOString(), source: "daily" },
  };
}

export async function generateBriefing(
  userId: string,
  now: Date = new Date(),
  focusSessions?: BriefingFocusSession[]
): Promise<BriefingRecord> {
  const preferences = focusSessions
    ? { focusSessions }
    : await getBriefingPreference(userId).catch(() => ({
        focusSessions: ["london", "newyork"] as BriefingFocusSession[],
      }));

  const [watchlist, signals, journal, name] = await Promise.all([
    gatherWatchlist(userId),
    gatherSignals(now),
    gatherJournal(userId),
    brandName(),
  ]);

  const quotes = await gatherQuotes([
    ...watchlist.rows.map((row) => row.symbol),
    ...signals.map((signal) => signal.symbol),
    ...journal.map((entry) => entry.symbol),
  ]);
  const watchlistRows = watchlist.rows.map((row) => withDailyQuote(row, quotes));
  for (const row of watchlistRows) {
    const quote = row.quote;
    if (quote) quotes[row.symbol.toUpperCase()] = quote;
  }

  const snapshot = buildSnapshot({
    now,
    focusSessions: preferences.focusSessions,
    watchlist: watchlistRows,
    signals,
    journalEntries: journal,
    quotes,
    dataNotes: watchlist.notes,
  });

  const config: AiConfig | null = await loadAiConfig();
  let sections = buildFallbackSections(snapshot);
  let model: string | null = null;
  let error: string | null = null;

  if (!config) {
    error = NO_AI_MESSAGE;
  } else {
    try {
      const messages = buildBriefingPrompt(snapshot, name);
      let reply = await aiChat(config, messages, {
        maxTokens: 3000,
        temperature: 0.3,
        timeoutMs: 45_000,
      });
      let parsed = parseBriefingSections(reply.text, snapshot);

      if (parsed.error) {
        try {
          reply = await aiChat(
            config,
            [
              ...messages,
              {
                role: "user",
                content:
                  "Return the briefing again as one valid JSON object only. No markdown, no code fence and no text outside the JSON. Keep every sentence short.",
              },
            ],
            { maxTokens: 3600, temperature: 0.1, timeoutMs: 45_000 }
          );
          parsed = parseBriefingSections(reply.text, snapshot);
        } catch {
          // Keep the first parse error and its deterministic fallback sections.
        }
      }

      sections = parsed.sections;
      error = parsed.error;
      model = reply.model;
    } catch (err) {
      error = err instanceof Error ? err.message : "The AI provider could not write the brief.";
    }
  }

  return saveBriefing({
    userId,
    record: {
      dateKey: snapshot.dateKey,
      generatedAt: snapshot.generatedAt,
      model,
      narrative: null,
      sections,
      error,
      snapshot,
    },
  });
}

/** Today's brief, generated if missing. `refresh` rebuilds it. */
export async function getBriefing(
  userId: string,
  options: { refresh?: boolean; now?: Date } = {}
): Promise<BriefingResponse> {
  const now = options.now ?? new Date();
  const dateKey = briefingDateKey(now);
  const [aiReady, preferences] = await Promise.all([
    loadAiConfig().then((config) => config !== null),
    getBriefingPreference(userId).catch(
      (): BriefingPreferences => ({ focusSessions: ["london", "newyork"] })
    ),
  ]);

  if (!options.refresh) {
    const stored = await findBriefing(userId, dateKey);
    if (
      stored &&
      stored.snapshot.version === BRIEFING_SNAPSHOT_VERSION &&
      stored.sections
    ) {
      return { aiReady, briefing: stored, preferences };
    }
  }

  const briefing = await generateBriefing(userId, now, preferences.focusSessions);
  return { aiReady, briefing, preferences };
}
