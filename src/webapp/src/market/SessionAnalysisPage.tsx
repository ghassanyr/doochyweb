// Session Analysis: the daily AI market analysis email, copied as it arrived.
//
// One card per market from the message. The text is shown verbatim and the
// chart is the exact image the email embedded, not a regenerated chart. The
// page is public like Analysis; only the mailbox check is admin-only.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  ImageOff,
  Inbox,
  Maximize2,
} from "lucide-react";

import {
  sessionAnalysisApi,
  type SessionDay,
  type SessionDaySummary,
  type SessionMarket,
  type SessionSyncResult,
} from "../api";
import { FadeRise } from "../components/motion";
import { AnimatedModal } from "../components/Modal";
import { Button, Card, Flash, Skeleton } from "../components/ui";
import { useSiteConfig } from "../siteConfig";

// The email charts ship on a #042820 background. The page always tints them to
// the active site canvas so they blend into the card instead of showing the
// email's dark green panel.
const CHART_BACKGROUND = { r: 4, g: 40, b: 32 };
const FALLBACK_CANVAS = { r: 10, g: 14, b: 20 };

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return FALLBACK_CANVAS;
  const value = Number.parseInt(match[1]!, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * Channel transfer that maps the chart background exactly onto the site canvas.
 *
 * Dark canvases sit close to the email background, so a plain offset blends the
 * chart in while keeping every line and candle colour intact. A light canvas is
 * far away, so the channel is inverted instead: the background lands on the
 * canvas and the dark chart elements become dark ink on a light card.
 */
function chartTransfer(
  canvas: { r: number; g: number; b: number },
  channel: "r" | "g" | "b",
  mode: "light" | "dark"
): { slope: number; intercept: string } {
  const background = CHART_BACKGROUND[channel];
  const target = canvas[channel];
  if (mode === "light") {
    return { slope: -1, intercept: ((target + background) / 255).toFixed(6) };
  }
  return { slope: 1, intercept: ((target - background) / 255).toFixed(6) };
}

function dayStamp(day: SessionDay): string {
  return day.generatedAt || day.sessionDate;
}

function isSameDay(a: SessionDaySummary, b: SessionDay): boolean {
  return a.sessionKey === b.sessionKey;
}

function LevelIcon({ type }: { type: SessionMarket["levelType"] }) {
  if (type === "support") {
    return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (type === "resistance") {
    return <ArrowUpRight className="h-3.5 w-3.5 text-rose-500" />;
  }
  return null;
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-right text-[12.5px] font-medium text-fg">
        {value || "Not stated"}
      </span>
    </div>
  );
}

function SessionCard({
  market,
  chartFilter,
  onOpenChart,
}: {
  market: SessionMarket;
  chartFilter?: string;
  onOpenChart: (market: SessionMarket) => void;
}) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-tight text-fg">
            {market.symbol}
          </h2>
          <p className="mt-0.5 text-[11px] text-fg-faint">Target Level</p>
          <p className="tabular-nums text-xl font-semibold tracking-tight text-fg">
            {market.targetLevel || "Not stated"}
          </p>
        </div>
        {market.pattern && (
          <span className="shrink-0 rounded-full border border-accent/20 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
            {market.pattern}
          </span>
        )}
      </div>

      {market.chartUrl ? (
        <button
          type="button"
          onClick={() => onOpenChart(market)}
          aria-label={`Open the ${market.symbol} chart from the email`}
          className="group relative block w-full border-b border-hairline bg-canvas p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        >
          <img
            src={market.chartUrl}
            alt={`${market.symbol} chart from the daily AI market analysis email`}
            width={270}
            height={370}
            loading="lazy"
            style={chartFilter ? { filter: chartFilter } : undefined}
            className="mx-auto block h-auto w-full max-w-[270px] rounded-md border border-hairline"
          />
          <span className="absolute right-4 top-4 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 border-b border-hairline bg-canvas px-4 py-8 text-center">
          <ImageOff className="h-5 w-5 text-fg-faint" />
          <p className="text-[11px] text-fg-faint">No chart image was attached to this market.</p>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <MetaRow label="Target Period" value={market.targetPeriod} />
          <MetaRow label="Interval" value={market.interval} />
          <MetaRow label="Pattern" value={market.pattern} />
          <MetaRow label="Identified" value={market.identifiedAt} />
        </div>

        {market.reason && (
          <p className="text-[12.5px] leading-relaxed text-fg-muted">{market.reason}</p>
        )}

        {market.supporting.length > 0 && (
          <div className="space-y-1">
            {market.supporting.map((line) => (
              <p key={line} className="text-[12px] leading-relaxed text-fg-muted">
                {line}
              </p>
            ))}
          </div>
        )}

        {market.levelType && (
          <div className="mt-auto rounded-lg border border-hairline bg-canvas/50 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
              <LevelIcon type={market.levelType} />
              {market.levelType === "support" ? "Support" : "Resistance"}
            </div>
            <div className="tabular-nums text-[13px] font-medium text-fg">
              {market.levelValue || "Not stated"}
            </div>
            {market.levelNote && (
              <div className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
                {market.levelNote}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-2 border-b border-hairline px-4 py-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="border-b border-hairline p-3">
        <Skeleton className="mx-auto h-[260px] w-[190px]" />
      </div>
      <div className="space-y-2 p-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </Card>
  );
}

export default function SessionAnalysisPage({ isAdmin }: { isAdmin: boolean }) {
  const { mode, theme } = useSiteConfig();
  const [day, setDay] = useState<SessionDay | null>(null);
  const [days, setDays] = useState<SessionDaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("latest");
  const [syncResult, setSyncResult] = useState<SessionSyncResult | null>(null);
  const [chart, setChart] = useState<SessionMarket | null>(null);

  const canvas = hexRgb(theme.canvas);
  const chartFilter = "url(#session-chart-theme)";

  const load = useCallback(async (sessionKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      if (sessionKey && sessionKey !== "latest") {
        const [detail, list] = await Promise.all([
          sessionAnalysisApi.day(sessionKey),
          sessionAnalysisApi.latest(),
        ]);
        setDay(detail.day);
        setDays(list.days);
      } else {
        const latest = await sessionAnalysisApi.latest();
        setDay(latest.day);
        setDays(latest.days);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session analysis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentKey = useMemo(() => {
    if (selected !== "latest") return selected;
    if (day && days.some((entry) => isSameDay(entry, day))) return day.sessionKey;
    return days[0]?.sessionKey ?? "latest";
  }, [day, days, selected]);

  async function sync() {
    setSyncResult(null);
    try {
      const result = await sessionAnalysisApi.sync();
      setSyncResult(result);
      if (result.imported) {
        setSelected("latest");
        await load();
      }
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
      <svg
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <filter id="session-chart-theme" colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR
                type="linear"
                slope={chartTransfer(canvas, "r", mode).slope}
                intercept={chartTransfer(canvas, "r", mode).intercept}
              />
              <feFuncG
                type="linear"
                slope={chartTransfer(canvas, "g", mode).slope}
                intercept={chartTransfer(canvas, "g", mode).intercept}
              />
              <feFuncB
                type="linear"
                slope={chartTransfer(canvas, "b", mode).slope}
                intercept={chartTransfer(canvas, "b", mode).intercept}
              />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <div className="space-y-3">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Session Analysis</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            The daily AI market analysis email, copied exactly as it arrived.
          </p>
        </header>

        <Card className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
              Session
            </span>
            {days.length > 1 ? (
              <select
                value={currentKey}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelected(next);
                  void load(next);
                }}
                className="rounded-md border border-hairline bg-surface px-2 py-1 text-xs font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                aria-label="Choose a session date"
              >
                {days.map((entry) => (
                  <option key={entry.sessionKey} value={entry.sessionKey}>
                    {entry.generatedAt || entry.sessionDate} ({entry.marketCount})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-medium text-fg">
                {day ? dayStamp(day) : "No session stored yet"}
              </span>
            )}

            {day && (
              <span className="text-[11px] text-fg-faint">
                {day.markets.length} market{day.markets.length === 1 ? "" : "s"} from{" "}
                {day.subject}
              </span>
            )}

            {isAdmin && (
              <div className="ml-auto">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Inbox className="h-3.5 w-3.5" />}
                  onClickAsync={sync}
                >
                  Check inbox now
                </Button>
              </div>
            )}
          </div>

          <p className="border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-fg-faint">
            Imported automatically from the dedicated analysis mailbox. The server checks every
            six hours by default, and an administrator can run a check immediately.
          </p>
        </Card>

        {syncResult && (
          <Flash
            tone={
              syncResult.ok ? (syncResult.imported ? "success" : "warning") : "danger"
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

        {loading && !day ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {Array.from({ length: 6 }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
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
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {day.markets.map((market) => (
              <SessionCard
                key={market.symbol}
                market={market}
                chartFilter={chartFilter}
                onOpenChart={setChart}
              />
            ))}
          </div>
        )}

        {day && day.markets.length > 0 && (
          <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
            Copied from the daily AI market analysis email. Not financial advice.
          </p>
        )}
      </div>

      <AnimatedModal
        open={!!chart}
        onClose={() => setChart(null)}
        title={chart ? `${chart.symbol} chart` : "Chart"}
        subtitle={chart?.pattern || undefined}
        size="lg"
      >
        {chart?.chartUrl && (
          <img
            src={chart.chartUrl}
            alt={`${chart.symbol} chart from the daily AI market analysis email`}
            width={270}
            height={370}
            style={chartFilter ? { filter: chartFilter } : undefined}
            className="mx-auto block h-auto max-h-[68vh] w-auto max-w-full rounded-lg border border-hairline"
          />
        )}
        {chart?.reason && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">{chart.reason}</p>
        )}
      </AnimatedModal>
    </FadeRise>
  );
}
