// Session Analysis: the newest daily AI market analysis email, copied as it
// arrived.
//
// One card per market from the message. The text is shown verbatim and the
// chart is the exact image the email embedded, not a regenerated chart. Older
// sessions live on /session-analysis/history. The page is public like Analysis;
// only the mailbox check is admin-only.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, History, Inbox } from "lucide-react";

import {
  sessionAnalysisApi,
  type SessionDay,
  type SessionMarket,
  type SessionSyncResult,
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
  sessionSignalDraft,
} from "./SessionAnalysisShared";

export default function SessionAnalysisPage({
  isAdmin,
  onOpenHistory,
}: {
  isAdmin: boolean;
  onOpenHistory: () => void;
}) {
  const [day, setDay] = useState<SessionDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SessionSyncResult | null>(null);
  const [chart, setChart] = useState<SessionMarket | null>(null);
  const [signalDraft, setSignalDraft] = useState<SignalDraft | null>(null);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const latest = await sessionAnalysisApi.latest();
      setDay(latest.day);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session analysis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!publishNotice) return;
    const id = window.setTimeout(() => setPublishNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [publishNotice]);

  async function sync() {
    setSyncResult(null);
    try {
      const result = await sessionAnalysisApi.sync();
      setSyncResult(result);
      if (result.imported) await load();
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

  return (
    <FadeRise>
      <SessionChartDefs />
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Session Analysis</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            The latest session from the daily AI market analysis.
          </p>
        </header>

        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            {day ? (
              <SessionBadge name={day.sessionName} />
            ) : (
              <span className="text-xs font-medium text-fg">No session stored yet</span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<History className="h-3.5 w-3.5" />}
                onClick={onOpenHistory}
              >
                History
              </Button>
              {isAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Inbox className="h-3.5 w-3.5" />}
                  onClickAsync={sync}
                >
                  Check inbox now
                </Button>
              )}
            </div>
          </div>
        </Card>

        {syncResult && (
          <Flash
            tone={syncResult.ok ? (syncResult.imported ? "success" : "warning") : "danger"}
          >
            {syncResult.message}
          </Flash>
        )}

        {publishNotice && <Flash tone="success">{publishNotice}</Flash>}

        {error && (
          <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mr-2 inline h-4 w-4 align-[-3px]" />
            {error}
          </Card>
        )}

        {loading && !day ? (
          <SessionLoadingGrid />
        ) : !day || day.markets.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Inbox className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm text-fg-muted">No session analysis has been imported yet.</div>
            <div className="mt-1 text-xs leading-relaxed text-fg-faint">
              {isAdmin
                ? "Add the IMAP mailbox in Admin, Integrations, then use Check inbox now."
                : "The latest daily analysis will appear here after the server imports it."}
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
            Copied from the daily AI market analysis. Not financial advice.
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
