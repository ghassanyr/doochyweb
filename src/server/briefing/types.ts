// Shared shapes for the daily briefing.
//
// The brief is one document per user per UTC day: a frozen snapshot of the
// watchlist, the signals that were live at the time, and a short AI narrative
// over them. Freezing the snapshot is deliberate, so reopening the page later in
// the day shows the same numbers the prose was written about.

export interface BriefingMover {
  symbol: string;
  /** Latest daily close. */
  last: number;
  /** Percent change against the previous daily close. */
  changePct: number;
}

/** An active (unresolved) published signal. */
export interface BriefingSignal {
  id: string;
  symbol: string;
  direction: "buy" | "sell";
  entry: number | null;
  entryMax: number | null;
  target: number;
  stop: number;
  createdAt: string;
  ageHours: number;
}

export interface BriefingSnapshot {
  dateKey: string;
  generatedAt: string;
  movers: BriefingMover[];
  signals: BriefingSignal[];
}

export interface BriefingRecord {
  dateKey: string;
  generatedAt: string;
  /** Model that wrote the narrative, or null when no AI call was made. */
  model: string | null;
  narrative: string | null;
  /** Set when the AI call failed or the provider is not configured. */
  error: string | null;
  snapshot: BriefingSnapshot;
}

export interface BriefingResponse {
  /** False means no API key is saved; the page asks the owner to add one. */
  aiReady: boolean;
  briefing: BriefingRecord | null;
}
