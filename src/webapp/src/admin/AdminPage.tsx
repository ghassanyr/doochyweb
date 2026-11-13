import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, GripVertical, KeyRound, Mail, Palette, Plug, Trash2, UserPlus, X } from "lucide-react";

import { adminApi, marketApi, type AdminSetupCheck, type AdminUser, type UserRole } from "../api";
import { ConfirmModal } from "../components/Modal";
import { FadeRise } from "../components/motion";
import { RouteLink } from "../components/RouteLink";
import { Badge, Button, Card, Flash, Skeleton, buttonClass, inputCls } from "../components/ui";
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

  const [checks, setChecks] = useState<AdminSetupCheck[]>([]);
  const [registrationMode, setRegistrationMode] = useState<string | null>(null);
  const [checksLoading, setChecksLoading] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");
  const [createBusy, setCreateBusy] = useState(false);
  const [usersNotice, setUsersNotice] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

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

  const loadUsers = useCallback(async () => {
    try {
      const res = await adminApi.users();
      setUsers(res.users);
      setUsersError(null);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadChecks = useCallback(async () => {
    try {
      const res = await adminApi.status();
      setChecks(res.checks);
      setRegistrationMode(res.registrationMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load setup status");
    } finally {
      setChecksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadChecks();
  }, [loadUsers, loadChecks]);

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

  async function createAccount() {
    if (createBusy) return;
    setUsersError(null);
    setUsersNotice(null);
    setCreateBusy(true);
    try {
      await adminApi.createUser({
        username: newUsername.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      });
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      setUsersNotice("Account created.");
      await loadUsers();
      await loadChecks();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to create the user");
    } finally {
      setCreateBusy(false);
    }
  }

  async function inviteAccount() {
    if (createBusy) return;
    setUsersError(null);
    setUsersNotice(null);
    setCreateBusy(true);
    try {
      await adminApi.inviteUser({
        username: newUsername.trim(),
        email: newEmail.trim(),
        role: newRole,
      });
      setNewUsername("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      setUsersNotice("Invite email sent. The account stays pending until the link is accepted.");
      await loadUsers();
      await loadChecks();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to send the invite");
    } finally {
      setCreateBusy(false);
    }
  }

  async function changeUser(id: string, patch: { role?: UserRole; status?: "active" | "pending" }) {
    setUsersError(null);
    try {
      await adminApi.updateUser(id, patch);
      await loadUsers();
      await loadChecks();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to update the user");
    }
  }

  async function confirmResetPassword() {
    if (!resetTarget) return;
    setUsersError(null);
    try {
      await adminApi.resetUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Failed to reset the password");
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
          <RouteLink
            view="admin-integrations"
            onNavigate={onNavigate}
            className={buttonClass("secondary")}
          >
            <Plug className="h-4 w-4" />
            Integrations
          </RouteLink>
        </div>

        <Card className="space-y-3 p-4">
          <div>
            <h2 className="text-base font-bold tracking-tight text-fg">Setup checklist</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              What still needs attention before this deployment is ready for buyers.
              {registrationMode && ` Registration is ${registrationMode}.`}
            </p>
          </div>
          {checksLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {checks.map((item) => (
                <div key={item.key} className="flex items-start gap-2.5 py-2.5">
                  {item.status === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        item.status === "todo" ? "text-danger" : "text-fg-faint"
                      }`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-fg">{item.label}</span>
                      <Badge
                        tone={
                          item.status === "ok"
                            ? "success"
                            : item.status === "todo"
                              ? "danger"
                              : "muted"
                        }
                      >
                        {item.status === "ok" ? "Ready" : item.status === "todo" ? "Needed" : "Optional"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-muted">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

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

          <div className="grid gap-2 rounded-xl border border-hairline bg-soft p-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">Username</span>
              <input
                className={inputCls}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">Email</span>
              <input
                className={inputCls}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">Password</span>
              <input
                className={inputCls}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-fg-muted">Role</span>
              <select
                className={inputCls}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
              <Button
                size="sm"
                variant="secondary"
                icon={<UserPlus className="h-3.5 w-3.5" />}
                onClickAsync={createAccount}
                disabled={
                  createBusy ||
                  !newUsername.trim() ||
                  !newEmail.trim() ||
                  newPassword.length < 8
                }
              >
                Create account
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Mail className="h-3.5 w-3.5" />}
                onClickAsync={inviteAccount}
                disabled={createBusy || !newUsername.trim() || !newEmail.trim()}
                title="Send an invite link instead of setting a password"
              >
                Invite by email
              </Button>
            </div>
          </div>

          {usersError && <Flash tone="danger">{usersError}</Flash>}
          {usersNotice && <Flash tone="success">{usersNotice}</Flash>}

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
                  <div key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-fg">{u.username}</span>
                        {self && <span className="text-[11px] text-fg-faint">(you)</span>}
                        <Badge tone={u.role === "admin" ? "accent" : "muted"}>
                          {u.role === "admin" ? "Admin" : "User"}
                        </Badge>
                        {u.status === "pending" && <Badge tone="danger">Pending</Badge>}
                        {u.status !== "pending" && !u.emailVerified && (
                          <Badge tone="accent">Email unverified</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-fg-muted">
                        {u.email ?? "no email"}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-xs tabular-nums text-fg-faint sm:block">
                      {u.createdAt ? formatLocalDateTime(u.createdAt) : "-"}
                    </div>
                    <select
                      value={u.role}
                      onChange={(e) => void changeUser(u.id, { role: e.target.value as UserRole })}
                      aria-label={`${u.username} role`}
                      className={`${inputCls} h-8 w-[92px] py-0 text-xs`}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    {u.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void changeUser(u.id, { status: "active" })}
                      >
                        Approve
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void changeUser(u.id, { status: "pending" })}
                        disabled={self}
                        title={self ? "You cannot suspend your own account" : "Block future sign-ins"}
                      >
                        Require approval
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setUsersError(null);
                        setResetTarget(u);
                        setResetPassword("");
                      }}
                      aria-label={`Reset ${u.username} password`}
                      title={`Reset ${u.username} password`}
                      className="rounded-md p-1.5 text-fg-muted transition duration-150 hover:bg-surface-hover hover:text-fg"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
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

        <ConfirmModal
          open={resetTarget != null}
          title={resetTarget ? `Reset ${resetTarget.username}'s password?` : "Reset password"}
          body={
            resetTarget && (
              <div className="space-y-2">
                <p>The user will sign in with this new password immediately.</p>
                <input
                  className={inputCls}
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
                {usersError && <Flash tone="danger">{usersError}</Flash>}
              </div>
            )
          }
          confirmLabel="Reset password"
          onConfirm={confirmResetPassword}
          onClose={() => {
            setResetTarget(null);
            setResetPassword("");
          }}
        />
      </div>
    </FadeRise>
  );
}
