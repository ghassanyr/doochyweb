import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, Clock, Inbox, RefreshCw, Search } from "lucide-react";

import {
  economicNewsApi,
  type EconomicNewsEvent,
  type EconomicNewsResponse,
  type SessionSyncResult,
} from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, Skeleton } from "../components/ui";
import {
  formatCountdown,
  formatLocalDateTime,
  formatLocalTime,
  localDayKey,
  localDayLabel,
  timeZoneLabel,
} from "../time";

type Range = "upcoming" | "recent" | "all";

const RANGES: readonly { key: Range; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "recent", label: "Recent 24h" },
  { key: "all", label: "All" },
];

function eventTime(event: EconomicNewsEvent): number {
  return new Date(event.startsAt).getTime();
}

function utcTime(event: EconomicNewsEvent): string {
  const date = new Date(event.startsAt);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 16) : "--:--";
}

function statusOf(event: EconomicNewsEvent, now: number): { label: string; tone: "accent" | "success" | "muted" } {
  const starts = eventTime(event);
  if (starts > now) return { label: "Upcoming", tone: "accent" };
  if (now - starts <= 30 * 60 * 1000) return { label: "Just started", tone: "success" };
  return { label: "Finished", tone: "muted" };
}

export default function EconomicNewsPage({ isAdmin }: { isAdmin: boolean }) {
  const [response, setResponse] = useState<EconomicNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SessionSyncResult | null>(null);
  const [range, setRange] = useState<Range>("upcoming");
  const [country, setCountry] = useState("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResponse(await economicNewsApi.all());
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load economic news");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function sync() {
    setSyncResult(null);
    try {
      const result = await economicNewsApi.sync();
      setSyncResult(result);
      await load();
    } catch (err) {
      setSyncResult({
        ok: false,
        configured: true,
        imported: false,
        sessionKey: null,
        markets: 0,
        message: err instanceof Error ? err.message : "Mailbox check failed",
        checkedAt: new Date().toISOString(),
      });
    }
  }

  const countries = useMemo(
    () =>
      [...new Set((response?.events ?? []).map((event) => event.country))]
        .filter(Boolean)
        .sort(),
    [response]
  );

  const events = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (response?.events ?? [])
      .filter((event) => {
        const starts = eventTime(event);
        if (range === "upcoming" && starts < now - 5 * 60 * 1000) return false;
        if (range === "recent" && starts >= now) return false;
        if (country !== "all" && event.country !== country) return false;
        if (!needle) return true;
        return `${event.title} ${event.country} ${event.subject}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => eventTime(a) - eventTime(b));
  }, [response, range, country, query, now]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EconomicNewsEvent[]>();
    for (const event of events) {
      const key = localDayKey(event.startsAt);
      const list = grouped.get(key) ?? [];
      list.push(event);
      grouped.set(key, list);
    }
    return [...grouped.entries()];
  }, [events]);

  const spotlight = events.find((event) => eventTime(event) > now) ?? null;
  const countdown = spotlight ? formatCountdown(eventTime(spotlight) - now) : null;

  return (
    <FadeRise>
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Economic News</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            High-impact events from the same mailbox that feeds Session Analysis.
          </p>
        </header>

        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-hairline bg-soft p-0.5">
              {RANGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={range === item.key}
                  onClick={() => setRange(item.key)}
                  className={
                    "rounded px-2.5 py-1 text-xs font-medium transition " +
                    (range === item.key
                      ? "bg-surface text-fg shadow-sm"
                      : "text-fg-muted hover:text-fg")
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex min-w-[180px] items-center gap-2 rounded-md border border-hairline bg-soft px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-fg-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events"
                className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
              />
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  onClickAsync={sync}
                >
                  Check inbox now
                </Button>
              )}
            </div>
          </div>
          {countries.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {["all", ...countries].map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={country === code}
                  onClick={() => setCountry(code)}
                  className={
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition " +
                    (country === code
                      ? "border-accent/30 bg-accent-soft text-accent"
                      : "border-hairline text-fg-muted hover:bg-surface-hover hover:text-fg")
                  }
                >
                  {code === "all" ? "All regions" : code}
                </button>
              ))}
            </div>
          )}
        </Card>

        {syncResult && (
          <Flash
            tone={
              syncResult.ok
                ? (syncResult.news?.events ?? 0) > 0
                  ? "success"
                  : "warning"
                : "danger"
            }
          >
            {syncResult.message}
          </Flash>
        )}

        {error && (
          <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mr-2 inline h-4 w-4 align-[-3px]" />
            {error}
          </Card>
        )}

        {loading && !response ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : spotlight && range !== "recent" ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <CalendarDays className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Next event
                </div>
                <div className="mt-0.5 text-lg font-semibold text-fg">{spotlight.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <Badge tone="accent">{spotlight.country}</Badge>
                  <span>{formatLocalDateTime(spotlight.startsAt)}</span>
                  <span className="text-fg-faint">{utcTime(spotlight)} UTC</span>
                  <span className="text-fg-faint">{timeZoneLabel({ at: spotlight.startsAt })}</span>
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-2xl font-semibold tabular-nums text-accent">
                  {countdown ?? "Now"}
                </div>
                <div className="text-xs text-fg-faint">{countdown ? "until release" : "starting"}</div>
              </div>
            </div>
          </Card>
        ) : null}

        {!loading && response && events.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Inbox className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm text-fg-muted">No economic news events match this view.</div>
            <div className="mt-1 text-xs leading-relaxed text-fg-faint">
              {isAdmin
                ? "Use Check inbox now after saving the IMAP integration in Admin."
                : "Upcoming events appear here after the server reads the news mailbox."}
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map(([day, dayEvents]) => (
              <section key={day} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-fg-faint" />
                  <h2 className="text-sm font-semibold text-fg">
                    {localDayLabel(dayEvents[0]!.startsAt, { now: new Date(now) })}
                  </h2>
                  <span className="text-xs text-fg-faint">{dayEvents.length} events</span>
                </div>
                <div className="space-y-2">
                  {dayEvents.map((event) => {
                    const status = statusOf(event, now);
                    return (
                      <Card key={event.eventKey} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="muted">{event.country}</Badge>
                          <span className="text-sm font-semibold tabular-nums text-fg">
                            {formatLocalTime(event.startsAt)}
                          </span>
                          <span className="text-xs text-fg-faint">{utcTime(event)} UTC</span>
                          <span className="ml-auto">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-fg">{event.title}</div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {response && (
          <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
            {response.latestReceivedAt
              ? `Latest mailbox read: ${formatLocalDateTime(response.latestReceivedAt)}.`
              : "No news email has been imported yet."}
          </p>
        )}
      </div>
    </FadeRise>
  );
}
