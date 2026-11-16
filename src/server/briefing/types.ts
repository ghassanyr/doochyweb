// Shared shapes for the daily briefing.
//
// The brief is one document per user per UTC day: a frozen snapshot of the
// watchlist, the signals and open journal ideas that existed at the time, and a
// structured AI write-up over them. Freezing the snapshot is deliberate, so
// reopening the page later in the day shows the same numbers the prose was
// written about.

export const BRIEFING_SNAPSHOT_VERSION = 2;

export type BriefingFocusSession = "asia" | "london" | "newyork";

export type BriefingSessionStatus = "open" | "closed";

export interface BriefingSessionRow {
  key: BriefingFocusSession;
  label: string;
  status: BriefingSessionStatus;
  nextChange: string | null;
}

export interface BriefingQuote {
  price: number;
  at: string;
  source: "latest" | "daily";
}

export interface BriefingWatchlistRow {
  symbol: string;
  name: string | null;
  type: string | null;
  /** Latest daily close, or null when no daily bars were available. */
  last: number | null;
  previousClose: number | null;
  /** Percent change against the previous daily close. */
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  barTime: string | null;
  quote: BriefingQuote | null;
}

/** An active (unresolved) published signal. */
export interface BriefingSignal {
  id: string;
  symbol: string;
  direction: "buy" | "sell";
  entry: number | null;
  entryMax: number | null;
  target: number;
  target2: number | null;
  target3: number | null;
  stop: number;
  timeframe: string | null;
  note: string;
  createdAt: string;
  ageHours: number;
  quote: BriefingQuote | null;
  toEntryPct: number | null;
  toStopPct: number | null;
  toTargetPct: number | null;
}

/** One open journal entry, treated as the member's planned idea. */
export interface BriefingJournalIdea {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number | null;
  stop: number | null;
  target: number | null;
  verified: boolean;
  openedAt: string | null;
  note: string;
  quote: BriefingQuote | null;
  toEntryPct: number | null;
  toStopPct: number | null;
  toTargetPct: number | null;
}

export interface BriefingSnapshot {
  version: number;
  dateKey: string;
  generatedAt: string;
  focusSessions: BriefingFocusSession[];
  sessions: BriefingSessionRow[];
  watchlist: BriefingWatchlistRow[];
  signals: BriefingSignal[];
  journalIdeas: BriefingJournalIdea[];
  dataNotes: string[];
}

export interface BriefingWatchlistSection {
  symbol: string;
  whatHappened: string;
  whyItMatters: string;
  watchFor: string;
}

export interface BriefingJournalSection {
  id: string;
  update: string;
}

export interface BriefingSections {
  headline: string;
  overview: string;
  watchlist: BriefingWatchlistSection[];
  journalIdeas: BriefingJournalSection[];
  risks: string[];
  monitor: string[];
  caveats: string[];
}

export interface BriefingPreferences {
  focusSessions: BriefingFocusSession[];
}

export interface BriefingRecord {
  dateKey: string;
  generatedAt: string;
  /** Model that wrote the structured brief, or null when no AI call was made. */
  model: string | null;
  /** Legacy plain-text narrative from briefs stored before version 2. */
  narrative: string | null;
  sections: BriefingSections | null;
  /** Set when the AI call failed or the provider is not configured. */
  error: string | null;
  snapshot: BriefingSnapshot;
}

export interface BriefingResponse {
  /** False means no API key is saved; the page asks the owner to add one. */
  aiReady: boolean;
  briefing: BriefingRecord | null;
  preferences: BriefingPreferences;
}
