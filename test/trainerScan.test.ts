import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import { BARRIER_HORIZON, TAGS } from "../src/server/trainer/config";
import {
  CANDIDATE_COLUMNS,
  MIN_CONTEXT_BARS,
  candidatesCsv,
  emitCandidatesCsv,
  isReviewable,
  sampleEvenly,
  scanHistory,
  scanSeries,
} from "../src/server/trainer/scan";
import type { Candidate } from "../src/server/trainer/types";

function bar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1
): Candle {
  return { time, open, high, low, close, volume };
}

/**
 * Repeating red/green pair. Every odd bar is a bullish engulfing of the even
 * bar before it, so a long series has many matches to cap and sample.
 */
function engulfSeries(length: number): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < length; i++) {
    bars.push(
      i % 2 === 0
        ? bar(i, 100, 100.5, 98.5, 99)
        : bar(i, 98.5, 101, 98, 100.5)
    );
  }
  return bars;
}

function sampleCandidate(): Candidate {
  return {
    id: "BTC:15m:sweep_up:0-1:down",
    symbol: "BTC",
    timeframe: "15m",
    cutIndex: 1,
    tag: "sweep_up",
    family: "liquidity",
    direction: "down",
    bounds: { startIndex: 0, endIndex: 1 },
    levels: { levelUpper: 100, levelLower: 90, neckline: null },
    notes: 'tricky, "quoted" note',
  };
}

describe("scan guards", () => {
  test("isReviewable requires 60 bars behind and H bars ahead", () => {
    assert.equal(isReviewable(MIN_CONTEXT_BARS - 1, 100), false);
    assert.equal(isReviewable(MIN_CONTEXT_BARS, 100), true);
    assert.equal(isReviewable(60, 81), true);
    assert.equal(isReviewable(60, 80), false);
    assert.equal(isReviewable(10.5, 100), false);
  });

  test("guarded candidates all fit inside the context and horizon windows", () => {
    const bars = engulfSeries(200);
    const result = scanSeries("BTC", "15m", bars, 3);

    assert.ok(result.candidates.length > 0);
    for (const candidate of result.candidates) {
      assert.ok(candidate.cutIndex >= MIN_CONTEXT_BARS);
      assert.ok(candidate.cutIndex + BARRIER_HORIZON <= bars.length - 1);
    }
  });
});

describe("deterministic cap", () => {
  test("sampleEvenly keeps everything when it fits and spaces larger sets", () => {
    assert.deepEqual(sampleEvenly([0, 1, 2, 3, 4], 10), [0, 1, 2, 3, 4]);
    assert.deepEqual(sampleEvenly([0, 1, 2, 3, 4], 3), [0, 2, 4]);
    assert.deepEqual(sampleEvenly([0, 1, 2, 3, 4], 1), [2]);
    assert.deepEqual(sampleEvenly([0, 1, 2, 3, 4], 0), []);
    assert.deepEqual(sampleEvenly([], 3), []);
  });

  test("the per-tag cap keeps a deterministic, evenly spaced subset", () => {
    const bars = engulfSeries(200);
    const result = scanSeries("BTC", "15m", bars, 3);

    assert.equal(result.matchedByTag.bullish_engulfing, 60);
    assert.equal(result.emittedByTag.bullish_engulfing, 3);

    const cuts = result.candidates
      .filter((c) => c.tag === "bullish_engulfing")
      .map((c) => c.cutIndex);
    assert.deepEqual(cuts, [61, 121, 179]);
  });

  test("scanning twice yields identical candidates and counts", () => {
    const bars = engulfSeries(200);
    assert.deepEqual(
      scanSeries("BTC", "15m", bars),
      scanSeries("BTC", "15m", bars)
    );
  });

  test("candidates are sorted by cut and scanHistory matches scanSeries", () => {
    const bars = engulfSeries(200);
    const result = scanSeries("BTC", "15m", bars);
    const cuts = result.candidates.map((c) => c.cutIndex);
    assert.deepEqual(cuts, [...cuts].sort((a, b) => a - b));
    assert.deepEqual(scanHistory("BTC", "15m", bars), result.candidates);
  });

  test("every tag is present in the count records", () => {
    const result = scanSeries("BTC", "15m", engulfSeries(200));
    assert.deepEqual(Object.keys(result.matchedByTag).sort(), [...TAGS].sort());
    assert.deepEqual(Object.keys(result.emittedByTag).sort(), [...TAGS].sort());
  });

  test("ids encode symbol, timeframe, tag, span and direction", () => {
    const result = scanSeries("BTC", "15m", engulfSeries(200), 1);
    const hit = result.candidates.find((c) => c.tag === "bullish_engulfing");
    assert.ok(hit);
    assert.match(hit.id, /^BTC:15m:bullish_engulfing:\d+-\d+:(up|down|none)$/);
  });
});

describe("candidates CSV", () => {
  test("header is exactly the review schema", () => {
    assert.equal(
      CANDIDATE_COLUMNS.join(","),
      "id,symbol,timeframe,cutIndex,tag,family,direction,startIndex,endIndex,levelUpper,levelLower,neckline,notes"
    );
    assert.equal(candidatesCsv([]), CANDIDATE_COLUMNS.join(",") + "\n");
  });

  test("null levels are empty and notes are escaped", () => {
    const csv = candidatesCsv([sampleCandidate()]);
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[1], sampleCandidateRow());
  });

  test("emitCandidatesCsv writes the run file into the chosen directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "trainer-scan-"));
    try {
      const result = await emitCandidatesCsv([sampleCandidate()], {
        dir,
        runId: "run-1",
      });

      assert.equal(result.runId, "run-1");
      assert.equal(result.rows, 1);
      assert.equal(result.path, path.join(dir, "run-1.csv"));
      assert.equal(
        await readFile(result.path, "utf8"),
        candidatesCsv([sampleCandidate()])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function sampleCandidateRow(): string {
  return [
    "BTC:15m:sweep_up:0-1:down",
    "BTC",
    "15m",
    "1",
    "sweep_up",
    "liquidity",
    "down",
    "0",
    "1",
    "100",
    "90",
    "",
    '"tricky, ""quoted"" note"',
  ].join(",");
}
