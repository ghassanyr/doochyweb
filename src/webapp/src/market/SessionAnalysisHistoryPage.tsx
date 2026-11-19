// Session Analysis history: the sessions that were replaced by a newer email.
//
// The current session lives on /session-analysis. This page lists only the
// older ones, newest first, and uses the same cards and chart theming so a
// session looks identical in both places.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, History } from "lucide-react";

import {
  sessionAnalysisApi,
  type SessionDay,
  type SessionDaySummary,
  type SessionMarket,
} from "../api";
import { FadeRise } from "../components/motion";
import { Button, Card, Flash } from "../components/ui";
import { PublishSignalModal } from "../signals/PublishSignalModal";
import type { SignalDraft } from "../signals/types";
import {
  SessionBadge,
  SessionChartDefs,
  SessionChartModal,
  SessionLoadingGrid,
  SessionMarkets,
  sessionOptionLabel,
  sessionSignalDraft,
} from "./SessionAnalysisShared";

export default function SessionAnalysisHistoryPage({
  isAdmin,
  onOpenCurrent,
}: {
  isAdmin: boolean;
  onOpenCurrent: () => void;
}) {
  const [days, setDays] = useState<SessionDaySummary[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [day, setDay] = useState<SessionDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<SessionMarket | null>(null);
  const [signalDraft, setSignalDraft] = useState<SignalDraft | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const loadDetail = useCallback(async (sessionKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await sessionAnalysisApi.day(sessionKey);
      setDay(detail.day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the session");
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await sessionAnalysisApi.days();
      // The list is newest first, so its first entry is the session on
      // /session-analysis. That one is never repeated here.
      const currentKey = list.days[0]?.sessionKey ?? null;
      const older = list.days.filter((entry) => entry.sessionKey !== currentKey);
      setDays(older);

      if (older.length === 0) {
        setSelected("");
        setDay(null);
        setLoading(false);
        return;
      }

      const first = older[0]!.sessionKey;
      setSelected(first);
      await loadDetail(first);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session history");
      setLoading(false);
    }
  }, [loadDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!publishNotice) return;
    const id = window.setTimeout(() => setPublishNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [publishNotice]);

  function choose(sessionKey: string) {
    setSelected(sessionKey);
    setDay(null);
    setChart(null);
    void loadDetail(sessionKey);
  }

  return (
    <FadeRise>
      <SessionChartDefs />
      <div className="space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Session history</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              Older daily sessions, newest first.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={onOpenCurrent}
          >
            Current session
          </Button>
        </header>

        <Card className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {day ? (
              <SessionBadge name={day.sessionName} />
            ) : (
              <span className="text-xs font-medium text-fg">
                {loading ? "Loading session" : "No earlier sessions yet"}
              </span>
            )}

            {days.length > 1 && (
              <select
                value={selected}
                onChange={(event) => choose(event.target.value)}
                className="ml-auto max-w-full rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                aria-label="Choose an older session"
              >
                {days.map((entry) => (
                  <option key={entry.sessionKey} value={entry.sessionKey}>
                    {sessionOptionLabel(entry)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <p className="border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-fg-faint">
            A session moves here when the next analysis email arrives.
          </p>
        </Card>

        {error && (
          <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mr-2 inline h-4 w-4 align-[-3px]" />
            {error}
          </Card>
        )}

        {publishNotice && <Flash tone="success">{publishNotice}</Flash>}

        {loading && !day ? (
          <SessionLoadingGrid />
        ) : days.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <History className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm text-fg-muted">No earlier sessions yet.</div>
            <div className="mt-1 text-xs leading-relaxed text-fg-faint">
              The current session moves here when the next analysis email arrives.
            </div>
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={onOpenCurrent}>
                Current session
              </Button>
            </div>
          </Card>
        ) : !day ? null : day.markets.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <History className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm text-fg-muted">
              This session has no markets stored.
            </div>
          </Card>
        ) : (
          <SessionMarkets
            markets={day.markets}
            onOpenChart={setChart}
            onCreateSignal={
              isAdmin ? (market) => setSignalDraft(sessionSignalDraft(market)) : undefined
            }
          />
        )}

        {day && day.markets.length > 0 && (
          <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
            Not financial advice.
          </p>
        )}
      </div>

      <SessionChartModal chart={chart} onClose={() => setChart(null)} />
      <PublishSignalModal
        draft={signalDraft}
        onClose={() => setSignalDraft(null)}
        onSaved={(signal) => setPublishNotice(`Signal published for ${signal.symbol}.`)}
      />
    </FadeRise>
  );
}
