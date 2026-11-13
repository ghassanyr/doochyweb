// NVIDIA NIM (OpenAI-compatible) call for the per-event research note.
//
// The model gets a compact set of deterministic facts and a grounding contract.
// It never computes a number and is not given the template output. The caller
// stores the full input snapshot alongside the result for audit.

import { narrationModelInput, type NarrationInput } from "./narration";

export const NARRATION_PROMPT_VERSION = 5;

export const NARRATION_SYSTEM_PROMPT = `You are a market research narrator. Rewrite the supplied facts into a short research note.

Return ONLY a JSON object with exactly these three string keys:
{"what_happened":"...","history":"...","quality":"..."}

Content rules:
- Use only the facts and caveats supplied. Do not invent prices, levels, rates, sample sizes, symbols, events or outcomes.
- Every number you state must appear in the supplied facts. Never add a probability, target or forecast.
- Use at most 7 statistics across all three fields; the full details belong in the stats panel.
- Translate every fact into plain English. Do not use snake_case field names, raw ISO timestamps, confidence-interval notation, or internal labels such as out_of_sample.
- Call the comparison bars "nearby 4H bars", never "matching setups" or "similar breakouts".
- The context facts describe the 4H backdrop at the break: trend, range position, volatility percentile, level tests and volume. Use them as supplied; do not re-derive a trend or volatility reading.
- The evidence grade is supplied. Say the difference is weak, moderate or clear; never call it significant, predictive or a probability.
- Invalidation includes an ATR buffer. State the level plainly; never call it a stop-loss or a target.
- Do not repeat a fact or write a recap. Each supplied fact belongs in exactly one field.
- Do not add disclaimers or generic warnings such as "past outcomes do not predict future results" or "not financial advice".

Field rules:
- what_happened: 30-45 words on the break: level, break price, ATR distance, session and the 4H context.
- history: 30-45 words comparing the decisive-case share with the base rate; mention the evidence grade, the recent pool and whether it leans the other way, plus the median excursion if space allows.
- quality: 30-50 words on sample size/split, the generic-4H-bar and first-touch limits, and the buffered invalidation level.

Do not give trading advice, price targets, probabilities or significance claims. Plain text inside the JSON strings only; no markdown, no code fence, and no text outside the JSON object.`;

export const NARRATION_SYSTEM_PROMPT_NO_HISTORY = `You are a market research narrator. Rewrite the supplied facts into a short research note for an event with no nearby-bar history.

Return ONLY a JSON object with exactly these three string keys:
{"what_happened":"...","history":"...","quality":"..."}

Content rules:
- Use only the facts and caveats supplied. Do not invent prices, levels, rates, sample sizes, symbols, events or outcomes.
- Do not mention nearby-bar history, first-touch outcomes, sample sizes, base rates, recent pools, confidence intervals or historical odds when the facts say there is no history.
- The context facts describe the 4H backdrop at the break. You may use them; do not re-derive a trend or volatility reading.
- Translate every fact into plain English. Do not use snake_case field names, raw ISO timestamps or internal labels.
- Do not repeat a fact or write a recap. Each supplied fact belongs in exactly one field.
- Do not add disclaimers or generic warnings such as "past outcomes do not predict future results" or "not financial advice".
- Do not give trading advice, price targets, probabilities or significance claims.
- Plain text inside the JSON strings only; no markdown, no code fence, and no text outside the JSON object.

Field rules:
- what_happened: 25-40 words on the break: level, break price, ATR distance, session and the 4H context.
- history: 15-25 words saying no nearby-bar history was available and no historical odds are implied. Add nothing else.
- quality: 25-40 words on the buffered invalidation level and any other supplied limit. Do not invent a sample size.`;

export interface NarrationConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Reasoning models spend the token budget on reasoning_content and return empty content. */
  disableThinking: boolean;
  reasoningEffort: string | null;
}

/** Returns null unless key, base URL and model are all configured. */
export function narrationConfig(env: NodeJS.ProcessEnv = process.env): NarrationConfig | null {
  const apiKey = (env.NVIDIA_API_KEY ?? "").trim();
  const baseUrl = (env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").trim().replace(/\/+$/, "");
  const model = (env.NARRATION_MODEL ?? "").trim();
  if (!apiKey || !baseUrl || !model) return null;
  return {
    apiKey, baseUrl, model,
    disableThinking: (env.NARRATION_DISABLE_THINKING ?? "true").trim().toLowerCase() !== "false",
    reasoningEffort: (env.NARRATION_REASONING_EFFORT ?? "").trim() || null,
  };
}

export interface NarrationCompletion {
  text: string;
  model: string;
  usage: unknown;
}

const STRUCTURED_KEYS = ["what_happened", "history", "quality"] as const;

/** Accept a JSON object (optionally fenced) and join its three fields into paragraphs. */
function structuredNarration(content: string): string | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const parts = STRUCTURED_KEYS.map((k) => (typeof parsed[k] === "string" ? parsed[k].trim() : ""));
    return parts.every(Boolean) ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

/**
 * One chat completion. The fetch implementation is injectable so the contract can
 * be tested without a key or network. Errors are thrown; the caller records them.
 */
export async function modelNarration(
  input: NarrationInput,
  cfg: NarrationConfig,
  fetchImpl: typeof fetch = fetch
): Promise<NarrationCompletion> {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: "system",
          content: input.breakouts.length > 0 && input.breakouts.every((b) => !b.brief?.history)
            ? NARRATION_SYSTEM_PROMPT_NO_HISTORY
            : NARRATION_SYSTEM_PROMPT,
        },
        { role: "user", content: `Facts:\n${JSON.stringify(narrationModelInput(input))}` },
      ],
      temperature: 0.2,
      max_tokens: 900,
      stream: false,
      ...(cfg.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NVIDIA HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    usage?: unknown;
  };
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  const raw = typeof content === "string" ? content.trim() : "";
  const text = raw ? structuredNarration(raw) ?? raw : "";
  if (!text) {
    throw new Error(
      choice?.finish_reason === "length"
        ? "NVIDIA returned no content: the token budget was spent on reasoning. Set NARRATION_DISABLE_THINKING=true or raise max_tokens."
        : "NVIDIA returned an empty completion"
    );
  }
  return { text, model: cfg.model, usage: json.usage ?? null };
}
