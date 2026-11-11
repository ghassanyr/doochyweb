import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  Copy,
  ExternalLink,
  Link2,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";

import {
  ApiError,
  telegramApi,
  type TelegramLinkResponse,
  type TelegramStatus,
} from "../api";
import { Button, Card, Flash, buttonClass } from "../components/ui";

// The Telegram connect/manage card, shared by Settings and the Signals modal so
// both surfaces stay identical. All state is local; the optional callback lets
// the Signals page hide its "Connect Telegram" button once the account links.
export default function TelegramNotifications({
  showHeading = true,
  onStatusChange,
}: {
  showHeading?: boolean;
  onStatusChange?: (status: TelegramStatus) => void;
}) {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<TelegramLinkResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep the latest parent callback without re-running the fetch effects.
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const applyStatus = (next: TelegramStatus) => {
    setTg(next);
    onStatusChangeRef.current?.(next);
  };

  // Telegram connection state. The card is independent of cTrader credentials.
  useEffect(() => {
    let alive = true;
    telegramApi
      .status()
      .then((s) => {
        if (alive) applyStatus(s);
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof ApiError ? err.message : "Could not load Telegram status");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // applyStatus only touches stable setters and the callback ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a code is on screen, poll until the bot confirms the link.
  useEffect(() => {
    if (!link) return;
    let alive = true;
    const id = window.setInterval(() => {
      telegramApi
        .status()
        .then((s) => {
          if (!alive) return;
          applyStatus(s);
          if (s.linked) {
            setLink(null);
            setNotice("Telegram connected.");
          }
        })
        .catch(() => {});
    }, 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  async function connectTelegram() {
    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      setLink(await telegramApi.link());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create a Telegram link code");
    }
  }

  async function refreshTelegram() {
    setError(null);
    try {
      const s = await telegramApi.status();
      applyStatus(s);
      if (s.linked) {
        setLink(null);
        setNotice("Telegram connected.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not refresh Telegram status");
    }
  }

  async function toggleTelegram() {
    if (!tg?.linked) return;
    setError(null);
    setNotice(null);
    const next = !tg.notificationsEnabled;
    try {
      await telegramApi.setPrefs(next);
      applyStatus({ ...tg, notificationsEnabled: next });
      setNotice(next ? "Notifications resumed." : "Notifications paused.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update notifications");
    }
  }

  async function sendTelegramTest() {
    setError(null);
    setNotice(null);
    try {
      await telegramApi.test();
      setNotice("Test message queued. It should arrive in a few seconds.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send a test message");
    }
  }

  async function disconnectTelegram() {
    if (!window.confirm("Disconnect Telegram? You will stop receiving signal messages.")) return;
    setError(null);
    setNotice(null);
    try {
      await telegramApi.unlink();
      setLink(null);
      if (tg) {
        applyStatus({
          ...tg,
          linked: false,
          username: null,
          firstName: null,
          notificationsEnabled: false,
          linkedAt: null,
          lastError: null,
        });
      }
      setNotice("Telegram disconnected.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disconnect Telegram");
    }
  }

  async function copyTelegramCode() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the code; select it manually.");
    }
  }

  const body = (
    <div className={showHeading ? "mt-4 space-y-3" : "space-y-3"}>
      {error && <Flash tone="danger">{error}</Flash>}
      {notice && <Flash tone="success">{notice}</Flash>}

      {loading ? (
        <p className="text-sm text-fg-faint">Checking connection…</p>
      ) : !tg ? (
        <div>
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
        <p className="text-sm text-fg-faint">
          Telegram notifications are not configured on this server.
        </p>
      ) : tg.linked ? (
        <div className="space-y-4">
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
      ) : link ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Send this code to <span className="font-medium text-fg">@{link.botUsername}</span> in
            Telegram, or use the button below.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-base tracking-[0.2em] text-fg">
              {link.code}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              onClick={copyTelegramCode}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className={buttonClass("primary", "sm")}
              href={link.deepLink}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" /> Open @{link.botUsername}
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
            {new Date(link.expiresAt).toLocaleTimeString()}.
          </p>
        </div>
      ) : (
        <div>
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
    </div>
  );

  if (!showHeading) return body;

  return (
    <Card className="p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-fg">Telegram notifications</h2>
        <p className="text-sm text-fg-muted">
          Get a direct message from @{tg?.botUsername ?? "DoochyBot"} when a new signal is
          published.
        </p>
      </div>
      {body}
    </Card>
  );
}
