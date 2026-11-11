import { useCallback, useEffect, useState } from "react";
import { GripVertical, Palette, Trash2, X } from "lucide-react";

import { adminApi, marketApi, type AdminUser } from "../api";
import { ConfirmModal } from "../components/Modal";
import { FadeRise } from "../components/motion";
import { RouteLink } from "../components/RouteLink";
import { Badge, Card, Flash, Skeleton, buttonClass } from "../components/ui";
import { applyOrder } from "../market/order";
import { SortableGrid } from "../market/SortableGrid";
import { SymbolSearch } from "../market/SymbolSearch";
import type { CatalogEntry } from "../market/types";
import type { ViewKey } from "../routing";
import { formatLocalDateTime } from "../time";

interface WatchItem {
  symbol: string;
}

// Admin-only curation of the shared watchlist, the account directory and the
// site presentation. The watchlist endpoints power the Analysis page, but they
// require the admin role server-side; this page is the only place that exposes
// them now.
export default function AdminPage({
  currentUsername,
  onNavigate,
}: {
  currentUsername?: string;
  onNavigate: (view: ViewKey) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await adminApi.users();
        if (alive) setUsers(res.users);
      } catch (err) {
        if (alive) setUsersError(err instanceof Error ? err.message : "Failed to load users");
      } finally {
        if (alive) setUsersLoading(false);
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

  async function confirmDelete() {
    if (!deleteTarget) return;
    setUsersError(null);
    try {
      await adminApi.deleteUser(deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to delete the user");
      // Keep the modal open so the message stays next to the action.
      throw err;
    }
  }

  return (
    <FadeRise>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">Admin</h1>
            <p className="text-sm text-fg-muted">
              Manage the shared watchlist, accounts and the site's branding.
            </p>
          </div>
          <RouteLink
            view="admin-settings"
            onNavigate={onNavigate}
            className={buttonClass("secondary")}
          >
            <Palette className="h-4 w-4" />
            Site settings
          </RouteLink>
        </div>

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

        <Card className="space-y-3 p-4">
          <div>
            <h2 className="text-base font-bold tracking-tight text-fg">Users</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              Every account on this deployment. Deleting a user also removes their cTrader
              credentials and Telegram link.
            </p>
          </div>

          {usersError && <Flash tone="danger">{usersError}</Flash>}

          {usersLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-muted">No users found.</p>
          ) : (
            <div className="divide-y divide-hairline">
              {users.map((u) => {
                const self = u.username === currentUsername;
                return (
                  <div key={u.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-fg">{u.username}</span>
                        {self && <span className="text-[11px] text-fg-faint">(you)</span>}
                        <Badge tone={u.role === "admin" ? "accent" : "muted"}>
                          {u.role === "admin" ? "Admin" : "User"}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-fg-muted">
                        {u.email ?? "no email"}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-xs tabular-nums text-fg-faint sm:block">
                      {u.createdAt ? formatLocalDateTime(u.createdAt) : "-"}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(u)}
                      disabled={self}
                      aria-label={`Delete ${u.username}`}
                      title={self ? "You cannot delete your own account" : `Delete ${u.username}`}
                      className="rounded-md p-1.5 text-danger transition duration-150 hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <ConfirmModal
          open={deleteTarget != null}
          title={deleteTarget ? `Delete ${deleteTarget.username}?` : "Delete user"}
          body={
            deleteTarget && (
              <span>
                This removes the account, its cTrader credentials and its Telegram link. This
                cannot be undone.
              </span>
            )
          }
          confirmLabel="Delete user"
          danger
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      </div>
    </FadeRise>
  );
}
