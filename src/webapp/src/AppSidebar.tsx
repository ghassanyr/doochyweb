// Primary sidebar for the signed-in workspace and the public app pages.
//
// The top pill bar worked while there were four destinations. With nine, it
// became a scrolling row with no grouping and no mobile affordance. This
// sidebar keeps every destination one click away, groups the modules by intent,
// and collapses to an icon rail when the visitor needs more room.
//
// Desktop and the mobile drawer share the same body. The only differences are
// the close button, the collapse control, and whether navigation closes the
// drawer.

import { type ReactNode } from "react";
import {
  Bell,
  Briefcase,
  GraduationCap,
  Home,
  LineChart,
  Lock,
  LogIn,
  LogOut,
  Moon,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";

import type {
  BrandingSettings,
  DemoSettings,
  ModuleKey,
  ModuleSettings,
  NavGroupSettings,
} from "./api";
import { RouteLink } from "./components/RouteLink";
import { Button } from "./components/ui";
import { groupModules, isModuleLocked, type NavGroup } from "./navigation";
import { type ViewKey } from "./routing";
import { brandMarkUrl, isBundledBrand, useSiteConfig } from "./siteConfig";

const ICON_CLASS = "h-[18px] w-[18px]";

const MODULE_ICONS: Record<ModuleKey, ReactNode> = {
  analysis: <LineChart className={ICON_CLASS} />,
  signals: <Radio className={ICON_CLASS} />,
  breakouts: <Zap className={ICON_CLASS} />,
  trading: <Briefcase className={ICON_CLASS} />,
  alerts: <Bell className={ICON_CLASS} />,
  briefing: <Newspaper className={ICON_CLASS} />,
  coach: <Sparkles className={ICON_CLASS} />,
  learn: <GraduationCap className={ICON_CLASS} />,
};

export function moduleIcon(key: ModuleKey): ReactNode {
  return MODULE_ICONS[key];
}

const ADMIN_SUBNAV: { view: ViewKey; label: string }[] = [
  { view: "admin", label: "Overview" },
  { view: "admin-settings", label: "Site settings" },
  { view: "admin-integrations", label: "Integrations" },
];

const ANALYSIS_SUBNAV: { view: ViewKey; label: string }[] = [
  { view: "analysis", label: "Overview" },
  { view: "session-analysis", label: "Session analysis" },
  { view: "analysis-news", label: "News" },
];

export interface AppSidebarProps {
  view: ViewKey;
  groups: NavGroupSettings[];
  modules: ModuleSettings[];
  signedIn: boolean;
  isAdmin: boolean;
  username: string | null;
  hasCredentials: boolean | null;
  accountCount: number;
  collapsed?: boolean;
  variant?: "desktop" | "mobile";
  onNavigate: (view: ViewKey) => void;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  onOpenSettings: () => void;
  onSignIn: () => void;
  onRegister: () => void;
  onLogout: () => void;
  demo: DemoSettings;
  isDemo: boolean;
  onEnterDemo: () => void;
  onExitDemo: () => void;
}

export function AppSidebar({
  view,
  groups: navGroups,
  modules,
  signedIn,
  isAdmin,
  username,
  hasCredentials,
  accountCount,
  collapsed = false,
  variant = "desktop",
  onNavigate,
  onToggleCollapsed,
  onClose,
  onOpenSettings,
  onSignIn,
  onRegister,
  onLogout,
  demo,
  isDemo,
  onEnterDemo,
  onExitDemo,
}: AppSidebarProps) {
  const { branding, theme, mode, toggleMode } = useSiteConfig();
  const logoUrl = brandMarkUrl(branding, theme, 80);
  const defaultLogo = isBundledBrand(branding);
  const groups = groupModules(modules, navGroups, { signedIn, isAdmin });
  const adminActive =
    view === "admin" || view === "admin-settings" || view === "admin-integrations";
  const analysisActive =
    view === "analysis" ||
    view === "analysis-news" ||
    view === "session-analysis" ||
    view === "session-analysis-history";
  const analysisSubActive = (item: ViewKey) =>
    view === item ||
    (item === "session-analysis" && view === "session-analysis-history");

  function navigate(next: ViewKey) {
    onNavigate(next);
    onClose?.();
  }

  function signIn() {
    onSignIn();
    onClose?.();
  }

  function register() {
    onRegister();
    onClose?.();
  }

  function openSettings() {
    onOpenSettings();
    onClose?.();
  }

  function logout() {
    onLogout();
    onClose?.();
  }

  function enterDemo() {
    onEnterDemo();
    onClose?.();
  }

  function exitDemo() {
    onExitDemo();
    onClose?.();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarBrand
        branding={branding}
        logoUrl={logoUrl}
        defaultLogo={defaultLogo}
        collapsed={collapsed}
        variant={variant}
        onNavigate={navigate}
        onToggleCollapsed={onToggleCollapsed}
        onClose={onClose}
      />

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Primary">
        <div className="pt-2">
          <SidebarLink
            view="home"
            label="Home"
            icon={<Home className={ICON_CLASS} />}
            active={view === "home"}
            collapsed={collapsed}
            onNavigate={navigate}
          />
        </div>

        {groups.map((group) => (
          <div key={group.key} role="group" aria-label={group.label} className="mt-3">
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-hairline" aria-hidden="true" />
            ) : groupNeedsHeader(group) ? (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
                {group.label}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {group.modules.map((module) => (
                <div key={module.key}>
                  <SidebarLink
                    view={module.key}
                    label={module.label}
                    icon={MODULE_ICONS[module.key]}
                    active={module.key === "analysis" ? analysisActive : view === module.key}
                    locked={isModuleLocked(module, signedIn)}
                    collapsed={collapsed}
                    onNavigate={navigate}
                    onSignIn={signIn}
                  />
                  {module.key === "analysis" && analysisActive && !collapsed && (
                    <div className="ml-5 mt-1 space-y-0.5 border-l border-hairline pl-2">
                      {ANALYSIS_SUBNAV.map((item) => (
                        <RouteLink
                          key={item.view}
                          view={item.view}
                          onNavigate={navigate}
                          aria-current={analysisSubActive(item.view) ? "page" : undefined}
                          className={
                            "block rounded-md px-2 py-1.5 text-[12px] transition " +
                            (analysisSubActive(item.view)
                              ? "bg-soft font-medium text-accent"
                              : "text-fg-muted hover:bg-soft hover:text-fg")
                          }
                        >
                          {item.label}
                        </RouteLink>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div role="group" aria-label="Admin" className="mt-3">
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-hairline" aria-hidden="true" />
            ) : (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
                Admin
              </div>
            )}
            <SidebarLink
              view="admin"
              label="Admin"
              icon={<ShieldCheck className={ICON_CLASS} />}
              active={adminActive}
              collapsed={collapsed}
              onNavigate={navigate}
            />
            {adminActive && !collapsed && (
              <div className="ml-5 mt-1 space-y-0.5 border-l border-hairline pl-2">
                {ADMIN_SUBNAV.map((item) => (
                  <RouteLink
                    key={item.view}
                    view={item.view}
                    onNavigate={navigate}
                    aria-current={view === item.view ? "page" : undefined}
                    className={
                      "block rounded-md px-2 py-1.5 text-[12px] transition " +
                      (view === item.view
                        ? "bg-soft font-medium text-accent"
                        : "text-fg-muted hover:bg-soft hover:text-fg")
                    }
                  >
                    {item.label}
                  </RouteLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      <SidebarFooter
        signedIn={signedIn}
        username={username}
        hasCredentials={hasCredentials}
        accountCount={accountCount}
        collapsed={collapsed}
        mode={mode}
        onToggleMode={toggleMode}
        onNavigate={navigate}
        onOpenSettings={openSettings}
        onSignIn={signIn}
        onRegister={register}
        onLogout={logout}
        demo={demo}
        isDemo={isDemo}
        onEnterDemo={enterDemo}
        onExitDemo={exitDemo}
      />
    </div>
  );
}

function SidebarBrand({
  branding,
  logoUrl,
  defaultLogo,
  collapsed,
  variant,
  onNavigate,
  onToggleCollapsed,
  onClose,
}: {
  branding: BrandingSettings;
  logoUrl: string;
  defaultLogo: boolean;
  collapsed: boolean;
  variant: "desktop" | "mobile";
  onNavigate: (view: ViewKey) => void;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
}) {
  const mobile = variant === "mobile";
  return (
    <div
      className={
        "flex shrink-0 border-b border-hairline " +
        (collapsed
          ? "flex-col items-center gap-1 px-2 py-2"
          : "h-16 items-center gap-2 px-3")
      }
    >
      <RouteLink
        view="home"
        onNavigate={onNavigate}
        className="flex min-w-0 items-center gap-2.5"
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
          width={36}
          height={36}
          className="h-9 w-9 shrink-0"
          aria-hidden="true"
        />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-bold tracking-tight text-fg">
              {branding.name}
            </div>
            {branding.tagline && (
              <div className="truncate text-[10.5px] text-fg-faint">{branding.tagline}</div>
            )}
          </div>
        )}
      </RouteLink>

      {mobile ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="ml-auto rounded-lg p-1.5 text-fg-muted transition hover:bg-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <X className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={
            (collapsed ? "" : "ml-auto ") +
            "rounded-lg p-1.5 text-fg-muted transition hover:bg-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          }
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}

function SidebarLink({
  view,
  label,
  icon,
  active,
  locked = false,
  collapsed,
  onNavigate,
  onSignIn,
}: {
  view: ViewKey;
  label: string;
  icon: ReactNode;
  active: boolean;
  locked?: boolean;
  collapsed: boolean;
  onNavigate: (view: ViewKey) => void;
  onSignIn?: () => void;
}) {
  const className = itemClass(active, collapsed);
  const content = (
    <>
      {active && (
        <span
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
          aria-hidden="true"
        />
      )}
      <span
        className={
          "shrink-0 " + (active ? "text-accent" : "text-fg-faint group-hover:text-fg-muted")
        }
      >
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && locked && (
        <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-fg-faint" aria-hidden="true" />
      )}
      {collapsed && locked && (
        <span
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-fg-faint"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (locked && onSignIn) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        className={className}
        title={`Sign in to open ${label}`}
        aria-label={`${label}, sign in required`}
      >
        {content}
      </button>
    );
  }

  return (
    <RouteLink
      view={view}
      onNavigate={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={className}
    >
      {content}
    </RouteLink>
  );
}

/** A one-item group whose label repeats the item does not need a header. */
function groupNeedsHeader(group: NavGroup): boolean {
  return !(
    group.modules.length === 1 &&
    group.modules[0].label.trim().toLowerCase() === group.label.trim().toLowerCase()
  );
}

function itemClass(active: boolean, collapsed: boolean): string {
  return (
    "group relative flex w-full items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas " +
    (collapsed ? "justify-center px-0 " : "px-2.5 ") +
    (active
      ? "bg-accent-soft text-accent"
      : "text-fg-muted hover:bg-soft hover:text-fg")
  );
}

function SidebarFooter({
  signedIn,
  username,
  hasCredentials,
  accountCount,
  collapsed,
  mode,
  onToggleMode,
  onNavigate,
  onOpenSettings,
  onSignIn,
  onRegister,
  onLogout,
  demo,
  isDemo,
  onEnterDemo,
  onExitDemo,
}: {
  signedIn: boolean;
  username: string | null;
  hasCredentials: boolean | null;
  accountCount: number;
  collapsed: boolean;
  mode: "dark" | "light";
  onToggleMode: () => void;
  onNavigate: (view: ViewKey) => void;
  onOpenSettings: () => void;
  onSignIn: () => void;
  onRegister: () => void;
  onLogout: () => void;
  demo: DemoSettings;
  isDemo: boolean;
  onEnterDemo: () => void;
  onExitDemo: () => void;
}) {
  const nextMode = mode === "dark" ? "light" : "dark";
  const initials = (username ?? "?").slice(0, 2).toUpperCase();
  const connected = hasCredentials === true;
  const checking = hasCredentials === null;
  const statusText = isDemo
    ? "Read-only demo data"
    : checking
      ? "Checking connection"
      : connected
        ? `cTrader connected${accountCount > 0 ? `, ${accountCount} account${accountCount === 1 ? "" : "s"}` : ""}`
        : "cTrader not connected";

  return (
    <div className="shrink-0 border-t border-hairline p-2">
      {signedIn ? (
        <>
          <div
            className={
              collapsed
                ? "space-y-0.5"
                : "flex items-center justify-center gap-0.5 px-0.5 pb-1.5"
            }
          >
            <FooterAction
              icon={nextMode === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              label={nextMode === "light" ? "Light mode" : "Dark mode"}
              collapsed={collapsed}
              onClick={onToggleMode}
            />
            {isDemo ? (
              <FooterAction
                icon={<LogOut className="h-4 w-4" />}
                label="Exit demo"
                collapsed={collapsed}
                onClick={onExitDemo}
                tone="danger"
              />
            ) : (
              <>
                <FooterAction
                  icon={<Settings className="h-4 w-4" />}
                  label="Settings"
                  collapsed={collapsed}
                  onClick={onOpenSettings}
                />
                <FooterAction
                  icon={<LogOut className="h-4 w-4" />}
                  label="Sign out"
                  collapsed={collapsed}
                  onClick={onLogout}
                  tone="danger"
                />
              </>
            )}
          </div>

          <div
            className={
              collapsed
                ? "flex justify-center py-1"
                : "rounded-lg border border-hairline bg-soft px-2.5 py-2"
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
                aria-hidden="true"
                title={collapsed ? `${username ?? "Member"}, ${statusText}` : undefined}
              >
                {initials}
                <span
                  className={
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-canvas " +
                    (connected ? "bg-success" : "bg-fg-faint")
                  }
                />
              </span>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-fg">
                    {username ?? "Member"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-faint">
                    <span
                      className={
                        "h-1.5 w-1.5 shrink-0 rounded-full " +
                        (connected ? "bg-success" : "bg-fg-faint")
                      }
                      aria-hidden="true"
                    />
                    {connected || checking || isDemo ? (
                      <span className="truncate">{statusText}</span>
                    ) : (
                      <RouteLink
                        view="trading"
                        onNavigate={onNavigate}
                        className="truncate underline underline-offset-2 transition hover:text-accent"
                      >
                        Connect cTrader
                      </RouteLink>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-1">
          {demo.enabled && (
            <Button
              variant="secondary"
              size="sm"
              className={collapsed ? "w-full px-0" : "w-full"}
              icon={<Play className="h-4 w-4" />}
              onClick={onEnterDemo}
              title={demo.label}
            >
              {!collapsed && demo.label}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            className={collapsed ? "w-full px-0" : "w-full"}
            icon={<LogIn className="h-4 w-4" />}
            onClick={onSignIn}
            aria-label="Sign in"
            title="Sign in"
          >
            {!collapsed && "Sign in"}
          </Button>
          {!collapsed && (
            <Button variant="ghost" size="sm" className="w-full" onClick={onRegister}>
              Create account
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function FooterAction({
  icon,
  label,
  collapsed,
  onClick,
  tone = "normal",
}: {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onClick: () => void;
  tone?: "normal" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "flex items-center rounded-lg py-2 text-[12.5px] font-medium transition " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas " +
        (collapsed ? "w-full justify-center px-0 " : "justify-center px-2.5 ") +
        (tone === "danger"
          ? "text-fg-muted hover:bg-danger-soft hover:text-danger"
          : "text-fg-muted hover:bg-soft hover:text-fg")
      }
    >
      {icon}
    </button>
  );
}
