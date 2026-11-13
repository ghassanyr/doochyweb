// Buyer-facing backup and restore commands:
//   pnpm doochy:backup [--out <file>]
//   pnpm doochy:restore <file> --merge
//   pnpm doochy:restore <file> --replace --yes
//
// Backup output includes password hashes and encrypted integration secrets.
// Treat it as confidential and keep the matching .env (especially
// INTEGRATIONS_ENCRYPTION_KEY) with it.

import "dotenv/config";
import fs from "node:fs/promises";
import mongoose from "mongoose";

import {
  applyBackup,
  collectBackup,
  defaultBackupPath,
  readBackupFile,
  serializeBackup,
  writeBackupFile,
  type BackupDatabase,
  type RestoreMode,
} from "./backup";
import { connectDb } from "./db";

interface BackupOptions {
  out: string | null;
  help: boolean;
}

interface RestoreOptions {
  file: string | null;
  mode: RestoreMode | null;
  yes: boolean;
  help: boolean;
}

function usage(): string {
  return `Usage:
  pnpm doochy:backup [--out <file>]
  pnpm doochy:restore <file> --merge
  pnpm doochy:restore <file> --replace --yes

Backup:
  Writes an Extended JSON snapshot of every non-system Mongo collection.
  Defaults to backups/doochy-<timestamp>.json.

Restore:
  --merge    Overwrite documents with matching _id and keep everything else.
  --replace  Delete every collection in the backup before restoring it.
             This is destructive and additionally requires --yes.`;
}

function parseBackupArgs(args: string[]): BackupOptions {
  const options: BackupOptions = { out: null, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--out") {
      const value = args[++index];
      if (!value) throw new Error("--out needs a file path");
      options.out = value;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function parseRestoreArgs(args: string[]): RestoreOptions {
  const options: RestoreOptions = { file: null, mode: null, yes: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--merge") options.mode = "merge";
    else if (arg === "--replace") options.mode = "replace";
    else if (arg === "--yes") options.yes = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else if (options.file) throw new Error("only one backup file can be restored at a time");
    else options.file = arg;
  }
  return options;
}

async function runBackup(options: BackupOptions): Promise<number> {
  const db = mongoose.connection.db as unknown as BackupDatabase | undefined;
  if (!db) throw new Error("database connection is not ready");
  const backup = await collectBackup(db, { database: process.env.MONGO_DB || "doochy" });
  const filePath = options.out || defaultBackupPath();
  const text = serializeBackup(backup);
  await writeBackupFile(filePath, text);

  const collections = Object.keys(backup.collections).length;
  const documents = Object.values(backup.collections).reduce((sum, docs) => sum + docs.length, 0);
  const stat = await fs.stat(filePath);
  console.log(
    `Wrote ${filePath} (${collections} collections, ${documents} documents, ${stat.size} bytes).`
  );
  console.log("Keep this file private: it contains account hashes and encrypted secrets.");
  return 0;
}

async function runRestore(options: RestoreOptions): Promise<number> {
  if (!options.file) throw new Error("a backup file is required");
  if (!options.mode) throw new Error("choose --merge or --replace");
  if (options.mode === "replace" && !options.yes) {
    throw new Error("--replace deletes current data; add --yes after taking a fresh backup");
  }

  const backup = await readBackupFile(options.file);
  const db = mongoose.connection.db as unknown as BackupDatabase | undefined;
  if (!db) throw new Error("database connection is not ready");

  const target = process.env.MONGO_DB || "doochy";
  if (backup.database !== target) {
    console.warn(
      `Warning: backup was taken from "${backup.database}" but this install uses "${target}".`
    );
  }

  const result = await applyBackup(db, backup, options.mode);
  const documents = result.collections.reduce((sum, entry) => sum + entry.documents, 0);
  console.log(
    `Restored ${documents} documents across ${result.collections.length} collections (${result.mode}).`
  );
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || !command) {
    console.log(usage());
    return command ? 0 : 1;
  }
  if (command !== "backup" && command !== "restore") {
    console.error(`Unknown command: ${command}\n\n${usage()}`);
    return 1;
  }

  if (command === "backup") {
    const options = parseBackupArgs(args);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    await connectDb();
    return runBackup(options);
  }

  const options = parseRestoreArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  await connectDb();
  return runRestore(options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[BACKUP] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.disconnect();
  });
