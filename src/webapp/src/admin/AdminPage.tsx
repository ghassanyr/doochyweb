import { useCallback, useEffect, useState } from "react";
import { GripVertical, X } from "lucide-react";

import { marketApi } from "../api";
import { FadeRise } from "../components/motion";
import { Card, Flash, Skeleton } from "../components/ui";
import { applyOrder } from "../market/order";
import { SortableGrid } from "../market/SortableGrid";
import { SymbolSearch } from "../market/SymbolSearch";
import type { CatalogEntry } from "../market/types";

interface WatchItem {
  symbol: string;
}

// Admin-only curation of the shared watchlist. The same endpoints power the
// Analysis page, but they require the admin role server-side; this page is the
// only place that exposes them now.
export default function AdminPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWatchlist = useCallback(async () => {
    const watch = await marketApi.watchlist();
    setItems(applyOrder(watch.symbols.map((symbol) => ({ symbol })), watch.order));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [config, watch] = await Promise.all([marketApi.config(), marketApi.watchlist()]);
        if (!alive) return;
        setCatalog(config.catalog);
        setItems(applyOrder(watch.symbols.map((symbol) => ({ symbol })), watch.order));
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load the watchlist");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback(
    async (raw: string) => {
      const symbol = raw.trim();
      if (!symbol) return;
      setBusy(true);
      try {
        await marketApi.addSymbol(symbol);
        await loadWatchlist();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to add ${symbol}`);
      } finally {
        setBusy(false);
      }
    },
    [loadWatchlist]
  );

  const remove = useCallback(
    async (symbol: string) => {
      setBusy(true);
      try {
        await marketApi.removeSymbol(symbol);
        await loadWatchlist();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to remove ${symbol}`);
      } finally {
        setBusy(false);
      }
    },
    [loadWatchlist]
  );

  const reorder = useCallback(
    async (next: WatchItem[]) => {
      const previous = items;
      setItems(next);
      try {
        await marketApi.saveOrder(next.map((item) => item.symbol));
        setError(null);
      } catch (err) {
        // The layout is cosmetic; put the list back where it was.
        setItems(previous);
        setError(err instanceof Error ? err.message : "Failed to save the card order");
      }
    },
    [items]
  );

  return (
    <FadeRise>
      <div className="space-y-3">
        <Card className="space-y-3 p-4">
          <div>
            <h2 className="text-base font-bold tracking-tight text-fg">Watchlist</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              Controls the markets every visitor sees on the Analysis page.
            </p>
          </div>

          <SymbolSearch catalog={catalog} onAdd={(s) => void add(s)} disabled={busy || loading} />

          {error && <Flash tone="danger">{error}</Flash>}

          {loading ? (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-muted">
              The watchlist is empty. Add a market above.
            </p>
          ) : (
            <SortableGrid
              items={items}
              onReorder={(next) => void reorder(next)}
              canReorder={!busy}
              className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]"
              renderItem={(item) => (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-soft px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
                    <span className="truncate text-sm font-semibold text-fg">{item.symbol}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(item.symbol)}
                    disabled={busy}
                    aria-label={`Remove ${item.symbol}`}
                    title={`Remove ${item.symbol}`}
                    className="rounded-md p-1 text-fg-faint transition duration-150 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            />
          )}
        </Card>

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Drag a market to change its card order on the Analysis page. Changes apply to every
          visitor.
        </p>
      </div>
    </FadeRise>
  );
}
