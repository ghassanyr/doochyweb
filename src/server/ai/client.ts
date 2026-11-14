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

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";

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

/** Trim, drop a trailing slash and fall back to the OpenAI base URL. */
export function normalizeBaseUrl(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || DEFAULT_AI_BASE_URL).replace(/\/+$/, "");
}

/** Build a config from resolved integration values, or null when unconfigured. */
export function aiConfigFromValues(
  values: Record<string, string | number | boolean>
): AiConfig | null {
  const apiKey = String(values.apiKey ?? "").trim();
  if (!apiKey) return null;
  const model = String(values.model ?? "").trim() || DEFAULT_AI_MODEL;
  return { apiKey, baseUrl: normalizeBaseUrl(values.baseUrl), model };
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
        Authorization: `Bearer ${config.apiKey}`,
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
      const detail = body.trim() ? `: ${body.trim().slice(0, 200)}` : "";
      throw new AiError(`AI provider returned HTTP ${res.status}${detail}`, res.status);
    }

    const data: any = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
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

/** Admin "Test" button: one tiny round trip, no secrets in the result. */
export async function testAi(values: Record<string, string | number | boolean>): Promise<{
  ok: boolean;
  message: string;
}> {
  const config = aiConfigFromValues(values);
  if (!config) return { ok: false, message: "Add an API key first." };

  try {
    const reply = await aiChat(
      config,
      [{ role: "user", content: "Reply with the single word: ok" }],
      { maxTokens: 8, temperature: 0, timeoutMs: 15_000 }
    );
    return {
      ok: true,
      message: `Connected to ${reply.model}. Reply: ${reply.text.slice(0, 40)}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "AI test failed" };
  }
}
