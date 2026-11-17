export type BrokerId = "ctrader" | "mt5";

export type BrokerMode = "demo" | "live";

export type BrokerSide = "BUY" | "SELL";

export interface BrokerAccountRef {
  userId: string;
  broker: BrokerId;
  accountId: string;
  mode: BrokerMode;
}

export interface BrokerAccountView {
  id: string;
  broker: BrokerId;
  login: string;
  name: string;
  mode: BrokerMode;
  balance: number | null;
  currency: string | null;
  nickname: string | null;
  color: string | null;
}

export interface BrokerSymbolSpec {
  symbol: string;
  lotSize: number;
  digits: number;
  minVolume: number;
  stepVolume: number;
  maxVolume: number;
  quoteAsset: string | null;
}

export interface BrokerSymbol {
  id: string;
  spec: BrokerSymbolSpec;
}

export interface BrokerQuote {
  symbol: string;
  bid: number;
  ask: number;
  digits: number;
  time: number;
}

export interface BrokerPosition {
  id: string;
  symbol: string;
  side: BrokerSide;
  lots: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  profitUsd: number | null;
  digits: number;
  openedAt: number | null;
}

export interface BrokerOrder {
  id: string;
  symbol: string;
  side: BrokerSide;
  type: string;
  price: number;
  lots: number;
  stopLoss: number | null;
  takeProfit: number | null;
  digits: number;
  expiresAt: number | null;
  expirationType: "GTC" | "GTD";
}

export interface BrokerReconciliation {
  positions: BrokerPosition[];
  orders: BrokerOrder[];
}

export interface BrokerHistoryTrade {
  id: string;
  orderId: string | null;
  positionId: string | null;
  symbol: string;
  side: BrokerSide;
  lots: number;
  entryPrice: number;
  exitPrice: number;
  grossProfit: number;
  swap: number;
  commission: number;
  net: number;
  digits: number;
  closedAt: number;
}

export interface BrokerHistoryResult {
  trades: BrokerHistoryTrade[];
  days: number;
  truncated: boolean;
}

export interface BrokerTimeframe {
  id: string;
  ms: number;
  maxRangeMs?: number;
  native?: Partial<Record<BrokerId, number | string | null>>;
}

export interface BrokerCandleQuery {
  symbol: string;
  timeframe: BrokerTimeframe;
  from?: number;
  to?: number;
  count?: number;
}

export interface BrokerCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BrokerTicket {
  symbol?: string;
  side?: string;
  type?: string;
  lots?: number;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  expiration?: number | null;
}

export interface BrokerOrderChanges {
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
}

export interface BrokerOrderResult {
  ok: boolean;
  error?: string;
  note?: string;
}

export interface BrokerOrderPreview {
  symbol: string;
  snapped: boolean;
  lots: number;
  minLots: number | null;
  lotStep: number | null;
  entryRef: number | null;
  riskUsd: number | null;
  rewardUsd: number | null;
  rr: number | null;
  warnings: string[];
}

export interface BrokerPreviewResult {
  ok: boolean;
  error?: string;
  preview?: BrokerOrderPreview;
}

export interface BrokerAdapter {
  readonly id: BrokerId;
  listAccounts(userId: string): Promise<BrokerAccountView[]>;
  reconcile(ref: BrokerAccountRef): Promise<BrokerReconciliation>;
  resolveSymbol(ref: BrokerAccountRef, symbol: string): Promise<BrokerSymbol | null>;
  listSymbolNames(ref: BrokerAccountRef): Promise<string[]>;
  quote(ref: BrokerAccountRef, symbol: string): Promise<BrokerQuote | null>;
  quoteUsdFactor(ref: BrokerAccountRef, symbol: string): Promise<number | null>;
  fetchHistory(ref: BrokerAccountRef, days: number): Promise<BrokerHistoryResult>;
  fetchCandles(ref: BrokerAccountRef, query: BrokerCandleQuery): Promise<BrokerCandle[]>;
  previewOrder(ref: BrokerAccountRef, ticket: BrokerTicket): Promise<BrokerPreviewResult>;
  placeOrder(ref: BrokerAccountRef, ticket: BrokerTicket): Promise<BrokerOrderResult>;
  modifyOrder(ref: BrokerAccountRef, orderId: string, changes: BrokerOrderChanges): Promise<BrokerOrderResult>;
  cancelOrder(ref: BrokerAccountRef, orderId: string): Promise<BrokerOrderResult>;
  closePosition(ref: BrokerAccountRef, positionId: string): Promise<BrokerOrderResult>;
  amendPositionSLTP(
    ref: BrokerAccountRef,
    positionId: string,
    sl: number | null,
    tp: number | null
  ): Promise<BrokerOrderResult>;
}
