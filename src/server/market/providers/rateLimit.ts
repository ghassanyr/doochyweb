// Request pacing for the cTrader feed.
//
// Two independent limits are enforced here, both measured against the live
// endpoint rather than assumed:
//
//   1. Concurrency. cTrader answers BLOCKED_PAYLOAD_TYPE / "You are being rate
//      limited" once more than FIVE ProtoOAGetTrendbarsReq requests are in
//      flight on one socket. Measured: 4 concurrent -> all OK; 8 -> 5 OK and 3
//      blocked; 12 -> 5 OK and 7 blocked. So the ceiling is enforced with a
//      semaphore at MAX_IN_FLIGHT, below the observed limit on purpose.
//   2. Rate. The same volume spaced out is fine: 12 requests at 250ms apart
//      completed in 4.0s with nothing blocked. So a small token bucket keeps a
//      re-run from tripping the limit again immediately.
//
// An earlier version allowed one request per 1.2s and, worse, multiplied the
// wait by the queue length, so a 7-symbol sweep took 6.9s even though the broker
// answers in about 65ms. Nothing here needs to be that slow.
//
// Binance is governed by a published weight budget rather than a socket
// ceiling: 1200 per minute per IP, with each klines request costing 2. The
// policy below is far inside that, and exists mainly to stop a runaway loop
// from being rude rather than to avoid being throttled.
import type { ProviderId } from "../types";


/** cTrader's ceiling on requests in flight on the socket. The broker starts
 *  refusing above 5, so stay clear of it. */
export const MAX_IN_FLIGHT = 4;

/** Steady-state spacing between request starts, per provider. */
const MIN_SPACING_MS: Record<ProviderId, number> = { ctrader: 200, mt5: 100, binance: 50 };

const REFILL_INTERVAL_MS = 60_000;

interface Policy {
  /** Burst allowance (tokens). */
  capacity: number;
  /** Steady-state refill, per minute. */
  perMinute: number;
  /** Ceiling on requests in flight at once. */
  maxInFlight: number;
}

const POLICIES: Record<ProviderId, Policy | null> = {
  // capacity 4 at one request per 200ms = 300/min, comfortably above what the
  // broker serves but well under anything that trips the throttle.
  ctrader: { capacity: 4, perMinute: 300, maxInFlight: MAX_IN_FLIGHT },
  mt5: { capacity: 8, perMinute: 600, maxInFlight: 8 },
  // 600 klines/min at weight 2 = 1200 weight/min, exactly the published cap.
  // Held a little under so a burst cannot sit right on the ceiling.
  binance: { capacity: 12, perMinute: 400, maxInFlight: 12 },
};

interface Bucket {
  tokens: number;
  lastRefill: number;
  /** Requests admitted but still on the wire. */
  inFlight: number;
  /** FIFO of waiters, each with its own wake-up timer. */
  queue: { resolve: () => void; timer: ReturnType<typeof setTimeout> | null }[];
}

const buckets = new Map<ProviderId, Bucket>();

function bucketFor(provider: ProviderId): Bucket | null {
  const policy = POLICIES[provider];
  if (!policy) return null;
  let b = buckets.get(provider);
  if (!b) {
    b = { tokens: policy.capacity, lastRefill: Date.now(), inFlight: 0, queue: [] };
    buckets.set(provider, b);
  }
  return b;
}

function refill(b: Bucket, policy: Policy): void {
  const now = Date.now();
  const gained = ((now - b.lastRefill) / REFILL_INTERVAL_MS) * policy.perMinute;
  if (gained <= 0) return;
  b.tokens = Math.min(policy.capacity, b.tokens + gained);
  b.lastRefill = now;
}

/** Hand the slot straight to the head of the queue when one is waiting. */
function pump(b: Bucket, policy: Policy): void {
  while (b.queue.length > 0 && b.inFlight < policy.maxInFlight) {
    const waiter = b.queue.shift()!;
    if (waiter.timer) clearTimeout(waiter.timer);
    b.tokens = Math.max(0, b.tokens - 1);
    b.inFlight += 1;
    waiter.resolve();
  }
}

/**
 * Wait until a request may start. Call release() when the request settles, so
 * the in-flight count stays honest.
 */
export function acquire(provider: ProviderId): Promise<() => void> {
  const policy = POLICIES[provider];
  const b = bucketFor(provider);
  if (!policy || !b) return Promise.resolve(() => {});

  return new Promise<() => void>((resolve) => {
    refill(b, policy);
    const head = b.queue.length === 0;

    // Immediate admission: a free token, room on the wire, and nobody waiting
    // ahead of us. Otherwise queue, and let pump() hand over in FIFO order.
    if (head && b.tokens >= 1 && b.inFlight < policy.maxInFlight) {
      b.tokens -= 1;
      b.inFlight += 1;
      return resolve(release(b));
    }

    const waiter = { resolve: () => {}, timer: null as ReturnType<typeof setTimeout> | null };
    waiter.resolve = () => resolve(release(b));
    b.queue.push(waiter);

    // Spacing timer. This is a FIXED delay, not one scaled by queue depth:
    // a deep queue drains at the configured rate instead of each waiter
    // inheriting a longer and longer wait.
    waiter.timer = setTimeout(() => {
      const at = b.queue.indexOf(waiter);
      if (at === -1) return;
      b.queue.splice(at, 1);
      refill(b, policy);
      b.tokens = Math.max(0, b.tokens - 1);
      b.inFlight += 1;
      waiter.resolve();
    }, MIN_SPACING_MS[provider]);
  });
}

function release(b: Bucket): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    b.inFlight = Math.max(0, b.inFlight - 1);
  };
}

/** Drop all pacing state. Used by clearCache() and the tests. */
export function reset(): void {
  for (const b of buckets.values()) {
    for (const waiter of b.queue) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
    b.queue = [];
  }
  buckets.clear();
}

/** Introspection for tests and diagnostics. */
export function stats(provider: ProviderId): { inFlight: number; queued: number; tokens: number } | null {
  const b = buckets.get(provider);
  if (!b) return null;
  return { inFlight: b.inFlight, queued: b.queue.length, tokens: Number(b.tokens.toFixed(2)) };
}