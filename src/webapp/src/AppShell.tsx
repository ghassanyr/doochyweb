import { type ReactNode } from "react";
import { LogIn, LogOut, RefreshCw, Settings } from "lucide-react";

import { Button } from "./components/ui";

// Top-level shell: brand, primary navigation, and the account-level actions
// (settings / sign out). The Analysis, Breakouts, Learn and Trading views render
// inside it, so switching between them never remounts the chrome.
//
// The header used to live inside Dashboard; it was lifted here so more
// top-level views could share it. Styling follows the standalone Gauge project:
// sticky translucent topbar, a segmented control for the primary nav, and the
// 1600px page measure.

export type ViewKey = "trading" | "analysis" | "signals" | "breakouts" | "learn" | "admin";

const NAV: { key: ViewKey; label: string }[] = [
  { key: "analysis", label: "Analysis" },
  { key: "signals", label: "Signals" },
  { key: "breakouts", label: "Breakouts" },
  { key: "learn", label: "Learn" },
  { key: "trading", label: "Trading" },
];

const ADMIN_NAV: { key: ViewKey; label: string } = { key: "admin", label: "Admin" };

export function AppShell({
  view,
  onViewChange,
  onRefresh,
  signedIn,
  isAdmin,
  onOpenSettings,
  onSignIn,
  onLogout,
  children,
}: {
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  // Optional view-level refresh. Omitted for views that own their own refresh
  // control (the Analysis page has one in its toolbar).
  onRefresh?: () => Promise<void> | void;
  // The Analysis and Breakouts pages are public; the account-level actions
  // only appear once there is a session.
  signedIn: boolean;
  /** Shows the Admin tab; the API still enforces the role. */
  isAdmin: boolean;
  onOpenSettings: () => void;
  onSignIn: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const nav = isAdmin ? [...NAV, ADMIN_NAV] : NAV;
  return (
    <div className="min-h-screen bg-transparent text-fg">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-page items-center gap-5 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <img
              src="/doochy-mark-80.png"
              srcSet="/doochy-mark-40.png 1x, /doochy-mark-80.png 2x, /doochy-mark-120.png 3x, /doochy-mark-160.png 4x"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0"
              aria-hidden="true"
            />
            <div className="leading-tight">
              <div className="text-[17px] font-bold tracking-tight text-fg">Doochy</div>
              <div className="hidden text-[11px] text-fg-muted sm:block">
                Market analysis &amp; trading
              </div>
            </div>
          </div>

          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-hairline bg-soft p-[3px]"
            aria-label="Primary"
          >
            {nav.map((n) => {
              const active = view === n.key;
              return (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => onViewChange(n.key)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-md whitespace-nowrap px-3 py-1.5 text-[13px] transition duration-150 " +
                    (active
                      ? "bg-accent font-semibold text-accent-fg"
                      : "font-medium text-fg-muted hover:text-fg")
                  }
                >
                  {n.label}
                </button>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            {signedIn ? (
              <>
                {onRefresh && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClickAsync={async () => {
                      await onRefresh();
                    }}
                    aria-label="Refresh balances"
                    title="Refresh balances"
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Settings className="h-4 w-4" />}
                  onClick={onOpenSettings}
                  aria-label="Settings"
                  title="Settings"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LogOut className="h-4 w-4" />}
                  onClick={onLogout}
                  aria-label="Sign out"
                  title="Sign out"
                />
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<LogIn className="h-4 w-4" />}
                onClick={onSignIn}
                aria-label="Sign in"
                title="Sign in to manage trading accounts"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}

export default AppShell;
