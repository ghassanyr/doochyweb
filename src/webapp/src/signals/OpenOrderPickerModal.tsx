import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search } from "lucide-react";

import {
  api,
  type AccountView,
  type BrokerAccountView,
  type OrderRow,
  type PositionRow,
} from "../api";
import { AnimatedModal } from "../components/Modal";
import { Badge, Button, Card, Skeleton, inputCls } from "../components/ui";
import { draftFromOrder, draftFromPosition } from "./openTrades";
import { fmtPrice } from "./signalFormat";
import type { SignalDraft } from "./types";

type TradeKind = "position" | "order";

interface PickerTrade {
  key: string;
  kind: TradeKind;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  stop: number | null;
  target: number | null;
  lots: number;
  account: string;
  broker: string;
  live: boolean;
  draft: SignalDraft;
}

interface TradeAccount {
  key: string;
  label: string;
  broker: string;
  live: boolean;
}

function buildTrades(
  account: TradeAccount,
  positions: PositionRow[],
  orders: OrderRow[]
): PickerTrade[] {
  return [
    ...positions.map((position) => ({
      key: `${account.key}:position:${position.positionId}`,
      kind: "position" as const,
      symbol: position.symbol,
      side: position.side,
      entry: position.entryPrice,
      stop: position.stopLoss,
      target: position.takeProfit,
      lots: position.lots,
      account: account.label,
      broker: account.broker,
      live: account.live,
      draft: draftFromPosition(position),
    })),
    ...orders.map((order) => ({
      key: `${account.key}:order:${order.orderId}`,
      kind: "order" as const,
      symbol: order.symbol,
      side: order.side,
      entry: order.price,
      stop: order.stopLoss,
      target: order.takeProfit,
      lots: order.lots,
      account: account.label,
      broker: account.broker,
      live: account.live,
      draft: draftFromOrder(order),
    })),
  ];
}

// Lists every open position and pending order across the admin's connected
// accounts, so a signal can start from a real trade instead of typed values.
export function OpenOrderPickerModal({
  open,
  onClose,
  onPick,
  onManual,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (draft: SignalDraft) => void;
  onManual: () => void;
}) {
  const [trades, setTrades] = useState<PickerTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setFailed(0);
    setQuery("");
    setTrades([]);

    (async () => {
      try {
        const { accounts, brokerAccounts } = await api.accounts();
        const mt5Accounts = brokerAccounts.filter((account) => account.broker === "mt5");
        const jobs = [
          ...accounts.map(async (account: AccountView) => {
            const [positions, orders] = await Promise.all([
              api.positions(account.ctid),
              api.orders(account.ctid),
            ]);
            return buildTrades(
              {
                key: `ctrader:${account.ctid}`,
                label: account.nickname?.trim() || String(account.login),
                broker: "cTrader",
                live: account.isLive,
              },
              positions.positions,
              orders.orders
            );
          }),
          ...mt5Accounts.map(async (account: BrokerAccountView) => {
            const [positions, orders] = await Promise.all([
              api.mt5Positions(account.id),
              api.mt5Orders(account.id),
            ]);
            return buildTrades(
              {
                key: `mt5:${account.id}`,
                label: account.nickname?.trim() || account.login,
                broker: "MT5",
                live: account.mode === "live",
              },
              positions.positions,
              orders.orders
            );
          }),
        ];
        const settled = await Promise.allSettled(jobs);
        if (!alive) return;
        const next = settled.flatMap((result) =>
          result.status === "fulfilled" ? result.value : []
        );
        const failures = settled.filter((result) => result.status === "rejected").length;
        setTrades(next);
        setFailed(failures);
        if (next.length === 0 && failures > 0) {
          setError("Could not read open trades from the connected accounts.");
        }
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Could not load open orders.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return trades;
    return trades.filter(
      (trade) =>
        trade.symbol.toUpperCase().includes(q) ||
        trade.account.toUpperCase().includes(q) ||
        trade.broker.toUpperCase().includes(q)
    );
  }, [trades, query]);

  const positions = filtered.filter((trade) => trade.kind === "position");
  const orders = filtered.filter((trade) => trade.kind === "order");

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      title="From open orders"
      subtitle="Pick a position or pending order, then review the levels before publishing."
      size="lg"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
          <input
            className={inputCls + " pl-9"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by symbol or account..."
            spellCheck={false}
            aria-label="Filter open trades"
          />
        </div>

        {error && (
          <Card className="border-danger/30 bg-danger-soft p-4">
            <div className="flex items-center gap-2 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          </Card>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Card key={index} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </Card>
            ))}
          </div>
        ) : trades.length === 0 ? (
          !error && (
            <Card className="p-6 text-center">
              <div className="text-sm text-fg-muted">No open positions or pending orders.</div>
              <div className="mt-1 text-xs text-fg-faint">
                Place a trade in Trading, or enter the signal values manually.
              </div>
            </Card>
          )
        ) : filtered.length === 0 ? (
          <Card className="p-6 text-center text-sm text-fg-muted">
            No open trades match this filter.
          </Card>
        ) : (
          <div className="space-y-4">
            {failed > 0 && (
              <p className="text-[11.5px] text-fg-faint">
                {failed} account{failed === 1 ? "" : "s"} could not be read.
              </p>
            )}
            <TradeSection title="Open positions" trades={positions} onPick={onPick} />
            <TradeSection title="Pending orders" trades={orders} onPick={onPick} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
          <Button variant="ghost" size="sm" onClick={onManual}>
            Enter values manually
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}

function TradeSection({
  title,
  trades,
  onPick,
}: {
  title: string;
  trades: PickerTrade[];
  onPick: (draft: SignalDraft) => void;
}) {
  if (trades.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
        {title} ({trades.length})
      </h3>
      <div className="space-y-2">
        {trades.map((trade) => (
          <TradeRow key={trade.key} trade={trade} onPick={() => onPick(trade.draft)} />
        ))}
      </div>
    </section>
  );
}

function TradeRow({ trade, onPick }: { trade: PickerTrade; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full flex-col gap-2 rounded-xl border border-hairline bg-soft/40 p-3 text-left transition hover:border-hairline-strong hover:bg-surface-hover"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-bold tracking-tight text-fg">{trade.symbol}</span>
        <Badge tone={trade.side === "BUY" ? "success" : "danger"}>{trade.side}</Badge>
        <span className="rounded-[5px] border border-hairline bg-soft px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-fg-faint">
          {trade.kind === "position" ? "Position" : "Pending"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="truncate">{trade.account}</span>
          <span className="text-fg-faint">{trade.broker}</span>
          <span className={trade.live ? "font-semibold text-danger" : "text-fg-faint"}>
            {trade.live ? "Live" : "Demo"}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TradeValue label={trade.kind === "position" ? "Entry" : "Order price"} value={fmtPrice(trade.entry)} />
        <TradeValue label="Stop" value={fmtPrice(trade.stop)} />
        <TradeValue label="Target" value={fmtPrice(trade.target)} />
      </div>

      <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-faint">
        <span>{trade.lots} lots</span>
        <span className="font-semibold text-accent">Use this trade</span>
      </div>
    </button>
  );
}

function TradeValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-hairline bg-soft px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="truncate text-[12.5px] font-semibold tabular-nums text-fg">{value}</span>
    </div>
  );
}
