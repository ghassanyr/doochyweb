// Canonical public origin for this deployment.
//
// Admin settings are the source of truth. PUBLIC_BASE_URL remains a bootstrap
// fallback for existing installs, and the request origin is a last resort so a
// fresh admin panel can still show a useful callback before anything is saved.

import { getSiteSettings } from "./store";
import type { SiteSettings } from "./types";

/** Normalise an http(s) origin; returns null for missing or non-origin values. */
export function normalizePublicBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Resolve the canonical origin from settings, then env, then the request. */
export function publicBaseUrlFor(
  settings: SiteSettings,
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): string | null {
  return (
    normalizePublicBaseUrl(settings.site.publicBaseUrl) ??
    normalizePublicBaseUrl(env.PUBLIC_BASE_URL) ??
    normalizePublicBaseUrl(requestOrigin)
  );
}

export async function canonicalPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  requestOrigin: string | null = null
): Promise<string | null> {
  return publicBaseUrlFor(await getSiteSettings(), env, requestOrigin);
}
