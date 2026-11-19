import { createHash } from "node:crypto";

import { htmlToText, textToLines } from "../sessionAnalysis/parse";
import type { ParsedEconomicNews, ParsedEconomicNewsEvent } from "./types";

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const ZONE_OFFSETS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
  BST: 1,
};

const STAMP = /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?:\s+([A-Z]{2,5}))?/i;
const EVENT =
  /^\s*([A-Za-z]{2,4})\s+(?:\S+\s+)?(\d{1,2}-[A-Za-z]{3}-\d{4}\s+\d{1,2}:\d{2}(?:\s+[A-Z]{2,5})?)\s+(.+?)\s*$/i;

function parseStamp(value: string): string | null {
  const match = STAMP.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[(match[2] ?? "").toLowerCase()];
  const year = Number(match[3]);
  const day = Number(match[1]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    month === undefined ||
    !Number.isInteger(year) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const zone = (match[6] ?? "").toUpperCase();
  const offset = zone ? ZONE_OFFSETS[zone] ?? 0 : 0;
  const date = new Date(Date.UTC(year, month, day, hour, minute) - offset * 3_600_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function eventKey(country: string, startsAt: string, title: string): string {
  return createHash("sha1")
    .update(`${startsAt}|${country}|${title.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function htmlRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) =>
      [...(row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => cleanTitle(htmlToText(cell[1] ?? "")))
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean);
}

export function parseEconomicNews(input: {
  subject?: string | null;
  html?: string | null;
  text?: string | null;
}): ParsedEconomicNews {
  const html = typeof input.html === "string" ? input.html : "";
  const body = [input.text, html ? htmlRows(html).join("\n") : "", html ? htmlToText(html) : ""]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
  const lines = textToLines(body);
  const events: ParsedEconomicNewsEvent[] = [];
  const seen = new Set<string>();
  let generatedAt: string | null = null;

  for (const line of lines) {
    if (!generatedAt && !EVENT.test(line)) {
      generatedAt = parseStamp(line);
    }
    const match = EVENT.exec(line);
    if (!match) continue;
    const startsAt = parseStamp(match[2] ?? "");
    const title = cleanTitle(match[3] ?? "");
    const country = (match[1] ?? "").toUpperCase();
    if (!startsAt || !title || title.length < 2) continue;
    const key = eventKey(country, startsAt, title);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ eventKey: key, country, startsAt, title });
  }

  return { generatedAt, events };
}

export function isEconomicNewsSubject(subject: string | null | undefined, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return false;
  return (subject ?? "").toLowerCase().includes(needle);
}
