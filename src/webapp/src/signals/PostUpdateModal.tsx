import { useEffect, useState } from "react";

import { signalsApi } from "../api";
import { AnimatedModal } from "../components/Modal";
import { Button, inputCls } from "../components/ui";
import { formatLocalDateTime } from "../time";
import type { Signal } from "./types";

export function PostUpdateModal({
  signal,
  onClose,
  onSaved,
}: {
  signal: Signal | null;
  onClose: () => void;
  onSaved: (signal: Signal) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setError(null);
  }, [signal]);

  async function submit(): Promise<void> {
    if (!signal) return;
    if (!note.trim()) {
      setError("Write a short update first.");
      return;
    }
    setError(null);
    try {
      const result = await signalsApi.postUpdate(signal.id, note);
      onSaved(result.signal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the update.");
    }
  }

  return (
    <AnimatedModal
      open={!!signal}
      onClose={onClose}
      title="Post update"
      subtitle={signal ? `${signal.symbol} ${signal.direction.toUpperCase()} · published on the card` : undefined}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Update note</span>
          <textarea
            className={inputCls + " min-h-[96px] resize-y"}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Partials taken, stop moved to breakeven…"
            autoFocus
          />
        </label>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <p className="text-[11px] text-fg-faint">
          Timestamped and appended to the public timeline. It does not change the signal levels.
          {signal ? ` Last updated ${formatLocalDateTime(signal.updatedAt)}.` : ""}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClickAsync={submit}>
            Post update
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
