import { useEffect, useMemo, useState } from "react";

import { ApiError, signalsApi } from "../api";
import { AnimatedModal } from "../components/Modal";
import { Button, inputCls } from "../components/ui";
import type { CatalogEntry } from "../market/types";
import { formatLocalDateTime } from "../time";
import { EXPIRY_PRESETS, computeRR, expiryIsoForPreset, fmtRR } from "./signalFormat";
import type { ExpiryPresetId } from "./signalFormat";
import type { Signal, SignalDirection } from "./types";

type ExpiryChoice = ExpiryPresetId | "none" | "keep";

export function SignalFormModal({
  open,
  signal,
  catalog,
  timeframes,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null creates; a signal edits it. */
  signal: Signal | null;
  catalog: CatalogEntry[];
  timeframes: { id: string; label: string }[];
  onClose: () => void;
  onSaved: (signal: Signal) => void;
}) {
  const editing = !!signal;
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<SignalDirection>("buy");
  const [entry, setEntry] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [note, setNote] = useState("");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("none");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);

  // Reset whenever the modal opens, so a previous edit never leaks into a new
  // create form.
  useEffect(() => {
    if (!open) return;
    setSymbol(signal?.symbol ?? "");
    setDirection(signal?.direction ?? "buy");
    setEntry(signal?.entry != null ? String(signal.entry) : "");
    setTarget(signal ? String(signal.target) : "");
    setStop(signal ? String(signal.stop) : "");
    setTimeframe(signal?.timeframe ?? "");
    setNote(signal?.note ?? "");
    setExpiryChoice(signal?.expiresAt ? "keep" : "none");
    setError(null);
    setConflict(false);
    setSymbolOpen(false);
  }, [open, signal]);

  const entryNum = entry.trim() === "" ? null : Number(entry);
  const targetNum = Number(target);
  const stopNum = Number(stop);
  const rr = computeRR(entryNum, targetNum, stopNum);
  const selectedExpiryLabel =
    expiryChoice !== "none" && expiryChoice !== "keep"
      ? (EXPIRY_PRESETS.find((p) => p.id === expiryChoice)?.label ?? null)
      : null;

  const suggestions = useMemo(() => {
    const q = symbol.trim().toUpperCase();
    if (!q) return [];
    return catalog
      .filter((c) => c.symbol.includes(q) || c.name.toUpperCase().includes(q))
      .sort((a, b) => {
        const as = a.symbol.startsWith(q) ? 0 : 1;
        const bs = b.symbol.startsWith(q) ? 0 : 1;
        return as - bs || a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 6);
  }, [catalog, symbol]);

  function localError(): string | null {
    if (!symbol.trim()) return "Symbol is required.";
    if (!Number.isFinite(targetNum) || targetNum <= 0) return "Target must be a positive number.";
    if (!Number.isFinite(stopNum) || stopNum <= 0) return "Stop must be a positive number.";
    if (targetNum === stopNum) return "Target and stop must be different.";
    if (direction === "buy" && !(targetNum > stopNum)) return "For a buy, target must be above stop.";
    if (direction === "sell" && !(targetNum < stopNum)) return "For a sell, target must be below stop.";
    if (entryNum !== null) {
      if (!Number.isFinite(entryNum) || entryNum <= 0) return "Entry must be a positive number.";
      if (direction === "buy" && !(stopNum < entryNum && entryNum < targetNum)) {
        return "For a buy, stop must be below entry and entry below target.";
      }
      if (direction === "sell" && !(targetNum < entryNum && entryNum < stopNum)) {
        return "For a sell, target must be below entry and entry below stop.";
      }
    }
    return null;
  }

  async function submit(force = false): Promise<void> {
    const local = localError();
    if (local) {
      setError(local);
      return;
    }
    setError(null);
    const expiresAt =
      expiryChoice === "keep"
        ? (signal?.expiresAt ?? null)
        : expiryChoice === "none"
          ? null
          : expiryIsoForPreset(expiryChoice);
    const payload = {
      symbol: symbol.trim().toUpperCase(),
      direction,
      entry: entryNum,
      target: targetNum,
      stop: stopNum,
      timeframe: timeframe || null,
      note,
      expiresAt,
    };
    try {
      const result = signal
        ? await signalsApi.update(signal.id, payload)
        : await signalsApi.create({ ...payload, force });
      onSaved(result.signal);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not save the signal.");
    }
  }

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${signal?.symbol}` : "New signal"}
      subtitle={editing ? "Changes are published immediately." : "Published immediately to the public feed."}
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="relative block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">Symbol</span>
            <input
              className={inputCls}
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value);
                setSymbolOpen(true);
              }}
              onFocus={() => setSymbolOpen(true)}
              onBlur={() => window.setTimeout(() => setSymbolOpen(false), 150)}
              placeholder="XAUUSD"
              spellCheck={false}
              autoComplete="off"
            />
            {symbolOpen && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-lg border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface py-1 shadow-overlay">
                {suggestions.map((c) => (
                  <li key={c.symbol}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSymbol(c.symbol);
                        setSymbolOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover"
                    >
                      <span className="font-semibold">{c.symbol}</span>
                      <span className="truncate text-[11px] text-fg-faint">{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">Direction</span>
            <div className="flex rounded-lg border border-hairline-strong bg-soft p-[3px]">
              {(["buy", "sell"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  className={
                    "h-8 flex-1 rounded-md text-xs font-semibold uppercase tracking-wide transition " +
                    (direction === d
                      ? d === "buy"
                        ? "bg-success-soft text-success"
                        : "bg-danger-soft text-danger"
                      : "text-fg-muted hover:text-fg")
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Entry (optional)" value={entry} onChange={setEntry} placeholder="2400.00" />
          <NumberField label="Target" value={target} onChange={setTarget} placeholder="2450.00" />
          <NumberField label="Stop" value={stop} onChange={setStop} placeholder="2380.00" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-muted">Timeframe (optional)</span>
            <select className={inputCls} value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="">-</option>
              {timeframes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">Expiry (optional)</span>
            <div className="grid grid-cols-5 gap-1.5">
              {EXPIRY_PRESETS.map((preset) => {
                const active = expiryChoice === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setExpiryChoice(preset.id)}
                    aria-pressed={active}
                    className={
                      "h-8 rounded-md border text-[11px] font-semibold transition " +
                      (active
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-hairline-strong bg-soft text-fg-muted hover:bg-surface-hover hover:text-fg")
                    }
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-fg-faint">
                {expiryChoice === "keep" && signal?.expiresAt
                  ? `Current expiry ${formatLocalDateTime(signal.expiresAt)}`
                  : selectedExpiryLabel
                    ? `Expires ${selectedExpiryLabel} after publish`
                    : "No expiry"}
              </span>
              {expiryChoice !== "none" && (
                <button
                  type="button"
                  onClick={() => setExpiryChoice("none")}
                  className="shrink-0 text-fg-muted hover:text-fg"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Note</span>
          <textarea
            className={inputCls + " min-h-[84px] resize-y"}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this idea, key levels, invalidation context…"
          />
        </label>

        <div className="flex items-center justify-between rounded-lg border border-hairline bg-soft/60 px-3 py-2 text-xs">
          <span className="text-fg-muted">Reward-to-risk</span>
          <span className="font-semibold tabular-nums text-fg">{fmtRR(rr)}</span>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            <p>{error}</p>
            {conflict && !editing && (
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="danger" onClickAsync={() => submit(true)}>
                  Create anyway
                </Button>
                <span className="text-[11px] text-fg-muted">
                  The existing active signal will stay as-is.
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClickAsync={() => submit(false)}>
            {editing ? "Save changes" : "Publish signal"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
