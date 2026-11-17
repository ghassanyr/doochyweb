import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildTradeFallbackSections,
  buildTradePrompt,
  buildWeeklyFallbackSections,
  buildWeeklyPrompt,
  parseTradeSections,
  parseWeeklySections,
} from "../src/server/coach/build";
import {
  buildCoachWeekOptions,
  buildTradeFacts,
  buildWeeklyFacts,
} from "../src/server/coach/facts";
import {
  coachWeekInfo,
  coachWeekKey,
  coachWeekRange,
  nextCoachWeek,
  previousCoachWeek,
  weekdayLabel,
} from "../src/server/coach/weeks";
import type { JournalEntryView } from "../src/server/journal/types";

function entry(overrides: Partial<JournalEntryView> = {}): JournalEntryView {
  return {
    id: "e1",
    source: "ctrader",
    broker: "ctrader",
    accountId: "123",
    externalId: null,
    dealId: 1001,
    accountCtid: 123,
    accountLabel: "Demo",
    symbol: "EURUSD",
    side: "buy",
    lots: 1,
    entryPrice: 100,
    exitPrice: 110,
    stop: 95,
    target: 110,
    pnl: 100,
    fees: 0,
    openedAt: "2026-01-05T08:00:00.000Z",
    closedAt: "2026-01-05T10:00:00.000Z",
    status: "closed",
    verified: true,
    strategy: "Breakout",
    tags: ["London"],
    note: "Planned breakout.",
    createdAt: "2026-01-05T08:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
    ...overrides,
  };
}

function weekEntries(): JournalEntryView[] {
  return [
    entry(),
    entry({
      id: "e2",
      dealId: 1002,
      exitPrice: 95,
      pnl: -50,
      closedAt: "2026-01-05T12:00:00.000Z",
      note: "",
    }),
    entry({
      id: "e3",
      source: "manual",
      dealId: null,
      accountCtid: null,
      accountLabel: null,
      side: "sell",
      exitPrice: 90,
      stop: 105,
      target: 90,
      pnl: 50,
      closedAt: "2026-01-06T10:00:00.000Z",
      verified: false,
      strategy: "",
      tags: ["News"],
      note: "Sold the retest.",
    }),
    entry({
      id: "e4",
      dealId: 1004,
      exitPrice: 100,
      pnl: 0,
      closedAt: "2026-01-07T10:00:00.000Z",
      strategy: "Range",
      tags: [],
      note: "Chop.",
    }),
    entry({
      id: "e5",
      source: "manual",
      dealId: null,
      accountCtid: null,
      accountLabel: null,
      exitPrice: 90,
      stop: 90,
      pnl: -20,
      closedAt: "2026-01-08T10:00:00.000Z",
      verified: false,
      strategy: "",
      tags: ["News"],
      note: "",
    }),
  ];
}

describe("coach UTC week keys", () => {
  test("uses Monday through Sunday in UTC", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    assert.equal(range.start.toISOString(), "2026-01-05T00:00:00.000Z");
    assert.equal(range.endExclusive.toISOString(), "2026-01-12T00:00:00.000Z");
    assert.equal(range.periodEnd, "2026-01-11T23:59:59.999Z");
  });

  test("puts the boundary on Monday 00:00 UTC", () => {
    assert.equal(coachWeekKey(new Date("2026-01-04T23:59:59.999Z")), "2026-W01");
    assert.equal(coachWeekKey(new Date("2026-01-05T00:00:00.000Z")), "2026-W02");
  });

  test("handles ISO week years across new year", () => {
    assert.equal(coachWeekKey(new Date("2027-01-03T00:00:00.000Z")), "2026-W53");
    assert.equal(coachWeekKey(new Date("2026-12-31T00:00:00.000Z")), "2026-W53");
  });

  test("rejects malformed or impossible week keys", () => {
    assert.equal(coachWeekRange("2026-02"), null);
    assert.equal(coachWeekRange("2026-W54"), null);
    assert.equal(coachWeekRange("2025-W53"), null);
  });

  test("moves to the previous and next week", () => {
    assert.equal(previousCoachWeek("2026-W02"), "2026-W01");
    assert.equal(nextCoachWeek("2026-W02"), "2026-W03");
    assert.equal(previousCoachWeek("bad"), null);
  });

  test("labels weekdays in UTC", () => {
    assert.equal(weekdayLabel(new Date("2026-01-05T23:30:00.000Z")), "Monday");
    assert.deepEqual(coachWeekInfo("2026-W02", 4)?.closedTrades, 4);
  });
});

describe("coach trade facts", () => {
  test("derives R, plan outcome and verified P&L", () => {
    const facts = buildTradeFacts(entry());
    assert.equal(facts.symbol, "EURUSD");
    assert.equal(facts.outcome, "win");
    assert.equal(facts.realizedR, 2);
    assert.equal(facts.plannedRr, 2);
    assert.equal(facts.exitVsPlan, "target");
    assert.equal(facts.verified, true);
    assert.deepEqual(facts.tags, ["London"]);
    assert.equal(facts.caveats.length, 0);
  });

  test("marks self-reported trades and unavailable R", () => {
    const facts = buildTradeFacts(
      entry({
        source: "manual",
        verified: false,
        stop: 105,
        target: 90,
        note: "  first\nline  ",
      })
    );
    assert.equal(facts.verified, false);
    assert.equal(facts.realizedR, null);
    assert.equal(facts.exitVsPlan, "unknown");
    assert.equal(facts.note, "first line");
    assert.ok(facts.caveats.some((text) => text.includes("self-reported")));
    assert.ok(facts.caveats.some((text) => text.includes("wrong side of entry")));
  });

  test("infers an outcome from prices when P&L is missing", () => {
    const facts = buildTradeFacts(entry({ pnl: null, side: "sell", exitPrice: 90 }));
    assert.equal(facts.outcome, "win");
    assert.equal(facts.missing.includes("pnl"), true);
    assert.ok(facts.caveats.some((text) => text.includes("No P&L")));
  });

  test("dedupes tags and caps note text", () => {
    const facts = buildTradeFacts(
      entry({ tags: ["News", " news ", "", "London"], note: "x".repeat(1300) })
    );
    assert.deepEqual(facts.tags, ["News", "London"]);
    assert.equal(facts.note.length, 1200);
  });
});

describe("coach weekly facts", () => {
  test("aggregates the fixed UTC week", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());

    assert.equal(facts.closedTrades, 5);
    assert.equal(facts.verifiedTrades, 3);
    assert.equal(facts.manualTrades, 2);
    assert.equal(facts.wins, 2);
    assert.equal(facts.losses, 2);
    assert.equal(facts.breakeven, 1);
    assert.equal(facts.winRate, 0.5);
    assert.equal(facts.netPnl, 80);
    assert.equal(facts.avgPnl, 16);
    assert.equal(facts.avgWin, 75);
    assert.equal(facts.avgLoss, -35);
    assert.equal(facts.profitFactor, 2.14);
    assert.equal(facts.totalR, 2);
    assert.equal(facts.avgR, 0.4);
    assert.equal(facts.maxDrawdown, 50);
    assert.equal(facts.longestLossStreak, 1);
    assert.equal(facts.largestWin, 100);
    assert.equal(facts.largestLoss, -50);
    assert.equal(facts.activeDays, 4);
    assert.equal(facts.avgTradesPerActiveDay, 1.25);
    assert.equal(facts.tradesWithNotes, 3);
    assert.deepEqual(facts.planCompleteness, {
      entry: 5,
      exit: 5,
      stop: 5,
      target: 5,
      pnl: 5,
    });
  });

  test("groups by symbol, side, strategy, tag and weekday", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());

    assert.equal(facts.bySymbol[0].label, "EURUSD");
    assert.equal(facts.bySymbol[0].trades, 5);
    assert.deepEqual(
      facts.bySide.map((row) => [row.label, row.trades]),
      [
        ["Buy", 4],
        ["Sell", 1],
      ]
    );
    assert.ok(facts.byStrategy.some((row) => row.label === "Breakout" && row.trades === 2));
    assert.ok(facts.byStrategy.some((row) => row.label === "No strategy" && row.trades === 2));
    assert.ok(facts.byTag.some((row) => row.label === "news" && row.trades === 2));
    assert.deepEqual(
      facts.byWeekday.map((row) => [row.label, row.trades]),
      [
        ["Monday", 2],
        ["Thursday", 1],
        ["Tuesday", 1],
        ["Wednesday", 1],
      ]
    );
  });

  test("ignores entries outside the UTC week and open trades", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, [
      entry(),
      entry({ id: "old", closedAt: "2026-01-04T23:59:59.999Z" }),
      entry({ id: "next", closedAt: "2026-01-12T00:00:00.000Z" }),
      entry({ id: "open", status: "open", closedAt: null }),
    ]);
    assert.equal(facts.closedTrades, 1);
  });

  test("flags a sample below the weekly minimum", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, [entry(), entry({ id: "e2" })]);
    assert.ok(facts.caveats.some((text) => text.includes("At least 5")));
    assert.ok(
      buildWeeklyFallbackSections(facts).watchouts.some((text) => text.includes("Keep logging"))
    );
  });

  test("caps the individual trade list but keeps aggregate counts", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const entries = Array.from({ length: 90 }, (_, index) =>
      entry({ id: `e${index}`, dealId: 1000 + index })
    );
    const facts = buildWeeklyFacts(range, entries);
    assert.equal(facts.closedTrades, 90);
    assert.equal(facts.tradesTotal, 90);
    assert.equal(facts.tradesIncluded, 80);
    assert.equal(facts.trades.length, 80);
    assert.equal(facts.tradesWithNotes, 90);
    assert.ok(facts.caveats.some((text) => text.includes("capped at 80")));
  });
});

describe("coach week options", () => {
  test("includes the current week and sorts newest first", () => {
    const now = new Date("2026-01-14T12:00:00.000Z");
    const options = buildCoachWeekOptions(
      [
        entry({ closedAt: "2026-01-05T10:00:00.000Z" }),
        entry({ id: "e2", closedAt: "2026-01-06T10:00:00.000Z" }),
        entry({ id: "e3", closedAt: "2026-01-13T10:00:00.000Z" }),
      ],
      now
    );
    assert.equal(options[0].key, "2026-W03");
    assert.equal(options[0].closedTrades, 1);
    assert.equal(options[1].key, "2026-W02");
    assert.equal(options[1].closedTrades, 2);
  });

  test("adds an empty current week", () => {
    const options = buildCoachWeekOptions([], new Date("2026-01-14T12:00:00.000Z"));
    assert.deepEqual(options, [
      {
        key: "2026-W03",
        periodStart: "2026-01-12T00:00:00.000Z",
        periodEnd: "2026-01-18T23:59:59.999Z",
        closedTrades: 0,
      },
    ]);
  });
});

describe("coach prompts", () => {
  test("weekly prompt labels notes as untrusted and has no em dash", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());
    const messages = buildWeeklyPrompt(facts, "Acme");
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.ok(messages[0].content.includes("Acme"));
    assert.ok(messages[1].content.includes("Planned breakout."));
    assert.ok(messages[1].content.includes("untrusted journal data"));
    assert.ok(messages[1].content.includes("2026-W02"));
    assert.equal(messages[0].content.includes("\u2014"), false);
    assert.equal(messages[1].content.includes("\u2014"), false);
  });

  test("trade prompt includes the recorded facts and guard rails", () => {
    const messages = buildTradePrompt(buildTradeFacts(entry()), "Acme");
    assert.ok(messages[0].content.includes("Never invent"));
    assert.ok(messages[1].content.includes("Symbol: EURUSD"));
    assert.ok(messages[1].content.includes("Realized R: +2"));
    assert.equal(messages.join(" ").includes("\u2014"), false);
  });
});

describe("coach parsing", () => {
  test("recovers weekly JSON from a code fence", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());
    const parsed = parseWeeklySections(
      '```json\n{"summary":"Steady week.","strengths":["Stops were recorded."],"watchouts":["One large loss."],"patterns":["Monday carried two trades."],"focus":["Repeat the plan."]}\n```',
      facts
    );
    assert.equal(parsed.error, null);
    assert.equal(parsed.sections.summary, "Steady week.");
    assert.deepEqual(parsed.sections.strengths, ["Stops were recorded."]);
  });

  test("falls back to deterministic weekly sections on bad JSON", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());
    const parsed = parseWeeklySections("not json", facts);
    assert.ok(parsed.error);
    assert.ok(parsed.sections.summary.includes("5 trades"));
    assert.ok(parsed.sections.watchouts.length > 0);
  });

  test("recovers a truncated weekly object and fills missing lists", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(range, weekEntries());
    const parsed = parseWeeklySections('{"summary":"Only a summary"', facts);
    assert.equal(parsed.sections.summary, "Only a summary");
    assert.equal(parsed.error, null);
    assert.ok(parsed.sections.patterns.length > 0);
  });

  test("recovers trade JSON and falls back on bad trade JSON", () => {
    const facts = buildTradeFacts(entry());
    const good = parseTradeSections(
      '{"summary":"Planned exit.","worked":["Target was recorded."],"improve":["Add a stop note."],"question":"What worked?"}',
      facts
    );
    assert.equal(good.error, null);
    assert.equal(good.sections.question, "What worked?");

    const bad = parseTradeSections("nope", facts);
    assert.ok(bad.error);
    assert.ok(bad.sections.summary.includes("EURUSD"));
  });
});

describe("coach fallbacks", () => {
  test("trade fallback asks a relevant reflection question", () => {
    const sections = buildTradeFallbackSections(buildTradeFacts(entry()));
    assert.equal(
      sections.question,
      "What did you see before entry that made this plan worth taking?"
    );
    assert.ok(sections.worked.some((text) => text.includes("broker-verified")));
  });

  test("weekly fallback names missing journal notes without capping", () => {
    const range = coachWeekRange("2026-W02");
    assert.ok(range);
    const facts = buildWeeklyFacts(
      range,
      weekEntries().map((item) => ({ ...item, note: "" }))
    );
    const sections = buildWeeklyFallbackSections(facts);
    assert.ok(sections.watchouts.some((text) => text.includes("had no journal note")));
    assert.ok(sections.focus.some((text) => text.includes("Add a short note")));
  });
});
