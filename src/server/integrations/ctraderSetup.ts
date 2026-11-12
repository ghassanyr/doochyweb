// cTrader setup rules.
//
// These are deliberately pure: the admin wizard, the store's `ready` flag and
// the draft test endpoint all share them. The rules encode what cTrader
// actually requires rather than what a free-text form happens to accept:
//
//   - the callback URL must exactly match a URL registered on the app;
//   - production callbacks must be https;
//   - only the two routes this server mounts are valid;
//   - the callback must live on the same origin as the public base URL,
//     otherwise the browser is sent to a different deployment.
//
// A mismatch is an error (it cannot work), not a warning. Scope `accounts` is
// only a warning because the connection still works, but trading actions fail.

import type { IntegrationFieldState, IntegrationProvider } from "./types";

export const CTRADER_CALLBACK_PATHS = ["/callback", "/api/ctrader/oauth/callback"] as const;

export interface CallbackCandidates {
  /** Normalised origin, or null when the base URL is missing/invalid. */
  baseUrl: string | null;
  /** Recommended production callback. */
  primary: string | null;
  /** Alternate mounted callback route. */
  api: string | null;
}

export interface SetupIssues {
  errors: string[];
  warnings: string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseHttpUrl(value: unknown): URL | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Normalise the public base URL and build the two callback URLs we mount. */
export function callbackCandidates(publicBaseUrl: unknown): CallbackCandidates {
  const url = parseHttpUrl(publicBaseUrl);
  if (!url) return { baseUrl: null, primary: null, api: null };
  const origin = url.origin;
  return {
    baseUrl: origin,
    primary: `${origin}/callback`,
    api: `${origin}/api/ctrader/oauth/callback`,
  };
}

/**
 * Validate the cross-field parts of a cTrader configuration. Required-field
 * presence is handled by the registry/store; this only judges the combination.
 */
export function validateCtraderSetup(values: Record<string, unknown>): SetupIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  const baseRaw = text(values.publicBaseUrl);
  const redirectRaw = text(values.redirectUri);
  const scope = text(values.scope) || "trading";

  let base: URL | null = null;
  if (baseRaw) {
    base = parseHttpUrl(baseRaw);
    if (!base) {
      errors.push("Public base URL must be an http(s) URL.");
    } else if (base.pathname !== "/" || base.search || base.hash) {
      errors.push("Public base URL must be an origin only, for example https://example.com.");
    }
  }

  if (redirectRaw) {
    const redirect = parseHttpUrl(redirectRaw);
    if (!redirect) {
      errors.push("Callback URL must be an http(s) URL.");
    } else {
      if (redirect.search || redirect.hash) {
        errors.push("Callback URL cannot include a query string or fragment.");
      }
      if (!CTRADER_CALLBACK_PATHS.includes(redirect.pathname as (typeof CTRADER_CALLBACK_PATHS)[number])) {
        errors.push(`Callback URL path must be ${CTRADER_CALLBACK_PATHS.join(" or ")}.`);
      }

      const local = isLocalHostname(redirect.hostname);
      if (redirect.protocol !== "https:" && !local) {
        errors.push("Callback URL must use https outside localhost.");
      }

      if (base) {
        if (local) {
          if (!isLocalHostname(base.hostname) && base.protocol === "https:") {
            warnings.push(
              "This callback is for local development. The public deployment needs its own https callback."
            );
          }
        } else if (redirect.origin !== base.origin) {
          errors.push(`Callback URL must use the public base URL origin (${base.origin}).`);
        }
      }
    }
  }

  if (scope !== "trading" && scope !== "accounts") {
    errors.push("Scope must be trading or accounts.");
  } else if (scope === "accounts") {
    warnings.push("Scope accounts is view-only; positions and orders require trading.");
  }

  return { errors, warnings };
}

/** Validate already-resolved values (used by the draft test endpoint). */
export function providerIssuesFromValues(
  provider: IntegrationProvider,
  values: Record<string, unknown>
): SetupIssues {
  if (provider !== "ctrader") return { errors: [], warnings: [] };
  return validateCtraderSetup(values);
}

/** Validate the admin-facing field states without decrypting any secret. */
export function providerIssues(
  provider: IntegrationProvider,
  fields: IntegrationFieldState[]
): SetupIssues {
  if (provider !== "ctrader") return { errors: [], warnings: [] };
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind !== "secret" && field.value !== null) values[field.key] = field.value;
  }
  return validateCtraderSetup(values);
}
