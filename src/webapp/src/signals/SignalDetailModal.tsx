import { Copy, LineChart } from "lucide-react";

import { AnimatedModal } from "../components/Modal";
import { Badge, Button } from "../components/ui";
import { formatLocalTimestamp } from "../time";
import {
  SIGNAL_DIRECTION,
  SIGNAL_STATUS,
  computeRR,
  fmtPrice,
  fmtRR,
  relativeAgo,
  statusTimestamp,
} from "./signalFormat";
import type { Signal } from "./types";

export function SignalDetailModal({
  signal,
  onClose,
  onOpenChart,
  onCopy,
}: {
  signal: Signal | null;
  onClose: () => void;
  onOpenChart: (signal: Signal) => void;
  onCopy: (signal: Signal) => void;
}) {
  const status = signal ? SIGNAL_STATUS[signal.status] : null;
  const direction = signal ? SIGNAL_DIRECTION[signal.direction] : null;
  const rr = signal ? computeRR(signal.entry, signal.target, signal.stop) : null;
  const stateTime = signal ? statusTimestamp(signal) : null;

  return (
    <AnimatedModal
      open={!!signal}
      onClose={onClose}
      size="lg"
      title={signal ? `${signal.symbol} ${signal.direction.toUpperCase()}` : "Signal"}
      subtitle={
        signal && status ? (
          <span className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{status.blurb}</span>
          </span>
        ) : undefined
      }
      actions={
        signal ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="h-4 w-4" />}
              onClick={() => onCopy(signal)}
              title="Copy signal"
              aria-label="Copy signal"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<LineChart className="h-4 w-4" />}
              onClick={() => {
                onClose();
                onOpenChart(signal);
              }}
              title="Open analysis"
              aria-label="Open analysis"
            />
          </>
        ) : null
      }
    >
      {signal && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Detail label="Entry" value={fmtPrice(signal.entry)} />
            <Detail label="Target" value={fmtPrice(signal.target)} tone="text-success" />
            <Detail label="Stop" value={fmtPrice(signal.stop)} tone="text-danger" />
            <Detail label="Reward:risk" value={fmtRR(rr)} />
          </div>

          {direction && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Badge tone={direction.tone}>{direction.label}</Badge>
              {signal.timeframe && <span>Timeframe {signal.timeframe}</span>}
              {signal.status === "active" && signal.expiresAt && (
                <span>Expires {formatLocalTimestamp(signal.expiresAt)}</span>
              )}
            </div>
          )}

          {signal.note && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Note</div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">{signal.note}</p>
            </div>
          )}

          {signal.invalidationReason && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {signal.invalidationReason}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-fg-faint">Timeline</div>
            <div className="mt-2 space-y-2">
              <TimelineRow at={signal.createdAt} label="Published" />
              {signal.updatedAt !== signal.createdAt && (
                <TimelineRow at={signal.updatedAt} label="Edited" />
              )}
              {signal.updates.map((u, i) => (
                <TimelineRow key={`${u.at}-${i}`} at={u.at} label="Update" note={u.note} />
              ))}
              {stateTime && <TimelineRow at={stateTime.iso} label={stateTime.label} />}
            </div>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-soft/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${tone ?? "text-fg"}`}>{value}</div>
    </div>
  );
}

function TimelineRow({ at, label, note }: { at: string; label: string; note?: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-hairline bg-soft/40 px-3 py-2">
      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-fg">{label}</span>
          <span className="text-fg-faint" title={formatLocalTimestamp(at)}>
            {formatLocalTimestamp(at)} · {relativeAgo(at)}
          </span>
        </div>
        {note && <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-fg-muted">{note}</p>}
      </div>
    </div>
  );
}
