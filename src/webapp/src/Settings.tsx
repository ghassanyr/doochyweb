import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  Send,
  Unplug,
} from "lucide-react";
import {
  api,
  ApiError,
  AccountView,
  ConnectInput,
  telegramApi,
  type TelegramLinkResponse,
  type TelegramStatus,
} from "./api";
import ConnectPanel from "./ConnectPanel";
import { fmtMoney } from "./Dashboard";
import { ACCOUNT_COLORS, Button, Card, Flash, buttonClass, inputCls } from "./components/ui";
import { FadeRise } from "./components/motion";

type AccountPrefs = { nickname: string; color: string | null };

function prefsFrom(accounts: AccountView[]): Record<number, AccountPrefs> {
  return Object.fromEntries(accounts.map((a) => [a.ctid, { nickname: a.nickname ?? "", color: a.color ?? null }]));
}

export default function SettingsPage({
  accounts,
  onConnected,
  onAccountsChanged,
  onClose,
}: {
  accounts: AccountView[];
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
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [tgLoading, setTgLoading] = useState(true);
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgNotice, setTgNotice] = useState<string | null>(null);
  const [tgLink, setTgLink] = useState<TelegramLinkResponse | null>(null);
  const [tgCopied, setTgCopied] = useState(false);

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

  // Telegram connection state. The card is independent of cTrader credentials.
  useEffect(() => {
    let alive = true;
    telegramApi
      .status()
      .then((s) => {
        if (alive) setTg(s);
      })
      .catch((err) => {
        if (alive) {
          setTgError(err instanceof ApiError ? err.message : "Could not load Telegram status");
        }
      })
      .finally(() => {
        if (alive) setTgLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // While a code is on screen, poll until the bot confirms the link.
  useEffect(() => {
    if (!tgLink) return;
    let alive = true;
    const id = setInterval(() => {
      telegramApi
        .status()
        .then((s) => {
          if (!alive) return;
          setTg(s);
          if (s.linked) {
            setTgLink(null);
            setTgNotice("Telegram connected.");
          }
        })
        .catch(() => {});
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [tgLink]);

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

  async function connectTelegram() {
    setTgError(null);
    setTgNotice(null);
    setTgCopied(false);
    try {
      setTgLink(await telegramApi.link());
    } catch (err) {
      setTgError(err instanceof ApiError ? err.message : "Could not create a Telegram link code");
    }
  }

  async function refreshTelegram() {
    setTgError(null);
    try {
      const s = await telegramApi.status();
      setTg(s);
      if (s.linked) {
        setTgLink(null);
        setTgNotice("Telegram connected.");
      }
    } catch (err) {
      setTgError(err instanceof ApiError ? err.message : "Could not refresh Telegram status");
    }
  }

  async function toggleTelegram() {
    if (!tg?.linked) return;
    setTgError(null);
    setTgNotice(null);
    const next = !tg.notificationsEnabled;
    try {
      await telegramApi.setPrefs(next);
      setTg({ ...tg, notificationsEnabled: next });
      setTgNotice(next ? "Notifications resumed." : "Notifications paused.");
    } catch (err) {
      setTgError(err instanceof ApiError ? err.message : "Could not update notifications");
    }
  }

  async function sendTelegramTest() {
    setTgError(null);
    setTgNotice(null);
    try {
      await telegramApi.test();
      setTgNotice("Test message queued. It should arrive in a few seconds.");
    } catch (err) {
      setTgError(err instanceof ApiError ? err.message : "Could not send a test message");
    }
  }

  async function disconnectTelegram() {
    if (!window.confirm("Disconnect Telegram? You will stop receiving signal messages.")) return;
    setTgError(null);
    setTgNotice(null);
    try {
      await telegramApi.unlink();
      setTgLink(null);
      setTg((prev) =>
        prev
          ? {
              ...prev,
              linked: false,
              username: null,
              firstName: null,
              notificationsEnabled: false,
              linkedAt: null,
              lastError: null,
            }
          : prev
      );
      setTgNotice("Telegram disconnected.");
    } catch (err) {
      setTgError(err instanceof ApiError ? err.message : "Could not disconnect Telegram");
    }
  }

  async function copyTelegramCode() {
    if (!tgLink) return;
    try {
      await navigator.clipboard.writeText(tgLink.code);
      setTgCopied(true);
      setTimeout(() => setTgCopied(false), 2000);
    } catch {
      setTgError("Could not copy the code; select it manually.");
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
            <div className="text-[15px] font-semibold tracking-tight text-fg">DoochyWeb</div>
            <span className="mt-0.5 rounded bg-surface px-1 py-px text-[11px] font-medium text-fg-faint">settings</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <FadeRise>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-fg">Settings</h1>
            <p className="text-sm text-fg-muted">Manage how accounts appear and how DoochyWeb connects.</p>
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
                Reconnect to refresh the cTrader session or change which accounts are available here.
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
                icon={<RefreshCw className="h-4 w-4" />}
                onClickAsync={reconnectCtrader}
              >
                Reconnect cTrader
              </Button>
            </div>
          </Card>
        </FadeRise>

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Telegram notifications</h2>
              <p className="text-sm text-fg-muted">
                Get a direct message from @{tg?.botUsername ?? "DoochyBot"} when a new signal is published.
              </p>
            </div>

            {tgError && (
              <div className="mt-3">
                <Flash tone="danger">{tgError}</Flash>
              </div>
            )}
            {tgNotice && (
              <div className="mt-3">
                <Flash tone="success">{tgNotice}</Flash>
              </div>
            )}

            {tgLoading ? (
              <p className="mt-3 text-sm text-fg-faint">Checking connection…</p>
            ) : !tg ? (
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw className="h-4 w-4" />}
                  onClickAsync={refreshTelegram}
                >
                  Retry
                </Button>
              </div>
            ) : !tg.enabled ? (
              <p className="mt-3 text-sm text-fg-faint">
                Telegram notifications are not configured on this server.
              </p>
            ) : tg.linked ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    <Check className="h-3.5 w-3.5" />
                    {tg.username ? `@${tg.username}` : tg.firstName || "Connected"}
                  </span>
                  {tg.linkedAt && (
                    <span className="text-xs text-fg-faint">
                      Linked {new Date(tg.linkedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {tg.lastError && (
                  <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                    Last delivery error: {tg.lastError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={tg.notificationsEnabled ? "secondary" : "primary"}
                    size="sm"
                    icon={
                      tg.notificationsEnabled ? (
                        <BellOff className="h-4 w-4" />
                      ) : (
                        <Bell className="h-4 w-4" />
                      )
                    }
                    onClickAsync={toggleTelegram}
                  >
                    {tg.notificationsEnabled ? "Pause notifications" : "Resume notifications"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Send className="h-4 w-4" />}
                    onClickAsync={sendTelegramTest}
                  >
                    Send test message
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Unplug className="h-4 w-4" />}
                    onClickAsync={disconnectTelegram}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : tgLink ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-fg-muted">
                  Send this code to{" "}
                  <span className="font-medium text-fg">@{tgLink.botUsername}</span> in Telegram, or use
                  the button below.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-base tracking-[0.2em] text-fg">
                    {tgLink.code}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={tgCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    onClick={copyTelegramCode}
                  >
                    {tgCopied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className={buttonClass("primary", "sm")}
                    href={tgLink.deepLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" /> Open @{tgLink.botUsername}
                  </a>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClickAsync={refreshTelegram}
                  >
                    Check connection
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Link2 className="h-4 w-4" />}
                    onClickAsync={connectTelegram}
                  >
                    New code
                  </Button>
                </div>
                <p className="text-xs text-fg-faint">
                  Waiting for the bot to confirm… The code expires{" "}
                  {new Date(tgLink.expiresAt).toLocaleTimeString()}.
                </p>
              </div>
            ) : (
              <div className="mt-4">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Link2 className="h-4 w-4" />}
                  onClickAsync={connectTelegram}
                >
                  Connect Telegram
                </Button>
              </div>
            )}
          </Card>
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