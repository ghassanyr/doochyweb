// Shared types for the public Signals feed.
//
// A Signal is a curated trade idea published by an admin. The server stores the
// acting admin on create/update/invalidate for accountability, but those fields
// are deliberately absent from SignalView: cards never reveal who posted.

export type SignalDirection = "buy" | "sell";

/** `target_hit` / `stopped_out` are reserved for the automatic resolver. */
export type SignalStatus = "active" | "invalidated" | "expired" | "target_hit" | "stopped_out";

export type SignalResolution = "target_hit" | "stopped_out" | null;

export interface SignalUpdate {
  at: string;
  note: string;
}

/** The public shape sent to the browser. No admin identity, ever. */
export interface SignalView {
  id: string;
  symbol: string;
  direction: SignalDirection;
  entry: number | null;
  /** Upper bound when `entry` describes a range; null for a single entry. */
  entryMax: number | null;
  /** TP1 (also drives automatic outcome resolution). */
  target: number;
  /** Optional TP2 / TP3 beyond TP1. */
  target2: number | null;
  target3: number | null;
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
  resolution: SignalResolution;
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
  signals: SignalView[];
  total: number;
  counts: SignalCounts;
}

/** Aggregate record for one slice (overall, symbol, direction or month). */
export interface PerformanceBucket {
  key: string;
  label: string;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  profitFactor: number | null;
}

/** One resolved signal on the cumulative R curve. */
export interface PerformancePoint {
  id: string;
  symbol: string;
  direction: SignalDirection;
  status: "target_hit" | "stopped_out";
  at: string;
  r: number;
  cumulativeR: number;
}

export interface SignalPerformance {
  overall: PerformanceBucket;
  bySymbol: PerformanceBucket[];
  byDirection: PerformanceBucket[];
  byMonth: PerformanceBucket[];
  curve: PerformancePoint[];
  updatedAt: string;
}

/** Minimal resolved-signal row the pure aggregation needs. */
export interface ResolvedSignalRow {
  id: string;
  symbol: string;
  direction: SignalDirection;
  status: "target_hit" | "stopped_out";
  resolvedAt: string;
  entry: number | null;
  entryMax: number | null;
  target: number;
  stop: number;
}

/** Normalized input after validation. */
export interface SignalInput {
  symbol: string;
  direction: SignalDirection;
  entry: number | null;
  /** Upper bound when `entry` describes a range; null for a single entry. */
  entryMax: number | null;
  /** TP1 (also drives automatic outcome resolution). */
  target: number;
  /** Optional TP2 / TP3 beyond TP1. */
  target2: number | null;
  target3: number | null;
  stop: number;
  timeframe: string | null;
  note: string;
  expiresAt: Date | null;
}
