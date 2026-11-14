// Shared shapes for paper trading.
//
// A paper position is sized in notional USD rather than lots: the same number
// then means the same thing on an FX pair, an index and a crypto pair, and the
// P&L needs no per-symbol contract specification. The book starts at 100,000 and
// only records realised P&L; equity is that plus any open profit.

export type PaperSide = "buy" | "sell";
export type PaperStatus = "open" | "closed";
export type PaperCloseReason = "manual" | "stop" | "target";

export interface PaperPositionView {
  id: string;
  symbol: string;
  side: PaperSide;
  /** Position size in USD. P&L is the percentage move times this. */
  notional: number;
  entryPrice: number;
  stop: number | null;
  target: number | null;
  /** Set once the position is closed. */
  exitPrice: number | null;
  pnl: number | null;
  status: PaperStatus;
  closeReason: PaperCloseReason | null;
  /** Last price the checker saw, used for the open row's live P&L. */
  lastPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
}

export interface PaperAccountView {
  startBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  openCount: number;
  closedCount: number;
  /** Sum of notional across open positions. */
  exposure: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface PaperListResponse {
  account: PaperAccountView;
  open: PaperPositionView[];
  closed: PaperPositionView[];
}

/** Normalized input after validation. */
export interface PaperInput {
  symbol: string;
  side: PaperSide;
  notional: number;
  stop: number | null;
  target: number | null;
}
