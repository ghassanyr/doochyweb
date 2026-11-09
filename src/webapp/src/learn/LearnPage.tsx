import { AlertCircle, GraduationCap, RefreshCw, TimerReset } from "lucide-react";

import { FadeRise } from "../components/motion";
import { Button, Card, Skeleton } from "../components/ui";
import AnswerPanel from "./AnswerPanel";
import LearnChart from "./LearnChart";
import RevealPanel from "./RevealPanel";
import {
  accuracyPercent,
  type AccuracyBucket,
  type AccuracySummary,
} from "./scoring";
import { useDrill } from "./useDrill";

function pctBucket(bucket: AccuracyBucket): string {
  const percent = accuracyPercent(bucket);
  if (percent === null) return "—";
  return `${Math.round(percent)}%`;
}

function AccuracyMetric({
  label,
  bucket,
}: {
  label: string;
  bucket: AccuracyBucket;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-soft/60 p-3">
      <div className="text-xs text-fg-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
        {pctBucket(bucket)}
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-fg-muted">
        {bucket.correct} of {bucket.total} correct
      </div>
    </div>
  );
}

function SummaryCard({
  summary,
  answered,
}: {
  summary: AccuracySummary;
  answered: number;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <GraduationCap className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-fg">Daily drill complete</h1>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            You answered {answered} anonymized setup{answered === 1 ? "" : "s"}.
            Accuracy is shown as plain counts, not streaks.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <AccuracyMetric label="Direction accuracy" bucket={summary.direction} />
        <AccuracyMetric label="Trade / pass accuracy" bucket={summary.trade} />
      </div>

      <p className="mt-5 rounded-lg border border-hairline bg-soft/50 p-3 text-xs leading-relaxed text-fg-muted">
        Your daily drill is saved in this browser. A fresh mixed session appears
        tomorrow, or when the published pilot batch changes. This is pattern
        practice, not financial advice.
      </p>
    </Card>
  );
}

function PreparingCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="p-6 text-center sm:p-8">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
        <TimerReset className="h-5 w-5" />
      </span>
      <h1 className="mt-3 text-lg font-semibold text-fg">
        The trainer is being prepared
      </h1>
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-fg-muted">
        The pilot batch is not published yet. Check back shortly and the daily
        drill will be ready.
      </p>
      <Button
        variant="secondary"
        className="mt-4"
        icon={<RefreshCw className="h-4 w-4" />}
        onClick={onRetry}
      >
        Check again
      </Button>
    </Card>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <h1 className="text-lg font-semibold text-fg">The drill did not load</h1>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{message}</p>
          <Button
            variant="secondary"
            className="mt-4"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DrillSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[340px] w-full rounded-2xl sm:h-[400px]" />
      <Card className="p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-3 h-2 w-full" />
        <Skeleton className="mt-4 h-11 w-full" />
      </Card>
    </div>
  );
}

export default function LearnPage() {
  const {
    status,
    item,
    reveal,
    progress,
    error,
    loadingItem,
    submitting,
    summary,
    total,
    currentNumber,
    completed,
    submitAnswer,
    nextItem,
    retry,
  } = useDrill();

  const answered = progress?.results.length ?? 0;
  const progressWidth =
    total > 0 ? Math.min(100, (answered / total) * 100) : 0;
  const result = progress?.results[progress.index] ?? null;
  const isLast = progress ? progress.index === progress.itemIds.length - 1 : false;

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              Daily drill
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              Probability and trade practice on anonymized chart setups. Symbols,
              dates and prices are hidden.
            </p>
          </div>
          {total > 0 && !completed && (
            <div className="text-right">
              <div className="text-xs font-medium text-fg">
                Item {currentNumber} of {total}
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-fg-faint">
                Direction {summary.direction.correct}/{summary.direction.total} ·
                Trade {summary.trade.correct}/{summary.trade.total}
              </div>
            </div>
          )}
        </div>

        {total > 0 && !completed && (
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-active"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answered}
            aria-label="Drill progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressWidth}%` }}
            />
          </div>
        )}

        <details className="rounded-xl border border-hairline bg-soft/40 px-3 py-2 text-xs text-fg-muted">
          <summary className="cursor-pointer font-medium text-fg">
            How scoring works
          </summary>
          <div className="mt-2 space-y-1.5 leading-relaxed">
            <p>
              A probability of 50% or higher is an up call; below 50% is a down
              call.
            </p>
            <p>
              Take is correct when your call matches the realized outcome. Pass is
              correct when it does not. A scratch — neither barrier hit first —
              counts as a miss.
            </p>
            <p>
              Base rates are historical frequencies from the pilot batch; they are
              not a promise about the next chart.
            </p>
            <p>
              Your progress is saved only in this browser. This is pattern
              practice, not financial advice.
            </p>
          </div>
        </details>

        {status === "loading" && <DrillSkeleton />}

        {status === "preparing" && <PreparingCard onRetry={retry} />}

        {status === "empty" && (
          <Card className="p-6 text-center sm:p-8">
            <h1 className="text-lg font-semibold text-fg">
              No drill items are available yet
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              The pilot batch is still being curated. Please check back later.
            </p>
          </Card>
        )}

        {status === "error" && (
          <ErrorCard message={error ?? "Something went wrong."} onRetry={retry} />
        )}

        {status === "complete" && (
          <SummaryCard summary={summary} answered={answered} />
        )}

        {status === "ready" && (!item || loadingItem) && <DrillSkeleton />}

        {status === "ready" && item && !loadingItem && (
          <>
            <Card className="overflow-hidden" flat>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2 text-[11px] text-fg-muted sm:px-4">
                <span className="font-medium text-fg">Anonymized setup</span>
                <span className="tabular-nums">
                  Upper +{item.question.barrierPct.upperPct.toFixed(2)}% · Lower{" "}
                  {item.question.barrierPct.lowerPct.toFixed(2)}% · Entry 0.00%
                </span>
              </div>
              <LearnChart item={item} reveal={reveal} />
            </Card>

            {reveal ? (
              <RevealPanel
                reveal={reveal}
                result={result}
                isLast={isLast}
                onNext={nextItem}
              />
            ) : (
              <AnswerPanel
                item={item}
                busy={submitting}
                error={error}
                onSubmit={submitAnswer}
              />
            )}

            <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
              Practice tool for probability judgement and trade selection. The
              reveal is for education only and is not financial advice.
            </p>
          </>
        )}
      </div>
    </FadeRise>
  );
}
