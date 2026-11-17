// Pure rules for paper trading: input validation, P&L, and when an open
// position should close. Kept free of MongoDB so the maths is unit-testable.

import { normalizeSymbol } from "../market/symbols";
import type { PaperAccountView, PaperInput, PaperPositionView, PaperSide } from "./types";

export const PAPER_START_BALANCE = 100_000;
export const MAX_NOTIONAL = 1_000_000;
export const MAX_LOTS = 10_000;

export type PaperValidation =
  | { ok: true; value: PaperInput }
  | { ok: false; error: string };

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validatePaperInput(body: unknown): PaperValidation {
  const source = (body ?? {}) as Record<string, unknown>;

  const symbol = normalizeSymbol(source.symbol).slice(0, 24);
  if (!symbol) return { ok: false, error: "symbol is required" };

  const rawSide = String(source.side ?? "").trim().toLowerCase();
  if (rawSide !== "buy" && rawSide !== "sell") {
    return { ok: false, error: "side must be buy or sell" };
  }
  const side = rawSide as PaperSide;

  const inferredMode = source.notional != null && source.lots == null ? "usd" : "lots";
  const rawMode = String(source.sizeMode ?? inferredMode).trim().toLowerCase();
  if (rawMode !== "usd" && rawMode !== "lots") {
    return { ok: false, error: "size mode must be usd or lots" };
  }
  const sizeMode = rawMode as PaperInput["sizeMode"];

  let notional: number | null = null;
  let lots: number | null = null;
  if (sizeMode === "usd") {
    notional = asNumber(source.notional);
    if (notional == null || notional <= 0) {
      return { ok: false, error: "size must be a positive USD amount" };
    }
    if (notional > MAX_NOTIONAL) {
      return { ok: false, error: `size cannot exceed ${MAX_NOTIONAL.toLocaleString("en-US")} USD` };
    }
  } else {
    lots = asNumber(source.lots);
    if (lots == null || lots <= 0) {
      return { ok: false, error: "size must be a positive lot amount" };
    }
    if (lots > MAX_LOTS) {
      return { ok: false, error: `size cannot exceed ${MAX_LOTS.toLocaleString("en-US")} lots` };
    }
  }

  const stop = asNumber(source.stop);
  if (stop != null && stop <= 0) return { ok: false, error: "stop must be a positive price" };
  const target = asNumber(source.target);
  if (target != null && target <= 0) {
    return { ok: false, error: "target must be a positive price" };
  }

  return { ok: true, value: { symbol, side, sizeMode, notional, lots, stop, target } };
}

/**
 * Levels relative to the entry the server actually filled at. A buy needs its
 * stop below and target above; a sell is the mirror image.
 */
export function levelError(
  input: Pick<PaperInput, "side" | "stop" | "target">,
  entry: number
): string | null {
  if (!(entry > 0)) return "entry price is unavailable";
  if (input.side === "buy") {
    if (input.stop != null && !(input.stop < entry)) return "for a buy, the stop must be below the entry";
    if (input.target != null && !(input.target > entry)) {
      return "for a buy, the target must be above the entry";
    }
  } else {
    if (input.stop != null && !(input.stop > entry)) {
      return "for a sell, the stop must be above the entry";
    }
    if (input.target != null && !(input.target < entry)) {
      return "for a sell, the target must be below the entry";
    }
  }
  return null;
}

/** Percentage move times notional, signed by side. */
export function paperPnl(
  side: PaperSide,
  notional: number,
  entry: number,
  exit: number
): number {
  if (!(entry > 0) || !Number.isFinite(exit)) return 0;
  const move = (exit - entry) / entry;
  const signed = side === "buy" ? move : -move;
  return Math.round(notional * signed * 100) / 100;
}

export function paperLotPnl(
  side: PaperSide,
  volume: number,
  quoteUsdFactor: number | null,
  entry: number,
  exit: number
): number {
  if (!(entry > 0) || !Number.isFinite(exit) || !(volume > 0)) return 0;
  const diff = side === "buy" ? exit - entry : entry - exit;
  return round(diff * (volume / 100) * (quoteUsdFactor ?? 1));
}

type PnlRow = Pick<PaperPositionView, "side" | "sizeMode" | "notional" | "volume" | "spec">;

export function paperPnlFor(row: PnlRow, entry: number, exit: number): number {
  if (row.sizeMode === "lots" && row.volume != null && row.spec) {
    return paperLotPnl(row.side, row.volume, row.spec.quoteUsdFactor, entry, exit);
  }
  return paperPnl(row.side, row.notional, entry, exit);
}

/**
 * Which level the last price reached. The stop is checked first so a bar that
 * spans both levels is treated as the loss, never the win.
 */
/**
 * Book summary. `prices` supplies a fresh mark for open positions; without one
 * the last price the checker saw is used, so the number never goes blank.
 */
export function computePaperAccount(
  positions: PaperPositionView[],
  prices: Record<string, number> = {}
): PaperAccountView {
  const closed = positions.filter((row) => row.status === "closed");
  const open = positions.filter((row) => row.status === "open");

  const realizedPnl = round(
    closed.reduce((sum, row) => sum + (row.pnl ?? 0), 0)
  );
  let unrealizedPnl = 0;
  for (const row of open) {
    const mark = prices[row.symbol] ?? row.lastPrice;
    if (mark == null || !Number.isFinite(mark)) continue;
    unrealizedPnl += paperPnlFor(row, row.entryPrice, mark);
  }
  unrealizedPnl = round(unrealizedPnl);

  const wins = closed.filter((row) => (row.pnl ?? 0) > 0).length;
  const losses = closed.filter((row) => (row.pnl ?? 0) < 0).length;

  return {
    startBalance: PAPER_START_BALANCE,
    realizedPnl,
    unrealizedPnl,
    equity: round(PAPER_START_BALANCE + realizedPnl + unrealizedPnl),
    openCount: open.length,
    closedCount: closed.length,
    exposure: round(open.reduce((sum, row) => sum + row.notional, 0)),
    wins,
    losses,
    winRate: wins + losses ? wins / (wins + losses) : null,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function closeDecision(
  position: { side: PaperSide; stop: number | null; target: number | null },
  price: number
): { reason: "stop" | "target"; price: number } | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const { side, stop, target } = position;

  if (stop != null) {
    const hit = side === "buy" ? price <= stop : price >= stop;
    if (hit) return { reason: "stop", price: stop };
  }
  if (target != null) {
    const hit = side === "buy" ? price >= target : price <= target;
    if (hit) return { reason: "target", price: target };
  }
  return null;
}
