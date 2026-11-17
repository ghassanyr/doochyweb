// Persistence for the personal Trade Journal.
//
// One document per entry, always scoped by userId. Imported cTrader rows carry
// a `dealId` and are protected by a unique (userId, dealId) index, so importing
// the same history twice can never duplicate a trade. Manual rows have a null
// dealId and are deliberately excluded from that index with a partial filter.

import mongoose from "mongoose";

import { briefingDateKey } from "../briefing/build";
import { clearBriefing } from "../briefing/store";
import { clearCoachTrade, clearCoachWeeks } from "../coach/store";
import { coachWeekKey } from "../coach/weeks";
import type {
  JournalEntryView,
  JournalImportResult,
  JournalInput,
  JournalListResponse,
  JournalStats,
} from "./types";
import { historyRowToJournal, mt5HistoryToJournal } from "./import";

const entrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, enum: ["manual", "ctrader", "mt5"], required: true },
    broker: { type: String, enum: ["ctrader", "mt5"], default: null },
    accountId: { type: String, default: null },
    externalId: { type: String, default: null },
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
entrySchema.index(
  { userId: 1, broker: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }
);
entrySchema.index({ userId: 1, closedAt: -1 });
entrySchema.index({ userId: 1, createdAt: -1 });

export const JournalEntry = mongoose.model("JournalEntry", entrySchema);

// One row per user recording the last automatic cTrader import, so the tab can
// say when it last synced and the scheduler can back off after a failure.
const syncSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    lastRunAt: { type: Date, default: null },
    lastImported: { type: Number, default: 0 },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

export const JournalSync = mongoose.model("JournalSync", syncSchema);

export class JournalError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JournalError";
    this.status = status;
  }
}

async function invalidateBriefing(userId: string): Promise<void> {
  try {
    await clearBriefing(userId, briefingDateKey(new Date()));
  } catch {
    // The brief is regenerated on the next read if this fails.
  }
}

function closedWeekKey(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? coachWeekKey(date) : null;
}

async function invalidateCoachForEntry(
  userId: string,
  entryId: string,
  closedAts: unknown[] = []
): Promise<void> {
  try {
    await clearCoachTrade(userId, entryId);
    const weeks = [...new Set(closedAts.map(closedWeekKey).filter((key): key is string => Boolean(key)))];
    if (weeks.length) await clearCoachWeeks(userId, weeks);
  } catch {
    // Reports stay readable; the member can regenerate after a transient error.
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
    broker: doc.broker ?? null,
    accountId: doc.accountId ?? null,
    externalId: doc.externalId ?? null,
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

  const [docs, total, all, sync] = await Promise.all([
    JournalEntry.find(filter)
      .sort({ closedAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
      .exec(),
    JournalEntry.countDocuments(filter).exec(),
    JournalEntry.find(ownerFilter(userId)).lean().exec(),
    JournalSync.findOne(ownerFilter(userId)).lean().exec(),
  ]);

  return {
    entries: docs.map(toJournalView),
    total,
    stats: computeJournalStats(all.map(toJournalView)),
    lastSyncedAt: iso((sync as any)?.lastRunAt ?? null),
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
  const view = toJournalView(doc.toObject());
  await invalidateBriefing(userId);
  await invalidateCoachForEntry(userId, view.id, [view.closedAt]);
  return view;
}

export async function updateJournalEntry(
  userId: string,
  id: string,
  input: JournalInput
): Promise<JournalEntryView> {
  if (!mongoose.isValidObjectId(id)) throw new JournalError(404, "journal entry not found");
  const doc = await JournalEntry.findOne({ _id: id, ...ownerFilter(userId) }).exec();
  if (!doc) throw new JournalError(404, "journal entry not found");
  const previousClosedAt = doc.closedAt ?? null;

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
  const view = toJournalView(doc.toObject());
  await invalidateBriefing(userId);
  await invalidateCoachForEntry(userId, view.id, [previousClosedAt, view.closedAt]);
  return view;
}

/** Replace only the note. Used by the row action, which leaves broker data alone. */
export async function updateJournalNote(
  userId: string,
  id: string,
  note: string
): Promise<JournalEntryView> {
  if (!mongoose.isValidObjectId(id)) throw new JournalError(404, "journal entry not found");
  const doc = await JournalEntry.findOne({ _id: id, ...ownerFilter(userId) }).exec();
  if (!doc) throw new JournalError(404, "journal entry not found");
  doc.note = note;
  await doc.save();
  const view = toJournalView(doc.toObject());
  await invalidateBriefing(userId);
  await invalidateCoachForEntry(userId, view.id, [view.closedAt]);
  return view;
}

/** When this user's journal last imported from the broker. */
export async function readSyncState(userId: string): Promise<Date | null> {
  const doc = await JournalSync.findOne(ownerFilter(userId))
    .select({ lastRunAt: 1 })
    .lean()
    .exec();
  const at = (doc as any)?.lastRunAt;
  if (!at) return null;
  const date = at instanceof Date ? at : new Date(String(at));
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Record the outcome of one automatic import for a user. */
export async function recordSync(
  userId: string,
  params: { at: Date; imported: number; error?: string | null }
): Promise<void> {
  await JournalSync.updateOne(
    ownerFilter(userId),
    {
      $set: {
        lastRunAt: params.at,
        lastImported: params.imported,
        lastError: params.error ?? null,
      },
    },
    { upsert: true }
  ).exec();
}

export async function findJournalEntry(
  userId: string,
  id: string
): Promise<JournalEntryView | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await JournalEntry.findOne({ _id: id, ...ownerFilter(userId) }).lean().exec();
  return doc ? toJournalView(doc) : null;
}

export async function listClosedJournalEntries(
  userId: string,
  options: { from?: Date; to?: Date; limit?: number; order?: "asc" | "desc" } = {}
): Promise<JournalEntryView[]> {
  const filter: Record<string, unknown> = {
    ...ownerFilter(userId),
    status: "closed",
    closedAt: { $ne: null },
  };
  if (options.from || options.to) {
    const range: Record<string, Date> = {};
    if (options.from) range.$gte = options.from;
    if (options.to) range.$lt = options.to;
    filter.closedAt = { ...(filter.closedAt as object), ...range };
  }

  let query = JournalEntry.find(filter).sort({ closedAt: options.order === "desc" ? -1 : 1 });
  if (options.limit != null) query = query.limit(Math.max(1, options.limit));
  const docs = await query.lean().exec();
  return (docs as any[]).map(toJournalView);
}

export async function deleteJournalEntry(userId: string, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new JournalError(404, "journal entry not found");
  const doc = await JournalEntry.findOne({ _id: id, ...ownerFilter(userId) }).lean().exec();
  if (!doc) throw new JournalError(404, "journal entry not found");
  const result = await JournalEntry.deleteOne({ _id: id, ...ownerFilter(userId) }).exec();
  if (!result.deletedCount) throw new JournalError(404, "journal entry not found");
  await invalidateBriefing(userId);
  await invalidateCoachForEntry(userId, id, [(doc as any).closedAt]);
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
  const importedWeeks = new Set<string>();
  for (const row of history.trades) {
    if (!row.dealId) continue;
    const result = await JournalEntry.updateOne(
      { userId: userObjectId, dealId: row.dealId },
      { $setOnInsert: historyRowToJournal(row, { ctid, label: accountLabel }) },
      { upsert: true }
    ).exec();
    if (result.upsertedCount) {
      imported++;
      const week = closedWeekKey(new Date(row.closeTimestamp));
      if (week) importedWeeks.add(week);
    }
  }
  try {
    await clearCoachWeeks(userId, [...importedWeeks]);
  } catch {
    // The next explicit report generation still uses the latest journal data.
  }

  return {
    imported,
    skipped: history.trades.length - imported,
    total: history.trades.length,
    accountLabel,
  };
}

export async function importMt5History(
  userId: string,
  accountId: string,
  days: number
): Promise<JournalImportResult> {
  const [{ getMt5Account }, { mt5BrokerAdapter }] = await Promise.all([
    import("../mt5/accounts"),
    import("../broker"),
  ]);
  const account = await getMt5Account(userId, accountId);
  if (!account) throw new JournalError(404, "account not found");

  const history = await mt5BrokerAdapter.fetchHistory(
    { userId, broker: "mt5", accountId: account.id, mode: account.mode },
    days
  );
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const accountLabel = account.nickname || account.login || `MT5 ${account.id}`;

  let imported = 0;

  const importedWeeks = new Set<string>();
  for (const row of history.trades) {
    if (!row.id) continue;
    const result = await JournalEntry.updateOne(
      { userId: userObjectId, broker: "mt5", externalId: row.id },
      { $setOnInsert: mt5HistoryToJournal(row, { id: account.id, label: accountLabel }) },
      { upsert: true }
    ).exec();
    if (result.upsertedCount) {
      imported++;
      const week = closedWeekKey(new Date(row.closedAt));
      if (week) importedWeeks.add(week);
    }
  }
  try {
    await clearCoachWeeks(userId, [...importedWeeks]);
  } catch {
    void 0;
  }

  return {
    imported,
    skipped: history.trades.length - imported,
    total: history.trades.length,
    accountLabel,
  };
}
