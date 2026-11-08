// Batch builder and publisher for the trainer (Phase 4).
//
// `buildBatch` is pure and deterministic: it consumes accepted review rows and
// the real bar series, resolves outcomes mechanically, enforces reveal-window
// non-overlap, optionally balances outcome share, and returns a frozen batch.
// `publishBatch` is the only I/O path; it writes the immutable JSON snapshot and
// upserts the Mongo batch/item documents.
//
// CLI: `pnpm trainer:publish --version=v1 [--dry-run] ...` reads accepted
// reviews, builds the batch, reports counts and writes nothing on a dry run.

import "dotenv/config";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

import { connectDb } from "../db";
import type { Candle } from "../market/types";
import { readTrainerBars } from "./bars";
import {
  BALANCE_MAX_SHARE,
  BARRIER_ATR_MULT,
  BARRIER_HORIZON,
  CONTEXT_MAX_BARS,
  SYMBOLS,
  TAGS,
  TIMEFRAMES,
} from "./config";
import { barrierFor, computeOutcome } from "./outcomes";
import { readAll } from "./reviewStore";
import { sampleEvenly } from "./scan";
import type {
  Outcome,
  ReviewRow,
  TrainerBatch,
  TrainerItem,
  TrainerSymbol,
  TrainerTimeframe,
} from "./types";

/** Relative directory for immutable batch snapshots. `data/` is gitignored. */
export const BATCHES_DIR = path.join("data", "trainer", "batches");

/** Bar series keyed by `${symbol}:${timeframe}`. */
export type BarsBySeries = Record<string, readonly Candle[]>;

export function seriesKey(
  symbol: TrainerSymbol,
  timeframe: TrainerTimeframe
): string {
  return `${symbol}:${timeframe}`;
}

export type DropReason = "invalid" | "overlap" | "balance";

export interface PublishDrop {
  id: string;
  reason: DropReason;
  detail: string;
}

/** A built batch plus the build-time drop report (non-enumerable on the batch). */
export type BuiltBatch = TrainerBatch & { readonly drops: readonly PublishDrop[] };

export interface BuildBatchOptions {
  version: string;
  /** Fixed build time for deterministic tests; defaults to Date.now(). */
  now?: number;
  /** Keep overlapping reveal windows instead of dropping later cuts. */
  allowOverlap?: boolean;
  /** Downsample any outcome above BALANCE_MAX_SHARE of the batch. */
  balance?: boolean;
  /** Drop invalid rows and report them instead of failing the whole build. */
  skipInvalid?: boolean;
  /** Context bars shown before the cut, including the cut bar. */
  contextMax?: number;
}

export interface PublishBatchOptions {
  dir?: string;
  force?: boolean;
}

export interface PublishBatchResult {
  version: string;
  path: string;
  items: number;
}

export interface WriteBatchResult {
  path: string;
}

// ---------------------------------------------------------------- Mongo models

type BatchDoc = {
  _id: string;
  createdAt: number;
  symbols: string[];
  timeframes: string[];
  barrierAtrMult: number;
  barrierHorizon: number;
  baseRates: Record<string, Record<string, number>>;
  baseRateCounts: Record<string, Record<string, number>>;
  itemCount: number;
  publishedAt: Date;
};

type ItemDoc = {
  _id: string;
  batchVersion: string;
  [key: string]: unknown;
};

const batchSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    createdAt: { type: Number, required: true },
    symbols: { type: [String], default: [] },
    timeframes: { type: [String], default: [] },
    barrierAtrMult: { type: Number, required: true },
    barrierHorizon: { type: Number, required: true },
    baseRates: { type: mongoose.Schema.Types.Mixed, required: true },
    baseRateCounts: { type: mongoose.Schema.Types.Mixed, required: true },
    itemCount: { type: Number, required: true },
    publishedAt: { type: Date, required: true },
  },
  { versionKey: false, strict: false }
);

const itemSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    batchVersion: { type: String, required: true },
  },
  { versionKey: false, strict: false }
);

export const TrainerBatches =
  (mongoose.models.TrainerBatches as mongoose.Model<BatchDoc> | undefined) ||
  mongoose.model<BatchDoc>("TrainerBatches", batchSchema);

export const TrainerItems =
  (mongoose.models.TrainerItems as mongoose.Model<ItemDoc> | undefined) ||
  mongoose.model<ItemDoc>("TrainerItems", itemSchema);

// ------------------------------------------------------------------- helpers

function emptyOutcomeCounts(): Record<Outcome, number> {
  return { up: 0, down: 0, scratch: 0 };
}

function countOutcomes(outcomes: readonly Outcome[]): Record<Outcome, number> {
  const counts = emptyOutcomeCounts();
  for (const outcome of outcomes) counts[outcome]++;
  return counts;
}

function outcomeTotal(counts: Record<Outcome, number>): number {
  return counts.up + counts.down + counts.scratch;
}

function freezeCounts(
  counts: Record<string, Record<Outcome, number>>
): Record<string, Record<Outcome, number>> {
  for (const value of Object.values(counts)) Object.freeze(value);
  return Object.freeze(counts);
}

function freezeItem(item: TrainerItem): TrainerItem {
  Object.freeze(item.bounds);
  Object.freeze(item.levels);
  Object.freeze(item.barrier);
  return Object.freeze(item);
}

function compareRows(a: ReviewRow, b: ReviewRow): number {
  const symbolRank = SYMBOLS.indexOf(a.symbol) - SYMBOLS.indexOf(b.symbol);
  if (symbolRank !== 0) return symbolRank;
  const timeframeRank =
    TIMEFRAMES.indexOf(a.timeframe) - TIMEFRAMES.indexOf(b.timeframe);
  if (timeframeRank !== 0) return timeframeRank;
  return a.cutIndex - b.cutIndex || a.id.localeCompare(b.id);
}

function whyFor(
  tag: string,
  outcome: Outcome,
  outcomeIndex: number | null,
  cutIndex: number,
  horizon: number,
  ambiguousSameBar: boolean
): string {
  if (outcome === "scratch") {
    if (ambiguousSameBar) {
      return `${tag}: both barriers touched in the same bar; scratch.`;
    }
    return `${tag}: neither barrier reached within ${horizon} bars.`;
  }

  const side = outcome === "up" ? "upper" : "lower";
  const bars = outcomeIndex === null ? 0 : outcomeIndex - cutIndex;
  const suffix = ambiguousSameBar ? " Both barriers touched in the same bar." : "";
  return `${tag}: ${side} barrier reached after ${bars} bar(s).${suffix}`;
}

/**
 * Cap any over-represented outcome at BALANCE_MAX_SHARE of the batch, measured
 * before the drop, using even spacing. More than one outcome cannot exceed 70%
 * at once, but every outcome is checked so the rule survives future changes.
 */
function applyBalance(
  items: readonly { item: TrainerItem; outcome: Outcome }[],
  drops: PublishDrop[]
): { item: TrainerItem; outcome: Outcome }[] {
  const total = items.length;
  if (total <= 1) return [...items];

  const counts = countOutcomes(items.map((entry) => entry.outcome));
  const target = Math.max(1, Math.floor(total * BALANCE_MAX_SHARE));
  let kept = [...items];

  for (const over of ["up", "down", "scratch"] as const) {
    if (counts[over] <= total * BALANCE_MAX_SHARE) continue;

    const group = kept.filter((entry) => entry.outcome === over);
    if (target >= group.length) continue;

    const keptIds = new Set(sampleEvenly(group, target).map((entry) => entry.item.id));
    for (const entry of group) {
      if (keptIds.has(entry.item.id)) continue;
      drops.push({
        id: entry.item.id,
        reason: "balance",
        detail: `outcome ${over} exceeded ${Math.round(
          BALANCE_MAX_SHARE * 100
        )}% of ${total} items`,
      });
    }

    kept = kept.filter(
      (entry) => entry.outcome !== over || keptIds.has(entry.item.id)
    );
  }

  return kept;
}

// ----------------------------------------------------------------- buildBatch

/**
 * Build a frozen batch from review rows. Only accepted rows are considered.
 * Invalid cuts fail the build by default; `skipInvalid` drops and reports them.
 * Overlap is enforced per series unless `allowOverlap` is set, and every drop is
 * recorded on the returned batch's non-enumerable `drops` array.
 */
export function buildBatch(
  rows: readonly ReviewRow[],
  barsBySeries: BarsBySeries,
  options: BuildBatchOptions
): BuiltBatch {
  const version = options.version.trim();
  if (!version) throw new Error("batch version is required");

  const accepted = rows.filter((row) => row.status === "accept").sort(compareRows);
  const drops: PublishDrop[] = [];
  const invalid: string[] = [];
  const valid: {
    row: ReviewRow;
    barrier: ReturnType<typeof barrierFor>;
    result: ReturnType<typeof computeOutcome>;
  }[] = [];

  for (const row of accepted) {
    const bars = barsBySeries[seriesKey(row.symbol, row.timeframe)];
    if (!bars || bars.length === 0) {
      const detail = `no stored bars for ${seriesKey(row.symbol, row.timeframe)}`;
      invalid.push(`${row.id} (${detail})`);
      if (options.skipInvalid) drops.push({ id: row.id, reason: "invalid", detail });
      continue;
    }

    try {
      const barrier = barrierFor(bars, row.cutIndex);
      const result = computeOutcome(bars, barrier);
      valid.push({ row, barrier, result });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      invalid.push(`${row.id} (${detail})`);
      if (options.skipInvalid) drops.push({ id: row.id, reason: "invalid", detail });
    }
  }

  if (invalid.length && !options.skipInvalid) {
    throw new Error(
      `cannot build batch: ${invalid.length} invalid accepted row(s): ${invalid.join("; ")}`
    );
  }

  const built = valid.map((entry) => {
    const { row, barrier, result } = entry;
    const contextMax = options.contextMax ?? CONTEXT_MAX_BARS;
    const item: TrainerItem = {
      id: row.id,
      batchVersion: version,
      symbol: row.symbol,
      timeframe: row.timeframe,
      tag: row.tag,
      family: row.family,
      direction: row.direction,
      contextStartIndex: Math.max(0, row.cutIndex - (contextMax - 1)),
      cutIndex: row.cutIndex,
      bounds: { startIndex: row.startIndex, endIndex: row.endIndex },
      levels: {
        levelUpper: row.levelUpper,
        levelLower: row.levelLower,
        neckline: row.neckline,
      },
      barrier,
      outcome: result.outcome,
      outcomeIndex: result.outcomeIndex,
      mfeAtr: result.mfeAtr,
      maeAtr: result.maeAtr,
      mfeR: result.mfeR,
      maeR: result.maeR,
      why: whyFor(
        row.tag,
        result.outcome,
        result.outcomeIndex,
        row.cutIndex,
        barrier.horizon,
        result.ambiguousSameBar
      ),
    };
    return { item, outcome: result.outcome };
  });

  const kept: typeof built = [];
  if (options.allowOverlap) {
    kept.push(...built);
  } else {
    const previous = new Map<string, TrainerItem>();
    for (const entry of built) {
      const key = seriesKey(entry.item.symbol, entry.item.timeframe);
      const prev = previous.get(key);
      if (prev && entry.item.cutIndex - prev.cutIndex < BARRIER_HORIZON) {
        drops.push({
          id: entry.item.id,
          reason: "overlap",
          detail: `cut ${entry.item.cutIndex} is within ${BARRIER_HORIZON} bars of ${prev.id} at ${prev.cutIndex}`,
        });
        continue;
      }
      kept.push(entry);
      previous.set(key, entry.item);
    }
  }

  const finalEntries = options.balance ? applyBalance(kept, drops) : kept;
  const items = finalEntries.map((entry) => freezeItem(entry.item));

  const counts: Record<string, Record<Outcome, number>> = {};
  for (const tag of TAGS) counts[tag] = emptyOutcomeCounts();
  counts.all = emptyOutcomeCounts();
  for (const item of items) {
    counts[item.tag][item.outcome]++;
    counts.all[item.outcome]++;
  }

  const rates: Record<string, Record<Outcome, number>> = {};
  for (const [key, value] of Object.entries(counts)) {
    const total = outcomeTotal(value);
    rates[key] =
      total === 0
        ? emptyOutcomeCounts()
        : {
            up: value.up / total,
            down: value.down / total,
            scratch: value.scratch / total,
          };
  }

  const symbols = SYMBOLS.filter((symbol) =>
    items.some((item) => item.symbol === symbol)
  );
  const timeframes = TIMEFRAMES.filter((timeframe) =>
    items.some((item) => item.timeframe === timeframe)
  );

  const batch = {
    version,
    createdAt: options.now ?? Date.now(),
    symbols: Object.freeze(symbols),
    timeframes: Object.freeze(timeframes),
    barrierAtrMult: BARRIER_ATR_MULT,
    barrierHorizon: BARRIER_HORIZON,
    baseRates: freezeCounts(rates),
    baseRateCounts: freezeCounts(counts),
    items: Object.freeze(items),
  } as BuiltBatch;

  Object.defineProperty(batch, "drops", {
    value: Object.freeze(
      drops.map((drop) => Object.freeze({ ...drop }))
    ) as readonly PublishDrop[],
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(batch);
}

// --------------------------------------------------------------------- I/O

function assertSafeVersion(version: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    throw new Error(
      `version "${version}" must use only letters, digits, dot, underscore or dash`
    );
  }
}

export function batchPath(version: string, dir: string = BATCHES_DIR): string {
  assertSafeVersion(version);
  return path.join(dir, `${version}.json`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write only the JSON snapshot. Kept separate from Mongo so tests and tooling
 * can exercise the file contract without a database connection.
 */
export async function writeBatchFile(
  batch: TrainerBatch,
  options: { dir?: string; force?: boolean } = {}
): Promise<WriteBatchResult> {
  const dir = options.dir ?? BATCHES_DIR;
  const file = batchPath(batch.version, dir);

  await mkdir(dir, { recursive: true });
  if (!options.force && (await exists(file))) {
    throw new Error(`batch ${batch.version} already exists at ${file}; pass --force to overwrite`);
  }
  await writeFile(file, JSON.stringify(batch, null, 2) + "\n", "utf8");
  return { path: file };
}

/**
 * Publish a batch to `data/trainer/batches/<version>.json` and upsert the Mongo
 * metadata/items. An existing version is refused unless `force` is set.
 */
export async function publishBatch(
  batch: TrainerBatch,
  options: PublishBatchOptions = {}
): Promise<PublishBatchResult> {
  const force = options.force ?? false;
  const dir = options.dir ?? BATCHES_DIR;

  if (!force && (await TrainerBatches.exists({ _id: batch.version }))) {
    throw new Error(
      `batch ${batch.version} already exists in TrainerBatches; pass --force to overwrite`
    );
  }

  const { items, ...meta } = batch;
  const written = await writeBatchFile(batch, { dir, force });

  await TrainerBatches.updateOne(
    { _id: batch.version },
    {
      $set: {
        ...meta,
        itemCount: items.length,
        publishedAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();

  if (items.length) {
    await TrainerItems.bulkWrite(
      items.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: { $set: { ...item } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  return { version: batch.version, path: written.path, items: items.length };
}

// ---------------------------------------------------------------------- CLI

interface CliArgs {
  flags: Map<string, string>;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf("=");
    if (eq === -1) flags.set(arg.slice(2), "true");
    else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  }
  return { flags };
}

function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value || value === "true") throw new Error(`--${name}=<value> is required`);
  return value;
}

function flagOn(flags: ReadonlyMap<string, string>, name: string): boolean {
  const value = flags.get(name);
  return value !== undefined && value !== "false";
}

function printDrop(drop: PublishDrop): void {
  process.stdout.write(
    `drop reason=${drop.reason} id=${drop.id} ${drop.detail}\n`
  );
}

function printBaseRates(batch: TrainerBatch): void {
  process.stdout.write("tag                      n     up  down scratch  rate-up rate-down rate-scratch\n");
  for (const key of [...TAGS, "all"]) {
    const counts = batch.baseRateCounts[key];
    const rates = batch.baseRates[key];
    if (!counts || !rates) continue;
    const n = outcomeTotal(counts);
    process.stdout.write(
      `${key.padEnd(24)} ${String(n).padStart(3)} ` +
        `${String(counts.up).padStart(6)} ${String(counts.down).padStart(5)} ` +
        `${String(counts.scratch).padStart(7)}  ` +
        `${rates.up.toFixed(3).padStart(7)} ${rates.down.toFixed(3).padStart(9)} ` +
        `${rates.scratch.toFixed(3).padStart(12)}\n`
    );
  }
}

async function main(): Promise<void> {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const version = requiredFlag(flags, "version");
  const sourceRunId = flags.get("runId");
  const dryRun = flagOn(flags, "dry-run");

  await connectDb();

  const reviews = await readAll(sourceRunId);
  const accepted = reviews.filter((row) => row.status === "accept");

  const barsBySeries: BarsBySeries = {};
  const keys = new Set(
    accepted.map((row) => seriesKey(row.symbol, row.timeframe))
  );
  for (const key of keys) {
    const [symbol, timeframe] = key.split(":") as [
      TrainerSymbol,
      TrainerTimeframe,
    ];
    const stored = await readTrainerBars(symbol, timeframe);
    if (stored) barsBySeries[key] = stored.bars;
    else {
      process.stderr.write(
        `[trainer] ${key} has no stored bars; affected rows will be invalid\n`
      );
    }
  }

  const batch = buildBatch(accepted, barsBySeries, {
    version,
    allowOverlap: flagOn(flags, "allow-overlap"),
    balance: flagOn(flags, "balance"),
    skipInvalid: flagOn(flags, "skip-invalid"),
  });

  const dropCounts: Record<DropReason, number> = {
    overlap: 0,
    invalid: 0,
    balance: 0,
  };
  for (const drop of batch.drops) dropCounts[drop.reason]++;

  const out = (line: string) => process.stdout.write(line + "\n");
  out(`TRAINER PUBLISH ${version}${dryRun ? " (dry-run)" : ""}`);
  if (sourceRunId) out(`runId=${sourceRunId}`);
  out(
    `accepted=${accepted.length} kept=${batch.items.length} ` +
      `dropped=${batch.drops.length} overlap=${dropCounts.overlap} ` +
      `invalid=${dropCounts.invalid} balance=${dropCounts.balance}`
  );

  for (const drop of batch.drops) printDrop(drop);

  out("");
  printBaseRates(batch);

  const target = batchPath(version);
  out("");
  if (dryRun) {
    out(`path=${target} (dry-run; nothing written)`);
  } else {
    const result = await publishBatch(batch, { force: flagOn(flags, "force") });
    out(`path=${result.path} items=${result.items}`);
  }
}

if (require.main === module) {
  main()
    .catch((err) => {
      process.stderr.write(
        `trainer publish failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
