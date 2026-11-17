import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";

import { api, ApiError, type Mt5AccountView } from "./api";
import { ConfirmModal } from "./components/Modal";
import { ACCOUNT_COLORS, Button, Card, Flash, inputCls } from "./components/ui";
import Mt5ConnectPanel from "./Mt5ConnectPanel";

type Prefs = { nickname: string; color: string | null };

function prefsFrom(accounts: Mt5AccountView[]): Record<string, Prefs> {
  return Object.fromEntries(
    accounts.map((account) => [
      account.id,
      { nickname: account.nickname ?? "", color: account.color ?? null },
    ])
  );
}

export default function Mt5AccountsPanel({
  onChanged,
}: {
  onChanged: () => void | Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Mt5AccountView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Prefs>>({});
  const [showConnect, setShowConnect] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Mt5AccountView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.mt5Accounts();
      setAccounts(result.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load MT5 accounts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDrafts(prefsFrom(accounts));
  }, [accounts]);

  async function save(account: Mt5AccountView) {
    const draft = drafts[account.id] ?? { nickname: "", color: null };
    setBusyId(account.id);
    setError(null);
    try {
      await api.setMt5Prefs(account.id, {
        nickname: draft.nickname.trim(),
        color: draft.color,
      });
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the MT5 account settings.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setError(null);
    try {
      await api.deleteMt5Account(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the MT5 account.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight text-fg">MetaTrader 5 accounts</h2>
          <p className="text-sm text-fg-muted">
            MT5 access is read-only. Login, server and passwords are encrypted on the server and never
            returned here.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setShowConnect(true)}
        >
          Add MT5 account
        </Button>
      </div>

      {error && (
        <div className="mt-3">
          <Flash tone="danger">{error}</Flash>
        </div>
      )}

      {showConnect && (
        <div className="mt-4">
          <Mt5ConnectPanel
            onCancel={() => setShowConnect(false)}
            onConnected={async () => {
              setShowConnect(false);
              await load();
              await onChanged();
            }}
          />
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="mt-4 text-xs text-fg-muted">
          No MT5 accounts connected. Add one to show its history alongside cTrader.
        </p>
      ) : (
        <div className="mt-3 divide-y divide-hairline">
          {accounts.map((account) => {
            const draft = drafts[account.id] ?? { nickname: "", color: null };
            const dirty =
              draft.nickname.trim() !== (account.nickname ?? "") ||
              (draft.color ?? null) !== (account.color ?? null);
            return (
              <div key={account.id} className="flex flex-wrap items-start gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-fg">
                      {account.nickname?.trim() || account.login}
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        account.mode === "live"
                          ? "bg-accent-soft text-accent"
                          : "bg-surface-active text-fg-muted"
                      }`}
                    >
                      {account.mode}
                    </span>
                    {account.lastError ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
                        <AlertCircle className="h-3.5 w-3.5" /> Needs attention
                      </span>
                    ) : (
                      <span className="text-[11px] text-fg-faint">{account.server}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Login {account.login}
                    {account.currency ? ` · ${account.currency}` : ""}
                  </p>
                  {account.lastError && (
                    <p className="mt-1 text-xs text-danger">{account.lastError}</p>
                  )}
                </div>
                <div className="flex w-full flex-col items-end gap-2 sm:w-64">
                  <input
                    className={inputCls}
                    value={draft.nickname}
                    maxLength={40}
                    placeholder="e.g. Prop firm"
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [account.id]: { ...draft, nickname: event.target.value },
                      }))
                    }
                  />
                  <div className="flex items-center gap-1.5">
                    {ACCOUNT_COLORS.map((color) => {
                      const active = draft.color === color.key;
                      return (
                        <button
                          key={color.key}
                          type="button"
                          title={color.label}
                          aria-label={color.label}
                          aria-pressed={active}
                          onClick={() =>
                            setDrafts((current) => ({
                              ...current,
                              [account.id]: {
                                ...draft,
                                color: active ? null : color.key,
                              },
                            }))
                          }
                          className={`h-5 w-5 rounded-full transition ${
                            active ? "ring-2 ring-white/80" : "ring-1 ring-white/15 hover:ring-white/40"
                          }`}
                          style={{ background: color.hex }}
                        />
                      );
                    })}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!dirty || busyId === account.id}
                      onClickAsync={() => save(account)}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      disabled={busyId === account.id}
                      onClick={() => setDeleteTarget(account)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={deleteTarget != null}
        title="Remove MT5 account?"
        body="The encrypted credentials and saved preferences for this account will be deleted. Journal entries already imported stay in your journal."
        confirmLabel="Remove account"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </Card>
  );
}
