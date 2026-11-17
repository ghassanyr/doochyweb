// Persistence for AI Coach reports.
//
// One document per (user, kind, key). Weekly keys are UTC Monday-Sunday week
// keys; trade keys are journal entry ids. The facts are stored with the prose so
// the page can show the exact numbers the review was written over.

import mongoose from "mongoose";

import type {
  CoachKind,
  CoachReport,
  CoachTradeFacts,
  CoachTradeReport,
  CoachTradeSections,
  CoachWeeklyFacts,
  CoachWeeklyReport,
  CoachWeeklySections,
} from "./types";

const reportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["weekly", "trade"], required: true },
    key: { type: String, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    facts: { type: mongoose.Schema.Types.Mixed, required: true },
    sections: { type: mongoose.Schema.Types.Mixed, required: true },
    model: { type: String, default: null },
    error: { type: String, default: null },
    generatedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

reportSchema.index({ userId: 1, kind: 1, key: 1 }, { unique: true });
reportSchema.index({ userId: 1, kind: 1, generatedAt: -1 });

export const CoachReportModel = mongoose.model("CoachReport", reportSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function toCoachReport(doc: any): CoachReport | null {
  const kind = doc?.kind;
  const generatedAt = iso(doc?.generatedAt);
  const key = typeof doc?.key === "string" ? doc.key : "";
  if ((kind !== "weekly" && kind !== "trade") || !generatedAt || !key) return null;
  const facts = doc?.facts;
  const sections = doc?.sections;
  if (!facts || typeof facts !== "object" || !sections || typeof sections !== "object") {
    return null;
  }

  if (kind === "weekly") {
    const report: CoachWeeklyReport = {
      kind: "weekly",
      key,
      periodStart: iso(doc.periodStart) ?? String((facts as CoachWeeklyFacts).periodStart ?? ""),
      periodEnd: iso(doc.periodEnd) ?? String((facts as CoachWeeklyFacts).periodEnd ?? ""),
      generatedAt,
      model: typeof doc.model === "string" ? doc.model : null,
      error: typeof doc.error === "string" ? doc.error : null,
      facts: facts as CoachWeeklyFacts,
      sections: sections as CoachWeeklySections,
    };
    return report;
  }

  const report: CoachTradeReport = {
    kind: "trade",
    key,
    periodStart: iso(doc.periodStart),
    periodEnd: iso(doc.periodEnd),
    generatedAt,
    model: typeof doc.model === "string" ? doc.model : null,
    error: typeof doc.error === "string" ? doc.error : null,
    facts: facts as CoachTradeFacts,
    sections: sections as CoachTradeSections,
  };
  return report;
}

function owner(userId: string) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

export async function findCoachReport(
  userId: string,
  kind: CoachKind,
  key: string
): Promise<CoachReport | null> {
  const doc = await CoachReportModel.findOne({ ...owner(userId), kind, key }).lean().exec();
  return doc ? toCoachReport(doc) : null;
}

export async function saveCoachReport(params: {
  userId: string;
  kind: CoachKind;
  key: string;
  periodStart: string | null;
  periodEnd: string | null;
  facts: CoachWeeklyFacts | CoachTradeFacts;
  sections: CoachWeeklySections | CoachTradeSections;
  model: string | null;
  error: string | null;
  generatedAt: string;
}): Promise<CoachReport> {
  const doc = await CoachReportModel.findOneAndUpdate(
    { ...owner(params.userId), kind: params.kind, key: params.key },
    {
      $set: {
        periodStart: params.periodStart ? new Date(params.periodStart) : null,
        periodEnd: params.periodEnd ? new Date(params.periodEnd) : null,
        facts: params.facts,
        sections: params.sections,
        model: params.model,
        error: params.error,
        generatedAt: new Date(params.generatedAt),
      },
    },
    { new: true, upsert: true }
  )
    .lean()
    .exec();
  const report = toCoachReport(doc);
  if (!report) throw new Error("coach report could not be stored");
  return report;
}

export async function clearCoachTrade(userId: string, entryId: string): Promise<void> {
  await CoachReportModel.deleteOne({ ...owner(userId), kind: "trade", key: entryId }).exec();
}

export async function clearCoachWeek(userId: string, weekKey: string): Promise<void> {
  await CoachReportModel.deleteOne({ ...owner(userId), kind: "weekly", key: weekKey }).exec();
}

export async function clearCoachWeeks(userId: string, weekKeys: string[]): Promise<void> {
  const keys = [...new Set(weekKeys.filter(Boolean))];
  if (!keys.length) return;
  await CoachReportModel.deleteMany({
    ...owner(userId),
    kind: "weekly",
    key: { $in: keys },
  }).exec();
}

export async function reviewedTradeIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const docs = await CoachReportModel.find({
    ...owner(userId),
    kind: "trade",
    key: { $in: ids },
  })
    .select({ key: 1 })
    .lean()
    .exec();
  return new Set((docs as any[]).map((doc) => String(doc.key)));
}

export async function listCoachReports(userId: string): Promise<CoachReport[]> {
  const docs = await CoachReportModel.find(owner(userId)).sort({ createdAt: 1 }).lean().exec();
  return (docs as any[]).map(toCoachReport).filter((doc): doc is CoachReport => Boolean(doc));
}
