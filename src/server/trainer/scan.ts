// Historical scanner for the trainer (Phase 2).
//
// Walks every closed bar, runs the detectors, applies the context/horizon guards
// from docs/TRAINER_TAXONOMY.md, assigns stable ids, and emits the reviewable
// candidates CSV under data/trainer/candidates/.
//
// The scan is pure and deterministic: no randomness, no clock reads unless the
// caller asks for one, and a series always yields the same candidates in the
// same order. The per-tag cap is applied by even spacing over the sorted match
// list, so a cap of 10 keeps matches spread across the whole history instead of
// the first 10 hits.
//
// CLI: `pnpm trainer:scan` reads every stored TrainerBars series, scans it, and
// writes one CSV for the run, printing per-pair and per-tag counts.

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

import { connectDb } from "../db";
import type { Candle } from "../market/types";
import { readTrainerBars } from "./bars";
import {
  BARRIER_HORIZON,
  SCAN_CAP_PER_TAG_PER_SERIES,
  SYMBOLS,
  TAGS,
  TIMEFRAMES,
} from "./config";
import { detectAll } from "./detectors";
import type { Candidate, Tag, TrainerSymbol, TrainerTimeframe } from "./types";

/** At least 60 closed bars of context before the cut, per the taxonomy. */
export const MIN_CONTEXT_BARS = 60;

/** Relative directory for emitted candidate CSVs. */
export const CANDIDATES_DIR = path.join("data", "trainer", "candidates");

/** Exact column order for the candidates CSV. */
export const CANDIDATE_COLUMNS = [
  "id",
  "symbol",
  "timeframe",
  "cutIndex",
  "tag",
  "family",
  "direction",
  "startIndex",
  "endIndex",
  "levelUpper",
  "levelLower",
  "neckline",
  "notes",
] as const;

export interface ScanResult {
  /** Guarded candidates after the per-tag cap, sorted chronologically. */
  candidates: Candidate[];
  /** Valid matches per tag before the cap. */
  matchedByTag: Record<Tag, number>;
  /** Candidates actually emitted per tag after the cap. */
  emittedByTag: Record<Tag, number>;
}

export interface EmitCandidatesResult {
  runId: string;
  path: string;
  rows: number;
}

function emptyTagCounts(): Record<Tag, number> {
  const out = {} as Record<Tag, number>;
  for (const tag of TAGS) out[tag] = 0;
  return out;
}

/** True when the cut has enough context behind it and horizon ahead of it. */
export function isReviewable(cutIndex: number, barCount: number): boolean {
  return (
    Number.isInteger(cutIndex) &&
    cutIndex >= MIN_CONTEXT_BARS &&
    cutIndex + BARRIER_HORIZON <= barCount - 1
  );
}

/**
 * Keep at most `cap` items, evenly spaced across the sorted list. Includes the
 * first and last item when there is room, and never returns duplicates.
 */
export function sampleEvenly<T>(items: readonly T[], cap: number): T[] {
  if (cap <= 0 || items.length === 0) return [];
  if (items.length <= cap) return [...items];
  if (cap === 1) return [items[Math.floor((items.length - 1) / 2)]];

  const out: T[] = [];
  let last = -1;
  for (let k = 0; k < cap; k++) {
    let index = Math.round((k * (items.length - 1)) / (cap - 1));
    if (index <= last) index = last + 1;
    if (index >= items.length) index = items.length - 1;
    if (index === last) continue;
    out.push(items[index]);
    last = index;
  }
  return out;
}

/** Stable comparison so ties never depend on detector order. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.cutIndex - b.cutIndex ||
    a.bounds.startIndex - b.bounds.startIndex ||
    a.bounds.endIndex - b.bounds.endIndex ||
    a.tag.localeCompare(b.tag) ||
    a.id.localeCompare(b.id)
  );
}

/** Scan one series, enforce guards, cap each tag, and sort chronologically. */
export function scanSeries(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[],
  cap: number = SCAN_CAP_PER_TAG_PER_SERIES
): ScanResult {
  const matchesByTag = new Map<Tag, Candidate[]>();
  for (const tag of TAGS) matchesByTag.set(tag, []);

  for (let i = 0; i < bars.length; i++) {
    for (const hit of detectAll(symbol, timeframe, bars, i)) {
      if (!isReviewable(hit.cutIndex, bars.length)) continue;
      const bucket = matchesByTag.get(hit.tag);
      if (bucket) bucket.push(hit);
    }
  }

  const matchedByTag = emptyTagCounts();
  const emittedByTag = emptyTagCounts();
  const candidates: Candidate[] = [];

  for (const tag of TAGS) {
    const bucket = matchesByTag.get(tag) ?? [];
    bucket.sort(compareCandidates);
    matchedByTag[tag] = bucket.length;

    const kept = sampleEvenly(bucket, cap);
    emittedByTag[tag] = kept.length;
    candidates.push(...kept);
  }

  candidates.sort(compareCandidates);
  return { candidates, matchedByTag, emittedByTag };
}

/** Backwards-compatible wrapper used by earlier phases and tests. */
export function scanHistory(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe,
  bars: readonly Candle[]
): Candidate[] {
  return scanSeries(symbol, timeframe, bars).candidates;
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function candidateRow(candidate: Candidate): string {
  const cells = [
    candidate.id,
    candidate.symbol,
    candidate.timeframe,
    candidate.cutIndex,
    candidate.tag,
    candidate.family,
    candidate.direction,
    candidate.bounds.startIndex,
    candidate.bounds.endIndex,
    candidate.levels.levelUpper,
    candidate.levels.levelLower,
    candidate.levels.neckline,
    candidate.notes,
  ];
  return cells.map(csvCell).join(",");
}

/** Serialize candidates with the exact review column schema. */
export function candidatesCsv(candidates: readonly Candidate[]): string {
  const lines = [CANDIDATE_COLUMNS.join(",")];
  for (const candidate of candidates) lines.push(candidateRow(candidate));
  return lines.join("\n") + "\n";
}

/** Default run id: UTC timestamp, filename-safe. */
export function defaultRunId(now: number = Date.now()): string {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

/** Write the candidates CSV and return where it went. */
export async function emitCandidatesCsv(
  candidates: readonly Candidate[],
  options: {
    dir?: string;
    runId?: string;
    now?: number;
  } = {}
): Promise<EmitCandidatesResult> {
  const dir = options.dir ?? CANDIDATES_DIR;
  const runId = options.runId ?? defaultRunId(options.now);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${runId}.csv`);
  await writeFile(file, candidatesCsv(candidates), "utf8");
  return { runId, path: file, rows: candidates.length };
}

interface SeriesScanSummary {
  symbol: TrainerSymbol;
  timeframe: TrainerTimeframe;
  bars: number;
  matched: number;
  emitted: number;
  matchedByTag: Record<Tag, number>;
  emittedByTag: Record<Tag, number>;
}

function addCounts(
  target: Record<Tag, number>,
  source: Record<Tag, number>
): void {
  for (const tag of TAGS) target[tag] += source[tag];
}

async function main(): Promise<void> {
  await connectDb();

  const candidates: Candidate[] = [];
  const matchedByTag = emptyTagCounts();
  const emittedByTag = emptyTagCounts();
  const summaries: SeriesScanSummary[] = [];

  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      const stored = await readTrainerBars(symbol, timeframe);
      if (!stored || stored.bars.length === 0) {
        process.stderr.write(
          `[trainer] ${symbol}:${timeframe} has no stored bars; run trainer:ingest first\n`
        );
        continue;
      }

      const result = scanSeries(symbol, timeframe, stored.bars);
      candidates.push(...result.candidates);
      addCounts(matchedByTag, result.matchedByTag);
      addCounts(emittedByTag, result.emittedByTag);

      const matched = TAGS.reduce((sum, tag) => sum + result.matchedByTag[tag], 0);
      const emitted = TAGS.reduce((sum, tag) => sum + result.emittedByTag[tag], 0);
      summaries.push({
        symbol,
        timeframe,
        bars: stored.bars.length,
        matched,
        emitted,
        matchedByTag: result.matchedByTag,
        emittedByTag: result.emittedByTag,
      });
    }
  }

  candidates.sort(compareCandidates);
  const output = await emitCandidatesCsv(candidates);

  const out = (line: string) => process.stdout.write(line + "\n");
  out(`TRAINER SCAN ${new Date().toISOString()}`);
  for (const s of summaries) {
    out(
      `${s.symbol.padEnd(4)} ${s.timeframe.padEnd(3)} bars=${String(s.bars).padStart(6)} ` +
        `matched=${String(s.matched).padStart(6)} emitted=${String(s.emitted).padStart(4)}`
    );
  }

  out("");
  out("tag                      matched  emitted");
  for (const tag of TAGS) {
    out(
      `${tag.padEnd(24)} ${String(matchedByTag[tag]).padStart(7)} ` +
        `${String(emittedByTag[tag]).padStart(8)}`
    );
  }

  out("");
  out(`runId=${output.runId} rows=${output.rows} path=${output.path}`);

  if (output.rows === 0) {
    process.stderr.write(
      "[trainer] scan produced no reviewable candidates; check the ingested bars\n"
    );
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(
        `trainer scan failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
