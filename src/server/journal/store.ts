// Persistence for the personal Trade Journal.
//
// One document per entry, always scoped by userId. Imported cTrader rows carry
// a `dealId` and are protected by a unique (userId, dealId) index, so importing
// the same history twice can never duplicate a trade. Manual rows have a null
// dealId and are deliberately excluded from that index with a partial filter.

import mongoose from "mongoose";

import type {
  JournalEntryView,
  JournalImportResult,
  JournalInput,
  JournalListResponse,
  JournalStats,
} from "./types";
import { historyRowToJournal } from "./import";

const entrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, enum: ["manual", "ctrader"], required: true },
    dealId: { type: Number, default: null },
    accountCtid: { type: Number, default: null },
    accountLabel: { type: String, default: null },
    symbol: { type: String, required: true, index: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    lots: { type: Number, default: null },
    entryPrice: { type: Number, default: null },
    exitPrice: { type: Number, default: null },
    stop: { type: Number, default: null },
    target: { type: Number, default: null },
    pnl: { type: Number, default: null },
    fees: { type: Number, default: null },
    openedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    verified: { type: Boolean, default: false },
    strategy: { type: String, default: "" },
    tags: { type: [String], default: [] },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

entrySchema.index(
  { userId: 1, dealId: 1 },
  { unique: true, partialFilterExpression: { dealId: { $type: "number" } } }
);
entrySchema.index({ userId: 1, closedAt: -1 });
entrySchema.index({ userId: 1, createdAt: -1 });

export const JournalEntry = mongoose.model("JournalEntry", entrySchema);

export class JournalError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JournalError";
    this.status = status;
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toJournalView(doc: any): JournalEntryView {
  return {
    id: String(doc._id),
    source: doc.source,
    dealId: doc.dealId ?? null,
    accountCtid: doc.accountCtid ?? null,
    accountLabel: doc.accountLabel ?? null,
    symbol: doc.symbol,
    side: doc.side,
    lots: doc.lots ?? null,
    entryPrice: doc.entryPrice ?? null,
    exitPrice: doc.exitPrice ?? null,
    stop: doc.stop ?? null,
    target: doc.target ?? null,
    pnl: doc.pnl ?? null,
    fees: doc.fees ?? null,
    openedAt: iso(doc.openedAt),
    closedAt: iso(doc.closedAt),
    status: doc.status,
    verified: Boolean(doc.verified),
    strategy: doc.strategy ?? "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    note: doc.note ?? "",
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(doc.updatedAt) ?? new Date(0).toISOString(),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stats over every entry the user owns. */
export function computeJournalStats(entries: JournalEntryView[]): JournalStats {
  const closed = entries.filter((entry) => entry.status === "closed");
  const priced = closed.filter((entry) => entry.pnl != null);
  const wins = priced.filter((entry) => (entry.pnl as number) > 0);
  const losses = priced.filter((entry) => (entry.pnl as number) < 0);
  const grossProfit = wins.reduce((sum, entry) => sum + (entry.pnl as number), 0);
  const grossLoss = Math.abs(losses.reduce((sum, entry) => sum + (entry.pnl as number), 0));
  const totalPnl = priced.reduce((sum, entry) => sum + (entry.pnl as number), 0);
  const decided = wins.length + losses.length;

  return {
    total: entries.length,
    open: entries.filter((entry) => entry.status === "open").length,
    closed: closed.length,
    verified: entries.filter((entry) => entry.verified).length,
    manual: entries.filter((entry) => entry.source === "manual").length,
    wins: wins.length,
    losses: losses.length,
    winRate: decided ? wins.length / decided : null,
    avgPnl: priced.length ? round(totalPnl / priced.length) : null,
    totalPnl: round(totalPnl),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    bestPnl: priced.length ? round(Math.max(...priced.map((entry) => entry.pnl as number))) : null,
    worstPnl: priced.length ? round(Math.min(...priced.map((entry) => entry.pnl as number))) : null,
  };
}

function ownerFilter(userId: string): Record<string, unknown> {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

export async function listJournal(
  userId: string,
  options: { status?: string; source?: string; symbol?: string; limit?: number; offset?: number } = {}
): Promise<JournalListResponse> {
  const filter = ownerFilter(userId);
  if (options.status === "open" || options.status === "closed") filter.status = options.status;
  if (options.source === "manual" || options.source === "ctrader") filter.source = options.source;
  if (options.symbol) filter.symbol = options.symbol.toUpperCase();

  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  const [docs, total, all] = await Promise.all([
    JournalEntry.find(filter)
      .sort({ closedAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
      .exec(),
    JournalEntry.countDocuments(filter).exec(),
    JournalEntry.find(ownerFilter(userId)).lean().exec(),
  ]);

  return {
    entries: docs.map(toJournalView),
    total,
    stats: computeJournalStats(all.map(toJournalView)),
  };
}

export async function createJournalEntry(
  userId: string,
  input: JournalInput
): Promise<JournalEntryView> {
  const doc = await JournalEntry.create({
    ...ownerFilter(userId),
    ...input,
    source: "manual",
    dealId: null,
    accountCtid: null,
    accountLabel: null,
    verified: false,
  });
  return toJournalView(doc.toObject());
}

export async function updateJournalEntry(
  userId: string,
  id: string,
  input: JournalInput
): Promise<JournalEntryView> {
  if (!mongoose.isValidObjectId(id)) throw new JournalError(404, "journal entry not found");
  const doc = await JournalEntry.findOne({ _id: id, ...ownerFilter(userId) }).exec();
  if (!doc) throw new JournalError(404, "journal entry not found");

  doc.symbol = input.symbol;
  doc.side = input.side;
  doc.lots = input.lots;
  doc.entryPrice = input.entryPrice;
  doc.exitPrice = input.exitPrice;
  doc.stop = input.stop;
  doc.target = input.target;
  doc.pnl = input.pnl;
  doc.fees = input.fees;
  doc.openedAt = input.openedAt;
  doc.closedAt = input.closedAt;
  doc.status = input.status;
  doc.strategy = input.strategy;
  doc.tags = input.tags;
  doc.note = input.note;
  await doc.save();
  return toJournalView(doc.toObject());
}

export async function deleteJournalEntry(userId: string, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new JournalError(404, "journal entry not found");
  const result = await JournalEntry.deleteOne({ _id: id, ...ownerFilter(userId) }).exec();
  if (!result.deletedCount) throw new JournalError(404, "journal entry not found");
}

/**
 * Import closed cTrader deals for one account. Idempotent: the unique
 * (userId, dealId) index means a second run only counts skipped rows.
 */
export async function importCtraderHistory(
  userId: string,
  ctid: number,
  days: number
): Promise<JournalImportResult> {
  const [{ loadCredentials }, { fetchOrderHistory }] = await Promise.all([
    import("../db"),
    import("../ctrader/history"),
  ]);

  const creds = await loadCredentials(userId);
  const account = creds?.accounts.find((item) => item.ctid === ctid);
  if (!account) throw new JournalError(404, "account not found");

  const accountLabel = account.nickname || account.broker || `Account ${ctid}`;
  const history = await fetchOrderHistory(userId, ctid, account.isLive, days);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  let imported = 0;
  for (const row of history.trades) {
    if (!row.dealId) continue;
    const result = await JournalEntry.updateOne(
      { userId: userObjectId, dealId: row.dealId },
      { $setOnInsert: historyRowToJournal(row, { ctid, label: accountLabel }) },
      { upsert: true }
    ).exec();
    if (result.upsertedCount) imported++;
  }

  return {
    imported,
    skipped: history.trades.length - imported,
    total: history.trades.length,
    accountLabel,
  };
}
