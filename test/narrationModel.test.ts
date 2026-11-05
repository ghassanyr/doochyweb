import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { NarrationInput } from "../src/server/market/narration";
import { NARRATION_SYSTEM_PROMPT, modelNarration, narrationConfig } from "../src/server/market/narrationModel";

const input = {
  narration_version: 1,
  run_id: "run-1",
  generated_at: "2026-11-03T16:14:00.000Z",
  run: { timestamp_utc: "2026-11-03T16:13:37.827Z", as_of: "2026-11-03T16:00:00.000Z", backfilled: false, evaluated_count: 1, skipped: {} },
  breakouts: [],
  caveats: ["RESEARCH ONLY."],
} as NarrationInput;

const cfg = { apiKey: "nvapi-test", baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-test", disableThinking: true, reasoningEffort: null };

describe("narration model config", () => {
  test("requires key and model, defaults the base URL", () => {
    assert.equal(narrationConfig({}), null);
    assert.equal(narrationConfig({ NVIDIA_API_KEY: "k", NARRATION_MODEL: "m" })?.baseUrl, "https://integrate.api.nvidia.com/v1");
    assert.equal(
      narrationConfig({ NVIDIA_API_KEY: "k", NARRATION_MODEL: "m", NVIDIA_BASE_URL: "https://x/v1///" })?.baseUrl,
      "https://x/v1"
    );
    assert.equal(narrationConfig({ NVIDIA_API_KEY: "k", NARRATION_MODEL: "m" })?.disableThinking, true);
    assert.equal(
      narrationConfig({ NVIDIA_API_KEY: "k", NARRATION_MODEL: "m", NARRATION_DISABLE_THINKING: "false" })?.disableThinking,
      false
    );
    assert.equal(
      narrationConfig({ NVIDIA_API_KEY: "k", NARRATION_MODEL: "m", NARRATION_REASONING_EFFORT: "low" })?.reasoningEffort,
      "low"
    );
  });
});

describe("model narration", () => {
  test("sends the grounded contract and returns trimmed text", async () => {
    let seenUrl = "", seenInit: RequestInit | undefined;
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "  RESEARCH ONLY. grounded.  " } }],
        usage: { total_tokens: 12 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const res = await modelNarration(input, cfg, fake);
    assert.equal(res.text, "RESEARCH ONLY. grounded.");
    assert.equal(seenUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal((seenInit?.headers as Record<string, string>).authorization, "Bearer nvapi-test");
    assert.ok((seenInit?.headers as Record<string, string>)["content-type"] === "application/json");

    const body = JSON.parse(String(seenInit?.body));
    assert.equal(body.model, cfg.model);
    assert.equal(body.stream, false);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, NARRATION_SYSTEM_PROMPT);
    assert.match(body.messages[0].content, /Use only the facts/);
    assert.match(body.messages[0].content, /what_happened/);
    assert.match(body.messages[0].content, /Do not add disclaimers/);
    assert.match(body.messages[1].content, /^Facts:/);
    assert.ok(!body.messages[1].content.includes("evaluated_count"));
    assert.ok(!body.messages[1].content.includes("run_id"));
    assert.deepEqual(res.usage, { total_tokens: 12 });
  });

  test("joins structured JSON into three paragraphs without adding a disclaimer", async () => {
    const fake = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ what_happened: "Break happened.", history: "History.", quality: "Quality." }) } }],
    }))) as typeof fetch;
    const res = await modelNarration(input, cfg, fake);
    assert.equal(res.text, "Break happened.\n\nHistory.\n\nQuality.");
  });

  test("accepts a fenced JSON response", async () => {
    const fake = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"what_happened\":\"A\",\"history\":\"B\",\"quality\":\"C\"}\n```" } }],
    }))) as typeof fetch;
    const res = await modelNarration(input, cfg, fake);
    assert.ok(res.text.endsWith("A\n\nB\n\nC"));
  });

  test("HTTP failure carries status, not a fabricated narration", async () => {
    const fake = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
    await assert.rejects(modelNarration(input, cfg, fake), /NVIDIA HTTP 429/);
  });

  test("empty completion is an error", async () => {
    const fake = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }))) as typeof fetch;
    await assert.rejects(modelNarration(input, cfg, fake), /empty completion/);
  });

  test("reasoning-length failure says how to fix it", async () => {
    const fake = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, reasoning_content: "thinking..." }, finish_reason: "length" }],
    }))) as typeof fetch;
    await assert.rejects(modelNarration(input, cfg, fake), /NARRATION_DISABLE_THINKING/);
  });

  test("thinking can be left on for models that need it", async () => {
    let body = "";
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }) as typeof fetch;
    await modelNarration(input, { ...cfg, disableThinking: false, reasoningEffort: "low" }, fake);
    const parsed = JSON.parse(body);
    assert.equal(parsed.chat_template_kwargs, undefined);
    assert.equal(parsed.reasoning_effort, "low");
  });
});
