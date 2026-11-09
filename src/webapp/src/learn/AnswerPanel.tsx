import { useEffect, useState } from "react";
import { ArrowRight, CircleDollarSign, X } from "lucide-react";

import { Button, Card } from "../components/ui";
import type {
  AnonymizedItem,
  TradeChoice,
} from "./trainerApi";

function pctLabel(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export default function AnswerPanel({
  item,
  busy,
  error,
  onSubmit,
}: {
  item: AnonymizedItem;
  busy: boolean;
  error: string | null;
  onSubmit: (probability: number, trade: TradeChoice) => Promise<void>;
}) {
  const [probability, setProbability] = useState(50);
  const [trade, setTrade] = useState<TradeChoice | null>(null);

  useEffect(() => {
    setProbability(50);
    setTrade(null);
  }, [item.itemId]);

  const canSubmit = trade !== null && !busy;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{item.question.prompt}</h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            Give a probability, then say whether you would take the trade. The
            result stays hidden until you submit.
          </p>
        </div>
        <div className="flex gap-2 text-xs tabular-nums">
          <span className="rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-accent">
            Upper {pctLabel(item.question.barrierPct.upperPct)}
          </span>
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400">
            Lower {pctLabel(item.question.barrierPct.lowerPct)}
          </span>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-4">
          <label
            htmlFor="trainer-probability"
            className="text-sm font-medium text-fg"
          >
            Probability the upper barrier is hit first
          </label>
          <div className="flex items-center gap-1">
            <input
              id="trainer-probability-number"
              type="number"
              min={0}
              max={100}
              step={1}
              value={probability}
              disabled={busy}
              aria-label="Probability percent"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) {
                  setProbability(Math.min(100, Math.max(0, Math.round(next))));
                }
              }}
              className="w-20 rounded-lg border border-hairline-strong bg-soft px-2 py-1 text-right text-sm tabular-nums text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
            />
            <span className="text-sm text-fg-muted">%</span>
          </div>
        </div>

        <input
          id="trainer-probability"
          type="range"
          min={0}
          max={100}
          step={1}
          value={probability}
          disabled={busy}
          aria-valuetext={`${probability} percent`}
          onChange={(event) => setProbability(Number(event.target.value))}
          className="mt-3 h-2 w-full cursor-pointer accent-accent disabled:opacity-50"
        />
        <div className="mt-1 flex justify-between text-[11px] text-fg-faint">
          <span>0% · lower barrier more likely</span>
          <span>50% · even</span>
          <span>100% · upper barrier more likely</span>
        </div>
      </div>

      <fieldset className="mt-5" disabled={busy}>
        <legend className="text-sm font-medium text-fg">
          Would you take this trade?
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={trade === "take"}
            onClick={() => setTrade("take")}
            className={
              "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
              (trade === "take"
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-hairline-strong bg-soft text-fg-muted hover:bg-surface-hover hover:text-fg")
            }
          >
            <CircleDollarSign className="h-4 w-4" />
            Take
          </button>
          <button
            type="button"
            aria-pressed={trade === "pass"}
            onClick={() => setTrade("pass")}
            className={
              "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
              (trade === "pass"
                ? "border-hairline-strong bg-surface-active text-fg"
                : "border-hairline-strong bg-soft text-fg-muted hover:bg-surface-hover hover:text-fg")
            }
          >
            <X className="h-4 w-4" />
            Pass
          </button>
        </div>
      </fieldset>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {error}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        icon={<ArrowRight className="h-4 w-4" />}
        disabled={!canSubmit}
        onClickAsync={() =>
          onSubmit(probability / 100, trade as TradeChoice)
        }
      >
        {busy ? "Revealing" : "Submit & reveal"}
      </Button>
    </Card>
  );
}
