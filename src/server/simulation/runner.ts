// Paper trading close checker.
//
// Every minute the open book is marked against the shared price cache. A stop
// or target that has been reached closes the position at its level, which is
// the honest fill for a resting order rather than the current market price.
// The price helper reads at most 16 symbols per call, so symbols are chunked;
// anything not priced this tick keeps its last mark and is retried.

import { signalPrices } from "../signals/prices";
import {
  listOpenPaperPositions,
  settlePaperPosition,
  touchPaperPositions,
} from "./store";
import { closeDecision } from "./validate";

const POLL_MS = 60_000;
const PRICE_BATCH = 16;

export interface PaperRun {
  open: number;
  priced: number;
  closed: number;
}

/** Check every open position once. Exported so tests can drive it. */
export async function runPaperCheckOnce(now: Date = new Date()): Promise<PaperRun> {
  const open = await listOpenPaperPositions();
  if (!open.length) return { open: 0, priced: 0, closed: 0 };

  const symbols = [...new Set(open.map((row) => row.symbol))];
  const marks: Record<string, number> = {};
  for (let i = 0; i < symbols.length; i += PRICE_BATCH) {
    const chunk = symbols.slice(i, i + PRICE_BATCH);
    try {
      const points = await signalPrices(chunk);
      for (const [symbol, point] of Object.entries(points)) {
        if (point && Number.isFinite(point.price)) marks[symbol] = point.price;
      }
    } catch {
      // Skip this chunk; those positions are checked again next tick.
    }
  }

  const seen: { id: string; price: number; at: Date }[] = [];
  let closed = 0;

  for (const row of open) {
    const price = marks[row.symbol];
    if (price == null) continue;

    const decision = closeDecision({ side: row.side, stop: row.stop, target: row.target }, price);
    if (!decision) {
      seen.push({ id: row.id, price, at: now });
      continue;
    }

    const settled = await settlePaperPosition(row.id, decision.price, decision.reason, now);
    if (settled) closed++;
  }

  await touchPaperPositions(seen);
  return { open: open.length, priced: Object.keys(marks).length, closed };
}

let stopFn: (() => void) | null = null;

/** Start the one-minute checker. Idempotent. */
export function startPaperRunner(log: (msg: string) => void = console.log): void {
  if (stopFn) return;

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const run = await runPaperCheckOnce();
      if (run.closed) {
        log(`[paper] checked=${run.open} priced=${run.priced} closed=${run.closed}`);
      }
    } catch (err) {
      log(`[paper] check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  };

  timer = setTimeout(tick, 15_000);
  stopFn = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopFn = null;
  };
}

export function stopPaperRunner(): void {
  stopFn?.();
}
