// Persistence for the single site-wide settings document.
//
// Feature-local like the other stores, so db.ts stays the account layer. The
// document is a singleton keyed by `key: "site"`; getSiteSettings always merges
// over the compiled defaults, which means new fields appear automatically on
// existing deployments and a missing document behaves like an untouched one.

import mongoose from "mongoose";

import { DEFAULT_BRANDING, DEFAULT_THEME } from "./defaults";
import type { SiteConfig, SiteSettings } from "./types";
import { normalizeBranding, normalizeTheme } from "./validate";

const brandingSchema = new mongoose.Schema(
  {
    name: { type: String, default: DEFAULT_BRANDING.name },
    tagline: { type: String, default: DEFAULT_BRANDING.tagline },
    description: { type: String, default: DEFAULT_BRANDING.description },
    logoUrl: { type: String, default: DEFAULT_BRANDING.logoUrl },
    supportEmail: { type: String, default: DEFAULT_BRANDING.supportEmail },
    websiteUrl: { type: String, default: DEFAULT_BRANDING.websiteUrl },
    footerText: { type: String, default: DEFAULT_BRANDING.footerText },
  },
  { _id: false }
);

const themeSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["dark", "light"], default: DEFAULT_THEME.mode },
    accent: { type: String, default: DEFAULT_THEME.accent },
    accentHover: { type: String, default: DEFAULT_THEME.accentHover },
    accentDeep: { type: String, default: DEFAULT_THEME.accentDeep },
    accentFg: { type: String, default: DEFAULT_THEME.accentFg },
    canvas: { type: String, default: DEFAULT_THEME.canvas },
    canvasSoft: { type: String, default: DEFAULT_THEME.canvasSoft },
    surface: { type: String, default: DEFAULT_THEME.surface },
    surfaceHover: { type: String, default: DEFAULT_THEME.surfaceHover },
    surfaceActive: { type: String, default: DEFAULT_THEME.surfaceActive },
    borderStrong: { type: String, default: DEFAULT_THEME.borderStrong },
    text: { type: String, default: DEFAULT_THEME.text },
    success: { type: String, default: DEFAULT_THEME.success },
    danger: { type: String, default: DEFAULT_THEME.danger },
    strongSell: { type: String, default: DEFAULT_THEME.strongSell },
    strongBuy: { type: String, default: DEFAULT_THEME.strongBuy },
    ratingNeutral: { type: String, default: DEFAULT_THEME.ratingNeutral },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "site" },
    branding: { type: brandingSchema, default: () => ({ ...DEFAULT_BRANDING }) },
    theme: { type: themeSchema, default: () => ({ ...DEFAULT_THEME }) },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

export const SiteSettingsModel = mongoose.model("SiteSettings", siteSettingsSchema);

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Merge a stored document over the defaults. Exported for the test suite. */
export function mergeSiteSettings(doc: any): SiteSettings {
  const updatedAt = iso(doc?.updatedAt);
  return {
    branding: { ...DEFAULT_BRANDING, ...(doc?.branding ?? {}) },
    theme: { ...DEFAULT_THEME, ...(doc?.theme ?? {}) },
    version: updatedAt,
    updatedAt,
    updatedBy: typeof doc?.updatedBy === "string" ? doc.updatedBy : null,
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const doc = await SiteSettingsModel.findOne({ key: "site" }).lean().exec();
  return mergeSiteSettings(doc);
}

/**
 * Validate a partial patch, merge it over the stored document and upsert the
 * singleton. `updatedBy` is the admin username, kept for future audit tooling.
 */
export async function saveSiteSettings(
  patch: { branding?: unknown; theme?: unknown },
  updatedBy: string
): Promise<SiteSettings> {
  const current = await getSiteSettings();
  const branding = normalizeBranding(patch.branding, current.branding);
  const theme = normalizeTheme(patch.theme, current.theme);

  const doc = await SiteSettingsModel.findOneAndUpdate(
    { key: "site" },
    { $set: { branding, theme, updatedBy } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .lean()
    .exec();

  return mergeSiteSettings(doc);
}

/** The subset safe to expose without a session. */
export function publicSiteConfig(settings: SiteSettings): SiteConfig {
  return {
    branding: settings.branding,
    theme: settings.theme,
    version: settings.version,
  };
}
