export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";

export interface AiProviderPresetInfo {
  label: string;
  baseUrl: string;
  keyRequired: boolean;
  keyUrl: string | null;
  keyHint: string;
  docsUrl: string | null;
  models: readonly string[];
  defaultModel: string | null;
}

export const AI_PROVIDER_PRESETS = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyRequired: true,
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Create a project API key in the OpenAI dashboard.",
    docsUrl: "https://platform.openai.com/docs/models",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    defaultModel: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyRequired: true,
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "Create a key in OpenRouter. Model names usually include a vendor prefix.",
    docsUrl: "https://openrouter.ai/models",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"],
    defaultModel: "openai/gpt-4o-mini",
  },
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyRequired: true,
    keyUrl: "https://console.groq.com/keys",
    keyHint: "Create an API key in the Groq console.",
    docsUrl: "https://console.groq.com/docs/models",
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    defaultModel: "llama-3.1-8b-instant",
  },
  nvidia: {
    label: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyRequired: true,
    keyUrl: "https://build.nvidia.com/",
    keyHint: "Create an API key, then load the model list and choose a current model.",
    docsUrl: "https://build.nvidia.com/",
    models: [],
    defaultModel: null,
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    keyRequired: false,
    keyUrl: null,
    keyHint: "Ollama runs locally and does not need an API key.",
    docsUrl: "https://ollama.com/download",
    models: ["llama3.2", "qwen2.5", "mistral"],
    defaultModel: "llama3.2",
  },
} as const satisfies Record<string, AiProviderPresetInfo>;

export type AiProviderPreset = keyof typeof AI_PROVIDER_PRESETS;

export interface AiProviderOption extends AiProviderPresetInfo {
  value: AiProviderPreset;
}

export function aiProviderCatalog(): AiProviderOption[] {
  return (Object.entries(AI_PROVIDER_PRESETS) as [AiProviderPreset, AiProviderPresetInfo][]).map(
    ([value, info]) => ({ value, ...info })
  );
}

export function isAiProviderPreset(value: unknown): value is AiProviderPreset {
  return typeof value === "string" && value in AI_PROVIDER_PRESETS;
}

export function aiProviderInfo(value: unknown): AiProviderPresetInfo | null {
  return isAiProviderPreset(value) ? AI_PROVIDER_PRESETS[value] : null;
}

export function aiProviderKeyRequired(value: unknown): boolean {
  return aiProviderInfo(value)?.keyRequired ?? true;
}

export function aiDefaultModel(value: unknown): string {
  const info = aiProviderInfo(value);
  return info ? info.defaultModel ?? "" : DEFAULT_AI_MODEL;
}

/** Base URL implied by the selected provider, or null for a custom endpoint. */
export function presetBaseUrl(provider: unknown): string | null {
  return isAiProviderPreset(provider) ? AI_PROVIDER_PRESETS[provider].baseUrl : null;
}
