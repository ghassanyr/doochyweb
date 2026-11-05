import "dotenv/config";
// Scraper runner: replaces the OpenClaw doochy-scraper cron.
//
// One run per hour at HH:02 UTC: collect closed bars, diff against the previous run,
// detect needles, and append the capture JSONL the UI already reads.
// Change detection and needle dedup are persisted in data/scraper-state.json.
//
// Disabled by default (SCRAPER_ENABLED=false) so it can run alongside the OpenClaw cron
// during a parity week. Enable with SCRAPER_ENABLED=true once both agree.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import mongoose from "mongoose";

import { connectDb } from "../db";
import { capturesPath } from "./captures";
import { collectObservations } from "./scraperCollect";
import {
  buildCapture, diffObservations, newNeedles, sessionLabel,
  type Change, type CapturePayload, type Needle, type Obs,
} from "./scraperRules";

const H1_MS = 3_600_000;
const RUN_MINUTE_OFFSET_MS = 2 * 60_000;

export interface ScraperState {
  version: 1;
  lastRunUtc: string | null;
  /** Previous observations, one per symbol, for change and needle detection. */
  obs: Obs[];
  /** UTC date the fired keys belong to; keys reset when the date rolls over. */
  firedDate: string;
  fired: string[];
}

const emptyState = (): ScraperState => ({ version: 1, lastRunUtc: null, obs: [], firedDate: "", fired: [] });

export function stateFile(): string {
  return process.env.SCRAPER_STATE_FILE || path.join(os.homedir(), "doochyweb", "data", "scraper-state.json");
}

export function loadState(file: string = stateFile()): ScraperState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ScraperState>;
    return {
      version: 1,
      lastRunUtc: typeof parsed.lastRunUtc === "string" ? parsed.lastRunUtc : null,
      obs: Array.isArray(parsed.obs) ? (parsed.obs as Obs[]) : [],
      firedDate: typeof parsed.firedDate === "string" ? parsed.firedDate : "",
      fired: Array.isArray(parsed.fired) ? (parsed.fired as string[]) : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw err;
  }
}

export function saveState(state: ScraperState, file: string = stateFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

/** Append one capture line, adding a leading newline if the file does not end with one. */
export function appendCapture(payload: CapturePayload, file: string = capturesPath()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify(payload) + "\n";
  let prefix = "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > 0) {
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, size - 1);
        if (buf[0] !== 0x0a) prefix = "\n";
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.appendFileSync(file, prefix + line);
}

export interface RunResult {
  timestamp_utc: string;
  session: string;
  evaluated: number;
  skipped: Record<string, string>;
  changes: number;
  needles: Needle[];
  capture: CapturePayload;
}

/**
 * One live run. Persists state and appends the capture. `now` defaults to the clock.
 * The capture is stamped at the last closed hour boundary.
 */
export async function runOnce(now: number = Date.now(), opts: { force?: boolean } = {}): Promise<RunResult> {
  const state = loadState();
  const ts = new Date(Math.floor(now / H1_MS) * H1_MS);
  const timestampUtc = ts.toISOString();
  const date = timestampUtc.slice(0, 10);
  const session = sessionLabel(timestampUtc);

  const coll = await collectObservations(now, { force: opts.force });
  const cur = coll.symbols.map((s) => s.obs);

  const fired = state.firedDate === date ? new Set(state.fired) : new Set<string>();
  const changes = diffObservations(state.obs, cur);
  const needles = newNeedles(state.obs, cur, `${session}:${date}`, fired);
  const capture = buildCapture({ timestamp_utc: timestampUtc, obs: cur, changes, needles });
  appendCapture(capture);

  // Keep the last observation of symbols that were skipped this run, so a stale gap
  // does not look like a brand-new alignment when the series recovers.
  const merged = new Map(state.obs.map((o) => [o.symbol, o]));
  for (const o of cur) merged.set(o.symbol, o);
  const watch = new Set(coll.watchlist);
  const nextObs = [...merged.values()].filter((o) => watch.has(o.symbol));

  saveState({
    version: 1,
    lastRunUtc: new Date(now).toISOString(),
    obs: nextObs,
    firedDate: date,
    fired: [...fired, ...needles.map((n) => n.key)],
  });

  return {
    timestamp_utc: timestampUtc,
    session,
    evaluated: cur.length,
    skipped: coll.skipped,
    changes: changes.length,
    needles,
    capture,
  };
}

/** Next HH:02 UTC after `now`. */
export function nextRunAt(now: number): number {
  const hour = Math.floor(now / H1_MS) * H1_MS;
  const thisHour = hour + RUN_MINUTE_OFFSET_MS;
  return thisHour > now ? thisHour : hour + H1_MS + RUN_MINUTE_OFFSET_MS;
}

export function scraperEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SCRAPER_ENABLED ?? "false").trim().toLowerCase();
  return ["true", "1", "on", "yes"].includes(v);
}

/**
 * Start the in-process schedule. Does nothing unless SCRAPER_ENABLED=true.
 * The first run waits for the next HH:02 so the capture boundary is clean.
 */
export function startScraperScheduler(log: (msg: string) => void = console.log): void {
  if (!scraperEnabled()) {
    log("[scraper] disabled (SCRAPER_ENABLED=false)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOnce();
      log(`[scraper] ${r.timestamp_utc} ${r.session}: ${r.evaluated} evaluated, ${Object.keys(r.skipped).length} skipped, ${r.changes} changes, ${r.needles.length} needles`);
    } catch (err) {
      log(`[scraper] run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      setTimeout(tick, Math.max(1_000, nextRunAt(Date.now()) - Date.now()));
    }
  };
  const delay = Math.max(1_000, nextRunAt(Date.now()) - Date.now());
  log(`[scraper] next run ${new Date(Date.now() + delay).toISOString()}`);
  setTimeout(tick, delay);
}

// CLI: tsx src/server/market/scraperRunner.ts [--once]
if (process.argv[1]?.endsWith("scraperRunner.ts")) {
  const args = process.argv.slice(2);
  (async () => {
    await connectDb();
    if (args.includes("--once")) {
      const r = await runOnce(Date.now());
      process.stdout.write(JSON.stringify({
        timestamp_utc: r.timestamp_utc, session: r.session, evaluated: r.evaluated,
        skipped: r.skipped, changes: r.changes, needles: r.needles,
      }, null, 2) + "\n");
    }
  })()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
