// Daily briefing.
//
// One brief per UTC day, built from the shared watchlist, active signals and the
// member's open journal ideas. The snapshot is frozen when the brief is
// generated, so reopening the page later in the day shows the same numbers the
// write-up was based on. Refresh rebuilds it.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Eye,
  Newspaper,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import {
  briefingApi,
  type BriefingFocusSession,
  type BriefingJournalIdea,
  type BriefingRecord,
  type BriefingResponse,
  type BriefingWatchlistRow,
} from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, Skeleton } from "../components/ui";
import { formatNumber } from "../format";
import { formatLocalDate, formatLocalDateTime, formatCountdown } from "../time";
import { useSiteConfig } from "../siteConfig";

const FOCUS_OPTIONS: { key: BriefingFocusSession; label: string }[] = [
  { key: "asia", label: "Asia" },
  { key: "london", label: "London" },
  { key: "newyork", label: "New York" },
];

function num(value: number | null): string {
  return formatNumber(value, { maximumFractionDigits: 5 });
}

function pct(value: number | null): string {
  if (value == null) return "n/a";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function changeTone(value: number | null): "success" | "danger" | "muted" {
  if (value == null || value === 0) return "muted";
  return value > 0 ? "success" : "danger";
}

function distance(value: number | null): string {
  if (value == null) return "n/a";
  return `${Math.abs(value).toFixed(2)}% ${value >= 0 ? "above" : "below"}`;
}

function sameSessions(a: BriefingFocusSession[], b: BriefingFocusSession[]): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

export default function BriefingPage() {
  const { content } = useSiteConfig();
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [focus, setFocus] = useState<BriefingFocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [savingFocus, setSavingFocus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const loadInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const next = await briefingApi.get();
      if (!mountedRef.current) return;
      setData(next);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || "Could not load today's briefing.");
    } finally {
      loadInFlightRef.current = false;
      if (!silent && mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load]);

  useEffect(() => {
    if (data?.preferences) setFocus(data.preferences.focusSessions);
  }, [data?.preferences]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await briefingApi.refresh();
      if (!mountedRef.current) return;
      setData(next);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || "Could not rebuild the briefing.");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  const retryEnhance = useCallback(async () => {
    setEnhancing(true);
    setRefreshing(true);
    try {
      const next = await briefingApi.enhance();
      if (!mountedRef.current) return;
      setData(next);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setEnhancing(false);
      setError(err?.message || "Could not start the written summary.");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  const saveFocus = useCallback(async () => {
    if (!focus.length) return;
    setSavingFocus(true);
    try {
      await briefingApi.savePreferences(focus);
      const next = await briefingApi.refresh();
      if (!mountedRef.current) return;
      setData(next);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || "Could not save your focus sessions.");
    } finally {
      if (mountedRef.current) setSavingFocus(false);
    }
  }, [focus]);

  const briefing = data?.briefing ?? null;
  const sections = briefing?.sections ?? null;
  const focusDirty = data ? !sameSessions(focus, data.preferences.focusSessions) : false;
  const pendingEnhancement =
    enhancing || briefing?.status === "building" || briefing?.status === "enhancing";

  useEffect(() => {
    if (!pendingEnhancement) {
      if (enhancing && mountedRef.current) setEnhancing(false);
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current !== null) return;
    pollRef.current = window.setInterval(() => {
      void load(true);
    }, 2000);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [enhancing, pendingEnhancement, load]);

  function toggleFocus(key: BriefingFocusSession) {
    setFocus((current) => {
      if (current.includes(key)) {
        return current.length === 1 ? current : current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  }

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-6xl space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Newspaper className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Daily briefing</h3>
            {briefing && (
              <span className="text-[11px] text-fg-faint">
                {briefing.snapshot.dateKey} | built {formatLocalDateTime(briefing.generatedAt)}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={refreshing || pendingEnhancement}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void refresh()}
            >
              {refreshing ? "Rebuilding" : pendingEnhancement ? "Enhancing" : "Refresh"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Built once a day from your watchlist, active signals and open journal ideas. Refreshing
            replaces today's brief with current numbers.
          </p>

          {briefing && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-fg-faint">
                Focus sessions
              </span>
              {FOCUS_OPTIONS.map((option) => {
                const active = focus.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleFocus(option.key)}
                    className={
                      "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition " +
                      (active
                        ? "border-accent/40 bg-accent-soft text-accent"
                        : "border-hairline-strong bg-soft text-fg-muted hover:border-fg-faint")
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={!focusDirty || savingFocus || !focus.length}
                icon={<Save className="h-3.5 w-3.5" />}
                onClick={() => void saveFocus()}
              >
                {savingFocus ? "Saving" : "Save and rebuild"}
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-3">
              <Flash tone="danger">{error}</Flash>
            </div>
          )}
        </Card>

        {loading ? (
          <Card className="p-4">
            <Skeleton className="h-24 w-full" />
          </Card>
        ) : !briefing ? (
          <Card className="p-6 text-sm text-fg-muted">
            {content.emptyStates.briefing}
          </Card>
        ) : (
          <>
            {pendingEnhancement && (
              <Flash
                tone="warning"
                icon={<RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
              >
                Building the written summary. The structured data below is ready.
              </Flash>
            )}
            {!data?.aiReady && (
              <Flash tone="warning">
                The written summary is off because no AI provider key is saved. Add one under Admin,
                Integrations (the AI provider card) and refresh. The structured data below is live
                either way.
              </Flash>
            )}
            {data?.aiReady && !pendingEnhancement && briefing.error && (
              <div className="space-y-2">
                <Flash tone="warning">{briefing.error}</Flash>
                <Button size="sm" variant="secondary" onClick={() => void retryEnhance()}>
                  Retry written summary
                </Button>
              </div>
            )}

            <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 space-y-3">
                <BriefingHero briefing={briefing} />
                <WatchlistSection briefing={briefing} />
              </div>

              <aside className="min-w-0 space-y-3">
                <JournalIdeasSection briefing={briefing} />
                <SignalsSection briefing={briefing} />
                <BulletCard
                  title="Key risks"
                  subtitle="Limits and data gaps in this brief."
                  icon={<ShieldAlert className="h-4 w-4 text-accent" />}
                  items={sections?.risks ?? []}
                  empty="No specific risks were supplied."
                />
                <BulletCard
                  title="What to monitor"
                  subtitle="Recorded levels and daily ranges."
                  icon={<Eye className="h-4 w-4 text-accent" />}
                  items={sections?.monitor ?? []}
                  empty="No monitoring levels were supplied."
                />
                <DataNotesCard briefing={briefing} />
              </aside>
            </div>
          </>
        )}
      </div>
    </FadeRise>
  );
}

function BriefingHero({ briefing }: { briefing: BriefingRecord }) {
  const sections = briefing.sections;
  const overview = sections?.overview || briefing.narrative;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <span className="text-[11px] uppercase tracking-wider text-fg-faint">
          {formatLocalDate(briefing.generatedAt)}
        </span>
        {briefing.model && <Badge tone="muted">{briefing.model}</Badge>}
      </div>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-fg">
        {sections?.headline || "Daily market briefing"}
      </h2>
      {overview ? (
        <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">
          {overview}
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
          {briefing.error || "No written summary for today."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {briefing.snapshot.sessions.map((session) => (
          <div key={session.key} className="flex items-center gap-1.5">
            <Badge tone={session.status === "open" ? "success" : "muted"}>
              {session.label} {session.status}
              {session.nextChange ? `, ${session.nextChange}` : ""}
            </Badge>
            <SessionCountdown at={session.nextChangeAt} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SessionCountdown({ at }: { at: string | null }) {
  const target = at ? new Date(at).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!Number.isFinite(target)) return null;
  const label = formatCountdown(target - now);
  return (
    <span className="rounded-md border border-hairline bg-soft px-2 py-0.5 text-xs font-medium tabular-nums text-fg-faint">
      {label ? `in ${label}` : "now"}
    </span>
  );
}

function WatchlistSection({ briefing }: { briefing: BriefingRecord }) {
  const rows = briefing.snapshot.watchlist;
  const notes = new Map((briefing.sections?.watchlist ?? []).map((note) => [note.symbol, note]));
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Your watchlist</h3>
      </div>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        Daily close against the previous close, with recorded plans and levels.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          No watchlist symbols were available when this brief was built.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {rows.map((row) => (
            <WatchlistCard key={row.symbol} row={row} note={notes.get(row.symbol)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function WatchlistCard({
  row,
  note,
}: {
  row: BriefingWatchlistRow;
  note?: { whatHappened: string; whyItMatters: string; watchFor: string };
}) {
  return (
    <div className="rounded-xl border border-hairline bg-soft p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{row.symbol}</span>
        <Badge tone={changeTone(row.changePct)}>{pct(row.changePct)}</Badge>
        {row.quote && (
          <span className="ml-auto text-[11px] text-fg-faint">
            {num(row.quote.price)} {row.quote.source === "daily" ? "daily close" : "latest"}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Last" value={num(row.last)} />
        <Metric label="Day high" value={num(row.dayHigh)} />
        <Metric label="Day low" value={num(row.dayLow)} />
      </div>
      <NoteRow label="What happened" text={note?.whatHappened} />
      <NoteRow label="Why it matters" text={note?.whyItMatters} />
      <NoteRow label="Watch for" text={note?.watchFor} />
    </div>
  );
}

function NoteRow({ label, text }: { label: string; text?: string }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-faint">{label}</div>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-muted">
        {text || "No written note for this symbol."}
      </p>
    </div>
  );
}

function JournalIdeasSection({ briefing }: { briefing: BriefingRecord }) {
  const ideas = briefing.snapshot.journalIdeas;
  const notes = new Map((briefing.sections?.journalIdeas ?? []).map((note) => [note.id, note]));
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Open journal ideas</h3>
      </div>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        Open journal entries with their recorded plan levels and current quote.
      </p>
      {ideas.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          No open journal ideas were recorded when this brief was built.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {ideas.map((idea) => (
            <JournalIdeaCard key={idea.id} idea={idea} update={notes.get(idea.id)?.update} />
          ))}
        </div>
      )}
    </Card>
  );
}

function JournalIdeaCard({ idea, update }: { idea: BriefingJournalIdea; update?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-soft p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">{idea.symbol}</span>
        <Badge tone={idea.side === "buy" ? "success" : "danger"}>{idea.side.toUpperCase()}</Badge>
        <Badge tone={idea.verified ? "muted" : "accent"}>
          {idea.verified ? "Verified" : "Unverified"}
        </Badge>
        {idea.openedAt && (
          <span className="ml-auto text-[11px] text-fg-faint">
            opened {formatLocalDateTime(idea.openedAt)}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <Metric label="Entry" value={num(idea.entryPrice)} />
        <Metric label="Stop" value={num(idea.stop)} />
        <Metric label="Target" value={num(idea.target)} />
        <Metric label="Current" value={num(idea.quote?.price ?? null)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-fg-faint">
        <span>To entry: {distance(idea.toEntryPct)}</span>
        <span>To stop: {distance(idea.toStopPct)}</span>
        <span>To target: {distance(idea.toTargetPct)}</span>
      </div>
      {update && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-fg-muted">{update}</p>
      )}
      {idea.note && (
        <p className="mt-2 border-t border-hairline pt-2 text-[11px] leading-relaxed text-fg-faint">
          {idea.note}
        </p>
      )}
    </div>
  );
}

function SignalsSection({ briefing }: { briefing: BriefingRecord }) {
  const rows = briefing.snapshot.signals;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">Published signals</h3>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        Active ideas that are still waiting for their target or stop.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          No signals were active when this brief was built.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-hairline bg-soft p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-fg">{row.symbol}</span>
                <Badge tone={row.direction === "buy" ? "success" : "danger"}>
                  {row.direction.toUpperCase()}
                </Badge>
                <span className="ml-auto text-[11px] text-fg-faint">{row.ageHours}h old</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <Metric label="Entry" value={row.entry == null ? "-" : num(row.entry)} />
                <Metric label="Current" value={num(row.quote?.price ?? null)} />
                <Metric label="Target" value={num(row.target)} />
                <Metric label="Stop" value={num(row.stop)} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-fg-faint">
                <span>To target: {distance(row.toTargetPct)}</span>
                {row.entryMax != null && <span>Entry up to {num(row.entryMax)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function BulletCard({
  title,
  subtitle,
  icon,
  items,
  empty,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: string[];
  empty: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-0.5 text-[11px] text-fg-faint">{subtitle}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-fg-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DataNotesCard({ briefing }: { briefing: BriefingRecord }) {
  const notes = [
    ...new Set([...(briefing.sections?.caveats ?? []), ...briefing.snapshot.dataNotes]),
  ];
  if (!notes.length) return null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">Data notes and caveats</h3>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        Sources, gaps and limits behind this brief.
      </p>
      <ul className="mt-3 space-y-1.5">
        {notes.map((note) => (
          <li key={note} className="text-[12px] leading-relaxed text-fg-muted">
            {note}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="tabular-nums text-fg-muted">{value}</div>
    </div>
  );
}
