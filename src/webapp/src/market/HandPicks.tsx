// Hand Picks: admin-authored market cards shown on their own Analysis page.
//
// The cards mirror Session Analysis (symbol, target, pattern, levels and notes)
// but every field is written by an admin. Reads are public with Analysis; the
// create, edit and delete controls only render for an admin and the server
// enforces the same rule.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Pencil, Plus, Search, Sparkles, Trash2, Upload } from "lucide-react";

import {
  ApiError,
  handPicksApi,
  marketApi,
  telegramApi,
  type HandPick,
  type HandPickInput,
  type HandPickLevelType,
  type HandPickStats,
  type TelegramStatus,
} from "../api";
import { AnimatedModal, ConfirmModal } from "../components/Modal";
import { Badge, Button, Card, Flash, Skeleton, Toggle, inputCls } from "../components/ui";
import { filterHandPickSymbols, formatHandPickIdentified } from "./handPickForm";
import { LevelIcon, MetaRow } from "./SessionAnalysisShared";
import type { CatalogEntry } from "./types";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_KB = 500;
const MAX_IMAGE_BYTES = MAX_IMAGE_KB * 1024;

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
  imageUrl: string;
}

function emptyForm(): FormValues {
  return {
    symbol: "",
    pattern: "",
    targetLevel: "",
    targetPeriod: "",
    interval: "",
    identifiedAt: formatHandPickIdentified(),
    reason: "",
    supportingText: "",
    levelType: "",
    levelValue: "",
    levelNote: "",
    imageUrl: "",
  };
}

function readImageFile(
  file: File | undefined,
  onValue: (value: string) => void,
  onError: (message: string | null) => void
) {
  if (!file) return;
  onError(null);
  if (!IMAGE_TYPES.includes(file.type)) {
    onError("Image must be a PNG, JPEG, WebP or GIF.");
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    onError(`Image must be ${MAX_IMAGE_KB} KB or smaller.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") onValue(reader.result);
  };
  reader.onerror = () => onError("Could not read that image.");
  reader.readAsDataURL(file);
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
    imageUrl: pick.chartUrl ?? "",
  };
}

function inputFromForm(form: FormValues): HandPickInput {
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
    chartUrl: form.imageUrl.trim() || null,
  };
}

export function HandPicks({ isAdmin }: { isAdmin: boolean }) {
  const [picks, setPicks] = useState<HandPick[]>([]);
  const [stats, setStats] = useState<HandPickStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HandPick | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HandPick | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<HandPick | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

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

  const loadStats = useCallback(async () => {
    try {
      setStats(await handPicksApi.stats());
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadStats();
    const timer = setInterval(() => {
      void (async () => {
        try {
          const [list, nextStats] = await Promise.all([handPicksApi.list(), handPicksApi.stats()]);
          setPicks(list.picks);
          setStats(nextStats);
        } catch {
          return;
        }
      })();
    }, 60_000);
    return () => clearInterval(timer);
  }, [load, loadStats]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let alive = true;
    telegramApi
      .status()
      .then((status) => {
        if (alive) setTelegram(status);
      })
      .catch((err) => {
        if (!alive || (err instanceof ApiError && err.status === 401)) return;
        setTelegramError(err instanceof Error ? err.message : "Could not load Telegram status.");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function toggleHandPickNotifications(next: boolean) {
    if (!telegram?.linked) return;
    setTelegramBusy(true);
    setTelegramError(null);
    try {
      const result = await telegramApi.setPrefs({ handPickNotificationsEnabled: next });
      setTelegram((current) =>
        current
          ? { ...current, handPickNotificationsEnabled: result.handPickNotificationsEnabled }
          : current
      );
      setFlash(next ? "Hand pick notifications on." : "Hand pick notifications off.");
    } catch (err) {
      setTelegramError(
        err instanceof Error ? err.message : "Could not update hand pick notifications."
      );
    } finally {
      setTelegramBusy(false);
    }
  }

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
    void loadStats();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await handPicksApi.remove(pendingDelete.id);
      setPicks((current) => current.filter((entry) => entry.id !== pendingDelete.id));
      setFlash("Hand pick deleted.");
      void loadStats();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the hand pick.");
      throw err;
    }
  }

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
        <div className="flex flex-wrap items-center gap-3">
          {telegram && (
            <div className="flex flex-col items-start gap-0.5">
              <Toggle
                label="Hand pick alerts"
                checked={telegram.linked && telegram.handPickNotificationsEnabled}
                onToggle={toggleHandPickNotifications}
                disabled={
                  !telegram.linked ||
                  !telegram.enabled ||
                  !telegram.notificationsEnabled ||
                  telegramBusy
                }
              />
              <span className="text-[11px] text-fg-faint">
                {!telegram.linked
                  ? "Link Telegram in Settings."
                  : !telegram.notificationsEnabled
                    ? "Telegram notifications are paused."
                    : "Message me when a pick is added or changed."}
              </span>
            </div>
          )}
          {isAdmin && (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openNew}>
              Add pick
            </Button>
          )}
        </div>
      </div>

      {flash && <Flash tone="success">{flash}</Flash>}

      {stats && <HandPickStatsStrip stats={stats} />}

      {telegramError && <p className="text-xs text-danger">{telegramError}</p>}

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
              onView={setViewing}
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

      <AnimatedModal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        title={`${viewing?.symbol ?? "Hand pick"} image`}
      >
        {viewing?.chartUrl && (
          <img
            src={viewing.chartUrl}
            alt={`${viewing.symbol} hand pick image`}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
      </AnimatedModal>
    </section>
  );
}

function HandPickCard({
  pick,
  isAdmin,
  onEdit,
  onView,
  onDelete,
}: {
  pick: HandPick;
  isAdmin: boolean;
  onEdit: (pick: HandPick) => void;
  onView: (pick: HandPick) => void;
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {pick.pattern && (
            <span className="rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
              {pick.pattern}
            </span>
          )}
          <Badge
            tone={pick.outcome === "went_as_expected" ? "success" : "muted"}
          >
            <span title={pick.outcomeAt ?? undefined}>
              {pick.outcome === "went_as_expected" ? "Went as expected" : "Awaiting target"}
            </span>
          </Badge>
        </div>
      </div>

      {pick.chartUrl && (
        <button
          type="button"
          onClick={() => onView(pick)}
          className="block w-full border-b border-hairline bg-canvas/50 transition hover:bg-soft"
          aria-label={`View ${pick.symbol} image`}
          title="View image"
        >
          <img
            src={pick.chartUrl}
            alt={`${pick.symbol} hand pick image`}
            className="h-48 w-full object-cover"
            loading="lazy"
          />
        </button>
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
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState(-1);
  const symbolRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(pick ? formFromPick(pick) : emptyForm());
    setError(null);
    setSymbolOpen(false);
    setActiveSymbol(-1);
  }, [open, pick]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    marketApi
      .config()
      .then((config) => {
        if (alive) setCatalog(config.catalog);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!symbolOpen) return;
    function onDocDown(event: MouseEvent) {
      if (!symbolRef.current?.contains(event.target as Node)) setSymbolOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [symbolOpen]);

  const symbolSuggestions = useMemo(
    () => filterHandPickSymbols(catalog, form.symbol),
    [catalog, form.symbol]
  );

  useEffect(() => {
    setActiveSymbol(-1);
  }, [form.symbol]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseSymbol(symbol: string) {
    update("symbol", symbol);
    setSymbolOpen(false);
    setActiveSymbol(-1);
  }

  function onSymbolKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSymbolOpen(false);
      return;
    }
    if (!symbolOpen || symbolSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSymbol((index) => (index + 1) % symbolSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSymbol((index) =>
        index <= 0 ? symbolSuggestions.length - 1 : index - 1
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseSymbol(symbolSuggestions[activeSymbol >= 0 ? activeSymbol : 0].symbol);
    }
  }

  async function save() {
    setError(null);
    try {
      if (!form.imageUrl.trim()) {
        setError("Upload or paste an image.");
        return;
      }
      const input = inputFromForm(form);
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
    >
      <div
        className="space-y-3"
        onPaste={(event) => {
          const item = Array.from(event.clipboardData.items).find((entry) =>
            entry.type.startsWith("image/")
          );
          const file = item?.getAsFile();
          if (!file) return;
          event.preventDefault();
          readImageFile(file, (value) => update("imageUrl", value), setError);
        }}
      >
        <ImageField
          label="Upload or paste image"
          required
          value={form.imageUrl}
          onChange={(value) => update("imageUrl", value)}
          onError={setError}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <span className="text-xs font-medium text-fg-muted">
              Symbol<span className="ml-0.5 text-danger">*</span>
            </span>
            <div ref={symbolRef}>
              <Search className="pointer-events-none absolute left-3 top-[27px] h-3.5 w-3.5 text-fg-faint" />
              <input
                className={`${inputCls} py-1.5 pl-8`}
                value={form.symbol}
                onChange={(event) => {
                  update("symbol", event.target.value);
                  setSymbolOpen(true);
                }}
                onFocus={() => setSymbolOpen(true)}
                onBlur={() => window.setTimeout(() => setSymbolOpen(false), 150)}
                onKeyDown={onSymbolKeyDown}
                role="combobox"
                aria-expanded={symbolOpen && !!form.symbol.trim()}
                aria-controls="hand-pick-symbol-suggestions"
                aria-autocomplete="list"
                aria-label="Symbol"
                placeholder="BTCUSD"
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
              />
              {symbolOpen && !!form.symbol.trim() && (
                <ul
                  id="hand-pick-symbol-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-60 overflow-y-auto rounded-lg border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface py-1 shadow-overlay"
                >
                  {symbolSuggestions.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-fg-muted">
                      {catalog.length === 0 ? "No symbols in the catalog" : "No matching symbols"}
                    </li>
                  ) : (
                    symbolSuggestions.map((entry, index) => (
                      <li key={entry.symbol}>
                        <button
                          type="button"
                          onMouseEnter={() => setActiveSymbol(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseSymbol(entry.symbol)}
                          className={
                            "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition " +
                            (index === activeSymbol
                              ? "bg-accent-soft text-accent"
                              : "text-fg hover:bg-surface-hover")
                          }
                        >
                          <span className="font-semibold">{entry.symbol}</span>
                          <span className="truncate text-[11px] text-fg-faint">{entry.name}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </label>
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
            placeholder="17:39:09 (UTC+00:00) on Nov 19th, 2026"
            hint="Filled with the current time, but editable."
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
            disabled={!form.levelType}
          />
        </div>

        <Field
          label="Level note"
          value={form.levelNote}
          onChange={(value) => update("levelNote", value)}
          placeholder="Latest turning point"
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
            disabled={!form.imageUrl.trim() || !form.symbol.trim()}
          >
            {pick ? "Save changes" : "Add pick"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function HandPickStatsStrip({ stats }: { stats: HandPickStats }) {
  const items = [
    { label: "Total", value: stats.total },
    { label: "Went as expected", value: stats.expected },
    { label: "Awaiting target", value: stats.pending },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft/50 px-3 py-2">
      {items.map((item) => (
        <Badge key={item.label} tone={item.label === "Went as expected" ? "success" : "muted"}>
          {item.label} <span className="tabular-nums opacity-70">{item.value}</span>
        </Badge>
      ))}
      {stats.total > 0 && (
        <span className="ml-auto text-[11px] text-fg-muted">
          Hit rate{" "}
          <span className="font-semibold text-fg">
            {stats.hitRate == null ? "-" : `${Math.round(stats.hitRate * 100)}%`}
          </span>
        </span>
      )}
    </div>
  );
}

function ImageField({
  label,
  value,
  onChange,
  onError,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onError: (message: string | null) => void;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas/50 px-3 py-2">
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(event) => {
            readImageFile(event.target.files?.[0], onChange, onError);
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload className="h-3.5 w-3.5" />}
          onClick={() => inputRef.current?.click()}
        >
          Upload image
        </Button>
        <span className="text-[11px] text-fg-faint">Or press Ctrl+V to paste an image.</span>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>
      {value && (
        <img
          src={value}
          alt="Selected hand pick image"
          className="max-h-48 w-full rounded-lg border border-hairline object-contain"
        />
      )}
      <span className="block text-[11px] text-fg-faint">
        PNG, JPEG, WebP or GIF up to {MAX_IMAGE_KB} KB.
      </span>
    </div>
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
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  textarea?: boolean;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
}) {
  const classes = `${inputCls} disabled:cursor-not-allowed disabled:bg-soft disabled:text-fg-faint disabled:opacity-60`;
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {textarea ? (
        <textarea
          className={`${classes} min-h-[88px] resize-y`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
        />
      ) : (
        <input
          className={classes}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
        />
      )}
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}
