// Reader for the OpenClaw capture log written by the doochy-scraper skill.
//
// The skill appends one JSON object per line (JSONL) to
// ~/doochyweb/openclaw-captures.json. The cron agent has emitted two slightly
// different shapes over time (field/old/new vs change_type/from/to), so this
// normalises both into one view for the UI. Malformed lines are skipped rather
// than failing the whole read: the file is written by another process.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CaptureChange {
  symbol: string;
  /** "signal" or "patterns" for the known shapes; free text otherwise. */
  field: string;
  old: string;
  new: string;
}

export interface CaptureAlignment {
  symbol: string;
  details: string;
  type: string;
  signal: string;
}

export interface CaptureNeedle {
  symbol: string;
  kind: string;
  level: string;
}

export interface CaptureSummary {
  strong_buy: number;
  strong_sell: number;
  engulf_alignments: number;
  triple_alignments: number;
}

export interface CaptureView {
  schema_version: number | null;
  timestamp_utc: string;
  session: string;
  capture_type: string;
  market_count: number;
  changes: CaptureChange[];
  true_alignments: { engulf_1h_4h: CaptureAlignment[]; triple: CaptureAlignment[] };
  needles_fired: CaptureNeedle[];
  summary: CaptureSummary;
  next_check_utc: string | null;
}

export function capturesPath(): string {
  return (
    process.env.OPENCLAW_CAPTURES_FILE ||
    path.join(os.homedir(), "doochyweb", "openclaw-captures.json")
  );
}

function str(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

function changeField(kind: string): string {
  if (kind === "signal_flip") return "signal";
  if (kind === "pattern_change") return "patterns";
  return kind || "change";
}

function normalizeChanges(raw: unknown): CaptureChange[] {
  const out: CaptureChange[] = [];
  for (const c of arr(raw)) {
    const symbol = str(c.symbol);
    if (!symbol) continue;

    if (c.field !== undefined || c.old !== undefined || c.new !== undefined) {
      out.push({ symbol, field: str(c.field) || "change", old: str(c.old), new: str(c.new) });
      continue;
    }

    const kind = str(c.change_type) || str(c.change);
    if (kind) {
      out.push({ symbol, field: changeField(kind), old: str(c.from), new: str(c.to) });
    }
    // Some rows also carry a pattern note alongside a signal flip, e.g.
    // { change: "signal_flip", pattern_change: "Bull engulf removed" }.
    if (c.pattern_change) {
      out.push({
        symbol,
        field: "patterns",
        old: str(c.pattern_change).replace(/\s+removed$/i, ""),
        new: "",
      });
    }
  }
  return out;
}

function normalizeAlignments(raw: unknown): CaptureAlignment[] {
  return arr(raw).map((a) => ({
    symbol: str(a.symbol),
    details: str(a.details),
    type: str(a.type),
    signal: str(a.signal),
  }));
}

function normalizeNeedles(raw: unknown): CaptureNeedle[] {
  return arr(raw).map((n) => ({
    symbol: str(n.symbol),
    kind: str(n.kind),
    level: str(n.level),
  }));
}

export function normalizeCapture(raw: Record<string, unknown>): CaptureView {
  const ta = (raw.true_alignments && typeof raw.true_alignments === "object"
    ? raw.true_alignments
    : {}) as Record<string, unknown>;
  const summary = (raw.summary && typeof raw.summary === "object"
    ? raw.summary
    : {}) as Record<string, unknown>;
  const engulf = normalizeAlignments(ta.engulf_1h_4h);

  return {
    schema_version: raw.schema_version != null ? num(raw.schema_version) : null,
    timestamp_utc: str(raw.timestamp_utc),
    session: str(raw.session),
    capture_type: str(raw.capture_type) || "hourly",
    market_count: num(raw.market_count),
    changes: normalizeChanges(raw.changes),
    true_alignments: { engulf_1h_4h: engulf, triple: normalizeAlignments(ta.triple) },
    needles_fired: normalizeNeedles(raw.needles_fired),
    summary: {
      strong_buy: num(summary.strong_buy),
      strong_sell: num(summary.strong_sell),
      engulf_alignments: num(
        summary.engulf_alignments ?? summary.engulf_1h_4h ?? summary.true_1h_4h_alignments
      ),
      triple_alignments: num(summary.triple_alignments ?? summary.triple),
    },
    next_check_utc: str(raw.next_check_utc) || null,
  };
}

/** Newest first, capped at `limit`. Missing file reads as empty. */
export async function readCaptures(limit = 40): Promise<CaptureView[]> {
  let text: string;
  try {
    text = await fs.promises.readFile(capturesPath(), "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }

  const views: CaptureView[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") views.push(normalizeCapture(parsed));
    } catch {
      // Skip a torn or malformed line; the next valid line still renders.
    }
  }

  views.sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc));
  return views.slice(0, Math.max(1, limit));
}
