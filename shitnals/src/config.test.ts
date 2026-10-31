import assert from "node:assert";
import test from "node:test";
import { roundTripCost, SPREAD_TABLE } from "./config.js";

test("US100 is unmeasured and refuses to produce a cost", () => {
  assert.strictEqual(SPREAD_TABLE.US100, null);
  assert.throws(() => roundTripCost("US100", 20000), /No spread measurement for US100/);
});

test("XAUUSD round-trip cost: spread 0.10 + 2 * (2500/100/1e6) * 4000 = 0.30", () => {
  assert.ok(Math.abs(roundTripCost("XAUUSD", 4000) - 0.3) < 1e-12);
});

test("commission divisor override scales only the commission term", () => {
  const base = roundTripCost("XAUUSD", 4000, 100);
  const x10 = roundTripCost("XAUUSD", 4000, 10);
  assert.ok(Math.abs(x10 - (0.1 + 10 * (base - 0.1))) < 1e-9);
});
