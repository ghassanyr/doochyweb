// Validation and merge logic for integration patches.
//
// The admin PUT is a partial patch: only supplied fields change, an empty
// secret keeps the stored one, an empty non-secret clears the database override
// so the environment/default takes over again, and `clear` removes fields
// explicitly. Everything is validated before it can reach Mongo.

import { encryptSecret } from "./crypto";
import { integrationAad, integrationField } from "./registry";
import type { IntegrationFieldDef, IntegrationProvider } from "./types";

export class IntegrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationValidationError";
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;
const TRUTHY = ["true", "1", "on", "yes"];
const FALSY = ["false", "0", "off", "no"];

/**
 * Coerce a raw database/environment value to the field's type. Empty text is
 * null (no value). Errors never include secret input.
 */
export function coerceFieldValue(
  def: IntegrationFieldDef,
  raw: unknown
): string | number | boolean | null {
  if (def.kind === "text" || def.kind === "secret") {
    if (typeof raw !== "string") {
      throw new IntegrationValidationError(`${def.label} must be a string`);
    }
    const value = raw.trim();
    if (!value) return null;
    if (def.maxLength && value.length > def.maxLength) {
      throw new IntegrationValidationError(
        `${def.label} must be ${def.maxLength} characters or fewer`
      );
    }
    if (def.format === "url" && !HTTP_URL.test(value)) {
      throw new IntegrationValidationError(`${def.label} must be an http(s) URL`);
    }
    if (def.format === "email" && !EMAIL.test(value)) {
      throw new IntegrationValidationError(`${def.label} must be a valid email address`);
    }
    return value;
  }

  if (def.kind === "number") {
    const value =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim()
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(value)) {
      throw new IntegrationValidationError(`${def.label} must be a number`);
    }
    if (def.integer && !Number.isInteger(value)) {
      throw new IntegrationValidationError(`${def.label} must be a whole number`);
    }
    if (def.min !== undefined && value < def.min) {
      throw new IntegrationValidationError(`${def.label} must be at least ${def.min}`);
    }
    if (def.max !== undefined && value > def.max) {
      throw new IntegrationValidationError(`${def.label} must be at most ${def.max}`);
    }
    return value;
  }

  if (def.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number" && (raw === 0 || raw === 1)) return raw === 1;
    if (typeof raw === "string") {
      const value = raw.trim().toLowerCase();
      if (TRUTHY.includes(value)) return true;
      if (FALSY.includes(value)) return false;
    }
    throw new IntegrationValidationError(`${def.label} must be true or false`);
  }

  if (def.kind === "select") {
    if (typeof raw === "string") {
      const value = raw.trim();
      if (def.options?.some((option) => option.value === value)) return value;
    }
    const allowed = def.options?.map((option) => option.value).join(", ") ?? "";
    throw new IntegrationValidationError(`${def.label} must be one of: ${allowed}`);
  }

  throw new IntegrationValidationError(`${def.label} has an unsupported type`);
}

export interface NormalizedIntegrationPatch {
  /** Values to write; secrets are still plaintext and get encrypted by apply. */
  set: Record<string, string | number | boolean>;
  /** Field keys whose database override should be removed. */
  clear: string[];
}

/** Validate the shape and every supplied value of an admin patch. */
export function normalizeIntegrationPatch(
  provider: IntegrationProvider,
  patch: unknown
): NormalizedIntegrationPatch {
  if (
    patch !== undefined &&
    patch !== null &&
    (typeof patch !== "object" || Array.isArray(patch))
  ) {
    throw new IntegrationValidationError("patch must be an object");
  }

  const source = (patch ?? {}) as Record<string, unknown>;
  const rawValues = source.values;
  if (
    rawValues !== undefined &&
    (rawValues === null || typeof rawValues !== "object" || Array.isArray(rawValues))
  ) {
    throw new IntegrationValidationError("values must be an object");
  }

  const set: Record<string, string | number | boolean> = {};
  const clear: string[] = [];

  for (const [key, raw] of Object.entries((rawValues ?? {}) as Record<string, unknown>)) {
    const def = integrationField(provider, key);
    if (!def) throw new IntegrationValidationError(`unknown ${provider} field: ${key}`);
    // null/undefined mean "leave this field alone", matching the admin form
    // which omits untouched inputs.
    if (raw === undefined || raw === null) continue;

    // An empty non-secret clears the database override. Check this before
    // coercion so number and boolean fields behave like text and select ones.
    if (def.kind !== "secret" && typeof raw === "string" && raw.trim() === "") {
      clear.push(key);
      continue;
    }

    const value = coerceFieldValue(def, raw);
    if (value === null) {
      // An empty secret is not a request to erase it; clear does that
      // explicitly. An empty non-secret just drops the database override.
      if (def.kind !== "secret") clear.push(key);
      continue;
    }
    set[key] = value;
  }

  const rawClear = source.clear;
  if (rawClear !== undefined) {
    if (!Array.isArray(rawClear)) {
      throw new IntegrationValidationError("clear must be an array");
    }
    for (const key of rawClear) {
      if (typeof key !== "string" || !integrationField(provider, key)) {
        throw new IntegrationValidationError(`unknown ${provider} field: ${String(key)}`);
      }
      clear.push(key);
    }
  }

  const uniqueClear = [...new Set(clear)];
  for (const key of uniqueClear) {
    if (key in set) {
      throw new IntegrationValidationError(`${key} cannot be set and cleared together`);
    }
  }

  return { set, clear: uniqueClear };
}

/**
 * Apply a validated patch to the stored values. Secrets are encrypted with the
 * provider:field AAD; non-secrets are stored as plain JSON scalars.
 */
export function applyIntegrationPatch(
  provider: IntegrationProvider,
  current: Record<string, unknown>,
  patch: unknown,
  key: Buffer
): Record<string, unknown> {
  const { set, clear } = normalizeIntegrationPatch(provider, patch);
  const next: Record<string, unknown> = { ...current };

  for (const fieldKey of clear) delete next[fieldKey];

  for (const [fieldKey, value] of Object.entries(set)) {
    const def = integrationField(provider, fieldKey);
    if (!def) throw new IntegrationValidationError(`unknown ${provider} field: ${fieldKey}`);
    next[fieldKey] =
      def.kind === "secret"
        ? encryptSecret(value as string, integrationAad(provider, fieldKey), key)
        : value;
  }

  return next;
}
