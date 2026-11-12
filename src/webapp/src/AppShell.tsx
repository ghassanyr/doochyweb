import { type ReactNode } from "react";
import { LogIn, LogOut, Moon, Settings, Sun } from "lucide-react";

import { AnnouncementBanner } from "./AnnouncementBanner";
import { RouteLink } from "./components/RouteLink";
import { Button } from "./components/ui";
import { pathForView, type ViewKey } from "./routing";
import { FALLBACK_ANNOUNCEMENT, FALLBACK_MODULES, useSiteConfig } from "./siteConfig";

// Top-level shell: brand, primary navigation, and the account-level actions
// (settings / sign out). The Analysis, Breakouts, Learn and Trading views render
// inside it, so switching between them never remounts the chrome.
//
// The header used to live inside Dashboard; it was lifted here so more
// top-level views could share it. Styling follows the standalone Gauge project:
// sticky translucent topbar, a segmented control for the primary nav, and the
// 1600px page measure.
//
// Tab order, labels and visibility come from site settings; the Admin tab is
// appended for admins and is not configurable.

const ADMIN_NAV: { key: ViewKey; label: string } = { key: "admin", label: "Admin" };

export function AppShell({
  view,
  onViewChange,
  signedIn,
  isAdmin,
  onOpenSettings,
  onSignIn,
  onLogout,
  children,
}: {
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
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
  const { config, branding, mode, toggleMode } = useSiteConfig();
  const modules = (config?.navigation.modules ?? FALLBACK_MODULES).filter(
    (module) => !module.hidden
  );
  const nav: { key: ViewKey; label: string }[] = modules.map((module) => ({
    key: module.key,
    label: module.label,
  }));
  const items = isAdmin ? [...nav, ADMIN_NAV] : nav;
  const logoUrl = branding.logoUrl || "/doochy-mark-80.png";
  const defaultLogo = !branding.logoUrl;
  const nextMode = mode === "dark" ? "light" : "dark";
  return (
    <div className="min-h-screen bg-transparent text-fg">
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-page items-center gap-5 px-4 sm:px-6">
          <RouteLink
            view="home"
            onNavigate={onViewChange}
            className="flex shrink-0 items-center gap-2.5"
            aria-label={`${branding.name} home`}
            title={`${branding.name} home`}
          >
            <img
              src={logoUrl}
              srcSet={
                defaultLogo
                  ? "/doochy-mark-40.png 1x, /doochy-mark-80.png 2x, /doochy-mark-120.png 3x, /doochy-mark-160.png 4x"
                  : undefined
              }
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0"
              aria-hidden="true"
            />
            <div className="leading-tight">
              <div className="text-[17px] font-bold tracking-tight text-fg">{branding.name}</div>
              {branding.tagline && (
                <div className="hidden text-[11px] text-fg-muted sm:block">{branding.tagline}</div>
              )}
            </div>
          </RouteLink>

          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-hairline bg-soft p-[3px]"
            aria-label="Primary"
          >
            {items.map((n) => {
              const active =
                view === n.key ||
                (n.key === "admin" &&
                  (view === "admin-settings" || view === "admin-integrations"));
              return (
                <a
                  key={n.key}
                  href={pathForView(n.key)}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      return;
                    }
                    event.preventDefault();
                    onViewChange(n.key);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-md whitespace-nowrap px-3 py-1.5 text-[13px] transition duration-150 " +
                    (active
                      ? "bg-accent font-semibold text-accent-fg"
                      : "font-medium text-fg-muted hover:text-fg")
                  }
                >
                  {n.label}
                </a>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              onClick={toggleMode}
              aria-label={`Switch to ${nextMode} theme`}
              title={`Switch to ${nextMode} theme`}
            />
            {signedIn ? (
              <>
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

      <AnnouncementBanner announcement={config?.announcement ?? FALLBACK_ANNOUNCEMENT} />

      <main className="mx-auto max-w-page px-4 py-5 sm:px-6">{children}</main>

      {(branding.footerText || branding.supportEmail) && (
        <footer className="mx-auto max-w-page px-4 pb-6 pt-2 text-center text-[11px] leading-relaxed text-fg-faint sm:px-6">
          {branding.footerText}
          {branding.footerText && branding.supportEmail && (
            <span aria-hidden="true"> • </span>
          )}
          {branding.supportEmail && (
            <a
              href={`mailto:${branding.supportEmail}`}
              className="transition hover:text-accent"
            >
              {branding.supportEmail}
            </a>
          )}
        </footer>
      )}
    </div>
  );
}

export default AppShell;
