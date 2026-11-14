// Persistence for personal price alerts.
//
// Feature-local like the other stores. Every row belongs to one user; the
// runner reads active rows across users because it is a single in-process loop.

import mongoose from "mongoose";

import type { AlertCounts, AlertInput, AlertView } from "./types";

const alertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    symbol: { type: String, required: true, index: true },
    condition: { type: String, enum: ["above", "below"], required: true },
    level: { type: Number, required: true },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "triggered", "paused"],
      default: "active",
      index: true,
    },
    triggeredAt: { type: Date, default: null },
    triggeredPrice: { type: Number, default: null },
    lastPrice: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

alertSchema.index({ status: 1, symbol: 1 });
alertSchema.index({ userId: 1, createdAt: -1 });

export const PriceAlert = mongoose.model("PriceAlert", alertSchema);

export class AlertError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AlertError";
    this.status = status;
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toAlertView(doc: any): AlertView {
  return {
    id: String(doc._id),
    symbol: doc.symbol,
    condition: doc.condition,
    level: Number(doc.level),
    note: doc.note ?? "",
    status: doc.status,
    triggeredAt: iso(doc.triggeredAt),
    triggeredPrice: doc.triggeredPrice ?? null,
    lastPrice: doc.lastPrice ?? null,
    lastCheckedAt: iso(doc.lastCheckedAt),
    createdAt: iso(doc.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(doc.updatedAt) ?? new Date(0).toISOString(),
  };
}

function owner(userId: string) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

function countBy(alerts: AlertView[]): AlertCounts {
  return {
    active: alerts.filter((alert) => alert.status === "active").length,
    triggered: alerts.filter((alert) => alert.status === "triggered").length,
    paused: alerts.filter((alert) => alert.status === "paused").length,
    total: alerts.length,
  };
}

export async function listAlerts(
  userId: string
): Promise<{ alerts: AlertView[]; counts: AlertCounts }> {
  const docs = await PriceAlert.find(owner(userId)).sort({ createdAt: -1 }).lean().exec();
  const alerts = docs.map(toAlertView);
  return { alerts, counts: countBy(alerts) };
}

export async function createAlert(userId: string, input: AlertInput): Promise<AlertView> {
  const doc = await PriceAlert.create({
    ...owner(userId),
    ...input,
    triggeredAt: null,
    triggeredPrice: null,
    lastPrice: null,
    lastCheckedAt: null,
  });
  return toAlertView(doc.toObject());
}

export async function updateAlert(
  userId: string,
  id: string,
  input: AlertInput
): Promise<AlertView> {
  if (!mongoose.isValidObjectId(id)) throw new AlertError(404, "alert not found");
  const doc = await PriceAlert.findOne({ _id: id, ...owner(userId) }).exec();
  if (!doc) throw new AlertError(404, "alert not found");

  doc.symbol = input.symbol;
  doc.condition = input.condition;
  doc.level = input.level;
  doc.note = input.note;
  // Re-activating clears the previous trigger so the alert can fire again.
  if (input.status === "active" && doc.status !== "active") {
    doc.triggeredAt = null;
    doc.triggeredPrice = null;
  }
  doc.status = input.status;
  await doc.save();
  return toAlertView(doc.toObject());
}

export async function deleteAlert(userId: string, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new AlertError(404, "alert not found");
  const result = await PriceAlert.deleteOne({ _id: id, ...owner(userId) }).exec();
  if (!result.deletedCount) throw new AlertError(404, "alert not found");
}

/** An active alert plus its owner, for the checker only. */
export type ActiveAlertRow = AlertView & { userId: string };

/** Every active alert, across users, for the in-process checker. */
export async function listActiveAlerts(): Promise<ActiveAlertRow[]> {
  const docs = await PriceAlert.find({ status: "active" }).lean().exec();
  return docs.map((doc: any) => ({ ...toAlertView(doc), userId: String(doc.userId) }));
}

/** Record the price each alert was checked against. Best effort. */
export async function touchAlerts(
  rows: { id: string; price: number; at: Date }[]
): Promise<void> {
  if (!rows.length) return;
  await PriceAlert.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row.id, status: "active" },
        update: { $set: { lastPrice: row.price, lastCheckedAt: row.at } },
      },
    })),
    { ordered: false }
  ).catch(() => {});
}

/**
 * Atomically move one alert from active to triggered. Returns the updated view,
 * or null when another tick already claimed it.
 */
export async function markTriggered(
  id: string,
  price: number,
  at: Date
): Promise<AlertView | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await PriceAlert.findOneAndUpdate(
    { _id: id, status: "active" },
    {
      $set: {
        status: "triggered",
        triggeredAt: at,
        triggeredPrice: price,
        lastPrice: price,
        lastCheckedAt: at,
      },
    },
    { new: true }
  )
    .lean()
    .exec();
  return doc ? toAlertView(doc) : null;
}
