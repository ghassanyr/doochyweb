import mongoose from "mongoose";

import type {
  EconomicNewsEvent,
  EconomicNewsMeta,
  ParsedEconomicNewsEvent,
} from "./types";

const eventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    country: { type: String, required: true },
    startsAt: { type: Date, required: true },
    title: { type: String, required: true },
    subject: { type: String, default: "" },
    generatedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

eventSchema.index({ startsAt: 1 });

export const EconomicNewsEventModel = mongoose.model("EconomicNewsEvent", eventSchema);

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function publicEvent(doc: any): EconomicNewsEvent {
  return {
    eventKey: String(doc?.eventKey ?? ""),
    country: String(doc?.country ?? ""),
    startsAt: iso(doc?.startsAt) ?? new Date(0).toISOString(),
    title: String(doc?.title ?? ""),
    subject: typeof doc?.subject === "string" ? doc.subject : "",
    generatedAt: iso(doc?.generatedAt),
    receivedAt: iso(doc?.receivedAt),
    lastSeenAt: iso(doc?.lastSeenAt) ?? iso(doc?.updatedAt) ?? new Date().toISOString(),
  };
}

export async function saveEconomicNews(
  events: ParsedEconomicNewsEvent[],
  meta: EconomicNewsMeta
): Promise<number> {
  if (events.length === 0) return 0;
  const now = new Date();
  const generatedAt = meta.generatedAt ? new Date(meta.generatedAt) : null;
  const receivedAt = meta.receivedAt ? new Date(meta.receivedAt) : null;
  await EconomicNewsEventModel.bulkWrite(
    events.map((event) => ({
      updateOne: {
        filter: { eventKey: event.eventKey },
        update: {
          $set: {
            eventKey: event.eventKey,
            country: event.country,
            startsAt: new Date(event.startsAt),
            title: event.title,
            subject: meta.subject,
            generatedAt:
              generatedAt && Number.isFinite(generatedAt.getTime()) ? generatedAt : null,
            receivedAt:
              receivedAt && Number.isFinite(receivedAt.getTime()) ? receivedAt : null,
            lastSeenAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return events.length;
}

export async function listEconomicNews(): Promise<EconomicNewsEvent[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const docs = await EconomicNewsEventModel.find({ startsAt: { $gte: cutoff } })
    .sort({ startsAt: 1 })
    .lean();
  return docs.map(publicEvent);
}

export async function clearEconomicNews(): Promise<void> {
  await EconomicNewsEventModel.deleteMany({});
}
