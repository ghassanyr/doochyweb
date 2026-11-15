import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  Mail,
  Plug,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

import {
  adminApi,
  type AdminIntegrationsResponse,
  type AiProviderOption,
  type CallbackCandidates,
  type IntegrationFieldState,
  type IntegrationPatch,
  type IntegrationProvider,
  type IntegrationState,
  type IntegrationTestResult,
} from "../api";
import { AnimatedModal } from "../components/Modal";
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
  suggestions,
  onChange,
  onClear,
}: {
  field: IntegrationFieldState;
  draft: Draft;
  baseline: Record<string, string>;
  disabled: boolean;
  suggestions?: readonly string[];
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
          list={suggestions && suggestions.length > 0 ? "ai-model-options" : undefined}
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
      {suggestions && suggestions.length > 0 && (
        <datalist id="ai-model-options">
          {suggestions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
      )}
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

function ModelPickerModal({
  open,
  onClose,
  providerLabel,
  models,
  selected,
  loading,
  notice,
  onRefresh,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  providerLabel: string;
  models: string[];
  selected: string;
  loading: boolean;
  notice: { ok: boolean; message: string } | null;
  onRefresh: () => Promise<void>;
  onSelect: (model: string) => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? models.filter((model) => model.toLowerCase().includes(needle))
    : models;

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      title="Choose a model"
      subtitle={`${providerLabel} returned ${models.length} ${models.length === 1 ? "model" : "models"}.`}
      size="lg"
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClickAsync={onRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <Search className="h-3.5 w-3.5" />
            Search models
          </span>
          <input
            className={inputCls}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name"
            autoFocus
            spellCheck={false}
          />
        </label>

        <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
          {filtered.map((model) => {
            const active = selected === model;
            return (
              <button
                key={model}
                type="button"
                onClick={() => onSelect(model)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition " +
                  (active
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-hairline bg-soft text-fg hover:border-hairline-strong hover:bg-surface-hover")
                }
              >
                <span className="min-w-0 break-all font-mono text-xs">{model}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <p className="rounded-lg border border-hairline bg-soft px-3 py-4 text-center text-xs text-fg-faint">
              {models.length === 0
                ? "No models loaded yet. Use Refresh to fetch the provider list."
                : "No models match that search."}
            </p>
          )}
          {loading && (
            <p className="rounded-lg border border-hairline bg-soft px-3 py-4 text-center text-xs text-fg-faint">
              Loading models...
            </p>
          )}
        </div>

        {notice && (
          <p className={`text-[11px] ${notice.ok ? "text-success" : "text-danger"}`}>
            {notice.message}
          </p>
        )}
      </div>
    </AnimatedModal>
  );
}

function AiProviderCard({
  state,
  draft,
  baseline,
  encryptionAvailable,
  aiProviders,
  testResult,
  onDraftChange,
  onSave,
  onTest,
}: {
  state: IntegrationState;
  draft: Draft;
  baseline: Record<string, string>;
  encryptionAvailable: boolean;
  aiProviders: AiProviderOption[];
  testResult: IntegrationTestResult | null;
  onDraftChange: (draft: Draft) => void;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const patch = buildPatch(state, draft, baseline);
  const dirty = isDirty(patch);
  const providerField = state.fields.find((field) => field.key === "provider");
  const keyField = state.fields.find((field) => field.key === "apiKey");
  const modelField = state.fields.find((field) => field.key === "model");
  const baseUrlField = state.fields.find((field) => field.key === "baseUrl");
  const currentProvider = String(draft.values.provider || providerField?.value || "openai");
  const info = aiProviders.find((entry) => entry.value === currentProvider) ?? null;
  const isCustom = currentProvider === "custom";
  const keyRequired = info?.keyRequired ?? true;
  const apiKeyValue = (draft.values.apiKey ?? "").trim();
  const [editEndpoint, setEditEndpoint] = useState(false);
  const [loadedModels, setLoadedModels] = useState<string[] | null>(null);
  const [modelNotice, setModelNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const modelRequest = useRef(0);
  const previousApiKey = useRef(apiKeyValue);
  const baseUrlValue = (draft.values.baseUrl ?? "").trim();
  const customEndpoint =
    isCustom ||
    editEndpoint ||
    (!!info && baseUrlValue !== "" && baseUrlValue !== info.baseUrl);
  const suggestions = loadedModels ?? info?.models ?? [];
  const statusLabel = !state.ready
    ? "Needs setup"
    : state.lastTestOk === true
      ? state.lastTestDraft
        ? "Tested draft"
        : "Connected"
      : "Ready to test";
  const statusTone = !state.ready
    ? "muted"
    : state.lastTestOk === true
      ? "success"
      : "accent";

  function chooseProvider(value: string) {
    const nextInfo = aiProviders.find((entry) => entry.value === value) ?? null;
    const currentModel = (draft.values.model ?? "").trim();
    const nextModel = nextInfo ? nextInfo.defaultModel ?? "" : currentModel;
    onDraftChange({
      ...draft,
      cleared: draft.cleared.filter((key) => key !== "baseUrl" && key !== "model"),
      values: {
        ...draft.values,
        provider: value,
        baseUrl: value === "custom" ? "" : nextInfo?.baseUrl ?? "",
        model: nextModel,
      },
    });
    setEditEndpoint(false);
    setLoadedModels(null);
    setModelNotice(null);
  }

  async function loadModels(openPicker = true) {
    const request = ++modelRequest.current;
    setLoadingModels(true);
    setModelNotice(null);
    try {
      const result = await adminApi.aiModels(patch);
      if (request !== modelRequest.current) return;
      if (result.ok) {
        setLoadedModels(result.models);
        if (openPicker) setModelPickerOpen(true);
      }
      setModelNotice({ ok: result.ok, message: result.message });
    } catch (err) {
      if (request !== modelRequest.current) return;
      setModelNotice({
        ok: false,
        message: err instanceof Error ? err.message : "Could not load models.",
      });
    } finally {
      if (request === modelRequest.current) setLoadingModels(false);
    }
  }

  useEffect(() => {
    const previous = previousApiKey.current;
    previousApiKey.current = apiKeyValue;
    if (!apiKeyValue || apiKeyValue === previous) return;
    setLoadedModels(null);
    setModelNotice(null);
    const timer = setTimeout(() => {
      void loadModels(true);
    }, 700);
    return () => clearTimeout(timer);
  }, [apiKeyValue, currentProvider, baseUrlValue]);

  function usePresetEndpoint() {
    onDraftChange({
      ...draft,
      cleared: draft.cleared.filter((key) => key !== "baseUrl"),
      values: { ...draft.values, baseUrl: info?.baseUrl ?? "" },
    });
    setEditEndpoint(false);
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-fg">
              {state.label}
              <Badge tone={statusTone}>{statusLabel}</Badge>
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
            Test connection
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

      <div className="rounded-xl border border-hairline bg-soft/60 p-3 text-[11px] leading-relaxed text-fg-muted">
        Pick a provider, paste its key, then test the connection and save. Testing uses the
        fields above immediately, even before they are saved, and catches key or model problems
        before the next briefing.
      </div>

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
        {providerField && (
          <Field
            field={providerField}
            draft={draft}
            baseline={baseline}
            disabled={false}
            onChange={chooseProvider}
            onClear={() => undefined}
          />
        )}
        {keyField && (
          <div className="space-y-1.5">
            <Field
              field={{
                ...keyField,
                required: keyRequired,
                hint: info?.keyHint ?? keyField.hint,
              }}
              draft={draft}
              baseline={baseline}
              disabled={!encryptionAvailable}
              onChange={(value) =>
                onDraftChange({
                  ...draft,
                  cleared: draft.cleared.filter((key) => key !== "apiKey"),
                  values: { ...draft.values, apiKey: value },
                })
              }
              onClear={() =>
                onDraftChange({
                  ...draft,
                  cleared: [...draft.cleared.filter((key) => key !== "apiKey"), "apiKey"],
                  values: { ...draft.values, apiKey: "" },
                })
              }
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {info?.keyUrl ? (
                <a
                  href={info.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline"
                >
                  Get a {info.label} key
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : isCustom ? (
                <span className="text-fg-faint">Paste the key issued by your provider.</span>
              ) : (
                <span className="text-fg-faint">No API key is needed for this provider.</span>
              )}
              {info?.docsUrl && (
                <a
                  href={info.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-fg-muted underline-offset-2 hover:underline"
                >
                  Model docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {modelField && (
            <Field
              field={{
                ...modelField,
                placeholder: info
                  ? info.defaultModel ?? "Choose a model"
                  : modelField.placeholder ?? suggestions[0] ?? "",
                hint: info
                  ? info.defaultModel
                    ? `Recommended: ${info.defaultModel}. Leave empty to use it.`
                    : "Choose a model from the provider list."
                  : modelField.hint,
              }}
              draft={draft}
              baseline={baseline}
              disabled={false}
              suggestions={suggestions}
              onChange={(value) =>
                onDraftChange({
                  ...draft,
                  cleared: draft.cleared.filter((key) => key !== "model"),
                  values: { ...draft.values, model: value },
                })
              }
              onClear={() => undefined}
            />
          )}
          <div className="flex flex-wrap items-center gap-2 self-end pb-1">
            <Button
              size="sm"
              variant="secondary"
              icon={<Search className="h-3.5 w-3.5" />}
              onClick={() => {
                if (loadedModels && loadedModels.length > 0) {
                  setModelPickerOpen(true);
                } else {
                  void loadModels(true);
                }
              }}
              disabled={
                loadingModels ||
                (keyRequired && !apiKeyValue && !keyField?.configured) ||
                (isCustom && !baseUrlValue)
              }
            >
              {loadingModels
                ? "Loading models..."
                : loadedModels && loadedModels.length > 0
                  ? "Choose model"
                  : "Load models"}
            </Button>
            <span className="text-[11px] text-fg-faint">
              {loadedModels
                ? `${loadedModels.length} models loaded.`
                : "Fetches the provider model list automatically after the key is entered."}
            </span>
          </div>
        </div>
        {modelNotice && (
          <p className={`text-[11px] ${modelNotice.ok ? "text-success" : "text-danger"}`}>
            {modelNotice.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        {baseUrlField && customEndpoint ? (
          <>
            <Field
              field={{
                ...baseUrlField,
                required: isCustom,
                hint: isCustom
                  ? "Paste the chat-completions base URL from your provider's docs, usually ending in /v1."
                  : "Override the preset endpoint only if the provider requires a different URL.",
              }}
              draft={draft}
              baseline={baseline}
              disabled={false}
              onChange={(value) =>
                onDraftChange({
                  ...draft,
                  cleared: draft.cleared.filter((key) => key !== "baseUrl"),
                  values: { ...draft.values, baseUrl: value },
                })
              }
              onClear={() => undefined}
            />
            {!isCustom && info && (
              <button
                type="button"
                className="text-[11px] font-medium text-accent underline-offset-2 hover:underline"
                onClick={usePresetEndpoint}
              >
                Use the preset endpoint
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft px-3 py-2 text-[11px]">
            <span className="font-medium text-fg-muted">Endpoint</span>
            <code className="min-w-0 flex-1 break-all font-mono text-fg">
              {info?.baseUrl ?? baseUrlValue}
            </code>
            {!isCustom && info && (
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => setEditEndpoint(true)}
              >
                Override endpoint
              </button>
            )}
          </div>
        )}
      </div>

      {(testResult || state.lastTestAt) && (
        <div className="rounded-lg border border-hairline bg-soft px-3 py-2 text-[11px] leading-relaxed">
          {testResult ? (
            <span className={testResult.ok ? "text-success" : "text-danger"}>
              {testResult.ok ? "Connection passed: " : "Connection failed: "}
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

      <ModelPickerModal
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        providerLabel={info?.label ?? "Provider"}
        models={loadedModels ?? []}
        selected={(draft.values.model ?? "").trim()}
        loading={loadingModels}
        notice={modelNotice}
        onRefresh={() => loadModels(false)}
        onSelect={(model) => {
          onDraftChange({
            ...draft,
            cleared: draft.cleared.filter((key) => key !== "model"),
            values: { ...draft.values, model },
          });
          setModelPickerOpen(false);
        }}
      />
    </Card>
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
}) {
  const patch = buildPatch(state, draft, baseline);
  const dirty = isDirty(patch);
  const provider = state.provider;
  const Icon =
    provider === "ctrader" ? Plug : provider === "smtp" ? Mail : Send;

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
            {provider === "ctrader" ? "Check config" : "Test"}
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
            <li>
              Add one of the callback URLs below to the app's redirect URIs. It must match
              exactly; it is derived from the site URL in Site settings.
            </li>
            <li>
              Use a cTrader account that can access the Open API, and wait for cTrader to approve
              the app before expecting real accounts.
            </li>
            <li>
              Save, then run Configuration check. A pass means the authorize endpoint is reachable
              and the fields are shaped correctly; it does not prove that cTrader approval is
              complete or that a user account is enabled for API access.
            </li>
          </ol>
          <p className="rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-fg-muted">
            Troubleshooting: redirect_uri_mismatch means the registered callback differs by even
            one character; invalid_client means the ID/secret pair is wrong; an authorization
            failure usually means the app or account is not approved for Open API yet. If you
            rotate the Client ID or secret, existing user sessions can stop working and each user
            must reconnect.
          </p>
          <div className="space-y-1.5 pt-1">
            <CallbackRow label="Recommended" value={callbacks.primary} />
            <CallbackRow label="Alternate" value={callbacks.api} />
            {!callbacks.primary && (
              <p className="text-[11px] text-fg-faint">
                Set the site URL in Site settings (or open this page through the public domain) to
                see the callback URLs.
              </p>
            )}
          </div>
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
          <div key={field.key} className="space-y-1">
            <Field
              field={field}
              draft={draft}
              baseline={baseline}
              disabled={!encryptionAvailable && field.kind === "secret"}
              onChange={(value) => updateValue(field.key, value)}
              onClear={() => toggleClear(field.key)}
            />
          </div>
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

      {provider === "ctrader" && state.updatedAt && (
        <p className="rounded-lg border border-hairline bg-soft px-2.5 py-2 text-[11px] leading-relaxed text-fg-muted">
          Rotating the Client ID or secret invalidates the app pair users connected with. Ask
          affected users to reconnect after you save a new pair.
        </p>
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
          if (state.provider === "ai") {
            return (
              <AiProviderCard
                key={state.provider}
                state={state}
                draft={draft}
                baseline={baseline}
                encryptionAvailable={data.encryptionAvailable}
                aiProviders={data.aiProviders}
                testResult={testResults[state.provider] ?? null}
                onDraftChange={(next) =>
                  setDrafts((current) => ({ ...current, [state.provider]: next }))
                }
                onSave={() => save(state.provider)}
                onTest={() => test(state.provider)}
              />
            );
          }
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
