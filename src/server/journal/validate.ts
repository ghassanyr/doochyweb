// Pure validation for journal entries and CSV rendering.
//
// Manual entries are self-reported, so the rules are permissive: only the
// symbol, side and status are required. Every number that is present must be
// finite and non-negative where a negative value would be nonsense (lots,
// prices). P&L may be negative, which is the whole point of a journal.

import { normalizeSymbol } from "../market/symbols";
import type { JournalInput, JournalSide, JournalStatus } from "./types";

export type JournalValidation =
  | { ok: true; value: JournalInput }
  | { ok: false; error: string };

const MAX_NOTE = 2000;
const MAX_SYMBOL = 24;
const MAX_STRATEGY = 40;
const MAX_TAGS = 10;
const MAX_TAG = 24;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const tag = asText(entry).slice(0, MAX_TAG);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

function priceOrNull(value: unknown, field: string): number | null | string {
  const n = asNumber(value);
  if (n == null) return null;
  if (n < 0) return `${field} cannot be negative`;
  return n;
}

export function validateJournalInput(body: unknown): JournalValidation {
  const source = (body ?? {}) as Record<string, unknown>;

  const symbol = normalizeSymbol(source.symbol).slice(0, MAX_SYMBOL);
  if (!symbol) return { ok: false, error: "symbol is required" };

  const rawSide = asText(source.side).toLowerCase();
  if (rawSide !== "buy" && rawSide !== "sell") {
    return { ok: false, error: "side must be buy or sell" };
  }
  const side = rawSide as JournalSide;

  const rawStatus = asText(source.status).toLowerCase();
  const status: JournalStatus =
    rawStatus === "open" || rawStatus === "closed"
      ? (rawStatus as JournalStatus)
      : asDate(source.closedAt) || asNumber(source.pnl) != null
        ? "closed"
        : "open";

  const lots = priceOrNull(source.lots, "lots");
  if (typeof lots === "string") return { ok: false, error: lots };
  const entryPrice = priceOrNull(source.entryPrice, "entry price");
  if (typeof entryPrice === "string") return { ok: false, error: entryPrice };
  const exitPrice = priceOrNull(source.exitPrice, "exit price");
  if (typeof exitPrice === "string") return { ok: false, error: exitPrice };
  const stop = priceOrNull(source.stop, "stop");
  if (typeof stop === "string") return { ok: false, error: stop };
  const target = priceOrNull(source.target, "target");
  if (typeof target === "string") return { ok: false, error: target };
  const fees = priceOrNull(source.fees, "fees");
  if (typeof fees === "string") return { ok: false, error: fees };

  const pnl = asNumber(source.pnl);

  const note = asText(source.note).slice(0, MAX_NOTE);
  const strategy = asText(source.strategy).slice(0, MAX_STRATEGY);
  const tags = asTags(source.tags);

  let openedAt = asDate(source.openedAt);
  let closedAt = asDate(source.closedAt);
  if (status === "open") closedAt = null;

  return {
    ok: true,
    value: {
      symbol,
      side,
      lots: lots as number | null,
      entryPrice: entryPrice as number | null,
      exitPrice: exitPrice as number | null,
      stop: stop as number | null,
      target: target as number | null,
      pnl,
      fees: fees as number | null,
      openedAt,
      closedAt,
      status,
      strategy,
      tags,
      note,
    },
  };
}

/** Escape one CSV field: quote it when it contains a comma, quote or newline. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  "id",
  "source",
  "symbol",
  "side",
  "lots",
  "entryPrice",
  "exitPrice",
  "stop",
  "target",
  "pnl",
  "fees",
  "openedAt",
  "closedAt",
  "status",
  "verified",
  "strategy",
  "tags",
  "note",
] as const;

/** Render journal rows as CSV with a header row. */
export function journalCsv(rows: Record<string, unknown>[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((column) => {
        const value = row[column];
        return csvField(Array.isArray(value) ? value.join("|") : value);
      }).join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
