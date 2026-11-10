import { Skeleton } from "../components/ui";
import { computeConfluence } from "./confluence";
import { RATINGS, ratingColor, ratingLabel } from "./ratings";
import { timeframes } from "./timeframes";
import type { TimeframeRating } from "./types";

interface MtfConfluenceProps {
  ratings: Record<string, TimeframeRating>;
  /** The tab the card's main rating is showing; only moves the marker. */
  selected: string;
}

// Compact weighted ribbon of all ten timeframes. Non-interactive on purpose:
// the card itself is one big click target.
export function MtfConfluence({ ratings, selected }: MtfConfluenceProps) {
  const summary = computeConfluence(ratings, selected);
  if (summary.available === 0) return null;

  const verdictColor = summary.mixed ? RATINGS.neutral.color : ratingColor(summary.rating);
  const breakdown = summary.segments
    .map((s) => `${s.id} ${s.available ? ratingLabel(s.rating ?? undefined) : s.error ? "error" : "missing"}`)
    .join(", ");

  return (
    <div
      className="pointer-events-none relative select-none"
      role="img"
      aria-label={`MTF confluence: ${summary.label}, ${summary.aligned} of ${summary.available} aligned. ${breakdown}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-fg-faint">MTF</span>
          <span className="truncate text-[12px] font-semibold" style={{ color: verdictColor }}>
            {summary.label}
          </span>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">
          {summary.aligned}/{summary.available}
        </span>
      </div>

      <div className="mt-1 flex gap-px" aria-hidden="true">
        {summary.segments.map((segment) => (
          <span
            key={segment.id}
            className="h-2 rounded-[2px]"
            style={{
              flexGrow: segment.weight,
              flexBasis: 0,
              backgroundColor: ratingColor(segment.rating ?? undefined),
              opacity: segment.available ? 1 : 0.22,
            }}
          />
        ))}
      </div>

      <div className="mt-0.5 flex gap-px" aria-hidden="true">
        {summary.segments.map((segment) => (
          <span
            key={segment.id}
            className={
              "border-b-2 pb-px text-center text-[8px] leading-none " +
              (segment.selected ? "border-accent text-fg" : "border-transparent text-fg-faint")
            }
            style={{ flexGrow: segment.weight, flexBasis: 0 }}
          >
            {segment.id}
          </span>
        ))}
      </div>
    </div>
  );
}

export function MtfConfluenceSkeleton() {
  return (
    <div className="space-y-1.5 py-0.5" aria-hidden="true">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-8" />
      </div>
      <Skeleton className="h-2 w-full" />
      <div className="flex gap-1">
        {timeframes.map((t) => (
          <Skeleton key={t.id} className="h-2 flex-1" />
        ))}
      </div>
    </div>
  );
}
