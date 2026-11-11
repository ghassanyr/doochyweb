// Shapes shared by the integrations registry, store and admin API.
//
// Secrets never appear in these view types. The admin receives field metadata
// (configured, source, masked hint) and the runtime receives resolved values
// only through resolveIntegration, which is never serialised to a response.

export type IntegrationProvider = "ctrader" | "telegram";

export type IntegrationFieldKind = "text" | "secret" | "number" | "boolean" | "select";

/** Where an effective value came from. */
export type IntegrationSource = "database" | "environment" | "default" | "unset";

export interface IntegrationFieldOption {
  value: string;
  label: string;
}

export interface IntegrationFieldDef {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  /** Environment fallback used until an admin saves a database value. */
  env?: string;
  required?: boolean;
  /** Used when neither the database nor the environment supplies a value. */
  defaultValue?: string | number | boolean;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  format?: "url" | "email";
  options?: readonly IntegrationFieldOption[];
}

export interface IntegrationProviderDef {
  provider: IntegrationProvider;
  label: string;
  description: string;
  fields: readonly IntegrationFieldDef[];
}

export interface IntegrationFieldState {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  required: boolean;
  /** Non-secret effective value; always null for secrets. */
  value: string | number | boolean | null;
  configured: boolean;
  source: IntegrationSource;
  /** Masked recognition hint for a database-stored secret. */
  hint: string | null;
  /** Set when a stored or environment value could not be read. */
  error: string | null;
}

export interface IntegrationState {
  provider: IntegrationProvider;
  label: string;
  description: string;
  /** Every required field has a value and nothing failed to decode. */
  ready: boolean;
  fields: IntegrationFieldState[];
  updatedAt: string | null;
  updatedBy: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

/** Admin write payload. Empty secrets keep the stored value; use clear. */
export interface IntegrationPatch {
  values?: Record<string, unknown>;
  clear?: string[];
}

export interface ResolvedIntegration {
  provider: IntegrationProvider;
  /** Decrypted secrets and effective non-secret values. Never serialise this. */
  values: Record<string, string | number | boolean>;
  sources: Record<string, IntegrationSource>;
  /** Required field keys with no usable value. */
  missing: string[];
}

/** Stored shape for one provider inside the singleton document. */
export interface StoredIntegrationProvider {
  values?: Record<string, unknown>;
  updatedAt?: Date | string | null;
  updatedBy?: string | null;
  lastTestAt?: Date | string | null;
  lastTestOk?: boolean | null;
  lastTestMessage?: string | null;
}
