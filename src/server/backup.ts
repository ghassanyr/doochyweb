// Full-database backup and restore for a self-hosted install.
//
// The file is Extended JSON (EJSON), so ObjectIds, dates and binary values keep
// their types through a JSON round trip. Collections are discovered at runtime
// instead of hard-coded, which means a later feature store is included without
// touching this module.
//
// Restores are deliberately explicit: merge overwrites matching _id values and
// keeps everything else, while replace wipes each collection present in the
// backup first. The CLI requires --replace --yes for that destructive path.

import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const { EJSON } = mongoose.mongo.BSON;

export const BACKUP_FORMAT = "doochy-backup";
export const BACKUP_VERSION = 1;
export const DEFAULT_BACKUP_DIR = "backups";
export const RESTORE_BATCH_SIZE = 1_000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  database: string;
  collections: Record<string, unknown[]>;
}

export interface BackupCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<unknown[]> };
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
  insertMany(docs: unknown[], options?: Record<string, unknown>): Promise<unknown>;
  bulkWrite(ops: Record<string, unknown>[], options?: Record<string, unknown>): Promise<unknown>;
}

export interface BackupDatabase {
  databaseName?: string;
  listCollections(
    filter?: Record<string, unknown>,
    options?: { nameOnly?: boolean }
  ): { toArray(): Promise<{ name: string }[]> };
  collection(name: string): BackupCollection;
}

export type RestoreMode = "merge" | "replace";

export interface RestoreCollectionResult {
  name: string;
  documents: number;
}

export interface RestoreResult {
  mode: RestoreMode;
  collections: RestoreCollectionResult[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCollectionName(name: string): boolean {
  return name.length > 0 && !name.startsWith("system.") && !name.includes("\0");
}

/** Canonical EJSON parses numbers as BSON wrappers such as Int32. */
function backupVersion(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { valueOf?: unknown }).valueOf === "function"
  ) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

/** Validate a parsed backup before any database write happens. */
export function validateBackup(input: unknown): BackupFile {
  if (!isRecord(input)) throw new BackupError("backup must be a JSON object");
  if (input.format !== BACKUP_FORMAT) {
    throw new BackupError(`not a ${BACKUP_FORMAT} file`);
  }
  if (backupVersion(input.version) !== BACKUP_VERSION) {
    throw new BackupError(`unsupported backup version: ${String(input.version)}`);
  }
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new BackupError("backup createdAt must be an ISO date");
  }
  if (typeof input.database !== "string" || !input.database) {
    throw new BackupError("backup database name is missing");
  }
  if (!isRecord(input.collections)) throw new BackupError("backup collections are missing");

  const collections: Record<string, unknown[]> = {};
  for (const [name, docs] of Object.entries(input.collections)) {
    if (!validCollectionName(name)) throw new BackupError(`invalid collection name: ${name}`);
    if (!Array.isArray(docs)) throw new BackupError(`collection ${name} is not an array`);
    for (const doc of docs) {
      if (!isRecord(doc) || !("_id" in doc)) {
        throw new BackupError(`collection ${name} contains a document without _id`);
      }
    }
    collections[name] = docs;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: input.createdAt,
    database: input.database,
    collections,
  };
}

/** Read every non-system collection into one typed snapshot. */
export async function collectBackup(
  db: BackupDatabase,
  options: { now?: Date; database?: string } = {}
): Promise<BackupFile> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .filter(validCollectionName)
    .sort();

  const collections: Record<string, unknown[]> = {};
  for (const name of names) {
    collections[name] = await db.collection(name).find({}).toArray();
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (options.now ?? new Date()).toISOString(),
    database: options.database || db.databaseName || "unknown",
    collections,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return `${EJSON.stringify(backup, undefined, 2, { relaxed: false })}\n`;
}

export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = EJSON.parse(text, { relaxed: false });
  } catch (err) {
    throw new BackupError(
      `backup is not valid Extended JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return validateBackup(parsed);
}

function docId(doc: unknown): unknown {
  return isRecord(doc) ? doc._id : undefined;
}

function sameId(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return EJSON.stringify(a, { relaxed: false }) === EJSON.stringify(b, { relaxed: false });
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

/** Apply a validated snapshot. Replace is destructive by design. */
export async function applyBackup(
  db: BackupDatabase,
  backup: BackupFile,
  mode: RestoreMode
): Promise<RestoreResult> {
  const results: RestoreCollectionResult[] = [];
  const entries = Object.entries(backup.collections).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, docs] of entries) {
    const collection = db.collection(name);

    if (mode === "replace") {
      await collection.deleteMany({});
      for (const batch of chunks(docs, RESTORE_BATCH_SIZE)) {
        if (batch.length) await collection.insertMany(batch, { ordered: false });
      }
      results.push({ name, documents: docs.length });
      continue;
    }

    for (const batch of chunks(docs, RESTORE_BATCH_SIZE)) {
      if (!batch.length) continue;
      const ops = batch.map((doc) => ({
        replaceOne: {
          filter: { _id: docId(doc) },
          replacement: doc,
          upsert: true,
        },
      }));
      await collection.bulkWrite(ops, { ordered: false });
    }
    results.push({ name, documents: docs.length });
  }

  return { mode, collections: results };
}

/** A timestamped path under backups/ with no filename collisions. */
export function defaultBackupPath(now: Date = new Date(), dir = DEFAULT_BACKUP_DIR): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `doochy-${stamp}.json`);
}

/** Write a new backup file with owner-only permissions. Never overwrite. */
export async function writeBackupFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function readBackupFile(filePath: string): Promise<BackupFile> {
  const text = await fs.readFile(filePath, "utf8");
  return parseBackup(text);
}

export { sameId };
