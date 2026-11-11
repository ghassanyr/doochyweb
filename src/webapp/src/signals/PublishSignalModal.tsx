import { useEffect, useState } from "react";

import { marketApi } from "../api";
import type { CatalogEntry } from "../market/types";
import { SignalFormModal } from "./SignalFormModal";
import type { Signal, SignalDraft } from "./types";

// Loads the shared market catalog and timeframe list once so the trading tabs
// can open the same create form without duplicating that fetch.
export function PublishSignalModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: SignalDraft | null;
  onClose: () => void;
  onSaved: (signal: Signal) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [timeframes, setTimeframes] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    let alive = true;
    marketApi
      .config()
      .then((c) => {
        if (!alive) return;
        setCatalog(c.catalog);
        setTimeframes(c.timeframes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SignalFormModal
      open={draft != null}
      signal={null}
      initial={draft}
      catalog={catalog}
      timeframes={timeframes}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
