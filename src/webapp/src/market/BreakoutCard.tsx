import { ArrowDownRight, ArrowUpRight, BookOpen, LineChart } from "lucide-react";

import { Card, Skeleton } from "../components/ui";
import {
  BREAKOUT_STYLE,
  breakPct,
  breakoutDirection,
  breakoutMeterPct,
  fmtPct,
  fmtPrice,
} from "./breakoutFormat";
import { SESSION_LABEL, fmtUtc3, relativeTime } from "./captures";
import type { Breakout } from "./types";

export function BreakoutCard({
  breakout: b,
  onOpenNote,
  onOpenChart,
}: {
  breakout: Breakout;
  onOpenNote: (b: Breakout) => void;
  onOpenChart: (symbol: string) => void;
}) {
  const style = BREAKOUT_STYLE[b.type];
  const direction = breakoutDirection(b);
  const arrow = direction === "above" ? ArrowUpRight : ArrowDownRight;
  const Arrow = arrow;
  const level = b.level_type.replace(/_/g, " ");
  const atr = b.break_atr_mult == null ? "—" : `${Math.abs(b.break_atr_mult).toFixed(2)} ATR`;
  const pct = breakPct(b);
  const meter = breakoutMeterPct(b);
  const summary = `${b.symbol} ${style.label} break`;
  const hasNote = Boolean(b.event_key);

  return (
    <Card interactive className="relative flex min-h-[250px] flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => (hasNote ? onOpenNote(b) : onOpenChart(b.symbol))}
        aria-label={hasNote ? `Open research note for ${summary}` : `Open chart for ${b.symbol}`}
        className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />

      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold tracking-tight text-fg">{b.symbol}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-faint">{b.asset_class}</div>
        </div>
        <span
          className="shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
          style={{ color: style.color, borderColor: `${style.color}66`, background: `${style.color}12` }}
        >
          {style.label}
        </span>
      </div>

      <div className="pointer-events-none relative z-10 flex items-center gap-1.5">
        <Arrow className="h-4 w-4 shrink-0" style={{ color: style.color }} />
        <span className="text-sm font-semibold tabular-nums" style={{ color: style.color }}>
          {atr}
        </span>
        <span className="text-xs text-fg-muted">
          {direction} {level}
        </span>
      </div>

      <div className="pointer-events-none relative z-10 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">Break price</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-fg">{fmtPrice(b.break_price)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">{style.short} level</div>
          <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-fg">{fmtPrice(b.level_price)}</div>
          <div className="mt-0.5 text-[10.5px] tabular-nums text-fg-faint">
            {fmtPct(pct)} from level
          </div>
        </div>
      </div>

      <div className="pointer-events-none relative z-10">
        <div className="mb-1 flex items-center justify-between text-[10px] text-fg-faint">
          <span>Break strength</span>
          <span className="tabular-nums">{atr}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-soft">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${meter}%`, background: style.color }}
          />
        </div>
      </div>

      <div className="pointer-events-none relative z-10 mt-auto border-t border-hairline pt-2">
        <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-muted">
          <span className="truncate">
            {SESSION_LABEL[b.session] ?? b.session} · {b.confirmation.replace(/_/g, " ")}
          </span>
          <span className="shrink-0 text-fg-faint">{relativeTime(b.timestamp_utc)}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-fg-faint">{fmtUtc3(b.timestamp_utc)}</div>
      </div>

      <div className="relative z-10 flex items-center gap-1.5">
        {hasNote && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote(b);
            }}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong bg-soft px-2 text-[11px] font-semibold text-fg transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Research note
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChart(b.symbol);
          }}
          className={
            "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-hairline-strong bg-soft px-2 text-[11px] font-semibold text-fg transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
            (hasNote ? "" : "flex-1")
          }
        >
          <LineChart className="h-3.5 w-3.5" />
          Chart
        </button>
      </div>
    </Card>
  );
}

export function BreakoutCardSkeleton() {
  return (
    <Card className="flex min-h-[250px] flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-2.5 w-12" />
        </div>
        <Skeleton className="h-5 w-16 rounded-md" />
      </div>
      <Skeleton className="h-4 w-36" />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-6 w-24" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <div className="mt-auto space-y-1.5 border-t border-hairline pt-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-24" />
      </div>
      <Skeleton className="h-8 w-full rounded-lg" />
    </Card>
  );
}
