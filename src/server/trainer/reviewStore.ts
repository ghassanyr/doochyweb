// Durable store for human review decisions (Phase 3).
//
// One document per candidate id. The candidate identity, bounds and levels are
// snapshotted alongside the editable status/ambiguity/notes so a review can be
// re-imported later without depending on the original candidates CSV.

import mongoose from "mongoose";

import type {
  Direction,
  ReviewRow,
  ReviewStatus,
  Tag,
  TagFamily,
  TrainerSymbol,
  TrainerTimeframe,
} from "./types";

type ReviewDoc = {
  _id: string;
  symbol: string;
  timeframe: string;
  cutIndex: number;
  tag: string;
  family: string;
  direction: Direction | null;
  startIndex: number;
  endIndex: number;
  status: ReviewStatus;
  ambiguity: number | null;
  levelUpper: number | null;
  levelLower: number | null;
  neckline: number | null;
  notes: string;
  sourceRunId: string;
  updatedAt: Date;
};

const reviewSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    symbol: { type: String, required: true },
    timeframe: { type: String, required: true },
    cutIndex: { type: Number, required: true },
    tag: { type: String, required: true },
    family: { type: String, required: true },
    direction: { type: String, default: null },
    startIndex: { type: Number, required: true },
    endIndex: { type: Number, required: true },
    status: { type: String, required: true, default: "pending" },
    ambiguity: { type: Number, default: null },
    levelUpper: { type: Number, default: null },
    levelLower: { type: Number, default: null },
    neckline: { type: Number, default: null },
    notes: { type: String, default: "" },
    sourceRunId: { type: String, required: true },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false }
);

reviewSchema.index({ sourceRunId: 1 });
reviewSchema.index({ status: 1 });

export const TrainerReviews =
  (mongoose.models.TrainerReviews as mongoose.Model<ReviewDoc> | undefined) ||
  mongoose.model<ReviewDoc>("TrainerReviews", reviewSchema);

export interface UpsertSummary {
  matched: number;
  upserted: number;
  modified: number;
}

function toRow(doc: ReviewDoc): ReviewRow {
  return {
    id: doc._id,
    symbol: doc.symbol as TrainerSymbol,
    timeframe: doc.timeframe as TrainerTimeframe,
    cutIndex: doc.cutIndex,
    tag: doc.tag as Tag,
    family: doc.family as TagFamily,
    direction: doc.direction ?? null,
    startIndex: doc.startIndex,
    endIndex: doc.endIndex,
    status: doc.status,
    ambiguity: doc.ambiguity ?? null,
    levelUpper: doc.levelUpper ?? null,
    levelLower: doc.levelLower ?? null,
    neckline: doc.neckline ?? null,
    notes: doc.notes ?? "",
  };
}

function rowFields(row: ReviewRow) {
  return {
    symbol: row.symbol,
    timeframe: row.timeframe,
    cutIndex: row.cutIndex,
    tag: row.tag,
    family: row.family,
    direction: row.direction,
    startIndex: row.startIndex,
    endIndex: row.endIndex,
    status: row.status,
    ambiguity: row.ambiguity,
    levelUpper: row.levelUpper,
    levelLower: row.levelLower,
    neckline: row.neckline,
    notes: row.notes,
  };
}

/** Upsert every row, including pending ones, so an import never drops edits. */
export async function upsertMany(
  rows: readonly ReviewRow[],
  sourceRunId: string
): Promise<UpsertSummary> {
  if (rows.length === 0) return { matched: 0, upserted: 0, modified: 0 };

  const updatedAt = new Date();
  const result = await TrainerReviews.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row.id },
        update: {
          $set: {
            ...rowFields(row),
            sourceRunId,
            updatedAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return {
    matched: result.matchedCount,
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
  };
}

/** Read stored reviews, optionally limited to one source run. */
export async function readAll(sourceRunId?: string): Promise<ReviewRow[]> {
  const query = sourceRunId ? { sourceRunId } : {};
  const docs = await TrainerReviews.find(query)
    .sort({ _id: 1 })
    .lean()
    .exec();
  return docs.map((doc) => toRow(doc as ReviewDoc));
}

export async function readById(id: string): Promise<ReviewRow | null> {
  const doc = await TrainerReviews.findById(id).lean().exec();
  return doc ? toRow(doc as ReviewDoc) : null;
}

/** Quick status/ambiguity edit that leaves sourceRunId intact. */
export async function updateReview(
  id: string,
  patch: { status: ReviewStatus; ambiguity: number | null }
): Promise<ReviewRow | null> {
  const doc = await TrainerReviews.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        status: patch.status,
        ambiguity: patch.ambiguity,
        updatedAt: new Date(),
      },
    },
    { new: true }
  )
    .lean()
    .exec();
  return doc ? toRow(doc as ReviewDoc) : null;
}
