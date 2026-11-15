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
  font: ThemeFont;
  density: ThemeDensity;
  /** Corner radius in pixels, 0 to 24. */
  radius: number;
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
export type ModuleKey =
  | "analysis"
  | "signals"
  | "breakouts"
  | "learn"
  | "trading"
  | "alerts"
  | "briefing";

export type ModuleAccess = "public" | "signed-in" | "admin";

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

export type AnalyticsProvider = "none" | "plausible" | "umami" | "google";

export interface SeoSettings {
  /** Page title; empty falls back to the branding name. */
  title: string;
  description: string;
  /** Absolute canonical origin or page URL; empty uses the site address. */
  canonicalUrl: string;
  ogImageUrl: string;
  keywords: string;
  /** Ask search engines not to index the deployment. */
  noindex: boolean;
  analyticsProvider: AnalyticsProvider;
  /** Plausible/Umami script URL or Google tag URL. Empty uses provider default. */
  analyticsScriptUrl: string;
  /** Plausible domain, Umami website id or Google measurement id. */
  analyticsSiteId: string;
  /** Load analytics only after the visitor accepts the cookie notice. */
  analyticsRequireConsent: boolean;
}

export interface ContentSettings {
  heroTitle: string;
  heroBody: string;
  featuresTitle: string;
  featuresBody: string;
  loginIntro: string;
  registerIntro: string;
  emptyStates: {
    analysis: string;
    signals: string;
    breakouts: string;
    trading: string;
    alerts: string;
    briefing: string;
  };
}

export type DefaultOrderType = "MARKET" | "LIMIT";

export interface TradingDefaultsSettings {
  defaultOrderType: DefaultOrderType;
  /** Suggested account risk per trade, shown as a reference on the ticket. */
  defaultRiskPercent: number;
  /** Preselected signal expiry; 0 means no expiry. */
  signalExpiryHours: number;
}

export type DateFormat = "locale" | "iso" | "dmy" | "mdy";
export type NumberFormat = "locale" | "comma-dot" | "dot-comma";

export interface LocaleSettings {
  /** BCP 47 locale such as en-GB. Empty follows the browser. */
  locale: string;
  /** IANA zone such as Europe/London. Empty follows the browser. */
  timezone: string;
  /** ISO 4217 code used for display defaults. */
  currency: string;
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
}

export interface SocialSettings {
  x: string;
  telegram: string;
  discord: string;
  youtube: string;
  linkedin: string;
  github: string;
}

export interface PwaSettings {
  enabled: boolean;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  display: "standalone" | "browser";
}

export interface EmailTemplateSettings {
  subject: string;
  body: string;
}

export interface TemplateSettings {
  email: {
    passwordReset: EmailTemplateSettings;
    verifyEmail: EmailTemplateSettings;
    adminInvite: EmailTemplateSettings;
  };
  telegram: {
    signalPublished: string;
    alertTriggered: string;
    test: string;
  };
}

export interface WebhookSettings {
  enabled: boolean;
  url: string;
  /** HMAC signing secret. Never returned by the public config endpoint. */
  secret: string;
  signalPublished: boolean;
  alertTriggered: boolean;
}

export type ThemeFont = "inter" | "system" | "serif";
export type ThemeDensity = "compact" | "comfortable" | "spacious";

export interface SiteConfig {
  site: SiteAddressSettings;
  branding: BrandingSettings;
  theme: ThemeSettings;
  navigation: NavigationSettings;
  maintenance: MaintenanceSettings;
  announcement: AnnouncementSettings;
  registration: PublicRegistrationSettings;
  legal: LegalSettings;
  seo: SeoSettings;
  content: ContentSettings;
  tradingDefaults: TradingDefaultsSettings;
  locale: LocaleSettings;
  social: SocialSettings;
  pwa: PwaSettings;
  /** Timestamp of the last save, used by clients to spot stale caches. */
  version: string | null;
}

export interface SiteSettings extends Omit<SiteConfig, "registration"> {
  registration: RegistrationSettings;
  /** Admin-only copy overrides. */
  templates: TemplateSettings;
  /** Admin-only webhook configuration; the signing secret is private. */
  webhooks: WebhookSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}
