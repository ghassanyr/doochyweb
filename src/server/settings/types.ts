// Shape of the single site-wide settings document.
//
// These values are shared by the public /api/config endpoint and the admin
// editor. Secrets and integration credentials do not belong here; this document
// is only the presentation and access layer every visitor sees.

export type ThemeMode = "dark" | "light";

export interface BrandingSettings {
  /** Product name shown in the header, page title and meta description. */
  name: string;
  /** Short line under the name in the header. */
  tagline: string;
  /** Hero paragraph and meta description. */
  description: string;
  /** Absolute path, http(s) URL or uploaded image data URL. Empty keeps the mark. */
  logoUrl: string;
  /** Optional support contact, shown in the footer. */
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

/** Tabs whose label, order, visibility and access can be configured. */
export type ModuleKey = "analysis" | "signals" | "breakouts" | "learn" | "trading";

export type ModuleAccess = "public" | "signed-in";

export interface ModuleSettings {
  key: ModuleKey;
  label: string;
  /** Hidden tabs stay reachable by URL but disappear from the header. */
  hidden: boolean;
  access: ModuleAccess;
}

export type LandingKey = "home" | "analysis" | "signals";

export interface NavigationSettings {
  /** Ordered tabs. Missing modules are appended from the defaults on read. */
  modules: ModuleSettings[];
  landing: {
    signedIn: LandingKey;
    signedOut: LandingKey;
  };
}

export interface SiteAddressSettings {
  /** Canonical public origin, for example https://example.com. Empty derives
   *  from PUBLIC_BASE_URL or the request origin. */
  publicBaseUrl: string;
}

export type RegistrationMode = "open" | "approval" | "invite" | "closed";

export interface RegistrationSettings {
  mode: RegistrationMode;
  /** Shown on the register form and when self-registration is unavailable. */
  message: string;
  /** Shared code required in invite mode. Never exposed by /api/config. */
  inviteCode: string;
  /** New self-registered accounts must confirm their email before signing in. */
  requireEmailVerification: boolean;
}

/** Safe registration subset returned to anonymous visitors. */
export interface PublicRegistrationSettings {
  mode: RegistrationMode;
  message: string;
  inviteRequired: boolean;
  requireEmailVerification: boolean;
}

export interface LegalSettings {
  /** Absolute http(s) URL or an in-app path. Empty hides the link. */
  termsUrl: string;
  /** Absolute http(s) URL or an in-app path. Empty hides the link. */
  privacyUrl: string;
  /** Risk warning shown in the footer and on the public home page. */
  riskDisclaimer: string;
}

export interface MaintenanceSettings {
  enabled: boolean;
  /** Shown to visitors while maintenance is on. */
  message: string;
  /** Signed-in admins bypass maintenance when this is true. */
  allowAdmins: boolean;
}

export type AnnouncementTone = "info" | "success" | "warning" | "danger";

export interface AnnouncementSettings {
  enabled: boolean;
  text: string;
  tone: AnnouncementTone;
  /** Optional call to action. The label is only shown when a URL is set. */
  linkLabel: string;
  linkUrl: string;
  dismissible: boolean;
  /** ISO timestamps; null means no bound. */
  startsAt: string | null;
  endsAt: string | null;
}

export interface SiteConfig {
  site: SiteAddressSettings;
  branding: BrandingSettings;
  theme: ThemeSettings;
  navigation: NavigationSettings;
  maintenance: MaintenanceSettings;
  announcement: AnnouncementSettings;
  registration: PublicRegistrationSettings;
  legal: LegalSettings;
  /** Timestamp of the last save, used by clients to spot stale caches. */
  version: string | null;
}

export interface SiteSettings extends Omit<SiteConfig, "registration"> {
  registration: RegistrationSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}
