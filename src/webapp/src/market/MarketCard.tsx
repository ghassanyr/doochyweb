import { memo } from "react";
import { RefreshCw, X } from "lucide-react";

import { Card, Skeleton } from "../components/ui";
import { MtfConfluence, MtfConfluenceSkeleton } from "./MtfConfluence";
import { RatingDial } from "./RatingDial";
import { Sparkline } from "./Sparkline";
import {
  barAge,
  changeTone,
  fmtChangePct,
  fmtPrice,
  providerName,
  RATINGS,
  ratingColor,
  ratingLabel,
  timeAgo,
} from "./ratings";
import type { MarketAnalysis, Section } from "./types";

// Card action handlers take the symbol rather than a per-card closure. That
// keeps their identity stable across renders, which is what lets the memo()
// below actually skip work - the grid re-renders on the refresh countdown, and
// rebuilding nine dial + sparkline SVGs every second is what made the cards
// feel sluggish.
interface CardProps {
  analysis: MarketAnalysis;
  strongRatio: number;
  refreshing: boolean;
  /** Signed-in users can force a broker read; anonymous visitors cannot. */
  canRefresh: boolean;
  /** Only admins can change the shared watchlist. */
  canRemove: boolean;
  onOpen: (symbol: string) => void;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

// One source now (cTrader), so the badge just says where the bars came from,
// with a dot that distinguishes a cache hit from a fresh broker read.
function SourceBadge({ a }: { a: MarketAnalysis }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={"h-1.5 w-1.5 shrink-0 rounded-full " + (a.cached ? "bg-fg-faint" : "bg-accent")}
      />
      <span className="truncate text-fg-faint text-[10.5px]">{providerName(a.provider)}</span>
    </span>
  );
}

function SweepBadge({ kind, stale }: { kind: "high" | "low" | "both"; stale?: boolean }) {
  const color =
    kind === "high" ? RATINGS.sell.color : kind === "low" ? RATINGS.buy.color : RATINGS.neutral.color;
  const label = kind === "high" ? "4H high" : kind === "low" ? "4H low" : "4H both";
  const title =
    kind === "high"
      ? "4H candle swept the prior 5 highs and closed back below"
      : kind === "low"
        ? "4H candle swept the prior 5 lows and closed back above"
        : "4H candle swept both the prior highs and lows and closed back inside";
  return (
    <span
      className={
        "shrink-0 rounded-[5px] border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide" +
        (stale ? " opacity-50" : "")
      }
      style={{ color, borderColor: color }}
      title={stale ? `${title} (bars are stale)` : title}
    >
      {label}
    </span>
  );
}

function EngulfBadge({
  kind,
  barClose,
  stale,
}: {
  kind: "bullish" | "bearish";
  barClose?: number | null;
  stale?: boolean;
}) {
  const bull = kind === "bullish";
  const color = bull ? RATINGS.buy.color : RATINGS.sell.color;
  const age = barAge(barClose);
  const title =
    (bull ? "Bullish" : "Bearish") +
    " engulfing on the last closed bar (body >= 1.3x prior, close clears the prior wick)" +
    (barClose ? `, closed ${new Date(barClose).toLocaleString()}` : "") +
    (stale ? " - bars are stale" : "");
  return (
    <span
      className={
        "shrink-0 rounded-[5px] border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide" +
        (stale ? " opacity-50" : "")
      }
      style={{ color, borderColor: color }}
      title={title}
    >
      {bull ? "Bull engulf" : "Bear engulf"}
      {age ? ` · ${age}` : ""}
    </span>
  );
}

// Gauge lays these out as two side-by-side recessed panels under the dial.
function SubSummary({ title, section }: { title: string; section: Section }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-hairline bg-soft px-2.5 py-1.5">
      <span className="text-[10.5px] uppercase tracking-wide text-fg-faint">{title}</span>
      <span className="text-[13px] font-semibold" style={{ color: ratingColor(section.rating) }}>
        {ratingLabel(section.rating)}
      </span>
      <span className="text-[10.5px] tabular-nums text-fg-muted">
        {section.buy} buy · {section.sell} sell · {section.neutral} neut
      </span>
    </div>
  );
}

function MarketCardInner({ analysis, strongRatio, refreshing, canRefresh, canRemove, onOpen, onRefresh, onRemove }: CardProps) {
  const a = analysis;
  const color = ratingColor(a.summary.rating);
  const warningTitle = a.warnings?.length
    ? a.warnings.map((w) => `${w.provider}: ${w.message}`).join(" | ")
    : undefined;

  return (
    <Card
      interactive
      className={
        "relative flex flex-col gap-2.5 p-4 pb-3 transition-opacity " + (refreshing ? "opacity-60" : "")
      }
    >
      {/* Whole-card click target, behind the content. */}
      <button
        type="button"
        onClick={() => onOpen(a.symbol)}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Open ${a.symbol} analysis`}
        title={warningTitle}
      />

      <div className="pointer-events-none relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-base font-bold tracking-tight text-fg">{a.symbol}</span>
            <span className="rounded-[5px] border border-hairline bg-soft px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-fg-faint">
              {a.type}
            </span>
          </div>
          <div className="truncate text-[11.5px] text-fg-muted" title={a.name}>
            {a.name}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center">
          {canRefresh && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh(a.symbol);
            }}
            disabled={refreshing}
            aria-label={`Refresh ${a.symbol}`}
            title={warningTitle ? `Refresh ${a.symbol}: ${warningTitle}` : `Refresh ${a.symbol}`}
            className="rounded-md p-1.5 text-fg-faint transition duration-150 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")} />
          </button>
          )}
          {canRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(a.symbol);
            }}
            aria-label={`Remove ${a.symbol}`}
            title={`Remove ${a.symbol}`}
            className="rounded-md p-1.5 text-fg-faint transition duration-150 hover:bg-danger-soft hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          )}
        </div>
      </div>

      <div className="pointer-events-none relative flex items-baseline justify-between gap-2">
        <span className="truncate text-[21px] font-bold tabular-nums text-fg">
          {fmtPrice(a.price)}
        </span>
        <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${changeTone(a.changePct)}`}>
          {fmtChangePct(a.changePct)}
        </span>
      </div>

      <div className="pointer-events-none relative -mx-1">
        <Sparkline values={a.sparkline} color={color} />
      </div>

      <div className="pointer-events-none relative mx-auto -my-1 w-full max-w-[190px]">
        <RatingDial score={a.summary.score} rating={a.summary.rating} strongRatio={strongRatio} size="sm" />
      </div>

      <div
        className="pointer-events-none relative truncate text-center text-[15px] font-bold tracking-wide"
        style={{ color }}
      >
        {ratingLabel(a.summary.rating)}
      </div>

      {a.timeframeRatings === undefined ? (
        <MtfConfluenceSkeleton />
      ) : (
        <MtfConfluence ratings={a.timeframeRatings} selected={a.timeframe} />
      )}

      <div className="pointer-events-none relative grid grid-cols-2 gap-2">
        <SubSummary title="Oscillators" section={a.oscillators} />
        <SubSummary title="Moving avgs" section={a.movingAverages} />
      </div>

      <div className="pointer-events-none relative mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-hairline pt-2">
        <SourceBadge a={a} />
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {a.engulfing && (
            <EngulfBadge kind={a.engulfing} barClose={a.engulfingBarClose} stale={a.stale} />
          )}
          {a.sweep4h && <SweepBadge kind={a.sweep4h} stale={a.sweep4hStale} />}
          <span
            className="shrink-0 text-[10.5px] text-fg-faint"
            title={`Analysis refreshed ${timeAgo(a.updatedAt)}`}
          >
            updated {timeAgo(a.updatedAt)}
          </span>
        </span>
      </div>
    </Card>
  );
}

export const MarketCard = memo(MarketCardInner);

export function MarketCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
      <MtfConfluenceSkeleton />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </Card>
  );
}

interface ErrorProps {
  symbol: string;
  error: string;
  refreshing: boolean;
  canRefresh: boolean;
  canRemove: boolean;
  onRefresh: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

function MarketCardErrorInner({ symbol, error, refreshing, canRefresh, canRemove, onRefresh, onRemove }: ErrorProps) {
  return (
    <Card className="flex min-h-[200px] flex-col items-center justify-center gap-2 border-danger/30 p-4 text-center">
      <div className="text-base font-bold text-fg">{symbol}</div>
      <p className="line-clamp-3 text-[11.5px] leading-relaxed text-fg-muted">{error}</p>
      <div className="mt-1 flex items-center gap-1">
        {canRefresh && (
        <button
          type="button"
          onClick={() => onRefresh(symbol)}
          disabled={refreshing}
          aria-label={`Retry ${symbol}`}
          className="rounded-md p-1.5 text-fg-faint transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")} />
        </button>
        )}
        {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(symbol)}
          aria-label={`Remove ${symbol}`}
          className="rounded-md p-1.5 text-fg-faint transition hover:bg-danger-soft hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        )}
      </div>
    </Card>
  );
}

export const MarketCardError = memo(MarketCardErrorInner);
