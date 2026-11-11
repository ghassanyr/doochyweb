import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  accuracyPercent,
  advanceDailyProgress,
  createDailyProgress,
  directionFromProbability,
  isDailyProgress,
  localDayKey,
  recordDailyResult,
  scoreAnswer,
  shouldResetDailyProgress,
  summarizeResults,
} from "../src/webapp/src/learn/scoring";

describe("directionFromProbability", () => {
  test("converts 50% to up and below 50% to down", () => {
    assert.equal(directionFromProbability(0.5), "up");
    assert.equal(directionFromProbability(0.5001), "up");
    assert.equal(directionFromProbability(0.4999), "down");
    assert.equal(directionFromProbability(0), "down");
    assert.equal(directionFromProbability(1), "up");
  });

  test("rejects probabilities outside 0..1", () => {
    assert.throws(() => directionFromProbability(-0.01), /between 0 and 1/);
    assert.throws(() => directionFromProbability(1.01), /between 0 and 1/);
    assert.throws(() => directionFromProbability(Number.NaN), /between 0 and 1/);
  });
});

describe("scoreAnswer", () => {
  test("grades directional calls, with scratch counted as incorrect", () => {
    assert.equal(scoreAnswer(0.5, "take", "up").directionCorrect, true);
    assert.equal(scoreAnswer(0.2, "take", "up").directionCorrect, false);
    assert.equal(scoreAnswer(0.9, "take", "down").directionCorrect, false);
    assert.equal(scoreAnswer(0.5, "take", "scratch").directionCorrect, false);
    assert.equal(scoreAnswer(0.1, "pass", "scratch").directionCorrect, false);
  });

  test("grades take/pass against the realized outcome", () => {
    const takeRight = scoreAnswer(0.8, "take", "up");
    assert.equal(takeRight.tradeCorrect, true);

    const takeWrong = scoreAnswer(0.8, "take", "down");
    assert.equal(takeWrong.tradeCorrect, false);

    const passCorrect = scoreAnswer(0.2, "pass", "up");
    assert.equal(passCorrect.tradeCorrect, true);

    const passWrong = scoreAnswer(0.2, "pass", "down");
    assert.equal(passWrong.tradeCorrect, false);

    const passScratch = scoreAnswer(0.9, "pass", "scratch");
    assert.equal(passScratch.tradeCorrect, true);
  });

  test("keeps the raw probability for future calibration", () => {
    const result = scoreAnswer(0.37, "pass", "down");
    assert.equal(result.probability, 0.37);
    assert.equal(result.directionCall, "down");
  });
});

describe("accuracy summary", () => {
  test("counts direction and trade separately", () => {
    const results = [
      scoreAnswer(0.8, "take", "up"),
      scoreAnswer(0.7, "take", "down"),
      scoreAnswer(0.2, "pass", "up"),
      scoreAnswer(0.1, "pass", "down"),
      scoreAnswer(0.3, "pass", "down"),
    ];
    const summary = summarizeResults(results);

    assert.deepEqual(summary.direction, { correct: 3, total: 5 });
    assert.deepEqual(summary.trade, { correct: 2, total: 5 });
    assert.equal(accuracyPercent(summary.direction), 60);
    assert.equal(accuracyPercent(summary.trade), 40);
  });

  test("returns null accuracy for an empty bucket", () => {
    assert.equal(accuracyPercent({ correct: 0, total: 0 }), null);
    assert.deepEqual(summarizeResults([]), {
      direction: { correct: 0, total: 0 },
      trade: { correct: 0, total: 0 },
    });
  });
});

describe("daily progress", () => {
  const ids = ["item-0001", "item-0002"];

  test("resets only when the day or batch version changes", () => {
    const progress = createDailyProgress("2026-11-09", "batch-a", ids);
    assert.equal(
      shouldResetDailyProgress(progress, "2026-11-09", "batch-a"),
      false
    );
    assert.equal(
      shouldResetDailyProgress(progress, "2026-11-10", "batch-a"),
      true
    );
    assert.equal(
      shouldResetDailyProgress(progress, "2026-11-09", "batch-b"),
      true
    );
  });

  test("records a result in place and advances through the queue", () => {
    const first = scoreAnswer(0.8, "take", "up");
    let progress = createDailyProgress("2026-11-09", "batch-a", ids);
    progress = recordDailyResult(progress, first);
    assert.deepEqual(progress.results, [first]);
    assert.equal(progress.index, 0);

    progress = advanceDailyProgress(progress);
    assert.equal(progress.index, 1);

    const second = scoreAnswer(0.2, "pass", "down");
    progress = recordDailyResult(progress, second);
    assert.deepEqual(progress.results, [first, second]);
    assert.equal(progress.results[0].probability, 0.8);
    assert.equal(progress.results[1].probability, 0.2);

    progress = advanceDailyProgress(progress);
    assert.equal(progress.index, 2);
    assert.equal(progress.index, progress.itemIds.length);
  });

  test("builds a local calendar day key", () => {
    const local = new Date(2026, 10, 9, 23, 59, 0);
    assert.equal(localDayKey(local), "2026-11-09");
  });

  test("validates saved progress before trusting localStorage", () => {
    const progress = createDailyProgress("2026-11-09", "batch-a", ids);
    assert.equal(isDailyProgress(progress), true);
    assert.equal(
      isDailyProgress({
        ...progress,
        results: [scoreAnswer(0.8, "take", "up")],
      }),
      true
    );
    assert.equal(isDailyProgress(null), false);
    assert.equal(isDailyProgress({ ...progress, index: 3 }), false);
    assert.equal(isDailyProgress({ ...progress, results: [{}] }), false);
    assert.equal(
      isDailyProgress({ ...progress, itemIds: ["ok", 42] }),
      false
    );
  });
});
