// Validation for the admin settings editor.
//
// The API merges a partial patch over the current document, so every function
// accepts whatever the client sent plus the base value it should fall back to.
// Anything that reaches the database has been trimmed, length-checked and, for
// colours and URLs, format-checked.

import { DEFAULT_MODULES, MODULE_KEYS } from "./defaults";
import type {
  AnnouncementSettings,
  AnnouncementTone,
  BrandingSettings,
  LandingKey,
  LegalSettings,
  MaintenanceSettings,
  ModuleAccess,
  ModuleKey,
  ModuleSettings,
  NavigationSettings,
  RegistrationMode,
  RegistrationSettings,
  SiteAddressSettings,
  ThemeMode,
  ThemeSettings,
} from "./types";

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;
const HTTP_OR_PATH = /^(?:\/|https?:\/\/)\S+$/i;
// Uploaded logos are stored inline as data URLs; only image types the browser
// can safely render through <img> are accepted.
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/]+={0,2}$/i;

const BRANDING_LIMITS: Record<keyof BrandingSettings, number> = {
  name: 60,
  tagline: 120,
  description: 300,
  // 200 KB of image becomes roughly 273 KB of base64.
  logoUrl: 350_000,
  supportEmail: 200,
  websiteUrl: 300,
  footerText: 300,
};

const THEME_COLOR_KEYS = [
  "accent",
  "accentHover",
  "accentDeep",
  "accentFg",
  "canvas",
  "canvasSoft",
  "surface",
  "surfaceHover",
  "surfaceActive",
  "borderStrong",
  "text",
  "success",
  "danger",
  "strongSell",
  "strongBuy",
  "ratingNeutral",
] as const;

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  max: number
): string {
  if (!(key in source) || source[key] === undefined) return fallback;
  const raw = source[key];
  if (typeof raw !== "string") throw new SettingsValidationError(`${key} must be a string`);
  const value = raw.trim();
  if (value.length > max) {
    throw new SettingsValidationError(`${key} must be ${max} characters or fewer`);
  }
  return value;
}

export function normalizeBranding(patch: unknown, base: BrandingSettings): BrandingSettings {
  const source = plainObject(patch);

  const name = readString(source, "name", base.name, BRANDING_LIMITS.name);
  if (!name) throw new SettingsValidationError("name is required");

  const logoUrl = readString(source, "logoUrl", base.logoUrl, BRANDING_LIMITS.logoUrl);
  if (
    logoUrl &&
    !logoUrl.startsWith("/") &&
    !HTTP_URL.test(logoUrl) &&
    !IMAGE_DATA_URL.test(logoUrl)
  ) {
    throw new SettingsValidationError(
      "logoUrl must start with /, be an http(s) URL, or be an uploaded image"
    );
  }

  const supportEmail = readString(
    source,
    "supportEmail",
    base.supportEmail,
    BRANDING_LIMITS.supportEmail
  );
  if (supportEmail && !EMAIL.test(supportEmail)) {
    throw new SettingsValidationError("supportEmail must be a valid email address");
  }

  const websiteUrl = readString(source, "websiteUrl", base.websiteUrl, BRANDING_LIMITS.websiteUrl);
  if (websiteUrl && !HTTP_URL.test(websiteUrl)) {
    throw new SettingsValidationError("websiteUrl must be an http(s) URL");
  }

  return {
    name,
    tagline: readString(source, "tagline", base.tagline, BRANDING_LIMITS.tagline),
    description: readString(
      source,
      "description",
      base.description,
      BRANDING_LIMITS.description
    ),
    logoUrl,
    supportEmail,
    websiteUrl,
    footerText: readString(source, "footerText", base.footerText, BRANDING_LIMITS.footerText),
  };
}

export function normalizeTheme(patch: unknown, base: ThemeSettings): ThemeSettings {
  const source = plainObject(patch);
  const next: ThemeSettings = { ...base };

  if (source.mode !== undefined) {
    const mode = source.mode;
    if (mode !== "dark" && mode !== "light") {
      throw new SettingsValidationError("mode must be dark or light");
    }
    next.mode = mode as ThemeMode;
  }

  for (const key of THEME_COLOR_KEYS) {
    if (!(key in source) || source[key] === undefined) continue;
    const raw = source[key];
    if (typeof raw !== "string" || !HEX.test(raw.trim())) {
      throw new SettingsValidationError(`${key} must be a 6-digit hex colour`);
    }
    next[key] = raw.trim().toLowerCase();
  }

  return next;
}

export function normalizeSite(patch: unknown, base: SiteAddressSettings): SiteAddressSettings {
  const source = plainObject(patch);
  const raw = readString(source, "publicBaseUrl", base.publicBaseUrl, 300);
  if (!raw) return { publicBaseUrl: "" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SettingsValidationError("publicBaseUrl must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsValidationError("publicBaseUrl must be an http(s) URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new SettingsValidationError(
      "publicBaseUrl must be an origin only, for example https://example.com"
    );
  }
  return { publicBaseUrl: url.origin };
}

const REGISTRATION_MODES: readonly RegistrationMode[] = ["open", "approval", "invite", "closed"];

export function normalizeRegistration(
  patch: unknown,
  base: RegistrationSettings
): RegistrationSettings {
  const source = plainObject(patch);

  let mode = base.mode;
  if (source.mode !== undefined) {
    if (typeof source.mode !== "string" || !(REGISTRATION_MODES as readonly string[]).includes(source.mode)) {
      throw new SettingsValidationError("registration mode must be open, approval, invite or closed");
    }
    mode = source.mode as RegistrationMode;
  }

  const inviteCode = readString(source, "inviteCode", base.inviteCode, 64);
  if (mode === "invite" && inviteCode.length < 6) {
    throw new SettingsValidationError("invite code must be at least 6 characters when invite mode is on");
  }

  let requireEmailVerification = base.requireEmailVerification;
  if (source.requireEmailVerification !== undefined) {
    if (typeof source.requireEmailVerification !== "boolean") {
      throw new SettingsValidationError("requireEmailVerification must be true or false");
    }
    requireEmailVerification = source.requireEmailVerification;
  }

  return {
    mode,
    message: readString(source, "message", base.message, 500),
    inviteCode,
    requireEmailVerification,
  };
}

export function normalizeLegal(patch: unknown, base: LegalSettings): LegalSettings {
  const source = plainObject(patch);

  function link(key: "termsUrl" | "privacyUrl"): string {
    const value = readString(source, key, base[key], 500);
    if (value && !HTTP_OR_PATH.test(value)) {
      throw new SettingsValidationError(`${key} must start with / or be an http(s) URL`);
    }
    return value;
  }

  return {
    termsUrl: link("termsUrl"),
    privacyUrl: link("privacyUrl"),
    riskDisclaimer: readString(source, "riskDisclaimer", base.riskDisclaimer, 3000),
  };
}

// ---------------------------------------------------------------------------
// Navigation, maintenance and announcement
// ---------------------------------------------------------------------------

const LANDING_KEYS: readonly LandingKey[] = ["home", "analysis", "signals"];
const ANNOUNCEMENT_TONES: readonly AnnouncementTone[] = ["info", "success", "warning", "danger"];

function readBoolean(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  if (!(key in source) || source[key] === undefined) return fallback;
  if (typeof source[key] !== "boolean") {
    throw new SettingsValidationError(`${key} must be true or false`);
  }
  return source[key] as boolean;
}

function readLanding(
  source: Record<string, unknown>,
  key: string,
  fallback: LandingKey
): LandingKey {
  if (!(key in source) || source[key] === undefined) return fallback;
  const raw = source[key];
  if (typeof raw === "string" && (LANDING_KEYS as readonly string[]).includes(raw)) {
    return raw as LandingKey;
  }
  throw new SettingsValidationError("landing page must be home, analysis or signals");
}

function readTone(
  source: Record<string, unknown>,
  key: string,
  fallback: AnnouncementTone
): AnnouncementTone {
  if (!(key in source) || source[key] === undefined) return fallback;
  const raw = source[key];
  if (typeof raw === "string" && (ANNOUNCEMENT_TONES as readonly string[]).includes(raw)) {
    return raw as AnnouncementTone;
  }
  throw new SettingsValidationError("tone must be info, success, warning or danger");
}

/** Null clears the bound; a date string is normalised to ISO. */
function readDate(
  source: Record<string, unknown>,
  key: string,
  fallback: string | null
): string | null {
  if (!(key in source) || source[key] === undefined) return fallback;
  const raw = source[key];
  if (raw === null || raw === "") return null;
  const date = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new SettingsValidationError(`${key} must be a valid date or null`);
  }
  return date.toISOString();
}

function defaultModule(key: ModuleKey): ModuleSettings {
  return DEFAULT_MODULES.find((module) => module.key === key) ?? DEFAULT_MODULES[0];
}

/**
 * Normalise the ordered module list. The client always sends the full list;
 * any module it omits is appended in the default order so a partial patch can
 * never make a tab disappear from the shell entirely.
 */
export function normalizeModules(patch: unknown, base: ModuleSettings[]): ModuleSettings[] {
  if (patch === undefined) return base.map((module) => ({ ...module }));
  if (!Array.isArray(patch)) {
    throw new SettingsValidationError("modules must be an array");
  }

  const seen = new Set<ModuleKey>();
  const next: ModuleSettings[] = [];

  for (const entry of patch) {
    const source = plainObject(entry);
    const key = source.key;
    if (typeof key !== "string" || !(MODULE_KEYS as readonly string[]).includes(key)) {
      throw new SettingsValidationError("modules must use a known module key");
    }
    const moduleKey = key as ModuleKey;
    if (seen.has(moduleKey)) {
      throw new SettingsValidationError(`duplicate module: ${moduleKey}`);
    }
    seen.add(moduleKey);

    const current = base.find((module) => module.key === moduleKey) ?? defaultModule(moduleKey);
    const label = readString(source, "label", current.label, 32);
    if (!label) throw new SettingsValidationError("module labels cannot be empty");

    let access: ModuleAccess = current.access;
    if (source.access !== undefined) {
      if (source.access !== "public" && source.access !== "signed-in") {
        throw new SettingsValidationError("module access must be public or signed-in");
      }
      access = source.access;
    }
    // Trading always needs a session; the trading API is auth-only.
    if (moduleKey === "trading") access = "signed-in";

    next.push({
      key: moduleKey,
      label,
      hidden: readBoolean(source, "hidden", current.hidden),
      access,
    });
  }

  for (const fallback of DEFAULT_MODULES) {
    if (seen.has(fallback.key)) continue;
    const current = base.find((module) => module.key === fallback.key) ?? fallback;
    next.push({ ...current, access: fallback.key === "trading" ? "signed-in" : current.access });
  }

  return next;
}

export function normalizeNavigation(
  patch: unknown,
  base: NavigationSettings
): NavigationSettings {
  const source = plainObject(patch);
  const landingSource = plainObject(source.landing);

  return {
    modules: normalizeModules(source.modules, base.modules),
    landing: {
      signedIn: readLanding(landingSource, "signedIn", base.landing.signedIn),
      signedOut: readLanding(landingSource, "signedOut", base.landing.signedOut),
    },
  };
}

export function normalizeMaintenance(
  patch: unknown,
  base: MaintenanceSettings
): MaintenanceSettings {
  const source = plainObject(patch);
  return {
    enabled: readBoolean(source, "enabled", base.enabled),
    message: readString(source, "message", base.message, 500),
    allowAdmins: readBoolean(source, "allowAdmins", base.allowAdmins),
  };
}

export function normalizeAnnouncement(
  patch: unknown,
  base: AnnouncementSettings
): AnnouncementSettings {
  const source = plainObject(patch);

  const text = readString(source, "text", base.text, 300);
  const enabled = readBoolean(source, "enabled", base.enabled);
  if (enabled && !text) {
    throw new SettingsValidationError("announcement text is required when enabled");
  }

  const linkUrl = readString(source, "linkUrl", base.linkUrl, 500);
  if (linkUrl && !linkUrl.startsWith("/") && !HTTP_URL.test(linkUrl)) {
    throw new SettingsValidationError("linkUrl must start with / or be an http(s) URL");
  }

  const startsAt = readDate(source, "startsAt", base.startsAt);
  const endsAt = readDate(source, "endsAt", base.endsAt);
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new SettingsValidationError("endsAt must be after startsAt");
  }

  return {
    enabled,
    text,
    tone: readTone(source, "tone", base.tone),
    linkLabel: readString(source, "linkLabel", base.linkLabel, 40),
    linkUrl,
    dismissible: readBoolean(source, "dismissible", base.dismissible),
    startsAt,
    endsAt,
  };
}
