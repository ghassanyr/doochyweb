// NVIDIA's GET /v1/models returns the whole hosted catalog, not the subset the
// supplied key can invoke. Calling a catalog model the account cannot use
// returns HTTP 404 with "Function ...: Not found for account". NVIDIA has no
// documented endpoint that lists only the usable subset, and GET
// /v1/models/{id} still returns 200 for an unusable model, so the only reliable
// check is a small chat completion per candidate.
//
// This module filters out obvious non-chat endpoints first, probes the rest
// with bounded concurrency, and caches the result per endpoint and key. Probes
// are deliberately small: a model that answers HTTP 200 is usable even when the
// one-token reply is empty (reasoning and vision models often do that).

import { createHash } from "node:crypto";

export interface AiEndpoint {
  apiKey: string;
  baseUrl: string;
}

export type ModelProbeOutcome =
  | "available"
  | "unavailable"
  | "unknown"
  | "auth"
  | "rate_limited";

export interface ModelAvailability {
  available: string[];
  unavailable: string[];
  unknown: string[];
  authError: string | null;
  checkedNow: number;
  cached: number;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 32;
const MAX_PROBES = 64;
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_BUDGET_MS = 35_000;
const RATE_LIMIT_RETRY_MS = 900;

// Endpoints that are not chat-completions models. The catalog mixes embeddings,
// rerankers, safety classifiers, speech/translation models, image generators
// and base completion models into the same list, and none of them belong in a
// chat model picker.
const NON_CHAT_MODEL_PATTERNS: RegExp[] = [
  /(^|[/_.-])(bge|clip|embed|embedqa|embedcode|embedding|gliner|rerank|retriever|reward|deplot|detector)([/_.-]|$)/i,
  /(^|[/_.-])nv(clip|embed|embedqa|embedcode|retriever|rerank)([/_.-]|$)/i,
  /(^|[/_.-])(guard|safety|nemoguard)([/_.-]|$)/i,
  /(^|[/_.-])(codegemma|codellama|starcoder\d*)([/_.-]|$)/i,
  /(^|[/_.-])llama2([/_.-]|$)/i,
  /(^|[/_.-])(gemma-2b|recurrentgemma)([/_.-]|$)/i,
  /(^|[/_.-])(riva|translate|calibration|parakeet|canary|fastpitch|tts|asr)([/_.-]|$)/i,
  /(^|[/_.-])(flux|sdxl|stable-diffusion|imagen|edify|kandinsky|dalle)([/_.-]|$)/i,
];

/** True when a catalog id looks like a chat-completions model. */
export function isChatCapableModelId(id: string): boolean {
  const value = id.trim();
  if (!value) return false;
  return !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(value));
}

/** True for NVIDIA's hosted Build endpoint, including a custom base URL. */
export function isNvidiaEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "integrate.api.nvidia.com";
  } catch {
    return false;
  }
}

// Probe current chat families first. The catalog is alphabetical, so without
// this a rate-limited first pass could spend its budget on retired models and
// never reach the ones a buyer is likely to pick.
const PREFERRED_MODEL_PATTERNS: RegExp[] = [
  /nemotron-3\.5/i,
  /nemotron-3/i,
  /gpt-oss/i,
  /glm-5/i,
  /minimax/i,
  /kimi-k[23]/i,
  /deepseek-v4/i,
  /deepseek-v3/i,
  /llama-4/i,
  /llama-3\.3/i,
  /gemma-4/i,
  /gemma-3/i,
  /qwen2\.5/i,
  /qwq/i,
  /mistral-large/i,
  /mistral-nemotron/i,
  /phi-4/i,
  /laguna/i,
  /step-3/i,
  /muse-glimmer/i,
];

function probeRank(id: string): number {
  for (let index = 0; index < PREFERRED_MODEL_PATTERNS.length; index++) {
    if (PREFERRED_MODEL_PATTERNS[index].test(id)) return index;
  }
  return PREFERRED_MODEL_PATTERNS.length;
}

interface CacheEntry {
  available: Set<string>;
  unavailable: Set<string>;
  updatedAt: number;
}

const availabilityCache = new Map<string, CacheEntry>();

function cacheKey(config: AiEndpoint): string {
  return createHash("sha256")
    .update(`${config.baseUrl}\u0000${config.apiKey}`)
    .digest("hex");
}

function readCache(config: AiEndpoint): CacheEntry {
  const key = cacheKey(config);
  const now = Date.now();
  const existing = availabilityCache.get(key);
  if (existing && now - existing.updatedAt < CACHE_TTL_MS) return existing;

  const entry: CacheEntry = {
    available: new Set<string>(),
    unavailable: new Set<string>(),
    updatedAt: now,
  };
  availabilityCache.set(key, entry);
  if (availabilityCache.size > CACHE_MAX_ENTRIES) {
    const oldest = availabilityCache.keys().next().value;
    if (oldest) availabilityCache.delete(oldest);
  }
  return entry;
}

/** Clear the cache. Exported for tests and for a forced refresh. */
export function resetModelAvailabilityCache(): void {
  availabilityCache.clear();
}

async function probeOnce(
  config: AiEndpoint,
  model: string,
  timeoutMs: number
): Promise<ModelProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        stream: false,
      }),
      signal: controller.signal,
    });

    // A 200 means the endpoint exists for this account. An empty body is fine:
    // reasoning and vision models can spend the whole small token budget before
    // producing visible text.
    if (res.ok) return "available";
    if (res.status === 401) return "auth";
    // 404/410 are the documented "not found for account" and retired signals.
    if (res.status === 404 || res.status === 410) return "unavailable";
    // The endpoint exists but rejects this request shape. For a chat picker that
    // is not a usable chat model.
    if (res.status === 400 || res.status === 403 || res.status === 422) return "unavailable";
    if (res.status === 429) return "rate_limited";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeModel(
  config: AiEndpoint,
  model: string,
  deadline: number
): Promise<ModelProbeOutcome> {
  if (Date.now() >= deadline) return "unknown";

  let outcome = await probeOnce(config, model, PROBE_TIMEOUT_MS);
  // A burst of probes can trip NVIDIA's free-tier rate limit. One short retry
  // separates a real rate limit from a model that is simply not usable.
  if (outcome === "rate_limited" && Date.now() < deadline) {
    await delay(RATE_LIMIT_RETRY_MS);
    if (Date.now() < deadline) {
      outcome = await probeOnce(config, model, PROBE_TIMEOUT_MS);
    }
  }
  return outcome === "rate_limited" ? "unknown" : outcome;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) return;
        await worker(items[current]);
      }
    }
  );
  await Promise.all(workers);
}

export interface CheckModelAvailabilityOptions {
  budgetMs?: number;
  concurrency?: number;
  maxProbes?: number;
}

/**
 * Probe the chat-capable ids and report which ones the key can actually use.
 * Results are cached for ten minutes. A refresh reuses confirmed and rejected
 * ids and only probes the ones still unknown, so a rate-limited first pass can
 * make progress over a few refreshes instead of starting over.
 */
export async function checkModelAvailability(
  config: AiEndpoint,
  modelIds: readonly string[],
  options: CheckModelAvailabilityOptions = {}
): Promise<ModelAvailability> {
  const entry = readCache(config);
  const deadline = Date.now() + (options.budgetMs ?? PROBE_BUDGET_MS);
  const unique = [...new Set(modelIds.filter(isChatCapableModelId))].sort((a, b) => {
    const rank = probeRank(a) - probeRank(b);
    return rank !== 0 ? rank : a.localeCompare(b);
  });
  const pending = unique
    .filter((id) => !entry.available.has(id) && !entry.unavailable.has(id))
    .slice(0, options.maxProbes ?? MAX_PROBES);

  let authError: string | null = null;
  let checkedNow = 0;

  await runWithConcurrency(
    pending,
    options.concurrency ?? PROBE_CONCURRENCY,
    async (model) => {
      if (authError || Date.now() >= deadline) return;
      const outcome = await probeModel(config, model, deadline);
      checkedNow++;
      if (outcome === "available") entry.available.add(model);
      else if (outcome === "unavailable") entry.unavailable.add(model);
      else if (outcome === "auth") {
        authError = "The API key was rejected (HTTP 401). Check the key and try again.";
      }
    }
  );

  entry.updatedAt = Date.now();

  if (authError) {
    // A rejected key says nothing about individual models, so drop the cache.
    resetModelAvailabilityCache();
    return {
      available: [],
      unavailable: [],
      unknown: unique,
      authError,
      checkedNow,
      cached: 0,
    };
  }

  return {
    available: unique.filter((id) => entry.available.has(id)),
    unavailable: unique.filter((id) => entry.unavailable.has(id)),
    unknown: unique.filter(
      (id) => !entry.available.has(id) && !entry.unavailable.has(id)
    ),
    authError: null,
    checkedNow,
    cached: unique.length - pending.length,
  };
}
