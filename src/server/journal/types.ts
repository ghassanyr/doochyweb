// Shared shapes for the personal Trade Journal.
//
// A journal entry is either typed by hand (`manual`, self-reported P&L) or
// imported from cTrader closed-deal history (`ctrader`, verified P&L). The
// browser never sees the owner id: every route is scoped to the session user.

export type JournalSource = "manual" | "ctrader";
export type JournalSide = "buy" | "sell";
export type JournalStatus = "open" | "closed";

export interface JournalEntryView {
  id: string;
  source: JournalSource;
  dealId: number | null;
  accountCtid: number | null;
  accountLabel: string | null;
  symbol: string;
  side: JournalSide;
  lots: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  stop: number | null;
  target: number | null;
  pnl: number | null;
  fees: number | null;
  openedAt: string | null;
  closedAt: string | null;
  status: JournalStatus;
  verified: boolean;
  strategy: string;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalStats {
  total: number;
  open: number;
  closed: number;
  verified: number;
  manual: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgPnl: number | null;
  totalPnl: number;
  profitFactor: number | null;
  bestPnl: number | null;
  worstPnl: number | null;
}

export interface JournalListResponse {
  entries: JournalEntryView[];
  total: number;
  stats: JournalStats;
}

/** Normalized fields accepted by create/update. */
export interface JournalInput {
  symbol: string;
  side: JournalSide;
  lots: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  stop: number | null;
  target: number | null;
  pnl: number | null;
  fees: number | null;
  openedAt: Date | null;
  closedAt: Date | null;
  status: JournalStatus;
  strategy: string;
  tags: string[];
  note: string;
}

export interface JournalImportResult {
  imported: number;
  skipped: number;
  total: number;
  accountLabel: string;
}
