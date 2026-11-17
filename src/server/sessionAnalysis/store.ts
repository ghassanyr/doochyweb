// Persistence for Session Analysis.
//
// Chart images live in their own collection so the day document stays small and
// the public image route can stream one image without loading a whole session.
// One day document is keyed by the analysis date, which makes re-importing the
// same email idempotent.

import mongoose from "mongoose";

import type {
  ParsedImage,
  ParsedSession,
  SessionDay,
  SessionDaySummary,
  SessionMarket,
} from "./types";

const marketSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    targetLevel: { type: String, default: null },
    targetPeriod: { type: String, default: null },
    interval: { type: String, default: null },
    pattern: { type: String, default: null },
    identifiedAt: { type: String, default: null },
    reason: { type: String, default: null },
    supporting: { type: [String], default: [] },
    levelType: { type: String, default: null },
    levelValue: { type: String, default: null },
    levelNote: { type: String, default: null },
    chartImageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    sessionKey: { type: String, required: true, unique: true },
    sessionDate: { type: String, required: true },
    subject: { type: String, default: "" },
    sender: { type: String, default: "" },
    receivedAt: { type: Date, default: null },
    generatedAt: { type: String, default: null },
    markets: { type: [marketSchema], default: [] },
    sourceMessageId: { type: String, default: null },
  },
  { timestamps: true }
);
daySchema.index({ sessionDate: -1 });

const imageSchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    symbol: { type: String, default: null },
    contentType: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    data: { type: mongoose.Schema.Types.Buffer, required: true },
  },
  { timestamps: true }
);

export const SessionAnalysisDayModel = mongoose.model("SessionAnalysisDay", daySchema);
export const SessionAnalysisImageModel = mongoose.model(
  "SessionAnalysisImage",
  imageSchema
);

function publicMarket(market: any): SessionMarket {
  const chartImageId = market?.chartImageId ? String(market.chartImageId) : null;
  const levelType =
    market?.levelType === "support" || market?.levelType === "resistance"
      ? market.levelType
      : null;
  return {
    symbol: String(market?.symbol ?? ""),
    targetLevel: typeof market?.targetLevel === "string" ? market.targetLevel : null,
    targetPeriod: typeof market?.targetPeriod === "string" ? market.targetPeriod : null,
    interval: typeof market?.interval === "string" ? market.interval : null,
    pattern: typeof market?.pattern === "string" ? market.pattern : null,
    identifiedAt:
      typeof market?.identifiedAt === "string" ? market.identifiedAt : null,
    reason: typeof market?.reason === "string" ? market.reason : null,
    supporting: Array.isArray(market?.supporting)
      ? market.supporting.filter((line: unknown): line is string => typeof line === "string")
      : [],
    levelType,
    levelValue: typeof market?.levelValue === "string" ? market.levelValue : null,
    levelNote: typeof market?.levelNote === "string" ? market.levelNote : null,
    chartUrl: chartImageId ? `/api/session-analysis/chart/${chartImageId}` : null,
  };
}

function publicDay(doc: any): SessionDay {
  const receivedAt =
    doc?.receivedAt instanceof Date
      ? doc.receivedAt.toISOString()
      : typeof doc?.receivedAt === "string"
        ? doc.receivedAt
        : null;
  return {
    sessionKey: String(doc?.sessionKey ?? ""),
    sessionDate: String(doc?.sessionDate ?? ""),
    subject: typeof doc?.subject === "string" ? doc.subject : "",
    sender: typeof doc?.sender === "string" && doc.sender ? doc.sender : null,
    receivedAt,
    generatedAt: typeof doc?.generatedAt === "string" ? doc.generatedAt : null,
    markets: Array.isArray(doc?.markets) ? doc.markets.map(publicMarket) : [],
  };
}

function summary(doc: any): SessionDaySummary {
  return {
    sessionKey: String(doc?.sessionKey ?? ""),
    sessionDate: String(doc?.sessionDate ?? ""),
    subject: typeof doc?.subject === "string" ? doc.subject : "",
    generatedAt: typeof doc?.generatedAt === "string" ? doc.generatedAt : null,
    marketCount: Array.isArray(doc?.markets) ? doc.markets.length : 0,
  };
}

/**
 * Write one session and replace its chart images. Returns the stored day.
 * Re-importing the same session date updates it in place.
 */
export async function saveSession(
  session: ParsedSession,
  images: (ParsedImage | null)[]
): Promise<SessionDay> {
  await SessionAnalysisImageModel.deleteMany({ dayKey: session.sessionKey }).exec();

  const imageIds: (mongoose.Types.ObjectId | null)[] = [];
  for (let index = 0; index < session.markets.length; index++) {
    const image = images[index] ?? null;
    if (!image) {
      imageIds.push(null);
      continue;
    }
    const saved = await SessionAnalysisImageModel.create({
      dayKey: session.sessionKey,
      symbol: session.markets[index]!.symbol,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      data: image.buffer,
    });
    imageIds.push(saved._id as mongoose.Types.ObjectId);
  }

  const markets = session.markets.map((market, index) => ({
    ...market,
    chartImageId: imageIds[index] ?? null,
    order: index,
  }));

  const receivedAt = new Date(session.receivedAt);
  const doc = await SessionAnalysisDayModel.findOneAndUpdate(
    { sessionKey: session.sessionKey },
    {
      $set: {
        sessionKey: session.sessionKey,
        sessionDate: session.sessionDate,
        subject: session.subject,
        sender: session.sender,
        receivedAt: Number.isFinite(receivedAt.getTime()) ? receivedAt : new Date(),
        generatedAt: session.generatedAt,
        markets,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .lean()
    .exec();

  return publicDay(doc);
}

/** True when this session is stored and already has every chart. */
export async function sessionIsComplete(sessionKey: string): Promise<boolean> {
  const doc: any = await SessionAnalysisDayModel.findOne({ sessionKey }).lean().exec();
  if (!doc || !Array.isArray(doc.markets) || doc.markets.length === 0) return false;
  return doc.markets.every((market: any) => !!market.chartImageId);
}

export async function latestSession(): Promise<SessionDay | null> {
  const doc: any = await SessionAnalysisDayModel.findOne({})
    .sort({ sessionDate: -1, receivedAt: -1 })
    .lean()
    .exec();
  return doc ? publicDay(doc) : null;
}

export async function listSessionDays(limit = 30): Promise<SessionDaySummary[]> {
  const docs: any[] = await SessionAnalysisDayModel.find({})
    .sort({ sessionDate: -1, receivedAt: -1 })
    .limit(limit)
    .lean()
    .exec();
  return docs.map(summary);
}

export async function sessionByKey(sessionKey: string): Promise<SessionDay | null> {
  const doc: any = await SessionAnalysisDayModel.findOne({ sessionKey }).lean().exec();
  return doc ? publicDay(doc) : null;
}

export async function imageById(
  id: string
): Promise<{ contentType: string; data: Buffer } | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc: any = await SessionAnalysisImageModel.findById(id).lean().exec();
  if (!doc || !doc.data) return null;
  return {
    contentType: typeof doc.contentType === "string" ? doc.contentType : "image/png",
    data: Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data),
  };
}
