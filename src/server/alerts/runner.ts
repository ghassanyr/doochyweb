// In-process price alert checker.
//
// One tick every minute: read the active alerts, resolve their symbols against
// the same price cache the Signals page polls, record the price seen, then move
// any satisfied alert to `triggered` and queue one Telegram message for its
// owner. Alerts never fire twice because the transition is an atomic
// active -> triggered update, so a slow tick or a restart cannot double-send.
//
// Prices are best effort: a symbol the providers cannot answer keeps its alert
// active and is simply checked again on the next tick.

import { signalPrices } from "../signals/prices";
import { enqueueAlertTriggered } from "../telegram/notify";
import { queueWebhook } from "../webhooks";
import { listActiveAlerts, markTriggered, touchAlerts } from "./store";
import { conditionMet } from "./validate";

const POLL_MS = 60_000;

export interface AlertRun {
  active: number;
  priced: number;
  triggered: number;
}

/** Check every active alert once. Exported so tests can drive it without timers. */
export async function runAlertCheckOnce(now: Date = new Date()): Promise<AlertRun> {
  const active = await listActiveAlerts();
  if (!active.length) return { active: 0, priced: 0, triggered: 0 };

  const symbols = [...new Set(active.map((alert) => alert.symbol))];
  const prices = await signalPrices(symbols);

  const seen: { id: string; price: number; at: Date }[] = [];
  const fire: { id: string; userId: string; price: number }[] = [];

  for (const alert of active) {
    const point = prices[alert.symbol];
    if (!point || !Number.isFinite(point.price)) continue;
    seen.push({ id: alert.id, price: point.price, at: now });
    if (conditionMet(alert.condition, alert.level, point.price)) {
      fire.push({ id: alert.id, userId: alert.userId, price: point.price });
    }
  }

  await touchAlerts(seen);

  let triggered = 0;
  for (const item of fire) {
    const view = await markTriggered(item.id, item.price, now);
    if (!view) continue;
    triggered++;
    try {
      await enqueueAlertTriggered(view, item.userId, now);
    } catch (err) {
      // A Telegram outage must not undo a trigger that already happened.
      console.error(
        `[alerts] could not queue Telegram delivery: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    queueWebhook("alert.triggered", {
      id: view.id,
      userId: item.userId,
      symbol: view.symbol,
      condition: view.condition,
      level: view.level,
      triggeredPrice: view.triggeredPrice,
      triggeredAt: view.triggeredAt,
    });
  }

  return { active: active.length, priced: seen.length, triggered };
}

let stopFn: (() => void) | null = null;

/** Start the one-minute checker. Idempotent. */
export function startAlertRunner(log: (msg: string) => void = console.log): void {
  if (stopFn) return;

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const run = await runAlertCheckOnce();
      if (run.triggered) {
        log(`[alerts] checked=${run.active} priced=${run.priced} triggered=${run.triggered}`);
      }
    } catch (err) {
      log(`[alerts] check failed: ${err instanceof Error ? err.message : String(err)}`);
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

export function stopAlertRunner(): void {
  stopFn?.();
}
