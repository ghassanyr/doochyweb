import "dotenv/config";
// Automatic target/stop resolver for the Signals feed.
//
// Runs on a low-frequency in-process timer (never per web request) and reuses the
// same lifecycle as lazy expiry: only `active` signals are considered, and a
// resolution is a one-way transition to `target_hit` / `stopped_out`.
//
// Bars come through the Analysis provider cache, so the resolver shares the warm
// series the page already uses instead of opening a second market feed. The
// short resolution timeframe catches intraday touches promptly; because runs are
// frequent, a limited bar window is enough (a touch is caught while it is fresh).

import mongoose from "mongoose";

import { connectDb } from "../db";
import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { getCandles } from "../market/providers/index";
import { publicSettings } from "../market/store";
import type { Candle } from "../market/types";
import { resolveOutcome } from "./outcome";
import { expireDue, Signal } from "./store";

/** Resolution timeframe. Short enough to catch intraday touches promptly. */
const RESOLVE_TIMEFRAME = "5m";
const RESOLVE_TF_MS = 5 * 60_000;
const RUN_EVERY_MS = 5 * 60_000;
const FIRST_RUN_MS = 30_000;
/** Symbols fetched in parallel; keeps the shared broker account well clear of limits. */
const CONCURRENCY = 3;

export interface ResolutionRun {
  /** Active signals examined. */
  checked: number;
  /** Signals transitioned to target_hit / stopped_out. */
  resolved: number;
  /** Signals left alone because their symbol or bars were unavailable. */
  skipped: number;
}

/** Enabled by default; set SIGNAL_RESOLVER_ENABLED=false to turn it off. */
export function resolverEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.SIGNAL_RESOLVER_ENABLED ?? "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(value);
}

/**
 * One pass over every active signal. Exported so it can be run from a CLI or a
 * test without starting the timer.
 */
export async function resolveSignals(now: Date = new Date()): Promise<ResolutionRun> {
  // Expire first: a closed window must never resolve as a win or loss.
  await expireDue(now);
  const active = await Signal.find({ status: "active" }).lean().exec();
  if (!active.length) return { checked: 0, resolved: 0, skipped: 0 };

  const { items: catalog } = await cachedCatalogFull();
  const settings = await publicSettings();

  const bySymbol = new Map<string, typeof active>();
  for (const doc of active) {
    const list = bySymbol.get(doc.symbol) ?? [];
    list.push(doc);
    bySymbol.set(doc.symbol, list);
  }

  let resolved = 0;
  let skipped = 0;
  const symbols = [...bySymbol.keys()];

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const chunk = symbols.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (symbol) => {
        const docs = bySymbol.get(symbol)!;
        const meta = resolveMeta(symbol, catalog);
        if (!meta) {
          skipped += docs.length;
          return;
        }
        let bars: Candle[];
        try {
          bars = (await getCandles(meta, RESOLVE_TIMEFRAME, settings)).bars;
        } catch {
          skipped += docs.length;
          return;
        }
        for (const doc of docs) {
          const since =
            doc.createdAt instanceof Date ? doc.createdAt.getTime() : new Date(doc.createdAt).getTime();
          if (!Number.isFinite(since)) {
            skipped++;
            continue;
          }
          const outcome = resolveOutcome(
            { direction: doc.direction, target: doc.target, stop: doc.stop },
            bars,
            since
          );
          if (!outcome) continue;
          // The last bar may still be forming, and a touch cannot happen after
          // "now"; cap the recorded time at the current moment.
          const at = new Date(Math.min(now.getTime(), outcome.at + RESOLVE_TF_MS));
          const result = await Signal.updateOne(
            { _id: doc._id, status: "active" },
            { $set: { status: outcome.status, resolution: outcome.status, resolvedAt: at } }
          ).exec();
          if (result.modifiedCount) resolved++;
        }
      })
    );
  }

  return { checked: active.length, resolved, skipped };
}

/**
 * Start the in-process schedule. Disabled with SIGNAL_RESOLVER_ENABLED=false.
 * Runs shortly after boot, then every few minutes. A run that overruns the
 * interval is not stacked: the next tick is scheduled only after it finishes.
 */
export function startSignalResolver(log: (msg: string) => void = console.log): void {
  if (!resolverEnabled()) {
    log("[signals] resolver disabled (SIGNAL_RESOLVER_ENABLED=false)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const run = await resolveSignals();
      if (run.resolved) {
        log(`[signals] resolved ${run.resolved}/${run.checked} active signals`);
      }
    } catch (err) {
      log(`[signals] resolver failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      setTimeout(tick, RUN_EVERY_MS);
    }
  };
  setTimeout(tick, FIRST_RUN_MS);
}

// CLI: tsx src/server/signals/resolver.ts [--once]
if (process.argv[1]?.endsWith("resolver.ts")) {
  const args = process.argv.slice(2);
  (async () => {
    await connectDb();
    if (args.includes("--once")) {
      const run = await resolveSignals();
      console.log(JSON.stringify(run, null, 2));
    }
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => undefined);
      process.exit(process.exitCode ?? 0);
    });
}
