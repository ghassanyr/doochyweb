// Persistence for the daily briefing.
//
// One document per (user, UTC day). The unique index means two simultaneous
// requests for the same day settle on one brief instead of racing.

import mongoose from "mongoose";

import type { BriefingRecord, BriefingSnapshot } from "./types";

const briefingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dateKey: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    model: { type: String, default: null },
    narrative: { type: String, default: null },
    error: { type: String, default: null },
    snapshot: {
      dateKey: { type: String, required: true },
      generatedAt: { type: String, required: true },
      movers: { type: [mongoose.Schema.Types.Mixed], default: [] },
      signals: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true }
);

briefingSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export const Briefing = mongoose.model("Briefing", briefingSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toBriefingRecord(doc: any): BriefingRecord {
  const snapshot = (doc.snapshot ?? {}) as Partial<BriefingSnapshot>;
  return {
    dateKey: String(doc.dateKey),
    generatedAt: iso(doc.generatedAt) ?? new Date(0).toISOString(),
    model: doc.model ?? null,
    narrative: doc.narrative ?? null,
    error: doc.error ?? null,
    snapshot: {
      dateKey: String(snapshot.dateKey ?? doc.dateKey),
      generatedAt: String(snapshot.generatedAt ?? iso(doc.generatedAt) ?? ""),
      movers: Array.isArray(snapshot.movers) ? snapshot.movers : [],
      signals: Array.isArray(snapshot.signals) ? snapshot.signals : [],
    },
  };
}

function owner(userId: string) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

export async function findBriefing(userId: string, dateKey: string): Promise<BriefingRecord | null> {
  const doc = await Briefing.findOne({ ...owner(userId), dateKey }).lean().exec();
  return doc ? toBriefingRecord(doc) : null;
}

/** Drop a stored brief so the next read rebuilds it from the current watchlist. */
export async function clearBriefing(userId: string, dateKey: string): Promise<void> {
  await Briefing.deleteOne({ ...owner(userId), dateKey }).exec();
}

/** Replace today's brief. Used by generation and by an explicit refresh. */
export async function saveBriefing(params: {
  userId: string;
  record: BriefingRecord;
}): Promise<BriefingRecord> {
  const { userId, record } = params;
  const doc = await Briefing.findOneAndUpdate(
    { ...owner(userId), dateKey: record.dateKey },
    {
      $set: {
        generatedAt: new Date(record.generatedAt),
        model: record.model,
        narrative: record.narrative,
        error: record.error,
        snapshot: record.snapshot,
      },
    },
    { new: true, upsert: true }
  )
    .lean()
    .exec();
  return toBriefingRecord(doc);
}
