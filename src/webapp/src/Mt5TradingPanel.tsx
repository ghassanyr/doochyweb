import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { api, ApiError, type BrokerAccountView } from "./api";
import { Badge, Button, Card, Flash, Skeleton } from "./components/ui";

type Mt5Snapshot = {
  positions: number;
  orders: number;
  history: number;
};

export default function Mt5TradingPanel({ accounts }: { accounts: BrokerAccountView[] }) {
  const [snapshots, setSnapshots] = useState<Record<string, Mt5Snapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (accounts.length === 0) {
      setSnapshots({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const failures: string[] = [];
    try {
      const next: Record<string, Mt5Snapshot> = {};
      const results = await Promise.all(
        accounts.map(async (account) => {
          const [positions, orders, history] = await Promise.all([
            api.mt5Positions(account.id),
            api.mt5Orders(account.id),
            api.mt5History(account.id, 7),
          ]);
          return {
            id: account.id,
            snapshot: {
              positions: positions.positions.length,
              orders: orders.orders.length,
              history: history.trades.length,
            },
          };
        })
      );
      for (const result of results) next[result.id] = result.snapshot;
      setSnapshots(next);
    } catch (err) {
      failures.push(err instanceof ApiError ? err.message : "Could not load MT5 activity.");
    }
    if (failures.length) setError(failures[0]);
    setLoading(false);
  }, [accounts]);

  useEffect(() => {
    void load();
  }, [load]);

  if (accounts.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight text-fg">MT5 accounts</h2>
          <p className="text-xs text-fg-muted">
            Read-only bridge data. MT5 history also appears in the journal after each background sync.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClickAsync={load}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Flash tone="danger">{error}</Flash>
        </div>
      )}
      <div className="mt-3 divide-y divide-hairline">
        {accounts.map((account) => {
          const snapshot = snapshots[account.id];
          return (
            <div key={account.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">
                    {account.nickname ?? account.login}
                  </span>
                  <Badge tone={account.mode === "live" ? "danger" : "muted"}>{account.mode}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-fg-faint">{account.name}</p>
              </div>
              {loading ? (
                <Skeleton className="h-5 w-40" />
              ) : (
                <div className="flex gap-3 text-xs text-fg-muted">
                  <span>{snapshot?.positions ?? 0} positions</span>
                  <span>{snapshot?.orders ?? 0} orders</span>
                  <span>{snapshot?.history ?? 0} closed, 7d</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
