import { useEffect, useState } from "react";

import { signalsApi } from "../api";
import { ConfirmModal } from "../components/Modal";
import type { Signal } from "./types";

export function DeleteSignalModal({
  signal,
  onClose,
  onDeleted,
}: {
  signal: Signal | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [signal]);

  return (
    <ConfirmModal
      open={!!signal}
      danger
      title="Delete signal permanently?"
      confirmLabel="Delete forever"
      onClose={onClose}
      body={
        <div className="space-y-2">
          <p>
            {signal
              ? `${signal.symbol} ${signal.direction.toUpperCase()} will be removed from the feed and from History.`
              : ""}
          </p>
          <p className="font-medium text-danger">This cannot be undone.</p>
          {error && <p className="text-danger">{error}</p>}
        </div>
      }
      onConfirm={async () => {
        if (!signal) return;
        try {
          await signalsApi.remove(signal.id);
          onDeleted(signal.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not delete the signal.");
          throw err;
        }
      }}
    />
  );
}
