import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  filterHandPickSymbols,
  formatHandPickIdentified,
} from "../src/webapp/src/market/handPickForm";
import type { CatalogEntry } from "../src/webapp/src/market/types";
import { parseHandPickTarget, resolveHandPickTarget } from "../src/server/handPicks/outcome";
import {
  HandPickInputError,
  cleanHandPickInput,
  publicHandPick,
} from "../src/server/handPicks/store";

describe("hand pick input", () => {
  test("requires a symbol", () => {
    assert.throws(() => cleanHandPickInput({}), HandPickInputError);
    assert.throws(() => cleanHandPickInput({ symbol: "   " }), HandPickInputError);
  });

  test("trims text and stores blank fields as null", () => {
    const input = cleanHandPickInput({
      symbol: "  BTCUSD  ",
      pattern: "  Falling Wedge ",
      targetLevel: "   ",
      targetPeriod: "2 days",
      interval: null,
      reason: "  Watching the retest  ",
    });
    assert.equal(input.symbol, "BTCUSD");
    assert.equal(input.pattern, "Falling Wedge");
    assert.equal(input.targetLevel, null);
    assert.equal(input.targetPeriod, "2 days");
    assert.equal(input.interval, null);
    assert.equal(input.reason, "Watching the retest");
  });

  test("keeps only known level types", () => {
    assert.equal(cleanHandPickInput({ symbol: "BTCUSD", levelType: "support" }).levelType, "support");
    assert.equal(
      cleanHandPickInput({ symbol: "BTCUSD", levelType: "resistance" }).levelType,
      "resistance"
    );
    assert.equal(cleanHandPickInput({ symbol: "BTCUSD", levelType: "pivot" }).levelType, null);
    assert.equal(cleanHandPickInput({ symbol: "BTCUSD" }).levelType, null);
  });

  test("cleans supporting lines and drops blanks", () => {
    const input = cleanHandPickInput({
      symbol: "BTCUSD",
      supporting: ["  Rising moving average ", "", "   ", "Volume confirms"],
    });
    assert.deepEqual(input.supporting, ["Rising moving average", "Volume confirms"]);
  });

  test("caps the number of supporting lines", () => {
    const input = cleanHandPickInput({
      symbol: "BTCUSD",
      supporting: Array.from({ length: 25 }, (_, index) => `Line ${index}`),
    });
    assert.equal(input.supporting.length, 20);
    assert.equal(input.supporting[19], "Line 19");
  });

  test("ignores a supporting value that is not an array", () => {
    assert.deepEqual(cleanHandPickInput({ symbol: "BTCUSD", supporting: "one line" }).supporting, []);
  });

  test("accepts an uploaded image data URL", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const input = cleanHandPickInput({ symbol: "NZDCHF", chartUrl: dataUrl });
    assert.equal(input.chartUrl, dataUrl);
  });

  test("accepts an https image URL and rejects unsafe values", () => {
    assert.equal(
      cleanHandPickInput({ symbol: "NZDCHF", chartUrl: "https://example.com/chart.png" }).chartUrl,
      "https://example.com/chart.png"
    );
    assert.throws(
      () => cleanHandPickInput({ symbol: "NZDCHF", chartUrl: "javascript:alert(1)" }),
      HandPickInputError
    );
    assert.throws(
      () => cleanHandPickInput({ symbol: "NZDCHF", chartUrl: "data:text/html;base64,PHNjcmlwdD4=" }),
      HandPickInputError
    );
  });

  test("rejects an oversized image data URL", () => {
    const dataUrl = `data:image/png;base64,${"a".repeat(700_000)}`;
    assert.throws(() => cleanHandPickInput({ symbol: "NZDCHF", chartUrl: dataUrl }), HandPickInputError);
  });
});

describe("public hand pick", () => {
  test("maps a stored document without leaking internals", () => {
    const createdAt = new Date("2026-11-18T09:30:00.000Z");
    const pick = publicHandPick({
      _id: "6afcbf7a5620d38a477f382f",
      __v: 3,
      symbol: "BTCUSD",
      pattern: "Support",
      targetLevel: "63564.0977",
      targetPeriod: "10 hours",
      interval: "1 hour",
      identifiedAt: "17-Nov-06:00",
      reason: "Broke through support",
      supporting: ["Supported by a falling average", 42],
      levelType: "support",
      levelValue: "64251.6914",
      levelNote: null,
      createdAt,
      updatedAt: createdAt,
    });
    assert.deepEqual(pick, {
      id: "6afcbf7a5620d38a477f382f",
      symbol: "BTCUSD",
      pattern: "Support",
      targetLevel: "63564.0977",
      targetPeriod: "10 hours",
      interval: "1 hour",
      identifiedAt: "17-Nov-06:00",
      reason: "Broke through support",
      supporting: ["Supported by a falling average"],
      levelType: "support",
      levelValue: "64251.6914",
      levelNote: null,
      chartUrl: null,
      createdAt: "2026-11-18T09:30:00.000Z",
      updatedAt: "2026-11-18T09:30:00.000Z",
      outcome: null,
      outcomeAt: null,
    });
  });

  test("drops an unknown level type", () => {
    const pick = publicHandPick({ symbol: "BTCUSD", levelType: "pivot" });
    assert.equal(pick.levelType, null);
  });

  test("maps a resolved outcome and leaves legacy picks pending", () => {
    const reachedAt = new Date("2026-11-20T10:00:00.000Z");
    const resolved = publicHandPick({
      symbol: "BTCUSD",
      outcome: "went_as_expected",
      outcomeAt: reachedAt,
    });
    const legacy = publicHandPick({ symbol: "BTCUSD" });
    assert.equal(resolved.outcome, "went_as_expected");
    assert.equal(resolved.outcomeAt, reachedAt.toISOString());
    assert.equal(legacy.outcome, null);
    assert.equal(legacy.outcomeAt, null);
  });

  test("keeps only valid image URLs", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const valid = publicHandPick({ symbol: "NZDCHF", chartUrl: dataUrl });
    const legacy = publicHandPick({ symbol: "NZDCHF", chartUrl: "https://img.chartshots.net/6aff343d0d547.png" });
    const invalid = publicHandPick({ symbol: "NZDCHF", chartUrl: "javascript:alert(1)" });
    assert.equal(valid.chartUrl, dataUrl);
    assert.equal(legacy.chartUrl, "https://img.chartshots.net/6aff343d0d547.png");
    assert.equal(invalid.chartUrl, null);
  });
});

describe("hand pick target resolution", () => {
  function bar(time: number, high: number, low: number) {
    const mid = (high + low) / 2;
    return { time, open: mid, high, low, close: mid, volume: 0 };
  }

  test("parses numeric target levels", () => {
    assert.equal(parseHandPickTarget(" 63,564.0977 "), 63564.0977);
    assert.equal(parseHandPickTarget(0.585), 0.585);
    assert.equal(parseHandPickTarget("around 100"), null);
    assert.equal(parseHandPickTarget(null), null);
  });

  test("marks a target touched from either side", () => {
    const bars = [bar(1_000, 2_450, 2_400)];
    assert.equal(resolveHandPickTarget(bars, 2_440, 0), 1_000);
    assert.equal(resolveHandPickTarget(bars, 2_410, 0), 1_000);
  });

  test("ignores misses and bars before the pick", () => {
    const bars = [bar(1_000, 2_450, 2_400)];
    assert.equal(resolveHandPickTarget(bars, 2_500, 0), null);
    assert.equal(resolveHandPickTarget(bars, 2_440, 2_000), null);
  });
});

describe("hand pick form helpers", () => {
  test("formats the identified field from the current UTC time", () => {
    assert.equal(
      formatHandPickIdentified(new Date("2026-11-20T17:39:09.000Z")),
      "17:39:09 (UTC+00:00) on Nov 20th, 2026"
    );
    assert.equal(
      formatHandPickIdentified(new Date("2026-11-01T00:05:01.000Z")),
      "00:05:01 (UTC+00:00) on Nov 1st, 2026"
    );
    assert.equal(
      formatHandPickIdentified(new Date("2026-11-02T00:05:02.000Z")),
      "00:05:02 (UTC+00:00) on Nov 2nd, 2026"
    );
    assert.equal(
      formatHandPickIdentified(new Date("2026-11-03T00:05:03.000Z")),
      "00:05:03 (UTC+00:00) on Nov 3rd, 2026"
    );
    assert.equal(
      formatHandPickIdentified(new Date("2026-11-11T00:05:04.000Z")),
      "00:05:04 (UTC+00:00) on Nov 11th, 2026"
    );
  });

  test("filters symbol suggestions by symbol or name", () => {
    const catalog: CatalogEntry[] = [
      { symbol: "BTCUSD", name: "Bitcoin", type: "crypto" },
      { symbol: "ETHUSD", name: "Ethereum", type: "crypto" },
      { symbol: "EURUSD", name: "Euro US Dollar", type: "forex" },
      { symbol: "XAUUSD", name: "Gold Spot", type: "commodity" },
    ];
    assert.deepEqual(
      filterHandPickSymbols(catalog, "btc").map((entry) => entry.symbol),
      ["BTCUSD"]
    );
    assert.deepEqual(
      filterHandPickSymbols(catalog, "gold").map((entry) => entry.symbol),
      ["XAUUSD"]
    );
    assert.deepEqual(
      filterHandPickSymbols(catalog, "usd", 2).map((entry) => entry.symbol),
      ["BTCUSD", "ETHUSD"]
    );
    assert.deepEqual(filterHandPickSymbols(catalog, "   "), []);
  });
});
