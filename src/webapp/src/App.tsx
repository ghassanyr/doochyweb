import { useState } from "react";
import { api, getToken, setToken, type ConnectInput } from "./api";
import AnalysisPage from "./market/AnalysisPage";
import BreakoutsPage from "./market/BreakoutsPage";
import LearnPage from "./learn/LearnPage";
import AppShell, { type ViewKey } from "./AppShell";
import ConnectPanel from "./ConnectPanel";
import Dashboard from "./Dashboard";
import Login from "./Login";
import SettingsPage from "./Settings";
import { useAccounts } from "./useAccounts";
import { Skeleton } from "./components/ui";

// The Analysis, Breakouts and Learn pages are public: market quotes, the shared
// watchlist, the breakout feed and the anonymous drill carry no account data.
// The Trading tab holds cTrader credentials, positions and orders, so it stays
// behind auth.
export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [view, setView] = useState<ViewKey>(() => {
    // Shared note links land on the Breakouts tab, where the note panel lives.
    if (typeof window === "undefined") return "analysis";
    return new URLSearchParams(window.location.search).has("note") ? "breakouts" : "analysis";
  });
  const [showSettings, setShowSettings] = useState(false);
  const signedIn = !!token;
  const { accounts, setAccounts, hasCredentials, load, refreshBalances, connect } =
    useAccounts(signedIn);

  // Validate a stored token once on load; drop it if it expired.
  if (booting && token) {
    return (
      <BootstrapGate
        token={token}
        onValid={() => setBooting(false)}
        onInvalid={() => {
          setToken(null);
          setTokenState(null);
          setBooting(false);
        }}
      />
    );
  }

  async function handleConnected(creds: ConnectInput) {
    await connect(creds);
    await refreshBalances();
  }

  function handleAuthed(t: string) {
    setToken(t);
    setTokenState(t);
  }

  function handleViewChange(next: ViewKey) {
    setView(next);
    if (next === "breakouts") return;
    // A shared-note query belongs to the Breakouts tab; do not let it pull the
    // next reload back there after the user leaves.
    const url = new URL(window.location.href);
    if (!url.searchParams.has("note")) return;
    url.searchParams.delete("note");
    window.history.replaceState(null, "", url);
  }

  function handleLogout() {
    setToken(null);
    setTokenState(null);
    setShowSettings(false);
    handleViewChange("analysis");
  }

  // Settings manages cTrader credentials, so it is a takeover for signed-in
  // users only and sits outside the shell.
  if (showSettings && signedIn) {
    return (
      <SettingsPage
        accounts={accounts}
        onAccountsChanged={setAccounts}
        onConnected={handleConnected}
        onClose={() => {
          setShowSettings(false);
          void load();
        }}
      />
    );
  }

  return (
    <AppShell
      view={view}
      onViewChange={handleViewChange}
      onRefresh={signedIn ? refreshBalances : undefined}
      signedIn={signedIn}
      onOpenSettings={() => setShowSettings(true)}
      onSignIn={() => handleViewChange("trading")}
      onLogout={handleLogout}
    >
      {view === "analysis" ? (
        <AnalysisPage canWrite={signedIn} />
      ) : view === "breakouts" ? (
        <BreakoutsPage canWrite={signedIn} />
      ) : view === "learn" ? (
        <LearnPage />
      ) : !signedIn ? (
        <div className="flex justify-center py-8">
          <Login
            variant="inline"
            onAuthed={handleAuthed}
            hint="Sign in to view and manage your cTrader accounts. Market analysis above is public."
          />
        </div>
      ) : hasCredentials === null ? (
        <div className="mx-auto w-full max-w-sm space-y-3 py-8">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !hasCredentials ? (
        <ConnectPanel onConnected={handleConnected} />
      ) : (
        <Dashboard accounts={accounts} />
      )}
    </AppShell>
  );
}

// Rendered instead of the shell only while a stored token is being verified.
function BootstrapGate({
  token,
  onValid,
  onInvalid,
}: {
  token: string;
  onValid: () => void;
  onInvalid: () => void;
}) {
  useState(() => {
    api
      .me(token)
      .then(onValid)
      .catch(onInvalid);
  });
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
