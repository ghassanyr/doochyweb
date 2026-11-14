import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CSV_COLUMNS,
  csvField,
  journalCsv,
  validateJournalInput,
} from "../src/server/journal/validate";
import { computeJournalStats, toJournalView } from "../src/server/journal/store";
import { historyRowToJournal } from "../src/server/journal/import";
import type { JournalEntryView } from "../src/server/journal/types";
import type { OrderHistoryRow } from "../src/server/ctrader/history";

function entry(overrides: Partial<JournalEntryView> = {}): JournalEntryView {
  return {
    id: "e1",
    source: "manual",
    dealId: null,
    accountCtid: null,
    accountLabel: null,
    symbol: "EURUSD",
    side: "buy",
    lots: 1,
    entryPrice: 100,
    exitPrice: 110,
    stop: 95,
    target: 110,
    pnl: 100,
    fees: 0,
    openedAt: null,
    closedAt: "2026-01-10T10:00:00.000Z",
    status: "closed",
    verified: false,
    strategy: "",
    tags: [],
    note: "",
    createdAt: "2026-01-10T10:00:00.000Z",
    updatedAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("validateJournalInput", () => {
  test("requires a symbol and a side", () => {
    assert.equal(validateJournalInput({ side: "buy" }).ok, false);
    assert.equal(validateJournalInput({ symbol: "EURUSD" }).ok, false);
  });

  test("normalizes the symbol and keeps a negative P&L", () => {
    const parsed = validateJournalInput({ symbol: "eur/usd", side: "SELL", pnl: -42.5 });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.symbol, "EURUSD");
    assert.equal(parsed.value.side, "sell");
    assert.equal(parsed.value.pnl, -42.5);
  });

  test("infers closed when a P&L is present", () => {
    const parsed = validateJournalInput({ symbol: "GBPUSD", side: "buy", pnl: 10 });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.status, "closed");
  });

  test("an open entry cannot carry a close date", () => {
    const parsed = validateJournalInput({
      symbol: "GBPUSD",
      side: "buy",
      status: "open",
      closedAt: "2026-01-10T10:00:00.000Z",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.status, "open");
    assert.equal(parsed.value.closedAt, null);
  });

  test("rejects a negative lot size", () => {
    const parsed = validateJournalInput({ symbol: "EURUSD", side: "buy", lots: -1 });
    assert.equal(parsed.ok, false);
  });

  test("dedupes tags and drops empties", () => {
    const parsed = validateJournalInput({
      symbol: "EURUSD",
      side: "buy",
      tags: ["news", " news ", "", "London"],
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.tags, ["news", "London"]);
  });

  test("an unknown status falls back from the data", () => {
    const parsed = validateJournalInput({ symbol: "EURUSD", side: "buy", status: "whatever" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.status, "open");
  });
});

describe("journal CSV", () => {
  test("quotes fields containing separators", () => {
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField("has,comma"), '"has,comma"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("line\nbreak"), '"line\nbreak"');
    assert.equal(csvField(null), "");
  });

  test("writes a header, joins tags and ends with a newline", () => {
    const csv = journalCsv([
      { id: "e1", symbol: "EURUSD", tags: ["a", "b"], note: "x,y" },
    ]);
    const [header, line] = csv.trimEnd().split("\n");
    assert.equal(header, CSV_COLUMNS.join(","));
    assert.ok(line.startsWith("e1,,EURUSD"));
    assert.ok(line.includes("a|b"));
    assert.ok(line.endsWith('"x,y"'));
    assert.ok(csv.endsWith("\n"));
  });
});

describe("computeJournalStats", () => {
  test("separates wins, losses and verified rows", () => {
    const stats = computeJournalStats([
      entry({ id: "a", pnl: 100 }),
      entry({ id: "b", pnl: -50, verified: true, source: "ctrader" }),
      entry({ id: "c", pnl: -25, verified: true, source: "ctrader" }),
      entry({ id: "d", status: "open", pnl: null, closedAt: null }),
    ]);

    assert.equal(stats.total, 4);
    assert.equal(stats.open, 1);
    assert.equal(stats.closed, 3);
    assert.equal(stats.verified, 2);
    assert.equal(stats.manual, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 2);
    assert.equal(stats.winRate, 1 / 3);
    assert.equal(stats.totalPnl, 25);
    assert.equal(stats.avgPnl, 8.33);
    assert.equal(stats.profitFactor, 1.33);
    assert.equal(stats.bestPnl, 100);
    assert.equal(stats.worstPnl, -50);
  });

  test("an empty journal reports null ratios instead of NaN", () => {
    const stats = computeJournalStats([]);
    assert.equal(stats.total, 0);
    assert.equal(stats.winRate, null);
    assert.equal(stats.avgPnl, null);
    assert.equal(stats.profitFactor, null);
    assert.equal(stats.bestPnl, null);
    assert.equal(stats.totalPnl, 0);
  });
});

describe("historyRowToJournal", () => {
  const deal: OrderHistoryRow = {
    dealId: 9001,
    orderId: 12,
    positionId: 7,
    symbol: "EURUSD",
    side: "BUY",
    lots: 0.5,
    entryPrice: 1.1,
    exitPrice: 1.105,
    grossProfit: 25,
    swap: -1.5,
    commission: -3.5,
    net: 20,
    digits: 5,
    closeTimestamp: Date.parse("2026-01-10T10:00:00.000Z"),
  };

  test("maps broker history to a verified journal row", () => {
    const mapped = historyRowToJournal(deal, { ctid: 123, label: "Demo" });
    assert.equal(mapped.source, "ctrader");
    assert.equal(mapped.dealId, 9001);
    assert.equal(mapped.accountCtid, 123);
    assert.equal(mapped.accountLabel, "Demo");
    assert.equal(mapped.side, "buy");
    assert.equal(mapped.pnl, 20);
    assert.equal(mapped.fees, -5);
    assert.equal(mapped.verified, true);
    assert.equal(mapped.status, "closed");
    assert.deepEqual(mapped.tags, []);
    assert.equal((mapped.closedAt as Date).toISOString(), "2026-01-10T10:00:00.000Z");
  });

  test("maps a sell side too", () => {
    const mapped = historyRowToJournal({ ...deal, side: "SELL" }, { ctid: 1, label: "Live" });
    assert.equal(mapped.side, "sell");
  });
});

describe("toJournalView", () => {
  test("normalizes dates and missing numbers", () => {
    const view = toJournalView({
      _id: { toString: () => "abc" },
      source: "manual",
      symbol: "XAUUSD",
      side: "sell",
      status: "closed",
      pnl: 5,
      tags: ["gold"],
      closedAt: new Date("2026-02-01T00:00:00.000Z"),
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    assert.equal(view.id, "abc");
    assert.equal(view.lots, null);
    assert.equal(view.verified, false);
    assert.equal(view.closedAt, "2026-02-01T00:00:00.000Z");
    assert.deepEqual(view.tags, ["gold"]);
  });
});
