import { useEffect, useState } from "react";

import { signalsApi } from "../api";
import { AnimatedModal } from "../components/Modal";
import { Button, inputCls } from "../components/ui";
import type { Signal } from "./types";

export function InvalidateModal({
  signal,
  onClose,
  onSaved,
}: {
  signal: Signal | null;
  onClose: () => void;
  onSaved: (signal: Signal) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setError(null);
  }, [signal]);

  async function submit(): Promise<void> {
    if (!signal) return;
    setError(null);
    try {
      const result = await signalsApi.invalidate(signal.id, reason);
      onSaved(result.signal);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invalidate the signal.");
    }
  }

  return (
    <AnimatedModal
      open={!!signal}
      onClose={onClose}
      title="Invalidate signal"
      subtitle={signal ? `${signal.symbol} ${signal.direction.toUpperCase()} moves to History` : undefined}
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          It disappears from Active but stays visible in History. You can restore it later.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Reason (optional)</span>
          <textarea
            className={inputCls + " min-h-[80px] resize-y"}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Setup invalidated by the 4H close…"
            autoFocus
          />
        </label>
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClickAsync={submit}>
            Invalidate
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
