import { Check, Link2, LineChart } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, marketApi } from "../api";
import { AnimatedModal } from "../components/Modal";
import { siteUrlFor } from "../publicUrl";
import { useSiteConfig } from "../siteConfig";
import { BREAKOUT_STYLE, breakPct, breakoutDirection, fmtPct, fmtPrice } from "./breakoutFormat";
import { SESSION_LABEL, fmtCaptureTime, relativeTime } from "./captures";
import type { Breakout, Evidence, NarrationBrief, NarrationNote, SinceBreak } from "./types";

const fmtShare = (r: number | null): string => (r == null ? "-" : `${(r * 100).toFixed(0)}%`);
const fmtAtr = (x: number | null): string => (x == null ? "-" : `${Math.abs(x).toFixed(2)} ATR`);
const fmtPoints = (ev: Evidence): string => {
  const points = Math.round(ev.diff * 100);
  return `${points > 0 ? "+" : ""}${points} pts`;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-0.5 text-[11.5px] text-fg-muted">{value}</div>
      {hint && <div className="text-[10px] text-fg-faint">{hint}</div>}
    </div>
  );
}

function sinceBreakValue(sb: SinceBreak | null | undefined): { value: string; hint: string } {
  if (!sb) return { value: "-", hint: "No 4H bars available for this event" };
  if (sb.status === "pending") return { value: "Awaiting next bar", hint: "No closed bar since the break yet" };
  const touch =
    sb.first_touch === "up"
      ? "Upside touched first"
      : sb.first_touch === "down"
        ? "Downside touched first"
        : sb.first_touch === "tie"
          ? "Both sides touched in one bar"
          : sb.status === "complete"
            ? "Neither side touched in the window"
            : "Neither side touched yet";
  if (sb.mfe == null || sb.mae == null) {
    return { value: `${sb.bars} of ${sb.horizon} bars`, hint: "ATR not available" };
  }
  return {
    value: `${sb.mfe.toFixed(1)} / ${sb.mae.toFixed(1)} ATR`,
    hint: `Favourable / adverse · ${sb.bars} of ${sb.horizon} bars · ${touch}`,
  };
}

function EvidenceStrip({ brief, sinceBreak }: { brief: NarrationBrief; sinceBreak?: SinceBreak | null }) {
  const ctx = brief.context;
  const ev = brief.evidence;
  const sb = sinceBreakValue(sinceBreak);
  const trend = ctx?.trend ? `${ctx.trend[0].toUpperCase()}${ctx.trend.slice(1)}` : "No 4H context";
  const contextValue = ctx?.adx == null ? trend : `${trend} · ADX ${ctx.adx.toFixed(1)}`;
  return (
    <div className="mb-4 rounded-xl border border-hairline bg-soft p-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
        <Stat label="Since the break" value={sb.value} hint={sb.hint} />
        <Stat label="4H backdrop" value={contextValue} hint={ctx ? `${ctx.bars} closed bars at the break` : undefined} />
        <Stat
          label="Range position"
          value={ctx?.range_position == null ? "-" : `${Math.round(ctx.range_position * 100)}%`}
          hint={ctx ? `of the ${ctx.range_bars}-bar range` : undefined}
        />
        <Stat
          label="Volatility"
          value={ctx?.atr_percentile == null ? "-" : `${Math.round(ctx.atr_percentile * 100)}th percentile`}
          hint={ctx?.volume_ratio == null ? undefined : `Break volume ${ctx.volume_ratio.toFixed(1)}x average`}
        />
        <Stat
          label="Evidence"
          value={ev ? `${ev.label} · ${fmtPoints(ev)}` : "No nearby-bar history"}
          hint={ev ? `${ev.n_match} matched / ${ev.n_base} base decisive cases` : "No historical odds implied"}
        />
        <Stat
          label="Invalidation"
          value={fmtPrice(brief.invalidation_level)}
          hint={
            brief.invalidation_atr_buffer > 0
              ? `${brief.invalidation_atr_buffer.toFixed(2)} ATR beyond the level`
              : "At the level itself"
          }
        />
      </div>
      <p className="mt-3 border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-fg-faint">
        Nearby bars are generic 4H bars, not prior breakouts. A first touch is not a win rate, and the
        evidence grade describes the historical gap only. This is research, not a forecast.
      </p>
    </div>
  );
}

function NarrationStats({ brief }: { brief: NarrationBrief }) {
  const [open, setOpen] = useState(false);
  const h = brief.history;
  const ctx = brief.context;
  const ev = brief.evidence;
  return (
    <div className="mt-4 border-t border-hairline pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] font-medium text-accent hover:underline"
      >
        {open ? "Hide historical data" : "Historical data"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[11px]">
          {h ? (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <Stat label="Sample" value={`${h.sample_size} / ${h.pool_size} bars`} />
                <Stat label="Split" value={`${h.match_train} older / ${h.match_test} recent`} />
                <Stat label="Up first" value={`${fmtShare(h.decisive_up_share)} (${h.up_first})`} />
                <Stat label="Down first" value={`${fmtShare(h.decisive_down_share)} (${h.down_first})`} />
                <Stat label="Tie / neither" value={`${h.tie} / ${h.neither}`} />
                <Stat label="Base up first" value={`${fmtShare(h.base_up_share)} (n=${h.base_n})`} />
                <Stat label="Recent up first" value={`${fmtShare(h.recent_up_share)} (n=${h.recent_n})`} />
                <Stat label="Recent down first" value={fmtShare(h.recent_down_share)} />
                <Stat label="Median MFE" value={fmtAtr(h.median_mfe)} />
                <Stat label="Median MAE" value={fmtAtr(h.median_mae)} />
                <Stat label="Base MFE / MAE" value={`${fmtAtr(h.base_median_mfe)} / ${fmtAtr(h.base_median_mae)}`} />
                {ev && <Stat label="Difference" value={fmtPoints(ev)} />}
              </div>
              <p className="text-fg-faint">
                First-touch race: ±1 ATR over 6 bars from the next open. Not a win rate. Decisions exclude ties and
                neither-touched cases.
              </p>
            </>
          ) : (
            <p className="text-fg-faint">No nearby-bar history was available for this event.</p>
          )}
          {ctx && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-hairline pt-2 sm:grid-cols-4">
              <Stat label="Trend" value={ctx.trend ?? "-"} />
              <Stat label="ADX" value={ctx.adx == null ? "-" : ctx.adx.toFixed(1)} />
              <Stat label="EMA 50 / 200" value={`${fmtPrice(ctx.ema50)} / ${fmtPrice(ctx.ema200)}`} />
              <Stat label="Level tests" value={ctx.level_touches == null ? "-" : `${ctx.level_touches}`} />
              <Stat label="Last test" value={ctx.level_age_bars == null ? "-" : `${ctx.level_age_bars} bars before`} />
              <Stat label="Range position" value={ctx.range_position == null ? "-" : fmtShare(ctx.range_position)} />
              <Stat label="ATR percentile" value={ctx.atr_percentile == null ? "-" : fmtShare(ctx.atr_percentile)} />
              <Stat label="Break volume" value={ctx.volume_ratio == null ? "-" : `${ctx.volume_ratio.toFixed(1)}x`} />
            </div>
          )}
          <ul className="list-disc space-y-0.5 pl-4 text-fg-faint">
            {[...brief.limits, ...brief.quality].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BreakoutNoteModal({
  eventKey,
  breakout,
  onClose,
  onOpenChart,
}: {
  eventKey: string;
  breakout?: Breakout;
  onClose: () => void;
  onOpenChart?: (symbol: string) => void;
}) {
  const [note, setNote] = useState<NarrationNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { config } = useSiteConfig();

  useEffect(() => {
    let alive = true;
    setNote(null);
    setError(null);
    setCopied(false);
    marketApi
      .narration(eventKey)
      .then((n) => alive && setNote(n))
      .catch((err: unknown) => {
        if (!alive) return;
        const api = err instanceof ApiError ? err : null;
        setError(api?.status === 404 ? "The research note for this event is not available yet." : "Could not load the research note.");
      });
    return () => {
      alive = false;
    };
  }, [eventKey]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(siteUrlFor(config, "/breakouts", { note: eventKey }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the address bar still holds the link */
    }
  };

  const style = breakout ? BREAKOUT_STYLE[breakout.type] : null;
  const symbol = breakout?.symbol ?? note?.symbol ?? "Breakout";
  const subtitle = breakout
    ? `${style?.label ?? ""} break · ${SESSION_LABEL[breakout.session] ?? breakout.session} · ${fmtCaptureTime(breakout.timestamp_utc)}`
    : "Research note";

  return (
    <AnimatedModal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          {symbol}
          {style && (
            <span
              className="rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
              style={{ color: style.color, borderColor: `${style.color}66`, background: `${style.color}12` }}
            >
              {style.label}
            </span>
          )}
        </span>
      }
      subtitle={subtitle}
      actions={
        note ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : undefined
      }
    >
      {breakout && (
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-hairline bg-soft p-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">Break</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">{fmtPrice(breakout.break_price)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">Level</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">{fmtPrice(breakout.level_price)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">Distance</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">
              {breakout.break_atr_mult == null ? "-" : `${Math.abs(breakout.break_atr_mult).toFixed(2)} ATR`}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">Direction</div>
            <div className="mt-0.5 text-[11.5px] text-fg-muted">
              {breakoutDirection(breakout)} {breakout.level_type.replace(/_/g, " ")}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">From level</div>
            <div className="mt-0.5 text-[11.5px] tabular-nums text-fg-muted">{fmtPct(breakPct(breakout))}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-faint">Confirmation</div>
            <div className="mt-0.5 truncate text-[11.5px] text-fg-muted">{breakout.confirmation.replace(/_/g, " ")}</div>
          </div>
        </div>
      )}

      {!note && !error && <p className="text-sm text-fg-faint">Loading note…</p>}
      {error && <p className="text-sm text-fg-muted">{error}</p>}
      {note && (
        <>
          {note.brief && <EvidenceStrip brief={note.brief} sinceBreak={note.since_break} />}
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">{note.text}</p>
          {note.brief && <NarrationStats brief={note.brief} />}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-[10.5px] text-fg-faint">
            <span>
              {note.symbol ?? "-"} · generated {relativeTime(note.created_at)} ·{" "}
              {note.source === "deterministic" ? "deterministic note" : "model note"}
              {note.source === "model" ? ` · ${note.model.split("/").pop()}` : ""}
            </span>
            {onOpenChart && (
              <button
                type="button"
                onClick={() => onOpenChart(note.symbol ?? breakout?.symbol ?? "")}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <LineChart className="h-3.5 w-3.5" />
                Open chart
              </button>
            )}
          </div>
        </>
      )}
    </AnimatedModal>
  );
}
