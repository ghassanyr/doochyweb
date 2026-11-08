// CSV review workflow for the trainer (Phase 3).
//
// The scanner emits candidates; a human edits the review CSV in a spreadsheet
// and imports it back. This module keeps the CSV handling and validation pure so
// the store and CLI can share one contract. Imports never drop unedited rows:
// pending rows are upserted exactly like accepted and rejected ones.
//
// CLI: `pnpm trainer:review <export|import|stats|set> ...`.
//
//   export [--from=<candidatesCsv>] [--runId=<id>]
//   import --file=<reviewCsv> [--candidates=<candidatesCsv>]
//   stats [--file=<reviewCsv>]
//   set --id=<id> --status=accept|reject [--ambiguity=1-5]

import "dotenv/config";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { SYMBOLS, TAG_FAMILY, TAGS, TIMEFRAMES } from "./config";
import { readAll, readById, updateReview, upsertMany } from "./reviewStore";
import { CANDIDATES_DIR, CANDIDATE_COLUMNS } from "./scan";
import type {
  Candidate,
  Direction,
  ReviewRow,
  ReviewStatus,
  Tag,
  TagFamily,
  TrainerSymbol,
  TrainerTimeframe,
} from "./types";

/** Review output directory; `data/` is gitignored. */
export const REVIEW_DIR = path.join("data", "trainer", "review");

/** Candidate columns plus the two human-editable columns, in exact order. */
export const REVIEW_COLUMNS = [...CANDIDATE_COLUMNS, "status", "ambiguity"] as const;

export const REVIEW_STATUSES = ["pending", "accept", "reject"] as const;

export interface ReviewValidationError {
  /** 1-based CSV line number; the header is line 1, so data starts at line 2. */
  row: number;
  id: string;
  field: string;
  message: string;
}

export interface ReviewImportResult {
  rows: ReviewRow[];
  errors: ReviewValidationError[];
}

export interface ReviewStats {
  total: number;
  byStatus: Record<ReviewStatus, number>;
  byTag: Record<Tag, number>;
  byAmbiguity: Record<string, number>;
  bySeries: Record<string, number>;
}

// ------------------------------------------------------------------- CSV I/O

/** RFC4180-style parser: quoted cells, doubled quotes, commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }

  row.push(field);
  rows.push(row);

  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize rows with a trailing newline; empty input becomes an empty string. */
export function serializeCsv(rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return "";
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

function headerIndex(header: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim();
    if (!index.has(key)) index.set(key, i);
  });
  return index;
}

function missingColumns(
  index: ReadonlyMap<string, number>,
  columns: readonly string[]
): string[] {
  return columns.filter((column) => !index.has(column));
}

// -------------------------------------------------------------------- export

function candidateCells(
  candidate: Candidate,
  status: string,
  ambiguity: string
): string[] {
  return [
    candidate.id,
    candidate.symbol,
    candidate.timeframe,
    String(candidate.cutIndex),
    candidate.tag,
    candidate.family,
    candidate.direction ?? "",
    String(candidate.bounds.startIndex),
    String(candidate.bounds.endIndex),
    candidate.levels.levelUpper == null ? "" : String(candidate.levels.levelUpper),
    candidate.levels.levelLower == null ? "" : String(candidate.levels.levelLower),
    candidate.levels.neckline == null ? "" : String(candidate.levels.neckline),
    candidate.notes ?? "",
    status,
    ambiguity,
  ];
}

/**
 * Build the review CSV from a candidates CSV (or Candidate[]). Status and
 * ambiguity stay blank for unedited rows; if the input already carries those
 * columns their values are preserved.
 */
export function exportReviewCsv(input: readonly Candidate[] | string): string {
  const out: string[][] = [[...REVIEW_COLUMNS]];

  if (typeof input !== "string") {
    for (const candidate of input) out.push(candidateCells(candidate, "", ""));
    return serializeCsv(out);
  }

  const grid = parseCsv(input);
  if (grid.length === 0) return serializeCsv(out);

  const index = headerIndex(grid[0]);
  const missing = missingColumns(index, CANDIDATE_COLUMNS);
  if (missing.length) {
    throw new Error(`candidates CSV is missing column(s): ${missing.join(", ")}`);
  }

  const hasStatus = index.has("status");
  const hasAmbiguity = index.has("ambiguity");
  const get = (row: readonly string[], name: string): string => {
    const column = index.get(name);
    return column === undefined ? "" : row[column] ?? "";
  };

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (isBlankRow(row)) continue;
    out.push(
      CANDIDATE_COLUMNS.map((column) => get(row, column)).concat(
        hasStatus ? get(row, "status") : "",
        hasAmbiguity ? get(row, "ambiguity") : ""
      )
    );
  }

  return serializeCsv(out);
}

// ------------------------------------------------------------------- import

function parseNonNegativeInteger(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function parseOptionalPositive(raw: string): { ok: boolean; value: number | null } {
  const text = raw.trim();
  if (text === "" || text.toLowerCase() === "null") return { ok: true, value: null };
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, value: null };
  return { ok: true, value };
}

/**
 * Validate the review CSV row by row. Every error is collected with its CSV line
 * number; a bad row never stops later rows from being checked.
 */
export function importReviewCsv(
  text: string,
  knownIds?: ReadonlySet<string>
): ReviewImportResult {
  const grid = parseCsv(text);
  const rows: ReviewRow[] = [];
  const errors: ReviewValidationError[] = [];

  if (grid.length === 0) {
    return {
      rows,
      errors: [{ row: 1, id: "", field: "header", message: "review CSV is empty" }],
    };
  }

  const index = headerIndex(grid[0]);
  const missing = missingColumns(index, REVIEW_COLUMNS);
  if (missing.length) {
    return {
      rows,
      errors: [
        {
          row: 1,
          id: "",
          field: "header",
          message: `missing required column(s): ${missing.join(", ")}`,
        },
      ],
    };
  }

  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r];
    if (isBlankRow(raw)) continue;

    const rowNumber = r + 1;
    const cell = (name: string): string => {
      const column = index.get(name);
      return column === undefined ? "" : raw[column] ?? "";
    };
    const id = cell("id").trim();
    const addError = (field: string, message: string): void => {
      errors.push({ row: rowNumber, id, field, message });
    };

    const rawStatus = cell("status").trim().toLowerCase();
    let status: ReviewStatus = "pending";
    if (rawStatus !== "") {
      if (rawStatus === "accept" || rawStatus === "reject") status = rawStatus;
      else addError("status", "must be blank, accept or reject");
    }

    const rawAmbiguity = cell("ambiguity").trim();
    let ambiguity: number | null = null;
    if (rawAmbiguity !== "") {
      if (!/^\d+$/.test(rawAmbiguity)) {
        addError("ambiguity", "must be an integer 1..5 or blank");
      } else {
        const value = Number(rawAmbiguity);
        if (value < 1 || value > 5) {
          addError("ambiguity", "must be an integer 1..5 or blank");
        } else {
          ambiguity = value;
        }
      }
    }
    if (status === "accept" && rawAmbiguity === "") {
      addError("ambiguity", "required when status is accept");
    }

    const rawSymbol = cell("symbol").trim();
    let symbol: TrainerSymbol | null = null;
    if ((SYMBOLS as readonly string[]).includes(rawSymbol)) {
      symbol = rawSymbol as TrainerSymbol;
    } else {
      addError("symbol", `must be one of ${SYMBOLS.join(", ")}`);
    }

    const rawTimeframe = cell("timeframe").trim();
    let timeframe: TrainerTimeframe | null = null;
    if ((TIMEFRAMES as readonly string[]).includes(rawTimeframe)) {
      timeframe = rawTimeframe as TrainerTimeframe;
    } else {
      addError("timeframe", `must be one of ${TIMEFRAMES.join(", ")}`);
    }

    const rawTag = cell("tag").trim();
    let tag: Tag | null = null;
    if ((TAGS as readonly string[]).includes(rawTag)) {
      tag = rawTag as Tag;
    } else {
      addError("tag", `must be one of ${TAGS.join(", ")}`);
    }

    let family: TagFamily | null = null;
    if (tag) {
      const expected = TAG_FAMILY[tag];
      if (cell("family").trim() !== expected) {
        addError("family", `must be "${expected}" for tag ${tag}`);
      } else {
        family = expected;
      }
    } else {
      addError("family", "cannot be checked without a valid tag");
    }

    const rawDirection = cell("direction").trim();
    let direction: Direction | null = null;
    let directionValid = true;
    if (rawDirection === "up" || rawDirection === "down") direction = rawDirection;
    else if (rawDirection !== "") {
      directionValid = false;
      addError("direction", "must be up, down or blank");
    }

    const cutIndex = parseNonNegativeInteger(cell("cutIndex"));
    if (cutIndex === null) addError("cutIndex", "must be a non-negative integer");

    const startIndex = parseNonNegativeInteger(cell("startIndex"));
    if (startIndex === null) addError("startIndex", "must be a non-negative integer");

    const endIndex = parseNonNegativeInteger(cell("endIndex"));
    if (endIndex === null) addError("endIndex", "must be a non-negative integer");

    if (startIndex !== null && endIndex !== null && startIndex > endIndex) {
      addError("startIndex", "startIndex must be <= endIndex");
    }

    const levelUpper = parseOptionalPositive(cell("levelUpper"));
    if (!levelUpper.ok) {
      addError("levelUpper", "must be blank, null or a finite positive number");
    }
    const levelLower = parseOptionalPositive(cell("levelLower"));
    if (!levelLower.ok) {
      addError("levelLower", "must be blank, null or a finite positive number");
    }
    const neckline = parseOptionalPositive(cell("neckline"));
    if (!neckline.ok) {
      addError("neckline", "must be blank, null or a finite positive number");
    }

    if (tag === "sweep_up" || tag === "sweep_down") {
      if (levelUpper.value === null) addError("levelUpper", `required for ${tag}`);
      if (levelLower.value === null) addError("levelLower", `required for ${tag}`);
    } else if (tag === "double_top" || tag === "double_bottom") {
      if (neckline.value === null) addError("neckline", `required for ${tag}`);
    } else if (tag === "sr_flip") {
      if (direction === "up" && levelLower.value === null) {
        addError("levelLower", "required for sr_flip up");
      }
      if (direction === "down" && levelUpper.value === null) {
        addError("levelUpper", "required for sr_flip down");
      }
    } else if (tag === "bos" || tag === "choch") {
      if (direction === "up" && levelUpper.value === null) {
        addError("levelUpper", `required for ${tag} up`);
      }
      if (direction === "down" && levelLower.value === null) {
        addError("levelLower", `required for ${tag} down`);
      }
    }

    if (
      symbol &&
      timeframe &&
      tag &&
      startIndex !== null &&
      endIndex !== null &&
      directionValid
    ) {
      const expectedId = `${symbol}:${timeframe}:${tag}:${startIndex}-${endIndex}:${
        direction ?? "none"
      }`;
      if (id !== expectedId) {
        addError("id", `id and bounds are read-only; expected "${expectedId}"`);
      } else if (knownIds && !knownIds.has(id)) {
        addError("id", "id is not present in the candidates CSV");
      }
    }

    if (errors.some((error) => error.row === rowNumber)) continue;
    if (
      symbol === null ||
      timeframe === null ||
      tag === null ||
      family === null ||
      cutIndex === null ||
      startIndex === null ||
      endIndex === null
    ) {
      continue;
    }

    rows.push({
      id,
      symbol,
      timeframe,
      cutIndex,
      tag,
      family,
      direction,
      startIndex,
      endIndex,
      status,
      ambiguity,
      levelUpper: levelUpper.value,
      levelLower: levelLower.value,
      neckline: neckline.value,
      notes: cell("notes"),
    });
  }

  return { rows, errors };
}

// -------------------------------------------------------------------- stats

export function reviewStats(rows: readonly ReviewRow[]): ReviewStats {
  const byStatus: Record<ReviewStatus, number> = {
    pending: 0,
    accept: 0,
    reject: 0,
  };
  const byTag = {} as Record<Tag, number>;
  for (const tag of TAGS) byTag[tag] = 0;
  const byAmbiguity: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    blank: 0,
  };
  const bySeries: Record<string, number> = {};
  for (const symbol of SYMBOLS) {
    for (const timeframe of TIMEFRAMES) {
      bySeries[`${symbol}:${timeframe}`] = 0;
    }
  }

  for (const row of rows) {
    byStatus[row.status]++;
    byTag[row.tag]++;
    const ambiguityKey = row.ambiguity == null ? "blank" : String(row.ambiguity);
    byAmbiguity[ambiguityKey] = (byAmbiguity[ambiguityKey] ?? 0) + 1;
    const series = `${row.symbol}:${row.timeframe}`;
    bySeries[series] = (bySeries[series] ?? 0) + 1;
  }

  return { total: rows.length, byStatus, byTag, byAmbiguity, bySeries };
}

// ---------------------------------------------------------------------- CLI

interface CliArgs {
  command: string | null;
  flags: Map<string, string>;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  let command: string | null = null;
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) flags.set(arg.slice(2), "true");
      else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (command === null) {
      command = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return { command, flags };
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value || value === "true") throw new Error(`--${name}=<value> is required`);
  return value;
}

function countDataRows(text: string): number {
  const grid = parseCsv(text);
  if (grid.length === 0) return 0;
  let count = 0;
  for (let r = 1; r < grid.length; r++) {
    if (!isBlankRow(grid[r])) count++;
  }
  return count;
}

function candidateIds(text: string): Set<string> {
  const grid = parseCsv(text);
  if (grid.length === 0) return new Set();
  const index = headerIndex(grid[0]);
  const column = index.get("id");
  if (column === undefined) throw new Error('candidates CSV is missing the "id" column');
  const ids = new Set<string>();
  for (let r = 1; r < grid.length; r++) {
    if (isBlankRow(grid[r])) continue;
    const id = (grid[r][column] ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

async function newestCandidatesCsv(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: { name: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".csv")) continue;
    const info = await stat(path.join(dir, entry.name));
    files.push({ name: entry.name, mtimeMs: info.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  if (files.length === 0) {
    throw new Error(`no candidates CSV in ${dir}; run trainer:scan first`);
  }
  return path.join(dir, files[0].name);
}

function printStats(label: string, stats: ReviewStats): void {
  const out = (line: string) => process.stdout.write(line + "\n");
  out(`TRAINER REVIEW STATS ${label}`);
  out(`total=${stats.total}`);
  out(`status ${REVIEW_STATUSES.map((s) => `${s}=${stats.byStatus[s]}`).join(" ")}`);
  out(`tag ${TAGS.map((tag) => `${tag}=${stats.byTag[tag]}`).join(" ")}`);
  out(
    `ambiguity ${Object.entries(stats.byAmbiguity)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`
  );
  out(
    `series ${Object.entries(stats.bySeries)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")}`
  );
}

async function cmdExport(flags: ReadonlyMap<string, string>): Promise<void> {
  const from = flags.get("from") ?? (await newestCandidatesCsv(CANDIDATES_DIR));
  const source = await readFile(from, "utf8");
  const runId =
    flags.get("runId") ??
    path.basename(from).replace(/\.csv$/i, "");
  const reviewText = exportReviewCsv(source);

  await mkdir(REVIEW_DIR, { recursive: true });
  const file = path.join(REVIEW_DIR, `${runId}.review.csv`);
  await writeFile(file, reviewText, "utf8");

  const out = (line: string) => process.stdout.write(line + "\n");
  out("TRAINER REVIEW EXPORT");
  out(`source=${from}`);
  out(`runId=${runId}`);
  out(`rows=${countDataRows(reviewText)}`);
  out(`path=${file}`);
}

async function cmdImport(flags: ReadonlyMap<string, string>): Promise<void> {
  const file = requiredFlag(flags, "file");
  const text = await readFile(file, "utf8");
  const candidatesPath = flags.get("candidates");
  const knownIds = candidatesPath
    ? candidateIds(await readFile(candidatesPath, "utf8"))
    : undefined;

  const result = importReviewCsv(text, knownIds);
  const total = countDataRows(text);
  const statusCounts: Record<ReviewStatus, number> = {
    pending: 0,
    accept: 0,
    reject: 0,
  };
  for (const row of result.rows) statusCounts[row.status]++;

  const base = path.basename(file);
  const runId =
    flags.get("runId") ??
    (base.endsWith(".review.csv")
      ? base.slice(0, -".review.csv".length)
      : base.replace(/\.csv$/i, ""));
  const summary = await upsertMany(result.rows, runId);

  const out = (line: string) => process.stdout.write(line + "\n");
  out("TRAINER REVIEW IMPORT");
  out(`file=${file}`);
  if (candidatesPath) out(`candidates=${candidatesPath}`);
  out(`sourceRunId=${runId}`);
  out(`rows=${total} valid=${result.rows.length} errors=${result.errors.length}`);
  out(
    `status pending=${statusCounts.pending} accept=${statusCounts.accept} reject=${statusCounts.reject}`
  );
  out(
    `store matched=${summary.matched} upserted=${summary.upserted} modified=${summary.modified}`
  );
  for (const error of result.errors) {
    out(
      `row ${error.row} field=${error.field} id=${error.id || "-"}: ${error.message}`
    );
  }
  if (result.errors.length) process.exitCode = 1;
}

async function cmdStats(flags: ReadonlyMap<string, string>): Promise<void> {
  const file = flags.get("file");
  if (file) {
    const text = await readFile(file, "utf8");
    const result = importReviewCsv(text);
    printStats(`file=${file}`, reviewStats(result.rows));
    if (result.errors.length) {
      process.stderr.write(
        `[trainer] ${result.errors.length} invalid row(s); stats cover the ${result.rows.length} valid row(s)\n`
      );
      for (const error of result.errors) {
        process.stderr.write(
          `row ${error.row} field=${error.field} id=${error.id || "-"}: ${error.message}\n`
        );
      }
    }
    return;
  }

  const rows = await readAll();
  printStats("store", reviewStats(rows));
}

async function cmdSet(flags: ReadonlyMap<string, string>): Promise<void> {
  const id = requiredFlag(flags, "id");
  const rawStatus = requiredFlag(flags, "status").trim().toLowerCase();
  if (rawStatus !== "accept" && rawStatus !== "reject") {
    throw new Error("--status must be accept or reject");
  }
  const status = rawStatus as ReviewStatus;

  const existing = await readById(id);
  if (!existing) throw new Error(`no stored review with id ${id}; import first`);

  const rawAmbiguity = flags.get("ambiguity");
  let ambiguity = existing.ambiguity;
  if (rawAmbiguity !== undefined) {
    if (!/^\d+$/.test(rawAmbiguity.trim())) {
      throw new Error("--ambiguity must be an integer 1..5");
    }
    const value = Number(rawAmbiguity);
    if (value < 1 || value > 5) {
      throw new Error("--ambiguity must be an integer 1..5");
    }
    ambiguity = value;
  }
  if (status === "accept" && ambiguity === null) {
    throw new Error("--ambiguity is required when setting accept");
  }

  const updated = await updateReview(id, { status, ambiguity });
  if (!updated) throw new Error(`failed to update review ${id}`);

  const out = (line: string) => process.stdout.write(line + "\n");
  out("TRAINER REVIEW SET");
  out(`id=${id}`);
  out(`status ${existing.status} -> ${updated.status}`);
  out(
    `ambiguity ${existing.ambiguity ?? "blank"} -> ${updated.ambiguity ?? "blank"}`
  );
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: pnpm trainer:review <command> [--flag=value]",
      "  export [--from=<candidatesCsv>] [--runId=<id>]",
      "  import --file=<reviewCsv> [--candidates=<candidatesCsv>]",
      "  stats [--file=<reviewCsv>]",
      "  set --id=<id> --status=accept|reject [--ambiguity=1-5]",
    ].join("\n") + "\n"
  );
}

async function main(): Promise<void> {
  const { command, flags } = parseCliArgs(process.argv.slice(2));
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  await connectDb();
  switch (command) {
    case "export":
      await cmdExport(flags);
      break;
    case "import":
      await cmdImport(flags);
      break;
    case "stats":
      await cmdStats(flags);
      break;
    case "set":
      await cmdSet(flags);
      break;
    default:
      printUsage();
      throw new Error(`unknown review command: ${command}`);
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(
        `trainer review failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
