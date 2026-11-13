import { useEffect, useRef, useState } from "react";
import { AccountView } from "./api";
import PositionsTab from "./PositionsTab";
import OrdersTab from "./OrdersTab";
import { Card, accountColorHex } from "./components/ui";
import { FadeRise } from "./components/motion";

export type ViewMode = "separate" | "combined";

const PAGES = [
  { key: "positions", label: "Positions" },
  { key: "orders", label: "Pending orders" },
] as const;

type PageKey = (typeof PAGES)[number]["key"];

// The trading view: account selector plus the positions / pending-orders tabs.
// Chrome (header + primary nav) lives in AppShell; credential entry and
// settings are full-screen takeovers owned by App.
export default function Dashboard({
  accounts,
  isAdmin,
}: {
  accounts: AccountView[];
  isAdmin: boolean;
}) {
  const [selectedCtids, setSelectedCtids] = useState<number[]>(() => {
    const preferred = accounts.find((a) => a.isLive) ?? accounts[0];
    return preferred ? [preferred.ctid] : [];
  });
  // "All accounts" is its own mode, not a shortcut that ticks every pill. While
  // it is on, the individual pills render unselected; clicking one switches to
  // that account (and turns All off).
  const [allSelected, setAllSelected] = useState(false);
  const initialized = useRef(selectedCtids.length > 0);

  // Default to the first live account once, when accounts first arrive.
  useEffect(() => {
    if (initialized.current || accounts.length === 0) return;
    initialized.current = true;
    const preferred = accounts.find((a) => a.isLive) ?? accounts[0];
    setSelectedCtids([preferred.ctid]);
  }, [accounts]);

  const activeAccounts = allSelected
    ? accounts
    : accounts.filter((a) => selectedCtids.includes(a.ctid));
  const single = activeAccounts.length === 1 ? activeAccounts[0] : null;

  function toggleAccount(ctid: number) {
    if (allSelected) {
      setAllSelected(false);
      setSelectedCtids([ctid]);
      return;
    }
    setSelectedCtids((prev) => {
      if (prev.includes(ctid)) {
        // Never leave the trading view with no account selected.
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== ctid);
      }
      return [...prev, ctid];
    });
  }

  return (
    <FadeRise>
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <span className="text-sm font-medium text-fg-muted">Account</span>
            <button
              type="button"
              onClick={() => {
                setAllSelected(true);
                setSelectedCtids(accounts.map((a) => a.ctid));
              }}
              aria-pressed={allSelected}
              className={accountPillCls(allSelected)}
            >
              All accounts
            </button>
            {accounts.map((a) => {
              const active = !allSelected && selectedCtids.includes(a.ctid);
              const hex = accountColorHex(a.color);
              return (
                <button
                  key={a.ctid}
                  type="button"
                  onClick={() => toggleAccount(a.ctid)}
                  aria-pressed={active}
                  title={accountTitle(a)}
                  className={accountPillCls(active)}
                >
                  {hex && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: hex }}
                    />
                  )}
                  <span className="max-w-[14rem] truncate">{a.nickname?.trim() || a.login}</span>
                  <span className={"truncate " + (active ? "opacity-80" : "text-fg-faint")}>
                    · {a.broker}
                  </span>
                  <span
                    className={
                      "shrink-0 text-[9.5px] font-semibold uppercase tracking-wide " +
                      (active ? "opacity-70" : "text-fg-faint")
                    }
                  >
                    {a.isLive ? "Live" : "Demo"}
                  </span>
                </button>
              );
            })}
            {accounts.length === 0 && (
              <span className="text-sm text-fg-faint">No accounts</span>
            )}
          </div>
        </Card>

        {accounts.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">No cTrader accounts found.</div>
            <div className="mt-1 text-xs text-fg-faint">Check your credentials.</div>
          </Card>
        ) : activeAccounts.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">Select an account.</div>
            <div className="mt-1 text-xs text-fg-faint">
              Use the account pills above, or choose All accounts.
            </div>
          </Card>
        ) : (
          <Tabs
            mode={activeAccounts.length > 1 ? "combined" : "separate"}
            accounts={activeAccounts}
            ctid={single?.ctid ?? null}
            isLive={single?.isLive ?? false}
            isAdmin={isAdmin}
          />
        )}
      </div>
    </FadeRise>
  );
}

function Tabs({
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
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<PageKey>("positions");
  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setTab(p.key)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition " +
              (tab === p.key
                ? "border border-accent/20 bg-accent-soft text-accent"
                : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      {tab === "positions" ? (
        <PositionsTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} isAdmin={isAdmin} />
      ) : (
        <OrdersTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} isAdmin={isAdmin} />
      )}
    </div>
  );
}

function accountPillCls(active: boolean): string {
  return (
    "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition " +
    (active
      ? "border-accent/30 bg-accent-soft text-accent"
      : "border-hairline-strong bg-soft text-fg-muted hover:bg-surface-hover hover:text-fg")
  );
}

function accountTitle(a: AccountView): string {
  const name = a.nickname?.trim() || a.login;
  const balance = a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : "";
  return `${name} · ${a.broker}${balance} · ${a.isLive ? "Live" : "Demo"}`;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPrice(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(n)) return "-";
  // Scale decimals to the magnitude of the price so big values don't show
  // long trailing zeros (e.g. 75,000.000), while tiny ones keep precision.
  const cap = n >= 1_000 ? 2 : n >= 100 ? 3 : 4;
  const d = Math.min(digits ?? cap, cap, 5);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtLots(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}