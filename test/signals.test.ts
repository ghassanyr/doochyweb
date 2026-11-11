import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canEdit,
  canRestore,
  computeRR,
  isExpired,
  validateSignalInput,
} from "../src/server/signals/validate";
import { resolveOutcome } from "../src/server/signals/outcome";
import type { Candle } from "../src/server/market/types";
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTimestamp,
  localDayKey,
  localDayLabel,
  timeZoneLabel,
  toLocalInputValue,
} from "../src/webapp/src/time";
import {
  computeRR as clientRR,
  distances,
  progressFor,
  relativeAgo,
  signalShareText,
  statusTimestamp,
} from "../src/webapp/src/signals/signalFormat";
import type { Signal } from "../src/webapp/src/signals/types";

const base: Signal = {
  id: "s1",
  symbol: "XAUUSD",
  direction: "buy",
  entry: 2400,
  target: 2450,
  stop: 2380,
  timeframe: "4h",
  note: "Breakout retest",
  status: "active",
  expiresAt: null,
  createdAt: "2026-11-11T10:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
  invalidatedAt: null,
  invalidationReason: null,
  resolvedAt: null,
  resolution: null,
  updates: [],
};

describe("signal validation", () => {
  test("accepts a well-formed buy and normalizes the symbol", () => {
    const result = validateSignalInput({
      symbol: " xau usd ",
      direction: "BUY",
      entry: 2400,
      target: 2450,
      stop: 2380,
      timeframe: "4h",
      note: "  breakout  ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.symbol, "XAUUSD");
    assert.equal(result.value.direction, "buy");
    assert.equal(result.value.entry, 2400);
    assert.equal(result.value.note, "breakout");
  });

  test("accepts a well-formed sell", () => {
    const result = validateSignalInput({
      symbol: "EURUSD",
      direction: "sell",
      entry: 1.09,
      target: 1.07,
      stop: 1.1,
    });
    assert.equal(result.ok, true);
  });

  test("rejects wrong-side levels", () => {
    const buy = validateSignalInput({
      symbol: "XAUUSD",
      direction: "buy",
      entry: 2400,
      target: 2300,
      stop: 2380,
    });
    assert.equal(buy.ok, false);

    const sell = validateSignalInput({
      symbol: "XAUUSD",
      direction: "sell",
      entry: 2400,
      target: 2500,
      stop: 2450,
    });
    assert.equal(sell.ok, false);
  });

  test("allows a missing entry but still requires distinct target and stop", () => {
    const ok = validateSignalInput({ symbol: "XAUUSD", direction: "buy", target: 2450, stop: 2380 });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.entry, null);

    const same = validateSignalInput({ symbol: "XAUUSD", direction: "buy", target: 2400, stop: 2400 });
    assert.equal(same.ok, false);
  });

  test("rejects unknown directions, timeframes and empty symbols", () => {
    assert.equal(validateSignalInput({ symbol: "", direction: "buy", target: 2, stop: 1 }).ok, false);
    assert.equal(validateSignalInput({ symbol: "XAUUSD", direction: "hold", target: 2, stop: 1 }).ok, false);
    assert.equal(
      validateSignalInput({ symbol: "XAUUSD", direction: "buy", target: 2, stop: 1, timeframe: "7h" }).ok,
      false
    );
  });

  test("rejects an expiry that has already passed on create, but permits it on edit", () => {
    const now = new Date("2026-11-11T12:00:00.000Z");
    const past = "2026-11-10T12:00:00.000Z";
    assert.equal(
      validateSignalInput(
        { symbol: "XAUUSD", direction: "buy", target: 2, stop: 1, expiresAt: past },
        { now, requireFutureExpiry: true }
      ).ok,
      false
    );
    assert.equal(
      validateSignalInput(
        { symbol: "XAUUSD", direction: "buy", target: 2, stop: 1, expiresAt: past },
        { now }
      ).ok,
      true
    );
  });

  test("computes reward-to-risk and guards zero risk", () => {
    assert.equal(computeRR(2400, 2450, 2380), 2.5);
    assert.equal(computeRR(2400, 2300, 2450), 2);
    assert.equal(computeRR(null, 2450, 2380), null);
    assert.equal(computeRR(2400, 2450, 2400), null);
  });

  test("expiry only applies to active signals", () => {
    const past = new Date("2026-11-10T12:00:00.000Z");
    const now = new Date("2026-11-11T12:00:00.000Z");
    assert.equal(isExpired("active", past, now), true);
    assert.equal(isExpired("active", new Date("2026-11-12T12:00:00.000Z"), now), false);
    assert.equal(isExpired("invalidated", past, now), false);
    assert.equal(isExpired("active", null, now), false);
  });

  test("only active signals are editable and only invalidated ones restore", () => {
    assert.equal(canEdit("active"), true);
    assert.equal(canEdit("expired"), false);
    assert.equal(canRestore("invalidated"), true);
    assert.equal(canRestore("expired"), false);
  });

  test("direction fixes target/stop ordering even without an entry", () => {
    const buyOk = validateSignalInput({ symbol: "XAUUSD", direction: "buy", target: 2450, stop: 2380 });
    assert.equal(buyOk.ok, true);
    const buyBad = validateSignalInput({ symbol: "XAUUSD", direction: "buy", target: 2380, stop: 2450 });
    assert.equal(buyBad.ok, false);

    const sellOk = validateSignalInput({ symbol: "XAUUSD", direction: "sell", target: 2350, stop: 2450 });
    assert.equal(sellOk.ok, true);
    const sellBad = validateSignalInput({ symbol: "XAUUSD", direction: "sell", target: 2450, stop: 2350 });
    assert.equal(sellBad.ok, false);
  });
});

function bar(time: number, high: number, low: number): Candle {
  const mid = (high + low) / 2;
  return { time, open: mid, high, low, close: mid, volume: 0 };
}

describe("automatic outcome resolution", () => {
  test("a buy resolves at target when the high reaches it", () => {
    const outcome = resolveOutcome(
      { direction: "buy", target: 2450, stop: 2380 },
      [bar(1_000, 2_460, 2_390)],
      0
    );
    assert.deepEqual(outcome, { status: "target_hit", at: 1_000 });
  });

  test("a buy resolves at stop when the low reaches it", () => {
    const outcome = resolveOutcome(
      { direction: "buy", target: 2450, stop: 2380 },
      [bar(1_000, 2_400, 2_370)],
      0
    );
    assert.deepEqual(outcome, { status: "stopped_out", at: 1_000 });
  });

  test("a sell mirrors the buy rules", () => {
    const target = resolveOutcome(
      { direction: "sell", target: 2350, stop: 2450 },
      [bar(1_000, 2_440, 2_340)],
      0
    );
    assert.deepEqual(target, { status: "target_hit", at: 1_000 });

    const stop = resolveOutcome(
      { direction: "sell", target: 2350, stop: 2450 },
      [bar(1_000, 2_460, 2_400)],
      0
    );
    assert.deepEqual(stop, { status: "stopped_out", at: 1_000 });
  });

  test("bars from before the signal was published are ignored", () => {
    const outcome = resolveOutcome(
      { direction: "buy", target: 2450, stop: 2380 },
      [bar(1_000, 2_460, 2_370)],
      2_000
    );
    assert.equal(outcome, null);
  });

  test("when one bar spans both levels the stop wins", () => {
    const outcome = resolveOutcome(
      { direction: "buy", target: 2450, stop: 2380 },
      [bar(1_000, 2_460, 2_370)],
      0
    );
    assert.deepEqual(outcome, { status: "stopped_out", at: 1_000 });
  });

  test("the chronologically first touch decides the outcome", () => {
    const outcome = resolveOutcome(
      { direction: "buy", target: 2450, stop: 2380 },
      [bar(1_000, 2_460, 2_390), bar(2_000, 2_400, 2_370)],
      0
    );
    assert.deepEqual(outcome, { status: "target_hit", at: 1_000 });
  });
});

describe("local time formatting", () => {
  test("formats in UTC without a zone offset", () => {
    assert.equal(formatLocalDateTime("2026-11-11T12:32:00Z", { timeZone: "UTC" }), "11 Nov 2026, 12:32");
    assert.equal(formatLocalDate("2026-11-11T12:32:00Z", { timeZone: "UTC" }), "11 Nov 2026");
    assert.equal(timeZoneLabel({ timeZone: "UTC", at: "2026-11-11T12:32:00Z" }), "UTC");
  });

  test("follows DST in Europe/Berlin", () => {
    assert.equal(
      formatLocalDateTime("2026-07-01T12:00:00Z", { timeZone: "Europe/Berlin" }),
      "01 Jul 2026, 14:00"
    );
    assert.equal(
      formatLocalDateTime("2026-01-15T12:00:00Z", { timeZone: "Europe/Berlin" }),
      "15 Jan 2026, 13:00"
    );
    assert.equal(timeZoneLabel({ timeZone: "Europe/Berlin", at: "2026-07-01T12:00:00Z" }), "GMT+2");
    assert.equal(timeZoneLabel({ timeZone: "Europe/Berlin", at: "2026-01-15T12:00:00Z" }), "GMT+1");
  });

  test("day keys roll over in the visitor's zone", () => {
    assert.equal(localDayKey("2026-11-11T23:30:00Z", { timeZone: "UTC" }), "2026-11-11");
    assert.equal(localDayKey("2026-11-11T23:30:00Z", { timeZone: "Europe/Berlin" }), "2026-11-12");
  });

  test("labels today, yesterday and older days", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    assert.equal(localDayLabel("2026-11-11T08:00:00Z", { timeZone: "UTC", now }), "Today");
    assert.equal(localDayLabel("2026-11-10T08:00:00Z", { timeZone: "UTC", now }), "Yesterday");
    assert.equal(localDayLabel("2026-11-01T08:00:00Z", { timeZone: "UTC", now }), "01 Nov 2026");
  });

  test("builds datetime-local values in the chosen zone", () => {
    assert.equal(toLocalInputValue("2026-07-01T12:00:00Z", { timeZone: "Europe/Berlin" }), "2026-07-01T14:00");
    assert.equal(toLocalInputValue(null), "");
  });

  test("timestamps include the zone label", () => {
    assert.equal(
      formatLocalTimestamp("2026-11-11T12:32:00Z", { timeZone: "Europe/Berlin" }),
      "11 Nov 2026, 13:32 GMT+1"
    );
  });

  test("invalid input degrades to a dash", () => {
    assert.equal(formatLocalDateTime("not a date", { timeZone: "UTC" }), "-");
  });
});

describe("signal presentation", () => {
  test("progress maps price onto the stop→target range", () => {
    const buy = progressFor(base, 2425);
    assert.ok(buy);
    assert.ok(Math.abs(buy!.pricePct - (45 / 70) * 100) < 1e-9);
    assert.ok(Math.abs(buy!.entryPct! - (20 / 70) * 100) < 1e-9);
    assert.equal(buy!.profitable, true);

    const sell: Signal = { ...base, direction: "sell", entry: 2400, target: 2350, stop: 2450 };
    const p = progressFor(sell, 2400);
    assert.ok(p);
    assert.equal(p!.pricePct, 50);
    assert.equal(p!.entryPct, 50);
    assert.equal(p!.profitable, true);
  });

  test("distances are signed percentages of the live price", () => {
    const d = distances(base, 2400);
    assert.ok(Math.abs(d.toTarget! - (50 / 2400) * 100) < 1e-9);
    assert.ok(Math.abs(d.toStop! - (-20 / 2400) * 100) < 1e-9);
    assert.equal(distances(base, null).toTarget, null);
  });

  test("share text is plain text and includes the levels", () => {
    const text = signalShareText(base);
    assert.match(text, /XAUUSD BUY \(4h\)/);
    assert.match(text, /Entry:/);
    assert.match(text, /R:R 2\.50/);
    assert.match(text, /Note: Breakout retest/);
  });

  test("status timestamps reflect the lifecycle", () => {
    assert.equal(statusTimestamp(base), null);
    assert.equal(
      statusTimestamp({ ...base, status: "invalidated", invalidatedAt: "2026-11-11T11:00:00Z" })?.label,
      "Invalidated"
    );
    assert.equal(
      statusTimestamp({ ...base, status: "expired", expiresAt: "2026-11-11T11:00:00Z" })?.label,
      "Expired"
    );
    assert.equal(
      statusTimestamp({ ...base, status: "target_hit", resolvedAt: "2026-11-11T11:00:00Z" })?.label,
      "Resolved"
    );
  });

  test("relative age is timezone independent", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    assert.equal(relativeAgo("2026-11-11T11:59:30Z", now), "30s ago");
    assert.equal(relativeAgo("2026-11-11T11:00:00Z", now), "1h ago");
  });

  test("client and server R:R agree", () => {
    assert.equal(clientRR(base.entry, base.target, base.stop), computeRR(base.entry, base.target, base.stop));
  });
});
