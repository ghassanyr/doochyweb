// Persistence for Hand Picks.
//
// Picks are small admin-authored documents, so they live in one collection and
// are listed newest first. There is no draft state: a saved pick is public at
// once, which is what the Analysis page expects.

import mongoose from "mongoose";

import type {
  HandPick,
  HandPickChartshot,
  HandPickInput,
  HandPickLevelType,
} from "./types";

const pickSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    pattern: { type: String, default: null },
    targetLevel: { type: String, default: null },
    targetPeriod: { type: String, default: null },
    interval: { type: String, default: null },
    identifiedAt: { type: String, default: null },
    reason: { type: String, default: null },
    supporting: { type: [String], default: [] },
    levelType: { type: String, default: null },
    levelValue: { type: String, default: null },
    levelNote: { type: String, default: null },
    chartUrl: { type: String, default: null },
  },
  { timestamps: true }
);
pickSchema.index({ createdAt: -1 });

export const HandPickModel = mongoose.model("HandPick", pickSchema);

/** A validation problem the admin can fix; routes turn this into a 400. */
export class HandPickInputError extends Error {}

const MAX_SYMBOL = 60;
const MAX_FIELD = 120;
const MAX_REASON = 2000;
const MAX_NOTE = 300;
const MAX_SUPPORTING_LINES = 20;
const MAX_SUPPORTING_LINE = 400;
const CHART_ID = "[A-Za-z0-9_-]{6,64}";

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function levelType(value: unknown): HandPickLevelType | null {
  return value === "support" || value === "resistance" ? value : null;
}

export function chartshotId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;
  const html = source.match(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/i);
  const candidate = (html?.[1] ?? source).trim();
  const image = candidate.match(
    new RegExp(`^https://img\\.chartshots\\.net/(${CHART_ID})\\.png(?:\\?.*)?$`, "i")
  );
  if (image) return image[1];
  const shot = candidate.match(
    new RegExp(
      `^https://(?:chartshots\\.spotware\\.com|ctrader\\.chartshots\\.net)/c/(${CHART_ID})(?:\\?.*)?$`,
      "i"
    )
  );
  return shot ? shot[1] : null;
}

export function chartshotUrl(value: unknown): string | null {
  const id = chartshotId(value);
  return id ? `https://img.chartshots.net/${id}.png` : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

function chartshotInterval(value: string): string | null {
  const decoded = decodeHtml(value).trim();
  const normalized = decoded.toLowerCase().replace(/\s+/g, "");
  const known: Record<string, string> = {
    m1: "1 minute",
    m5: "5 minute",
    m15: "15 minute",
    m30: "30 minute",
    h1: "1 hour",
    h2: "2 hour",
    h3: "3 hour",
    h4: "4 hour",
    h6: "6 hour",
    h8: "8 hour",
    h12: "12 hour",
    d1: "1 day",
    w1: "1 week",
    mn1: "1 month",
  };
  if (known[normalized]) return known[normalized];
  const match = normalized.match(/^(\d+)(m|h|d|w)$/);
  if (!match) return decoded || null;
  const unit = match[2] === "m" ? "minute" : match[2] === "h" ? "hour" : match[2] === "d" ? "day" : "week";
  return `${match[1]} ${unit}${match[1] === "1" ? "" : "s"}`;
}

export function parseChartshotMetadata(html: string, id: string): HandPickChartshot {
  const heading = html.match(/<h1\b[^>]*>\s*Chartshot:\s*([^,<]+?)\s*,\s*([^<]+?)\s*<\/h1>/i);
  const time = html.match(
    /<span\b[^>]*>\s*(\d{1,2}:\d{2}:\d{2}\s*\([^)]+\)\s*on\s*[^<]+?)\s*<\/span>/i
  );
  const chartUrl = `https://img.chartshots.net/${id}.png`;
  return {
    id,
    chartUrl,
    chartHtml: `<img src='${chartUrl}'>`,
    symbol: heading ? decodeHtml(heading[1]).trim() || null : null,
    interval: heading ? chartshotInterval(heading[2]) : null,
    identifiedAt: time ? decodeHtml(time[1]).replace(/\s+/g, " ").trim() : null,
  };
}

export async function loadChartshotMetadata(value: unknown): Promise<HandPickChartshot> {
  const id = chartshotId(value);
  if (!id) throw new HandPickInputError("Paste a valid cTrader chartshot link.");
  const response = await fetch(`https://chartshots.spotware.com/c/${id}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": "DoochyWeb/1.0" },
  });
  if (!response.ok) throw new Error("The chartshot link could not be read.");
  return parseChartshotMetadata(await response.text(), id);
}

/**
 * Normalize an admin payload into the stored shape.
 *
 * Trimming here means an all-whitespace field is stored as null instead of an
 * empty string, and the public mapper can treat null as "not stated".
 */
export function cleanHandPickInput(body: unknown): HandPickInput {
  const value = (body ?? {}) as Record<string, unknown>;
  const symbol = text(value.symbol, MAX_SYMBOL);
  if (!symbol) throw new HandPickInputError("A symbol is required.");

  const supporting = Array.isArray(value.supporting)
    ? value.supporting
        .map((line) => text(line, MAX_SUPPORTING_LINE))
        .filter((line): line is string => line !== null)
        .slice(0, MAX_SUPPORTING_LINES)
    : [];

  const chartSource = value.chartHtml ?? value.chartUrl;
  const chartUrlValue = chartshotUrl(chartSource);
  if (typeof chartSource === "string" && chartSource.trim() && !chartUrlValue) {
    throw new HandPickInputError("Chartshot HTML must point to a cTrader chartshot image.");
  }

  return {
    symbol,
    pattern: text(value.pattern, MAX_FIELD),
    targetLevel: text(value.targetLevel, MAX_FIELD),
    targetPeriod: text(value.targetPeriod, MAX_FIELD),
    interval: text(value.interval, MAX_FIELD),
    identifiedAt: text(value.identifiedAt, MAX_FIELD),
    reason: text(value.reason, MAX_REASON),
    supporting,
    levelType: levelType(value.levelType),
    levelValue: text(value.levelValue, MAX_FIELD),
    levelNote: text(value.levelNote, MAX_NOTE),
    chartUrl: chartUrlValue,
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

/** Map a stored document to the public shape. */
export function publicHandPick(doc: any): HandPick {
  return {
    id: String(doc?._id ?? ""),
    symbol: String(doc?.symbol ?? ""),
    pattern: typeof doc?.pattern === "string" ? doc.pattern : null,
    targetLevel: typeof doc?.targetLevel === "string" ? doc.targetLevel : null,
    targetPeriod: typeof doc?.targetPeriod === "string" ? doc.targetPeriod : null,
    interval: typeof doc?.interval === "string" ? doc.interval : null,
    identifiedAt: typeof doc?.identifiedAt === "string" ? doc.identifiedAt : null,
    reason: typeof doc?.reason === "string" ? doc.reason : null,
    supporting: Array.isArray(doc?.supporting)
      ? doc.supporting.filter((line: unknown): line is string => typeof line === "string")
      : [],
    levelType:
      doc?.levelType === "support" || doc?.levelType === "resistance"
        ? doc.levelType
        : null,
    levelValue: typeof doc?.levelValue === "string" ? doc.levelValue : null,
    levelNote: typeof doc?.levelNote === "string" ? doc.levelNote : null,
    chartUrl: chartshotUrl(doc?.chartUrl) ?? null,
    createdAt: iso(doc?.createdAt),
    updatedAt: iso(doc?.updatedAt),
  };
}

export async function listHandPicks(): Promise<HandPick[]> {
  const docs: any[] = await HandPickModel.find({})
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  return docs.map(publicHandPick);
}

export async function createHandPick(input: HandPickInput): Promise<HandPick> {
  const doc = await HandPickModel.create(input);
  return publicHandPick(doc.toObject());
}

export async function updateHandPick(
  id: string,
  input: HandPickInput
): Promise<HandPick | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc: any = await HandPickModel.findByIdAndUpdate(id, { $set: input }, { new: true })
    .lean()
    .exec();
  return doc ? publicHandPick(doc) : null;
}

export async function deleteHandPick(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const result = await HandPickModel.deleteOne({ _id: id }).exec();
  return result.deletedCount === 1;
}
