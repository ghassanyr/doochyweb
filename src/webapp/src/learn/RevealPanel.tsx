import { ArrowRight, Check, X } from "lucide-react";

import { FadeRise } from "../components/motion";
import { Badge, Button, Card } from "../components/ui";
import type { ScoredResult } from "./scoring";
import type {
  RevealedItem,
  RevealBaseRate,
} from "./trainerApi";

function pctLabel(value: number | null): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function humanizeTag(tag: string): string {
  return tag
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function outcomeCopy(outcome: RevealedItem["outcome"]): {
  title: string;
  tone: "success" | "danger" | "muted";
} {
  if (outcome === "up") {
    return { title: "Upper barrier reached", tone: "success" };
  }
  if (outcome === "down") {
    return { title: "Lower barrier reached", tone: "danger" };
  }
  return { title: "Time barrier reached", tone: "muted" };
}

function RateBlock({
  label,
  rate,
}: {
  label: string;
  rate: RevealBaseRate;
}) {
  const entries: { key: RevealedItem["outcome"]; label: string }[] = [
    { key: "up", label: "Up" },
    { key: "down", label: "Down" },
    { key: "scratch", label: "Scratch" },
  ];

  return (
    <div className="rounded-lg border border-hairline bg-soft/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-fg">{label}</div>
        <div className="text-[11px] tabular-nums text-fg-faint">
          n = {rate.n}
        </div>
      </div>
      {rate.n === 0 ? (
        <p className="mt-2 text-xs text-fg-faint">
          No published sample for this group yet.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {entries.map((entry) => {
            const percent = Math.round(rate.rates[entry.key] * 100);
            return (
              <div key={entry.key}>
                <div className="flex justify-between text-[11px] text-fg-muted">
                  <span>{entry.label}</span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-active">
                  <div
                    className={
                      "h-full rounded-full " +
                      (entry.key === "up"
                        ? "bg-success"
                        : entry.key === "down"
                          ? "bg-danger"
                          : "bg-rating-neutral")
                    }
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RevealPanel({
  reveal,
  result,
  isLast,
  onNext,
}: {
  reveal: RevealedItem;
  result: ScoredResult | null;
  isLast: boolean;
  onNext: () => void;
}) {
  const outcome = outcomeCopy(reveal.outcome);

  return (
    <FadeRise>
      <Card className="p-4 sm:p-5" flat>
        <div aria-live="polite" className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge tone={outcome.tone}>{outcome.title}</Badge>
            <h2 className="mt-2 text-lg font-semibold text-fg">
              {reveal.outcome === "scratch"
                ? "No barrier resolved inside the window"
                : reveal.outcome === "up"
                  ? "The upper barrier resolved first"
                  : "The lower barrier resolved first"}
            </h2>
            <p className="mt-1 text-xs text-fg-muted">
              {reveal.outcomeOffset === null
                ? "The time barrier expired without a barrier touch."
                : `Resolved ${reveal.outcomeOffset} bar${reveal.outcomeOffset === 1 ? "" : "s"} after entry.`}
            </p>
          </div>
          <Badge tone="accent">{humanizeTag(reveal.tag)}</Badge>
        </div>

        {result && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-hairline bg-soft/60 p-3">
              <div className="text-[11px] text-fg-faint">Your direction call</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-fg">
                {result.directionCall === "up" ? "Up" : "Down"}
                <span className="text-xs font-normal text-fg-muted">
                  ({Math.round(result.probability * 100)}% upper)
                </span>
                {result.directionCorrect ? (
                  <Check className="h-4 w-4 text-success" aria-label="Correct" />
                ) : (
                  <X className="h-4 w-4 text-danger" aria-label="Incorrect" />
                )}
              </div>
            </div>
            <div className="rounded-lg border border-hairline bg-soft/60 p-3">
              <div className="text-[11px] text-fg-faint">Your trade choice</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-fg">
                {result.trade === "take" ? "Take" : "Pass"}
                {result.tradeCorrect ? (
                  <Check className="h-4 w-4 text-success" aria-label="Correct" />
                ) : (
                  <X className="h-4 w-4 text-danger" aria-label="Incorrect" />
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-hairline bg-soft/60 p-3">
            <div className="text-[11px] text-fg-faint">Excursions after entry</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-[11px] text-fg-faint">MFE</div>
                <div className="font-semibold tabular-nums text-success">
                  {reveal.mfeAtr.toFixed(2)} ATR
                </div>
                <div className="text-[11px] tabular-nums text-fg-muted">
                  {reveal.mfeR.toFixed(2)}R
                </div>
              </div>
              <div>
                <div className="text-[11px] text-fg-faint">MAE</div>
                <div className="font-semibold tabular-nums text-danger">
                  {reveal.maeAtr.toFixed(2)} ATR
                </div>
                <div className="text-[11px] tabular-nums text-fg-muted">
                  {reveal.maeR.toFixed(2)}R
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-hairline bg-soft/60 p-3">
            <div className="text-[11px] text-fg-faint">Pattern and levels</div>
            <div className="mt-1.5 text-sm font-semibold text-fg">
              {humanizeTag(reveal.tag)}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              Span {reveal.bounds.startOffset} to {reveal.bounds.endOffset} bars
              from entry. Levels: upper {pctLabel(reveal.levels.levelUpperPct)},
              lower {pctLabel(reveal.levels.levelLowerPct)}, neckline{" "}
              {pctLabel(reveal.levels.necklinePct)}.
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-hairline bg-soft/60 p-3">
          <div className="text-[11px] text-fg-faint">Why this resolved</div>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            {reveal.why}
          </p>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold text-fg">
            Historical base rates
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <RateBlock label={humanizeTag(reveal.tag)} rate={reveal.baseRates.tag} />
            <RateBlock label="All pilot items" rate={reveal.baseRates.all} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Base rates are historical frequencies from the pilot batch, not a
            promise about the next setup.
          </p>
        </div>

        <Button
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          icon={<ArrowRight className="h-4 w-4" />}
          onClick={onNext}
        >
          {isLast ? "Finish drill" : "Next item"}
        </Button>
      </Card>
    </FadeRise>
  );
}
