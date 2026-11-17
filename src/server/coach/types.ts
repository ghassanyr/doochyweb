// Shared shapes for AI Coach.
//
// A report is a frozen snapshot of deterministic journal facts plus the prose
// written over those facts. Weekly reports use fixed UTC Monday-Sunday periods.
// Trade reports are keyed by journal entry id. The AI never receives broker
// credentials or account balances, only the journal fields shown here.

export const COACH_MIN_WEEKLY_TRADES = 5;
export const COACH_MAX_WEEKLY_TRADE_FACTS = 80;

export type CoachKind = "weekly" | "trade";
export type CoachSide = "buy" | "sell";
export type CoachOutcome = "win" | "loss" | "breakeven" | "unknown";
export type CoachExitVsPlan = "target" | "stop" | "inside_plan" | "unknown";

export interface CoachTradeFacts {
  id: string;
  symbol: string;
  side: CoachSide;
  source: "manual" | "ctrader" | "mt5";
  verified: boolean;
  accountLabel: string | null;
  openedAt: string | null;
  closedAt: string | null;
  holdingHours: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  stop: number | null;
  target: number | null;
  pnl: number | null;
  fees: number | null;
  outcome: CoachOutcome;
  realizedR: number | null;
  plannedRr: number | null;
  exitVsPlan: CoachExitVsPlan;
  strategy: string;
  tags: string[];
  note: string;
  missing: string[];
  caveats: string[];
}

export interface CoachBucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  totalR: number | null;
  avgR: number | null;
}

export interface CoachWeeklyFacts {
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  closedTrades: number;
  pricedTrades: number;
  verifiedTrades: number;
  manualTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  unknownOutcomes: number;
  winRate: number | null;
  netPnl: number;
  avgPnl: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  totalR: number | null;
  avgR: number | null;
  avgPlannedRr: number | null;
  maxDrawdown: number | null;
  longestLossStreak: number;
  largestWin: number | null;
  largestLoss: number | null;
  activeDays: number;
  avgTradesPerActiveDay: number | null;
  tradesWithNotes: number;
  planCompleteness: {
    entry: number;
    exit: number;
    stop: number;
    target: number;
    pnl: number;
  };
  bySymbol: CoachBucket[];
  bySide: CoachBucket[];
  byStrategy: CoachBucket[];
  byTag: CoachBucket[];
  byWeekday: CoachBucket[];
  tradesIncluded: number;
  tradesTotal: number;
  trades: CoachTradeFacts[];
  caveats: string[];
}

export interface CoachWeeklySections {
  summary: string;
  strengths: string[];
  watchouts: string[];
  patterns: string[];
  focus: string[];
}

export interface CoachTradeSections {
  summary: string;
  worked: string[];
  improve: string[];
  question: string;
}

export interface CoachWeekInfo {
  key: string;
  periodStart: string;
  periodEnd: string;
  closedTrades: number;
}

export interface CoachWeeklyReport {
  kind: "weekly";
  key: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  model: string | null;
  error: string | null;
  facts: CoachWeeklyFacts;
  sections: CoachWeeklySections;
}

export interface CoachTradeReport {
  kind: "trade";
  key: string;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string;
  model: string | null;
  error: string | null;
  facts: CoachTradeFacts;
  sections: CoachTradeSections;
}

export type CoachReport = CoachWeeklyReport | CoachTradeReport;

export interface CoachWeeklyResponse {
  aiReady: boolean;
  week: CoachWeekInfo;
  weeks: CoachWeekInfo[];
  facts: CoachWeeklyFacts;
  report: CoachWeeklyReport | null;
}

export interface CoachTradeListItem {
  id: string;
  symbol: string;
  side: CoachSide;
  source: "manual" | "ctrader" | "mt5";
  verified: boolean;
  closedAt: string | null;
  pnl: number | null;
  reviewed: boolean;
}

export interface CoachTradeListResponse {
  aiReady: boolean;
  trades: CoachTradeListItem[];
}

export interface CoachTradeResponse {
  aiReady: boolean;
  facts: CoachTradeFacts;
  report: CoachTradeReport | null;
}
