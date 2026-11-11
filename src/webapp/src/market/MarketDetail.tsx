import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { AnimatedModal } from "../components/Modal";
import { Badge, Button, Skeleton } from "../components/ui";
import { IndicatorTable, VoteBars } from "./IndicatorTable";
import { RatingDial } from "./RatingDial";
import { marketApi } from "../api";
import {
  changeTone,
  fmtChangePct,
  fmtPrice,
  providerName,
  ratingColor,
  ratingLabel,
  timeAgo,
} from "./ratings";
import type { MarketResult } from "./types";

export function MarketDetail({
  symbol,
  timeframe,
  strongRatio,
  timeframes,
  canRefresh,
  canRemove,
  onClose,
  onRemove,
  onTimeframeChange,
}: {
  symbol: string;
  timeframe: string;
  strongRatio: number;
  timeframes: { id: string; label: string }[];
  /** Signed-in users can force a broker read; anonymous visitors cannot. */
  canRefresh: boolean;
  /** Only admins can change the shared watchlist. */
  canRemove: boolean;
  onClose: () => void;
  onRemove: (symbol: string) => void;
  onTimeframeChange: (tf: string) => void;
}) {
  const [data, setData] = useState<MarketResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);

  // `seq` re-runs the fetch (used by the refresh button); symbol/timeframe
  // changes replace the sheet rather than refetching in place. Signed-in users
  // force a broker read every time, so opening a card never shows the grid's
  // last poll; a throttled force falls back to the cached detail.
  useEffect(() => {
    let alive = true;
    setData(null);
    setBusy(true);
    const load = async (): Promise<MarketResult> => {
      if (canRefresh) {
        try {
          return await marketApi.refreshSymbol(symbol, timeframe, true);
        } catch {
          // A forced read spends the shared rate limit; the cached read still
          // renders the sheet when it is refused.
        }
      }
      return marketApi.detail(symbol, timeframe, true);
    };
    load()
      .then((res) => {
        if (alive) setData(res);
      })
      .catch(() => {
        if (alive) setData({ ok: false, symbol, error: "Failed to load analysis" });
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [symbol, timeframe, seq, canRefresh]);

  const a = data?.ok ? data : null;

  return (
    <AnimatedModal
      open
      onClose={onClose}
      size="lg"
      title={symbol}
      actions={
        canRefresh || canRemove ? (
          <>
          {canRefresh && (
          <button
            type="button"
            onClick={() => setSeq((n) => n + 1)}
            disabled={busy}
            aria-label="Refresh analysis"
            title="Refresh this analysis"
            className="rounded-md p-1.5 text-fg-muted transition duration-150 hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={"h-4 w-4 " + (busy ? "animate-spin" : "")} />
          </button>
          )}
          {canRemove && (
          <button
            type="button"
            onClick={() => {
              onRemove(symbol);
              onClose();
            }}
            aria-label={`Remove ${symbol} from watchlist`}
            title="Remove from watchlist"
            className="rounded-md p-1.5 text-fg-muted transition duration-150 hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          )}
          </>
        ) : null
      }
      subtitle={a ? providerName(a.provider) : "Loading…"}
    >
      {/* Wide content: the indicator tables need more room than the default sheet. */}
      <div className="-mx-1">
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {timeframes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTimeframeChange(t.id)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                (t.id === timeframe
                  ? "border border-accent/20 bg-accent-soft text-accent"
                  : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {a && a.timeframeRatings && (
          <div className="mb-3 grid grid-cols-4 gap-1">
            {timeframes.map((t) => {
              const r = a.timeframeRatings![t.id];
              const active = t.id === timeframe;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onTimeframeChange(t.id)}
                  title={
                    r?.error ??
                    (r ? `${r.buy} buy · ${r.sell} sell · ${r.neutral} neutral` : undefined)
                  }
                  className={
                    "flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-1.5 transition " +
                    (active
                      ? "border-accent/25 bg-accent-soft"
                      : "border-hairline hover:bg-surface-hover")
                  }
                >
                  <span className="text-[10px] uppercase tracking-wide text-fg-faint">{t.label}</span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: r?.rating ? ratingColor(r.rating) : undefined }}
                  >
                    {r?.rating ? ratingLabel(r.rating) : "-"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!a ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : data && !data.ok ? (
          <p className="py-6 text-center text-sm text-fg-muted">{data.error}</p>
        ) : (
          a && (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-40 shrink-0">
                  <RatingDial
                    score={a.summary.score}
                    rating={a.summary.rating}
                    strongRatio={strongRatio}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums text-fg">
                      {fmtPrice(a.price)}
                    </span>
                    <span className={`text-sm font-medium tabular-nums ${changeTone(a.changePct)}`}>
                      {fmtChangePct(a.changePct)}
                    </span>
                  </div>
                  <div className="text-base font-bold" style={{ color: ratingColor(a.summary.rating) }}>
                    {ratingLabel(a.summary.rating)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <Meta label="Oscillators" value={ratingLabel(a.oscillators.rating)} color={ratingColor(a.oscillators.rating)} />
                    <Meta label="Moving averages" value={ratingLabel(a.movingAverages.rating)} color={ratingColor(a.movingAverages.rating)} />
                    <Meta label="Buy / Sell / Neutral" value={`${a.summary.buy} / ${a.summary.sell} / ${a.summary.neutral}`} />
                    {a.atr != null && <Meta label="ATR(14)" value={fmtPrice(a.atr)} />}
                  </div>
                  <VoteBars section={a.summary} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <IndicatorTable title="Oscillators" section={a.oscillators} />
                <IndicatorTable title="Moving averages" section={a.movingAverages} />
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-xs text-fg-faint">
                <Badge tone="muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  {providerName(a.provider)}
                </Badge>
                <span>
                  {a.candles} candles · {timeframe} · updated {timeAgo(a.updatedAt)}
                </span>
                {a.warnings.length > 0 && (
                  <span
                    className="text-amber-500"
                    title={a.warnings.map((w) => `${w.provider}: ${w.message}`).join(" | ")}
                  >
                    {a.warnings.length} source(s) unavailable
                  </span>
                )}
                {a.stale && (
                  <span
                    className="text-amber-500"
                    title="The source could not refresh, so these bars come from a cache."
                  >
                    bars are stale
                  </span>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </AnimatedModal>
  );
}

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-fg-faint">{label}</span>
      <span className="font-medium" style={{ color }}>
        {value}
      </span>
    </div>
  );
}