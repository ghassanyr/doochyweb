// Signed-in Today dashboard.
//
// One screen that answers "what needs me right now": balances, open signals,
// the latest session analysis, alerts, the daily brief, the coach's weekly
// focus and the biggest watchlist movers. Each card loads from its existing
// endpoint independently, so one slow or failed service never blanks the rest
// of the page.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  Briefcase,
  ChevronRight,
  Globe,
  LineChart,
  Newspaper,
  Radio,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import {
  alertsApi,
  briefingApi,
  coachApi,
  sessionAnalysisApi,
  signalsApi,
  type AccountView,
  type AlertListResponse,
  type BrokerAccountView,
  type BriefingResponse,
  type CoachWeeklyResponse,
  type ModuleKey,
  type SessionLatestResponse,
} from "../api";
import { FadeRise } from "../components/motion";
import { RouteLink } from "../components/RouteLink";
import { Badge, Card, Skeleton, buttonClass } from "../components/ui";
import { formatCurrency, formatDisplayDate, formatNumber } from "../format";
import { SessionBadge } from "../market/SessionAnalysisShared";
import type { ViewKey } from "../routing";
import type { Signal } from "../signals/types";
import {
  SIGNAL_DIRECTION,
  fmtEntry,
  fmtPct,
  fmtPrice,
  relativeAgo,
} from "../signals/signalFormat";
import { useSiteConfig } from "../siteConfig";
import { greetingFor, topMovers } from "./today";

interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function loading<T>(): Loadable<T> {
  return { loading: true, error: null, data: null };
}

const QUICK_ACTIONS: {
  view: ViewKey;
  module: ModuleKey;
  label: string;
  icon: ReactNode;
}[] = [
  { view: "analysis", module: "analysis", label: "Analyse a market", icon: <LineChart className="h-4 w-4" /> },
  { view: "signals", module: "signals", label: "Review signals", icon: <Radio className="h-4 w-4" /> },
  { view: "trading", module: "trading", label: "Open trading", icon: <Briefcase className="h-4 w-4" /> },
  { view: "alerts", module: "alerts", label: "Check alerts", icon: <Bell className="h-4 w-4" /> },
];

export default function TodayPage({
  username,
  accounts,
  brokerAccounts,
  hasCredentials,
  onNavigate,
}: {
  username: string | null;
  accounts: AccountView[];
  brokerAccounts: BrokerAccountView[];
  /** Null while /api/me is still loading. */
  hasCredentials: boolean | null;
  onNavigate: (view: ViewKey) => void;
}) {
  const { config } = useSiteConfig();
  const [signals, setSignals] = useState<Loadable<Signal[]>>(loading);
  const [alerts, setAlerts] = useState<Loadable<AlertListResponse>>(loading);
  const [briefing, setBriefing] = useState<Loadable<BriefingResponse>>(loading);
  const [coach, setCoach] = useState<Loadable<CoachWeeklyResponse>>(loading);
  const [session, setSession] = useState<Loadable<SessionLatestResponse>>(loading);

  useEffect(() => {
    let alive = true;

    signalsApi
      .list({ status: "active", limit: 5 })
      .then((result) => {
        if (alive) setSignals({ loading: false, error: null, data: result.signals });
      })
      .catch(() => {
        if (alive) setSignals({ loading: false, error: "Could not load signals.", data: null });
      });

    alertsApi
      .list()
      .then((result) => {
        if (alive) setAlerts({ loading: false, error: null, data: result });
      })
      .catch(() => {
        if (alive) setAlerts({ loading: false, error: "Could not load alerts.", data: null });
      });

    briefingApi
      .get()
      .then((result) => {
        if (alive) setBriefing({ loading: false, error: null, data: result });
      })
      .catch(() => {
        if (alive) setBriefing({ loading: false, error: "Could not load the briefing.", data: null });
      });

    coachApi
      .weekly()
      .then((result) => {
        if (alive) setCoach({ loading: false, error: null, data: result });
      })
      .catch(() => {
        if (alive) setCoach({ loading: false, error: "Could not load the weekly review.", data: null });
      });

    sessionAnalysisApi
      .latest()
      .then((result) => {
        if (alive) setSession({ loading: false, error: null, data: result });
      })
      .catch(() => {
        if (alive) setSession({ loading: false, error: "Could not load session analysis.", data: null });
      });

    return () => {
      alive = false;
    };
  }, []);

  const modules = config?.navigation.modules;
  function moduleVisible(key: ModuleKey): boolean {
    if (!modules) return true;
    const module = modules.find((item) => item.key === key);
    return !module?.hidden;
  }

  const actions = QUICK_ACTIONS.filter((action) => moduleVisible(action.module));
  const date = formatDisplayDate(new Date());
  const greeting = greetingFor();
  const mt5Accounts = brokerAccounts.filter((account) => account.broker === "mt5");
  const accountRows = [
    ...accounts.map((account) => ({
      key: `ctrader:${account.ctid}`,
      label: account.nickname ?? String(account.login),
      subtitle: account.broker || "cTrader",
      live: account.isLive,
      balance: account.balance,
      currency: account.currency ?? "USD",
    })),
    ...mt5Accounts.map((account) => ({
      key: `mt5:${account.id}`,
      label: account.nickname ?? account.login,
      subtitle: `MT5 · ${account.name}`,
      live: account.mode === "live",
      balance: account.balance,
      currency: account.currency ?? "USD",
    })),
  ];
  const accountsConnected = hasCredentials === true || mt5Accounts.length > 0;

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              {greeting}
              {username ? `, ${username}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              {date}. Here is what needs you today.
            </p>
          </div>
        </header>

        {actions.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {actions.map((action) => (
              <RouteLink
                key={action.view}
                view={action.view}
                onNavigate={onNavigate}
                className={buttonClass("secondary", "md", "justify-start")}
              >
                <span className="text-accent">{action.icon}</span>
                <span className="truncate">{action.label}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
              </RouteLink>
            ))}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <TodayCard
            title="Accounts"
            icon={<Briefcase className="h-4 w-4" />}
            view="trading"
            onNavigate={onNavigate}
            className="md:col-span-2 xl:col-span-1"
          >
            {hasCredentials === null ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : !accountsConnected ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-muted">
                  Connect cTrader or MT5 to see accounts here.
                </p>
                <RouteLink
                  view="trading"
                  onNavigate={onNavigate}
                  className={buttonClass("primary", "sm", "w-full")}
                >
                  Connect a trading account
                </RouteLink>
              </div>
            ) : accountRows.length === 0 ? (
              <p className="text-sm text-fg-muted">No accounts found yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {accountRows.slice(0, 4).map((account) => (
                  <li key={account.key}>
                    <RouteLink
                      view="trading"
                      onNavigate={onNavigate}
                      className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-2 transition hover:border-hairline-strong hover:bg-surface-hover"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-fg">
                            {account.label}
                          </span>
                          <Badge tone={account.live ? "danger" : "muted"}>
                            {account.live ? "Live" : "Demo"}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
                          {account.subtitle}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                        {account.balance == null ? "-" : formatCurrency(account.balance, account.currency)}
                      </span>
                    </RouteLink>
                  </li>
                ))}
              </ul>
            )}
          </TodayCard>

          <TodayCard
            title="Active signals"
            icon={<Radio className="h-4 w-4" />}
            view="signals"
            onNavigate={onNavigate}
          >
            <CardBody
              state={signals}
              empty="No active signals right now."
              onNavigate={onNavigate}
              view="signals"
            >
              {(rows) => (
                <ul className="space-y-1.5">
                  {rows.slice(0, 3).map((signal) => {
                    const direction = SIGNAL_DIRECTION[signal.direction];
                    return (
                      <li key={signal.id}>
                        <RouteLink
                          view="signals"
                          onNavigate={onNavigate}
                          className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-soft px-2.5 py-2 transition hover:border-hairline-strong hover:bg-surface-hover"
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-fg">
                                {signal.symbol}
                              </span>
                              <Badge tone={direction.tone}>{direction.label}</Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
                              {signal.entry == null
                                ? "Entry at market"
                                : `Entry ${fmtEntry(signal.entry, signal.entryMax)}`}{" "}
                              · TP {fmtPrice(signal.target)} · SL {fmtPrice(signal.stop)}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-fg-faint">
                            {relativeAgo(signal.createdAt)}
                          </span>
                        </RouteLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </TodayCard>

          <TodayCard
            title="Session Analysis"
            icon={<Globe className="h-4 w-4" />}
            view="session-analysis"
            onNavigate={onNavigate}
          >
            <CardBody
              state={session}
              empty="The next daily analysis will appear here after it is imported."
              view="session-analysis"
              onNavigate={onNavigate}
              linkLabel="Open session analysis"
            >
              {(result) => {
                const day = result.day;
                if (!day || day.markets.length === 0) {
                  return (
                    <p className="text-sm text-fg-muted">
                      The next daily analysis will appear here after it is imported.
                    </p>
                  );
                }
                const shown = day.markets.slice(0, 2);
                const age = day.generatedAt ? relativeAgo(day.generatedAt) : null;
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SessionBadge name={day.sessionName} />
                      <span className="text-[11px] text-fg-faint">{day.sessionDate}</span>
                      {age && <span className="ml-auto text-[11px] text-fg-faint">{age}</span>}
                    </div>
                    <ul className="space-y-1.5">
                      {shown.map((market) => {
                        const level =
                          market.levelType === "support"
                            ? "Support"
                            : market.levelType === "resistance"
                              ? "Resistance"
                              : null;
                        return (
                          <li
                            key={market.symbol}
                            className="rounded-lg border border-hairline bg-soft px-2.5 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-fg">
                                  {market.symbol}
                                </span>
                                {market.pattern && (
                                  <span className="truncate rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                                    {market.pattern}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">
                                {market.targetLevel || "-"}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-fg-faint">
                              <span className="truncate">
                                {level
                                  ? `${level}${market.levelValue ? ` ${market.levelValue}` : ""}`
                                  : market.targetPeriod || "Target level"}
                              </span>
                              {market.targetPeriod && level && (
                                <span className="shrink-0">{market.targetPeriod}</span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-fg-faint">
                        {day.markets.length} {day.markets.length === 1 ? "market" : "markets"}
                      </span>
                      {day.markets.length > shown.length && (
                        <RouteLink
                          view="session-analysis"
                          onNavigate={onNavigate}
                          className="font-medium text-accent hover:underline"
                        >
                          View all
                        </RouteLink>
                      )}
                    </div>
                  </div>
                );
              }}
            </CardBody>
          </TodayCard>

          <TodayCard
            title="Alerts"
            icon={<Bell className="h-4 w-4" />}
            view="alerts"
            onNavigate={onNavigate}
          >
            <CardBody
              state={alerts}
              empty="No alerts yet. Create one to watch a level."
              onNavigate={onNavigate}
              view="alerts"
            >
              {(result) => {
                const triggered = result.alerts.filter((alert) => alert.status === "triggered");
                const rows = (triggered.length > 0 ? triggered : result.alerts).slice(0, 3);
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="accent">{result.counts.active} active</Badge>
                      <Badge tone={triggered.length > 0 ? "success" : "muted"}>
                        {result.counts.triggered} triggered
                      </Badge>
                    </div>
                    {rows.length > 0 && (
                      <ul className="space-y-1">
                        {rows.map((alert) => (
                          <li
                            key={alert.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-1.5"
                          >
                            <span className="min-w-0">
                              <span className="text-[12.5px] font-medium text-fg">
                                {alert.symbol}
                              </span>{" "}
                              <span className="text-[11px] text-fg-muted">
                                {alert.condition} {fmtPrice(alert.level)}
                              </span>
                            </span>
                            <Badge tone={alert.status === "triggered" ? "success" : "muted"}>
                              {alert.status}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              }}
            </CardBody>
          </TodayCard>

          <TodayCard
            title="Briefing"
            icon={<Newspaper className="h-4 w-4" />}
            view="briefing"
            onNavigate={onNavigate}
          >
            <CardBody
              state={briefing}
              empty="Today's briefing is not ready yet."
              onNavigate={onNavigate}
              view="briefing"
            >
              {(result) => {
                const record = result.briefing;
                if (!record) {
                  return (
                    <p className="text-sm text-fg-muted">
                      {result.aiReady
                        ? "The first brief builds shortly after the market snapshot is ready."
                        : "Today's brief is not ready yet."}
                    </p>
                  );
                }
                const text = record.sections?.headline || record.narrative || "";
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={record.status === "ready" ? "success" : "muted"}>
                        {record.status}
                      </Badge>
                      <span className="text-[11px] text-fg-faint">
                        {relativeAgo(record.generatedAt)}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-fg-muted">
                      {text
                        ? text.length > 220
                          ? `${text.slice(0, 220).trimEnd()}…`
                          : text
                        : "Open the briefing for today's overview."}
                    </p>
                  </div>
                );
              }}
            </CardBody>
          </TodayCard>

          <TodayCard
            title="Coach focus"
            icon={<Sparkles className="h-4 w-4" />}
            view="coach"
            onNavigate={onNavigate}
          >
            <CardBody
              state={coach}
              empty="No closed trades to review this week."
              onNavigate={onNavigate}
              view="coach"
            >
              {(result) => {
                const facts = result.facts;
                const focus = result.report?.sections.focus?.[0];
                return (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Stat label="Trades" value={formatNumber(facts.closedTrades)} />
                      <Stat
                        label="Win rate"
                        value={
                          facts.winRate == null
                            ? "-"
                            : `${formatNumber(facts.winRate, { maximumFractionDigits: 0 })}%`
                        }
                      />
                      <Stat label="Net" value={formatCurrency(facts.netPnl)} />
                    </div>
                    <p className="text-sm leading-relaxed text-fg-muted">
                      {focus ??
                        (facts.closedTrades > 0
                          ? "Run the weekly review to turn this week into a focus."
                          : "Close a few trades to unlock a weekly focus.")}
                    </p>
                  </div>
                );
              }}
            </CardBody>
          </TodayCard>

          <TodayCard
            title="Watchlist movers"
            icon={<TrendingUp className="h-4 w-4" />}
            view="briefing"
            onNavigate={onNavigate}
          >
            <CardBody
              state={briefing}
              empty="Movers appear once the briefing snapshot is ready."
              onNavigate={onNavigate}
              view="briefing"
            >
              {(result) => {
                const movers = topMovers(result.briefing?.snapshot.watchlist ?? []);
                if (movers.length === 0) {
                  return (
                    <p className="text-sm text-fg-muted">
                      Movers appear once the briefing snapshot is ready.
                    </p>
                  );
                }
                return (
                  <ul className="space-y-1">
                    {movers.map((row) => (
                      <li
                        key={row.symbol}
                        className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="text-[12.5px] font-medium text-fg">{row.symbol}</span>
                          {row.name && (
                            <span className="ml-1.5 truncate text-[11px] text-fg-faint">
                              {row.name}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-fg-muted">
                            {formatNumber(row.last, { maximumFractionDigits: 5 })}
                          </span>
                          <span
                            className={
                              "text-[11px] font-semibold tabular-nums " +
                              (row.changePct == null
                                ? "text-fg-faint"
                                : row.changePct > 0
                                  ? "text-success"
                                  : row.changePct < 0
                                    ? "text-danger"
                                    : "text-fg-muted")
                            }
                          >
                            {fmtPct(row.changePct)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                );
              }}
            </CardBody>
          </TodayCard>
        </div>
      </div>
    </FadeRise>
  );
}

function TodayCard({
  title,
  icon,
  view,
  onNavigate,
  className = "",
  children,
}: {
  title: string;
  icon: ReactNode;
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`flex flex-col p-4 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        <RouteLink
          view={view}
          onNavigate={onNavigate}
          className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-fg-muted transition hover:text-accent"
        >
          Open
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </RouteLink>
      </div>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </Card>
  );
}

/** Shared loading, error and empty states so every card behaves the same. */
function CardBody<T>({
  state,
  empty,
  view,
  onNavigate,
  linkLabel,
  children,
}: {
  state: Loadable<T>;
  empty: string;
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  /** Overrides the default "Open <view>" link text. */
  linkLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">{state.error}</p>
        <RouteLink
          view={view}
          onNavigate={onNavigate}
          className="text-[11px] font-medium text-accent hover:underline"
        >
          {linkLabel ?? `Open ${view}`}
        </RouteLink>
      </div>
    );
  }
  if (state.data == null || isEmpty(state.data)) {
    return <p className="text-sm text-fg-muted">{empty}</p>;
  }
  return <>{children(state.data)}</>;
}

function isEmpty(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-soft px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}
