import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SYMBOLS, TAG_FAMILY, TAGS, TIMEFRAMES } from "../src/server/trainer/config";
import {
  REVIEW_COLUMNS,
  exportReviewCsv,
  importReviewCsv,
  parseCsv,
  reviewStats,
  selectReviewShortlist,
  serializeCsv,
  serializeReviewRows,
} from "../src/server/trainer/review";
import { CANDIDATE_COLUMNS } from "../src/server/trainer/scan";
import type {
  Candidate,
  Direction,
  Tag,
  TrainerSymbol,
  TrainerTimeframe,
} from "../src/server/trainer/types";

type Row = Record<string, string>;

interface RowOptions {
  id?: string;
  symbol?: string;
  timeframe?: string;
  cutIndex?: string;
  tag?: string;
  family?: string;
  direction?: string;
  startIndex?: string;
  endIndex?: string;
  levelUpper?: string;
  levelLower?: string;
  neckline?: string;
  notes?: string;
  status?: string;
  ambiguity?: string;
}

function defaultLevels(tag: string, direction: string): Row {
  switch (tag) {
    case "sweep_up":
    case "sweep_down":
      return { levelUpper: "101", levelLower: "99", neckline: "" };
    case "sr_flip":
      return direction === "down"
        ? { levelUpper: "101", levelLower: "", neckline: "" }
        : { levelUpper: "", levelLower: "99", neckline: "" };
    case "bos":
    case "choch":
      return direction === "down"
        ? { levelUpper: "", levelLower: "99", neckline: "" }
        : { levelUpper: "101", levelLower: "", neckline: "" };
    default:
      return { levelUpper: "", levelLower: "", neckline: "" };
  }
}

function makeRow(options: RowOptions = {}): Row {
  const symbol = options.symbol ?? "BTC";
  const timeframe = options.timeframe ?? "15m";
  const tag = options.tag ?? "sweep_up";
  const direction =
    options.direction ??
    (tag === "sweep_up" ? "down" : tag === "sweep_down" ? "up" : "");
  const startIndex = options.startIndex ?? "10";
  const endIndex = options.endIndex ?? "20";
  const family =
    options.family ??
    (TAG_FAMILY[tag as Tag] as string | undefined) ??
    "";
  const levels = defaultLevels(tag, direction);

  return {
    id:
      options.id ??
      `${symbol}:${timeframe}:${tag}:${startIndex}-${endIndex}:${direction || "none"}`,
    symbol,
    timeframe,
    cutIndex: options.cutIndex ?? "20",
    tag,
    family,
    direction,
    startIndex,
    endIndex,
    levelUpper: options.levelUpper ?? levels.levelUpper,
    levelLower: options.levelLower ?? levels.levelLower,
    neckline: options.neckline ?? levels.neckline,
    notes: options.notes ?? "",
    status: options.status ?? "",
    ambiguity: options.ambiguity ?? "",
  };
}

function reviewCsv(rows: readonly Row[]): string {
  return serializeCsv([
    [...REVIEW_COLUMNS],
    ...rows.map((row) => REVIEW_COLUMNS.map((column) => row[column] ?? "")),
  ]);
}

function reviewRows(rows: readonly Row[]) {
  const result = importReviewCsv(reviewCsv(rows));
  assert.deepEqual(result.errors, []);
  return result.rows;
}

function candidateCsv(rows: readonly Row[]): string {
  return serializeCsv([
    [...CANDIDATE_COLUMNS],
    ...rows.map((row) => CANDIDATE_COLUMNS.map((column) => row[column] ?? "")),
  ]);
}

function candidateOptions(options: {
  symbol?: TrainerSymbol;
  timeframe?: TrainerTimeframe;
  tag?: Tag;
  direction?: Direction | null;
  startIndex?: number;
  endIndex?: number;
  notes?: string;
} = {}): Candidate {
  const symbol = options.symbol ?? "BTC";
  const timeframe = options.timeframe ?? "15m";
  const tag = options.tag ?? "sweep_up";
  const direction =
    options.direction === undefined
      ? tag === "sweep_up"
        ? "down"
        : "up"
      : options.direction;
  const startIndex = options.startIndex ?? 10;
  const endIndex = options.endIndex ?? 20;
  const levels =
    tag === "sweep_up" || tag === "sweep_down"
      ? { levelUpper: 101, levelLower: 99, neckline: null }
      : { levelUpper: null, levelLower: null, neckline: null };

  return {
    id: `${symbol}:${timeframe}:${tag}:${startIndex}-${endIndex}:${
      direction ?? "none"
    }`,
    symbol,
    timeframe,
    cutIndex: endIndex,
    tag,
    family: TAG_FAMILY[tag],
    direction,
    bounds: { startIndex, endIndex },
    levels,
    notes: options.notes,
  };
}

describe("CSV parser and serializer", () => {
  test("round-trips commas, quotes, newlines and empty cells", () => {
    const rows = [
      ["a", "b,c", 'he said "hi"', "line1\nline2", ""],
      ["", "x", '"', "crlf\r\nnext", "z"],
    ];
    assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
  });

  test("serializes empty cells and drops only the trailing newline row", () => {
    assert.equal(serializeCsv([["a", "", "c"]]), "a,,c\n");
    assert.deepEqual(parseCsv("a,,c\n"), [["a", "", "c"]]);
    assert.deepEqual(parseCsv(""), []);
  });

  test("handles a UTF-8 BOM and quoted commas in headers", () => {
    assert.deepEqual(parseCsv("\uFEFFa,b\n1,2\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
    assert.deepEqual(parseCsv('"id","note, here"\n"x","y"\n'), [
      ["id", "note, here"],
      ["x", "y"],
    ]);
  });
});

describe("export", () => {
  test("uses the exact review column order with blank edit columns", () => {
    const candidate = candidateOptions({ notes: 'a,b "quoted"' });
    const csv = exportReviewCsv([candidate]);
    const grid = parseCsv(csv);

    assert.deepEqual(grid[0], [...REVIEW_COLUMNS]);
    assert.equal(
      REVIEW_COLUMNS.join(","),
      "id,symbol,timeframe,cutIndex,tag,family,direction,startIndex,endIndex,levelUpper,levelLower,neckline,notes,status,ambiguity"
    );
    assert.equal(grid[1][12], 'a,b "quoted"');
    assert.equal(grid[1][13], "");
    assert.equal(grid[1][14], "");
  });

  test("exports from candidate CSV text and preserves existing edits", () => {
    const plain = exportReviewCsv(candidateCsv([makeRow()]));
    const plainGrid = parseCsv(plain);
    assert.deepEqual(plainGrid[0], [...REVIEW_COLUMNS]);
    assert.equal(plainGrid[1][13], "");
    assert.equal(plainGrid[1][14], "");

    const edited = reviewCsv([makeRow({ status: "accept", ambiguity: "4" })]);
    const imported = importReviewCsv(exportReviewCsv(edited));
    assert.equal(imported.errors.length, 0);
    assert.equal(imported.rows[0].status, "accept");
    assert.equal(imported.rows[0].ambiguity, 4);
  });

  test("round-trips notes containing commas, quotes and newlines", () => {
    const candidate = candidateOptions({ notes: 'line 1, "quoted"\nline 2' });
    const imported = importReviewCsv(
      exportReviewCsv([candidate]),
      new Set([candidate.id])
    );
    assert.equal(imported.errors.length, 0);
    assert.equal(imported.rows[0].notes, candidate.notes);
  });
});

describe("import validation", () => {
  test("valid rows cover every status and report structured errors", () => {
    const rows = [
      makeRow(),
      makeRow({ tag: "bearish_engulfing", direction: "down" }),
      makeRow({ tag: "sr_flip", direction: "up" }),
      makeRow({ tag: "bos", direction: "down" }),
      makeRow({ tag: "bullish_engulfing", direction: "" }),
      makeRow({ status: "reject" }),
      makeRow({ status: "reject", ambiguity: "5" }),
      makeRow({ status: "accept", ambiguity: "3" }),
    ];
    const result = importReviewCsv(reviewCsv(rows));

    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, rows.length);
    assert.equal(result.rows[0].status, "pending");
    assert.equal(result.rows[0].ambiguity, null);
    assert.equal(result.rows.at(-1)?.status, "accept");
    assert.equal(result.rows.at(-1)?.ambiguity, 3);
  });

  test("every validation rule rejects its row without throwing", () => {
    const cases: [string, RowOptions, string][] = [
      ["bad status", { status: "maybe" }, "status"],
      ["accept needs ambiguity", { status: "accept" }, "ambiguity"],
      ["ambiguity not an integer", { status: "pending", ambiguity: "2.5" }, "ambiguity"],
      ["ambiguity out of range", { status: "reject", ambiguity: "6" }, "ambiguity"],
      ["bad symbol", { symbol: "DOGE" }, "symbol"],
      ["bad timeframe", { timeframe: "4h" }, "timeframe"],
      ["bad tag", { tag: "hammer" }, "tag"],
      ["family mismatch", { family: "candle" }, "family"],
      ["negative cutIndex", { cutIndex: "-1" }, "cutIndex"],
      ["fractional cutIndex", { cutIndex: "1.5" }, "cutIndex"],
      ["fractional startIndex", { startIndex: "1.5" }, "startIndex"],
      ["negative endIndex", { endIndex: "-2" }, "endIndex"],
      ["start after end", { startIndex: "30" }, "startIndex"],
      ["id does not match bounds", { id: "BTC:15m:sweep_up:10-21:down" }, "id"],
      ["bad direction", { direction: "sideways" }, "direction"],
      ["zero levelUpper", { levelUpper: "0" }, "levelUpper"],
      ["negative levelLower", { levelLower: "-5" }, "levelLower"],
      ["non-numeric neckline", { neckline: "NaN" }, "neckline"],
      ["infinite levelUpper", { levelUpper: "Infinity" }, "levelUpper"],
    ];

    for (const [name, options, field] of cases) {
      const result = importReviewCsv(reviewCsv([makeRow(options)]));
      assert.equal(result.rows.length, 0, name);
      assert.ok(
        result.errors.some((error) => error.field === field),
        `${name}: expected a ${field} error, got ${JSON.stringify(result.errors)}`
      );
      assert.ok(result.errors.every((error) => error.row === 2), name);
    }
  });

  test("collects errors from several bad rows instead of stopping", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({ status: "maybe" }),
        makeRow(),
        makeRow({ symbol: "DOGE" }),
      ])
    );

    assert.equal(result.rows.length, 1);
    assert.deepEqual(
      result.errors.map((error) => error.row),
      [2, 4]
    );
  });

  test("blank and null level cells are accepted for candle tags", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({
          tag: "bullish_engulfing",
          direction: "",
          levelUpper: "null",
          levelLower: "",
          neckline: "null",
        }),
      ])
    );

    assert.equal(result.errors.length, 0);
    assert.equal(result.rows[0].levelUpper, null);
    assert.equal(result.rows[0].levelLower, null);
    assert.equal(result.rows[0].neckline, null);
  });

  test("an id missing from the candidates CSV is rejected", () => {
    const row = makeRow();
    const result = importReviewCsv(reviewCsv([row]), new Set(["some-other-id"]));

    assert.equal(result.rows.length, 0);
    assert.ok(result.errors.some((error) => error.field === "id"));
  });

  test("a known id passes the candidates filter", () => {
    const row = makeRow();
    const result = importReviewCsv(reviewCsv([row]), new Set([row.id]));
    assert.equal(result.errors.length, 0);
    assert.equal(result.rows.length, 1);
  });
});

describe("tag-specific required levels", () => {
  const cases: [string, RowOptions, string][] = [
    ["sweep_up needs upper", { tag: "sweep_up", levelUpper: "" }, "levelUpper"],
    ["sweep_up needs lower", { tag: "sweep_up", levelLower: "" }, "levelLower"],
    ["sweep_down needs upper", { tag: "sweep_down", direction: "up", levelUpper: "" }, "levelUpper"],
    ["sweep_down needs lower", { tag: "sweep_down", direction: "up", levelLower: "" }, "levelLower"],
    ["sr_flip up needs lower", { tag: "sr_flip", direction: "up", levelLower: "" }, "levelLower"],
    ["sr_flip down needs upper", { tag: "sr_flip", direction: "down", levelUpper: "" }, "levelUpper"],
    ["bos up needs upper", { tag: "bos", direction: "up", levelUpper: "" }, "levelUpper"],
    ["bos down needs lower", { tag: "bos", direction: "down", levelLower: "" }, "levelLower"],
    ["choch up needs upper", { tag: "choch", direction: "up", levelUpper: "" }, "levelUpper"],
    ["choch down needs lower", { tag: "choch", direction: "down", levelLower: "" }, "levelLower"],
  ];

  for (const [name, options, field] of cases) {
    test(name, () => {
      const result = importReviewCsv(reviewCsv([makeRow(options)]));
      assert.equal(result.rows.length, 0);
      assert.ok(result.errors.some((error) => error.field === field));
    });
  }

  test("candle tags may leave every level blank", () => {
    const result = importReviewCsv(
      reviewCsv([makeRow({ tag: "bearish_engulfing", direction: "" })])
    );
    assert.equal(result.errors.length, 0);
  });
});

describe("id and bounds are read-only", () => {
  test("a mismatched id is rejected even when all other fields are valid", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({ id: "ETH:1h:bearish_engulfing:10-20:down" }),
      ])
    );
    assert.equal(result.rows.length, 0);
    assert.ok(result.errors.some((error) => error.field === "id"));
  });

  test("editing cutIndex and levels is allowed", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({ cutIndex: "25", levelUpper: "102.5", levelLower: "98" }),
      ])
    );
    assert.equal(result.errors.length, 0);
    assert.equal(result.rows[0].cutIndex, 25);
    assert.equal(result.rows[0].levelUpper, 102.5);
    assert.equal(result.rows[0].levelLower, 98);
  });

  test("editing bounds without the id is rejected", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({
          startIndex: "11",
          id: "BTC:15m:sweep_up:10-20:down",
        }),
      ])
    );
    assert.equal(result.rows.length, 0);
    assert.ok(result.errors.some((error) => error.field === "id"));
  });
});

describe("pending preservation", () => {
  test("export then import keeps every candidate as pending", () => {
    const candidates = [
      candidateOptions(),
      candidateOptions({ symbol: "ETH", timeframe: "1h", tag: "bearish_engulfing" }),
      candidateOptions({ symbol: "SOL", tag: "bullish_engulfing", direction: null }),
    ];
    const result = importReviewCsv(exportReviewCsv(candidates));

    assert.equal(result.errors.length, 0);
    assert.deepEqual(
      result.rows.map((row) => row.id),
      candidates.map((candidate) => candidate.id)
    );
    assert.ok(result.rows.every((row) => row.status === "pending"));
    assert.ok(result.rows.every((row) => row.ambiguity === null));
  });

  test("importing the same review twice is idempotent", () => {
    const text = reviewCsv([
      makeRow({ status: "accept", ambiguity: "2" }),
      makeRow({ tag: "bearish_engulfing", direction: "down", status: "reject" }),
      makeRow(),
    ]);
    const first = importReviewCsv(text);
    const second = importReviewCsv(text);
    assert.deepEqual(second, first);
  });
});

describe("stats", () => {
  test("counts by status, tag, ambiguity and series", () => {
    const result = importReviewCsv(
      reviewCsv([
        makeRow({ status: "accept", ambiguity: "1" }),
        makeRow({ status: "reject" }),
        makeRow({ tag: "bullish_engulfing", direction: "" }),
      ])
    );
    assert.equal(result.errors.length, 0);

    const stats = reviewStats(result.rows);
    assert.equal(stats.total, 3);
    assert.deepEqual(stats.byStatus, { pending: 1, accept: 1, reject: 1 });
    assert.equal(stats.byTag.sweep_up, 2);
    assert.equal(stats.byTag.bullish_engulfing, 1);
    assert.equal(stats.byAmbiguity["1"], 1);
    assert.equal(stats.byAmbiguity.blank, 2);
    assert.equal(stats.bySeries["BTC:15m"], 3);

    for (const tag of TAGS) assert.equal(typeof stats.byTag[tag], "number");
    for (const symbol of SYMBOLS) {
      for (const timeframe of TIMEFRAMES) {
        assert.equal(typeof stats.bySeries[`${symbol}:${timeframe}`], "number");
      }
    }
  });

  test("an empty set still reports every configured tag and series", () => {
    const stats = reviewStats([]);
    assert.equal(stats.total, 0);
    assert.deepEqual(stats.byStatus, { pending: 0, accept: 0, reject: 0 });
    assert.equal(Object.keys(stats.byTag).length, TAGS.length);
    assert.equal(Object.keys(stats.bySeries).length, SYMBOLS.length * TIMEFRAMES.length);
  });
});

describe("shortlist", () => {
  test("selects pending rows deterministically in source order", () => {
    const rows = reviewRows([
      makeRow({ startIndex: "10", endIndex: "20" }),
      makeRow({ startIndex: "30", endIndex: "40", status: "accept", ambiguity: "3" }),
      makeRow({ startIndex: "50", endIndex: "60", status: "reject" }),
      makeRow({ startIndex: "70", endIndex: "80", tag: "bearish_engulfing", direction: "down" }),
    ]);

    const first = selectReviewShortlist(rows);
    const second = selectReviewShortlist(rows);

    assert.deepEqual(first, second);
    assert.deepEqual(
      first.map((row) => row.id),
      [rows[0].id, rows[3].id]
    );
    assert.ok(first.every((row) => row.status === "pending"));
  });

  test("caps each tag at eight rows and reaches the 56-row target", () => {
    const rows = reviewRows(
      TAGS.flatMap((tag) =>
        Array.from({ length: 12 }, (_, index) =>
          makeRow({
            tag,
            startIndex: String(10 + index),
            endIndex: String(20 + index),
          })
        )
      )
    );

    const shortlist = selectReviewShortlist(rows);
    const stats = reviewStats(shortlist);

    assert.equal(shortlist.length, TAGS.length * 8);
    for (const tag of TAGS) assert.equal(stats.byTag[tag], 8);
  });

  test("alternates directions within a tag", () => {
    const rows = reviewRows(
      Array.from({ length: 20 }, (_, index) =>
        makeRow({
          tag: "sweep_up",
          direction: index % 2 === 0 ? "down" : "up",
          startIndex: String(10 + index),
          endIndex: String(20 + index),
        })
      )
    );

    const shortlist = selectReviewShortlist(rows, { perTag: 8 });
    const directions = { up: 0, down: 0, blank: 0 };
    for (const row of shortlist) {
      if (row.direction === "up") directions.up++;
      else if (row.direction === "down") directions.down++;
      else directions.blank++;
    }

    assert.deepEqual(directions, { up: 4, down: 4, blank: 0 });
  });

  test("round-robins across all six symbol:timeframe series", () => {
    const series = SYMBOLS.flatMap((symbol) =>
      TIMEFRAMES.map((timeframe) => ({ symbol, timeframe }))
    );
    const rows = reviewRows(
      series.flatMap(({ symbol, timeframe }, seriesIndex) =>
        Array.from({ length: 4 }, (_, index) =>
          makeRow({
            symbol,
            timeframe,
            tag: "sweep_up",
            direction: index % 2 === 0 ? "down" : "up",
            startIndex: String(10 + seriesIndex * 10 + index),
            endIndex: String(20 + seriesIndex * 10 + index),
          })
        )
      )
    );

    const shortlist = selectReviewShortlist(rows, { perTag: 8 });
    const stats = reviewStats(shortlist);
    const counts = series.map(
      ({ symbol, timeframe }) => stats.bySeries[`${symbol}:${timeframe}`]
    );

    assert.ok(counts.every((count) => count >= 1));
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  });

  test("serializes the exact review header with pending status and blank ambiguity", () => {
    const csv = serializeReviewRows(reviewRows([makeRow()]));
    const grid = parseCsv(csv);

    assert.deepEqual(grid[0], [...REVIEW_COLUMNS]);
    assert.equal(grid[1][13], "pending");
    assert.equal(grid[1][14], "");

    const imported = importReviewCsv(csv);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.rows.length, 1);
    assert.equal(imported.rows[0].status, "pending");
    assert.equal(imported.rows[0].ambiguity, null);
  });

  test("does not mutate source rows", () => {
    const rows = reviewRows([
      makeRow({ startIndex: "10", endIndex: "20" }),
      makeRow({ startIndex: "30", endIndex: "40", tag: "bullish_engulfing", direction: "" }),
      makeRow({ startIndex: "50", endIndex: "60", status: "accept", ambiguity: "2" }),
    ]);
    const before = rows.map((row) => ({ ...row }));

    selectReviewShortlist(rows);

    assert.deepEqual(rows, before);
  });

  test("round-trips a shortlist through import validation", () => {
    const rows = reviewRows(
      TAGS.flatMap((tag, tagIndex) =>
        Array.from({ length: 10 }, (_, index) =>
          makeRow({
            tag,
            startIndex: String(10 + tagIndex * 100 + index),
            endIndex: String(20 + tagIndex * 100 + index),
          })
        )
      )
    );
    const shortlist = selectReviewShortlist(rows);
    const imported = importReviewCsv(serializeReviewRows(shortlist));

    assert.deepEqual(imported.errors, []);
    assert.deepEqual(
      imported.rows.map((row) => row.id),
      shortlist.map((row) => row.id)
    );
    assert.ok(imported.rows.every((row) => row.status === "pending"));
    assert.ok(imported.rows.every((row) => row.ambiguity === null));
  });
});
