// Default site presentation and access rules. The theme mirrors the tokens in
// src/webapp/src/index.css so a fresh deployment looks exactly like today's
// build, and every value can be overridden from the admin panel.

import type {
  AnalysisSettings,
  AnnouncementSettings,
  BrandingSettings,
  LegalSettings,
  MaintenanceSettings,
  ContentSettings,
  LocaleSettings,
  ModuleKey,
  ModuleSettings,
  NavigationSettings,
  PwaSettings,
  RegistrationSettings,
  SeoSettings,
  SiteAddressSettings,
  SiteSettings,
  SocialSettings,
  TemplateSettings,
  ThemeSettings,
  TradingDefaultsSettings,
  WebhookSettings,
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
  font: "inter",
  density: "comfortable",
  radius: 10,
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

export const DEFAULT_SEO: SeoSettings = {
  title: "",
  description: "",
  canonicalUrl: "",
  ogImageUrl: "",
  keywords: "",
  noindex: false,
  analyticsProvider: "none",
  analyticsScriptUrl: "",
  analyticsSiteId: "",
  analyticsRequireConsent: true,
};

export const DEFAULT_CONTENT: ContentSettings = {
  heroTitle: "Read the market.\nTrack published setups.\nPractice the pattern.",
  heroBody: "",
  featuresTitle: "",
  featuresBody: "",
  loginIntro: "",
  registerIntro: "",
  emptyStates: {
    analysis: "Your watchlist is empty.",
    signals: "No signals yet. Published signals appear here.",
    breakouts: "No breakouts yet. The first check runs shortly after the server starts.",
    trading: "Connect a cTrader account to see balances, positions and orders here.",
    alerts: "No alerts yet. Create one to be notified when price reaches your level.",
    briefing: "No briefing has been generated yet.",
  },
};

export const DEFAULT_TRADING_DEFAULTS: TradingDefaultsSettings = {
  defaultOrderType: "MARKET",
  defaultRiskPercent: 1,
  signalExpiryHours: 0,
};

export const DEFAULT_LOCALE: LocaleSettings = {
  locale: "",
  timezone: "",
  currency: "USD",
  dateFormat: "locale",
  numberFormat: "locale",
};

export const DEFAULT_SOCIAL: SocialSettings = {
  x: "",
  telegram: "",
  discord: "",
  youtube: "",
  linkedin: "",
  github: "",
};

export const DEFAULT_PWA: PwaSettings = {
  enabled: true,
  shortName: "",
  themeColor: "#0a0e14",
  backgroundColor: "#0a0e14",
  display: "standalone",
};

export const DEFAULT_TEMPLATES: TemplateSettings = {
  email: {
    passwordReset: {
      subject: "Reset your {{brand}} password",
      body:
        "We received a request to reset your {{brand}} password.\n\n" +
        "Open this link to choose a new password:\n{{url}}\n\n" +
        "The link expires in {{expiresMinutes}} minutes. If you did not request it, ignore this email.",
    },
    verifyEmail: {
      subject: "Verify your email for {{brand}}",
      body:
        "Confirm your email address for {{brand}}.\n\n" +
        "Open this link:\n{{url}}\n\n" +
        "The link expires in {{expiresMinutes}} minutes.",
    },
    adminInvite: {
      subject: "You are invited to {{brand}}",
      body:
        "An administrator invited you to {{brand}} as {{username}}.\n\n" +
        "Open this link to set your password:\n{{url}}\n\n" +
        "The link expires in {{expiresMinutes}} minutes.",
    },
  },
  telegram: {
    signalPublished: "🔔 New signal · {{symbol}} {{direction}}\nEntry {{entry}} · TP {{target}} · Stop {{stop}}",
    alertTriggered: "⏰ Alert triggered · {{symbol}}\n{{condition}} {{level}}\nLast price {{price}}",
    test: "✅ {{brand}} test\nTelegram notifications are working.",
  },
};

export const DEFAULT_WEBHOOKS: WebhookSettings = {
  enabled: false,
  url: "",
  secret: "",
  signalPublished: true,
  alertTriggered: true,
};

/** Every module key, in the order the shell has always shown them. */
export const MODULE_KEYS: readonly ModuleKey[] = [
  "analysis",
  "signals",
  "breakouts",
  "learn",
  "trading",
  "alerts",
  "briefing",
];

/** Default tabs in the order the shell has always shown them. */
export const DEFAULT_MODULES: ModuleSettings[] = [
  { key: "analysis", label: "Analysis", hidden: false, access: "public" },
  { key: "signals", label: "Signals", hidden: false, access: "public" },
  { key: "breakouts", label: "Breakouts", hidden: false, access: "public" },
  { key: "learn", label: "Learn", hidden: false, access: "public" },
  { key: "trading", label: "Trading", hidden: false, access: "signed-in" },
  { key: "alerts", label: "Alerts", hidden: false, access: "signed-in" },
  { key: "briefing", label: "Briefing", hidden: false, access: "signed-in" },
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

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  watchlistLimit: 10,
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
    analysis: { ...DEFAULT_ANALYSIS },
    legal: { ...DEFAULT_LEGAL },
    seo: { ...DEFAULT_SEO },
    content: { ...DEFAULT_CONTENT, emptyStates: { ...DEFAULT_CONTENT.emptyStates } },
    tradingDefaults: { ...DEFAULT_TRADING_DEFAULTS },
    locale: { ...DEFAULT_LOCALE },
    social: { ...DEFAULT_SOCIAL },
    pwa: { ...DEFAULT_PWA },
    templates: {
      email: {
        passwordReset: { ...DEFAULT_TEMPLATES.email.passwordReset },
        verifyEmail: { ...DEFAULT_TEMPLATES.email.verifyEmail },
        adminInvite: { ...DEFAULT_TEMPLATES.email.adminInvite },
      },
      telegram: { ...DEFAULT_TEMPLATES.telegram },
    },
    webhooks: { ...DEFAULT_WEBHOOKS },
    version: null,
    updatedAt: null,
    updatedBy: null,
  };
}
