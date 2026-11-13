// Persistence and runtime resolution for integration secrets.
//
// One document keyed `key: "integrations"` holds a map of provider values.
// Secret fields are AES-GCM ciphertext; non-secret fields are plain scalars.
// The database wins over the environment so a buyer can configure everything
// from the admin panel, while .env still bootstraps existing deployments.
//
// The admin API must only ever call getIntegrationStates/getIntegrationState.
// resolveIntegration returns decrypted secrets for runtime consumers (Telegram,
// SMTP, cTrader) and must never be serialised to a response.

import mongoose from "mongoose";

import {
  ENCRYPTION_KEY_ENV,
  decryptSecret,
  encryptSecret,
  encryptionKeyFromEnv,
  isEncryptedSecret,
  maskSecret,
  requireEncryptionKey,
} from "./crypto";
import { canonicalPublicBaseUrl } from "../settings/siteUrl";
import { providerIssues } from "./ctraderSetup";
import {
  INTEGRATION_DEFS,
  INTEGRATION_PROVIDERS,
  integrationAad,
  integrationField,
} from "./registry";
import type {
  IntegrationFieldDef,
  IntegrationFieldState,
  IntegrationProvider,
  IntegrationSource,
  IntegrationState,
  IntegrationTestResult,
  ResolvedIntegration,
  StoredIntegrationProvider,
} from "./types";
import {
  IntegrationValidationError,
  applyIntegrationPatch,
  coerceFieldValue,
  normalizeIntegrationPatch,
} from "./validate";

const integrationsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "integrations" },
    // Mixed because providers are added over time; validation happens in code
    // before anything is written.
    providers: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const IntegrationsModel = mongoose.model("Integrations", integrationsSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "invalid value";
}

function envValue(env: NodeJS.ProcessEnv, name: string | undefined): string | null {
  if (!name) return null;
  const raw = env[name];
  return raw === undefined || raw.trim() === "" ? null : raw;
}

function storedValues(stored: StoredIntegrationProvider | null | undefined): Record<string, unknown> {
  return stored?.values && typeof stored.values === "object" ? stored.values : {};
}

async function loadProviders(): Promise<Record<string, StoredIntegrationProvider>> {
  const doc: any = await IntegrationsModel.findOne({ key: "integrations" }).lean().exec();
  return doc?.providers && typeof doc.providers === "object" ? doc.providers : {};
}

function describeField(
  provider: IntegrationProvider,
  def: IntegrationFieldDef,
  values: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  key: Buffer | null
): IntegrationFieldState {
  const base: IntegrationFieldState = {
    key: def.key,
    label: def.label,
    kind: def.kind,
    required: def.required === true,
    value: null,
    configured: false,
    source: "unset",
    hint: null,
    error: null,
    options: def.options,
    placeholder: def.placeholder,
    maxLength: def.maxLength,
  };

  const stored = values[def.key];

  if (def.kind === "secret") {
    if (stored !== undefined && stored !== null && stored !== "") {
      if (typeof stored !== "string") {
        return { ...base, configured: true, source: "database", error: "stored secret is invalid" };
      }
      if (!isEncryptedSecret(stored)) {
        return {
          ...base,
          configured: true,
          source: "database",
          error: "stored secret is not encrypted",
        };
      }
      if (!key) {
        return {
          ...base,
          configured: true,
          source: "database",
          error: `${ENCRYPTION_KEY_ENV} is not set`,
        };
      }
      try {
        const plain = decryptSecret(stored, integrationAad(provider, def.key), key);
        return { ...base, configured: true, source: "database", hint: maskSecret(plain) };
      } catch {
        return {
          ...base,
          configured: true,
          source: "database",
          error: "stored secret could not be decrypted",
        };
      }
    }

    const raw = envValue(env, def.env);
    if (raw !== null) {
      try {
        coerceFieldValue(def, raw);
        return { ...base, configured: true, source: "environment" };
      } catch (err) {
        return { ...base, source: "environment", error: errorMessage(err) };
      }
    }
    return base;
  }

  if (stored !== undefined && stored !== null && stored !== "") {
    try {
      const value = coerceFieldValue(def, stored);
      if (value !== null) {
        return { ...base, value, configured: true, source: "database" };
      }
    } catch (err) {
      return { ...base, source: "database", error: errorMessage(err) };
    }
  }

  const raw = envValue(env, def.env);
  if (raw !== null) {
    try {
      const value = coerceFieldValue(def, raw);
      if (value !== null) {
        return { ...base, value, configured: true, source: "environment" };
      }
    } catch (err) {
      return { ...base, source: "environment", error: errorMessage(err) };
    }
  }

  if (def.defaultValue !== undefined) {
    return { ...base, value: def.defaultValue, configured: true, source: "default" };
  }
  return base;
}

/**
 * Admin-safe view of one provider. Secret values are never included, only a
 * masked hint when the value came from the database.
 */
export function describeIntegration(
  provider: IntegrationProvider,
  stored: StoredIntegrationProvider | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  key: Buffer | null = encryptionKeyFromEnv(env),
  publicBaseUrl: string | null = null
): IntegrationState {
  const def = INTEGRATION_DEFS[provider];
  const values = storedValues(stored);
  const fields = def.fields.map((field) => describeField(provider, field, values, env, key));
  const legacyBase = typeof values.publicBaseUrl === "string" ? values.publicBaseUrl : null;
  const issues = providerIssues(provider, fields, publicBaseUrl ?? legacyBase);
  const ready =
    fields.every((field) => field.error === null) &&
    fields.every((field) => !field.required || field.configured) &&
    issues.errors.length === 0;

  return {
    provider,
    label: def.label,
    description: def.description,
    ready,
    fields,
    errors: issues.errors,
    warnings: issues.warnings,
    updatedAt: iso(stored?.updatedAt),
    updatedBy: typeof stored?.updatedBy === "string" ? stored.updatedBy : null,
    lastTestAt: iso(stored?.lastTestAt),
    lastTestOk:
      stored?.lastTestOk === true ? true : stored?.lastTestOk === false ? false : null,
    lastTestMessage:
      typeof stored?.lastTestMessage === "string" ? stored.lastTestMessage : null,
    lastTestDraft: stored?.lastTestDraft === true,
  };
}

/**
 * Decrypt the stored overrides into plaintext, without touching the
 * environment. Throws on corrupt stored secrets or a missing key rather than
 * silently falling back.
 */
function plainStoredValues(
  provider: IntegrationProvider,
  stored: StoredIntegrationProvider | null | undefined,
  key: Buffer | null,
  skip?: ReadonlySet<string>
): Record<string, unknown> {
  const def = INTEGRATION_DEFS[provider];
  const values = storedValues(stored);
  const out: Record<string, unknown> = {};

  for (const field of def.fields) {
    if (skip?.has(field.key)) continue;
    const storedValue = values[field.key];
    if (storedValue === undefined || storedValue === null || storedValue === "") continue;

    if (field.kind === "secret") {
      if (typeof storedValue !== "string" || !isEncryptedSecret(storedValue)) {
        throw new IntegrationValidationError(
          `${provider}.${field.key} is not an encrypted secret`
        );
      }
      if (!key) {
        throw new IntegrationValidationError(
          `${provider}.${field.key} needs ${ENCRYPTION_KEY_ENV} to decrypt`
        );
      }
      out[field.key] = decryptSecret(storedValue, integrationAad(provider, field.key), key);
    } else {
      out[field.key] = storedValue;
    }
  }

  return out;
}

/** Apply environment/default fallbacks to a set of plaintext overrides. */
function resolvePlainValues(
  provider: IntegrationProvider,
  overrides: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): ResolvedIntegration {
  const def = INTEGRATION_DEFS[provider];
  const resolved: Record<string, string | number | boolean> = {};
  const sources: Record<string, IntegrationSource> = {};
  const missing: string[] = [];

  for (const field of def.fields) {
    const raw = overrides[field.key];
    if (raw !== undefined && raw !== null && raw !== "") {
      const value = coerceFieldValue(field, raw);
      if (value !== null) {
        resolved[field.key] = value;
        sources[field.key] = "database";
        continue;
      }
    }

    const envRaw = envValue(env, field.env);
    if (envRaw !== null) {
      const value = coerceFieldValue(field, envRaw);
      if (value !== null) {
        resolved[field.key] = value;
        sources[field.key] = "environment";
        continue;
      }
    }

    if (field.defaultValue !== undefined) {
      resolved[field.key] = field.defaultValue;
      sources[field.key] = "default";
      continue;
    }

    if (field.required) missing.push(field.key);
  }

  return { provider, values: resolved, sources, missing };
}

/**
 * Effective values for a runtime consumer. Throws on corrupt stored values or
 * a missing key rather than silently falling back to the environment. Missing
 * required fields are reported, not thrown, so a consumer can stay disabled.
 */
export function resolveIntegrationValues(
  provider: IntegrationProvider,
  stored: StoredIntegrationProvider | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  key: Buffer | null = encryptionKeyFromEnv(env)
): ResolvedIntegration {
  return resolvePlainValues(provider, plainStoredValues(provider, stored, key), env);
}

/**
 * Resolve what a save would produce, without writing anything. Draft secrets
 * stay plaintext in memory; an empty secret keeps the stored one and an empty
 * non-secret drops the database override, exactly like the PUT.
 */
export function resolveDraftValues(
  provider: IntegrationProvider,
  stored: StoredIntegrationProvider | null | undefined,
  patch: unknown,
  env: NodeJS.ProcessEnv = process.env,
  key: Buffer | null = encryptionKeyFromEnv(env)
): ResolvedIntegration {
  const { set, clear } = normalizeIntegrationPatch(provider, patch);
  const overrides = plainStoredValues(
    provider,
    stored,
    key,
    new Set([...Object.keys(set), ...clear])
  );

  for (const fieldKey of clear) delete overrides[fieldKey];
  for (const [fieldKey, value] of Object.entries(set)) overrides[fieldKey] = value;

  return resolvePlainValues(provider, overrides, env);
}

export async function getIntegrationStates(
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): Promise<IntegrationState[]> {
  const providers = await loadProviders();
  const key = encryptionKeyFromEnv(env);
  const publicBaseUrl = await canonicalPublicBaseUrl(env, requestOrigin);
  return INTEGRATION_PROVIDERS.map((provider) =>
    describeIntegration(provider, providers[provider], env, key, publicBaseUrl)
  );
}

export async function getIntegrationState(
  provider: IntegrationProvider,
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): Promise<IntegrationState> {
  const providers = await loadProviders();
  const publicBaseUrl = await canonicalPublicBaseUrl(env, requestOrigin);
  return describeIntegration(
    provider,
    providers[provider],
    env,
    encryptionKeyFromEnv(env),
    publicBaseUrl
  );
}

/** Runtime read with decrypted secrets. Never send the result to a client. */
export async function resolveIntegration(
  provider: IntegrationProvider,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedIntegration> {
  const providers = await loadProviders();
  return resolveIntegrationValues(provider, providers[provider], env, encryptionKeyFromEnv(env));
}

/**
 * Runtime read that merges an unsaved draft patch over the stored values.
 * Used only by the admin test endpoint; never persists the draft.
 */
export async function resolveDraftIntegration(
  provider: IntegrationProvider,
  patch: unknown,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedIntegration> {
  const providers = await loadProviders();
  return resolveDraftValues(
    provider,
    providers[provider],
    patch,
    env,
    encryptionKeyFromEnv(env)
  );
}

/**
 * Validate and persist a partial patch. A key is required even when only
 * non-secret fields change: the document is the encryption boundary, and a
 * deployment without a key cannot safely own secrets later.
 */
export async function saveIntegration(
  provider: IntegrationProvider,
  patch: unknown,
  updatedBy: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<IntegrationState> {
  const key = requireEncryptionKey(env);
  const providers = await loadProviders();
  const current = storedValues(providers[provider]);
  const values = applyIntegrationPatch(provider, current, patch, key);

  await IntegrationsModel.findOneAndUpdate(
    { key: "integrations" },
    {
      $set: {
        [`providers.${provider}.values`]: values,
        [`providers.${provider}.updatedAt`]: new Date(),
        [`providers.${provider}.updatedBy`]: updatedBy,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();

  return getIntegrationState(provider, env);
}

/** Store the outcome of a connection test; no secrets are recorded. */
export async function recordIntegrationTest(
  provider: IntegrationProvider,
  result: IntegrationTestResult,
  draft = false,
  env: NodeJS.ProcessEnv = process.env
): Promise<IntegrationState> {
  const message = result.message.trim().slice(0, 300);
  await IntegrationsModel.findOneAndUpdate(
    { key: "integrations" },
    {
      $set: {
        [`providers.${provider}.lastTestAt`]: new Date(),
        [`providers.${provider}.lastTestOk`]: result.ok,
        [`providers.${provider}.lastTestMessage`]: message,
        [`providers.${provider}.lastTestDraft`]: draft,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).exec();

  return getIntegrationState(provider, env);
}
