// Shapes for the Session Analysis feature.
//
// One document represents one daily AI market analysis email. Each market keeps
// the exact text from that email plus a reference to the chart image that was
// embedded with it. The public types below are what the browser receives; the
// mailbox credentials and raw message never leave the server.

export type SessionLevelType = "support" | "resistance";

export interface ParsedMarket {
  symbol: string;
  targetLevel: string | null;
  targetPeriod: string | null;
  interval: string | null;
  pattern: string | null;
  identifiedAt: string | null;
  reason: string | null;
  supporting: string[];
  levelType: SessionLevelType | null;
  levelValue: string | null;
  levelNote: string | null;
}

export interface ParsedImage {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  /** Alt text or attachment filename, used to pair an image with a symbol. */
  label: string | null;
}

export interface ParsedSession {
  sessionKey: string;
  sessionDate: string;
  subject: string;
  sender: string;
  receivedAt: string;
  generatedAt: string | null;
  markets: ParsedMarket[];
}

export interface SessionMarket extends ParsedMarket {
  /** Public image path, or null when the email had no chart for this market. */
  chartUrl: string | null;
}

export interface SessionDay {
  sessionKey: string;
  sessionDate: string;
  subject: string;
  sender: string | null;
  receivedAt: string | null;
  generatedAt: string | null;
  markets: SessionMarket[];
}

export interface SessionDaySummary {
  sessionKey: string;
  sessionDate: string;
  subject: string;
  generatedAt: string | null;
  marketCount: number;
}

export interface SessionLatestResponse {
  day: SessionDay | null;
  days: SessionDaySummary[];
}

export interface SessionSyncResult {
  ok: boolean;
  /** False when the IMAP integration is missing, disabled or unusable. */
  configured: boolean;
  imported: boolean;
  sessionKey: string | null;
  markets: number;
  message: string;
  checkedAt: string;
}
