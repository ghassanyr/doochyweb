import { useEffect, useState } from "react";
import { AccountView } from "./api";
import PositionsTab from "./PositionsTab";
import OrdersTab from "./OrdersTab";
import { Card, Toggle, accountColorHex } from "./components/ui";
import { FadeRise } from "./components/motion";

export type ViewMode = "separate" | "combined";
const MODE_KEY = "doochyweb_mode";

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
  const [selectedCtid, setSelectedCtid] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>(() =>
    localStorage.getItem(MODE_KEY) === "combined" ? "combined" : "separate"
  );

  function switchMode(next: ViewMode) {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  }

  // Default to the first live account once, when accounts first arrive.
  useEffect(() => {
    if (selectedCtid || accounts.length === 0) return;
    const preferred = accounts.find((a) => a.isLive) ?? accounts[0];
    setSelectedCtid(preferred.ctid);
  }, [accounts, selectedCtid]);

  const selected = accounts.find((a) => a.ctid === selectedCtid) ?? null;

  return (
    <FadeRise>
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-2">
              <span className="text-sm font-medium text-fg-muted">Account</span>
              {mode === "combined" && (
                <button type="button" aria-pressed className={accountPillCls(true)}>
                  All accounts
                </button>
              )}
              {accounts.map((a) => {
                const active = mode === "separate" && a.ctid === selectedCtid;
                const hex = accountColorHex(a.color);
                return (
                  <button
                    key={a.ctid}
                    type="button"
                    onClick={() => {
                      switchMode("separate");
                      setSelectedCtid(a.ctid);
                    }}
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
            <Toggle
              label="Combined"
              checked={mode === "combined"}
              onToggle={(c) => switchMode(c ? "combined" : "separate")}
            />
          </div>
        </Card>

        {(mode === "combined" && accounts.length > 0) || selected ? (
          <Tabs
            mode={mode}
            accounts={accounts}
            ctid={selected?.ctid ?? null}
            isLive={selected?.isLive ?? false}
            isAdmin={isAdmin}
          />
        ) : (
          <Card className="p-8 text-center">
            <div className="text-sm text-fg-muted">No cTrader accounts found.</div>
            <div className="mt-1 text-xs text-fg-faint">Check your credentials.</div>
          </Card>
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