// Breakout run log. One JSON line per engine run (live hourly or backfill step):
//   { kind: "breakout_run", timestamp_utc, asOf, backfilled, evaluated, skipped, breakouts, ... }
// The breakouts inside are the record of what fired. Their ids are the dedup
// memory, so no separate state file is needed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EngineBreakout } from "./breakoutEngine";

export interface SymbolDiagnostic {
  lastClose4h: string | null;
  atr: number | null;
  candidates: number;
  sweepsRejected: number;
  awaiting: number;
}

export interface RunRecord {
  kind: "breakout_run";
  timestamp_utc: string;
  asOf: string;
  backfilled: boolean;
  evaluated: string[];
  skipped: Record<string, string>;
  breakouts: EngineBreakout[];
  /** Per evaluated symbol: why it did or did not fire. */
  diagnostics?: Record<string, SymbolDiagnostic>;
  error?: string;
  durationMs?: number;
}

export function breakoutsFile(): string {
  return process.env.BREAKOUTS_FILE || path.join(os.homedir(), "doochyweb", "openclaw-breakouts.jsonl");
}

export function readRuns(file: string = breakoutsFile()): RunRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: RunRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RunRecord;
      if (r && r.kind === "breakout_run") out.push(r);
    } catch {
      // Torn line from an interrupted append: skip it, the rest still reads.
    }
  }
  return out;
}

export function firedIds(runs: RunRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const r of runs) for (const b of r.breakouts) ids.add(b.id);
  return ids;
}

export function backfillDone(runs: RunRecord[]): boolean {
  return runs.some((r) => r.backfilled);
}

export function latestRun(runs: RunRecord[]): RunRecord | null {
  let best: RunRecord | null = null;
  for (const r of runs) {
    if (!best || Date.parse(r.timestamp_utc) >= Date.parse(best.timestamp_utc)) best = r;
  }
  return best;
}
