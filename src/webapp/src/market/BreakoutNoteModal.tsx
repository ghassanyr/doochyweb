import { Check, Link2, LineChart } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, marketApi } from "../api";
import { AnimatedModal } from "../components/Modal";
import { BREAKOUT_STYLE, breakPct, breakoutDirection, fmtPct, fmtPrice } from "./breakouts";
import { SESSION_LABEL, fmtUtc3, relativeTime } from "./captures";
import type { Breakout, NarrationBrief, NarrationNote } from "./types";

const fmtShare = (r: number | null): string => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);
const fmtAtr = (x: number | null): string => (x == null ? "—" : `${Math.abs(x).toFixed(2)} ATR`);

function noteUrl(eventKey: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("note", eventKey);
  return url.toString();
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-0.5 text-[11.5px] text-fg-muted">{value}</div>
    </div>
  );
}

function NarrationStats({ brief }: { brief: NarrationBrief }) {
  const [open, setOpen] = useState(false);
  const h = brief.history;
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
              </div>
              <p className="text-fg-faint">
                First-touch race: ±1 ATR over 6 bars from the next open. Not a win rate. Decisions exclude ties and
                neither-touched cases.
              </p>
            </>
          ) : (
            <p className="text-fg-faint">No analogue history was available for this event.</p>
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
      await navigator.clipboard.writeText(noteUrl(eventKey));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the address bar still holds the link */
    }
  };

  const style = breakout ? BREAKOUT_STYLE[breakout.type] : null;
  const symbol = breakout?.symbol ?? note?.symbol ?? "Breakout";
  const subtitle = breakout
    ? `${style?.label ?? ""} break · ${SESSION_LABEL[breakout.session] ?? breakout.session} · ${fmtUtc3(breakout.timestamp_utc)}`
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
              {breakout.break_atr_mult == null ? "—" : `${Math.abs(breakout.break_atr_mult).toFixed(2)} ATR`}
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
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-fg-muted">{note.text}</p>
          {note.brief && <NarrationStats brief={note.brief} />}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3 text-[10.5px] text-fg-faint">
            <span>
              {note.symbol ?? "—"} · generated {relativeTime(note.created_at)} · {note.model.split("/").pop()}
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
