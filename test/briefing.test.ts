import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  briefingDateKey,
  buildBriefingPrompt,
  buildMovers,
  buildSignalRows,
  buildSnapshot,
  percentChange,
} from "../src/server/briefing/build";
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  aiConfigFromValues,
  listAiModels,
  normalizeBaseUrl,
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

describe("buildMovers", () => {
  test("uses the last two daily closes", () => {
    const rows = buildMovers([{ symbol: "EURUSD", bars: bars([1.0, 1.05]) }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, "EURUSD");
    assert.equal(rows[0].last, 1.05);
    assert.equal(rows[0].changePct, 5);
  });

  test("sorts by absolute move and caps the list", () => {
    const rows = buildMovers(
      [
        { symbol: "AAA", bars: bars([100, 101]) },
        { symbol: "BBB", bars: bars([100, 90]) },
        { symbol: "CCC", bars: bars([100, 103]) },
      ],
      2
    );
    assert.deepEqual(
      rows.map((row) => row.symbol),
      ["BBB", "CCC"]
    );
  });

  test("drops symbols without two closes", () => {
    const rows = buildMovers([
      { symbol: "ONE", bars: bars([100]) },
      { symbol: "NONE", bars: [] },
    ]);
    assert.deepEqual(rows, []);
  });
});

describe("buildSignalRows", () => {
  test("includes the age in hours and caps the list", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const rows = buildSignalRows(
      [
        signal({ id: "a", createdAt: "2026-01-10T06:00:00.000Z" }),
        signal({ id: "b", createdAt: "2026-01-09T12:00:00.000Z" }),
      ],
      now,
      1
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "a");
    assert.equal(rows[0].ageHours, 6);
    assert.equal(rows[0].target, 1.12);
  });
});

describe("buildSnapshot", () => {
  test("carries the day, movers and signals", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const snapshot = buildSnapshot({
      now,
      movers: [{ symbol: "EURUSD", bars: bars([1, 1.01]) }],
      signals: [signal()],
    });
    assert.equal(snapshot.dateKey, "2026-01-10");
    assert.equal(snapshot.generatedAt, now.toISOString());
    assert.equal(snapshot.movers.length, 1);
    assert.equal(snapshot.signals.length, 1);
  });
});

describe("buildBriefingPrompt", () => {
  const snapshot = {
    dateKey: "2026-01-10",
    generatedAt: "2026-01-10T12:00:00.000Z",
    movers: [{ symbol: "EURUSD", last: 1.05, changePct: 2.5 }],
    signals: [
      {
        id: "a",
        symbol: "GBPUSD",
        direction: "sell" as const,
        entry: 1.27,
        entryMax: null,
        target: 1.25,
        stop: 1.28,
        createdAt: "2026-01-10T00:00:00.000Z",
        ageHours: 12,
      },
    ],
  };

  test("includes the data and forbids advice", () => {
    const [system, user] = buildBriefingPrompt(snapshot, "Doochy");
    assert.ok(system.content.includes("Doochy"));
    assert.ok(system.content.includes("Never give financial advice"));
    assert.ok(user.content.includes("EURUSD"));
    assert.ok(user.content.includes("+2.5%"));
    assert.ok(user.content.includes("GBPUSD sell"));
    assert.ok(user.content.includes("12 hours ago"));
  });

  test("handles an empty snapshot without empty lists", () => {
    const [, user] = buildBriefingPrompt(
      { dateKey: "2026-01-10", generatedAt: "", movers: [], signals: [] },
      "Doochy"
    );
    assert.ok(user.content.includes("no daily data available"));
    assert.ok(user.content.includes("no active signals"));
  });

  test("contains no em dash", () => {
    const [system, user] = buildBriefingPrompt(snapshot, "Doochy");
    assert.equal(system.content.includes("\u2014"), false);
    assert.equal(user.content.includes("\u2014"), false);
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

describe("listAiModels", () => {
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
