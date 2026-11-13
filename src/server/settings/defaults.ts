// Default site presentation and access rules. The theme mirrors the tokens in
// src/webapp/src/index.css so a fresh deployment looks exactly like today's
// build, and every value can be overridden from the admin panel.

import type {
  AnnouncementSettings,
  BrandingSettings,
  LegalSettings,
  MaintenanceSettings,
  ModuleKey,
  ModuleSettings,
  NavigationSettings,
  RegistrationSettings,
  SiteAddressSettings,
  SiteSettings,
  ThemeSettings,
} from "./types";

export const DEFAULT_SITE: SiteAddressSettings = {
  publicBaseUrl: "",
};

export const DEFAULT_REGISTRATION: RegistrationSettings = {
  mode: "open",
  message: "",
  inviteCode: "",
  requireEmailVerification: false,
};

export const DEFAULT_LEGAL: LegalSettings = {
  termsUrl: "",
  privacyUrl: "",
  riskDisclaimer: "",
};

export const DEFAULT_BRANDING: BrandingSettings = {
  name: "Doochy",
  tagline: "Market analysis & trading",
  description:
    "Doochy brings multi timeframe analysis, curated trade ideas, automated breakout research, and a pattern trainer into one focused workspace.",
  logoUrl: "",
  supportEmail: "",
  websiteUrl: "",
  footerText: "",
};

export const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  accent: "#14b8a6",
  accentHover: "#16c7b3",
  accentDeep: "#107a70",
  accentFg: "#04231f",
  canvas: "#0a0e14",
  canvasSoft: "#0f1520",
  surface: "#141c28",
  surfaceHover: "#182231",
  surfaceActive: "#1b2635",
  borderStrong: "#233044",
  text: "#e7edf5",
  success: "#34d399",
  danger: "#f87171",
  strongSell: "#dc2626",
  strongBuy: "#16a34a",
  ratingNeutral: "#94a3b8",
};

/** Every module key, in the order the shell has always shown them. */
export const MODULE_KEYS: readonly ModuleKey[] = [
  "analysis",
  "signals",
  "breakouts",
  "learn",
  "trading",
];

/** Default tabs in the order the shell has always shown them. */
export const DEFAULT_MODULES: ModuleSettings[] = [
  { key: "analysis", label: "Analysis", hidden: false, access: "public" },
  { key: "signals", label: "Signals", hidden: false, access: "public" },
  { key: "breakouts", label: "Breakouts", hidden: false, access: "public" },
  { key: "learn", label: "Learn", hidden: false, access: "public" },
  { key: "trading", label: "Trading", hidden: false, access: "signed-in" },
];

export const DEFAULT_NAVIGATION: NavigationSettings = {
  modules: DEFAULT_MODULES.map((module) => ({ ...module })),
  landing: { signedIn: "home", signedOut: "home" },
};

export const DEFAULT_MAINTENANCE: MaintenanceSettings = {
  enabled: false,
  message: "We're making some improvements. Please check back soon.",
  allowAdmins: true,
};

export const DEFAULT_ANNOUNCEMENT: AnnouncementSettings = {
  enabled: false,
  text: "",
  tone: "info",
  linkLabel: "",
  linkUrl: "",
  dismissible: true,
  startsAt: null,
  endsAt: null,
};

/** The complete settings shape when no document exists yet. */
export function defaultSiteSettings(): SiteSettings {
  return {
    site: { ...DEFAULT_SITE },
    branding: { ...DEFAULT_BRANDING },
    theme: { ...DEFAULT_THEME },
    navigation: {
      modules: DEFAULT_MODULES.map((module) => ({ ...module })),
      landing: { ...DEFAULT_NAVIGATION.landing },
    },
    maintenance: { ...DEFAULT_MAINTENANCE },
    announcement: { ...DEFAULT_ANNOUNCEMENT },
    registration: { ...DEFAULT_REGISTRATION },
    legal: { ...DEFAULT_LEGAL },
    version: null,
    updatedAt: null,
    updatedBy: null,
  };
}
