// Minimal OpenAI-compatible chat client for the AI features.
//
// The provider is configured in Admin -> Integrations: an API key (left empty
// until the buyer adds one), a base URL and a model. Nothing here is specific to
// OpenAI beyond the request shape, so OpenRouter, Groq, Azure gateways and local
// servers all work by changing the base URL.
//
// The key never leaves the server: it is read through the integrations store,
// used in an Authorization header, and never returned or logged. A corrupt
// stored secret makes loadAiConfig return null rather than throwing, so an AI
// page degrades to "not configured" instead of a 500.

import { resolveIntegration } from "../integrations/store";

import {
  checkModelAvailability,
  isChatCapableModelId,
  isNvidiaEndpoint,
} from "./availability";
import {
  DEFAULT_AI_BASE_URL,
  aiDefaultModel,
  aiProviderKeyRequired,
  presetBaseUrl,
} from "./providers";

export * from "./providers";
export * from "./availability";

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

/** Trim and drop a trailing slash. Empty becomes null. */
export function normalizeBaseUrl(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.replace(/\/+$/, "");
}

/**
 * Effective base URL: an explicit value wins (keeps legacy/custom configs
 * working), otherwise the selected provider's preset, otherwise OpenAI.
 */
export function resolveAiBaseUrl(
  values: Record<string, string | number | boolean>
): string {
  return (
    normalizeBaseUrl(values.baseUrl) ??
    presetBaseUrl(values.provider) ??
    DEFAULT_AI_BASE_URL
  );
}

export function resolveAiModel(
  values: Record<string, string | number | boolean>
): string {
  return String(values.model ?? "").trim() || aiDefaultModel(values.provider);
}

/** Build a config from resolved integration values, or null when unconfigured. */
export function aiConfigFromValues(
  values: Record<string, string | number | boolean>,
  options: { requireModel?: boolean } = {}
): AiConfig | null {
  const provider = values.provider ?? "openai";
  const apiKey = String(values.apiKey ?? "").trim();
  if (!apiKey && aiProviderKeyRequired(provider)) return null;
  if (String(provider) === "custom" && !normalizeBaseUrl(values.baseUrl)) return null;
  const model = resolveAiModel(values);
  if (options.requireModel !== false && !model) return null;
  return { apiKey, baseUrl: resolveAiBaseUrl(values), model };
}

/** Runtime read. Null means the AI provider is not ready yet. */
export async function loadAiConfig(): Promise<AiConfig | null> {
  try {
    const resolved = await resolveIntegration("ai");
    return aiConfigFromValues(resolved.values);
  } catch (err) {
    console.error(
      `[ai] configuration could not be read: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

export interface AiChatOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** One chat completion. Throws AiError with a browser-safe message. */
export async function aiChat(
  config: AiConfig,
  messages: AiMessage[],
  options: AiChatOptions = {}
): Promise<{ text: string; model: string }> {
  const timeoutMs = options.timeoutMs ?? 25_000;
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
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 500,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.trim() ? ` Detail: ${body.trim().slice(0, 200)}` : "";
      if (res.status === 401) {
        throw new AiError("The API key was rejected (HTTP 401). Check the key and try again.", 401);
      }
      if (res.status === 403) {
        throw new AiError(
          "The provider refused access (HTTP 403). Check the key permissions and model access.",
          403
        );
      }
      if (res.status === 404) {
        throw new AiError(
          `The endpoint or model was not found (HTTP 404). Check the base URL and model name.${detail}`,
          404
        );
      }
      if (res.status === 429) {
        throw new AiError("The provider rate-limited the request (HTTP 429). Try again shortly.", 429);
      }
      if (res.status === 400) {
        throw new AiError(`The provider rejected the request (HTTP 400).${detail}`, 400);
      }
      throw new AiError(`AI provider returned HTTP ${res.status}.${detail}`, res.status);
    }

    const data: any = await res.json().catch(() => null);
    const message = data?.choices?.[0]?.message;
    const rawContent = message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent
          .map((part: any) =>
            typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""
          )
          .join("")
      : rawContent;
    // Reasoning models can return an empty visible reply while placing their
    // output in reasoning_content. That is still a usable answer, so fall back
    // to it instead of reporting an empty reply.
    const reasoning =
      typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
    const text =
      typeof content === "string" && content.trim()
        ? content
        : reasoning.trim()
          ? reasoning
          : "";
    if (!text.trim()) {
      throw new AiError("AI provider returned an empty reply");
    }
    return { text: text.trim(), model: String(data?.model || config.model) };
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiError("AI provider timed out");
    }
    throw new AiError(
      `Could not reach the AI provider: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

function aiSetupMessage(
  values: Record<string, string | number | boolean>,
  requireModel = true
): string | null {
  const provider = values.provider ?? "openai";
  const apiKey = String(values.apiKey ?? "").trim();
  if (!apiKey && aiProviderKeyRequired(provider)) {
    return "Add an API key first.";
  }
  if (String(provider) === "custom" && !normalizeBaseUrl(values.baseUrl)) {
    return "Add the chat-completions base URL first.";
  }
  if (requireModel && !resolveAiModel(values)) {
    return "Choose a model first.";
  }
  return null;
}

/** Admin "Test" button: one tiny round trip, no secrets in the result. */
export async function testAi(values: Record<string, string | number | boolean>): Promise<{
  ok: boolean;
  message: string;
}> {
  const setupMessage = aiSetupMessage(values);
  if (setupMessage) return { ok: false, message: setupMessage };
  const config = aiConfigFromValues(values);
  if (!config) return { ok: false, message: "The AI configuration is incomplete." };

  try {
    const reply = await aiChat(
      config,
      [{ role: "user", content: "Reply with the single word: ok" }],
      { maxTokens: 32, temperature: 0, timeoutMs: 20_000 }
    );
    return {
      ok: true,
      message: `Connected to ${reply.model}. Reply: ${reply.text.slice(0, 40)}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "AI test failed" };
  }
}

export interface AiModelsResult {
  ok: boolean;
  models: string[];
  message: string;
  /** Catalog size before any chat filter or availability check. */
  total?: number;
  /** Models confirmed usable by the supplied key. */
  available?: number;
  /** Chat models the key cannot use. */
  unavailable?: number;
  /** Chat models not checked yet, for example because of the probe budget. */
  unknown?: number;
}

/**
 * Load the model IDs the configured endpoint advertises.
 *
 * Most providers already return only the models a key can use. NVIDIA's hosted
 * endpoint returns the entire catalog regardless of the key's entitlements, so
 * its chat-capable entries are probed and only the usable ones are returned.
 */
export async function listAiModels(
  values: Record<string, string | number | boolean>
): Promise<AiModelsResult> {
  const setupMessage = aiSetupMessage(values, false);
  if (setupMessage) return { ok: false, models: [], message: setupMessage };
  const config = aiConfigFromValues(values, { requireModel: false });
  if (!config) {
    return { ok: false, models: [], message: "The AI configuration is incomplete." };
  }

  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: {
        Accept: "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 401) throw new AiError("The API key was rejected (HTTP 401).", 401);
      if (res.status === 403) throw new AiError("The provider refused access (HTTP 403).", 403);
      if (res.status === 404) throw new AiError("The models endpoint was not found (HTTP 404).", 404);
      if (res.status === 429) throw new AiError("The provider rate-limited the request (HTTP 429).", 429);
      throw new AiError(`The models endpoint returned HTTP ${res.status}.`, res.status);
    }
    const data: any = await res.json().catch(() => null);
    const rows = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : [];
    const ids = rows
      .map((row: any) => (typeof row === "string" ? row : row?.id ?? row?.name))
      .filter((value: unknown): value is string => typeof value === "string" && !!value.trim())
      .map((value: string) => value.trim());
    const catalog = [...new Set<string>(ids)].sort((a, b) => a.localeCompare(b));
    if (catalog.length === 0) {
      return { ok: false, models: [], message: "The provider returned no models. Enter the model name manually." };
    }

    const provider = String(values.provider ?? "openai");
    const nvidia = provider === "nvidia" || isNvidiaEndpoint(config.baseUrl);
    if (!nvidia) {
      const models = catalog.slice(0, 200);
      return { ok: true, models, message: `Found ${models.length} models.` };
    }

    const label = "NVIDIA";
    const candidates = catalog.filter(isChatCapableModelId).slice(0, 200);
    if (candidates.length === 0) {
      return {
        ok: false,
        models: [],
        message: `The provider returned ${catalog.length} models, but none look like chat models. Enter the model name manually.`,
      };
    }

    const availability = await checkModelAvailability(config, candidates);
    if (availability.authError) {
      return { ok: false, models: [], message: availability.authError };
    }

    const models = availability.available;
    const skipped = catalog.length - candidates.length;
    const counts = {
      total: catalog.length,
      available: models.length,
      unavailable: availability.unavailable.length,
      unknown: availability.unknown.length,
    };

    if (models.length === 0) {
      const message =
        availability.unknown.length > 0
          ? `${label} returned ${catalog.length} models. None are confirmed yet and ${availability.unknown.length} are still unchecked. Use Refresh to check more.`
          : `${label} returned ${catalog.length} models. None of the ${candidates.length} chat models are available to this key.`;
      return { ok: false, models: [], message, ...counts };
    }

    const parts = [
      `${label} returned ${catalog.length} models.`,
      `${models.length} ${models.length === 1 ? "chat model is" : "chat models are"} available to this key.`,
    ];
    if (availability.unavailable.length > 0) {
      parts.push(`${availability.unavailable.length} not available.`);
    }
    if (availability.unknown.length > 0) {
      parts.push(`${availability.unknown.length} still unchecked; use Refresh to check more.`);
    }
    if (skipped > 0) {
      parts.push(`${skipped} non-chat ${skipped === 1 ? "model is" : "models are"} hidden.`);
    }

    return { ok: true, models, message: parts.join(" "), ...counts };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return { ok: false, models: [], message: "The provider timed out while loading models." };
    }
    return {
      ok: false,
      models: [],
      message: err instanceof Error ? err.message : "Could not load models.",
    };
  }
}
