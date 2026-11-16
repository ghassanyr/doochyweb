// Daily briefing generation.
//
// The brief is built once per user per UTC day and stored, so reopening the page
// shows the same numbers the narrative was written about. `refresh` rebuilds it
// on demand, which is what the page's Refresh button calls.
//
// Data sources are the ones that already exist: the member's effective
// watchlist and its daily bars for movers, and the active published signals. No
// journal, holdings or account data is read, so the brief needs no broker
// connection. When no AI key is configured the snapshot is still stored and
// returned, with an error explaining how to turn the written part on.

import { aiChat, loadAiConfig, type AiConfig } from "../ai/client";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { cachedBars, getCandles } from "../market/providers/index";
import { publicSettings } from "../market/store";
import { getEffectiveWatchlist } from "../market/userWatchlist";
import type { Candle } from "../market/types";
import { DEFAULT_BRANDING } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import { listSignals } from "../signals/store";
import { briefingDateKey, buildBriefingPrompt, buildSnapshot } from "./build";
import { findBriefing, saveBriefing } from "./store";
import type { BriefingRecord, BriefingResponse } from "./types";

const MAX_SYMBOLS = 12;
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

/** Daily bars for the member's effective watchlist, skipping unreadable symbols. */
async function gatherMovers(userId: string): Promise<{ symbol: string; bars: Candle[] }[]> {
  let symbols: string[] = [];
  try {
    symbols = (await getEffectiveWatchlist(userId)).slice(0, MAX_SYMBOLS);
  } catch {
    return [];
  }
  if (!symbols.length) return [];

  let catalog: Awaited<ReturnType<typeof cachedCatalogFull>>["items"] = [];
  try {
    catalog = (await cachedCatalogFull()).items;
  } catch {
    return [];
  }
  const analysis = await publicSettings().catch(() => ({}) as any);

  const rows: { symbol: string; bars: Candle[] }[] = [];
  for (const symbol of symbols) {
    try {
      const meta = resolveMeta(symbol, catalog);
      if (!meta) continue;
      let bars = cachedBars(meta, "1d");
      if (!bars?.length) {
        const result = await getCandles(meta, "1d", analysis);
        bars = result.bars;
      }
      if (bars?.length) rows.push({ symbol, bars });
    } catch {
      // A symbol the providers cannot answer is left out of the brief.
    }
  }
  return rows;
}

export async function generateBriefing(
  userId: string,
  now: Date = new Date()
): Promise<BriefingRecord> {
  const [movers, signals, name] = await Promise.all([
    gatherMovers(userId),
    listSignals({ status: "active", limit: 6, now }).catch(() => ({
      signals: [],
      total: 0,
      counts: null,
    })),
    brandName(),
  ]);

  const snapshot = buildSnapshot({ now, movers, signals: signals.signals });
  const config: AiConfig | null = await loadAiConfig();

  let narrative: string | null = null;
  let model: string | null = null;
  let error: string | null = null;

  if (!config) {
    error = NO_AI_MESSAGE;
  } else {
    try {
      const reply = await aiChat(config, buildBriefingPrompt(snapshot, name), {
        maxTokens: 420,
        temperature: 0.4,
      });
      narrative = reply.text;
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
      narrative,
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
  const aiReady = (await loadAiConfig()) !== null;

  if (!options.refresh) {
    const stored = await findBriefing(userId, dateKey);
    if (stored) return { aiReady, briefing: stored };
  }

  const briefing = await generateBriefing(userId, now);
  return { aiReady, briefing };
}
