import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FlaskConical,
  Mail,
  Plug,
  Save,
  Send,
} from "lucide-react";

import {
  adminApi,
  type AdminIntegrationsResponse,
  type CallbackCandidates,
  type IntegrationFieldState,
  type IntegrationPatch,
  type IntegrationProvider,
  type IntegrationState,
  type IntegrationTestResult,
} from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, Skeleton, inputCls } from "../components/ui";
import type { ViewKey } from "../routing";
import { formatLocalDateTime } from "../time";

interface Draft {
  values: Record<string, string>;
  cleared: string[];
}

type Drafts = Partial<Record<IntegrationProvider, Draft>>;
type Baselines = Partial<Record<IntegrationProvider, Record<string, string>>>;

const EMPTY_CALLBACKS: CallbackCandidates = { baseUrl: null, primary: null, api: null };

function initialValues(state: IntegrationState): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of state.fields) {
    if (field.kind === "secret") {
      values[field.key] = "";
    } else {
      values[field.key] = field.value === null ? "" : String(field.value);
    }
  }
  return values;
}

function draftFrom(state: IntegrationState): Draft {
  return { values: initialValues(state), cleared: [] };
}

function buildPatch(
  state: IntegrationState,
  draft: Draft,
  baseline: Record<string, string>
): IntegrationPatch {
  const values: Record<string, unknown> = {};
  const clear: string[] = [];

  for (const field of state.fields) {
    if (draft.cleared.includes(field.key)) {
      clear.push(field.key);
      continue;
    }
    const raw = draft.values[field.key] ?? "";
    if (field.kind === "secret") {
      if (raw.trim()) values[field.key] = raw;
      continue;
    }
    if (raw !== (baseline[field.key] ?? "")) values[field.key] = raw;
  }

  return { values, clear };
}

function isDirty(patch: IntegrationPatch): boolean {
  return Object.keys(patch.values ?? {}).length > 0 || (patch.clear?.length ?? 0) > 0;
}

const SOURCE_LABEL: Record<string, string> = {
  database: "Saved",
  environment: "From environment",
  default: "Default",
  unset: "Not set",
};

function Field({
  field,
  draft,
  baseline,
  disabled,
  onChange,
  onClear,
}: {
  field: IntegrationFieldState;
  draft: Draft;
  baseline: Record<string, string>;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const value = draft.values[field.key] ?? "";
  const cleared = draft.cleared.includes(field.key);
  const changed = field.kind === "secret" ? value.trim() !== "" : value !== (baseline[field.key] ?? "");
  const source = SOURCE_LABEL[field.source] ?? field.source;

  const label = (
    <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-fg-muted">
      {field.label}
      {field.required && <span className="text-danger">*</span>}
      <span className="font-normal text-fg-faint">({cleared ? "will be removed" : source})</span>
      {changed && <span className="text-accent">changed</span>}
    </span>
  );

  if (field.kind === "boolean") {
    return (
      <label className="flex items-start gap-2 rounded-lg border border-hairline bg-soft px-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-accent"
          checked={value === "true"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? "true" : "false")}
        />
        <span className="min-w-0">
          {label}
          {field.hint && <span className="mt-0.5 block text-[11px] text-fg-faint">{field.hint}</span>}
        </span>
      </label>
    );
  }

  if (field.kind === "select") {
    const options = field.options ?? [];
    return (
      <label className="block space-y-1">
        {label}
        <select
          className={inputCls}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.hint && <span className="block text-[11px] text-fg-faint">{field.hint}</span>}
      </label>
    );
  }

  return (
    <label className="block space-y-1">
      {label}
      <div className="flex items-center gap-2">
        <input
          type={field.kind === "secret" ? "password" : field.kind === "number" ? "number" : "text"}
          className={inputCls}
          value={value}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            field.kind === "secret" && field.configured && !cleared
              ? "Saved. Leave empty to keep it"
              : field.placeholder
          }
          onChange={(event) => onChange(event.target.value)}
        />
        {field.kind === "secret" && field.configured && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={onClear}
            title={cleared ? "Keep the saved value" : "Remove the saved value"}
          >
            {cleared ? "Keep" : "Remove"}
          </Button>
        )}
      </div>
      {field.hint && <span className="block text-[11px] text-fg-faint">{field.hint}</span>}
      {field.error && <span className="block text-[11px] text-danger">{field.error}</span>}
    </label>
  );
}

function CallbackRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-2">
      <span className="w-[110px] shrink-0 text-[11px] font-medium text-fg-faint">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-fg">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function ProviderCard({
  state,
  draft,
  baseline,
  encryptionAvailable,
  callbacks,
  testResult,
  onDraftChange,
  onSave,
  onTest,
  onUseCallback,
}: {
  state: IntegrationState;
  draft: Draft;
  baseline: Record<string, string>;
  encryptionAvailable: boolean;
  callbacks: CallbackCandidates;
  testResult: IntegrationTestResult | null;
  onDraftChange: (draft: Draft) => void;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
  onUseCallback: (url: string) => void;
}) {
  const patch = buildPatch(state, draft, baseline);
  const dirty = isDirty(patch);
  const provider = state.provider;
  const Icon = provider === "ctrader" ? Plug : provider === "smtp" ? Mail : Send;

  function updateValue(key: string, value: string) {
    onDraftChange({
      ...draft,
      cleared: draft.cleared.filter((entry) => entry !== key),
      values: { ...draft.values, [key]: value },
    });
  }

  function toggleClear(key: string) {
    const cleared = draft.cleared.includes(key)
      ? draft.cleared.filter((entry) => entry !== key)
      : [...draft.cleared, key];
    onDraftChange({ ...draft, cleared, values: { ...draft.values, [key]: "" } });
  }

  const redirectField = state.fields.find((field) => field.key === "redirectUri");

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-fg">
              {state.label}
              <Badge tone={state.ready ? "success" : "muted"}>
                {state.ready ? "Ready" : "Needs setup"}
              </Badge>
            </h2>
            <p className="mt-0.5 max-w-xl text-xs text-fg-muted">{state.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            onClickAsync={onTest}
          >
            Test
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Save className="h-3.5 w-3.5" />}
            onClickAsync={onSave}
            disabled={!dirty || !encryptionAvailable}
          >
            Save
          </Button>
        </div>
      </div>

      {provider === "ctrader" && (
        <div className="space-y-2 rounded-xl border border-hairline bg-soft/60 p-3">
          <p className="text-xs font-semibold text-fg">Setup checklist</p>
          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-fg-muted">
            <li>
              Sign in at{" "}
              <a
                href="https://openapi.ctrader.com/apps"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                openapi.ctrader.com/apps
              </a>{" "}
              and create an app.
            </li>
            <li>Copy the app's Client ID and Client secret into the fields below.</li>
            <li>Add one of the callback URLs below to the app's redirect URIs. It must match exactly.</li>
            <li>Save, then run the check. A pass means the URL is reachable, not that cTrader approval is complete.</li>
          </ol>
          <div className="space-y-1.5 pt-1">
            <CallbackRow label="Recommended" value={callbacks.primary} />
            <CallbackRow label="Alternate" value={callbacks.api} />
            {!callbacks.primary && (
              <p className="text-[11px] text-fg-faint">
                Set the public base URL (or open this page through the public domain) to see the
                callback URLs.
              </p>
            )}
          </div>
          {redirectField && callbacks.primary && draft.values.redirectUri !== callbacks.primary && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUseCallback(callbacks.primary!)}
            >
              Use the recommended callback
            </Button>
          )}
        </div>
      )}

      {state.errors.length > 0 && (
        <Flash tone="danger">
          <span className="inline-flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.errors.join(" ")}</span>
          </span>
        </Flash>
      )}
      {state.warnings.length > 0 && (
        <Flash tone="danger">
          <span className="inline-flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.warnings.join(" ")}</span>
          </span>
        </Flash>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {state.fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            draft={draft}
            baseline={baseline}
            disabled={!encryptionAvailable && field.kind === "secret"}
            onChange={(value) => updateValue(field.key, value)}
            onClear={() => toggleClear(field.key)}
          />
        ))}
      </div>

      {(testResult || state.lastTestAt) && (
        <div className="rounded-lg border border-hairline bg-soft px-3 py-2 text-[11px] leading-relaxed">
          {testResult ? (
            <span className={testResult.ok ? "text-success" : "text-danger"}>
              {testResult.ok ? "Check passed: " : "Check failed: "}
              {testResult.message}
            </span>
          ) : (
            <span className={state.lastTestOk ? "text-success" : "text-danger"}>
              Last check {state.lastTestOk ? "passed" : "failed"}: {state.lastTestMessage}
            </span>
          )}
          {state.lastTestAt && (
            <span className="ml-1 text-fg-faint">
              ({formatLocalDateTime(state.lastTestAt)}
              {state.lastTestDraft ? ", unsaved draft" : ""})
            </span>
          )}
        </div>
      )}

      {state.updatedAt && (
        <p className="text-[11px] text-fg-faint">
          Last saved {formatLocalDateTime(state.updatedAt)}
          {state.updatedBy ? ` by ${state.updatedBy}` : ""}.
        </p>
      )}
    </Card>
  );
}

export default function AdminIntegrationsPage({
  onNavigate,
}: {
  onNavigate: (view: ViewKey) => void;
}) {
  const [data, setData] = useState<AdminIntegrationsResponse | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [baselines, setBaselines] = useState<Baselines>({});
  const [testResults, setTestResults] = useState<
    Partial<Record<IntegrationProvider, IntegrationTestResult>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<IntegrationProvider | null>(null);

  function applyIntegrations(integrations: IntegrationState[]) {
    const nextDrafts: Drafts = {};
    const nextBaselines: Baselines = {};
    for (const state of integrations) {
      const draft = draftFrom(state);
      nextDrafts[state.provider] = draft;
      nextBaselines[state.provider] = { ...draft.values };
    }
    setDrafts(nextDrafts);
    setBaselines(nextBaselines);
  }

  useEffect(() => {
    let alive = true;
    adminApi
      .integrations()
      .then((response) => {
        if (!alive) return;
        setData(response);
        applyIntegrations(response.integrations);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load integrations");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function updateIntegrationState(integration: IntegrationState) {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        integrations: current.integrations.map((entry) =>
          entry.provider === integration.provider ? integration : entry
        ),
      };
    });
  }

  function replaceIntegration(integration: IntegrationState) {
    updateIntegrationState(integration);
    const draft = draftFrom(integration);
    setDrafts((current) => ({ ...current, [integration.provider]: draft }));
    setBaselines((current) => ({ ...current, [integration.provider]: { ...draft.values } }));
  }

  async function save(provider: IntegrationProvider) {
    const state = data?.integrations.find((entry) => entry.provider === provider);
    const draft = drafts[provider];
    const baseline = baselines[provider];
    if (!state || !draft || !baseline) return;

    setError(null);
    setSaved(null);
    try {
      const { integration } = await adminApi.saveIntegration(
        provider,
        buildPatch(state, draft, baseline)
      );
      replaceIntegration(integration);
      setTestResults((current) => ({ ...current, [provider]: undefined }));
      setSaved(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the integration");
    }
  }

  async function test(provider: IntegrationProvider) {
    const state = data?.integrations.find((entry) => entry.provider === provider);
    const draft = drafts[provider];
    const baseline = baselines[provider];
    if (!state || !draft || !baseline) return;

    setError(null);
    setSaved(null);
    try {
      const response = await adminApi.testIntegration(
        provider,
        buildPatch(state, draft, baseline)
      );
      // Testing never saves the draft, so keep the user's edits on screen.
      updateIntegrationState(response.integration);
      setTestResults((current) => ({ ...current, [provider]: response.result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test the integration");
    }
  }

  const callbackPreview = data?.callbacks ?? EMPTY_CALLBACKS;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Flash tone="danger">{error ?? "Integrations are unavailable."}</Flash>
        <Button
          variant="secondary"
          icon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => onNavigate("admin")}
        >
          Back to admin
        </Button>
      </div>
    );
  }

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => onNavigate("admin")}
            aria-label="Back to admin"
            title="Back to admin"
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">Integrations</h1>
            <p className="text-sm text-fg-muted">
              Connect the platform services every user shares. Secrets are encrypted before they
              are stored and never sent back to the browser.
            </p>
          </div>
        </div>

        {error && <Flash tone="danger">{error}</Flash>}
        {saved && <Flash tone="success">Saved. The new values are live.</Flash>}
        {!data.encryptionAvailable && (
          <Flash tone="danger">
            <span className="inline-flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <code className="font-mono">INTEGRATIONS_ENCRYPTION_KEY</code> is not set. Generate
                one with <code className="font-mono">openssl rand -base64 32</code> and add it to
                the server environment before saving secrets.
              </span>
            </span>
          </Flash>
        )}

        {data.integrations.map((state) => {
          const draft = drafts[state.provider];
          const baseline = baselines[state.provider];
          if (!draft || !baseline) return null;
          return (
            <ProviderCard
              key={state.provider}
              state={state}
              draft={draft}
              baseline={baseline}
              encryptionAvailable={data.encryptionAvailable}
              callbacks={callbackPreview}
              testResult={testResults[state.provider] ?? null}
              onDraftChange={(next) =>
                setDrafts((current) => ({ ...current, [state.provider]: next }))
              }
              onSave={() => save(state.provider)}
              onTest={() => test(state.provider)}
              onUseCallback={(url) =>
                setDrafts((current) => {
                  const currentDraft = current[state.provider];
                  if (!currentDraft) return current;
                  return {
                    ...current,
                    [state.provider]: {
                      ...currentDraft,
                      values: { ...currentDraft.values, redirectUri: url },
                    },
                  };
                })
              }
            />
          );
        })}

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Saving here overrides the server environment. Clear a field to fall back to it again.
        </p>
      </div>
    </FadeRise>
  );
}
