import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  History,
  RefreshCw,
} from "lucide-react";
import {
  ApiError,
  api,
  type AccountView,
  type OrderHistoryRow,
  type OrderHistoryResult,
  type RowAccount,
} from "./api";
import { fmtLots, fmtMoney, fmtPrice, type ViewMode } from "./Dashboard";
import {
  AccountChip,
  Badge,
  Button,
  Card,
  Flash,
  Skeleton,
} from "./components/ui";
import { FadeRise } from "./components/motion";
import { formatLocalDateTime } from "./time";

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

type HistoryRow = OrderHistoryRow & { account?: RowAccount };

export default function OrderHistoryTab({
  mode,
  accounts,
  ctid,
  isLive,
}: {
  mode: ViewMode;
  accounts: AccountView[];
  ctid: number | null;
  isLive: boolean;
}) {
  const [days, setDays] = useState<number>(7);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setPartialError(null);
    try {
      if (mode === "combined") {
        const settled = await Promise.all(
          accounts.map(async (a) => {
            try {
              const result = await api.orderHistory(a.ctid, days);
              const acct: RowAccount = {
                ctid: a.ctid,
                login: a.login,
                isLive: a.isLive,
                nickname: a.nickname,
                color: a.color,
                currency: a.currency,
              };
              return {
                ...result,
                trades: result.trades.map((row) => ({ ...row, account: acct })) as HistoryRow[],
              } satisfies OrderHistoryResult;
            } catch {
              return null;
            }
          })
        );
        if (id !== requestId.current) return;
        const ok = settled.filter((r): r is OrderHistoryResult => r !== null);
        setRows(
          ok
            .flatMap((r) => r.trades)
            .sort((a, b) => b.closeTimestamp - a.closeTimestamp)
        );
        setTruncated(ok.some((r) => r.truncated));
        if (accounts.length > 0 && ok.length === 0) {
          setError("Failed to load order history");
        } else if (ok.length < accounts.length) {
          setPartialError(
            `History unavailable for ${accounts.length - ok.length} of ${accounts.length} accounts.`
          );
        }
      } else if (ctid != null) {
        const result = await api.orderHistory(ctid, days);
        if (id !== requestId.current) return;
        setRows(result.trades);
        setTruncated(result.truncated);
      }
      if (id === requestId.current) setLastUpdated(Date.now());
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) return;
      if (id === requestId.current) setError(err.message || "Failed to load order history");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [mode, accounts, ctid, days]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const changePeriod = useCallback((next: number) => {
    if (next === days) return;
    setLoading(true);
    setRows([]);
    setTruncated(false);
    setPartialError(null);
    setLastUpdated(null);
    setDays(next);
  }, [days]);

  useEffect(() => {
    setRows([]);
    setTruncated(false);
    setPartialError(null);
  }, [mode, ctid, accounts]);

  const combined = mode === "combined";

  const currencyFor = useCallback(
    (row: HistoryRow): string => {
      const account = row.account ?? accounts.find((a) => a.ctid === ctid) ?? null;
      return account?.currency ?? "";
    },
    [accounts, ctid]
  );

  const stats = useMemo(() => {
    let net = 0;
    let wins = 0;
    let losses = 0;
    for (const row of rows) {
      net += row.net;
      if (row.net > 0) wins++;
      else if (row.net < 0) losses++;
    }
    return {
      net,
      wins,
      losses,
      winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null,
    };
  }, [rows]);

  const currencies = useMemo(
    () => new Set(rows.map((row) => currencyFor(row)).filter(Boolean)),
    [rows, currencyFor]
  );
  const mixedCurrencies = currencies.size > 1;
  const summaryCurrency = currencies.size === 1 ? [...currencies][0] : "";

  const accountLabel = selectedLabel(accounts, ctid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={combined ? "muted" : isLive ? "accent" : "muted"}>
            {combined ? "MULTI" : isLive ? "LIVE" : "DEMO"}
          </Badge>
          <span className="truncate text-sm font-medium text-fg-muted">{accountLabel}</span>
          <span className="text-xs text-fg-faint">
            {rows.length} closed
            {lastUpdated
              ? ` · ${new Date(lastUpdated).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-soft p-[3px]">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                onClick={() => changePeriod(period.days)}
                aria-pressed={days === period.days}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                  (days === period.days
                    ? "bg-accent-soft text-accent"
                    : "text-fg-muted hover:text-fg")
                }
              >
                {period.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="h-4 w-4" />}
            onClickAsync={load}
            aria-label="Refresh"
            title="Refresh"
          />
        </div>
      </div>

      {error && (
        <Card className="border-danger/30 bg-danger-soft p-4">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        </Card>
      )}

      {partialError && <Flash tone="warning">{partialError}</Flash>}

      {truncated && (
        <Flash tone="warning">
          Some older trades may be missing because the broker capped this range.
          Narrow the period or refresh to try again.
        </Flash>
      )}

      {loading && rows.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="space-y-2 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Closed trades" value={String(rows.length)} />
          <Summary
            label="Net P&L"
            value={
              mixedCurrencies
                ? "Mixed"
                : `${stats.net >= 0 ? "+" : ""}${fmtMoney(stats.net)}${summaryCurrency ? ` ${summaryCurrency}` : ""}`
            }
            tone={
              mixedCurrencies
                ? undefined
                : stats.net > 0
                  ? "success"
                  : stats.net < 0
                    ? "danger"
                    : undefined
            }
          />
          <Summary label="Win rate" value={stats.winRate == null ? "-" : `${stats.winRate}%`} />
          <Summary label="Wins / losses" value={`${stats.wins} / ${stats.losses}`} />
        </div>
      )}

      {loading && rows.length === 0 ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <FadeRise>
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">
              No closed trades in the last {days} days.
            </div>
            <div className="mt-1 text-xs text-fg-faint">
              Deals appear here once a position has been fully or partially closed.
            </div>
          </Card>
        </FadeRise>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-hairline px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-faint">
            <History className="h-3.5 w-3.5" /> Order history ({rows.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead className="text-fg-faint">
                <tr className="border-b border-hairline">
                  <th className="px-4 py-2 font-medium">Closed</th>
                  <th className="px-2 py-2 font-medium">Symbol</th>
                  <th className="px-2 py-2 font-medium">Side</th>
                  <th className="px-2 py-2 text-right font-medium">Lots</th>
                  <th className="px-2 py-2 text-right font-medium">Entry</th>
                  <th className="px-2 py-2 text-right font-medium">Exit</th>
                  <th className="px-4 py-2 text-right font-medium">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((row) => {
                  const currency = currencyFor(row);
                  const isBuy = row.side === "BUY";
                  return (
                    <tr
                      key={`${row.account?.ctid ?? ctid}:${row.dealId}`}
                      className="transition hover:bg-surface-hover/60"
                      title={
                        `Position #${row.positionId ?? "-"} · Order #${row.orderId ?? "-"}` +
                        ` · Gross ${fmtMoney(row.grossProfit)}` +
                        ` · Swap ${fmtMoney(row.swap)}` +
                        ` · Commission ${fmtMoney(row.commission)}` +
                        (currency ? ` ${currency}` : "")
                      }
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                        {formatLocalDateTime(row.closeTimestamp)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-semibold text-fg">{row.symbol}</div>
                        {row.account && (
                          <AccountChip
                            login={row.account.login}
                            nickname={row.account.nickname}
                            color={row.account.color}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={isBuy ? "success" : "danger"}>
                          {isBuy ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {row.side}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-fg">
                        {fmtLots(row.lots)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-fg-muted">
                        {fmtPrice(row.entryPrice, row.digits)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-fg-muted">
                        {fmtPrice(row.exitPrice, row.digits)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " +
                          (row.net > 0
                            ? "text-success"
                            : row.net < 0
                              ? "text-danger"
                              : "text-fg")
                        }
                      >
                        {row.net >= 0 ? "+" : ""}
                        {fmtMoney(row.net)}
                        {currency ? ` ${currency}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const color =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <Card className="p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`mt-1 truncate text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}

function selectedLabel(accounts: AccountView[], ctid: number | null): string {
  if (ctid == null) {
    if (accounts.length === 0) return "No account";
    if (accounts.length === 1) {
      const only = accounts[0];
      return `${only.nickname?.trim() || only.login} · ${only.broker}`;
    }
    return `${accounts.length} accounts selected`;
  }
  const a = accounts.find((x) => x.ctid === ctid);
  if (!a) return `Account #${ctid}`;
  return `${a.nickname?.trim() || a.login} · ${a.broker}`;
}
