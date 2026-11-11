// Top-level URL routing for the single-page app. Each view has a canonical
// path, while query strings still carry transient state such as a selected
// breakout note or signal.

export type ViewKey = "trading" | "analysis" | "signals" | "breakouts" | "learn" | "admin";

export const VIEW_KEYS: readonly ViewKey[] = [
  "trading",
  "analysis",
  "signals",
  "breakouts",
  "learn",
  "admin",
];

const VIEW_SET = new Set<string>(VIEW_KEYS);

export function isViewKey(value: string): value is ViewKey {
  return VIEW_SET.has(value);
}

export function pathForView(view: ViewKey): string {
  return `/${view}`;
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function viewFromPath(pathname: string): ViewKey | null {
  const path = normalizePath(pathname);
  if (path === "/") return null;
  const key = path.slice(1);
  return isViewKey(key) ? key : null;
}

function isLearnHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "learn.doochy.net" || host.startsWith("learn.");
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
 * Paths are authoritative. The old `?view=` links and `/?note=` shares are
 * redirected once, then live at their canonical paths.
 */
export function resolveRoute({ pathname, search, hostname }: RouteLocation): RouteMatch {
  const path = normalizePath(pathname);
  const params = new URLSearchParams(search);
  const legacyView = params.get("view");
  const pathView = viewFromPath(path);

  if (pathView) {
    const clean = new URLSearchParams(params);
    clean.delete("view");
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

  const clean = new URLSearchParams(params);
  clean.delete("view");
  return { view, redirectTo: withSearch(pathForView(view), clean) };
}
