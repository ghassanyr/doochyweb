import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { api, getToken, setToken, type ConnectInput, type ModuleKey } from "./api";
import AnalysisPage from "./market/AnalysisPage";
import SignalsPage from "./signals/SignalsPage";
import BreakoutsPage from "./market/BreakoutsPage";
import AdminPage from "./admin/AdminPage";
import AdminSettingsPage from "./admin/AdminSettingsPage";
import AdminIntegrationsPage from "./admin/AdminIntegrationsPage";
import LearnPage from "./learn/LearnPage";
import HomePage from "./home/HomePage";
import { isViewKey, pathForView, resolveRoute, type ViewKey } from "./routing";
import AppShell from "./AppShell";
import Dashboard from "./Dashboard";
import AuthActionPage, { type AuthActionView } from "./AuthActionPage";
import Login from "./Login";
import MaintenanceScreen from "./MaintenanceScreen";
import SettingsPage from "./Settings";
import TradingConnect from "./TradingConnect";
import { useAccounts } from "./useAccounts";
import { AnimatedModal } from "./components/Modal";
import { Button, Card, Flash, Skeleton } from "./components/ui";
import { FALLBACK_MAINTENANCE, FALLBACK_NAVIGATION, useSiteConfig } from "./siteConfig";

const MODULE_VIEWS: readonly ModuleKey[] = [
  "analysis",
  "signals",
  "breakouts",
  "learn",
  "trading",
];

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
  const { config } = useSiteConfig();
  const navigation = config?.navigation ?? FALLBACK_NAVIGATION;
  const maintenance = config?.maintenance ?? FALLBACK_MAINTENANCE;
  // The configured landing page applies once, to the root URL, after the
  // session and public config are both known. Home stays reachable from the
  // header afterwards.
  const [landingApplied, setLandingApplied] = useState(false);

  // Canonicalize legacy query links once on load.
  useEffect(() => {
    const route = resolveRoute(window.location);
    if (route.redirectTo) window.history.replaceState(null, "", route.redirectTo);
  }, []);

  useEffect(() => {
    if (landingApplied || booting || !config) return;
    setLandingApplied(true);
    if (config.maintenance.enabled) return;
    if (window.location.pathname !== "/") return;
    const target = signedIn
      ? config.navigation.landing.signedIn
      : config.navigation.landing.signedOut;
    if (target === "home") return;
    setView(target);
    const url = new URL(window.location.href);
    url.pathname = pathForView(target);
    url.search = "";
    window.history.replaceState(null, "", url);
  }, [landingApplied, booting, config, signedIn]);

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
    if ((next === "admin" || next === "admin-settings" || next === "admin-integrations") && !isAdmin) return;
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

  const viewModule = (MODULE_VIEWS as readonly string[]).includes(view)
    ? (view as ModuleKey)
    : null;
  const viewAccess = viewModule
    ? navigation.modules.find((module) => module.key === viewModule)?.access ??
      (viewModule === "trading" ? "signed-in" : "public")
    : "public";
  const moduleLocked = !!viewModule && viewAccess === "signed-in" && !signedIn;
  const lockedLabel = viewModule
    ? navigation.modules.find((module) => module.key === viewModule)?.label ?? "this page"
    : "";

  const loginModal = (
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
      <Login
        mode={authMode}
        onModeChange={setAuthMode}
        onAuthed={handleAuthed}
        onForgotPassword={() => {
          setShowLogin(false);
          handleViewChange("forgot-password");
        }}
      />
    </AnimatedModal>
  );

  const authActionView: AuthActionView | null =
    view === "forgot-password" ||
    view === "reset-password" ||
    view === "verify-email" ||
    view === "accept-invite"
      ? view
      : null;

  // Email links must work during maintenance too; otherwise a buyer in
  // maintenance mode cannot recover an admin password.
  if (authActionView) {
    return (
      <AuthActionPage
        view={authActionView}
        onSignIn={() => {
          handleViewChange("home");
          openLogin();
        }}
        onAuthed={(t) => {
          setToken(t);
          setTokenState(t);
          handleViewChange("analysis");
        }}
      />
    );
  }

  // Maintenance covers the whole site for ordinary visitors. Auth, /api/me and
  // the public config stay reachable so an allowed admin can sign in and turn it
  // off from the admin panel.
  if (maintenance.enabled && !(maintenance.allowAdmins && isAdmin)) {
    return (
      <>
        <MaintenanceScreen
          message={maintenance.message || FALLBACK_MAINTENANCE.message}
          canSignIn={maintenance.allowAdmins}
          onSignIn={openLogin}
        />
        {loginModal}
      </>
    );
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
        ) : moduleLocked ? (
          <SignInPrompt
            title={`Sign in to view ${lockedLabel}`}
            body={`${lockedLabel} is available to signed-in members. Sign in to continue, or keep using the public pages.`}
            onSignIn={openLogin}
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
        ) : view === "admin-integrations" ? (
          isAdmin ? (
            <AdminIntegrationsPage onNavigate={handleViewChange} />
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
          <SignInPrompt
            title="Sign in to manage settings"
            body="Settings holds your cTrader connection, account preferences and notification options. Sign in to continue."
            onSignIn={openLogin}
          />
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

      {loginModal}
    </>
  );
}

function SignInPrompt({
  title,
  body,
  onSignIn,
}: {
  title: string;
  body: string;
  onSignIn: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-lg">
      <Card className="p-8 text-center shadow-overlay">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <LogIn className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</p>
        <div className="mt-5 flex justify-center">
          <Button
            variant="primary"
            size="lg"
            icon={<LogIn className="h-4 w-4" />}
            onClick={onSignIn}
          >
            Sign in
          </Button>
        </div>
      </Card>
    </div>
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
