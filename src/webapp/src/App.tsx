import { useState } from "react";
import { LogIn } from "lucide-react";
import { api, getToken, setToken, type ConnectInput } from "./api";
import AnalysisPage from "./market/AnalysisPage";
import SignalsPage from "./signals/SignalsPage";
import BreakoutsPage from "./market/BreakoutsPage";
import AdminPage from "./admin/AdminPage";
import LearnPage from "./learn/LearnPage";
import { initialView } from "./initialView";
import AppShell, { type ViewKey } from "./AppShell";
import Dashboard from "./Dashboard";
import Login from "./Login";
import SettingsPage from "./Settings";
import TradingConnect from "./TradingConnect";
import { useAccounts } from "./useAccounts";
import { AnimatedModal } from "./components/Modal";
import { Button, Card, Skeleton } from "./components/ui";

// The Analysis, Breakouts and Learn pages are public: market quotes, the shared
// watchlist, the breakout feed and the anonymous drill carry no account data.
// The Trading tab holds cTrader credentials, positions and orders, so it stays
// behind auth.
export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "analysis";
    return initialView(window.location.search, window.location.hostname);
  });
  const [showSettings, setShowSettings] = useState(false);
  // Auth is a modal over the current view, not a tab. Clicking Sign in must not
  // move the visitor to Trading (or anywhere else); after auth they stay where
  // they were, and registration lands on Analysis only because a fresh account
  // has nothing to show on Trading yet.
  const [showLogin, setShowLogin] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const signedIn = !!token;
  const { accounts, setAccounts, hasCredentials, me, load, refreshBalances, connect } =
    useAccounts(signedIn);
  const isAdmin = me?.role === "admin";

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

  function openLogin() {
    setAuthMode("login");
    setShowLogin(true);
  }

  function handleAuthed(t: string, mode: "login" | "register") {
    setToken(t);
    setTokenState(t);
    setShowLogin(false);
    setAuthMode("login");
    // Registration is finished at this point. New accounts have no cTrader
    // credentials, so land on Analysis instead of the Trading tab's connect
    // card; Trading keeps the connection action when they want it.
    if (mode === "register") handleViewChange("analysis");
  }

  function handleViewChange(next: ViewKey) {
    if (next === "admin" && !isAdmin) return;
    setView(next);
    const url = new URL(window.location.href);
    let changed = false;
    if (next !== "breakouts" && url.searchParams.has("note")) {
      url.searchParams.delete("note");
      changed = true;
    }
    if (next !== "signals" && url.searchParams.has("signal")) {
      url.searchParams.delete("signal");
      changed = true;
    }
    if (next !== "learn" && url.searchParams.has("view")) {
      url.searchParams.delete("view");
      changed = true;
    }
    if (changed) window.history.replaceState(null, "", url);
  }

  function handleLogout() {
    setToken(null);
    setTokenState(null);
    setShowSettings(false);
    setShowLogin(false);
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
    <>
      <AppShell
        view={view}
        onViewChange={handleViewChange}
        onRefresh={signedIn ? refreshBalances : undefined}
        signedIn={signedIn}
        isAdmin={isAdmin}
        onOpenSettings={() => setShowSettings(true)}
        onSignIn={openLogin}
        onLogout={handleLogout}
      >
        {view === "admin" ? (
          isAdmin ? (
            <AdminPage />
          ) : (
            <AnalysisPage canRefresh={signedIn} canManageWatchlist={false} />
          )
        ) : view === "analysis" ? (
          <AnalysisPage canRefresh={signedIn} canManageWatchlist={isAdmin} />
        ) : view === "signals" ? (
          <SignalsPage canRefresh={signedIn} canManageSignals={isAdmin} />
        ) : view === "breakouts" ? (
          <BreakoutsPage canRefresh={signedIn} canManageWatchlist={isAdmin} />
        ) : view === "learn" ? (
          <LearnPage />
        ) : !signedIn ? (
          <div className="mx-auto w-full max-w-lg">
            <Card className="p-8 text-center shadow-overlay">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <LogIn className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">
                Sign in to view trading
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                The Trading tab shows your cTrader balances, positions and orders. Sign in to view
                them, or keep using the public market pages.
              </p>
              <div className="mt-5 flex justify-center">
                <Button
                  variant="primary"
                  size="lg"
                  icon={<LogIn className="h-4 w-4" />}
                  onClick={openLogin}
                >
                  Sign in
                </Button>
              </div>
            </Card>
          </div>
        ) : hasCredentials === null ? (
          <div className="mx-auto w-full max-w-sm space-y-3 py-8">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !hasCredentials ? (
          <TradingConnect
            onConnected={handleConnected}
            onSkip={() => handleViewChange("analysis")}
          />
        ) : (
          <Dashboard accounts={accounts} />
        )}
      </AppShell>

      <AnimatedModal
        open={showLogin && !signedIn}
        onClose={() => setShowLogin(false)}
        title={authMode === "login" ? "Sign in" : "Create account"}
        subtitle={
          authMode === "login"
            ? "Sign in to manage your cTrader accounts"
            : "Create an account to get started"
        }
      >
        <Login mode={authMode} onModeChange={setAuthMode} onAuthed={handleAuthed} />
      </AnimatedModal>
    </>
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
