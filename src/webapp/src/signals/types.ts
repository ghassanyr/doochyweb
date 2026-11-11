// Client-side types for the Signals API. Mirrors src/server/signals/types.ts;
// admin identity fields are intentionally absent.

export type SignalDirection = "buy" | "sell";

// Prefill for a new signal created from a broker position or pending order.
// Timeframe, expiry and note are intentionally left to the admin.
export interface SignalDraft {
  symbol: string;
  direction: SignalDirection;
  entry: number | null;
  target: number | null;
  stop: number | null;
}

export type SignalStatus = "active" | "invalidated" | "expired" | "target_hit" | "stopped_out";

export interface SignalUpdate {
  at: string;
  note: string;
}

export interface Signal {
  id: string;
  symbol: string;
  direction: SignalDirection;
  entry: number | null;
  target: number;
  stop: number;
  timeframe: string | null;
  note: string;
  status: SignalStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  resolvedAt: string | null;
  resolution: "target_hit" | "stopped_out" | null;
  updates: SignalUpdate[];
}

export interface SignalCounts {
  active: number;
  invalidated: number;
  expired: number;
  targetHit: number;
  stoppedOut: number;
  total: number;
  history: number;
}

export interface SignalStats extends SignalCounts {
  resolved: number;
  winRate: number | null;
  avgR: number | null;
}

export interface SignalListResponse {
  signals: Signal[];
  total: number;
  counts: SignalCounts;
}

export interface PricePoint {
  price: number;
  at: string;
}
