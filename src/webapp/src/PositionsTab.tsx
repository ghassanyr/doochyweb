import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Megaphone, Plus, RefreshCw, XOctagon } from "lucide-react";
import { AccountView, ApiError, PositionRow, api } from "./api";
import { ViewMode, fmtLots, fmtMoney, fmtPrice } from "./Dashboard";
import FilterBar, {
  applyFilter,
  FilterPatch,
  FilterState,
  loadFilter,
  saveFilter,
  sortRows,
  uniqueSymbols,
} from "./FilterBar";
import { AccountChip, Badge, BareInput, Button, Card, Chevron, Collapse, Field, Flash, Skeleton } from "./components/ui";
import { FadeRise, Stagger, StaggerItem } from "./components/motion";
import { ConfirmModal } from "./components/Modal";
import { PublishSignalModal } from "./signals/PublishSignalModal";
import type { SignalDraft } from "./signals/types";
import OrderTicket from "./trading/OrderTicket";
import { num } from "./trading/ui";

const POLL_MS = 8000;

function heldFor(openTime: number | null): string {
  if (!openTime) return "-";
  const ms = Date.now() - openTime;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtNetUsd(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "-";
  return `${n >= 0 ? "+" : ""}${fmtMoney(n)}`;
}

function netTone(n: number | null | undefined): string {
  if (n == null) return "text-fg";
  return n >= 0 ? "text-success" : "text-danger";
}

export default function PositionsTab({
  mode,
  accounts,
  ctid,
  isLive,
  isAdmin,
}: {
  mode: ViewMode;
  accounts: AccountView[];
  ctid: number | null;
  isLive: boolean;
  /** Only admins can publish signals. */
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => loadFilter(false));
  const timer = useRef<number | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [closePos, setClosePos] = useState<PositionRow | null>(null);
  // Only one card is expanded at a time; the poll must never collapse it or
  // clobber half-typed SL/TP, so expansion lives here keyed by position.
  const [openId, setOpenId] = useState<number | null>(null);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [publishDraft, setPublishDraft] = useState<SignalDraft | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!publishNotice) return;
    const id = window.setTimeout(() => setPublishNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [publishNotice]);

  const rowCtid = useCallback((p: PositionRow): number => p.account?.ctid ?? ctid ?? 0, [ctid]);

  const patchFilters = useCallback((p: FilterPatch) => {
    setFilters((f) => {
      const next = { ...f, ...p };
      saveFilter(false, next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      if (mode === "combined") {
        const settled = await Promise.all(
          accounts.map(async (a) => {
            try {
              const { positions } = await api.positions(a.ctid);
              const acct = { ctid: a.ctid, login: a.login, isLive: a.isLive, nickname: a.nickname, color: a.color };
              return positions.map((p) => ({ ...p, account: acct })) as PositionRow[];
            } catch {
              return null;
            }
          })
        );
        const merged = settled.flat(1).filter((b): b is PositionRow => b !== null);
        setRows(merged);
        setError(
          accounts.length > 0 && merged.length === 0 && settled.every((b) => b === null)
            ? "Failed to load positions"
            : null
        );
      } else if (ctid != null) {
        const { positions } = await api.positions(ctid);
        setRows(positions);
        setError(null);
      }
      setLastUpdated(Date.now());
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [mode, accounts, ctid]);

  const closeSubmit = useCallback(async () => {
    if (!closePos) return;
    setCloseErr(null);
    try {
      await api.closePosition(rowCtid(closePos), closePos.positionId);
      setClosePos(null);
      load();
    } catch (e: any) {
      setCloseErr(e?.message || "Close failed");
      throw e;
    }
  }, [closePos, rowCtid, load]);

  useEffect(() => {
    setLoading(true);
    load();
    timer.current = window.setInterval(load, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const combined = mode === "combined";
  const shown = applyFilter(rows, filters);
  const sorted = sortRows(shown, filters.sortKey, filters.sortAsc);
  const symbols = useMemo(() => uniqueSymbols(rows), [rows]);

  const accountLabel = selectedLabel(accounts, ctid);

  const totalPnl = useMemo(() => {
    let sum = 0;
    let hasAny = false;
    for (const r of shown) {
      if (r.netUsd != null) {
        sum += r.netUsd;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [shown]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={combined ? "muted" : isLive ? "accent" : "muted"}>
            {combined ? "ALL" : isLive ? "LIVE" : "DEMO"}
          </Badge>
          <span className="truncate text-sm font-medium text-fg-muted">{accountLabel}</span>
          <span className="text-xs text-fg-faint">
            {sorted.length} open
            {lastUpdated ? ` · ${new Date(lastUpdated).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-4 w-4" />}
            onClickAsync={load}
            aria-label="Refresh"
            title="Refresh"
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="h-4 w-4" />}
            disabled={combined || ctid == null}
            title={combined ? "Switch to a single account to place orders" : "New order"}
            onClick={() => setTicketOpen(true)}
          >
            New order
          </Button>
        </div>
      </div>

      {totalPnl != null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-faint">Total P&L</span>
          <span className={`font-semibold tabular-nums ${totalPnl > 0 ? "text-success" : totalPnl < 0 ? "text-danger" : "text-fg"}`}>
            {totalPnl >= 0 ? "+" : ""}{fmtMoney(totalPnl)}
          </span>
        </div>
      )}

      {publishNotice && <Flash tone="success">{publishNotice}</Flash>}

      <FilterBar mode={mode} positions orders={false} state={filters} onChange={patchFilters} symbols={symbols} orderTypes={[]} />

      {error && (
        <Card className="border-danger/30 bg-danger-soft p-4">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : sorted.length === 0 ? (
        <FadeRise>
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">{rows.length > 0 ? "No positions match." : "No open positions."}</div>
          </Card>
        </FadeRise>
      ) : (
        <Stagger className="space-y-3">
          {sorted.map((p) => (
            <StaggerItem key={combined && p.account ? `${p.account.ctid}:${p.positionId}` : p.positionId}>
              <PositionCard
                p={p}
                ctid={rowCtid(p)}
                open={openId === p.positionId}
                onToggle={() => setOpenId(openId === p.positionId ? null : p.positionId)}
                onChanged={load}
                onClose={() => setClosePos(p)}
                canPublish={isAdmin}
                onPublish={() =>
                  setPublishDraft({
                    symbol: p.symbol,
                    direction: p.side === "BUY" ? "buy" : "sell",
                    entry: p.entryPrice,
                    target: p.takeProfit,
                    stop: p.stopLoss,
                  })
                }
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      <OrderTicket
        open={ticketOpen}
        onClose={() => setTicketOpen(false)}
        onDone={load}
        ctid={ctid ?? 0}
        symbols={symbols}
        accountLabel={selectedLabel(accounts, ctid)}
      />

      {isAdmin && (
        <PublishSignalModal
          draft={publishDraft}
          onClose={() => setPublishDraft(null)}
          onSaved={(signal) => setPublishNotice(`Signal published for ${signal.symbol}.`)}
        />
      )}

      <ConfirmModal
        open={closePos != null}
        title={closePos ? `${closePos.side} ${closePos.symbol}` : "Close"}
        body={
          closePos && (
            <span>
              Market-closes all {fmtLots(closePos.lots)} lots now, realising{" "}
              <strong className={netTone(closePos.netUsd)}>{fmtNetUsd(closePos.netUsd)}</strong>
              {closeErr && (
                <>
                  <br />
                  <br />
                  <span className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                    {closeErr}
                  </span>
                </>
              )}
            </span>
          )
        }
        confirmLabel={`Close position`}
        danger={closePos?.side === "SELL"}
        onConfirm={closeSubmit}
        onClose={() => {
          setClosePos(null);
          setCloseErr(null);
        }}
      />
    </div>
  );
}

function selectedLabel(accounts: AccountView[], ctid: number | null): string {
  const a = accounts.find((x) => x.ctid === ctid);
  if (!a) return ctid != null ? `Account #${ctid}` : "No account";
  return `${a.nickname?.trim() || a.login} · ${a.broker}`;
}

function PositionCard({
  p,
  ctid,
  open,
  onToggle,
  onChanged,
  onClose,
  canPublish,
  onPublish,
}: {
  p: PositionRow;
  ctid: number;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onClose: () => void;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const isBuy = p.side === "BUY";
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  // Prefill current levels once a card is expanded. Drafts deliberately do NOT
  // re-sync to the row afterwards, so the 8s poll can't clobber a half-typed
  // level.
  useEffect(() => {
    if (open) {
      setSl(p.stopLoss != null ? String(p.stopLoss) : "");
      setTp(p.takeProfit != null ? String(p.takeProfit) : "");
      setMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const slNum = sl.trim() ? num(sl) : null;
  const tpNum = tp.trim() ? num(tp) : null;

  // Same side rule the server enforces; checked here for instant feedback.
  const ref = p.entryPrice;
  let sideErr: string | null = null;
  if (isBuy) {
    if (tpNum !== null && tpNum <= ref) sideErr = `For a BUY, TP must be above the entry (${ref}).`;
    else if (slNum !== null && slNum >= ref) sideErr = `For a BUY, SL must be below the entry (${ref}).`;
  } else {
    if (tpNum !== null && tpNum >= ref) sideErr = `For a SELL, TP must be below the entry (${ref}).`;
    else if (slNum !== null && slNum <= ref) sideErr = `For a SELL, SL must be above the entry (${ref}).`;
  }

  const dirty = (slNum !== null && slNum !== p.stopLoss) || (tpNum !== null && tpNum !== p.takeProfit);

  async function save() {
    try {
      const res = await api.amendPosition(ctid, p.positionId, slNum, tpNum);
      setMsg({ tone: "success", text: res.note ?? "Levels updated" });
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message || "Could not update" });
    }
  }

  return (
    <Card flat className="overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full p-4 text-left transition hover:bg-surface-hover">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {p.account && (
              <AccountChip login={p.account.login} nickname={p.account.nickname} color={p.account.color} />
            )}
            <Badge tone={isBuy ? "success" : "danger"}>
              {isBuy ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {p.side}
            </Badge>
            <span className="truncate text-sm font-semibold tracking-tight">{p.symbol}</span>
            <span className="shrink-0 text-xs text-fg-faint">{fmtLots(p.lots)}L</span>
          </div>
          <div className={`shrink-0 text-sm font-semibold tabular-nums ${netTone(p.netUsd)}`}>
            {fmtNetUsd(p.netUsd)}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Field label="Entry" value={fmtPrice(p.entryPrice, p.digits)} />
          <Field label="SL" value={p.stopLoss != null ? fmtPrice(p.stopLoss, p.digits) : "-"} />
          <Field label="TP" value={p.takeProfit != null ? fmtPrice(p.takeProfit, p.digits) : "-"} />
          <Field label="Net USD" value={fmtNetUsd(p.netUsd)} valueClassName={netTone(p.netUsd)} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2.5 text-xs text-fg-faint">
          <span>
            Held {heldFor(p.openTimestamp)}
            {p.openTimestamp ? ` · ${new Date(p.openTimestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
          </span>
          <Chevron open={open} />
        </div>
      </button>

      <Collapse open={open}>
        <div className="space-y-4 border-t border-hairline p-4">
          {msg && <Flash tone={msg.tone}>{msg.text}</Flash>}

          <div className="grid grid-cols-3 gap-3">
            <Field label="Held for" value={heldFor(p.openTimestamp)} />
            <Field label="Position" value={`#${p.positionId}`} />
            <Field label="Current result" value={fmtNetUsd(p.netUsd)} valueClassName={netTone(p.netUsd)} />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-fg-muted">Edit stop loss / take profit</div>
            <div className="grid grid-cols-2 gap-2">
              <BareInput
                value={sl}
                onChange={setSl}
                placeholder={p.stopLoss != null ? String(p.stopLoss) : "SL"}
              />
              <BareInput
                value={tp}
                onChange={setTp}
                placeholder={p.takeProfit != null ? String(p.takeProfit) : "TP"}
              />
            </div>
            {sideErr && <Flash tone="danger">{sideErr}</Flash>}
            <div className="flex items-end justify-between gap-2">
              <span className="text-xs text-fg-faint">Levels are resent as shown; clearing a field removes it.</span>
              <Button
                size="sm"
                variant={dirty && !sideErr ? "primary" : "secondary"}
                disabled={!dirty || !!sideErr}
                onClickAsync={dirty && !sideErr ? save : undefined}
              >
                Save levels
              </Button>
            </div>
          </div>

          <div
            className={
              "grid gap-2 border-t border-hairline pt-3 " + (canPublish ? "grid-cols-2" : "grid-cols-1")
            }
          >
            {canPublish && (
              <Button variant="secondary" size="md" onClick={onPublish}>
                <Megaphone className="h-4 w-4" /> Publish signal
              </Button>
            )}
            <Button variant="danger" size="md" onClick={onClose}>
              <XOctagon className="h-4 w-4" /> Close position
            </Button>
          </div>
        </div>
      </Collapse>
    </Card>
  );
}