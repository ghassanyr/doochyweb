import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Ban, Hourglass, Megaphone, Pencil, Plus, RefreshCw } from "lucide-react";
import { ApiError, AccountView, OrderRow, RowAccount, api } from "./api";
import { ViewMode, fmtLots, fmtPrice } from "./Dashboard";
import FilterBar, {
  applyFilter,
  FilterPatch,
  FilterState,
  loadFilter,
  saveFilter,
  sortRows,
  uniqueSymbols,
} from "./FilterBar";
import { AccountChip, Badge, Button, Card, Collapse, Flash, Skeleton } from "./components/ui";
import { FadeRise, Stagger, StaggerItem } from "./components/motion";
import { ConfirmModal } from "./components/Modal";
import { PublishSignalModal } from "./signals/PublishSignalModal";
import type { SignalDraft } from "./signals/types";
import OrderTicket from "./trading/OrderTicket";
import { posNum } from "./trading/ui";

const POLL_MS = 8000;

function orderTypeLabel(t: string): string {
  switch (t) {
    case "LIMIT":
      return "Limit";
    case "STOP":
      return "Stop";
    case "STOP_LOSS_TAKE_PROFIT":
      return "SL/TP";
    default:
      return t || "-";
  }
}

export default function OrdersTab({
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
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [orderFilters, setOrderFilters] = useState<FilterState>(() => loadFilter(true));
  const timer = useRef<number | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<OrderRow | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [publishDraft, setPublishDraft] = useState<SignalDraft | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!publishNotice) return;
    const id = window.setTimeout(() => setPublishNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [publishNotice]);

  const patchOrderFilters = useCallback((pn: FilterPatch) => {
    setOrderFilters((s) => {
      const next = { ...s, ...pn };
      saveFilter(true, next);
      return next;
    });
  }, []);

  const syms = useMemo(() => uniqueSymbols(rows), [rows]);

  const orderTypeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.orderType))).sort(),
    [rows]
  );

  const rowCtid = useCallback((o: OrderRow): number => o.account?.ctid ?? ctid ?? 0, [ctid]);

  const load = useCallback(async () => {
    try {
      if (mode === "combined") {
        const settled = await Promise.all(
          accounts.map(async (a) => {
            try {
              const { orders } = await api.orders(a.ctid);
              const acct: RowAccount = { ctid: a.ctid, login: a.login, isLive: a.isLive, nickname: a.nickname, color: a.color };
              return orders.map((o) => ({ ...o, account: acct })) as OrderRow[];
            } catch {
              return null;
            }
          })
        );
        const merged = settled.flat().filter((b): b is OrderRow => b !== null);
        setRows(merged);
        setError(null);
      } else if (ctid != null) {
        const { orders } = await api.orders(ctid);
        setRows(orders);
        setError(null);
      }
      setLastUpdated(Date.now());
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [mode, accounts, ctid]);

  const cancelSubmit = useCallback(async () => {
    if (!cancelOrder) return;
    setCancelErr(null);
    try {
      await api.cancelOrder(rowCtid(cancelOrder), cancelOrder.orderId);
      setCancelOrder(null);
      load();
    } catch (e: any) {
      setCancelErr(e?.message || "Cancel failed");
      throw e;
    }
  }, [cancelOrder, rowCtid, load]);

  useEffect(() => {
    setLoading(true);
    load();
    timer.current = window.setInterval(load, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const combined = mode === "combined";
  const shownOrders = applyFilter(rows, orderFilters);
  const sortedOrders = sortRows(shownOrders, orderFilters.sortKey, orderFilters.sortAsc);

  const accountLabel = selectedLabel(accounts, ctid);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={combined ? "muted" : isLive ? "accent" : "muted"}>
            {combined ? "ALL" : isLive ? "LIVE" : "DEMO"}
          </Badge>
          <span className="truncate text-sm font-medium text-fg-muted">{accountLabel}</span>
          <span className="text-xs text-fg-faint">
            {sortedOrders.length} pending
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

      {publishNotice && <Flash tone="success">{publishNotice}</Flash>}

      <FilterBar
        mode={mode}
        orders
        positions={false}
        state={orderFilters}
        onChange={patchOrderFilters}
        symbols={syms}
        orderTypes={orderTypeOptions}
      />

      {error && (
        <Card className="border-danger/30 bg-danger-soft p-4">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        </Card>
      )}

      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : sortedOrders.length === 0 ? (
        <FadeRise>
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">
              {rows.length > 0 ? "No pending orders match." : "No pending orders."}
            </div>
          </Card>
        </FadeRise>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-fg-faint">
            <Hourglass className="h-3.5 w-3.5" /> Resting orders ({sortedOrders.length})
          </div>
          <Stagger className="space-y-3">
            {sortedOrders.map((o) => (
              <StaggerItem key={combined && o.account ? `${o.account.ctid}:${o.orderId}` : o.orderId}>
                <PendingCard
                  o={o}
                  ctid={rowCtid(o)}
                  onChanged={load}
                  onCancel={() => setCancelOrder(o)}
                  canPublish={isAdmin}
                  onPublish={() =>
                    setPublishDraft({
                      symbol: o.symbol,
                      direction: o.side === "BUY" ? "buy" : "sell",
                      entry: o.price,
                      target: o.takeProfit,
                      stop: o.stopLoss,
                    })
                  }
                />
              </StaggerItem>
            ))}
          </Stagger>
        </>
      )}

      <OrderTicket
        open={ticketOpen}
        onClose={() => setTicketOpen(false)}
        onDone={load}
        ctid={ctid ?? 0}
        symbols={syms}
        accountLabel={accountLabel}
      />

      {isAdmin && (
        <PublishSignalModal
          draft={publishDraft}
          onClose={() => setPublishDraft(null)}
          onSaved={(signal) => setPublishNotice(`Signal published for ${signal.symbol}.`)}
        />
      )}

      <ConfirmModal
        open={cancelOrder != null}
        title={cancelOrder ? `Cancel ${cancelOrder.side} ${cancelOrder.symbol}?` : "Cancel order"}
        body={
          cancelOrder && (
            <span>
              Removes the resting {orderTypeLabel(cancelOrder.orderType)} order for {fmtLots(cancelOrder.lots)} lots at{" "}
              <strong className="text-fg">{fmtPrice(cancelOrder.price, cancelOrder.digits)}</strong>. Nothing is filled,
              so there is no P&L; you can place it again later.
              {cancelErr && (
                <>
                  <br />
                  <br />
                  <span className="rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                    {cancelErr}
                  </span>
                </>
              )}
            </span>
          )
        }
        confirmLabel="Cancel order"
        danger
        onConfirm={cancelSubmit}
        onClose={() => {
          setCancelOrder(null);
          setCancelErr(null);
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

// A resting LIMIT/STOP order awaiting fill. Not a position yet, so no P&L. Shows
// the resting level, size and SL/TP, with inline Edit (move the level, change
// SL/TP) and a Cancel.
function PendingCard({
  o,
  ctid,
  onChanged,
  onCancel,
  canPublish,
  onPublish,
}: {
  o: OrderRow;
  ctid: number;
  onChanged: () => void;
  onCancel: () => void;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const isBuy = o.side === "BUY";
  const isLimit = o.orderType === "LIMIT";
  const levelLabel = isLimit ? "Limit" : "Trigger";
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const entryNum = posNum(entry);
  const slNum = posNum(sl);
  const tpNum = posNum(tp);
  // Validate SL/TP against the entry we'd end up with (the new one, or current).
  const ref = entryNum ?? o.price;
  let sideErr: string | null = null;
  if (isBuy) {
    if (tpNum !== null && tpNum <= ref) sideErr = `For a BUY, TP must be above the ${levelLabel.toLowerCase()} (${ref}).`;
    else if (slNum !== null && slNum >= ref) sideErr = `For a BUY, SL must be below the ${levelLabel.toLowerCase()} (${ref}).`;
  } else {
    if (tpNum !== null && tpNum >= ref) sideErr = `For a SELL, TP must be below the ${levelLabel.toLowerCase()} (${ref}).`;
    else if (slNum !== null && slNum <= ref) sideErr = `For a SELL, SL must be above the ${levelLabel.toLowerCase()} (${ref}).`;
  }
  const dirty =
    (entryNum !== null && entryNum !== o.price) ||
    (slNum !== null && slNum !== o.stopLoss) ||
    (tpNum !== null && tpNum !== o.takeProfit);

  async function save() {
    try {
      const res = await api.modifyOrder(ctid, o.orderId, { price: entryNum, sl: slNum, tp: tpNum });
      setMsg({ tone: "success", text: res.note ?? "Order updated" });
      setEntry("");
      setSl("");
      setTp("");
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setMsg({ tone: "danger", text: e?.message || "Could not update order" });
    }
  }

  return (
    <Card flat className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {o.account && <AccountChip login={o.account.login} nickname={o.account.nickname} color={o.account.color} />}
            <Badge tone={isBuy ? "success" : "danger"}>
              {isBuy ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {o.side}
            </Badge>
            <span className="truncate text-sm font-semibold tracking-tight">{o.symbol}</span>
            <span className="shrink-0 text-xs text-fg-faint">{fmtLots(o.lots)}L</span>
            <Badge tone="muted">{orderTypeLabel(o.orderType)}</Badge>
          </div>
          <div className="shrink-0 text-xs tabular-nums text-fg-faint">
            @ {fmtPrice(o.price, o.digits)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <FieldLabel label={levelLabel} value={fmtPrice(o.price, o.digits)} />
          <FieldLabel label="SL" value={o.stopLoss != null ? fmtPrice(o.stopLoss, o.digits) : "-"} />
          <FieldLabel label="TP" value={o.takeProfit != null ? fmtPrice(o.takeProfit, o.digits) : "-"} />
        </div>

        {msg && (
          <div className="mt-3">
            <Flash tone={msg.tone}>{msg.text}</Flash>
          </div>
        )}

        <Collapse open={editing}>
          <div className="mt-4 space-y-2 border-t border-hairline pt-4">
            <div className="text-sm font-medium text-fg-muted">Edit order</div>
            <div className="grid grid-cols-3 gap-2">
              <BareFields value={entry} onChange={setEntry} placeholder={`${levelLabel} ${o.price}`} />
              <BareFields value={sl} onChange={setSl} placeholder={o.stopLoss != null ? `SL ${o.stopLoss}` : "SL"} />
              <BareFields value={tp} onChange={setTp} placeholder={o.takeProfit != null ? `TP ${o.takeProfit}` : "TP"} />
            </div>
            {sideErr && <Flash tone="danger">{sideErr}</Flash>}
            <Button
              size="sm"
              variant={dirty && !sideErr ? "primary" : "secondary"}
              disabled={!dirty || !!sideErr}
              onClickAsync={dirty && !sideErr ? save : undefined}
            >
              Save changes
            </Button>
          </div>
        </Collapse>

        {canPublish && (
          <div className="mt-4">
            <Button variant="secondary" size="sm" className="w-full" onClick={onPublish}>
              <Megaphone className="h-3.5 w-3.5" /> Publish signal
            </Button>
          </div>
        )}

        <div className={"grid grid-cols-2 gap-2 " + (canPublish ? "mt-2" : "mt-4")}>
          <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit"}
          </Button>
          <Button variant="danger" size="sm" icon={<Ban className="h-3.5 w-3.5" />} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FieldLabel({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-faint">{label}</div>
      <div className="mt-0.5 text-sm tabular-nums text-fg">{value}</div>
    </div>
  );
}

function BareFields({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-hairline-strong bg-soft px-3 py-2 text-sm tabular-nums text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
    />
  );
}