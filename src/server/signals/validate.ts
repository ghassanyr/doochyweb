// Pure validation and derived-value helpers for Signals. No database or Express
// imports here, so the rules can be unit tested in isolation.

import { normalizeSymbol } from "../market/symbols";
import { isTimeframeId } from "../market/timeframes";
import type { SignalDirection, SignalInput, SignalStatus } from "./types";

export type ValidationResult = { ok: true; value: SignalInput } | { ok: false; error: string };

const MAX_NOTE = 2000;
const MAX_SYMBOL = 24;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate and normalize a create/update payload.
 *
 * `requireFutureExpiry` is true on create: a signal that is already expired at
 * publish time is almost certainly a mistake. Edits may keep a past expiry so an
 * admin can correct other fields without being forced to clear it first.
 */
export function validateSignalInput(
  raw: unknown,
  { now = new Date(), requireFutureExpiry = false }: { now?: Date; requireFutureExpiry?: boolean } = {}
): ValidationResult {
  const body = (raw ?? {}) as Record<string, unknown>;

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol) return { ok: false, error: "symbol is required" };
  if (symbol.length > MAX_SYMBOL) return { ok: false, error: "symbol is too long" };

  const direction = asText(body.direction).toLowerCase();
  if (direction !== "buy" && direction !== "sell") {
    return { ok: false, error: "direction must be buy or sell" };
  }

  const target = asNumber(body.target);
  if (target === null || target <= 0) return { ok: false, error: "target must be a positive number" };
  const stop = asNumber(body.stop);
  if (stop === null || stop <= 0) return { ok: false, error: "stop must be a positive number" };
  if (target === stop) return { ok: false, error: "target and stop must be different" };

  const entry = asNumber(body.entry);
  if (entry !== null && entry <= 0) return { ok: false, error: "entry must be a positive number" };
  if (entry !== null) {
    if (direction === "buy" && !(stop < entry && entry < target)) {
      return { ok: false, error: "for a buy, stop must be below entry and entry below target" };
    }
    if (direction === "sell" && !(target < entry && entry < stop)) {
      return { ok: false, error: "for a sell, target must be below entry and entry below stop" };
    }
  }

  const timeframeRaw = asText(body.timeframe);
  const timeframe = timeframeRaw ? timeframeRaw : null;
  if (timeframe && !isTimeframeId(timeframe)) {
    return { ok: false, error: "unknown timeframe" };
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_NOTE) return { ok: false, error: `note must be ${MAX_NOTE} characters or fewer` };

  let expiresAt: Date | null = null;
  if (body.expiresAt !== null && body.expiresAt !== undefined && body.expiresAt !== "") {
    const parsed = new Date(String(body.expiresAt));
    if (!Number.isFinite(parsed.getTime())) return { ok: false, error: "expiry is not a valid date" };
    if (requireFutureExpiry && parsed.getTime() <= now.getTime()) {
      return { ok: false, error: "expiry must be in the future" };
    }
    expiresAt = parsed;
  }

  return {
    ok: true,
    value: { symbol, direction: direction as SignalDirection, entry, target, stop, timeframe, note, expiresAt },
  };
}

/** Reward-to-risk from entry. Null when entry is missing or risk is zero. */
export function computeRR(
  entry: number | null | undefined,
  target: number | null | undefined,
  stop: number | null | undefined
): number | null {
  if (entry == null || target == null || stop == null) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!(risk > 0) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

export function isExpired(status: SignalStatus, expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (status !== "active" || !expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
}

export function canEdit(status: SignalStatus): boolean {
  return status === "active";
}

export function canInvalidate(status: SignalStatus): boolean {
  return status === "active";
}

export function canRestore(status: SignalStatus): boolean {
  return status === "invalidated";
}

/** Non-active signals live in the History tab. */
export function isHistoryStatus(status: SignalStatus): boolean {
  return status !== "active";
}
