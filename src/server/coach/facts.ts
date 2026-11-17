// Deterministic coaching facts built from the member's Trade Journal.
//
// These functions are pure so the rules are unit-tested independently of Mongo,
// the AI provider and the web UI. The AI only sees this object; it never reads
// the journal directly and cannot invent values outside it.

import type { JournalEntryView } from "../journal/types";
import {
  COACH_MAX_WEEKLY_TRADE_FACTS,
  COACH_MIN_WEEKLY_TRADES,
  type CoachBucket,
  type CoachExitVsPlan,
  type CoachOutcome,
  type CoachTradeFacts,
  type CoachWeekInfo,
  type CoachWeeklyFacts,
} from "./types";
import { coachWeekInfo, coachWeekKey, weekdayLabel, type CoachWeekRange } from "./weeks";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function iso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw ?? "").trim().slice(0, 32);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

function noteText(note: string): string {
  return String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function validStop(entry: number, stop: number, side: "buy" | "sell"): boolean {
  return side === "buy" ? stop < entry : stop > entry;
}

function validTarget(entry: number, target: number, side: "buy" | "sell"): boolean {
  return side === "buy" ? target > entry : target < entry;
}

function outcomeFrom(pnl: number | null, entry: number | null, exit: number | null, side: "buy" | "sell"): CoachOutcome {
  if (pnl != null) return pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven";
  if (entry != null && exit != null) {
    const move = side === "buy" ? exit - entry : entry - exit;
    return move > 0 ? "win" : move < 0 ? "loss" : "breakeven";
  }
  return "unknown";
}

function exitVsPlan(
  exit: number | null,
  entry: number | null,
  stop: number | null,
  target: number | null,
  side: "buy" | "sell"
): CoachExitVsPlan {
  if (exit == null || entry == null) return "unknown";
  const stopValid = stop != null && validStop(entry, stop, side);
  const targetValid = target != null && validTarget(entry, target, side);
  if (!stopValid && !targetValid) return "unknown";

  const targetHit = targetValid && (side === "buy" ? exit >= target! : exit <= target!);
  const stopHit = stopValid && (side === "buy" ? exit <= stop! : exit >= stop!);
  if (targetHit && !stopHit) return "target";
  if (stopHit && !targetHit) return "stop";
  if (!targetHit && !stopHit) return "inside_plan";
  return "unknown";
}

export function buildTradeFacts(entry: JournalEntryView): CoachTradeFacts {
  const side = entry.side;
  const entryPrice = finite(entry.entryPrice);
  const exitPrice = finite(entry.exitPrice);
  const stop = finite(entry.stop);
  const target = finite(entry.target);
  const pnl = finite(entry.pnl);
  const fees = finite(entry.fees);
  const openedAt = iso(entry.openedAt);
  const closedAt = iso(entry.closedAt);
  const missing: string[] = [];
  const caveats: string[] = [];

  if (entryPrice == null) missing.push("entry");
  if (exitPrice == null) missing.push("exit");
  if (stop == null) missing.push("stop");
  if (target == null) missing.push("target");
  if (pnl == null) missing.push("pnl");
  if (openedAt == null) missing.push("open time");
  if (closedAt == null) missing.push("close time");

  let holdingHours: number | null = null;
  if (openedAt && closedAt) {
    const hours = (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 3_600_000;
    holdingHours = hours >= 0 ? round(hours, 2) : null;
    if (hours < 0) caveats.push("The close time is earlier than the open time.");
  }

  const stopValid = entryPrice != null && stop != null && validStop(entryPrice, stop, side);
  const targetValid = entryPrice != null && target != null && validTarget(entryPrice, target, side);
  if (stop != null && !stopValid) {
    caveats.push("The recorded stop is on the wrong side of entry, so R metrics are unavailable.");
  }
  if (target != null && !targetValid) {
    caveats.push("The recorded target is on the wrong side of entry, so plan distance is unavailable.");
  }

  let realizedR: number | null = null;
  if (entryPrice != null && exitPrice != null && stop != null && stopValid) {
    const risk = Math.abs(entryPrice - stop);
    if (risk > 0) {
      const move = side === "buy" ? exitPrice - entryPrice : entryPrice - exitPrice;
      realizedR = round(move / risk, 2);
    }
  }

  let plannedRr: number | null = null;
  if (entryPrice != null && stop != null && target != null && stopValid && targetValid) {
    const risk = Math.abs(entryPrice - stop);
    const reward = Math.abs(target - entryPrice);
    if (risk > 0) plannedRr = round(reward / risk, 2);
  }

  if (entry.source === "manual") {
    caveats.push("This trade is self-reported; P&L is not broker-verified.");
  }
  if (stop == null) caveats.push("No stop is recorded, so realized R is unavailable.");
  if (pnl == null) caveats.push("No P&L is recorded.");
  if (closedAt == null) caveats.push("No close time is recorded.");

  return {
    id: entry.id,
    symbol: entry.symbol.toUpperCase(),
    side,
    source: entry.source,
    verified: entry.verified,
    accountLabel: entry.accountLabel,
    openedAt,
    closedAt,
    holdingHours,
    entryPrice,
    exitPrice,
    stop,
    target,
    pnl,
    fees,
    outcome: outcomeFrom(pnl, entryPrice, exitPrice, side),
    realizedR,
    plannedRr,
    exitVsPlan: exitVsPlan(exitPrice, entryPrice, stop, target, side),
    strategy: String(entry.strategy ?? "").trim().slice(0, 80),
    tags: cleanTags(entry.tags),
    note: noteText(entry.note),
    missing,
    caveats: [...new Set(caveats)],
  };
}

function bucketize(
  facts: CoachTradeFacts[],
  keyOf: (fact: CoachTradeFacts) => string[],
  labelOf: (key: string) => string,
  limit = 8
): CoachBucket[] {
  const groups = new Map<string, CoachTradeFacts[]>();
  for (const fact of facts) {
    for (const key of keyOf(fact)) {
      const existing = groups.get(key) ?? [];
      existing.push(fact);
      groups.set(key, existing);
    }
  }

  const rows = [...groups.entries()].map(([key, rows]) => {
    const priced = rows.filter((fact) => fact.pnl != null);
    const wins = rows.filter((fact) => fact.outcome === "win").length;
    const losses = rows.filter((fact) => fact.outcome === "loss").length;
    const decided = wins + losses;
    const withR = rows.filter((fact) => fact.realizedR != null);
    const totalR = withR.length
      ? round(withR.reduce((sum, fact) => sum + (fact.realizedR as number), 0), 2)
      : null;
    return {
      key,
      label: labelOf(key),
      trades: rows.length,
      wins,
      losses,
      winRate: decided ? round(wins / decided, 3) : null,
      netPnl: round(priced.reduce((sum, fact) => sum + (fact.pnl as number), 0), 2),
      totalR,
      avgR: totalR == null ? null : round(totalR / withR.length, 2),
    };
  });

  return rows
    .sort((a, b) => b.trades - a.trades || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function said(count: number): string {
  return `${count} ${count === 1 ? "trade" : "trades"}`;
}

export function buildWeeklyFacts(
  range: CoachWeekRange,
  entries: JournalEntryView[]
): CoachWeeklyFacts {
  const inWeek = entries
    .filter((entry) => entry.status === "closed")
    .filter((entry) => {
      if (!entry.closedAt) return false;
      const at = new Date(entry.closedAt).getTime();
      return Number.isFinite(at) && at >= range.start.getTime() && at < range.endExclusive.getTime();
    })
    .sort((a, b) => new Date(a.closedAt as string).getTime() - new Date(b.closedAt as string).getTime());

  const facts = inWeek.map(buildTradeFacts);
  const priced = facts.filter((fact) => fact.pnl != null);
  const wins = facts.filter((fact) => fact.outcome === "win").length;
  const losses = facts.filter((fact) => fact.outcome === "loss").length;
  const breakeven = facts.filter((fact) => fact.outcome === "breakeven").length;
  const unknownOutcomes = facts.filter((fact) => fact.outcome === "unknown").length;
  const decided = wins + losses;
  const grossProfit = priced
    .filter((fact) => (fact.pnl as number) > 0)
    .reduce((sum, fact) => sum + (fact.pnl as number), 0);
  const grossLoss = Math.abs(
    priced
      .filter((fact) => (fact.pnl as number) < 0)
      .reduce((sum, fact) => sum + (fact.pnl as number), 0)
  );
  const netPnl = priced.reduce((sum, fact) => sum + (fact.pnl as number), 0);
  const withR = facts.filter((fact) => fact.realizedR != null);
  const withPlanned = facts.filter((fact) => fact.plannedRr != null);
  const totalR = withR.length
    ? withR.reduce((sum, fact) => sum + (fact.realizedR as number), 0)
    : null;

  let peak = 0;
  let cumulative = 0;
  let maxDrawdown = 0;
  for (const fact of priced) {
    cumulative += fact.pnl as number;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  let longestLossStreak = 0;
  let currentLossStreak = 0;
  for (const fact of facts) {
    if (fact.outcome === "loss") {
      currentLossStreak += 1;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }

  const dayKeys = new Set(
    facts
      .map((fact) => fact.closedAt?.slice(0, 10))
      .filter((key): key is string => Boolean(key))
  );
  const activeDays = dayKeys.size;
  const strategyOf = (fact: CoachTradeFacts): string[] => [
    fact.strategy.trim() || "No strategy",
  ];
  const tagOf = (fact: CoachTradeFacts): string[] => fact.tags.map((tag) => tag.toLowerCase());
  const weekdayOf = (fact: CoachTradeFacts): string[] => {
    const date = fact.closedAt ? new Date(fact.closedAt) : null;
    return date && Number.isFinite(date.getTime()) ? [weekdayLabel(date)] : [];
  };
  const sideLabel = (key: string) => (key === "buy" ? "Buy" : "Sell");

  const planCompleteness = {
    entry: facts.filter((fact) => fact.entryPrice != null).length,
    exit: facts.filter((fact) => fact.exitPrice != null).length,
    stop: facts.filter((fact) => fact.stop != null).length,
    target: facts.filter((fact) => fact.target != null).length,
    pnl: facts.filter((fact) => fact.pnl != null).length,
  };

  const caveats: string[] = [];
  if (!facts.length) {
    caveats.push("No closed trades were recorded in this UTC week.");
  } else if (facts.length < COACH_MIN_WEEKLY_TRADES) {
    caveats.push(
      `${said(facts.length)} closed in this week. At least ${COACH_MIN_WEEKLY_TRADES} are needed before AI pattern commentary is generated.`
    );
  }
  const manualTrades = facts.filter((fact) => !fact.verified).length;
  const verifiedTrades = facts.length - manualTrades;
  if (manualTrades) {
    caveats.push(
      `${said(manualTrades)} are self-reported, so their P&L is not broker-verified.`
    );
  }
  if (manualTrades && verifiedTrades) {
    caveats.push("This report mixes verified broker records with self-reported trades.");
  }
  if (priced.length < facts.length) {
    caveats.push(`${said(facts.length - priced.length)} have no P&L recorded.`);
  }
  if (planCompleteness.stop < facts.length) {
    caveats.push(
      `${said(facts.length - planCompleteness.stop)} have no stop, so realized R is unavailable for them.`
    );
  }
  if (!withR.length && facts.length) {
    caveats.push("No realized R was available for this week.");
  }
  if (facts.length > COACH_MAX_WEEKLY_TRADE_FACTS) {
    caveats.push(
      `The individual trade list was capped at ${COACH_MAX_WEEKLY_TRADE_FACTS} of ${facts.length}; aggregate numbers use every trade.`
    );
  }
  caveats.push("P&L is shown as recorded. Balances in different account currencies are not converted.");

  return {
    weekKey: range.key,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    closedTrades: facts.length,
    pricedTrades: priced.length,
    verifiedTrades,
    manualTrades,
    wins,
    losses,
    breakeven,
    unknownOutcomes,
    winRate: decided ? round(wins / decided, 3) : null,
    netPnl: round(netPnl, 2),
    avgPnl: priced.length ? round(netPnl / priced.length, 2) : null,
    avgWin: priced.filter((fact) => (fact.pnl as number) > 0).length
      ? round(
          priced.filter((fact) => (fact.pnl as number) > 0).reduce((sum, fact) => sum + (fact.pnl as number), 0) /
            priced.filter((fact) => (fact.pnl as number) > 0).length,
          2
        )
      : null,
    avgLoss: priced.filter((fact) => (fact.pnl as number) < 0).length
      ? round(
          priced.filter((fact) => (fact.pnl as number) < 0).reduce((sum, fact) => sum + (fact.pnl as number), 0) /
            priced.filter((fact) => (fact.pnl as number) < 0).length,
          2
        )
      : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : null,
    totalR: totalR == null ? null : round(totalR, 2),
    avgR: totalR == null ? null : round(totalR / withR.length, 2),
    avgPlannedRr: withPlanned.length
      ? round(
          withPlanned.reduce((sum, fact) => sum + (fact.plannedRr as number), 0) / withPlanned.length,
          2
        )
      : null,
    maxDrawdown: priced.length ? round(maxDrawdown, 2) : null,
    longestLossStreak,
    largestWin: priced.filter((fact) => (fact.pnl as number) > 0).length
      ? round(Math.max(...priced.filter((fact) => (fact.pnl as number) > 0).map((fact) => fact.pnl as number)), 2)
      : null,
    largestLoss: priced.filter((fact) => (fact.pnl as number) < 0).length
      ? round(Math.min(...priced.filter((fact) => (fact.pnl as number) < 0).map((fact) => fact.pnl as number)), 2)
      : null,
    activeDays,
    avgTradesPerActiveDay: activeDays ? round(facts.length / activeDays, 2) : null,
    tradesWithNotes: facts.filter((fact) => fact.note.trim()).length,
    planCompleteness,
    bySymbol: bucketize(facts, (fact) => [fact.symbol], (key) => key),
    bySide: bucketize(facts, (fact) => [fact.side], sideLabel),
    byStrategy: bucketize(facts, strategyOf, (key) => key),
    byTag: bucketize(facts, tagOf, (key) => key),
    byWeekday: bucketize(facts, weekdayOf, (key) => key),
    tradesIncluded: Math.min(facts.length, COACH_MAX_WEEKLY_TRADE_FACTS),
    tradesTotal: facts.length,
    trades: facts.slice(-COACH_MAX_WEEKLY_TRADE_FACTS),
    caveats,
  };
}

export function buildCoachWeekOptions(
  entries: JournalEntryView[],
  now: Date,
  limit = 12
): CoachWeekInfo[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.status !== "closed" || !entry.closedAt) continue;
    const at = new Date(entry.closedAt);
    if (!Number.isFinite(at.getTime())) continue;
    const key = coachWeekKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const currentKey = coachWeekKey(now);
  if (!counts.has(currentKey)) counts.set(currentKey, 0);

  return [...counts.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, limit)
    .map(([key, count]) => coachWeekInfo(key, count))
    .filter((week): week is CoachWeekInfo => Boolean(week));
}
