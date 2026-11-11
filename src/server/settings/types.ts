// Shape of the single site-wide settings document.
//
// These values are shared by the public /api/config endpoint and the admin
// editor. Secrets and integration credentials do not belong here; this document
// is only the presentation layer every visitor sees.

export type ThemeMode = "dark" | "light";

export interface BrandingSettings {
  /** Product name shown in the header, page title and meta description. */
  name: string;
  /** Short line under the name in the header. */
  tagline: string;
  /** Hero paragraph and meta description. */
  description: string;
  /** Absolute path or http(s) URL. Empty keeps the bundled mark. */
  logoUrl: string;
  /** Optional support contact, shown by future surfaces. */
  supportEmail: string;
  /** Optional public website, shown by future surfaces. */
  websiteUrl: string;
  /** Optional footer line rendered under every page. */
  footerText: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  accent: string;
  accentHover: string;
  accentDeep: string;
  accentFg: string;
  canvas: string;
  canvasSoft: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  /** Strong borders on controls, badges and modals. */
  borderStrong: string;
  text: string;
  success: string;
  danger: string;
  strongSell: string;
  strongBuy: string;
  ratingNeutral: string;
}

export interface SiteConfig {
  branding: BrandingSettings;
  theme: ThemeSettings;
  /** Timestamp of the last save, used by clients to spot stale caches. */
  version: string | null;
}

export interface SiteSettings extends SiteConfig {
  updatedAt: string | null;
  updatedBy: string | null;
}
