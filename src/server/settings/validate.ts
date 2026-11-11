// Validation for the admin settings editor.
//
// The API merges a partial patch over the current document, so every function
// accepts whatever the client sent plus the base value it should fall back to.
// Anything that reaches the database has been trimmed, length-checked and, for
// colours and URLs, format-checked.

import type { BrandingSettings, ThemeMode, ThemeSettings } from "./types";

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;
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
