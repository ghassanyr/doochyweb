// Hand Picks: admin-authored market cards shown under Analysis.
//
// The cards mirror Session Analysis (symbol, target, pattern, levels and notes)
// but every field is written by an admin. Reads are public with Analysis; the
// create, edit and delete controls only render for an admin and the server
// enforces the same rule.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import {
  handPicksApi,
  type HandPick,
  type HandPickInput,
  type HandPickLevelType,
} from "../api";
import { AnimatedModal, ConfirmModal } from "../components/Modal";
import { Button, Card, Flash, Skeleton, inputCls } from "../components/ui";
import { LevelIcon, MetaRow } from "./SessionAnalysisShared";

interface FormValues {
  symbol: string;
  pattern: string;
  targetLevel: string;
  targetPeriod: string;
  interval: string;
  identifiedAt: string;
  reason: string;
  supportingText: string;
  levelType: "" | HandPickLevelType;
  levelValue: string;
  levelNote: string;
  chartHtml: string;
}

function emptyForm(): FormValues {
  return {
    symbol: "",
    pattern: "",
    targetLevel: "",
    targetPeriod: "",
    interval: "",
    identifiedAt: "",
    reason: "",
    supportingText: "",
    levelType: "",
    levelValue: "",
    levelNote: "",
    chartHtml: "",
  };
}

function chartshotUrl(value: string): string | null {
  const source = value.trim();
  if (!source) return null;
  const html = source.match(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/i);
  const candidate = (html?.[1] ?? source).trim();
  const image = candidate.match(/^https:\/\/img\.chartshots\.net\/([A-Za-z0-9_-]{6,64})\.png(?:\?.*)?$/i);
  if (image) return `https://img.chartshots.net/${image[1]}.png`;
  const shot = candidate.match(
    /^https:\/\/(?:chartshots\.spotware\.com|ctrader\.chartshots\.net)\/c\/([A-Za-z0-9_-]{6,64})(?:\?.*)?$/i
  );
  return shot ? `https://img.chartshots.net/${shot[1]}.png` : null;
}

function chartshotPageUrl(url: string): string {
  const id = url.match(/\/([A-Za-z0-9_-]{6,64})\.png$/)?.[1];
  return id ? `https://chartshots.spotware.com/c/${id}` : url;
}

function formFromPick(pick: HandPick): FormValues {
  return {
    symbol: pick.symbol,
    pattern: pick.pattern ?? "",
    targetLevel: pick.targetLevel ?? "",
    targetPeriod: pick.targetPeriod ?? "",
    interval: pick.interval ?? "",
    identifiedAt: pick.identifiedAt ?? "",
    reason: pick.reason ?? "",
    supportingText: pick.supporting.join("\n"),
    levelType: pick.levelType ?? "",
    levelValue: pick.levelValue ?? "",
    levelNote: pick.levelNote ?? "",
    chartHtml: pick.chartUrl ? `<img src="${pick.chartUrl}">` : "",
  };
}

function inputFromForm(form: FormValues, chartUrl: string | null): HandPickInput {
  const nullable = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  return {
    symbol: form.symbol.trim(),
    pattern: nullable(form.pattern),
    targetLevel: nullable(form.targetLevel),
    targetPeriod: nullable(form.targetPeriod),
    interval: nullable(form.interval),
    identifiedAt: nullable(form.identifiedAt),
    reason: nullable(form.reason),
    supporting: form.supportingText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    levelType: form.levelType || null,
    levelValue: nullable(form.levelValue),
    levelNote: nullable(form.levelNote),
    chartUrl,
  };
}

export function HandPicks({ isAdmin }: { isAdmin: boolean }) {
  const [picks, setPicks] = useState<HandPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HandPick | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HandPick | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await handPicksApi.list();
      setPicks(result.picks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Hand Picks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(pick: HandPick) {
    setEditing(pick);
    setFormOpen(true);
  }

  function handleSaved(pick: HandPick) {
    setPicks((current) => {
      const exists = current.some((entry) => entry.id === pick.id);
      return exists
        ? current.map((entry) => (entry.id === pick.id ? pick : entry))
        : [pick, ...current];
    });
    setFlash("Hand pick saved.");
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await handPicksApi.remove(pendingDelete.id);
      setPicks((current) => current.filter((entry) => entry.id !== pendingDelete.id));
      setFlash("Hand pick deleted.");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the hand pick.");
      throw err;
    }
  }

  // Public readers should not see an empty section or a red error block at the
  // bottom of Analysis. Admins always see the section so they can add a pick.
  if (!isAdmin && picks.length === 0) return null;

  return (
    <section className="space-y-3 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-accent">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold tracking-tight text-fg">Hand Picks</h2>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            Setups picked by hand, with the reasoning behind each one.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openNew}>
            Add pick
          </Button>
        )}
      </div>

      {flash && <Flash tone="success">{flash}</Flash>}

      {error && (
        <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertCircle className="mr-2 inline h-4 w-4 align-[-3px]" />
          {error}
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="overflow-hidden">
              <div className="space-y-2 border-b border-hairline px-4 py-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-32" />
              </div>
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </Card>
          ))}
        </div>
      ) : picks.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="mt-3 text-sm text-fg-muted">No hand picks yet.</div>
          <div className="mt-1 text-xs text-fg-faint">
            Add the first pick to show it here on Analysis.
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {picks.map((pick) => (
            <HandPickCard
              key={pick.id}
              pick={pick}
              isAdmin={isAdmin}
              onEdit={openEdit}
              onDelete={(entry) => {
                setDeleteError(null);
                setPendingDelete(entry);
              }}
            />
          ))}
        </div>
      )}

      {picks.length > 0 && (
        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Selected by hand. Not financial advice.
        </p>
      )}

      <HandPickFormModal
        open={formOpen}
        pick={editing}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      <ConfirmModal
        open={!!pendingDelete}
        title="Delete hand pick"
        body={
          <div className="space-y-2">
            <p>
              Remove <span className="font-medium text-fg">{pendingDelete?.symbol}</span> from Hand
              Picks? This cannot be undone.
            </p>
            {deleteError && <Flash tone="danger">{deleteError}</Flash>}
          </div>
        }
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onClose={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}

function HandPickCard({
  pick,
  isAdmin,
  onEdit,
  onDelete,
}: {
  pick: HandPick;
  isAdmin: boolean;
  onEdit: (pick: HandPick) => void;
  onDelete: (pick: HandPick) => void;
}) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-fg">
            {pick.symbol}
          </h3>
          <p className="mt-0.5 text-[11px] text-fg-faint">Target Level</p>
          <p className="tabular-nums text-xl font-semibold tracking-tight text-fg">
            {pick.targetLevel || "Not stated"}
          </p>
        </div>
        {pick.pattern && (
          <span className="shrink-0 rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
            {pick.pattern}
          </span>
        )}
      </div>

      {pick.chartUrl && (
        <a
          href={chartshotPageUrl(pick.chartUrl)}
          target="_blank"
          rel="noreferrer"
          className="block border-b border-hairline bg-canvas/50"
          title="Open chartshot"
        >
          <img
            src={pick.chartUrl}
            alt={`${pick.symbol} chartshot`}
            className="w-full object-contain"
            loading="lazy"
          />
        </a>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <MetaRow label="Target Period" value={pick.targetPeriod} />
          <MetaRow label="Interval" value={pick.interval} />
          <MetaRow label="Pattern" value={pick.pattern} />
          <MetaRow label="Identified" value={pick.identifiedAt} />
        </div>

        {pick.reason && (
          <p className="text-[12.5px] leading-relaxed text-fg-muted">{pick.reason}</p>
        )}

        {pick.supporting.length > 0 && (
          <div className="space-y-1">
            {pick.supporting.map((line) => (
              <p key={line} className="text-[12px] leading-relaxed text-fg-muted">
                {line}
              </p>
            ))}
          </div>
        )}

        {pick.levelType && (
          <div className="mt-auto rounded-lg border border-hairline bg-canvas/50 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
              <LevelIcon type={pick.levelType} />
              {pick.levelType === "support" ? "Support" : "Resistance"}
            </div>
            <div className="tabular-nums text-[13px] font-medium text-fg">
              {pick.levelValue || "Not stated"}
            </div>
            {pick.levelNote && (
              <div className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
                {pick.levelNote}
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="mt-auto flex items-center justify-end gap-1 border-t border-hairline pt-3">
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => onEdit(pick)}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => onDelete(pick)}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function HandPickFormModal({
  open,
  pick,
  onClose,
  onSaved,
}: {
  open: boolean;
  pick: HandPick | null;
  onClose: () => void;
  onSaved: (pick: HandPick) => void;
}) {
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(pick ? formFromPick(pick) : emptyForm());
    setError(null);
  }, [open, pick]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setError(null);
    try {
      const chartUrl = chartshotUrl(form.chartHtml);
      if (form.chartHtml.trim() && !chartUrl) {
        setError("Paste a valid cTrader chartshot HTML code.");
        return;
      }
      const input = inputFromForm(form, chartUrl);
      const result = pick
        ? await handPicksApi.update(pick.id, input)
        : await handPicksApi.create(input);
      onSaved(result.pick);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the hand pick.");
    }
  }

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      size="lg"
      title={pick ? "Edit hand pick" : "New hand pick"}
      subtitle="Shown in the Hand Picks section on Analysis as soon as it is saved."
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Symbol"
            value={form.symbol}
            onChange={(value) => update("symbol", value)}
            placeholder="BTCUSD"
            maxLength={60}
          />
          <Field
            label="Pattern"
            value={form.pattern}
            onChange={(value) => update("pattern", value)}
            placeholder="Falling Wedge"
          />
          <Field
            label="Target level"
            value={form.targetLevel}
            onChange={(value) => update("targetLevel", value)}
            placeholder="63564.0977"
          />
          <Field
            label="Target period"
            value={form.targetPeriod}
            onChange={(value) => update("targetPeriod", value)}
            placeholder="2 days"
          />
          <Field
            label="Interval"
            value={form.interval}
            onChange={(value) => update("interval", value)}
            placeholder="4 hour"
          />
          <Field
            label="Identified"
            value={form.identifiedAt}
            onChange={(value) => update("identifiedAt", value)}
            placeholder="17-Nov-06:00"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Level type</span>
            <select
              className={inputCls}
              value={form.levelType}
              onChange={(event) =>
                update("levelType", event.target.value as FormValues["levelType"])
              }
            >
              <option value="">None</option>
              <option value="support">Support</option>
              <option value="resistance">Resistance</option>
            </select>
          </label>
          <Field
            label="Level value"
            value={form.levelValue}
            onChange={(value) => update("levelValue", value)}
            placeholder="64251.6914"
          />
        </div>

        <Field
          label="Level note"
          value={form.levelNote}
          onChange={(value) => update("levelNote", value)}
          placeholder="Latest turning point"
        />

        <Field
          label="Chartshot HTML"
          value={form.chartHtml}
          onChange={(value) => update("chartHtml", value)}
          placeholder="<img src='https://img.chartshots.net/6aff343d0d547.png'>"
          hint="Paste the HTML code from cTrader. Only cTrader chartshot images are shown."
          textarea
        />

        <Field
          label="Reason"
          value={form.reason}
          onChange={(value) => update("reason", value)}
          placeholder="Why this setup matters"
          textarea
        />

        <Field
          label="Supporting lines"
          value={form.supportingText}
          onChange={(value) => update("supportingText", value)}
          placeholder={"Supported by a rising moving average\nVolume confirms the move"}
          hint="One line per bullet."
          textarea
        />

        {error && <Flash tone="danger">{error}</Flash>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClickAsync={save}
            disabled={!form.symbol.trim()}
          >
            {pick ? "Save changes" : "Add pick"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  textarea = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  textarea?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {textarea ? (
        <textarea
          className={`${inputCls} min-h-[88px] resize-y`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      ) : (
        <input
          className={inputCls}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      )}
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}
