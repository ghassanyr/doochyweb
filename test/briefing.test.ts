import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  briefingDateKey,
  buildBriefingPrompt,
  buildFallbackSections,
  buildJournalIdeas,
  buildSignalRows,
  buildSnapshot,
  buildWatchlistRows,
  levelDistancePct,
  parseBriefingSections,
  percentChange,
} from "../src/server/briefing/build";
import {
  buildSessionRows,
  normalizeFocusSessions,
  parseFocusSessions,
} from "../src/server/briefing/sessions";
import { toBriefingRecord } from "../src/server/briefing/store";
import type { BriefingSnapshot } from "../src/server/briefing/types";
import type { JournalEntryView } from "../src/server/journal/types";
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  aiChat,
  aiConfigFromValues,
  isChatCapableModelId,
  listAiModels,
  normalizeBaseUrl,
  resetModelAvailabilityCache,
} from "../src/server/ai/client";
import type { Candle } from "../src/server/market/types";
import type { SignalView } from "../src/server/signals/types";

function bars(closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    time: 1_700_000_000_000 + index * 86_400_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

function journal(overrides: Partial<JournalEntryView> = {}): JournalEntryView {
  return {
    id: "j1",
    source: "manual",
    dealId: null,
    accountCtid: null,
    accountLabel: null,
    symbol: "EURUSD",
    side: "sell",
    lots: null,
    entryPrice: 1.07,
    exitPrice: null,
    stop: 1.08,
    target: 1.05,
    pnl: null,
    fees: null,
    openedAt: "2026-01-09T10:00:00.000Z",
    closedAt: null,
    status: "open",
    verified: false,
    strategy: "",
    tags: [],
    note: "Planned short",
    createdAt: "2026-01-09T10:00:00.000Z",
    updatedAt: "2026-01-09T10:00:00.000Z",
    ...overrides,
  };
}

function builtSnapshot(overrides: Partial<BriefingSnapshot> = {}): BriefingSnapshot {
  const now = new Date("2026-01-10T12:00:00.000Z");
  return {
    ...buildSnapshot({
      now,
      focusSessions: ["london", "newyork"],
      watchlist: [
        {
          symbol: "EURUSD",
          name: "Euro",
          type: "forex",
          bars: bars([1, 1.05]),
          quote: { price: 1.06, at: now.toISOString(), source: "latest" },
        },
      ],
      signals: [signal()],
      journalEntries: [journal()],
      quotes: {
        EURUSD: { price: 1.06, at: now.toISOString(), source: "latest" },
      },
    }),
    ...overrides,
  };
}

function signal(overrides: Partial<SignalView> = {}): SignalView {
  return {
    id: "s1",
    symbol: "EURUSD",
    direction: "buy",
    entry: 1.1,
    entryMax: null,
    target: 1.12,
    target2: null,
    target3: null,
    stop: 1.09,
    timeframe: "1h",
    note: "",
    status: "active",
    expiresAt: null,
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    invalidatedAt: null,
    invalidationReason: null,
    resolvedAt: null,
    resolution: null,
    updates: [],
    ...overrides,
  };
}

describe("briefingDateKey", () => {
  test("uses the UTC day", () => {
    assert.equal(briefingDateKey(new Date("2026-01-10T23:30:00.000Z")), "2026-01-10");
    assert.equal(briefingDateKey(new Date("2026-01-10T00:00:00.000Z")), "2026-01-10");
  });
});

describe("percentChange", () => {
  test("reports a signed percent", () => {
    assert.equal(percentChange(100, 110), 10);
    assert.equal(percentChange(100, 90), -10);
    assert.equal(percentChange(100, 100), 0);
  });

  test("is null when a value is unusable", () => {
    assert.equal(percentChange(null, 100), null);
    assert.equal(percentChange(0, 100), null);
    assert.equal(percentChange(100, Number.NaN), null);
  });
});

describe("buildWatchlistRows", () => {
  test("uses the last two daily closes and the latest daily range", () => {
    const rows = buildWatchlistRows([
      {
        symbol: "eurusd",
        name: "Euro",
        type: "forex",
        bars: bars([1.0, 1.05]),
        quote: { price: 1.06, at: "2026-01-10T12:00:00.000Z", source: "latest" },
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, "EURUSD");
    assert.equal(rows[0].last, 1.05);
    assert.equal(rows[0].previousClose, 1);
    assert.equal(rows[0].changePct, 5);
    assert.equal(rows[0].dayHigh, 1.05);
    assert.equal(rows[0].quote?.price, 1.06);
  });

  test("preserves watchlist order and caps the list", () => {
    const rows = buildWatchlistRows(
      [
        { symbol: "AAA", bars: bars([100, 101]) },
        { symbol: "BBB", bars: bars([100, 90]) },
        { symbol: "CCC", bars: bars([100, 103]) },
      ],
      2
    );
    assert.deepEqual(rows.map((row) => row.symbol), ["AAA", "BBB"]);
  });

  test("keeps a symbol even when daily bars are missing", () => {
    const rows = buildWatchlistRows([{ symbol: "NONE", bars: [] }]);
    assert.equal(rows[0].symbol, "NONE");
    assert.equal(rows[0].last, null);
    assert.equal(rows[0].changePct, null);
    assert.equal(rows[0].dayHigh, null);
  });
});

describe("levelDistancePct", () => {
  test("reports the signed distance to a level", () => {
    assert.equal(levelDistancePct(100, 110), 10);
    assert.equal(levelDistancePct(100, 90), -10);
    assert.equal(levelDistancePct(null, 90), null);
    assert.equal(levelDistancePct(0, 90), null);
  });
});

describe("focus sessions", () => {
  test("defaults and validates the saved preference", () => {
    assert.deepEqual(normalizeFocusSessions(undefined), ["london", "newyork"]);
    assert.deepEqual(parseFocusSessions(["london", "london", "asia"]), ["london", "asia"]);
    assert.equal(parseFocusSessions([]), null);
    assert.equal(parseFocusSessions("london"), null);
  });

  test("reports open and closed sessions from UTC", () => {
    const rows = buildSessionRows(
      ["asia", "london", "newyork"],
      new Date("2026-01-14T14:00:00.000Z")
    );
    assert.equal(rows[0].status, "closed");
    assert.equal(rows[1].status, "open");
    assert.equal(rows[2].status, "open");
    assert.match(rows[1].nextChange ?? "", /closes at 16:30 UTC/);
  });

  test("closes every FX session at the weekend", () => {
    const rows = buildSessionRows(["london", "newyork"], new Date("2026-01-17T14:00:00.000Z"));
    assert.ok(rows.every((row) => row.status === "closed"));
    assert.match(rows[0].nextChange ?? "", /Monday at 08:00 UTC/);
  });
});

describe("buildSignalRows", () => {
  test("includes age, quote distance and caps the list", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const rows = buildSignalRows(
      [
        signal({ id: "a", createdAt: "2026-01-10T06:00:00.000Z" }),
        signal({ id: "b", createdAt: "2026-01-09T12:00:00.000Z" }),
      ],
      now,
      {
        EURUSD: { price: 1.11, at: now.toISOString(), source: "latest" },
      },
      { limit: 1 }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[0].ageHours, 6);
    assert.equal(rows[0].toTargetPct, 0.9);
    assert.equal(rows[0].toStopPct, -1.8);
  });

  test("prefers signals on watchlist symbols", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const rows = buildSignalRows(
      [
        signal({ id: "new-other", symbol: "GBPUSD", createdAt: "2026-01-10T11:00:00.000Z" }),
        signal({ id: "old-watch", symbol: "EURUSD", createdAt: "2026-01-10T01:00:00.000Z" }),
      ],
      now,
      {},
      { limit: 1, watchlist: ["EURUSD"] }
    );
    assert.equal(rows[0].id, "old-watch");
  });
});

describe("buildJournalIdeas", () => {
  test("keeps open ideas, prefers watchlist symbols and reports distance", () => {
    const rows = buildJournalIdeas(
      [
        journal({ id: "closed", status: "closed" }),
        journal({ id: "other", symbol: "GBPUSD", openedAt: "2026-01-10T11:00:00.000Z" }),
        journal({ id: "watch", symbol: "EURUSD", openedAt: "2026-01-09T11:00:00.000Z" }),
      ],
      { EURUSD: { price: 1.06, at: "2026-01-10T12:00:00.000Z", source: "latest" } },
      { limit: 2, watchlist: ["EURUSD"] }
    );
    assert.deepEqual(rows.map((row) => row.id), ["watch", "other"]);
    assert.ok(rows[0].toTargetPct != null);
  });
});

describe("buildSnapshot", () => {
  test("carries the day, sessions, watchlist, signals and journal ideas", () => {
    const snapshot = builtSnapshot();
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.dateKey, "2026-01-10");
    assert.equal(snapshot.watchlist.length, 1);
    assert.equal(snapshot.signals.length, 1);
    assert.equal(snapshot.journalIdeas.length, 1);
    assert.equal(snapshot.sessions.length, 2);
    assert.ok(snapshot.dataNotes.some((note) => note.includes("No news feed")));
  });
});

describe("buildFallbackSections", () => {
  test("writes deterministic sections from the snapshot", () => {
    const snapshot = builtSnapshot();
    const sections = buildFallbackSections(snapshot);
    assert.match(sections.headline, /EURUSD/);
    assert.match(sections.overview, /London and New York focus/);
    assert.match(sections.overview, /No news feed is connected/);
    assert.equal(sections.watchlist.length, 1);
    assert.match(sections.watchlist[0].whatHappened, /EURUSD closed at/);
    assert.match(sections.watchlist[0].whyItMatters, /open sell journal idea/);
    assert.equal(sections.journalIdeas[0].id, "j1");
    assert.match(sections.journalIdeas[0].update, /Latest quote|latest quote/);
    assert.ok(sections.risks.length > 0);
    assert.ok(sections.monitor.length > 0);
    assert.equal(sections.caveats.length > 0, true);
  });

  test("handles an empty snapshot", () => {
    const snapshot = builtSnapshot({
      watchlist: [],
      signals: [],
      journalIdeas: [],
      dataNotes: ["No news feed is connected."],
    });
    const sections = buildFallbackSections(snapshot);
    assert.equal(sections.headline, "Watchlist briefing");
    assert.equal(sections.watchlist.length, 0);
    assert.ok(sections.risks.length > 0);
    assert.ok(sections.monitor.length > 0);
  });
});

describe("buildBriefingPrompt", () => {
  test("includes the data, JSON contract and advice rules", () => {
    const snapshot = builtSnapshot();
    const [system, user] = buildBriefingPrompt(snapshot, "Doochy");
    assert.ok(system.content.includes("Doochy"));
    assert.ok(system.content.includes("Return only a JSON object"));
    assert.ok(system.content.includes("Never give financial advice"));
    assert.ok(system.content.includes("No news feed is supplied"));
    assert.ok(user.content.includes("EURUSD"));
    assert.ok(user.content.includes("+5%"));
    assert.ok(user.content.includes("London and New York"));
    assert.ok(user.content.includes("id j1"));
    assert.ok(user.content.includes("No news feed is connected"));
  });

  test("handles an empty snapshot without empty lists", () => {
    const snapshot = builtSnapshot({
      watchlist: [],
      signals: [],
      journalIdeas: [],
      dataNotes: ["No news feed is connected."],
    });
    const [, user] = buildBriefingPrompt(snapshot, "Doochy");
    assert.ok(user.content.includes("no watchlist symbols"));
    assert.ok(user.content.includes("no active signals"));
    assert.ok(user.content.includes("no open journal ideas"));
  });

  test("contains no em dash", () => {
    const [system, user] = buildBriefingPrompt(builtSnapshot(), "Doochy");
    assert.equal(system.content.includes("\u2014"), false);
    assert.equal(user.content.includes("\u2014"), false);
  });
});

describe("parseBriefingSections", () => {
  test("accepts fenced JSON and cleans em dashes", () => {
    const snapshot = builtSnapshot();
    const raw = "```json\n" + JSON.stringify({
      headline: "Dollar firms",
      overview: "Metals slip \u2014 dollar firms.",
      watchlist: [
        {
          symbol: "EURUSD",
          whatHappened: "Moved up.",
          whyItMatters: "Open idea follows it.",
          watchFor: "Watch 1.08.",
        },
      ],
      journalIdeas: [{ id: "j1", update: "Plan unchanged \u2014 wait for entry." }],
      risks: ["Risk one."],
      monitor: ["Watch 1.08."],
      caveats: ["No news feed."],
    }) + "\n```";
    const parsed = parseBriefingSections(raw, snapshot);
    assert.equal(parsed.error, null);
    assert.equal(parsed.sections.headline, "Dollar firms");
    assert.equal(parsed.sections.overview.includes("\u2014"), false);
    assert.equal(parsed.sections.journalIdeas[0].id, "j1");
    assert.equal(parsed.sections.journalIdeas[0].update, "Plan unchanged - wait for entry.");
  });

  test("drops unknown symbols and ids, and fills missing notes", () => {
    const snapshot = builtSnapshot();
    const raw = JSON.stringify({
      headline: "Only a headline",
      watchlist: [
        { symbol: "UNKNOWN", whatHappened: "x", whyItMatters: "y", watchFor: "z" },
      ],
      journalIdeas: [{ id: "unknown", update: "ignore me" }],
    });
    const parsed = parseBriefingSections(raw, snapshot);
    assert.equal(parsed.sections.watchlist.length, 1);
    assert.equal(parsed.sections.watchlist[0].symbol, "EURUSD");
    assert.ok(parsed.sections.watchlist[0].whatHappened.length > 0);
    assert.equal(parsed.sections.journalIdeas[0].id, "j1");
    assert.ok(parsed.sections.journalIdeas[0].update.length > 0);
    assert.ok(parsed.sections.risks.length > 0);
  });

  test("falls back on malformed JSON", () => {
    const snapshot = builtSnapshot();
    const parsed = parseBriefingSections("not json at all", snapshot);
    assert.match(parsed.error ?? "", /not valid briefing JSON/);
    assert.deepEqual(parsed.sections, buildFallbackSections(snapshot));
  });

  test("caps long fields and lists", () => {
    const snapshot = builtSnapshot();
    const raw = JSON.stringify({
      headline: "x".repeat(400),
      risks: Array.from({ length: 12 }, (_, index) => `Risk ${index}`),
    });
    const parsed = parseBriefingSections(raw, snapshot);
    assert.equal(parsed.sections.headline.length, 140);
    assert.equal(parsed.sections.risks.length, 5);
  });
});

describe("toBriefingRecord", () => {
  test("normalizes a legacy mover snapshot", () => {
    const record = toBriefingRecord({
      dateKey: "2026-01-10",
      generatedAt: "2026-01-10T12:00:00.000Z",
      narrative: "Legacy prose",
      snapshot: {
        dateKey: "2026-01-10",
        generatedAt: "2026-01-10T12:00:00.000Z",
        movers: [{ symbol: "EURUSD", last: 1.05, changePct: 2.5 }],
        signals: [],
      },
    });
    assert.equal(record.snapshot.version, 1);
    assert.equal(record.snapshot.watchlist[0].symbol, "EURUSD");
    assert.equal(record.snapshot.watchlist[0].last, 1.05);
    assert.equal(record.narrative, "Legacy prose");
    assert.equal(record.sections, null);
  });
});

describe("aiConfigFromValues", () => {
  test("is null without a key", () => {
    assert.equal(aiConfigFromValues({}), null);
    assert.equal(aiConfigFromValues({ apiKey: "   " }), null);
  });

  test("falls back to the OpenAI defaults", () => {
    const config = aiConfigFromValues({ apiKey: "sk-test" });
    assert.equal(config?.baseUrl, DEFAULT_AI_BASE_URL);
    assert.equal(config?.model, DEFAULT_AI_MODEL);
  });

  test("trims a trailing slash from a custom base URL", () => {
    const config = aiConfigFromValues({
      apiKey: "sk-test",
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "some/model",
    });
    assert.equal(config?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(config?.model, "some/model");
  });

  test("normalizeBaseUrl returns null on an empty value", () => {
    assert.equal(normalizeBaseUrl(""), null);
    assert.equal(normalizeBaseUrl(undefined), null);
  });

  test("resolves the base URL from a known provider preset", () => {
    const config = aiConfigFromValues({
      apiKey: "sk-test",
      provider: "openrouter",
    });
    assert.equal(config?.baseUrl, "https://openrouter.ai/api/v1");
  });

  test("keeps an explicit base URL for custom providers", () => {
    const config = aiConfigFromValues({
      apiKey: "sk-test",
      provider: "custom",
      baseUrl: "https://my.gateway.example/v1/",
    });
    assert.equal(config?.baseUrl, "https://my.gateway.example/v1");
  });

  test("resolves the NVIDIA preset base URL", () => {
    const config = aiConfigFromValues({
      apiKey: "nv-test",
      provider: "nvidia",
      model: "meta/llama-3.3-70b-instruct",
    });
    assert.equal(config?.baseUrl, "https://integrate.api.nvidia.com/v1");
  });

  test("uses provider-specific default models", () => {
    const groq = aiConfigFromValues({ apiKey: "gsk-test", provider: "groq" });
    assert.equal(groq?.model, "llama-3.1-8b-instant");
    const openrouter = aiConfigFromValues({ apiKey: "sk-or", provider: "openrouter" });
    assert.equal(openrouter?.model, "openai/gpt-4o-mini");
  });

  test("requires an explicit model for a provider without a default", () => {
    assert.equal(aiConfigFromValues({ apiKey: "nv-test", provider: "nvidia" }), null);
    const nvidia = aiConfigFromValues({
      apiKey: "nv-test",
      provider: "nvidia",
      model: "meta/llama-3.3-70b-instruct",
    });
    assert.equal(nvidia?.model, "meta/llama-3.3-70b-instruct");
  });

  test("allows Ollama without an API key", () => {
    const config = aiConfigFromValues({ provider: "ollama" });
    assert.equal(config?.apiKey, "");
    assert.equal(config?.baseUrl, "http://localhost:11434/v1");
    assert.equal(config?.model, "llama3.2");
  });

  test("requires a base URL for a custom provider", () => {
    assert.equal(aiConfigFromValues({ apiKey: "sk-test", provider: "custom" }), null);
  });
});

describe("isChatCapableModelId", () => {
  test("keeps chat models and drops utility endpoints", () => {
    assert.equal(isChatCapableModelId("meta/llama-3.3-70b-instruct"), true);
    assert.equal(isChatCapableModelId("nvidia/nemotron-3-ultra-550b-a55b"), true);
    assert.equal(isChatCapableModelId("nvidia/nemotron-3.5-super-vl-120b-a12b"), true);
    assert.equal(isChatCapableModelId("nvidia/nv-embedqa-e5-v5"), false);
    assert.equal(
      isChatCapableModelId("nvidia/llama-3.1-nemotron-safety-guard-8b-v3"),
      false
    );
    assert.equal(isChatCapableModelId("nvidia/riva-translate-4b-instruct-v2"), false);
    assert.equal(isChatCapableModelId("black-forest-labs/flux.1-dev"), false);
    assert.equal(isChatCapableModelId("meta/codellama-70b"), false);
  });
});

describe("listAiModels", () => {
  beforeEach(() => resetModelAvailabilityCache());

  test("loads, de-duplicates and sorts advertised models", async () => {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "b-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    try {
      const result = await listAiModels({ provider: "openai", apiKey: "sk-test" });
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["a-model", "b-model"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("lists models before a model has been selected", async () => {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ data: [{ id: "meta/llama-3.3-70b-instruct" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    try {
      const result = await listAiModels({ provider: "nvidia", apiKey: "nv-test" });
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["meta/llama-3.3-70b-instruct"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("keeps only NVIDIA chat models the key can use", async () => {
    const original = globalThis.fetch;
    const probed: string[] = [];
    (globalThis as any).fetch = async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "meta/llama-3.3-70b-instruct" },
              { id: "01-ai/yi-large" },
              { id: "nvidia/nv-embedqa-e5-v5" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      probed.push(body.model);
      if (body.model === "meta/llama-3.3-70b-instruct") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ status: 404, detail: "Function not found for account" }),
        { status: 404 }
      );
    };
    try {
      const result = await listAiModels({
        provider: "nvidia",
        apiKey: "nv-test-availability",
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, ["meta/llama-3.3-70b-instruct"]);
      assert.equal(result.total, 3);
      assert.equal(result.available, 1);
      assert.equal(result.unavailable, 1);
      assert.equal(result.unknown, 0);
      assert.deepEqual(probed.sort(), ["01-ai/yi-large", "meta/llama-3.3-70b-instruct"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("reports a rejected NVIDIA key instead of an empty list", async () => {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async (input: any) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "meta/llama-3.3-70b-instruct" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 401 });
    };
    try {
      const result = await listAiModels({ provider: "nvidia", apiKey: "nv-test-auth" });
      assert.equal(result.ok, false);
      assert.match(result.message, /401/);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("reuses confirmed NVIDIA availability between loads", async () => {
    const original = globalThis.fetch;
    let probes = 0;
    (globalThis as any).fetch = async (input: any) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "meta/llama-3.3-70b-instruct" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      probes++;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      });
    };
    try {
      const values = { provider: "nvidia", apiKey: "nv-test-cache" };
      const first = await listAiModels(values);
      assert.equal(first.ok, true);
      assert.equal(probes, 1);
      const second = await listAiModels(values);
      assert.equal(second.ok, true);
      assert.equal(probes, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("does not call the network without a required key", async () => {
    const original = globalThis.fetch;
    let called = false;
    (globalThis as any).fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    try {
      const result = await listAiModels({ provider: "openai" });
      assert.equal(result.ok, false);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("aiChat", () => {
  test("uses reasoning_content when the visible content is empty", async () => {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(
        JSON.stringify({
          model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
          choices: [{ message: { content: "", reasoning_content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    try {
      const reply = await aiChat(
        {
          apiKey: "nv-test",
          baseUrl: "https://integrate.api.nvidia.com/v1",
          model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        },
        [{ role: "user", content: "hi" }]
      );
      assert.equal(reply.text, "ok");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("turns NVIDIA thinking off by default and can keep it on", async () => {
    const original = globalThis.fetch;
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const config = {
      apiKey: "nv-test",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    };
    try {
      await aiChat(config, [{ role: "user", content: "hi" }]);
      assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });

      await aiChat(config, [{ role: "user", content: "hi" }], { thinking: true });
      assert.equal(bodies[1].chat_template_kwargs, undefined);

      await aiChat(
        { ...config, baseUrl: "https://api.openai.com/v1" },
        [{ role: "user", content: "hi" }]
      );
      assert.equal(bodies[2].chat_template_kwargs, undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("refuses a reasoning trace cut off by the token budget", async () => {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: "", reasoning_content: "Here's a thinking process: 1. Analyz" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    try {
      await assert.rejects(
        () =>
          aiChat(
            {
              apiKey: "nv-test",
              baseUrl: "https://integrate.api.nvidia.com/v1",
              model: "nvidia/nemotron-3.5-lightning-30b-a3b",
            },
            [{ role: "user", content: "hi" }]
          ),
        /token budget on reasoning/
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
