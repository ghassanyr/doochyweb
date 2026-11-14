// Canonical browser URLs.
//
// The admin-edited site address wins when set, so copied links keep the public
// domain even when an admin is browsing a preview or a different hostname.
// Without an override the current origin is the only useful fallback.

export interface PublicSiteConfig {
  site?: { publicBaseUrl?: string } | null;
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function siteOrigin(
  config: PublicSiteConfig | null | undefined,
  fallbackOrigin = typeof window === "undefined" ? "" : window.location.origin
): string {
  return normalizeOrigin(config?.site?.publicBaseUrl) ?? fallbackOrigin;
}

/** Absolute canonical URL for a path plus optional query parameters. */
export function siteUrlFor(
  config: PublicSiteConfig | null | undefined,
  path: string,
  params: Record<string, string | null | undefined> = {},
  fallbackOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin
): string {
  const origin = siteOrigin(config, fallbackOrigin);
  const url = new URL(path, origin || "http://localhost");
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.toString();
}
