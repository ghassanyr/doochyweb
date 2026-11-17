// AI Coach generation and reads.
//
// Weekly reports are never generated on page load: the member presses Generate
// or Regenerate, so each AI call is explicit. Facts are rebuilt from the journal
// on every read and generation; the stored report is a snapshot of the prose and
// the facts it was written over. Journal mutations clear the affected reports.

import { aiChat, loadAiConfig } from "../ai/client";
import { findJournalEntry, listClosedJournalEntries } from "../journal/store";
import { DEFAULT_BRANDING } from "../settings/defaults";
import { getSiteSettings } from "../settings/store";
import {
  buildTradeFallbackSections,
  buildTradePrompt,
  buildWeeklyFallbackSections,
  buildWeeklyPrompt,
  parseTradeSections,
  parseWeeklySections,
} from "./build";
import { buildCoachWeekOptions, buildTradeFacts, buildWeeklyFacts } from "./facts";
import {
  findCoachReport,
  reviewedTradeIds,
  saveCoachReport,
} from "./store";
import {
  COACH_MIN_WEEKLY_TRADES,
  type CoachTradeFacts,
  type CoachTradeListItem,
  type CoachTradeResponse,
  type CoachTradeSections,
  type CoachWeeklyFacts,
  type CoachWeeklyResponse,
  type CoachWeeklySections,
} from "./types";
import { coachWeekInfo, coachWeekKey, coachWeekRange } from "./weeks";

const NO_WEEKLY_AI_MESSAGE =
  "No AI provider key is saved yet. The deterministic review below uses your recorded journal facts. Add a key in Admin, Integrations to turn on written coaching.";
const NO_TRADE_AI_MESSAGE =
  "No AI provider key is saved yet. The deterministic review below uses this trade's recorded facts. Add a key in Admin, Integrations to turn on written coaching.";

export class CoachError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CoachError";
    this.status = status;
  }
}

async function brandName(): Promise<string> {
  try {
    const settings = await getSiteSettings();
    return settings.branding.name.trim() || DEFAULT_BRANDING.name;
  } catch {
    return DEFAULT_BRANDING.name;
  }
}

function selectedWeek(raw: string | undefined, now: Date) {
  const key = raw?.trim() || coachWeekKey(now);
  const range = coachWeekRange(key);
  if (!range) throw new CoachError(400, "week must be a valid UTC week such as 2026-W46");
  return range;
}

async function weeklyFacts(userId: string, range: ReturnType<typeof coachWeekRange> & object) {
  const entries = await listClosedJournalEntries(userId, {
    from: range.start,
    to: range.endExclusive,
  });
  return buildWeeklyFacts(range, entries);
}

async function recentClosedEntries(userId: string, now: Date) {
  const from = new Date(now.getTime() - 26 * 7 * 86_400_000);
  return listClosedJournalEntries(userId, { from, order: "desc" });
}

async function writeWeeklyReview(
  facts: CoachWeeklyFacts,
  config: Awaited<ReturnType<typeof loadAiConfig>>,
  name: string
): Promise<{ sections: CoachWeeklySections; model: string | null; error: string | null }> {
  const fallback = buildWeeklyFallbackSections(facts);
  if (!config) return { sections: fallback, model: null, error: NO_WEEKLY_AI_MESSAGE };

  try {
    const messages = buildWeeklyPrompt(facts, name);
    let reply = await aiChat(config, messages, {
      maxTokens: 2400,
      temperature: 0.25,
      timeoutMs: 45_000,
    });
    let parsed = parseWeeklySections(reply.text, facts);

    if (parsed.error) {
      try {
        reply = await aiChat(
          config,
          [
            ...messages,
            {
              role: "user",
              content:
                "Return the weekly review again as one valid JSON object only. No markdown, no code fence and no text outside the JSON. Keep every item short.",
            },
          ],
          { maxTokens: 2800, temperature: 0.1, timeoutMs: 45_000 }
        );
        parsed = parseWeeklySections(reply.text, facts);
      } catch {
        // Keep the first fallback and parse error.
      }
    }

    return { sections: parsed.sections, model: reply.model, error: parsed.error };
  } catch (err) {
    return {
      sections: fallback,
      model: null,
      error: err instanceof Error ? err.message : "The AI provider could not write the weekly review.",
    };
  }
}

async function writeTradeReview(
  facts: CoachTradeFacts,
  config: Awaited<ReturnType<typeof loadAiConfig>>,
  name: string
): Promise<{ sections: CoachTradeSections; model: string | null; error: string | null }> {
  const fallback = buildTradeFallbackSections(facts);
  if (!config) return { sections: fallback, model: null, error: NO_TRADE_AI_MESSAGE };

  try {
    const messages = buildTradePrompt(facts, name);
    let reply = await aiChat(config, messages, {
      maxTokens: 1500,
      temperature: 0.25,
      timeoutMs: 45_000,
    });
    let parsed = parseTradeSections(reply.text, facts);

    if (parsed.error) {
      try {
        reply = await aiChat(
          config,
          [
            ...messages,
            {
              role: "user",
              content:
                "Return the trade review again as one valid JSON object only. No markdown, no code fence and no text outside the JSON. Keep every item short.",
            },
          ],
          { maxTokens: 1800, temperature: 0.1, timeoutMs: 45_000 }
        );
        parsed = parseTradeSections(reply.text, facts);
      } catch {
        // Keep the first fallback and parse error.
      }
    }

    return { sections: parsed.sections, model: reply.model, error: parsed.error };
  } catch (err) {
    return {
      sections: fallback,
      model: null,
      error: err instanceof Error ? err.message : "The AI provider could not write the trade review.",
    };
  }
}

export async function getWeeklyReview(
  userId: string,
  rawWeek?: string,
  now: Date = new Date()
): Promise<CoachWeeklyResponse> {
  const range = selectedWeek(rawWeek, now);
  const [aiReady, facts, recent, stored] = await Promise.all([
    loadAiConfig().then((config) => config !== null),
    weeklyFacts(userId, range),
    recentClosedEntries(userId, now),
    findCoachReport(userId, "weekly", range.key),
  ]);

  const week = coachWeekInfo(range.key, facts.closedTrades);
  if (!week) throw new CoachError(400, "week must be a valid UTC week such as 2026-W46");

  return {
    aiReady,
    week,
    weeks: buildCoachWeekOptions(recent, now),
    facts: stored?.kind === "weekly" ? stored.facts : facts,
    report: stored?.kind === "weekly" ? stored : null,
  };
}

export async function generateWeeklyReview(
  userId: string,
  rawWeek?: string,
  now: Date = new Date()
): Promise<CoachWeeklyResponse> {
  const range = selectedWeek(rawWeek, now);
  const [facts, recent, config, name] = await Promise.all([
    weeklyFacts(userId, range),
    recentClosedEntries(userId, now),
    loadAiConfig(),
    brandName(),
  ]);

  if (facts.closedTrades < COACH_MIN_WEEKLY_TRADES) {
    throw new CoachError(
      400,
      `At least ${COACH_MIN_WEEKLY_TRADES} closed trades are needed for a weekly AI review.`
    );
  }

  const written = await writeWeeklyReview(facts, config, name);
  const report = await saveCoachReport({
    userId,
    kind: "weekly",
    key: range.key,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    facts,
    sections: written.sections,
    model: written.model,
    error: written.error,
    generatedAt: now.toISOString(),
  });

  const week = coachWeekInfo(range.key, facts.closedTrades);
  if (!week) throw new CoachError(400, "week must be a valid UTC week such as 2026-W46");

  return {
    aiReady: config !== null,
    week,
    weeks: buildCoachWeekOptions(recent, now),
    facts,
    report: report.kind === "weekly" ? report : null,
  };
}

export async function getRecentTrades(userId: string): Promise<{
  aiReady: boolean;
  trades: CoachTradeListItem[];
}> {
  const [aiReady, entries] = await Promise.all([
    loadAiConfig().then((config) => config !== null),
    listClosedJournalEntries(userId, { limit: 20, order: "desc" }),
  ]);
  const reviewed = await reviewedTradeIds(
    userId,
    entries.map((entry) => entry.id)
  );
  return {
    aiReady,
    trades: entries.map((entry) => ({
      id: entry.id,
      symbol: entry.symbol,
      side: entry.side,
      source: entry.source,
      verified: entry.verified,
      closedAt: entry.closedAt,
      pnl: entry.pnl,
      reviewed: reviewed.has(entry.id),
    })),
  };
}

export async function getTradeReview(
  userId: string,
  entryId: string
): Promise<CoachTradeResponse> {
  const entry = await findJournalEntry(userId, entryId);
  if (!entry) throw new CoachError(404, "journal entry not found");
  if (entry.status !== "closed") throw new CoachError(400, "Only closed trades can be reviewed.");

  const [aiReady, stored] = await Promise.all([
    loadAiConfig().then((config) => config !== null),
    findCoachReport(userId, "trade", entryId),
  ]);
  const facts = buildTradeFacts(entry);
  return {
    aiReady,
    facts: stored?.kind === "trade" ? stored.facts : facts,
    report: stored?.kind === "trade" ? stored : null,
  };
}

export async function generateTradeReview(
  userId: string,
  entryId: string,
  now: Date = new Date()
): Promise<CoachTradeResponse> {
  const entry = await findJournalEntry(userId, entryId);
  if (!entry) throw new CoachError(404, "journal entry not found");
  if (entry.status !== "closed") throw new CoachError(400, "Only closed trades can be reviewed.");

  const facts = buildTradeFacts(entry);
  const [config, name] = await Promise.all([loadAiConfig(), brandName()]);
  const written = await writeTradeReview(facts, config, name);
  const report = await saveCoachReport({
    userId,
    kind: "trade",
    key: entryId,
    periodStart: entry.openedAt,
    periodEnd: entry.closedAt,
    facts,
    sections: written.sections,
    model: written.model,
    error: written.error,
    generatedAt: now.toISOString(),
  });

  return {
    aiReady: config !== null,
    facts,
    report: report.kind === "trade" ? report : null,
  };
}
