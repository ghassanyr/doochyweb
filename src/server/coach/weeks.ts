// Fixed UTC week boundaries for AI Coach.
//
// Weeks run from Monday 00:00:00 UTC through Sunday 23:59:59.999 UTC. Using a
// fixed boundary keeps a report stable regardless of the viewer's timezone and
// makes the stored week key meaningful across devices.

import type { CoachWeekInfo } from "./types";

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** ISO week key, for example 2026-W46. */
export function coachWeekKey(date: Date): string {
  const target = utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const year = target.getUTCFullYear();
  const yearStart = utcDate(year, 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface CoachWeekRange {
  key: string;
  start: Date;
  endExclusive: Date;
  periodStart: string;
  periodEnd: string;
}

/** Parse and validate a UTC Monday-Sunday week key. */
export function coachWeekRange(raw: string): CoachWeekRange | null {
  const key = String(raw ?? "").trim().toUpperCase();
  const match = WEEK_RE.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return null;
  if (!Number.isInteger(week) || week < 1 || week > 53) return null;

  const jan4 = utcDate(year, 0, 4);
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = addDays(jan4, -(jan4Day - 1));
  const start = addDays(week1Monday, (week - 1) * 7);
  if (coachWeekKey(start) !== key) return null;

  const endExclusive = addDays(start, 7);
  return {
    key,
    start,
    endExclusive,
    periodStart: start.toISOString(),
    periodEnd: new Date(endExclusive.getTime() - 1).toISOString(),
  };
}

export function coachWeekInfo(raw: string, closedTrades = 0): CoachWeekInfo | null {
  const range = coachWeekRange(raw);
  if (!range) return null;
  return {
    key: range.key,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    closedTrades,
  };
}

export function currentCoachWeek(now: Date): CoachWeekInfo {
  return coachWeekInfo(coachWeekKey(now), 0)!;
}

export function previousCoachWeek(key: string): string | null {
  const range = coachWeekRange(key);
  if (!range) return null;
  return coachWeekKey(new Date(range.start.getTime() - 86_400_000));
}

export function nextCoachWeek(key: string): string | null {
  const range = coachWeekRange(key);
  if (!range) return null;
  return coachWeekKey(range.endExclusive);
}

export function weekdayLabel(date: Date): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    date.getUTCDay()
  ];
}
