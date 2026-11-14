// Pure validation for price alerts.

import { normalizeSymbol } from "../market/symbols";
import type { AlertCondition, AlertInput, AlertStatus } from "./types";

export type AlertValidation =
  | { ok: true; value: AlertInput }
  | { ok: false; error: string };

const MAX_NOTE = 500;
const MAX_SYMBOL = 24;

export function validateAlertInput(body: unknown): AlertValidation {
  const source = (body ?? {}) as Record<string, unknown>;

  const symbol = normalizeSymbol(source.symbol).slice(0, MAX_SYMBOL);
  if (!symbol) return { ok: false, error: "symbol is required" };

  const rawCondition = String(source.condition ?? "").trim().toLowerCase();
  if (rawCondition !== "above" && rawCondition !== "below") {
    return { ok: false, error: "condition must be above or below" };
  }
  const condition = rawCondition as AlertCondition;

  const level = Number(source.level);
  if (!Number.isFinite(level) || level <= 0) {
    return { ok: false, error: "level must be a positive number" };
  }

  const rawStatus = String(source.status ?? "").trim().toLowerCase();
  const status: AlertStatus =
    rawStatus === "active" || rawStatus === "triggered" || rawStatus === "paused"
      ? (rawStatus as AlertStatus)
      : "active";

  const note = typeof source.note === "string" ? source.note.trim().slice(0, MAX_NOTE) : "";

  return { ok: true, value: { symbol, condition, level, note, status } };
}

/** True when `price` satisfies the alert's condition. */
export function conditionMet(
  condition: AlertCondition,
  level: number,
  price: number
): boolean {
  if (!Number.isFinite(price)) return false;
  return condition === "above" ? price >= level : price <= level;
}
