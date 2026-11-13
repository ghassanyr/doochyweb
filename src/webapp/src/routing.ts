// Top-level URL routing for the single-page app. Each view has a canonical
// path, while query strings still carry transient state such as a selected
// breakout note or signal.

// "settings" is a signed-in takeover rather than a nav tab, but it still owns a
// canonical path so the bot and support messages can link straight to it.
export type ViewKey =
  | "home"
  | "trading"
  | "analysis"
  | "signals"
  | "breakouts"
  | "learn"
  | "admin"
  | "admin-settings"
  | "admin-integrations"
  | "settings"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "accept-invite";

export const VIEW_KEYS: readonly ViewKey[] = [
  "home",
  "trading",
  "analysis",
  "signals",
  "breakouts",
  "learn",
  "admin",
  "admin-settings",
  "admin-integrations",
  "settings",
  "forgot-password",
  "reset-password",
  "verify-email",
  "accept-invite",
];

const VIEW_SET = new Set<string>(VIEW_KEYS);

export function isViewKey(value: string): value is ViewKey {
  return VIEW_SET.has(value);
}

export function pathForView(view: ViewKey): string {
  if (view === "home") return "/";
  if (view === "admin-settings") return "/admin/settings";
  if (view === "admin-integrations") return "/admin/integrations";
  return `/${view}`;
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function viewFromPath(pathname: string): ViewKey | null {
  const path = normalizePath(pathname);
  if (path === "/") return "home";
  if (path === "/admin/settings") return "admin-settings";
  if (path === "/admin/integrations") return "admin-integrations";
  const key = path.slice(1);
  return isViewKey(key) ? key : null;
}

function isLearnHost(hostname: string): boolean {
  return hostname.toLowerCase().startsWith("learn.");
}

function withSearch(path: string, params: URLSearchParams): string {
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export interface RouteLocation {
  pathname: string;
  search: string;
  hostname: string;
}

export interface RouteMatch {
  view: ViewKey;
  /** Canonical URL to replace into history, or null when the URL is already clean. */
  redirectTo: string | null;
}

/**
 * Resolve a URL to a view and its canonical path.
 *
 * The root is Home. Paths are authoritative. The old `?view=` links and
 * `/?note=` shares are redirected once, then live at their canonical paths.
 */
export function resolveRoute({ pathname, search, hostname }: RouteLocation): RouteMatch {
  const path = normalizePath(pathname);
  const params = new URLSearchParams(search);
  const legacyView = params.get("view");
  const clean = new URLSearchParams(params);
  clean.delete("view");

  // The root is the public home page. Legacy query links still redirect once,
  // with the old View param taking precedence over note/learn-host fallbacks.
  if (path === "/") {
    if (legacyView && isViewKey(legacyView) && legacyView !== "home") {
      return {
        view: legacyView,
        redirectTo: withSearch(pathForView(legacyView), clean),
      };
    }
    if (params.has("note")) {
      return { view: "breakouts", redirectTo: withSearch("/breakouts", clean) };
    }
    if (isLearnHost(hostname)) {
      return { view: "learn", redirectTo: withSearch("/learn", clean) };
    }
    return { view: "home", redirectTo: params.has("view") ? withSearch("/", clean) : null };
  }

  const pathView = viewFromPath(path);
  if (pathView) {
    const canonical = pathForView(pathView);
    return {
      view: pathView,
      redirectTo: canonical !== pathname || params.has("view") ? withSearch(canonical, clean) : null,
    };
  }

  const view: ViewKey =
    legacyView && isViewKey(legacyView)
      ? legacyView
      : params.has("note")
        ? "breakouts"
        : isLearnHost(hostname)
          ? "learn"
          : "analysis";

  return { view, redirectTo: withSearch(pathForView(view), clean) };
}
