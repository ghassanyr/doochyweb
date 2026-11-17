// Personal Trade Journal, shown as the Journal tab inside /trading.
//
// Two kinds of row: entries typed by hand (self-reported P&L) and trades the
// server imported automatically from cTrader closed-deal history (verified P&L).
// There is no import button: the server keeps the log current in the background
// and this page polls, so broker trades simply appear. Notes are the member's
// own layer on top, which is why every row has its own note action.

import { useCallback, useEffect, useState } from "react";
import { Download, NotebookPen, Plus, RefreshCw, StickyNote, Trash2 } from "lucide-react";

import {
  journalApi,
  type JournalEntry,
  type JournalInputPayload,
  type JournalListResponse,
} from "../api";
import { AnimatedModal } from "../components/Modal";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, inputCls, Skeleton } from "../components/ui";
import { formatLocalDateTime } from "../time";

type Filter = { status: string; source: string; symbol: string };

const EMPTY_FILTER: Filter = { status: "", source: "", symbol: "" };
const POLL_MS = 60_000;

export default function JournalPage() {
  const [data, setData] = useState<JournalListResponse | null>(null);
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [noteTarget, setNoteTarget] = useState<JournalEntry | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await journalApi.list({
        status: filter.status,
        source: filter.source,
        symbol: filter.symbol,
        limit: 100,
      });
      setData(result);
      setError(null);
    } catch {
      setError("Could not load your journal.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    // Background imports land without a reload, so keep the tab fresh.
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(
      () => setFilter((current) => ({ ...current, symbol: symbolInput.trim().toUpperCase() })),
      250
    );
    return () => window.clearTimeout(t);
  }, [symbolInput]);

  const exportCsv = useCallback(async () => {
    try {
      const blob = await journalApi.exportCsv(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "doochy-journal.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({ tone: "danger", text: "Could not export the journal." });
    }
  }, [filter]);

  const remove = useCallback(
    async (entry: JournalEntry) => {
      try {
        await journalApi.remove(entry.id);
        await load();
      } catch {
        setNotice({ tone: "danger", text: "Could not delete that entry." });
      }
    },
    [load]
  );

  const openNote = useCallback((entry: JournalEntry) => {
    setNoteTarget(entry);
    setNoteText(entry.note);
    setNoteError(null);
  }, []);

  const saveNote = useCallback(async () => {
    if (!noteTarget) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const result = await journalApi.updateNote(noteTarget.id, noteText.trim());
      setData((current) =>
        current
          ? {
              ...current,
              entries: current.entries.map((row) => (row.id === result.entry.id ? result.entry : row)),
            }
          : current
      );
      setNoteTarget(null);
    } catch (err: any) {
      setNoteError(err?.message || "Could not save that note.");
    } finally {
      setNoteSaving(false);
    }
  }, [noteTarget, noteText]);

  const save = useCallback(
    async (payload: JournalInputPayload) => {
      setSaving(true);
      setFormError(null);
      try {
        if (editing) await journalApi.update(editing.id, payload);
        else await journalApi.create(payload);
        setFormOpen(false);
        setEditing(null);
        await load();
      } catch (err: any) {
        setFormError(err?.message || "Could not save that entry.");
      } finally {
        setSaving(false);
      }
    },
    [editing, load]
  );

  const stats = data?.stats;
  const entries = data?.entries ?? [];
  const synced = data?.lastSyncedAt;

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <NotebookPen className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Trade journal</h3>
            <span className="text-[11px] text-fg-faint">
              {synced
                ? `Closed cTrader and MT5 trades import automatically · last synced ${formatLocalDateTime(synced)}`
                : "Closed cTrader and MT5 trades import automatically once an account is connected."}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void load()}
              >
                Refresh
              </Button>
              <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void exportCsv()}>
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                  setFormOpen(true);
                }}
              >
                New entry
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className={inputCls + " !w-auto min-w-[160px] flex-1 py-1.5"}
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              placeholder="Filter by symbol"
              spellCheck={false}
              aria-label="Filter by symbol"
            />
            <select
              className={inputCls + " !w-auto py-1.5"}
              value={filter.status}
              onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value }))}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <select
              className={inputCls + " !w-auto py-1.5"}
              value={filter.source}
              onChange={(event) => setFilter((current) => ({ ...current, source: event.target.value }))}
              aria-label="Filter by source"
            >
              <option value="">All sources</option>
              <option value="manual">Manual</option>
              <option value="ctrader">cTrader</option>
              <option value="mt5">MT5</option>
            </select>
          </div>

          {notice && (
            <div className="mt-3">
              <Flash tone={notice.tone}>{notice.text}</Flash>
            </div>
          )}
          {error && <p className="mt-3 text-[12.5px] text-danger">{error}</p>}
        </Card>

        {stats && <StatsStrip stats={stats} />}

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6">
              <p className="text-sm font-medium text-fg">No entries yet</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                Add a trade by hand, or wait for the next automatic import: closed cTrader and MT5 deals
                appear here with verified P&amp;L.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Side</th>
                    <th className="px-3 py-2 text-right font-medium">Lots</th>
                    <th className="px-3 py-2 text-right font-medium">Entry</th>
                    <th className="px-3 py-2 text-right font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Closed</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-hairline last:border-0 hover:bg-surface-hover">
                      <td className="px-3 py-2 font-medium text-fg">
                        <button
                          type="button"
                          className="text-left hover:text-accent"
                          onClick={() => {
                            setEditing(entry);
                            setFormError(null);
                            setFormOpen(true);
                          }}
                        >
                          {entry.symbol}
                        </button>
                        {entry.strategy && <div className="text-[10.5px] text-fg-faint">{entry.strategy}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={entry.side === "buy" ? "success" : "danger"}>{entry.side.toUpperCase()}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{entry.lots ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{entry.entryPrice ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{entry.exitPrice ?? "-"}</td>
                      <td
                        className={
                          "px-3 py-2 text-right tabular-nums " +
                          (entry.pnl == null
                            ? "text-fg-faint"
                            : entry.pnl > 0
                              ? "text-success"
                              : entry.pnl < 0
                                ? "text-danger"
                                : "text-fg-muted")
                        }
                      >
                        {entry.pnl == null ? "-" : formatMoney(entry.pnl)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={entry.status === "open" ? "accent" : "muted"}>{entry.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {entry.closedAt ? formatLocalDateTime(entry.closedAt) : "-"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={entry.source === "mt5" ? "accent" : "muted"}>
                            {entry.source === "ctrader" ? "cTrader" : entry.source === "mt5" ? "MT5" : "Manual"}
                          </Badge>
                          <span className="text-[10.5px] text-fg-faint">
                            {entry.verified ? "Verified" : "Self-reported"}
                          </span>
                          {entry.accountLabel && (
                            <span className="max-w-[10rem] truncate text-[10px] text-fg-faint">
                              {entry.accountLabel}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openNote(entry)}
                            aria-label={entry.note ? `Edit note for ${entry.symbol}` : `Add note for ${entry.symbol}`}
                            title={entry.note ? "Edit note" : "Add note"}
                            className={
                              "rounded-md p-1 transition hover:bg-surface-hover " +
                              (entry.note ? "text-accent" : "text-fg-faint hover:text-fg")
                            }
                          >
                            <StickyNote className={"h-3.5 w-3.5 " + (entry.note ? "fill-current" : "")} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(entry)}
                            aria-label={`Delete ${entry.symbol} entry`}
                            className="rounded-md p-1 text-fg-faint transition hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <AnimatedModal
        open={noteTarget != null}
        onClose={() => setNoteTarget(null)}
        title={noteTarget ? `${noteTarget.symbol} note` : "Note"}
        subtitle={
          noteTarget?.verified
            ? "Your own record on an imported trade. Broker prices and P&L stay untouched."
            : "Your own record on this trade."
        }
      >
        <div className="space-y-3">
          {noteError && <Flash tone="danger">{noteError}</Flash>}
          <textarea
            className={inputCls + " min-h-[120px]"}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="What did you see, what did you do, what would you repeat?"
            aria-label="Journal note"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNoteTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={noteSaving} onClick={() => void saveNote()}>
              {noteSaving ? "Saving" : "Save note"}
            </Button>
          </div>
        </div>
      </AnimatedModal>

      <JournalFormModal
        open={formOpen}
        entry={editing}
        saving={saving}
        error={formError}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setFormError(null);
        }}
        onSave={save}
      />
    </FadeRise>
  );
}

function formatMoney(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

function StatsStrip({ stats }: { stats: NonNullable<JournalListResponse["stats"]> }) {
  const items = [
    { label: "Entries", value: String(stats.total) },
    { label: "Open", value: String(stats.open) },
    { label: "Closed", value: String(stats.closed) },
    { label: "Verified", value: String(stats.verified) },
    { label: "Win rate", value: stats.winRate == null ? "-" : `${Math.round(stats.winRate * 100)}%` },
    { label: "Avg P&L", value: stats.avgPnl == null ? "-" : formatMoney(stats.avgPnl) },
    { label: "Total P&L", value: formatMoney(stats.totalPnl) },
    { label: "Profit factor", value: stats.profitFactor == null ? "-" : stats.profitFactor.toFixed(2) },
  ];
  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[10.5px] uppercase tracking-wider text-fg-faint">{item.label}</div>
          <div className="text-sm font-semibold tabular-nums text-fg">{item.value}</div>
        </div>
      ))}
    </Card>
  );
}

const BLANK = {
  symbol: "",
  side: "buy" as "buy" | "sell",
  status: "closed" as "open" | "closed",
  lots: "",
  entryPrice: "",
  exitPrice: "",
  stop: "",
  target: "",
  pnl: "",
  fees: "",
  openedAt: "",
  closedAt: "",
  strategy: "",
  tags: "",
  note: "",
};

type FormState = typeof BLANK;

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function JournalFormModal({
  open,
  entry,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  entry: JournalEntry | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (payload: JournalInputPayload) => void;
}) {
  const [form, setForm] = useState<FormState>(BLANK);

  useEffect(() => {
    if (!open) return;
    setForm(
      entry
        ? {
            symbol: entry.symbol,
            side: entry.side,
            status: entry.status,
            lots: entry.lots?.toString() ?? "",
            entryPrice: entry.entryPrice?.toString() ?? "",
            exitPrice: entry.exitPrice?.toString() ?? "",
            stop: entry.stop?.toString() ?? "",
            target: entry.target?.toString() ?? "",
            pnl: entry.pnl?.toString() ?? "",
            fees: entry.fees?.toString() ?? "",
            openedAt: toLocalInput(entry.openedAt),
            closedAt: toLocalInput(entry.closedAt),
            strategy: entry.strategy,
            tags: entry.tags.join(", "),
            note: entry.note,
          }
        : BLANK
    );
  }, [open, entry]);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  function submit() {
    onSave({
      symbol: form.symbol.trim().toUpperCase(),
      side: form.side,
      status: form.status,
      lots: numberOrNull(form.lots),
      entryPrice: numberOrNull(form.entryPrice),
      exitPrice: numberOrNull(form.exitPrice),
      stop: numberOrNull(form.stop),
      target: numberOrNull(form.target),
      pnl: numberOrNull(form.pnl),
      fees: numberOrNull(form.fees),
      openedAt: form.openedAt ? new Date(form.openedAt).toISOString() : null,
      closedAt: form.status === "open" ? null : form.closedAt ? new Date(form.closedAt).toISOString() : null,
      strategy: form.strategy.trim(),
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      note: form.note.trim(),
    });
  }

  const locked = entry?.verified === true;

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      size="lg"
      title={entry ? "Edit entry" : "New journal entry"}
      subtitle={
        locked
          ? "Imported from cTrader: prices and P&L are broker data. Notes and strategy are yours to edit."
          : "Manual entries carry self-reported P&L."
      }
    >
      <div className="space-y-3">
        {error && <Flash tone="danger">{error}</Flash>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-fg-muted">
            Symbol
            <input className={inputCls + " mt-1"} value={form.symbol} onChange={set("symbol")} placeholder="EURUSD" spellCheck={false} />
          </label>
          <label className="block text-xs text-fg-muted">
            Side
            <select className={inputCls + " mt-1"} value={form.side} onChange={set("side")}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label className="block text-xs text-fg-muted">
            Status
            <select className={inputCls + " mt-1"} value={form.status} onChange={set("status")} disabled={locked}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-fg-muted">
            Lots
            <input className={inputCls + " mt-1"} value={form.lots} onChange={set("lots")} inputMode="decimal" disabled={locked} />
          </label>
          <label className="block text-xs text-fg-muted">
            Entry
            <input className={inputCls + " mt-1"} value={form.entryPrice} onChange={set("entryPrice")} inputMode="decimal" disabled={locked} />
          </label>
          <label className="block text-xs text-fg-muted">
            Exit
            <input className={inputCls + " mt-1"} value={form.exitPrice} onChange={set("exitPrice")} inputMode="decimal" disabled={locked} />
          </label>
          <label className="block text-xs text-fg-muted">
            Stop
            <input className={inputCls + " mt-1"} value={form.stop} onChange={set("stop")} inputMode="decimal" />
          </label>
          <label className="block text-xs text-fg-muted">
            Target
            <input className={inputCls + " mt-1"} value={form.target} onChange={set("target")} inputMode="decimal" />
          </label>
          <label className="block text-xs text-fg-muted">
            Fees
            <input className={inputCls + " mt-1"} value={form.fees} onChange={set("fees")} inputMode="decimal" disabled={locked} />
          </label>
          <label className="block text-xs text-fg-muted">
            P&amp;L
            <input className={inputCls + " mt-1"} value={form.pnl} onChange={set("pnl")} inputMode="decimal" disabled={locked} />
          </label>
          <label className="block text-xs text-fg-muted">
            Opened
            <input type="datetime-local" className={inputCls + " mt-1"} value={form.openedAt} onChange={set("openedAt")} />
          </label>
          <label className="block text-xs text-fg-muted">
            Closed
            <input
              type="datetime-local"
              className={inputCls + " mt-1"}
              value={form.closedAt}
              onChange={set("closedAt")}
              disabled={locked || form.status === "open"}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-fg-muted">
            Strategy
            <input className={inputCls + " mt-1"} value={form.strategy} onChange={set("strategy")} placeholder="Breakout, pullback, reversal" />
          </label>
          <label className="block text-xs text-fg-muted">
            Tags
            <input className={inputCls + " mt-1"} value={form.tags} onChange={set("tags")} placeholder="news, London, A+" />
          </label>
        </div>

        <label className="block text-xs text-fg-muted">
          Note
          <textarea
            className={inputCls + " mt-1 min-h-[80px]"}
            value={form.note}
            onChange={set("note")}
            placeholder="What did you see, what did you do, what would you repeat?"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || !form.symbol.trim()} onClick={submit}>
            {saving ? "Saving" : "Save entry"}
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
