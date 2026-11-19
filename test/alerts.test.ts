import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { conditionMet, validateAlertInput } from "../src/server/alerts/validate";
import { appendAlertNote, buildAlertTriggeredMessage } from "../src/server/telegram/messages";
import type { AlertView } from "../src/server/alerts/types";

function alert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: "a1",
    symbol: "EURUSD",
    condition: "above",
    level: 1.1,
    note: "",
    status: "triggered",
    triggeredAt: "2026-01-10T10:00:00.000Z",
    triggeredPrice: 1.1005,
    lastPrice: 1.1005,
    lastCheckedAt: "2026-01-10T10:00:00.000Z",
    createdAt: "2026-01-09T10:00:00.000Z",
    updatedAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("validateAlertInput", () => {
  test("normalizes the symbol and defaults to active", () => {
    const parsed = validateAlertInput({ symbol: "eur/usd", condition: "ABOVE", level: "1.1" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.symbol, "EURUSD");
    assert.equal(parsed.value.condition, "above");
    assert.equal(parsed.value.level, 1.1);
    assert.equal(parsed.value.status, "active");
  });

  test("requires a symbol", () => {
    assert.equal(validateAlertInput({ condition: "above", level: 1 }).ok, false);
  });

  test("accepts only above or below", () => {
    assert.equal(validateAlertInput({ symbol: "EURUSD", condition: "crosses", level: 1 }).ok, false);
  });

  test("rejects a non-positive or missing level", () => {
    assert.equal(validateAlertInput({ symbol: "EURUSD", condition: "above", level: 0 }).ok, false);
    assert.equal(validateAlertInput({ symbol: "EURUSD", condition: "above", level: -3 }).ok, false);
    assert.equal(validateAlertInput({ symbol: "EURUSD", condition: "above" }).ok, false);
  });

  test("keeps a paused status and trims the note", () => {
    const parsed = validateAlertInput({
      symbol: "XAUUSD",
      condition: "below",
      level: 2000,
      status: "paused",
      note: "  support  ",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.status, "paused");
    assert.equal(parsed.value.note, "support");
  });

  test("an unknown status resets to active", () => {
    const parsed = validateAlertInput({ symbol: "XAUUSD", condition: "below", level: 2000, status: "gone" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.status, "active");
  });
});

describe("conditionMet", () => {
  test("above fires at and beyond the level", () => {
    assert.equal(conditionMet("above", 1.1, 1.1001), true);
    assert.equal(conditionMet("above", 1.1, 1.1), true);
    assert.equal(conditionMet("above", 1.1, 1.0999), false);
  });

  test("below fires at and under the level", () => {
    assert.equal(conditionMet("below", 2000, 1999), true);
    assert.equal(conditionMet("below", 2000, 2000), true);
    assert.equal(conditionMet("below", 2000, 2001), false);
  });

  test("a non-finite price never fires", () => {
    assert.equal(conditionMet("above", 1, Number.NaN), false);
  });
});

describe("buildAlertTriggeredMessage", () => {
  test("states the direction, level and last price", () => {
    const text = buildAlertTriggeredMessage(alert());
    assert.ok(text.includes("Alert triggered"));
    assert.ok(text.includes("EURUSD"));
    assert.ok(text.includes("rose above"));
    assert.ok(text.includes("1.1005"));
    assert.ok(text.includes("10 Jan 2026"));
  });

  test("handles a below alert without a trigger price", () => {
    const text = buildAlertTriggeredMessage(
      alert({ condition: "below", triggeredPrice: null, symbol: "XAUUSD" })
    );
    assert.ok(text.includes("fell below"));
    assert.ok(!text.includes("Last price"));
  });

  test("escapes the note and truncates it", () => {
    const text = buildAlertTriggeredMessage(alert({ note: "<script>alert(1)</script>" }));
    assert.ok(text.includes("&lt;script&gt;"));
    assert.ok(!text.includes("<script>"));
  });

  test("contains no em dash", () => {
    assert.equal(buildAlertTriggeredMessage(alert()).includes("\u2014"), false);
  });
});

describe("appendAlertNote", () => {
  test("adds an escaped note to templated messages", () => {
    const text = appendAlertNote(
      "Alert triggered EURUSD",
      alert({ note: "<b>range break</b>" })
    );
    assert.ok(text.includes("Note: &lt;b&gt;range break&lt;/b&gt;"));
    assert.ok(!text.includes("<b>"));
  });

  test("leaves a message unchanged when there is no note", () => {
    assert.equal(appendAlertNote("Alert triggered EURUSD", alert()), "Alert triggered EURUSD");
  });
});
