import { cachedCatalogFull, resolveMeta } from "../market/catalog";
import { getCandles } from "../market/providers/index";
import { publicSettings } from "../market/store";
import type { Candle } from "../market/types";
import { parseHandPickTarget, resolveHandPickTarget } from "./outcome";
import { HandPickModel } from "./store";

const RESOLVE_TIMEFRAME = "5m";
const RESOLVE_TF_MS = 5 * 60_000;
const RUN_EVERY_MS = 5 * 60_000;
const FIRST_RUN_MS = 30_000;
const CONCURRENCY = 3;

export interface HandPickResolutionRun {
  checked: number;
  resolved: number;
  skipped: number;
}

export function handPickResolverEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.HAND_PICK_RESOLVER_ENABLED ?? "true").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(value);
}

export async function resolveHandPicks(now: Date = new Date()): Promise<HandPickResolutionRun> {
  const pending: any[] = await HandPickModel.find({ outcome: { $ne: "went_as_expected" } })
    .select({ symbol: 1, targetLevel: 1, createdAt: 1 })
    .lean()
    .exec();
  if (!pending.length) return { checked: pending.length, resolved: 0, skipped: 0 };

  const { items: catalog } = await cachedCatalogFull();
  const settings = await publicSettings();

  const bySymbol = new Map<string, any[]>();
  for (const doc of pending) {
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
          const target = parseHandPickTarget(doc.targetLevel);
          const since =
            doc.createdAt instanceof Date
              ? doc.createdAt.getTime()
              : new Date(doc.createdAt).getTime();
          if (target === null || !Number.isFinite(since)) {
            skipped++;
            continue;
          }
          const touched = resolveHandPickTarget(bars, target, since);
          if (touched === null) continue;
          const at = new Date(Math.min(now.getTime(), touched + RESOLVE_TF_MS));
          const result = await HandPickModel.updateOne(
            { _id: doc._id, outcome: { $ne: "went_as_expected" } },
            { $set: { outcome: "went_as_expected", outcomeAt: at } }
          ).exec();
          if (result.modifiedCount) resolved++;
        }
      })
    );
  }

  return { checked: pending.length, resolved, skipped };
}

export function startHandPickResolver(log: (msg: string) => void = console.log): void {
  if (!handPickResolverEnabled()) {
    log("[hand-picks] resolver disabled (HAND_PICK_RESOLVER_ENABLED=false)");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const run = await resolveHandPicks();
      if (run.resolved) {
        log(`[hand-picks] marked ${run.resolved}/${run.checked} picks as expected`);
      }
    } catch (err) {
      log(`[hand-picks] resolver failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      setTimeout(tick, RUN_EVERY_MS);
    }
  };
  setTimeout(tick, FIRST_RUN_MS);
}
