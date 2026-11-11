import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildEvidence, differenceCI, evidenceFacts, evidencePoints } from "../src/server/market/evidence";

describe("difference interval", () => {
  test("is the Newcombe interval around the difference of shares", () => {
    const res = differenceCI(60, 100, 30, 100);
    assert.ok(res);
    assert.equal(Number(res!.diff.toFixed(4)), 0.3);
    assert.ok(res!.ci[0] > 0, "a 60/100 vs 30/100 gap excludes zero");
    assert.ok(res!.ci[1] > res!.ci[0]);
  });

  test("includes zero when the gap is small", () => {
    const res = differenceCI(40, 100, 30, 100);
    assert.ok(res);
    assert.ok(res!.ci[0] <= 0 && res!.ci[1] >= 0);
  });

  test("returns null with an empty group", () => {
    assert.equal(differenceCI(1, 0, 2, 10), null);
  });
});

describe("evidence grade", () => {
  test("insufficient when a group has too few decisive cases", () => {
    const ev = buildEvidence({ up_first: 4, down_first: 1, base_up_first: 30, base_down_first: 30 });
    assert.equal(ev?.grade, "insufficient");
  });

  test("weak when the interval includes no difference", () => {
    const ev = buildEvidence({ up_first: 40, down_first: 60, base_up_first: 30, base_down_first: 70 });
    assert.equal(ev?.grade, "weak");
  });

  test("moderate when the interval excludes zero but the matched sample is under 30", () => {
    const ev = buildEvidence({ up_first: 20, down_first: 5, base_up_first: 20, base_down_first: 30 });
    assert.equal(ev?.grade, "moderate");
    assert.ok((ev?.diff ?? 0) > 0);
  });

  test("strong only for a large, well-sampled gap", () => {
    const ev = buildEvidence({ up_first: 60, down_first: 40, base_up_first: 30, base_down_first: 70 });
    assert.equal(ev?.grade, "strong");
  });

  test("reports signed percentage points", () => {
    const ev = buildEvidence({ up_first: 60, down_first: 40, base_up_first: 30, base_down_first: 70 });
    assert.equal(evidencePoints(ev!), 30);
  });

  test("facts avoid significance, probability and prediction language", () => {
    const ev = buildEvidence({ up_first: 60, down_first: 40, base_up_first: 30, base_down_first: 70 });
    const text = evidenceFacts(ev!).join(" ");
    assert.ok(!/significan|probab|predict/i.test(text));
    assert.ok(text.includes("30 points"));
    assert.ok(text.includes("clear difference"));
  });
});
