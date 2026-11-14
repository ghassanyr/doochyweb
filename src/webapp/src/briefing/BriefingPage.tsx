// Daily briefing.
//
// One brief per UTC day, built from the shared watchlist and the signals that are
// still active, then written up by the configured AI provider. The snapshot is
// frozen when the brief is generated, so reopening the page later in the day
// shows the same numbers the prose was written about. Refresh rebuilds it.
//
// This page deliberately does not read the journal: the brief is about the
// market and the published ideas, not the member's own open positions.

import { useCallback, useEffect, useState } from "react";
import { Newspaper, RefreshCw, Sparkles } from "lucide-react";

import { briefingApi, type BriefingRecord, type BriefingResponse } from "../api";
import { FadeRise } from "../components/motion";
import { Badge, Button, Card, Flash, Skeleton } from "../components/ui";
import { formatLocalDateTime } from "../time";

export default function BriefingPage() {
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await briefingApi.get());
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load today's briefing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await briefingApi.refresh());
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not rebuild the briefing.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const briefing = data?.briefing ?? null;

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Newspaper className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-fg">Daily briefing</h3>
            {briefing && (
              <span className="text-[11px] text-fg-faint">
                {briefing.snapshot.dateKey} · built {formatLocalDateTime(briefing.generatedAt)}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={refreshing}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => void refresh()}
            >
              {refreshing ? "Rebuilding" : "Refresh"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Built once a day from the shared watchlist and the signals that are still active. Refreshing
            replaces today's brief with current numbers.
          </p>
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
            No briefing yet. Refresh to build today's.
          </Card>
        ) : (
          <>
            {!data?.aiReady && (
              <Flash tone="warning">
                The written summary is off because no AI provider key is saved. Add one under Admin,
                Integrations (the AI provider card) and refresh. The market summary below is live either
                way.
              </Flash>
            )}

            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-fg">Summary</h3>
                {briefing.model && <Badge tone="muted">{briefing.model}</Badge>}
              </div>
              {briefing.narrative ? (
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">
                  {briefing.narrative}
                </p>
              ) : (
                <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
                  {briefing.error || "No written summary for today."}
                </p>
              )}
            </Card>

            <div className="grid gap-3 lg:grid-cols-2">
              <MoversCard briefing={briefing} />
              <SignalsCard briefing={briefing} />
            </div>
          </>
        )}
      </div>
    </FadeRise>
  );
}

function MoversCard({ briefing }: { briefing: BriefingRecord }) {
  const rows = briefing.snapshot.movers;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">Watchlist moves</h3>
      <p className="mt-0.5 text-[11px] text-fg-faint">Daily close against the previous close.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">
          No daily data was available for the watchlist when this brief was built.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                <th className="py-1 font-medium">Symbol</th>
                <th className="py-1 text-right font-medium">Last</th>
                <th className="py-1 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol} className="border-t border-hairline">
                  <td className="py-1.5 font-medium text-fg">{row.symbol}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.last}</td>
                  <td
                    className={
                      "py-1.5 text-right tabular-nums " +
                      (row.changePct > 0
                        ? "text-success"
                        : row.changePct < 0
                          ? "text-danger"
                          : "text-fg-muted")
                    }
                  >
                    {row.changePct > 0 ? "+" : ""}
                    {row.changePct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SignalsCard({ briefing }: { briefing: BriefingRecord }) {
  const rows = briefing.snapshot.signals;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-fg">Active signals</h3>
      <p className="mt-0.5 text-[11px] text-fg-faint">
        Published ideas that are still waiting for their target or stop.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-fg-muted">No signals were active when this brief was built.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-fg-faint">
                <th className="py-1 font-medium">Symbol</th>
                <th className="py-1 font-medium">Side</th>
                <th className="py-1 text-right font-medium">Entry</th>
                <th className="py-1 text-right font-medium">Target</th>
                <th className="py-1 text-right font-medium">Stop</th>
                <th className="py-1 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-hairline">
                  <td className="py-1.5 font-medium text-fg">{row.symbol}</td>
                  <td className="py-1.5">
                    <Badge tone={row.direction === "buy" ? "success" : "danger"}>
                      {row.direction.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">
                    {row.entry == null ? "-" : row.entry}
                    {row.entryMax != null && ` to ${row.entryMax}`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.target}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.stop}</td>
                  <td className="py-1.5 text-right tabular-nums text-fg-muted">{row.ageHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
