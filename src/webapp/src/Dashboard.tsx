import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AccountView } from "./api";
import PositionsTab from "./PositionsTab";
import OrdersTab from "./OrdersTab";
import { Card, Toggle } from "./components/ui";
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
  const demoAccounts = accounts.filter((a) => !a.isLive);
  const liveAccounts = accounts.filter((a) => a.isLive);

  return (
    <FadeRise>
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm font-medium text-fg-muted">Account</span>
              <div className="relative min-w-0 flex-1">
                <select
                  id="account-select"
                  value={mode === "combined" ? "" : selectedCtid ?? ""}
                  disabled={mode === "combined"}
                  onChange={(e) => setSelectedCtid(Number(e.target.value))}
                  className="w-full appearance-none rounded-lg border border-hairline-strong bg-soft py-2 pl-3 pr-8 text-sm font-medium text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
                >
                  {mode === "combined" && <option value="">All accounts</option>}
                  {liveAccounts.length > 0 && (
                    <option value="__live" disabled>
                      Live
                    </option>
                  )}
                  {liveAccounts.map((a) => (
                    <option key={a.ctid} value={a.ctid}>
                      {(a.nickname?.trim() || a.login)} · {a.broker}
                      {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
                    </option>
                  ))}
                  {demoAccounts.length > 0 && (
                    <option value="__demo" disabled>
                      Demo
                    </option>
                  )}
                  {demoAccounts.map((a) => (
                    <option key={a.ctid} value={a.ctid}>
                      {(a.nickname?.trim() || a.login)} · {a.broker}
                      {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
                    </option>
                  ))}
                  {accounts.length === 0 && <option value="">No accounts</option>}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
              </div>
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