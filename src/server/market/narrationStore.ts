// Audit store for narration runs (Phase 2). One JSON file per
// run + model + prompt version under data/narrations/ so a bake-off can keep
// every attempt side by side. The input snapshot is stored with the output:
// a narration is only auditable if we can see exactly what the model was given.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { NarrationRecord } from "./narration";

export function narrationDir(): string {
  return process.env.NARRATION_DIR || path.join(os.homedir(), "doochyweb", "data", "narrations");
}

const fileFor = (id: string): string => path.join(narrationDir(), `${id}.json`);

export function saveNarration(record: NarrationRecord, dir = narrationDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
}

export function loadNarration(id: string, dir = narrationDir()): NarrationRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as NarrationRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Newest first. Broken files are skipped, not fatal. */
export function listNarrations(dir = narrationDir()): NarrationRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: NarrationRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as NarrationRecord);
    } catch {
      // Torn or hand-edited file: skip it.
    }
  }
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return rows;
}
