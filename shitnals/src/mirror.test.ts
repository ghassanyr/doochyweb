import assert from "node:assert";
import test from "node:test";
import { walkExit } from "./backtest.js";

/**
 * Synthetic check of the mirror identity N' = -N - 2C using walkExit, with hand-computed values.
 * Entry E = 100, SL distance s = 2 (SL 98), TP distance t = 4 (TP 104), round-trip cost C = 0.5.
 * Long original: fill bar 1 at open 100.
 * Mirror: short, stop' = TP = 104, target' = SL = 98, same fill 100.
 */
const E = 100;
const S = 98;
const T = 104;
const C = 0.5;
const TOL = 1e-12;

test("mirror identity holds exactly when no tie bar: TP original -> SL mirror", () => {
  // bar 0: fill bar, no hit. bar 1: high 104.5 reaches TP for original, and stop' for mirror.
  const opens = [99, 100, 100.5];
  const highs = [101, 101, 104.5];
  const lows = [99, 99, 100];
  const closes = [100, 100, 104];
  const orig = walkExit(opens, highs, lows, closes, 1, 1, S, T, E);
  assert.strictEqual(orig.reason, "TP");
  const gross = 1 * (orig.exitPrice - E); // +4
  const net = gross - C; // +3.5

  const mir = walkExit(opens, highs, lows, closes, 1, -1, T, S, E);
  assert.strictEqual(mir.reason, "SL");
  const mGross = -1 * (mir.exitPrice - E); // -4
  const mNet = mGross - C; // -4.5

  assert.ok(Math.abs(mNet - (-net - 2 * C)) < TOL, `mirror ${mNet} vs -N-2C ${-net - 2 * C}`);
});

test("mirror identity holds when original hits SL without a tie: mirror TP", () => {
  const opens = [99, 100, 100];
  const highs = [101, 101, 101];
  const lows = [99, 99, 97.5];
  const closes = [100, 100, 98];
  const orig = walkExit(opens, highs, lows, closes, 1, 1, S, T, E);
  assert.strictEqual(orig.reason, "SL");
  const net = (orig.exitPrice - E) - C; // -2.5
  const mir = walkExit(opens, highs, lows, closes, 1, -1, T, S, E);
  assert.strictEqual(mir.reason, "TP");
  const mNet = -1 * (mir.exitPrice - E) - C; // +1.5
  assert.ok(Math.abs(mNet - (-net - 2 * C)) < TOL);
});

test("tie bar: original takes SL, mirror takes its own SL (= original TP); divergence = -(s+t)", () => {
  // Bar 2 contains both 98 and 104 inside its range.
  const opens = [99, 100, 100.5];
  const highs = [101, 101, 104.5];
  const lows = [99, 99, 97]; // low below SL and high above TP
  const closes = [100, 100, 100];
  const orig = walkExit(opens, highs, lows, closes, 1, 1, S, T, E);
  assert.strictEqual(orig.reason, "SL");
  assert.strictEqual(orig.tie, true);
  const net = (orig.exitPrice - E) - C; // -2.5

  const mir = walkExit(opens, highs, lows, closes, 1, -1, T, S, E);
  assert.strictEqual(mir.reason, "SL");
  const mNet = -1 * (mir.exitPrice - E) - C; // -4.5

  const alg = -net - 2 * C; // 1.5
  const divergence = mNet - alg;
  const s = E - S; // 2
  const t = T - E; // 4
  assert.ok(Math.abs(divergence - -(s + t)) < TOL, `divergence ${divergence}, expected ${-(s + t)}`);
});
