import type { AlertListResponse, AlertView } from "../alerts/types";
import { buildFallbackSections } from "../briefing/build";
import {
  BRIEFING_SNAPSHOT_VERSION,
  type BriefingJournalIdea,
  type BriefingResponse,
  type BriefingSessionRow,
  type BriefingWatchlistRow,
} from "../briefing/types";
import { buildTradeFallbackSections, buildWeeklyFallbackSections } from "../coach/build";
import { buildTradeFacts, buildWeeklyFacts } from "../coach/facts";
import type {
  CoachTradeListItem,
  CoachTradeListResponse,
  CoachTradeReport,
  CoachTradeResponse,
  CoachWeeklyResponse,
} from "../coach/types";
import { coachWeekInfo, coachWeekRange } from "../coach/weeks";
import type { OrderHistoryResult, OrderHistoryRow } from "../ctrader/history";
import type { AccountView, OrderRow, PositionRow } from "../ctrader/reads";
import { computeJournalStats } from "../journal/store";
import type { JournalEntryView, JournalListResponse } from "../journal/types";

export const DEMO_CTID = 900001;
export const DEMO_WEEK_KEY = "2026-W47";
export const DEMO_GENERATED_AT = "2026-11-17T09:30:00.000Z";

const DEMO_QUOTES: Record<string, { bid: number; ask: number; digits: number }> = {
  EURUSD: { bid: 1.0846, ask: 1.0848, digits: 5 },
  GBPUSD: { bid: 1.2759, ask: 1.2762, digits: 5 },
  USDJPY: { bid: 149.78, ask: 149.81, digits: 3 },
  XAUUSD: { bid: 2649.4, ask: 2649.9, digits: 2 },
  US30: { bid: 44208, ask: 44214, digits: 1 },
  BTCUSD: { bid: 67218, ask: 67264, digits: 2 },
  AUDUSD: { bid: 0.6621, ask: 0.6624, digits: 5 },
};

function isoAt(day: number, hour: number, minute = 0): string {
  return new Date(Date.UTC(2026, 10, day, hour, minute)).toISOString();
}

function msAt(day: number, hour: number, minute = 0): number {
  return Date.UTC(2026, 10, day, hour, minute);
}

export const DEMO_CTRADER_ACCOUNT: AccountView = {
  ctid: DEMO_CTID,
  login: 900001,
  broker: "Doochy Sample Broker",
  isLive: false,
  balance: 24860.42,
  currency: "USD",
  nickname: "Sample account",
  color: "teal",
};

export const DEMO_POSITIONS: PositionRow[] = [
  { positionId: 700101, symbol: "EURUSD", side: "BUY", lots: 1.25, entryPrice: 1.0842, stopLoss: 1.0805, takeProfit: 1.091, netUsd: 142.5, digits: 5, openTimestamp: msAt(16, 8, 35) },
  { positionId: 700102, symbol: "GBPUSD", side: "SELL", lots: 0.8, entryPrice: 1.2764, stopLoss: 1.281, takeProfit: 1.267, netUsd: 88.2, digits: 5, openTimestamp: msAt(16, 11, 10) },
  { positionId: 700103, symbol: "XAUUSD", side: "BUY", lots: 0.35, entryPrice: 2648.2, stopLoss: 2635, takeProfit: 2675, netUsd: 210.75, digits: 2, openTimestamp: msAt(17, 7, 45) },
  { positionId: 700104, symbol: "USDJPY", side: "SELL", lots: 0.9, entryPrice: 149.82, stopLoss: 150.35, takeProfit: 148.6, netUsd: -63.4, digits: 3, openTimestamp: msAt(17, 8, 5) },
  { positionId: 700105, symbol: "US30", side: "BUY", lots: 0.4, entryPrice: 44210, stopLoss: 44000, takeProfit: 44600, netUsd: 96.8, digits: 1, openTimestamp: msAt(17, 8, 20) },
  { positionId: 700106, symbol: "BTCUSD", side: "BUY", lots: 0.15, entryPrice: 67240, stopLoss: 66500, takeProfit: 68800, netUsd: -118.25, digits: 2, openTimestamp: msAt(17, 6, 15) },
  { positionId: 700107, symbol: "AUDUSD", side: "SELL", lots: 0.6, entryPrice: 0.6624, stopLoss: 0.666, takeProfit: 0.655, netUsd: 41.1, digits: 5, openTimestamp: msAt(17, 9, 0) },
];

export const DEMO_ORDERS: OrderRow[] = [
  { orderId: 710101, symbol: "EURUSD", side: "BUY", orderType: "LIMIT", price: 1.0795, lots: 0.5, stopLoss: 1.0765, takeProfit: 1.086, digits: 5, expirationTimestamp: null, expirationType: "GTC" },
  { orderId: 710102, symbol: "XAUUSD", side: "SELL", orderType: "STOP", price: 2628, lots: 0.25, stopLoss: 2642, takeProfit: 2595, digits: 2, expirationTimestamp: null, expirationType: "GTC" },
  { orderId: 710103, symbol: "US30", side: "BUY", orderType: "STOP", price: 44700, lots: 0.2, stopLoss: 44520, takeProfit: 45200, digits: 1, expirationTimestamp: msAt(21, 21, 0), expirationType: "GTD" },
];

type JournalSeed = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  status: "open" | "closed";
  source: "manual" | "ctrader";
  lots: number;
  entryPrice: number;
  exitPrice: number | null;
  stop: number;
  target: number;
  pnl: number | null;
  openedDay: number;
  openedHour: number;
  closedDay?: number;
  closedHour?: number;
  strategy: string;
  tags: string[];
  note: string;
};

const JOURNAL_SEEDS: JournalSeed[] = [
  { id: "demo-trade-001", symbol: "EURUSD", side: "buy", status: "closed", source: "ctrader", lots: 0.8, entryPrice: 1.0812, exitPrice: 1.0835, stop: 1.078, target: 1.087, pnl: 185, openedDay: 16, openedHour: 7, closedDay: 16, closedHour: 10, strategy: "London breakout", tags: ["breakout", "london"], note: "Clean hold above the Asian range." },
  { id: "demo-trade-002", symbol: "GBPUSD", side: "sell", status: "closed", source: "ctrader", lots: 0.6, entryPrice: 1.2792, exitPrice: 1.2807, stop: 1.2825, target: 1.274, pnl: -92, openedDay: 16, openedHour: 12, closedDay: 16, closedHour: 14, strategy: "Trend retest", tags: ["retest"], note: "Stopped out before the London continuation." },
  { id: "demo-trade-003", symbol: "XAUUSD", side: "buy", status: "closed", source: "ctrader", lots: 0.3, entryPrice: 2628.4, exitPrice: 2636.2, stop: 2620, target: 2650, pnl: 240, openedDay: 16, openedHour: 15, closedDay: 17, closedHour: 8, strategy: "Pullback continuation", tags: ["gold", "pullback"], note: "Waited for the retest instead of chasing the impulse." },
  { id: "demo-trade-004", symbol: "USDJPY", side: "sell", status: "closed", source: "manual", lots: 0.5, entryPrice: 150.12, exitPrice: 149.96, stop: 150.55, target: 148.9, pnl: 64, openedDay: 17, openedHour: 6, closedDay: 17, closedHour: 9, strategy: "Range fade", tags: ["range"], note: "Took the first reaction at range resistance." },
  { id: "demo-trade-005", symbol: "BTCUSD", side: "buy", status: "closed", source: "ctrader", lots: 0.12, entryPrice: 68010, exitPrice: 67720, stop: 67200, target: 69200, pnl: -130, openedDay: 17, openedHour: 1, closedDay: 17, closedHour: 5, strategy: "Breakout retry", tags: ["crypto", "breakout"], note: "Second breakout attempt failed; needed a tighter trigger." },
  { id: "demo-trade-006", symbol: "EURUSD", side: "buy", status: "closed", source: "ctrader", lots: 1, entryPrice: 1.0798, exitPrice: 1.0839, stop: 1.0765, target: 1.088, pnl: 310, openedDay: 17, openedHour: 7, closedDay: 17, closedHour: 11, strategy: "NY opening range", tags: ["newyork", "breakout"], note: "Well-defined risk and no early exit." },
  { id: "demo-trade-007", symbol: "AUDUSD", side: "sell", status: "closed", source: "manual", lots: 0.7, entryPrice: 0.6652, exitPrice: 0.6641, stop: 0.668, target: 0.659, pnl: 58, openedDay: 18, openedHour: 2, closedDay: 18, closedHour: 6, strategy: "Trend retest", tags: ["retest"], note: "Partial target before the session close." },
  { id: "demo-trade-008", symbol: "US30", side: "buy", status: "closed", source: "ctrader", lots: 0.25, entryPrice: 44320, exitPrice: 44255, stop: 44100, target: 44700, pnl: -75, openedDay: 18, openedHour: 8, closedDay: 18, closedHour: 10, strategy: "NY opening range", tags: ["indices"], note: "Entry came too late in the first five-minute bar." },
  { id: "demo-trade-009", symbol: "GBPUSD", side: "buy", status: "closed", source: "ctrader", lots: 0.9, entryPrice: 1.2708, exitPrice: 1.2729, stop: 1.2675, target: 1.279, pnl: 142, openedDay: 19, openedHour: 9, closedDay: 19, closedHour: 13, strategy: "Pullback continuation", tags: ["pullback"], note: "Good structure, modest target." },
  { id: "demo-trade-010", symbol: "XAUUSD", side: "sell", status: "closed", source: "ctrader", lots: 0.2, entryPrice: 2661.5, exitPrice: 2658.7, stop: 2668, target: 2640, pnl: 96, openedDay: 19, openedHour: 14, closedDay: 19, closedHour: 17, strategy: "Range fade", tags: ["gold", "range"], note: "Small, planned trade at the top of the range." },
  { id: "demo-trade-011", symbol: "USDJPY", side: "buy", status: "closed", source: "manual", lots: 0.4, entryPrice: 148.72, exitPrice: 148.56, stop: 149.2, target: 150.2, pnl: -48, openedDay: 20, openedHour: 3, closedDay: 20, closedHour: 7, strategy: "Breakout retry", tags: ["breakout"], note: "Chased a candle outside the planned entry zone." },
  { id: "demo-trade-012", symbol: "EURUSD", side: "sell", status: "closed", source: "ctrader", lots: 1.1, entryPrice: 1.0884, exitPrice: 1.0846, stop: 1.092, target: 1.078, pnl: 205, openedDay: 20, openedHour: 12, closedDay: 20, closedHour: 16, strategy: "London breakout", tags: ["breakout", "london"], note: "Held through the retrace to the target." },
  { id: "demo-idea-001", symbol: "EURUSD", side: "buy", status: "open", source: "manual", lots: 0.75, entryPrice: 1.0825, exitPrice: null, stop: 1.0785, target: 1.0905, pnl: null, openedDay: 17, openedHour: 10, strategy: "Pullback continuation", tags: ["idea", "pullback"], note: "Only valid if the 1.0840 retest holds." },
  { id: "demo-idea-002", symbol: "XAUUSD", side: "buy", status: "open", source: "manual", lots: 0.25, entryPrice: 2642, exitPrice: null, stop: 2628, target: 2680, pnl: null, openedDay: 17, openedHour: 11, strategy: "Trend retest", tags: ["idea", "gold"], note: "Waiting for a clean reclaim of 2650." },
  { id: "demo-idea-003", symbol: "GBPUSD", side: "sell", status: "open", source: "manual", lots: 0.5, entryPrice: 1.2735, exitPrice: null, stop: 1.2795, target: 1.2625, pnl: null, openedDay: 17, openedHour: 12, strategy: "Range fade", tags: ["idea", "range"], note: "Lower priority while London stays in a range." },
];

function journalEntry(seed: JournalSeed): JournalEntryView {
  const openedAt = isoAt(seed.openedDay, seed.openedHour);
  const closedAt = seed.closedDay == null || seed.closedHour == null ? null : isoAt(seed.closedDay, seed.closedHour);
  return {
    id: seed.id,
    source: seed.source,
    broker: seed.source === "ctrader" ? "ctrader" : null,
    accountId: seed.source === "ctrader" ? String(DEMO_CTID) : null,
    externalId: seed.source === "ctrader" ? seed.id : null,
    dealId: seed.source === "ctrader" ? Number(seed.id.slice(-3)) : null,
    accountCtid: seed.source === "ctrader" ? DEMO_CTID : null,
    accountLabel: "Doochy sample account",
    symbol: seed.symbol,
    side: seed.side,
    lots: seed.lots,
    entryPrice: seed.entryPrice,
    exitPrice: seed.exitPrice,
    stop: seed.stop,
    target: seed.target,
    pnl: seed.pnl,
    fees: seed.source === "ctrader" ? 1.2 : null,
    openedAt,
    closedAt,
    status: seed.status,
    verified: seed.source === "ctrader",
    strategy: seed.strategy,
    tags: seed.tags,
    note: seed.note,
    createdAt: openedAt,
    updatedAt: closedAt ?? openedAt,
  };
}

export const DEMO_JOURNAL_ENTRIES: JournalEntryView[] = JOURNAL_SEEDS.map(journalEntry);

const DEMO_ALERTS: AlertView[] = [
  { id: "demo-alert-001", symbol: "EURUSD", condition: "below", level: 1.075, note: "Range support retest", status: "active", triggeredAt: null, triggeredPrice: null, lastPrice: 1.0846, lastCheckedAt: DEMO_GENERATED_AT, createdAt: isoAt(16, 8), updatedAt: DEMO_GENERATED_AT },
  { id: "demo-alert-002", symbol: "XAUUSD", condition: "above", level: 2700, note: "Breakout confirmation", status: "active", triggeredAt: null, triggeredPrice: null, lastPrice: 2649.4, lastCheckedAt: DEMO_GENERATED_AT, createdAt: isoAt(16, 10), updatedAt: DEMO_GENERATED_AT },
  { id: "demo-alert-003", symbol: "GBPUSD", condition: "below", level: 1.265, note: "Previous weekly low", status: "triggered", triggeredAt: isoAt(17, 6, 30), triggeredPrice: 1.2648, lastPrice: 1.2648, lastCheckedAt: isoAt(17, 6, 30), createdAt: isoAt(15, 9), updatedAt: isoAt(17, 6, 30) },
  { id: "demo-alert-004", symbol: "USDJPY", condition: "above", level: 151, note: "Paused until the next session", status: "paused", triggeredAt: null, triggeredPrice: null, lastPrice: 149.78, lastCheckedAt: isoAt(16, 21), createdAt: isoAt(14, 12), updatedAt: isoAt(16, 21) },
];

const DEMO_SESSIONS: BriefingSessionRow[] = [
  { key: "asia", label: "Asia", status: "closed", nextChange: "Opens in about 15 hours", nextChangeAt: isoAt(18, 23) },
  { key: "london", label: "London", status: "open", nextChange: "Closes in about 2 hours", nextChangeAt: isoAt(17, 12) },
  { key: "newyork", label: "New York", status: "closed", nextChange: "Opens in about 7 hours", nextChangeAt: isoAt(17, 13, 30) },
];

const DEMO_WATCHLIST: BriefingWatchlistRow[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", type: "forex", last: 1.0846, previousClose: 1.0819, changePct: 0.25, dayHigh: 1.0861, dayLow: 1.0802, barTime: isoAt(17, 8), quote: { price: 1.0846, at: DEMO_GENERATED_AT, source: "latest" } },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", type: "forex", last: 1.2759, previousClose: 1.2785, changePct: -0.2, dayHigh: 1.2798, dayLow: 1.2741, barTime: isoAt(17, 8), quote: { price: 1.2759, at: DEMO_GENERATED_AT, source: "latest" } },
  { symbol: "XAUUSD", name: "Gold / US Dollar", type: "metal", last: 2649.4, previousClose: 2631.8, changePct: 0.67, dayHigh: 2654.2, dayLow: 2627.5, barTime: isoAt(17, 8), quote: { price: 2649.4, at: DEMO_GENERATED_AT, source: "latest" } },
  { symbol: "US30", name: "US 30 Index", type: "index", last: 44208, previousClose: 44045, changePct: 0.37, dayHigh: 44310, dayLow: 43980, barTime: isoAt(17, 8), quote: { price: 44208, at: DEMO_GENERATED_AT, source: "latest" } },
];

export function demoCtraderAccount(): AccountView {
  return { ...DEMO_CTRADER_ACCOUNT };
}

export function demoPositions(): PositionRow[] {
  return DEMO_POSITIONS.map((row) => ({ ...row }));
}

export function demoOrders(): OrderRow[] {
  return DEMO_ORDERS.map((row) => ({ ...row }));
}

export function demoSymbols(): string[] {
  return Object.keys(DEMO_QUOTES).sort((a, b) => a.localeCompare(b));
}

export function demoQuote(symbol: string): { symbol: string; bid: number; ask: number; digits: number; time: number } | null {
  const quote = DEMO_QUOTES[String(symbol ?? "").trim().toUpperCase()];
  if (!quote) return null;
  return { symbol: String(symbol).trim().toUpperCase(), ...quote, time: Date.parse(DEMO_GENERATED_AT) };
}

export function demoHistory(days: number): OrderHistoryResult {
  const trades: OrderHistoryRow[] = DEMO_JOURNAL_ENTRIES.filter((entry) => entry.status === "closed").map((entry, index) => ({
    dealId: 720100 + index,
    orderId: 730100 + index,
    positionId: 740100 + index,
    symbol: entry.symbol,
    side: entry.side === "buy" ? "BUY" : "SELL",
    lots: entry.lots ?? 0,
    entryPrice: entry.entryPrice ?? 0,
    exitPrice: entry.exitPrice ?? 0,
    grossProfit: (entry.pnl ?? 0) + (entry.fees ?? 0),
    swap: 0,
    commission: -(entry.fees ?? 0),
    net: entry.pnl ?? 0,
    digits: DEMO_QUOTES[entry.symbol]?.digits ?? 2,
    closeTimestamp: Date.parse(entry.closedAt ?? DEMO_GENERATED_AT),
  }));
  return { trades, days, truncated: false };
}

export function demoJournalList(options: {
  status?: string;
  source?: string;
  symbol?: string;
  limit?: number;
  offset?: number;
} = {}): JournalListResponse {
  let entries = [...DEMO_JOURNAL_ENTRIES];
  if (options.status === "open" || options.status === "closed") {
    entries = entries.filter((entry) => entry.status === options.status);
  }
  if (options.source === "manual" || options.source === "ctrader") {
    entries = entries.filter((entry) => entry.source === options.source);
  }
  if (options.symbol) {
    const symbol = options.symbol.toUpperCase();
    entries = entries.filter((entry) => entry.symbol === symbol);
  }
  entries.sort((a, b) => {
    const left = Date.parse(a.closedAt ?? a.createdAt);
    const right = Date.parse(b.closedAt ?? b.createdAt);
    return right - left;
  });
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  return {
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
    stats: computeJournalStats(DEMO_JOURNAL_ENTRIES),
    lastSyncedAt: DEMO_GENERATED_AT,
  };
}

export function demoAlerts(): AlertListResponse {
  const alerts = DEMO_ALERTS.map((alert) => ({ ...alert }));
  return {
    alerts,
    counts: {
      active: alerts.filter((alert) => alert.status === "active").length,
      triggered: alerts.filter((alert) => alert.status === "triggered").length,
      paused: alerts.filter((alert) => alert.status === "paused").length,
      total: alerts.length,
    },
  };
}

export function demoBriefing(): BriefingResponse {
  const journalIdeas: BriefingJournalIdea[] = DEMO_JOURNAL_ENTRIES.filter((entry) => entry.status === "open").map((entry) => ({
    id: entry.id,
    symbol: entry.symbol,
    side: entry.side,
    entryPrice: entry.entryPrice,
    stop: entry.stop,
    target: entry.target,
    verified: entry.verified,
    openedAt: entry.openedAt,
    note: entry.note,
    quote: entry.symbol in DEMO_QUOTES
      ? { price: DEMO_QUOTES[entry.symbol].bid, at: DEMO_GENERATED_AT, source: "latest" }
      : null,
    toEntryPct: null,
    toStopPct: null,
    toTargetPct: null,
  }));
  const snapshot = {
    version: BRIEFING_SNAPSHOT_VERSION,
    dateKey: "2026-11-17",
    generatedAt: DEMO_GENERATED_AT,
    focusSessions: ["london", "newyork"] as BriefingSessionRow["key"][],
    sessions: DEMO_SESSIONS.map((row) => ({ ...row })),
    watchlist: DEMO_WATCHLIST.map((row) => ({ ...row, quote: row.quote ? { ...row.quote } : null })),
    signals: [],
    journalIdeas,
    dataNotes: ["Sample prices are frozen so the demo briefing never changes."],
  };
  return {
    aiReady: false,
    briefing: {
      dateKey: snapshot.dateKey,
      generatedAt: snapshot.generatedAt,
      model: null,
      narrative: null,
      sections: buildFallbackSections(snapshot),
      error: null,
      status: "ready",
      source: "deterministic",
      snapshot,
    },
    preferences: { focusSessions: ["london", "newyork"] },
  };
}

const DEMO_CLOSED = DEMO_JOURNAL_ENTRIES.filter((entry) => entry.status === "closed");
const DEMO_WEEK_RANGE = coachWeekRange(DEMO_WEEK_KEY)!;
const DEMO_WEEKLY_FACTS = buildWeeklyFacts(DEMO_WEEK_RANGE, DEMO_CLOSED);
const DEMO_WEEKLY_REPORT = {
  kind: "weekly" as const,
  key: DEMO_WEEK_KEY,
  periodStart: DEMO_WEEK_RANGE.periodStart,
  periodEnd: DEMO_WEEK_RANGE.periodEnd,
  generatedAt: DEMO_GENERATED_AT,
  model: null,
  error: null,
  facts: DEMO_WEEKLY_FACTS,
  sections: buildWeeklyFallbackSections(DEMO_WEEKLY_FACTS),
};

export function demoCoachWeekly(): CoachWeeklyResponse {
  const week = coachWeekInfo(DEMO_WEEK_KEY, DEMO_WEEKLY_FACTS.closedTrades)!;
  return {
    aiReady: false,
    week,
    weeks: [week],
    facts: DEMO_WEEKLY_FACTS,
    report: DEMO_WEEKLY_REPORT,
  };
}

export function demoCoachTrades(): CoachTradeListResponse {
  const trades: CoachTradeListItem[] = DEMO_CLOSED.slice(0, 12).map((entry) => ({
    id: entry.id,
    symbol: entry.symbol,
    side: entry.side,
    source: entry.source,
    verified: entry.verified,
    closedAt: entry.closedAt,
    pnl: entry.pnl,
    reviewed: Number(entry.id.slice(-3)) <= 3,
  }));
  return { aiReady: false, trades };
}

export function demoCoachTrade(entryId: string): CoachTradeResponse | null {
  const entry = DEMO_JOURNAL_ENTRIES.find((row) => row.id === entryId && row.status === "closed");
  if (!entry) return null;
  const facts = buildTradeFacts(entry);
  const report: CoachTradeReport = {
    kind: "trade",
    key: entry.id,
    periodStart: entry.openedAt,
    periodEnd: entry.closedAt,
    generatedAt: DEMO_GENERATED_AT,
    model: null,
    error: null,
    facts,
    sections: buildTradeFallbackSections(facts),
  };
  return { aiReady: false, facts, report };
}
