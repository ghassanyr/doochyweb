import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, KeyRound, Link2, RefreshCw, Save } from "lucide-react";
import {
  api,
  ApiError,
  AccountView,
  ConnectInput,
} from "./api";
import ConnectPanel from "./ConnectPanel";
import { fmtMoney } from "./Dashboard";
import { ACCOUNT_COLORS, Button, Card, Flash, inputCls } from "./components/ui";
import { FadeRise } from "./components/motion";
import TelegramNotifications from "./telegram/TelegramNotifications";

type AccountPrefs = { nickname: string; color: string | null };

function prefsFrom(accounts: AccountView[]): Record<number, AccountPrefs> {
  return Object.fromEntries(accounts.map((a) => [a.ctid, { nickname: a.nickname ?? "", color: a.color ?? null }]));
}

export default function SettingsPage({
  accounts,
  hasCredentials,
  onConnected,
  onAccountsChanged,
  onClose,
}: {
  accounts: AccountView[];
  /** False for a fresh account that has never linked cTrader. */
  hasCredentials: boolean;
  onConnected: (creds: ConnectInput) => Promise<void>;
  onAccountsChanged: (accounts: AccountView[]) => void;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<Record<number, AccountPrefs>>(() => prefsFrom(accounts));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [clientIdMasked, setClientIdMasked] = useState<string | null>(null);
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [reconnectErr, setReconnectErr] = useState<string | null>(null);

  useEffect(() => {
    setPrefs(prefsFrom(accounts));
  }, [accounts]);

  // Which OpenAPI app is connected, so the credentials form can say so instead
  // of asking for the client id and secret all over again.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => {
        if (!alive) return;
        setClientIdMasked(r.clientIdMasked ?? null);
        setOauthAvailable(Boolean(r.ctraderOAuth));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function dirtyPairs(): { ctid: number; nickname: string; color: string | null }[] {
    return accounts
      .map((a) => {
        const p = prefs[a.ctid] ?? { nickname: "", color: null };
        const nickname = p.nickname.trim();
        const color = p.color ?? null;
        const dirty = nickname !== (a.nickname ?? "") || color !== (a.color ?? null);
        return dirty ? { ctid: a.ctid, nickname, color } : null;
      })
      .filter((x): x is { ctid: number; nickname: string; color: string | null } => x != null);
  }
  const anyDirty = dirtyPairs().length > 0;

  // Re-run consent so the user can refresh the session or change the accounts
  // cTrader shares. Without a platform OAuth app, fall back to the manual
  // credential form (where new tokens are generated).
  async function reconnectCtrader() {
    setReconnectErr(null);
    if (!oauthAvailable) {
      setShowConnect(true);
      return;
    }
    try {
      const { url } = await api.ctraderOAuthStart();
      window.location.assign(url);
    } catch (err: any) {
      setReconnectErr(err instanceof ApiError ? err.message : "Could not start cTrader sign-in");
    }
  }

  async function saveAll() {
    const pairs = dirtyPairs();
    if (!pairs.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all(pairs.map((c) => api.setPrefs(c.ctid, { nickname: c.nickname, color: c.color })));
      const { accounts: fresh } = await api.accounts();
      onAccountsChanged(fresh);
    } catch (err: any) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save nickname / colour");
    } finally {
      setSaving(false);
    }
  }

  if (showConnect) {
    return (
      <ConnectPanel
        storedClientId={clientIdMasked}
        oauthAvailable={oauthAvailable}
        onConnected={async (creds) => {
          await onConnected(creds);
          const { accounts: fresh } = await api.accounts();
          onAccountsChanged(fresh);
          setShowConnect(false);
        }}
        onCancel={() => setShowConnect(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-canvas/80 text-fg backdrop-blur-xl">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-1 px-4">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={onClose}
            aria-label="Back"
          />
          <div className="flex items-center gap-2">
            <img
              src="/doochy-mark-64.png"
              srcSet="/doochy-mark-32.png 1x, /doochy-mark-64.png 2x, /doochy-mark-96.png 3x"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0"
              aria-hidden="true"
            />
            <div className="text-[15px] font-semibold tracking-tight text-fg">Doochy</div>
            <span className="mt-0.5 rounded bg-surface px-1 py-px text-[11px] font-medium text-fg-faint">settings</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <FadeRise>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-fg">Settings</h1>
            <p className="text-sm text-fg-muted">Manage how accounts appear and how Doochy connects.</p>
          </div>
        </FadeRise>

        {saveError && (
          <Card className="border-danger/30 bg-danger-soft p-4">
            <div className="flex items-center gap-2 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {saveError}
            </div>
          </Card>
        )}

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
<h2 className="text-sm font-semibold tracking-tight text-fg">Account names & colours</h2>
              <p className="text-sm text-fg-muted">
                Nicknames and colours live on your side only; they are never sent to cTrader. Give each account its own
                name and colour so you can tell them apart at a glance on positions and orders.
              </p>
            </div>
            <div className="mt-3 divide-y divide-hairline">
              {accounts.map((a) => {
                const p = prefs[a.ctid] ?? { nickname: "", color: null };
                return (
                  <div key={a.ctid} className="flex items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            a.isLive
                              ? "bg-accent-soft text-accent"
                              : "bg-surface-active text-fg-muted"
                          }`}
                        >
                          {a.isLive ? "LIVE" : "DEMO"}
                        </span>
                        <span className="truncate text-sm font-medium tabular-nums text-fg">{a.login}</span>
                        <span className="truncate text-xs text-fg-faint">{a.broker}</span>
                      </div>
                      <div className="mt-0.5 text-xs tabular-nums text-fg-muted">
                        {a.balance != null ? `${fmtMoney(a.balance)} ${a.currency ?? ""}` : "- balance"}
                      </div>
                    </div>
                    <div className="flex w-48 shrink-0 flex-col items-end gap-2">
                      <input
                        className={inputCls}
                        value={p.nickname}
                        maxLength={40}
                        placeholder="e.g. Main"
                        onChange={(e) =>
                          setPrefs((d) => ({ ...d, [a.ctid]: { ...(d[a.ctid] ?? p), nickname: e.target.value } }))
                        }
                      />
                      <div className="flex items-center gap-1.5">
                        {ACCOUNT_COLORS.map((c) => {
                          const active = p.color === c.key;
                          return (
                            <button
                              key={c.key}
                              type="button"
                              title={c.label}
                              aria-label={c.label}
                              aria-pressed={active}
                              onClick={() =>
                                setPrefs((d) => ({
                                  ...d,
                                  [a.ctid]: { ...(d[a.ctid] ?? p), color: active ? null : c.key },
                                }))
                              }
                              className={`h-5 w-5 rounded-full transition ${
                                active ? "ring-2 ring-white/80" : "ring-1 ring-white/15 hover:ring-white/40"
                              }`}
                              style={{ background: c.hex }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-4">
              <span className="text-xs text-fg-faint">
                {anyDirty
                  ? `${dirtyPairs().length} unsaved change${dirtyPairs().length === 1 ? "" : "s"}`
                  : "Up to date"}
              </span>
<Button
                variant="primary"
                icon={<Save className="h-4 w-4" />}
                disabled={!anyDirty || saving}
                onClickAsync={saveAll}
              >
                Save changes
              </Button>
            </div>
          </Card>
        </FadeRise>

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-fg">cTrader access</h2>
              <p className="text-sm text-fg-muted">
                {hasCredentials
                  ? "Reconnect to refresh the cTrader session or change which accounts are available here."
                  : "Connect your cTrader account to load balances, positions and orders here."}
                {oauthAvailable ? " You'll approve access on cTrader and come straight back." : ""}
              </p>
            </div>
            {reconnectErr && (
              <div className="mt-3">
                <Flash tone="danger">{reconnectErr}</Flash>
              </div>
            )}
            <div className="mt-3">
              <Button
                variant="secondary"
                icon={
                  hasCredentials ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )
                }
                onClickAsync={reconnectCtrader}
              >
                {hasCredentials ? "Reconnect cTrader" : "Connect cTrader"}
              </Button>
            </div>
          </Card>
        </FadeRise>

        <FadeRise>
          <TelegramNotifications />
        </FadeRise>

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Credentials</h2>
              <p className="text-sm text-fg-muted">
                Manage the cTrader OpenAPI credentials used to fetch balances, positions and orders.
              </p>
              {clientIdMasked && (
                <p className="mt-1 font-mono text-xs text-fg-faint">App {clientIdMasked}</p>
              )}
            </div>
            <div className="mt-3">
              <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => setShowConnect(true)}>
                {clientIdMasked ? "Refresh tokens" : "Update credentials"}
              </Button>
            </div>
            {/* <p className="mt-3 text-xs leading-relaxed text-fg-faint">
              The server keeps a live-token version of these credentials inside ~/.doochyweb. Reconnecting renews it;
              there is nothing else to manage here.
            </p> */}
          </Card>
        </FadeRise>
      </main>
    </div>
  );
}