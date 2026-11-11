import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import type { SearchResult, Summary } from "../src/server/market/analogues";
import type { RunRecord } from "../src/server/market/breakoutFeed";
import type { MarketContext } from "../src/server/market/context";
import {
  NARRATION_MAX_WORDS, RESEARCH_LABEL, buildNarrationInput, canPublish, groundednessWarnings,
  narrationEventKey, narrationFacts, narrationId, narrationModelInput, narrationRunId, narrationWords,
  templateNarration, type NarrationRecord,
} from "../src/server/market/narration";
import { listNarrations, loadNarration, saveNarration } from "../src/server/market/narrationStore";

const summary = (n: number): Summary => ({
  n, up_first: Math.round(n * 0.4), down_first: Math.round(n * 0.3), tie: 0,
  neither: n - Math.round(n * 0.4) - Math.round(n * 0.3),
  upFirstRate: 0.4, downFirstRate: 0.3, upFirstCI95: [0.25, 0.55], downFirstCI95: [0.18, 0.45],
  medianMfe: 1.6, medianMae: -1.1,
});

const search = (asOf: string): SearchResult => ({
  asOf, lastBarTime: asOf,
  query: { rsi14: 55, atrPct: 1.2, adx14: 22, volRatio: 1.1, rangeRatio: 0.9 },
  k: 20, poolSize: 400, matches: [],
  matchSummary: summary(20), baseRate: summary(400),
  bySplit: {
    train: summary(14),
    test: { ...summary(6), up_first: 1, down_first: 4, neither: 1, upFirstRate: 1 / 6, downFirstRate: 4 / 6 },
  },
  matchSplit: { train: 14, test: 6 },
  note: "historical matches only",
});

const run = (): RunRecord => ({
  kind: "breakout_run",
  timestamp_utc: "2026-11-03T16:13:37.827Z",
  asOf: "2026-11-03T16:00:00.000Z",
  backfilled: false,
  evaluated: ["XAUUSD", "EURUSD"],
  skipped: { FTSERAFIUS1000: "stale" },
  breakouts: [{
    id: "XAUUSD:2026-11-03T16:00:00.000Z:resistance_break",
    symbol: "XAUUSD", type: "resistance_break",
    level_price: 4010.25, level_type: "swing_high", break_price: 4012.5,
    break_atr_mult: 1.3, confirmation: "1h_close_and_volume",
    session: "ny", timestamp_utc: "2026-11-03T16:00:00.000Z",
  }],
});

describe("narration input", () => {
  test("joins analogues and exposes only citable fields", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]), { now: Date.UTC(2026, 10, 3, 16, 14) });
    const b = input.breakouts[0];
    assert.equal(b.analogue?.sample_size, 20);
    assert.equal(b.analogue?.out_of_sample.test.n, 6);
    assert.equal(b.analogue_error, null);
    assert.equal(b.brief?.history?.sample_size, 20);
    assert.equal(Number(b.brief?.history?.decisive_up_share?.toFixed(4)), 0.5714);
    assert.equal(b.brief?.history?.recent_conflicts, true);
    assert.ok(b.brief?.limits.some((line) => line.includes("generic 4H bars")));
    assert.equal((b as unknown as Record<string, unknown>).id, undefined, "internal dedup id is not citable");
    assert.equal(input.run.evaluated_count, 2);
    assert.equal(input.run_id, narrationRunId(run()));
    assert.ok(input.caveats.includes(RESEARCH_LABEL));
    assert.ok(input.caveats.some((c) => c.includes("out-of-sample test sample is small")));
  });

  test("missing analogue is explicit, not silently dropped", () => {
    const input = buildNarrationInput(run(), new Map(), { analogueErrors: new Map([["XAUUSD", "history is stale"]]) });
    assert.equal(input.breakouts[0].analogue, null);
    assert.equal(input.breakouts[0].analogue_error, "history is stale");
    assert.ok(input.caveats.some((c) => c.includes("do not infer historical odds")));
  });

  test("no breakouts is stated, not hidden", () => {
    const empty = { ...run(), breakouts: [] };
    const input = buildNarrationInput(empty, new Map());
    assert.equal(input.breakouts.length, 0);
    assert.ok(input.caveats.some((c) => c.includes("No breakouts fired")));
  });

  test("record ids are filesystem-safe and stable per run/model", () => {
    const rid = narrationRunId(run());
    assert.match(rid, /^[0-9A-Za-z-]+$/);
    assert.notEqual(narrationId(rid, "template"), narrationId(rid, "nvidia/nemotron-3"));
    assert.match(narrationId(rid, "nvidia/nemotron-3"), /^[0-9A-Za-z._-]+$/);
  });
});

describe("template narration", () => {
  test("cites the breakout fields and sample sizes", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const text = templateNarration(input);
    assert.ok(text.includes("XAUUSD resistance break"));
    assert.ok(text.includes("4010.25"));
    assert.ok(text.includes("4012.5"));
    assert.ok(text.includes("1.30 ATR"));
    assert.ok(text.includes("Of 20 nearby 4H bars"));
    assert.ok(text.includes("recent pool"));
    assert.ok(!text.includes(RESEARCH_LABEL));
    assert.ok(text.startsWith("XAUUSD resistance break"));
  });

  test("template output passes the groundedness lint", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    assert.deepEqual(groundednessWarnings(input, templateNarration(input)), []);
  });

  test("lint flags a number absent from the snapshot", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const warnings = groundednessWarnings(input, "RESEARCH ONLY. The break was 9999.99.");
    assert.ok(warnings.some((w) => w.includes("9999.99")));
  });

  test("lint flags restated outcome counts", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const warnings = groundednessWarnings(input, "RESEARCH ONLY. There was 1 tie and 1 neither, and up first occurred 8 times.");
    assert.ok(warnings.some((w) => w.includes("restates outcome counts")));
  });

  test("lint flags an overlap/significance claim", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const warnings = groundednessWarnings(input, "RESEARCH ONLY. The intervals do not overlap the base rate.");
    assert.ok(warnings.some((w) => w.includes("inference claim")));
  });

  test("lint allows rounded rates that match the snapshot", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    assert.deepEqual(groundednessWarnings(input, "RESEARCH ONLY. up-first 0.40, n=20."), []);
  });

  test("does not imply odds when there is no analogue", () => {
    const input = buildNarrationInput(run(), new Map());
    const text = templateNarration(input);
    assert.ok(text.includes("No nearby-bar history was available"));
    assert.ok(text.includes("no historical odds are implied"));
  });

  test("facts are plain English and the model payload drops run plumbing", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const facts = narrationFacts(input.breakouts[0].brief!);
    assert.ok(facts.some((f) => f.includes("closed at 4012.5")));
    assert.ok(facts.some((f) => f.includes("59%") || f.includes("57%")));
    assert.ok(facts.some((f) => f.includes("invalidates the break") || f.includes("invalidate the break")));
    const payload = narrationModelInput(input);
    assert.deepEqual(payload.symbols, ["XAUUSD"]);
    assert.ok(payload.facts.length > 3);
    assert.ok(!JSON.stringify(payload).includes("FTSERAFIUS1000"));
    assert.ok(!JSON.stringify(payload).includes("evaluated_count"));
  });

  test("lint rejects raw field names, timestamps and confidence intervals", () => {
    const input = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]));
    const bad = "RESEARCH ONLY. up_first_rate was 0.40 at 2026-11-03T16:00:00.000Z (95% CI 0.25 to 0.55).";
    const warnings = groundednessWarnings(input, bad);
    assert.ok(warnings.some((w) => w.includes("raw field name")));
    assert.ok(warnings.some((w) => w.includes("raw ISO timestamp")));
    assert.ok(warnings.some((w) => w.includes("confidence intervals")));
  });
});

describe("market context and evidence", () => {
  const ctx: MarketContext = {
    bar_hours: 4,
    bars: 260,
    trend: "up",
    adx: 24.5,
    ema50: 3990.5,
    ema200: 3950.25,
    range_position: 0.82,
    range_bars: 120,
    level_touches: 3,
    level_age_bars: 8,
    touch_lookback: 60,
    atr: 2,
    atr_percentile: 0.7,
    atr_percentile_bars: 250,
    volume_ratio: 1.6,
    volume_avg_bars: 20,
  };

  const withContext = () => {
    const key = narrationEventKey(run().breakouts[0]);
    return buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]), {
      contexts: new Map([[key, ctx]]),
    });
  };

  test("attaches the context snapshot and a graded evidence block", () => {
    const input = withContext();
    const brief = input.breakouts[0].brief!;
    assert.deepEqual(brief.context, ctx);
    assert.ok(brief.evidence);
    assert.equal(brief.evidence!.n_match, 14);
    assert.equal(brief.evidence!.n_base, 280);
    assert.equal(brief.evidence!.grade, "weak");
  });

  test("buffers the invalidation level by the context ATR", () => {
    const brief = withContext().breakouts[0].brief!;
    assert.equal(brief.invalidation_atr_buffer, 0.75);
    assert.equal(brief.invalidation_level, 4008.75);
  });

  test("context and evidence appear in the facts", () => {
    const brief = withContext().breakouts[0].brief!;
    const facts = narrationFacts(brief).join(" ");
    assert.ok(facts.includes("an up trend with ADX 24.5"));
    assert.ok(facts.includes("82% of the 120-bar range"));
    assert.ok(facts.includes("70th percentile"));
    assert.ok(facts.includes("tested on 3 prior bars"));
    assert.ok(facts.includes("1.6x the 20-bar average"));
    assert.ok(facts.includes("level with the base rate"));
    assert.ok(facts.includes("0.75 ATR beyond the level"));
  });

  test("the contextual template still passes the groundedness lint", () => {
    const input = withContext();
    const text = templateNarration(input);
    assert.deepEqual(groundednessWarnings(input, text), []);
    assert.ok(narrationWords(text) <= NARRATION_MAX_WORDS, "template stays within the publishable word limit");
  });

  test("without context the ATR is implied by the break distance", () => {
    const brief = buildNarrationInput(run(), new Map([["XAUUSD", search("2026-11-03T16:00:00.000Z")]]))
      .breakouts[0].brief!;
    assert.equal(brief.context, null);
    // |4012.5 - 4010.25| / 1.3 = 1.7307..., buffered by 0.75 ATR.
    const expected = Number((4010.25 - 0.75 * (2.25 / 1.3)).toFixed(6));
    assert.equal(brief.invalidation_level, expected);
    assert.ok(brief.limits.some((line) => line.includes("No 4H context")));
  });

  test("falls back to the raw level when no ATR is available", () => {
    const noAtr = run();
    // A zero multiple cannot imply an ATR, so the level stands un-buffered.
    noAtr.breakouts[0] = { ...noAtr.breakouts[0], break_atr_mult: 0 };
    const brief = buildNarrationInput(noAtr, new Map()).breakouts[0].brief!;
    assert.equal(brief.invalidation_level, 4010.25);
    assert.equal(brief.invalidation_atr_buffer, 0);
    assert.ok(!narrationFacts(brief).some((line) => line.includes("ATR beyond the level")));
  });
});

describe("per-event narration", () => {
  const first = () => run().breakouts[0];

  test("event keys are stable and distinguish a different event", () => {
    assert.equal(narrationEventKey(first()), narrationEventKey({ ...first() }));
    assert.notEqual(
      narrationEventKey(first()),
      narrationEventKey({ ...first(), level_price: 4011.25 })
    );
  });

  test("a per-event id stays distinct from the run record", () => {
    const key = narrationEventKey(first());
    const runId = narrationRunId(run());
    assert.notEqual(narrationId(runId, "m", 2), narrationId(runId, "m", 2, key));
    assert.match(narrationId(runId, "m", 2, key), /__[0-9a-f]{8}$/);
  });

  test("input can be scoped to one event", () => {
    const key = narrationEventKey(first());
    const input = buildNarrationInput(run(), new Map(), { eventKey: key });
    assert.equal(input.breakouts.length, 1);
    assert.equal(input.event_key, key);
    assert.equal(input.symbol, "XAUUSD");
    assert.equal(input.breakouts[0].symbol, "XAUUSD");
  });

  test("publish guard requires clean text within the word limit", () => {
    assert.equal(canPublish("RESEARCH ONLY. Clean.", []), true);
    assert.equal(canPublish("", []), false);
    assert.equal(canPublish("RESEARCH ONLY. Clean.", ["flagged"]), false);
    const long = "RESEARCH ONLY. " + Array.from({ length: NARRATION_MAX_WORDS }, () => "word").join(" ");
    assert.equal(narrationWords(long), NARRATION_MAX_WORDS + 2);
    assert.equal(canPublish(long, []), false);
  });
});

describe("narration audit store", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "narration-"));
  const record = (id: string, model: string): NarrationRecord => {
    const input = buildNarrationInput(run(), new Map());
    return {
      id, run_id: input.run_id, created_at: "2026-11-03T16:14:00.000Z", model,
      prompt_version: 1, input, output: templateNarration(input), groundedness: [],
    };
  };

  test("round-trips and keeps one file per model", () => {
    const dir = tmp();
    const rid = narrationRunId(run());
    saveNarration(record(narrationId(rid, "template"), "template"), dir);
    saveNarration(record(narrationId(rid, "nemotron"), "nemotron"), dir);
    assert.equal(listNarrations(dir).length, 2);
    const loaded = loadNarration(narrationId(rid, "template"), dir);
    assert.equal(loaded?.model, "template");
    assert.equal(loaded?.input.breakouts[0].symbol, "XAUUSD");
  });

  test("missing and broken files do not throw", () => {
    const dir = tmp();
    assert.equal(loadNarration("nope", dir), null);
    fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
    assert.deepEqual(listNarrations(dir), []);
  });
});
