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

/** Normalized input after validation. */
export interface SignalInput {
  symbol: string;
  direction: SignalDirection;
  entry: number | null;
  /** Upper bound when `entry` describes a range; null for a single entry. */
  entryMax: number | null;
  target: number;
  stop: number;
  timeframe: string | null;
  note: string;
  expiresAt: Date | null;
}
