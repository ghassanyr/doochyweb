// Shared presentation for the current Session Analysis page and its history.
//
// Both pages show the same market cards and the same themed email charts, so the
// card, chart filter and modal live here. Only the session selection differs.

import { ArrowDownRight, ArrowUpRight, ImageOff, Maximize2, Plus } from "lucide-react";

import type { SessionDaySummary, SessionMarket } from "../api";
import { AnimatedModal } from "../components/Modal";
import { Button, Card, Skeleton } from "../components/ui";
import type { SignalDirection, SignalDraft } from "../signals/types";
import { useSiteConfig } from "../siteConfig";

// The email charts ship on a #042820 background. The page always tints them to
// the active site canvas so they blend into the card instead of showing the
// email's dark green panel.
const CHART_BACKGROUND = { r: 4, g: 40, b: 32 };
const FALLBACK_CANVAS = { r: 10, g: 14, b: 20 };

export const SESSION_CHART_FILTER = "url(#session-chart-theme)";

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

/** The SVG filter both pages reference through SESSION_CHART_FILTER. */
export function SessionChartDefs() {
  const { mode, theme } = useSiteConfig();
  const canvas = hexRgb(theme.canvas);

  return (
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
  );
}

/** Session name from the subject, highlighted so it reads as the current state. */
export function SessionBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-xs font-semibold tracking-tight text-accent">
      {name}
    </span>
  );
}

/** Label used by the history picker: session first, then the email stamp. */
export function sessionOptionLabel(entry: SessionDaySummary): string {
  const stamp = entry.generatedAt || entry.sessionDate;
  return `${entry.sessionName} - ${stamp} (${entry.marketCount})`;
}

function numericLevel(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function signalDirection(market: SessionMarket): SignalDirection {
  const text = `${market.reason ?? ""} ${market.supporting.join(" ")} ${market.levelNote ?? ""}`.toLowerCase();
  if (/broke (?:through|below|down) (?:the )?support|breakdown|bearish|sell|short/.test(text)) {
    return "sell";
  }
  if (/broke (?:through|above) (?:the )?resistance|breakout|bullish|buy|long/.test(text)) {
    return "buy";
  }
  return market.levelType === "resistance" ? "sell" : "buy";
}

export function sessionSignalDraft(market: SessionMarket): SignalDraft {
  const detail = [market.reason, ...market.supporting, market.levelNote]
    .filter((line): line is string => Boolean(line?.trim()))
    .join(" ");
  const heading = [
    "Session analysis signal",
    market.pattern,
    market.targetPeriod,
    market.identifiedAt,
  ]
    .filter(Boolean)
    .join(" | ");
  return {
    symbol: market.symbol,
    direction: signalDirection(market),
    entry: numericLevel(market.levelValue),
    target: numericLevel(market.targetLevel),
    stop: null,
    note: [heading, detail].filter(Boolean).join("\n").slice(0, 2000),
  };
}

export function LevelIcon({ type }: { type: SessionMarket["levelType"] }) {
  if (type === "support") {
    return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (type === "resistance") {
    return <ArrowUpRight className="h-3.5 w-3.5 text-rose-500" />;
  }
  return null;
}

export function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-right text-[12.5px] font-medium text-fg">
        {value || "Not stated"}
      </span>
    </div>
  );
}

export function SessionCard({
  market,
  onOpenChart,
  onCreateSignal,
}: {
  market: SessionMarket;
  onOpenChart: (market: SessionMarket) => void;
  onCreateSignal?: (market: SessionMarket) => void;
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
            style={{ filter: SESSION_CHART_FILTER }}
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

      {onCreateSignal && (
        <div className="border-t border-hairline p-4 pt-3">
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => onCreateSignal(market)}
          >
            Create signal
          </Button>
        </div>
      )}
    </Card>
  );
}

export function SessionCardSkeleton() {
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

export function SessionLoadingGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {Array.from({ length: count }, (_, index) => (
        <SessionCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function SessionMarkets({
  markets,
  onOpenChart,
  onCreateSignal,
}: {
  markets: SessionMarket[];
  onOpenChart: (market: SessionMarket) => void;
  onCreateSignal?: (market: SessionMarket) => void;
}) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
      {markets.map((market) => (
        <SessionCard
          key={market.symbol}
          market={market}
          onOpenChart={onOpenChart}
          onCreateSignal={onCreateSignal}
        />
      ))}
    </div>
  );
}

export function SessionChartModal({
  chart,
  onClose,
}: {
  chart: SessionMarket | null;
  onClose: () => void;
}) {
  return (
    <AnimatedModal
      open={!!chart}
      onClose={onClose}
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
          style={{ filter: SESSION_CHART_FILTER }}
          className="mx-auto block h-auto max-h-[68vh] w-auto max-w-full rounded-lg border border-hairline"
        />
      )}
      {chart?.reason && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">{chart.reason}</p>
      )}
    </AnimatedModal>
  );
}
