import { useEffect, useState } from "react";
import { LogIn, Settings } from "lucide-react";
import { api, getToken, setToken, type ConnectInput } from "./api";
import AnalysisPage from "./market/AnalysisPage";
import SignalsPage from "./signals/SignalsPage";
import BreakoutsPage from "./market/BreakoutsPage";
import AdminPage from "./admin/AdminPage";
import AdminSettingsPage from "./admin/AdminSettingsPage";
import LearnPage from "./learn/LearnPage";
import HomePage from "./home/HomePage";
import { isViewKey, pathForView, resolveRoute, type ViewKey } from "./routing";
import AppShell from "./AppShell";
import Dashboard from "./Dashboard";
import Login from "./Login";
import SettingsPage from "./Settings";
import TradingConnect from "./TradingConnect";
import { useAccounts } from "./useAccounts";
import { AnimatedModal } from "./components/Modal";
import { Button, Card, Flash, Skeleton } from "./components/ui";

// The Analysis, Breakouts and Learn pages are public: market quotes, the shared
// watchlist, the breakout feed and the anonymous drill carry no account data.
// The Trading tab holds cTrader credentials, positions and orders, so it stays
// behind auth.
export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [view, setView] = useState<ViewKey>(() => {
    if (typeof window === "undefined") return "analysis";
    return resolveRoute(window.location).view;
  });
  // Auth is a modal over the current view, not a tab. Clicking Sign in must not
  // move the visitor to Trading (or anywhere else); after auth they stay where
  // they were, and registration lands on Analysis only because a fresh account
  // has nothing to show on Trading yet.
  const [showLogin, setShowLogin] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  // Result of the cTrader consent round-trip: the server redirects back to
  // /trading?ctrader=connected (or ctrader_error=...).
  const [oauthNotice, setOauthNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(
    () => {
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams(window.location.search);
      if (params.get("ctrader") === "connected") {
        return { tone: "success", message: "cTrader connected." };
      }
      const error = params.get("ctrader_error");
      if (error) {
        return { tone: "danger", message: `cTrader sign-in failed: ${error.replaceAll("_", " ")}.` };
      }
      return null;
    }
  );
  const signedIn = !!token;
  const { accounts, setAccounts, hasCredentials, me, load, refreshBalances, connect } =
    useAccounts(signedIn);
  const isAdmin = me?.role === "admin";

  // Canonicalize legacy query links once on load.
  useEffect(() => {
    const route = resolveRoute(window.location);
    if (route.redirectTo) window.history.replaceState(null, "", route.redirectTo);
  }, []);

  // Browser back/forward switches the view without a full page load.
  useEffect(() => {
    function onPopState() {
      const route = resolveRoute(window.location);
      setView(route.view);
      if (route.redirectTo) window.history.replaceState(null, "", route.redirectTo);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Keep the notice on screen but drop the one-shot params so a reload does not
  // replay it.
  useEffect(() => {
    if (!oauthNotice) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("ctrader") && !url.searchParams.has("ctrader_error")) return;
    url.searchParams.delete("ctrader");
    url.searchParams.delete("ctrader_error");
    window.history.replaceState(null, "", url);
  }, [oauthNotice]);

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

  function openAuth(mode: "login" | "register") {
    setAuthMode(mode);
    setShowLogin(true);
  }

  function openLogin() {
    openAuth("login");
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
    if ((next === "admin" || next === "admin-settings") && !isAdmin) return;
    // Settings is a takeover, not a nav tab: always open it through the helper
    // so the back target is recorded.
    if (next === "settings") {
      openSettings();
      return;
    }
    const sameView = view === next;
    setView(next);

    const url = new URL(window.location.href);
    url.pathname = pathForView(next);
    url.searchParams.delete("view");
    if (next !== "breakouts") url.searchParams.delete("note");
    if (next !== "signals") url.searchParams.delete("signal");

    if (sameView) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }

  // Settings has a canonical URL so bot and support links can open it directly.
  // Remember where it was opened from so the back arrow returns there; a
  // direct link falls back to Home.
  function openSettings() {
    if (view === "settings") return;
    const from = view;
    setView("settings");
    const url = new URL(window.location.href);
    url.pathname = pathForView("settings");
    url.search = "";
    window.history.pushState({ settingsFrom: from }, "", url);
  }

  function closeSettings() {
    void load();
    const from = window.history.state?.settingsFrom;
    if (typeof from === "string" && isViewKey(from) && from !== "settings") {
      window.history.back();
      return;
    }
    // Direct link with no in-app history: replace it so Back does not reopen
    // Settings.
    const url = new URL(window.location.href);
    url.pathname = pathForView("home");
    url.search = "";
    setView("home");
    window.history.replaceState(null, "", url);
  }

  function handleLogout() {
    setToken(null);
    setTokenState(null);
    setShowLogin(false);
    handleViewChange("analysis");
  }

  // Settings manages cTrader credentials, so it is a takeover for signed-in
  // users only and sits outside the shell.
  if (view === "settings" && signedIn) {
    return (
      <SettingsPage
        accounts={accounts}
        hasCredentials={hasCredentials === true}
        onAccountsChanged={setAccounts}
        onConnected={handleConnected}
        onClose={closeSettings}
      />
    );
  }

  return (
    <>
      <AppShell
        view={view}
        onViewChange={handleViewChange}
        signedIn={signedIn}
        isAdmin={isAdmin}
        onOpenSettings={openSettings}
        onSignIn={openLogin}
        onLogout={handleLogout}
      >
        {view === "home" ? (
          <HomePage
            signedIn={signedIn}
            onRegister={() => openAuth("register")}
            onNavigate={handleViewChange}
          />
        ) : view === "admin" ? (
          isAdmin ? (
            <AdminPage currentUsername={me?.username} onNavigate={handleViewChange} />
          ) : (
            <AnalysisPage canRefresh={signedIn} canManageWatchlist={false} />
          )
        ) : view === "admin-settings" ? (
          isAdmin ? (
            <AdminSettingsPage onNavigate={handleViewChange} />
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
        ) : view === "settings" ? (
          <div className="mx-auto w-full max-w-lg">
            <Card className="p-8 text-center shadow-overlay">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Settings className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">
                Sign in to manage settings
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                Settings holds your cTrader connection, account preferences and notification
                options. Sign in to continue.
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
        ) : (
          <>
            {oauthNotice && (
              <div className="mx-auto w-full max-w-lg pb-3">
                <Flash tone={oauthNotice.tone}>{oauthNotice.message}</Flash>
              </div>
            )}
            {hasCredentials === null ? (
              <div className="mx-auto w-full max-w-sm space-y-3 py-8">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !hasCredentials ? (
              <TradingConnect
                oauthAvailable={me?.ctraderOAuth ?? false}
                onConnected={handleConnected}
                onSkip={() => handleViewChange("analysis")}
              />
            ) : (
              <Dashboard accounts={accounts} isAdmin={isAdmin} />
            )}
          </>
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
