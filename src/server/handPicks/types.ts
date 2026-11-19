// Shapes for admin-authored Hand Picks.
//
// A pick is deliberately close to a Session Analysis market card so the public
// section reads the same way, but every field is written by an admin instead of
// being copied from the analysis email.

export type HandPickLevelType = "support" | "resistance";

/** The fields an admin can write. */
export interface HandPickInput {
  symbol: string;
  pattern: string | null;
  targetLevel: string | null;
  targetPeriod: string | null;
  interval: string | null;
  identifiedAt: string | null;
  reason: string | null;
  supporting: string[];
  levelType: HandPickLevelType | null;
  levelValue: string | null;
  levelNote: string | null;
  chartUrl: string | null;
}

/** What the browser receives. */
export interface HandPick extends HandPickInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Metadata read from a cTrader chartshot page. */
export interface HandPickChartshot {
  id: string;
  chartUrl: string;
  chartHtml: string;
  symbol: string | null;
  interval: string | null;
  identifiedAt: string | null;
}
