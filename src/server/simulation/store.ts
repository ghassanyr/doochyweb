// Persistence for paper trading.
//
// One document per position, always scoped by userId. Opening fills at the
// current market price server side, so the browser cannot choose its own entry,
// and closing reads the price at that moment. A position only ever leaves the
// open state once, which keeps the runner and a manual close from both winning.

import mongoose from "mongoose";

import { signalPrices } from "../signals/prices";
import type { PaperCloseReason, PaperInput, PaperPositionView } from "./types";
import { levelError, paperPnl } from "./validate";

const positionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    symbol: { type: String, required: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    notional: { type: Number, required: true },
    entryPrice: { type: Number, required: true },
    stop: { type: Number, default: null },
    target: { type: Number, default: null },
    exitPrice: { type: Number, default: null },
    pnl: { type: Number, default: null },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    closeReason: { type: String, enum: ["manual", "stop", "target"], default: null },
    lastPrice: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

positionSchema.index({ userId: 1, status: 1, openedAt: -1 });
positionSchema.index({ status: 1, symbol: 1 });

export const PaperPosition = mongoose.model("PaperPosition", positionSchema);

export class PaperError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PaperError";
    this.status = status;
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toPaperView(doc: any): PaperPositionView {
  return {
    id: String(doc._id),
    symbol: String(doc.symbol),
    side: doc.side,
    notional: Number(doc.notional),
    entryPrice: Number(doc.entryPrice),
    stop: doc.stop ?? null,
    target: doc.target ?? null,
    exitPrice: doc.exitPrice ?? null,
    pnl: doc.pnl ?? null,
    status: doc.status,
    closeReason: doc.closeReason ?? null,
    lastPrice: doc.lastPrice ?? null,
    openedAt: iso(doc.openedAt) ?? iso(doc.createdAt) ?? new Date(0).toISOString(),
    closedAt: iso(doc.closedAt),
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}

function owner(userId: string) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

/** Current market price for one symbol, or null when no source answered. */
export async function paperPrice(symbol: string): Promise<number | null> {
  const prices = await signalPrices([symbol]);
  const price = prices[symbol]?.price;
  return price != null && Number.isFinite(price) ? price : null;
}

export async function openPaperPosition(
  userId: string,
  input: PaperInput,
  now: Date = new Date()
): Promise<PaperPositionView> {
  const entry = await paperPrice(input.symbol);
  if (entry == null) {
    throw new PaperError(400, `No market price for ${input.symbol} right now.`);
  }
  const invalid = levelError(input, entry);
  if (invalid) throw new PaperError(400, invalid);

  const doc = await PaperPosition.create({
    ...owner(userId),
    symbol: input.symbol,
    side: input.side,
    notional: input.notional,
    entryPrice: entry,
    stop: input.stop,
    target: input.target,
    exitPrice: null,
    pnl: null,
    status: "open",
    closeReason: null,
    lastPrice: entry,
    lastCheckedAt: now,
    openedAt: now,
    closedAt: null,
  });
  return toPaperView(doc.toObject());
}

export async function listPaperPositions(userId: string): Promise<PaperPositionView[]> {
  const docs = await PaperPosition.find(owner(userId))
    .sort({ status: 1, openedAt: -1 })
    .limit(500)
    .lean()
    .exec();
  return docs.map(toPaperView);
}

/** Every open position across users, for the in-process checker. */
export async function listOpenPaperPositions(): Promise<PaperPositionView[]> {
  const docs = await PaperPosition.find({ status: "open" }).lean().exec();
  return docs.map(toPaperView);
}

/**
 * Close one open position at `price`. The status filter makes this a single
 * winner when the checker and the member both try at once.
 */
export async function closePaperPosition(
  userId: string,
  id: string,
  price: number,
  reason: PaperCloseReason,
  now: Date = new Date()
): Promise<PaperPositionView> {
  if (!mongoose.isValidObjectId(id)) throw new PaperError(404, "position not found");
  const doc = await PaperPosition.findOne({ _id: id, ...owner(userId), status: "open" }).exec();
  if (!doc) throw new PaperError(404, "open position not found");

  doc.exitPrice = price;
  doc.pnl = paperPnl(doc.side as "buy" | "sell", Number(doc.notional), Number(doc.entryPrice), price);
  doc.status = "closed";
  doc.closeReason = reason;
  doc.lastPrice = price;
  doc.lastCheckedAt = now;
  doc.closedAt = now;
  await doc.save();
  return toPaperView(doc.toObject());
}

/** Close by id only (runner path). Returns null when another writer won. */
export async function settlePaperPosition(
  id: string,
  price: number,
  reason: PaperCloseReason,
  now: Date = new Date()
): Promise<PaperPositionView | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await PaperPosition.findOne({ _id: id, status: "open" }).lean().exec();
  if (!doc) return null;

  const pnl = paperPnl(
    doc.side as "buy" | "sell",
    Number(doc.notional),
    Number(doc.entryPrice),
    price
  );
  const updated = await PaperPosition.findOneAndUpdate(
    { _id: id, status: "open" },
    {
      $set: {
        status: "closed",
        exitPrice: price,
        pnl,
        closeReason: reason,
        lastPrice: price,
        lastCheckedAt: now,
        closedAt: now,
      },
    },
    { new: true }
  )
    .lean()
    .exec();
  return updated ? toPaperView(updated) : null;
}

/** Record the price the checker saw without closing anything. */
export async function touchPaperPositions(
  rows: { id: string; price: number; at: Date }[]
): Promise<void> {
  if (!rows.length) return;
  await PaperPosition.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row.id, status: "open" },
        update: { $set: { lastPrice: row.price, lastCheckedAt: row.at } },
      },
    })),
    { ordered: false }
  ).catch(() => {});
}

/** Remove a closed row. Open positions must be closed first. */
export async function deletePaperPosition(userId: string, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new PaperError(404, "position not found");
  const result = await PaperPosition.deleteOne({
    _id: id,
    ...owner(userId),
    status: "closed",
  }).exec();
  if (!result.deletedCount) throw new PaperError(404, "closed position not found");
}
