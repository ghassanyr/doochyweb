// Shared shapes for personal price alerts.
//
// Alerts are per-user and checked in-process against the same market price
// cache the Analysis page uses. A trigger is a one-way transition from active
// to triggered; the row keeps the price that fired it.

export type AlertCondition = "above" | "below";
export type AlertStatus = "active" | "triggered" | "paused";

export interface AlertView {
  id: string;
  symbol: string;
  condition: AlertCondition;
  level: number;
  note: string;
  status: AlertStatus;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  lastPrice: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertCounts {
  active: number;
  triggered: number;
  paused: number;
  total: number;
}

export interface AlertListResponse {
  alerts: AlertView[];
  counts: AlertCounts;
}

/** Normalized input accepted by create/update. */
export interface AlertInput {
  symbol: string;
  condition: AlertCondition;
  level: number;
  note: string;
  status: AlertStatus;
}
