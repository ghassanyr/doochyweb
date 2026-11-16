import type {
  BriefingFocusSession,
  BriefingSessionRow,
  BriefingSessionStatus,
} from "./types";

export const FOCUS_SESSION_KEYS: BriefingFocusSession[] = ["asia", "london", "newyork"];

export const DEFAULT_FOCUS_SESSIONS: BriefingFocusSession[] = ["london", "newyork"];

const SESSION_LABELS: Record<BriefingFocusSession, string> = {
  asia: "Asia",
  london: "London",
  newyork: "New York",
};

const SESSION_WINDOWS: Record<BriefingFocusSession, { start: number; end: number }> = {
  asia: { start: 0, end: 9 * 60 },
  london: { start: 8 * 60, end: 16 * 60 + 30 },
  newyork: { start: 13 * 60 + 30, end: 21 * 60 },
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isFocusSession(value: unknown): value is BriefingFocusSession {
  return value === "asia" || value === "london" || value === "newyork";
}

export function parseFocusSessions(value: unknown): BriefingFocusSession[] | null {
  if (!Array.isArray(value)) return null;
  const out: BriefingFocusSession[] = [];
  for (const item of value) {
    if (isFocusSession(item) && !out.includes(item)) out.push(item);
  }
  return out.length ? out : null;
}

export function normalizeFocusSessions(value: unknown): BriefingFocusSession[] {
  return parseFocusSessions(value) ?? [...DEFAULT_FOCUS_SESSIONS];
}

export function focusSessionLabel(sessions: BriefingFocusSession[]): string {
  const labels = sessions.map((key) => SESSION_LABELS[key]);
  if (labels.length <= 1) return labels[0] ?? "Market";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function fxClosed(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 5 && hour >= 21) return true;
  if (day === 6) return true;
  if (day === 0 && hour < 21) return true;
  return false;
}

function utcMinutes(now: Date): number {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function whenLabel(date: Date, now: Date): string {
  const time = clock(date.getUTCHours() * 60 + date.getUTCMinutes());
  if (dayKey(date) === dayKey(now)) return `today at ${time}`;
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  if (dayKey(date) === dayKey(tomorrow)) return `tomorrow at ${time}`;
  return `${WEEKDAYS[date.getUTCDay()]} at ${time}`;
}

function nextOpen(
  key: BriefingFocusSession,
  now: Date
): { at: Date; status: BriefingSessionStatus } | null {
  const { start } = SESSION_WINDOWS[key];
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + offset,
        Math.floor(start / 60),
        start % 60
      )
    );
    if (candidate.getTime() <= now.getTime()) continue;
    if (!fxClosed(candidate)) return { at: candidate, status: "closed" };
  }
  return null;
}

export function buildSessionRows(
  sessions: BriefingFocusSession[],
  now: Date
): BriefingSessionRow[] {
  const closed = fxClosed(now);
  const minutes = utcMinutes(now);

  return sessions.map((key) => {
    const window = SESSION_WINDOWS[key];
    const open = !closed && minutes >= window.start && minutes < window.end;
    if (open) {
      return {
        key,
        label: SESSION_LABELS[key],
        status: "open" as const,
        nextChange: `closes at ${clock(window.end)}`,
      };
    }

    const next = nextOpen(key, now);
    return {
      key,
      label: SESSION_LABELS[key],
      status: "closed" as const,
      nextChange: next ? `opens ${whenLabel(next.at, now)}` : null,
    };
  });
}
