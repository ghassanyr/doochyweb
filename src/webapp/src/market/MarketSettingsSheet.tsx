import { useEffect, useState } from "react";
import { AlertCircle, Link2, Save } from "lucide-react";

import { AnimatedModal } from "../components/Modal";
import { Button, Flash, inputCls } from "../components/ui";
import { marketApi } from "../api";
import { timeframes } from "./timeframes";
import type { MarketSettings } from "./types";

export function MarketSettingsSheet({
  settings,
  canEdit,
  onClose,
  onSaved,
}: {
  settings: MarketSettings;
  /** Only an admin can change the shared analysis settings. */
  canEdit: boolean;
  onClose: () => void;
  onSaved: (s: MarketSettings) => void;
}) {
  const [refreshSeconds, setRefreshSeconds] = useState(String(settings.refreshSeconds));
  const [defaultTimeframe, setDefaultTimeframe] = useState(settings.defaultTimeframe);
  const [strongRatio, setStrongRatio] = useState(String(settings.strongRatio));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRefreshSeconds(String(settings.refreshSeconds));
    setDefaultTimeframe(settings.defaultTimeframe);
    setStrongRatio(String(settings.strongRatio));
  }, [settings]);

  async function save() {
    if (!canEdit) return;
    setError(null);
    setSaved(false);
    try {
      const next = await marketApi.saveSettings({
        refreshSeconds: Number(refreshSeconds),
        defaultTimeframe,
        strongRatio: Number(strongRatio),
      });
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  return (
    <AnimatedModal open onClose={onClose} title="Analysis settings">
      <div className="space-y-4">
        {error && <Flash tone="danger">{error}</Flash>}
        {saved && !error && canEdit && <Flash tone="success">Settings saved</Flash>}

        {settings.account ? (
          <div className="flex gap-2.5 rounded-xl border border-success/25 bg-success-soft/50 p-3 text-xs leading-relaxed text-fg-muted">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>
              Prices come from your cTrader account{" "}
              <strong className="text-fg">
                {settings.account.login} · {settings.account.broker}
              </strong>{" "}
              ({settings.account.isLive ? "live" : "demo"},{" "}
              {settings.account.symbolCount.toLocaleString()} symbols). Every card on this page is
              analysed from your broker's own bars.
            </span>
          </div>
        ) : (
          <div className="flex gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-xs leading-relaxed text-fg-muted">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>
              <strong className="text-fg">No cTrader account is connected</strong>, so there is
              nothing to read bars from.{" "}
              {settings.accountError ?? "Add cTrader Open API credentials in Settings."}
            </span>
          </div>
        )}

        <div className="rounded-xl border border-hairline bg-soft p-3 text-xs leading-relaxed text-fg-faint">
          <span className="font-medium text-fg">Token safety.</span> This page reads bars but never
          refreshes your cTrader tokens. A cTrader refresh rotates the grant and would invalidate
          any other process trading the same account, so a token is only replaced when you
          re-enter the credentials yourself.
        </div>

        <div className="space-y-1.5">
          <label htmlFor="m-strong" className="text-xs font-medium text-fg-muted">
            Strong Buy/Sell sensitivity
          </label>
          <input
            id="m-strong"
            type="number"
            step={0.05}
            min={0.05}
            max={1}
            className={inputCls}
            value={strongRatio}
            onChange={(e) => setStrongRatio(e.target.value)}
            disabled={!canEdit}
          />
          <p className="text-xs text-fg-faint">
            Net buy/sell vote ratio that upgrades Buy/Sell to Strong. Lower triggers more easily
            (default 0.25).
          </p>
          {!canEdit && (
            <p className="text-xs text-fg-faint">
              Only an admin can change the shared sensitivity.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {canEdit && (
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClickAsync={save}>
            Save
          </Button>
        )}
      </div>
    </AnimatedModal>
  );
}