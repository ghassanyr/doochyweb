import {
  Ban,
  Copy,
  LineChart,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Badge, Button, Card } from "../components/ui";
import { formatLocalDateTime, formatLocalTimestamp } from "../time";
import {
  SIGNAL_DIRECTION,
  SIGNAL_STATUS,
  computeRR,
  distances,
  fmtPct,
  fmtPrice,
  fmtRR,
  progressFor,
  relativeAgo,
  statusTimestamp,
} from "./signalFormat";
import type { PricePoint, Signal } from "./types";

export function SignalCard({
  signal,
  price,
  canManage,
  onOpen,
  onEdit,
  onPostUpdate,
  onInvalidate,
  onRestore,
  onDelete,
  onOpenChart,
  onCopy,
}: {
  signal: Signal;
  price: PricePoint | null;
  canManage: boolean;
  onOpen: (signal: Signal) => void;
  onEdit: (signal: Signal) => void;
  onPostUpdate: (signal: Signal) => void;
  onInvalidate: (signal: Signal) => void;
  onRestore: (signal: Signal) => void;
  onDelete: (signal: Signal) => void;
  onOpenChart: (signal: Signal) => void;
  onCopy: (signal: Signal) => void;
}) {
  const status = SIGNAL_STATUS[signal.status];
  const direction = SIGNAL_DIRECTION[signal.direction];
  const rr = computeRR(signal.entry, signal.target, signal.stop);
  const live = price?.price ?? null;
  const progress = signal.status === "active" ? progressFor(signal, live) : null;
  const dist = distances(signal, live);
  const stateTime = statusTimestamp(signal);
  const latestUpdate = signal.updates[signal.updates.length - 1];

  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(signal)}
          className="min-w-0 text-left"
          title="Open signal details"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-bold tracking-tight text-fg">{signal.symbol}</span>
            <Badge tone={direction.tone}>{direction.label}</Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-fg-faint">
            {signal.timeframe && <span>{signal.timeframe}</span>}
            {signal.timeframe && <span>·</span>}
            <span>{relativeAgo(signal.createdAt)}</span>
          </div>
        </button>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-hairline bg-soft/60 px-2.5 py-2">
        <Price label="Entry" value={fmtPrice(signal.entry)} />
        <Price label="Target" value={fmtPrice(signal.target)} tone="text-success" />
        <Price label="Stop" value={fmtPrice(signal.stop)} tone="text-danger" />
        <Price label="R:R" value={fmtRR(rr)} />
      </div>

      {progress && (
        <div className="mt-3">
          <div className="relative h-1.5 rounded-full bg-surface-active">
            <div
              className={`h-full rounded-full ${progress.profitable ? "bg-success" : "bg-danger"}`}
              style={{ width: `${progress.pricePct}%` }}
            />
            {progress.entryPct != null && (
              <span
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-fg-muted"
                style={{ left: `${progress.entryPct}%` }}
                title="Entry"
              />
            )}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10.5px] tabular-nums text-fg-faint">
            <span>
              {fmtPrice(live)} · {progress.profitable ? "in profit" : "in loss"}
            </span>
            <span>
              {fmtPct(dist.toTarget)} to target · {fmtPct(dist.toStop)} to stop
            </span>
          </div>
        </div>
      )}

      {signal.note && (
        <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-fg-muted">{signal.note}</p>
      )}

      {latestUpdate && (
        <div className="mt-2 rounded-md border border-hairline bg-soft/40 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            Update · {relativeAgo(latestUpdate.at)}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-muted">{latestUpdate.note}</p>
        </div>
      )}

      <div className="mt-auto space-y-1 pt-3 text-[11px] text-fg-faint">
        <div title={formatLocalTimestamp(signal.createdAt)}>
          Created {formatLocalDateTime(signal.createdAt)}
        </div>
        {signal.updatedAt !== signal.createdAt && (
          <div title={formatLocalTimestamp(signal.updatedAt)}>
            Updated {formatLocalDateTime(signal.updatedAt)}
          </div>
        )}
        {stateTime && (
          <div title={formatLocalTimestamp(stateTime.iso)}>
            {stateTime.label} {formatLocalDateTime(stateTime.iso)}
          </div>
        )}
        {signal.status === "active" && signal.expiresAt && (
          <div title={formatLocalTimestamp(signal.expiresAt)}>
            Expires {formatLocalDateTime(signal.expiresAt)}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-hairline pt-2">
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy className="h-3.5 w-3.5" />}
          onClick={() => onCopy(signal)}
          title="Copy signal"
          aria-label="Copy signal"
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<LineChart className="h-3.5 w-3.5" />}
          onClick={() => onOpenChart(signal)}
          title="Open analysis"
          aria-label="Open analysis"
        />
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {signal.status === "active" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => onEdit(signal)}
                  title="Edit signal"
                  aria-label="Edit signal"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
                  onClick={() => onPostUpdate(signal)}
                  title="Post update"
                  aria-label="Post update"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Ban className="h-3.5 w-3.5" />}
                  onClick={() => onInvalidate(signal)}
                  title="Invalidate signal"
                  aria-label="Invalidate signal"
                />
              </>
            )}
            {signal.status === "invalidated" && (
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => onRestore(signal)}
                title="Restore signal"
                aria-label="Restore signal"
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => onDelete(signal)}
              title="Delete permanently"
              aria-label="Delete permanently"
            />
          </div>
        )}
      </div>
    </Card>
  );
}

function Price({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`truncate text-[12.5px] font-semibold tabular-nums ${tone ?? "text-fg"}`}>{value}</div>
    </div>
  );
}

/** Skeleton used while the first page loads. */
export function SignalCardSkeleton() {
  return (
    <Card className="h-64 animate-pulse p-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 rounded bg-surface-hover" />
        <div className="h-4 w-16 rounded bg-surface-hover" />
      </div>
      <div className="mt-4 h-14 rounded-lg bg-surface-hover" />
      <div className="mt-4 h-3 w-full rounded bg-surface-hover" />
      <div className="mt-2 h-3 w-2/3 rounded bg-surface-hover" />
      <div className="mt-10 h-8 rounded bg-surface-hover" />
    </Card>
  );
}
