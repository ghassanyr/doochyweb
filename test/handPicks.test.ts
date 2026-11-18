import assert from "node:assert/strict";
import { describe, test } from "node:test";

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
      createdAt: "2026-11-18T09:30:00.000Z",
      updatedAt: "2026-11-18T09:30:00.000Z",
    });
  });

  test("drops an unknown level type", () => {
    const pick = publicHandPick({ symbol: "BTCUSD", levelType: "pivot" });
    assert.equal(pick.levelType, null);
  });
});
