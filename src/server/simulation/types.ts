// Shared shapes for paper trading.
//
// A paper position is sized either in USD notional or, when a connected cTrader
// account supplies contract specs, in lots. The book starts at 100,000 and only
// records realised P&L; equity is that plus any open profit.

export type PaperSide = "buy" | "sell";
export type PaperStatus = "open" | "closed";
export type PaperCloseReason = "manual" | "stop" | "target";
export type PaperSizeMode = "usd" | "lots";

export interface PaperLotSpecSnapshot {
  symbolId: number;
  brokerSymbol: string;
  lotSize: number;
  minVolume: number;
  stepVolume: number;
  maxVolume: number;
  quoteAsset: string | null;
  digits: number;
  quoteUsdFactor: number | null;
  ctid: number;
  isLive: boolean;
}

export interface PaperPositionView {
  id: string;
  symbol: string;
  side: PaperSide;
  sizeMode: PaperSizeMode;
  notional: number;
  lots: number | null;
  volume: number | null;
  spec: PaperLotSpecSnapshot | null;
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
  sizeMode: PaperSizeMode;
  notional: number | null;
  lots: number | null;
  ctid: number | null;
  stop: number | null;
  target: number | null;
}
