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

export type ViewKey = "trading" | "analysis" | "breakouts" | "learn";

const NAV: { key: ViewKey; label: string }[] = [
  { key: "analysis", label: "Analysis" },
  { key: "breakouts", label: "Breakouts" },
  { key: "learn", label: "Learn" },
  { key: "trading", label: "Trading" },
];

export function AppShell({
  view,
  onViewChange,
  onRefresh,
  signedIn,
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
  onOpenSettings: () => void;
  onSignIn: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-transparent text-fg">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-page items-center gap-5 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <GaugeMark />
            <div className="leading-tight">
              <div className="text-[17px] font-bold tracking-tight text-fg">DoochyWeb</div>
              <div className="hidden text-[11px] text-fg-muted sm:block">
                Market analysis &amp; trading
              </div>
            </div>
          </div>

          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-hairline bg-soft p-[3px]"
            aria-label="Primary"
          >
            {NAV.map((n) => {
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

// Gauge's dial mark, kept as the app logo so the branding matches the project
// the Analysis page came from.
function GaugeMark() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="30" height="30">
        <circle cx="16" cy="16" r="15" fill="#14b8a6" />
        <path d="M7 20a9 9 0 0 1 18 0" stroke="#e7edf5" strokeWidth="2.5" fill="none" />
        <line
          x1="16"
          y1="20"
          x2="21.5"
          y2="11"
          stroke="#e7edf5"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="16" cy="20" r="1.8" fill="#e7edf5" />
      </svg>
    </span>
  );
}

export default AppShell;
