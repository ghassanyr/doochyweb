import { useState } from "react";
import { Plug } from "lucide-react";

import { api, ApiError, type Mt5AccountInput } from "./api";
import { Button, Card, Flash, inputCls } from "./components/ui";

export default function Mt5ConnectPanel({
  onConnected,
  onCancel,
}: {
  onConnected: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [login, setLogin] = useState("");
  const [server, setServer] = useState("");
  const [password, setPassword] = useState("");
  const [investorPassword, setInvestorPassword] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const input: Mt5AccountInput = {
        login: login.trim(),
        server: server.trim(),
        password,
        investorPassword: investorPassword || null,
        mode,
        nickname: nickname.trim() || null,
      };
      await api.connectMt5(input);
      setPassword("");
      setInvestorPassword("");
      await onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the MT5 account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-fg">Connect MetaTrader 5</h3>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        Credentials are encrypted on the server and never returned to the browser. MT5 access is read-only.
      </p>
      {error && (
        <div className="mt-3">
          <Flash tone="danger">{error}</Flash>
        </div>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Login</span>
          <input className={inputCls} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Server</span>
          <input className={inputCls} value={server} onChange={(e) => setServer(e.target.value)} autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Password</span>
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Investor password, optional</span>
          <input
            className={inputCls}
            type="password"
            value={investorPassword}
            onChange={(e) => setInvestorPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Mode</span>
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value === "live" ? "live" : "demo")}>
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-muted">Nickname, optional</span>
          <input className={inputCls} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !login.trim() || !server.trim() || !password}
          onClickAsync={submit}
        >
          {busy ? "Adding" : "Add MT5 account"}
        </Button>
      </div>
    </Card>
  );
}
