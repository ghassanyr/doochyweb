import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import type { Candle } from "../src/server/market/types";
import { BARRIER_HORIZON, TAG_FAMILY } from "../src/server/trainer/config";
import {
  BATCHES_DIR,
  batchPath,
  buildBatch,
  seriesKey,
  writeBatchFile,
} from "../src/server/trainer/publish";
import type {
  Outcome,
  ReviewRow,
  ReviewStatus,
  Tag,
  TrainerSymbol,
  TrainerTimeframe,
} from "../src/server/trainer/types";

function bar(
  time: number,
  open = 100,
  high = 101,
  low = 99,
  close = 100,
  volume = 1
): Candle {
  return { time, open, high, low, close, volume };
}

function flatBars(length: number): Candle[] {
  return Array.from({ length }, (_, i) => bar(i));
}

/**
 * Flat context with a single resolving bar per cut. Cuts used by the tests are
 * spaced at least BARRIER_HORIZON apart, so one cut's reveal never resolves an
 * earlier/later cut accidentally.
 */
function seriesWithOutcomes(
  length: number,
  outcomes: Record<number, Outcome>
): Candle[] {
  const bars = flatBars(length);
  for (const [rawCut, outcome] of Object.entries(outcomes)) {
    const cut = Number(rawCut);
    const index = cut + 1;
    if (index >= length) continue;
    if (outcome === "up") bars[index] = bar(index, 100, 103, 99, 101);
    else if (outcome === "down") bars[index] = bar(index, 100, 101, 97, 99);
  }
  return bars;
}

interface RowOptions {
  symbol?: TrainerSymbol;
  timeframe?: TrainerTimeframe;
  tag?: Tag;
  cutIndex?: number;
  status?: ReviewStatus;
  direction?: "up" | "down" | null;
}

function makeRow(options: RowOptions = {}): ReviewRow {
  const symbol = options.symbol ?? "BTC";
  const timeframe = options.timeframe ?? "15m";
  const tag = options.tag ?? "inside_bar";
  const cutIndex = options.cutIndex ?? 100;
  return {
    id: `${symbol}:${timeframe}:${tag}:${cutIndex}-${cutIndex}:${
      options.direction ?? "none"
    }`,
    symbol,
    timeframe,
    cutIndex,
    tag,
    family: TAG_FAMILY[tag],
    direction: options.direction ?? null,
    startIndex: cutIndex,
    endIndex: cutIndex,
    status: options.status ?? "accept",
    ambiguity: 1,
    levelUpper: null,
    levelLower: null,
    neckline: null,
    notes: "",
  };
}

describe("overlap enforcement", () => {
  test("keeps the first cut and drops later cuts closer than H bars", () => {
    const bars = flatBars(400);
    const rows = [100, 110, 120, 140, 160].map((cut) =>
      makeRow({ cutIndex: cut })
    );

    const batch = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-overlap",
      now: 1,
    });

    assert.deepEqual(batch.items.map((item) => item.cutIndex), [100, 120, 140, 160]);
    assert.equal(batch.drops.length, 1);
    assert.equal(batch.drops[0].id, makeRow({ cutIndex: 110 }).id);
    assert.equal(batch.drops[0].reason, "overlap");
  });

  test("allows an exact H-bar gap and does not cross series", () => {
    const bars = flatBars(400);
    const rows = [
      makeRow({ symbol: "BTC", cutIndex: 100 }),
      makeRow({ symbol: "BTC", cutIndex: 100 + BARRIER_HORIZON }),
      makeRow({ symbol: "ETH", cutIndex: 100 }),
    ];

    const batch = buildBatch(
      rows,
      {
        [seriesKey("BTC", "15m")]: bars,
        [seriesKey("ETH", "15m")]: bars,
      },
      { version: "v-edge", now: 1 }
    );

    assert.equal(batch.items.length, 3);
    assert.equal(batch.drops.length, 0);
  });

  test("allowOverlap keeps every accepted row", () => {
    const bars = flatBars(400);
    const rows = [100, 110, 120, 130].map((cut) =>
      makeRow({ cutIndex: cut })
    );

    const batch = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-all",
      now: 1,
      allowOverlap: true,
    });

    assert.deepEqual(batch.items.map((item) => item.cutIndex), [100, 110, 120, 130]);
    assert.equal(batch.drops.length, 0);
  });
});

describe("invalid rows", () => {
  test("fails the build with the offending ids by default", () => {
    const bars = flatBars(300);
    const badCut = makeRow({ cutIndex: 290 });
    const missingSeries = makeRow({ symbol: "ETH", cutIndex: 100 });

    assert.throws(
      () =>
        buildBatch([badCut, missingSeries], { [seriesKey("BTC", "15m")]: bars }, {
          version: "v-bad",
          now: 1,
        }),
      (err: Error) =>
        err.message.includes(badCut.id) && err.message.includes(missingSeries.id)
    );
  });

  test("skipInvalid drops and reports them, keeping valid rows", () => {
    const bars = flatBars(300);
    const good = makeRow({ cutIndex: 100 });
    const badCut = makeRow({ cutIndex: 290 });
    const missingSeries = makeRow({ symbol: "ETH", cutIndex: 100 });

    const batch = buildBatch(
      [good, badCut, missingSeries],
      { [seriesKey("BTC", "15m")]: bars },
      { version: "v-skip", now: 1, skipInvalid: true }
    );

    assert.deepEqual(batch.items.map((item) => item.id), [good.id]);
    assert.deepEqual(
      batch.drops.filter((drop) => drop.reason === "invalid").map((drop) => drop.id).sort(),
      [badCut.id, missingSeries.id].sort()
    );
  });

  test("ignores pending and rejected rows", () => {
    const bars = flatBars(300);
    const accepted = makeRow({ cutIndex: 100 });
    const pending = makeRow({ cutIndex: 290, status: "pending" });
    const rejected = makeRow({ cutIndex: 290, status: "reject" });

    const batch = buildBatch(
      [pending, accepted, rejected],
      { [seriesKey("BTC", "15m")]: bars },
      { version: "v-status", now: 1 }
    );

    assert.deepEqual(batch.items.map((item) => item.id), [accepted.id]);
  });
});

describe("balance", () => {
  test("downsamples an over-represented outcome deterministically", () => {
    const cuts = Array.from({ length: 10 }, (_, i) => 100 + i * BARRIER_HORIZON);
    const downCut = 100 + 10 * BARRIER_HORIZON;
    const outcomes: Record<number, Outcome> = {};
    for (const cut of cuts) outcomes[cut] = "up";
    outcomes[downCut] = "down";

    const bars = seriesWithOutcomes(500, outcomes);
    const rows = [...cuts, downCut].map((cut) => makeRow({ cutIndex: cut }));

    const unordered = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-balance",
      now: 1,
      balance: true,
    });
    const ordered = buildBatch(
      [...rows].reverse(),
      { [seriesKey("BTC", "15m")]: bars },
      { version: "v-balance", now: 1, balance: true }
    );

    const counts = unordered.baseRateCounts.all;
    const balancedTotal = Math.floor(rows.length * 0.7);
    assert.equal(counts.up, balancedTotal);
    assert.equal(counts.down, 1);
    assert.equal(counts.scratch, 0);
    assert.equal(unordered.items.length, balancedTotal + 1);
    assert.equal(unordered.drops.length, rows.length - unordered.items.length);
    assert.deepEqual(
      unordered.items.map((item) => item.id),
      ordered.items.map((item) => item.id)
    );
    assert.deepEqual(
      unordered.drops.map((drop) => drop.id),
      ordered.drops.map((drop) => drop.id)
    );
    assert.ok(unordered.drops.every((drop) => drop.reason === "balance"));

    const unbalanced = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-nobalance",
      now: 1,
    });
    assert.equal(unbalanced.items.length, rows.length);
  });
});

describe("base rates", () => {
  test("counts and frequencies are per tag plus a pooled all row", () => {
    const outcomes: Record<number, Outcome> = {
      100: "up",
      120: "up",
      140: "down",
      160: "scratch",
      180: "down",
    };
    const bars = seriesWithOutcomes(400, outcomes);
    const rows = [
      makeRow({ tag: "inside_bar", cutIndex: 100 }),
      makeRow({ tag: "inside_bar", cutIndex: 120 }),
      makeRow({ tag: "inside_bar", cutIndex: 140 }),
      makeRow({ tag: "bullish_engulfing", cutIndex: 160 }),
      makeRow({ tag: "bullish_engulfing", cutIndex: 180 }),
    ];

    const batch = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-rates",
      now: 1,
    });

    assert.deepEqual(batch.baseRateCounts.inside_bar, {
      up: 2,
      down: 1,
      scratch: 0,
    });
    assert.deepEqual(batch.baseRateCounts.bullish_engulfing, {
      up: 0,
      down: 1,
      scratch: 1,
    });
    assert.deepEqual(batch.baseRateCounts.all, { up: 2, down: 2, scratch: 1 });

    for (const key of ["inside_bar", "bullish_engulfing", "all"]) {
      const counts = batch.baseRateCounts[key];
      const rates = batch.baseRates[key];
      const n = counts.up + counts.down + counts.scratch;
      assert.ok(n > 0);
      assert.ok(Math.abs(rates.up + rates.down + rates.scratch - 1) < 1e-12);
      assert.equal(rates.up, counts.up / n);
      assert.equal(rates.down, counts.down / n);
      assert.equal(rates.scratch, counts.scratch / n);
    }

    const byId = new Map(batch.items.map((item) => [item.id, item]));
    assert.equal(byId.get(makeRow({ tag: "inside_bar", cutIndex: 100 }).id)?.outcomeIndex, 101);
    assert.equal(byId.get(makeRow({ tag: "inside_bar", cutIndex: 140 }).id)?.outcomeIndex, 141);
    assert.equal(
      byId.get(makeRow({ tag: "bullish_engulfing", cutIndex: 160 }).id)?.outcomeIndex,
      null
    );
  });

  test("is deterministic and deeply frozen", () => {
    const bars = flatBars(400);
    const rows = [100, 120, 140, 160].map((cut) => makeRow({ cutIndex: cut }));

    const first = buildBatch(rows, { [seriesKey("BTC", "15m")]: bars }, {
      version: "v-deterministic",
      now: 123,
    });
    const second = buildBatch(
      [...rows].reverse(),
      { [seriesKey("BTC", "15m")]: bars },
      { version: "v-deterministic", now: 123 }
    );

    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.createdAt, 123);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.items));
    assert.ok(Object.isFrozen(first.items[0]));
    assert.ok(Object.isFrozen(first.items[0].barrier));
    assert.ok(Object.isFrozen(first.items[0].bounds));
    assert.ok(Object.isFrozen(first.baseRates));
    assert.ok(Object.isFrozen(first.baseRates.all));
    assert.ok(Object.isFrozen(first.baseRateCounts));
    assert.ok(Object.isFrozen(first.drops));
  });
});

describe("batch file I/O", () => {
  test("writes an immutable JSON snapshot and refuses overwrite without force", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "doochy-batch-"));
    try {
      const bars = seriesWithOutcomes(300, { 100: "up" });
      const batch = buildBatch(
        [makeRow({ cutIndex: 100 })],
        { [seriesKey("BTC", "15m")]: bars },
        { version: "v-file", now: 5 }
      );

      const written = await writeBatchFile(batch, { dir });
      assert.equal(written.path, path.join(dir, "v-file.json"));

      const parsed = JSON.parse(await readFile(written.path, "utf8")) as Record<
        string,
        unknown
      >;
      assert.equal(parsed.version, "v-file");
      assert.equal(parsed.createdAt, 5);
      assert.equal((parsed.items as unknown[]).length, 1);
      assert.equal("drops" in parsed, false);

      await assert.rejects(
        () => writeBatchFile(batch, { dir }),
        /already exists/
      );
      await assert.doesNotReject(() => writeBatchFile(batch, { dir, force: true }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("defaults under data/trainer/batches and rejects unsafe versions", () => {
    assert.equal(batchPath("v1"), path.join(BATCHES_DIR, "v1.json"));
    assert.throws(() => batchPath("../v1"), /must use only/);
    assert.throws(() => batchPath("v/1"), /must use only/);
  });
});
