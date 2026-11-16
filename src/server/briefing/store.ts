// Persistence for the daily briefing.
//
// One document per (user, UTC day). The unique index means two simultaneous
// requests for the same day settle on one brief instead of racing.

import mongoose from "mongoose";

import { normalizeFocusSessions } from "./sessions";
import {
  BRIEFING_SNAPSHOT_VERSION,
  type BriefingFocusSession,
  type BriefingJournalIdea,
  type BriefingJournalSection,
  type BriefingPreferences,
  type BriefingQuote,
  type BriefingRecord,
  type BriefingSections,
  type BriefingSessionRow,
  type BriefingSignal,
  type BriefingSnapshot,
  type BriefingWatchlistRow,
  type BriefingWatchlistSection,
} from "./types";

const briefingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dateKey: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    model: { type: String, default: null },
    narrative: { type: String, default: null },
    sections: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    snapshot: {
      version: { type: Number, default: 1 },
      dateKey: { type: String, required: true },
      generatedAt: { type: String, required: true },
      focusSessions: { type: [String], default: [] },
      sessions: { type: [mongoose.Schema.Types.Mixed], default: [] },
      watchlist: { type: [mongoose.Schema.Types.Mixed], default: [] },
      movers: { type: [mongoose.Schema.Types.Mixed], default: [] },
      signals: { type: [mongoose.Schema.Types.Mixed], default: [] },
      journalIdeas: { type: [mongoose.Schema.Types.Mixed], default: [] },
      dataNotes: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

briefingSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export const Briefing = mongoose.model("Briefing", briefingSchema);

const preferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    focusSessions: { type: [String], default: () => ["london", "newyork"] },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

export const BriefingPreference = mongoose.model("BriefingPreference", preferenceSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function rowList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
}

function quote(value: unknown): BriefingQuote | null {
  const item = record(value);
  if (!item) return null;
  const price = num(item.price);
  const at = iso(item.at);
  if (price == null || !at) return null;
  return {
    price,
    at,
    source: item.source === "daily" ? "daily" : "latest",
  };
}

function sessionRows(value: unknown): BriefingSessionRow[] {
  return rowList(value)
    .map((row) => {
      const key = row.key;
      if (key !== "asia" && key !== "london" && key !== "newyork") return null;
      return {
        key,
        label: text(row.label) || key,
        status: row.status === "open" ? ("open" as const) : ("closed" as const),
        nextChange: typeof row.nextChange === "string" ? row.nextChange : null,
        nextChangeAt: typeof row.nextChangeAt === "string" ? row.nextChangeAt : null,
      };
    })
    .filter((row): row is BriefingSessionRow => Boolean(row));
}

function watchlistRows(snapshot: Record<string, unknown>): BriefingWatchlistRow[] {
  if (Array.isArray(snapshot.watchlist)) {
    return rowList(snapshot.watchlist)
      .map((row): BriefingWatchlistRow | null => {
        const symbol = text(row.symbol).trim().toUpperCase();
        if (!symbol) return null;
        return {
          symbol,
          name: typeof row.name === "string" ? row.name : null,
          type: typeof row.type === "string" ? row.type : null,
          last: num(row.last),
          previousClose: num(row.previousClose),
          changePct: num(row.changePct),
          dayHigh: num(row.dayHigh),
          dayLow: num(row.dayLow),
          barTime: iso(row.barTime),
          quote: quote(row.quote),
        };
      })
      .filter((row): row is BriefingWatchlistRow => Boolean(row));
  }

  return rowList(snapshot.movers)
    .map((row): BriefingWatchlistRow | null => {
      const symbol = text(row.symbol).trim().toUpperCase();
      if (!symbol) return null;
      return {
        symbol,
        name: null,
        type: null,
        last: num(row.last),
        previousClose: null,
        changePct: num(row.changePct),
        dayHigh: null,
        dayLow: null,
        barTime: null,
        quote: null,
      };
    })
    .filter((row): row is BriefingWatchlistRow => Boolean(row));
}

function signalRows(value: unknown): BriefingSignal[] {
  return rowList(value)
    .map((row) => {
      const id = text(row.id);
      const symbol = text(row.symbol).trim().toUpperCase();
      const direction = row.direction === "sell" ? "sell" : row.direction === "buy" ? "buy" : null;
      if (!id || !symbol || !direction) return null;
      return {
        id,
        symbol,
        direction,
        entry: num(row.entry),
        entryMax: num(row.entryMax),
        target: num(row.target) ?? 0,
        target2: num(row.target2),
        target3: num(row.target3),
        stop: num(row.stop) ?? 0,
        timeframe: typeof row.timeframe === "string" ? row.timeframe : null,
        note: text(row.note),
        createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
        ageHours: num(row.ageHours) ?? 0,
        quote: quote(row.quote),
        toEntryPct: num(row.toEntryPct),
        toStopPct: num(row.toStopPct),
        toTargetPct: num(row.toTargetPct),
      };
    })
    .filter((row): row is BriefingSignal => Boolean(row));
}

function journalRows(value: unknown): BriefingJournalIdea[] {
  return rowList(value)
    .map((row) => {
      const id = text(row.id);
      const symbol = text(row.symbol).trim().toUpperCase();
      const side = row.side === "sell" ? "sell" : row.side === "buy" ? "buy" : null;
      if (!id || !symbol || !side) return null;
      return {
        id,
        symbol,
        side,
        entryPrice: num(row.entryPrice),
        stop: num(row.stop),
        target: num(row.target),
        verified: row.verified === true,
        openedAt: iso(row.openedAt),
        note: text(row.note),
        quote: quote(row.quote),
        toEntryPct: num(row.toEntryPct),
        toStopPct: num(row.toStopPct),
        toTargetPct: num(row.toTargetPct),
      };
    })
    .filter((row): row is BriefingJournalIdea => Boolean(row));
}

function sections(value: unknown): BriefingSections | null {
  const item = record(value);
  if (!item) return null;
  const watchlist: BriefingWatchlistSection[] = rowList(item.watchlist)
    .map((row) => ({
      symbol: text(row.symbol).trim().toUpperCase(),
      whatHappened: text(row.whatHappened),
      whyItMatters: text(row.whyItMatters),
      watchFor: text(row.watchFor),
    }))
    .filter((row) => Boolean(row.symbol));
  const journalIdeas: BriefingJournalSection[] = rowList(item.journalIdeas)
    .map((row) => ({ id: text(row.id), update: text(row.update) }))
    .filter((row) => Boolean(row.id));
  return {
    headline: text(item.headline),
    overview: text(item.overview),
    watchlist,
    journalIdeas,
    risks: textList(item.risks),
    monitor: textList(item.monitor),
    caveats: textList(item.caveats),
  };
}

function snapshotRecord(
  snapshot: Record<string, unknown>,
  dateKey: string,
  generatedAt: string
): BriefingSnapshot {
  const version = Number(snapshot.version) === BRIEFING_SNAPSHOT_VERSION
    ? BRIEFING_SNAPSHOT_VERSION
    : 1;
  return {
    version,
    dateKey: text(snapshot.dateKey) || dateKey,
    generatedAt: iso(snapshot.generatedAt) ?? generatedAt,
    focusSessions: normalizeFocusSessions(snapshot.focusSessions),
    sessions: sessionRows(snapshot.sessions),
    watchlist: watchlistRows(snapshot),
    signals: signalRows(snapshot.signals),
    journalIdeas: journalRows(snapshot.journalIdeas),
    dataNotes: textList(snapshot.dataNotes),
  };
}

export function toBriefingRecord(doc: any): BriefingRecord {
  const generatedAt = iso(doc.generatedAt) ?? new Date(0).toISOString();
  return {
    dateKey: String(doc.dateKey),
    generatedAt,
    model: typeof doc.model === "string" ? doc.model : null,
    narrative: typeof doc.narrative === "string" ? doc.narrative : null,
    sections: sections(doc.sections),
    error: typeof doc.error === "string" ? doc.error : null,
    snapshot: snapshotRecord(record(doc.snapshot) ?? {}, String(doc.dateKey), generatedAt),
  };
}

function owner(userId: string) {
  return { userId: new mongoose.Types.ObjectId(userId) };
}

export async function findBriefing(userId: string, dateKey: string): Promise<BriefingRecord | null> {
  const doc = await Briefing.findOne({ ...owner(userId), dateKey }).lean().exec();
  return doc ? toBriefingRecord(doc) : null;
}

/** Drop a stored brief so the next read rebuilds it from current data. */
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
        sections: record.sections,
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

export async function getBriefingPreference(userId: string): Promise<BriefingPreferences> {
  const doc: any = await BriefingPreference.findOne(owner(userId)).lean().exec();
  return { focusSessions: normalizeFocusSessions(doc?.focusSessions) };
}

export async function saveBriefingPreference(
  userId: string,
  focusSessions: BriefingFocusSession[]
): Promise<BriefingPreferences> {
  const normalized = normalizeFocusSessions(focusSessions);
  await BriefingPreference.updateOne(
    owner(userId),
    { $set: { focusSessions: normalized, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  return { focusSessions: normalized };
}
