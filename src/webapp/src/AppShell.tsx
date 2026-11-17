import { useEffect, useRef, useState, type ReactNode } from "react";
import { Home, Lock, LogIn, LogOut, Menu, Moon, MoreHorizontal, Settings, Sun } from "lucide-react";

import { type BrandingSettings, type LegalSettings, type ModuleSettings, type NavGroupSettings } from "./api";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { AppSidebar, moduleIcon } from "./AppSidebar";
import { RouteLink } from "./components/RouteLink";
import { Button } from "./components/ui";
import { isModuleLocked, quickModules } from "./navigation";
import { pathForView, viewFromPath, type ViewKey } from "./routing";
import {
  FALLBACK_ANNOUNCEMENT,
  FALLBACK_LEGAL,
  FALLBACK_MODULES,
  FALLBACK_NAV_GROUPS,
  brandMarkUrl,
  isBundledBrand,
  useSiteConfig,
} from "./siteConfig";

// Top-level shell: brand, primary navigation, and the account-level actions
// (settings / sign out). The Analysis, Breakouts, Learn and Trading views render
// inside it, so switching between them never remounts the chrome.
//
// The app used to carry a single segmented pill bar. With nine destinations it
// became a scrolling row with no grouping and no mobile menu, so the app pages
// now use the left sidebar in AppSidebar. The signed-out marketing Home keeps
// the older top bar, where the hero and the conversion path still lead.
//
// Tab order, labels, visibility and access come from site settings. Groups are
// derived in code, see navigation.ts, while the configured order is preserved
// inside each group.

const ADMIN_NAV: { key: ViewKey; label: string } = { key: "admin", label: "Admin" };

const SIDEBAR_COLLAPSED_KEY = "doochyweb_sidebar_collapsed";

export function AppShell({
  view,
  onViewChange,
  signedIn,
  isAdmin,
  username,
  hasCredentials,
  accountCount,
  onOpenSettings,
  onSignIn,
  onRegister,
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
  username: string | null;
  /** Null while /api/me is still loading. */
  hasCredentials: boolean | null;
  accountCount: number;
  onOpenSettings: () => void;
  onSignIn: () => void;
  onRegister: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { config, branding, theme, mode, toggleMode, social } = useSiteConfig();
  const legal = config?.legal ?? FALLBACK_LEGAL;
  const modules = (config?.navigation.modules ?? FALLBACK_MODULES).filter(
    (module) => !module.hidden && (module.access !== "admin" || isAdmin)
  );
  const groups = config?.navigation.groups ?? FALLBACK_NAV_GROUPS;
  const socialLinks = Object.entries(social).filter(([, url]) => url.trim() !== "");
  const nav: { key: ViewKey; label: string }[] = modules.map((module) => ({
    key: module.key,
    label: module.label,
  }));
  const items = isAdmin ? [...nav, ADMIN_NAV] : nav;
  const logoUrl = brandMarkUrl(branding, theme, 80);
  const defaultLogo = isBundledBrand(branding);
  const nextMode = mode === "dark" ? "light" : "dark";

  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  // Navigation closes the drawer, so a link never leaves it hanging open.
  useEffect(() => {
    setDrawerOpen(false);
  }, [view]);

  // The collapse choice belongs to this browser, like the theme choice.
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage can be blocked; the sidebar still works for this page life.
    }
  }, [collapsed]);

  // While the drawer is open, keep Tab inside it, close on Escape, and stop the
  // page behind it from scrolling.
  useEffect(() => {
    if (!drawerOpen) return;
    const panel = drawerRef.current;
    const focusables = panel
      ? Array.from(
          panel.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
      : [];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  function openDrawer(trigger: HTMLElement) {
    // Keep the real trigger, so closing the drawer always returns focus to it.
    drawerTriggerRef.current = trigger;
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }

  // A locked item or the footer action opens the auth modal. Close the drawer
  // first so the modal is not left sitting on top of an open drawer. The modal
  // takes focus, so there is no focus return to the trigger here.
  function closeDrawerThen(action: () => void) {
    setDrawerOpen(false);
    action();
  }

  // The marketing Home is the one page that keeps the full-width top bar. The
  // workspace and every public app page use the sidebar.
  const showSidebar = signedIn || view !== "home";

  if (!showSidebar) {
    return (
      <div className="min-h-screen bg-transparent text-fg">
        <SkipLink />
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
                  <div className="hidden text-[11px] text-fg-muted sm:block">
                    {branding.tagline}
                  </div>
                )}
              </div>
            </RouteLink>

            <nav
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-hairline bg-soft p-[3px]"
              aria-label="Primary"
            >
              {items.map((n) => {
                const active = view === n.key;
                return (
                  <a
                    key={n.key}
                    href={pathForView(n.key)}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      ) {
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

        <main id="main-content" className="mx-auto max-w-page px-4 py-5 sm:px-6">
          {children}
        </main>

        <SiteFooter
          legal={legal}
          branding={branding}
          socialLinks={socialLinks}
          onNavigate={onViewChange}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-fg">
      <SkipLink />

      <aside
        className={
          "fixed inset-y-0 left-0 z-40 hidden border-r border-hairline bg-canvas/95 backdrop-blur-xl transition-[width] duration-200 lg:block " +
          (collapsed ? "w-[72px]" : "w-[248px]")
        }
        aria-label="Sidebar"
      >
        <AppSidebar
          view={view}
          groups={groups}
          modules={modules}
          signedIn={signedIn}
          isAdmin={isAdmin}
          username={username}
          hasCredentials={hasCredentials}
          accountCount={accountCount}
          collapsed={collapsed}
          variant="desktop"
          onNavigate={onViewChange}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onOpenSettings={onOpenSettings}
          onSignIn={onSignIn}
          onRegister={onRegister}
          onLogout={onLogout}
        />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={(event) => openDrawer(event.currentTarget)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          className="rounded-lg p-1.5 text-fg-muted transition hover:bg-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Menu className="h-5 w-5" />
        </button>
        <RouteLink
          view="home"
          onNavigate={onViewChange}
          className="flex min-w-0 items-center gap-2"
          aria-label={`${branding.name} home`}
          title={`${branding.name} home`}
        >
          <img
            src={logoUrl}
            srcSet={
              defaultLogo
                ? "/doochy-mark-40.png 1x, /doochy-mark-80.png 2x"
                : undefined
            }
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0"
            aria-hidden="true"
          />
          <span className="truncate text-[14px] font-bold tracking-tight text-fg">
            {branding.name}
          </span>
        </RouteLink>
      </header>

      <div
        className={
          "pb-[calc(5rem+env(safe-area-inset-bottom))] transition-[padding] duration-200 lg:pb-0 " +
          (collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]")
        }
      >
        <AnnouncementBanner announcement={config?.announcement ?? FALLBACK_ANNOUNCEMENT} />

        <main id="main-content" className="mx-auto max-w-page px-4 py-5 sm:px-6">
          {children}
        </main>

        <SiteFooter
          legal={legal}
          branding={branding}
          socialLinks={socialLinks}
          onNavigate={onViewChange}
        />
      </div>

      {drawerOpen && (
        <div className="lg:hidden">
          <div
            className="sidebar-scrim-in fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <aside
            id="mobile-navigation"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="sidebar-slide-in fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-hairline bg-canvas shadow-overlay"
          >
            <AppSidebar
              view={view}
              groups={groups}
              modules={modules}
              signedIn={signedIn}
              isAdmin={isAdmin}
              username={username}
              hasCredentials={hasCredentials}
              accountCount={accountCount}
              variant="mobile"
              onNavigate={onViewChange}
              onClose={closeDrawer}
              onOpenSettings={onOpenSettings}
              onSignIn={() => closeDrawerThen(onSignIn)}
              onRegister={() => closeDrawerThen(onRegister)}
              onLogout={onLogout}
            />
          </aside>
        </div>
      )}

      <BottomNav
        view={view}
        modules={modules}
        groups={groups}
        signedIn={signedIn}
        isAdmin={isAdmin}
        drawerOpen={drawerOpen}
        onNavigate={onViewChange}
        onSignIn={onSignIn}
        onOpenDrawer={(trigger) => openDrawer(trigger)}
      />
    </div>
  );
}

export default AppShell;

/** Read the saved rail width, defaulting to collapsed on smaller desktops. */
function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage can be blocked; fall through to the viewport default.
  }
  return window.innerWidth < 1280;
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg"
    >
      Skip to content
    </a>
  );
}

/**
 * Mobile quick bar: Home, the first configured destinations, and More. More
 * opens the full drawer, so every module stays one tap away even when the bar
 * only has room for three.
 */
function BottomNav({
  view,
  modules,
  groups,
  signedIn,
  isAdmin,
  drawerOpen,
  onNavigate,
  onSignIn,
  onOpenDrawer,
}: {
  view: ViewKey;
  modules: ModuleSettings[];
  groups: NavGroupSettings[];
  signedIn: boolean;
  isAdmin: boolean;
  drawerOpen: boolean;
  onNavigate: (view: ViewKey) => void;
  onSignIn: () => void;
  onOpenDrawer: (trigger: HTMLElement) => void;
}) {
  const quick = quickModules(modules, groups, { signedIn, isAdmin });

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-canvas/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        <BottomTab
          view="home"
          label="Home"
          icon={<Home className="h-[18px] w-[18px]" />}
          active={view === "home"}
          onNavigate={onNavigate}
        />
        {quick.map((module) => {
          if (isModuleLocked(module, signedIn)) {
            return (
              <button
                key={module.key}
                type="button"
                onClick={onSignIn}
                aria-label={`${module.label}, sign in required`}
                title={`Sign in to open ${module.label}`}
                className={bottomTabClass(false)}
              >
                <span className="relative">
                  {moduleIcon(module.key)}
                  <Lock
                    className="absolute -right-1.5 -top-1 h-2.5 w-2.5 text-fg-faint"
                    aria-hidden="true"
                  />
                </span>
                <span className="max-w-full truncate">{module.label}</span>
              </button>
            );
          }
          return (
            <BottomTab
              key={module.key}
              view={module.key}
              label={module.label}
              icon={moduleIcon(module.key)}
              active={view === module.key}
              onNavigate={onNavigate}
            />
          );
        })}
        <button
          type="button"
          onClick={(event) => onOpenDrawer(event.currentTarget)}
          aria-label="More navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          className={bottomTabClass(false)}
        >
          <MoreHorizontal className="h-[18px] w-[18px]" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}

function BottomTab({
  view,
  label,
  icon,
  active,
  onNavigate,
}: {
  view: ViewKey;
  label: string;
  icon: ReactNode;
  active: boolean;
  onNavigate: (view: ViewKey) => void;
}) {
  return (
    <RouteLink
      view={view}
      onNavigate={onNavigate}
      aria-current={active ? "page" : undefined}
      className={bottomTabClass(active)}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </RouteLink>
  );
}

function bottomTabClass(active: boolean): string {
  return (
    "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 " +
    (active ? "text-accent" : "text-fg-muted hover:text-fg")
  );
}

function SiteFooter({
  legal,
  branding,
  socialLinks,
  onNavigate,
}: {
  legal: LegalSettings;
  branding: BrandingSettings;
  socialLinks: [string, string][];
  onNavigate: (view: ViewKey) => void;
}) {
  return (
    <footer className="mx-auto max-w-page space-y-1.5 px-4 pb-6 pt-2 text-center text-[11px] leading-relaxed text-fg-faint sm:px-6">
      {legal.riskDisclaimer && <p className="mx-auto max-w-3xl">{legal.riskDisclaimer}</p>}
      {(branding.footerText || branding.supportEmail || branding.websiteUrl) && (
        <p>
          {branding.footerText}
          {branding.footerText && (branding.supportEmail || branding.websiteUrl) && (
            <span aria-hidden="true"> • </span>
          )}
          {branding.supportEmail && (
            <a href={`mailto:${branding.supportEmail}`} className="transition hover:text-accent">
              {branding.supportEmail}
            </a>
          )}
          {branding.supportEmail && branding.websiteUrl && (
            <span aria-hidden="true"> • </span>
          )}
          {branding.websiteUrl && (
            <a
              href={branding.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-accent"
            >
              Website
            </a>
          )}
        </p>
      )}
      <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <FooterLegalLink label="Legal" fallback="legal" onNavigate={onNavigate} />
        <FooterLegalLink label="Terms" url={legal.termsUrl} fallback="terms" onNavigate={onNavigate} />
        <FooterLegalLink
          label="Privacy"
          url={legal.privacyUrl}
          fallback="privacy"
          onNavigate={onNavigate}
        />
        <FooterLegalLink label="Risk disclosure" fallback="risk" onNavigate={onNavigate} />
        <FooterLegalLink label="Cookies" fallback="cookies" onNavigate={onNavigate} />
      </nav>
      {socialLinks.length > 0 && (
        <nav
          aria-label="Social links"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        >
          {socialLinks.map(([key, url]) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="capitalize transition hover:text-accent"
            >
              {key === "x" ? "X" : key}
            </a>
          ))}
        </nav>
      )}
      <p>
        © {new Date().getFullYear()} {branding.name}
        {branding.name ? " · All rights reserved." : ""}
      </p>
    </footer>
  );
}

function FooterLegalLink({
  label,
  url,
  fallback,
  onNavigate,
}: {
  label: string;
  /** Admin-configured URL; when it is an in-app path the view is reused. */
  url?: string;
  fallback: ViewKey;
  onNavigate: (view: ViewKey) => void;
}) {
  const className = "transition hover:text-accent";
  const view = url ? viewFromPath(url) : fallback;
  if (url && !view) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={className}>
        {label}
      </a>
    );
  }
  return (
    <RouteLink view={view ?? fallback} onNavigate={onNavigate} className={className}>
      {label}
    </RouteLink>
  );
}
