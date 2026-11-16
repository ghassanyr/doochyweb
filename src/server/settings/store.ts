// Persistence for the single site-wide settings document.
//
// Feature-local like the other stores, so db.ts stays the account layer. The
// document is a singleton keyed by `key: "site"`; getSiteSettings always merges
// over the compiled defaults, which means new fields appear automatically on
// existing deployments and a missing document behaves like an untouched one.

import mongoose from "mongoose";

import {
  DEFAULT_ANALYSIS,
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_BRANDING,
  DEFAULT_CONTENT,
  DEFAULT_LEGAL,
  DEFAULT_LOCALE,
  DEFAULT_MAINTENANCE,
  DEFAULT_MODULES,
  DEFAULT_NAVIGATION,
  DEFAULT_PWA,
  DEFAULT_REGISTRATION,
  DEFAULT_SEO,
  DEFAULT_SITE,
  DEFAULT_SOCIAL,
  DEFAULT_TEMPLATES,
  DEFAULT_THEME,
  DEFAULT_TRADING_DEFAULTS,
  DEFAULT_WEBHOOKS,
  MODULE_KEYS,
} from "./defaults";
import type {
  AnalysisSettings,
  AnnouncementSettings,
  AnnouncementTone,
  ContentSettings,
  LandingKey,
  LegalSettings,
  LocaleSettings,
  MaintenanceSettings,
  ModuleKey,
  ModuleSettings,
  NavigationSettings,
  PwaSettings,
  RegistrationMode,
  RegistrationSettings,
  SeoSettings,
  SiteAddressSettings,
  SiteConfig,
  SiteSettings,
  SocialSettings,
  TemplateSettings,
  TradingDefaultsSettings,
  WebhookSettings,
} from "./types";
import {
  normalizeAnalysis,
  normalizeAnnouncement,
  normalizeBranding,
  normalizeLegal,
  normalizeMaintenance,
  normalizeNavigation,
  normalizeContent,
  normalizeLocale,
  normalizePwa,
  normalizeRegistration,
  normalizeSeo,
  normalizeSite,
  normalizeSocial,
  normalizeTemplates,
  normalizeTheme,
  normalizeTradingDefaults,
  normalizeWebhooks,
} from "./validate";

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
    font: { type: String, enum: ["inter", "system", "serif"], default: DEFAULT_THEME.font },
    density: {
      type: String,
      enum: ["compact", "comfortable", "spacious"],
      default: DEFAULT_THEME.density,
    },
    radius: { type: Number, default: DEFAULT_THEME.radius },
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

const siteSchema = new mongoose.Schema(
  {
    publicBaseUrl: { type: String, default: DEFAULT_SITE.publicBaseUrl },
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["open", "approval", "invite", "closed"],
      default: DEFAULT_REGISTRATION.mode,
    },
    message: { type: String, default: DEFAULT_REGISTRATION.message },
    inviteCode: { type: String, default: DEFAULT_REGISTRATION.inviteCode },
    requireEmailVerification: {
      type: Boolean,
      default: DEFAULT_REGISTRATION.requireEmailVerification,
    },
  },
  { _id: false }
);

const legalSchema = new mongoose.Schema(
  {
    termsUrl: { type: String, default: DEFAULT_LEGAL.termsUrl },
    privacyUrl: { type: String, default: DEFAULT_LEGAL.privacyUrl },
    riskDisclaimer: { type: String, default: DEFAULT_LEGAL.riskDisclaimer },
  },
  { _id: false }
);

const moduleSchema = new mongoose.Schema(
  {
    key: { type: String, enum: MODULE_KEYS, required: true },
    label: { type: String, required: true },
    hidden: { type: Boolean, default: false },
    access: { type: String, enum: ["public", "signed-in", "admin"], default: "public" },
  },
  { _id: false }
);

const landingSchema = new mongoose.Schema(
  {
    signedIn: {
      type: String,
      enum: ["home", "analysis", "signals"],
      default: DEFAULT_NAVIGATION.landing.signedIn,
    },
    signedOut: {
      type: String,
      enum: ["home", "analysis", "signals"],
      default: DEFAULT_NAVIGATION.landing.signedOut,
    },
  },
  { _id: false }
);

const navigationSchema = new mongoose.Schema(
  {
    modules: {
      type: [moduleSchema],
      default: () => DEFAULT_MODULES.map((module) => ({ ...module })),
    },
    landing: { type: landingSchema, default: () => ({ ...DEFAULT_NAVIGATION.landing }) },
  },
  { _id: false }
);

const maintenanceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULT_MAINTENANCE.enabled },
    message: { type: String, default: DEFAULT_MAINTENANCE.message },
    allowAdmins: { type: Boolean, default: DEFAULT_MAINTENANCE.allowAdmins },
  },
  { _id: false }
);

const announcementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULT_ANNOUNCEMENT.enabled },
    text: { type: String, default: DEFAULT_ANNOUNCEMENT.text },
    tone: {
      type: String,
      enum: ["info", "success", "warning", "danger"],
      default: DEFAULT_ANNOUNCEMENT.tone,
    },
    linkLabel: { type: String, default: DEFAULT_ANNOUNCEMENT.linkLabel },
    linkUrl: { type: String, default: DEFAULT_ANNOUNCEMENT.linkUrl },
    dismissible: { type: Boolean, default: DEFAULT_ANNOUNCEMENT.dismissible },
    startsAt: { type: String, default: null },
    endsAt: { type: String, default: null },
  },
  { _id: false }
);

const seoSchema = new mongoose.Schema(
  {
    title: { type: String, default: DEFAULT_SEO.title },
    description: { type: String, default: DEFAULT_SEO.description },
    canonicalUrl: { type: String, default: DEFAULT_SEO.canonicalUrl },
    ogImageUrl: { type: String, default: DEFAULT_SEO.ogImageUrl },
    keywords: { type: String, default: DEFAULT_SEO.keywords },
    noindex: { type: Boolean, default: DEFAULT_SEO.noindex },
    analyticsProvider: {
      type: String,
      enum: ["none", "plausible", "umami", "google"],
      default: DEFAULT_SEO.analyticsProvider,
    },
    analyticsScriptUrl: { type: String, default: DEFAULT_SEO.analyticsScriptUrl },
    analyticsSiteId: { type: String, default: DEFAULT_SEO.analyticsSiteId },
    analyticsRequireConsent: {
      type: Boolean,
      default: DEFAULT_SEO.analyticsRequireConsent,
    },
  },
  { _id: false }
);

const contentSchema = new mongoose.Schema(
  {
    heroTitle: { type: String, default: DEFAULT_CONTENT.heroTitle },
    heroBody: { type: String, default: DEFAULT_CONTENT.heroBody },
    featuresTitle: { type: String, default: DEFAULT_CONTENT.featuresTitle },
    featuresBody: { type: String, default: DEFAULT_CONTENT.featuresBody },
    loginIntro: { type: String, default: DEFAULT_CONTENT.loginIntro },
    registerIntro: { type: String, default: DEFAULT_CONTENT.registerIntro },
    emptyStates: {
      analysis: { type: String, default: DEFAULT_CONTENT.emptyStates.analysis },
      signals: { type: String, default: DEFAULT_CONTENT.emptyStates.signals },
      breakouts: { type: String, default: DEFAULT_CONTENT.emptyStates.breakouts },
      trading: { type: String, default: DEFAULT_CONTENT.emptyStates.trading },
      alerts: { type: String, default: DEFAULT_CONTENT.emptyStates.alerts },
      briefing: { type: String, default: DEFAULT_CONTENT.emptyStates.briefing },
    },
  },
  { _id: false }
);

const tradingDefaultsSchema = new mongoose.Schema(
  {
    defaultOrderType: {
      type: String,
      enum: ["MARKET", "LIMIT"],
      default: DEFAULT_TRADING_DEFAULTS.defaultOrderType,
    },
    defaultRiskPercent: {
      type: Number,
      default: DEFAULT_TRADING_DEFAULTS.defaultRiskPercent,
    },
    signalExpiryHours: {
      type: Number,
      default: DEFAULT_TRADING_DEFAULTS.signalExpiryHours,
    },
  },
  { _id: false }
);

const analysisSchema = new mongoose.Schema(
  {
    watchlistLimit: { type: Number, default: DEFAULT_ANALYSIS.watchlistLimit },
  },
  { _id: false }
);

const localeSchema = new mongoose.Schema(
  {
    locale: { type: String, default: DEFAULT_LOCALE.locale },
    timezone: { type: String, default: DEFAULT_LOCALE.timezone },
    currency: { type: String, default: DEFAULT_LOCALE.currency },
    dateFormat: {
      type: String,
      enum: ["locale", "iso", "dmy", "mdy"],
      default: DEFAULT_LOCALE.dateFormat,
    },
    numberFormat: {
      type: String,
      enum: ["locale", "comma-dot", "dot-comma"],
      default: DEFAULT_LOCALE.numberFormat,
    },
  },
  { _id: false }
);

const socialSchema = new mongoose.Schema(
  {
    x: { type: String, default: DEFAULT_SOCIAL.x },
    telegram: { type: String, default: DEFAULT_SOCIAL.telegram },
    discord: { type: String, default: DEFAULT_SOCIAL.discord },
    youtube: { type: String, default: DEFAULT_SOCIAL.youtube },
    linkedin: { type: String, default: DEFAULT_SOCIAL.linkedin },
    github: { type: String, default: DEFAULT_SOCIAL.github },
  },
  { _id: false }
);

const pwaSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULT_PWA.enabled },
    shortName: { type: String, default: DEFAULT_PWA.shortName },
    themeColor: { type: String, default: DEFAULT_PWA.themeColor },
    backgroundColor: { type: String, default: DEFAULT_PWA.backgroundColor },
    display: {
      type: String,
      enum: ["standalone", "browser"],
      default: DEFAULT_PWA.display,
    },
  },
  { _id: false }
);

const emailTemplateSchema = new mongoose.Schema(
  { subject: { type: String, default: "" }, body: { type: String, default: "" } },
  { _id: false }
);

const templatesSchema = new mongoose.Schema(
  {
    email: {
      passwordReset: {
        type: emailTemplateSchema,
        default: () => ({ ...DEFAULT_TEMPLATES.email.passwordReset }),
      },
      verifyEmail: {
        type: emailTemplateSchema,
        default: () => ({ ...DEFAULT_TEMPLATES.email.verifyEmail }),
      },
      adminInvite: {
        type: emailTemplateSchema,
        default: () => ({ ...DEFAULT_TEMPLATES.email.adminInvite }),
      },
    },
    telegram: {
      signalPublished: {
        type: String,
        default: DEFAULT_TEMPLATES.telegram.signalPublished,
      },
      alertTriggered: {
        type: String,
        default: DEFAULT_TEMPLATES.telegram.alertTriggered,
      },
      test: { type: String, default: DEFAULT_TEMPLATES.telegram.test },
    },
  },
  { _id: false }
);

const webhooksSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULT_WEBHOOKS.enabled },
    url: { type: String, default: DEFAULT_WEBHOOKS.url },
    secret: { type: String, default: DEFAULT_WEBHOOKS.secret },
    signalPublished: { type: Boolean, default: DEFAULT_WEBHOOKS.signalPublished },
    alertTriggered: { type: Boolean, default: DEFAULT_WEBHOOKS.alertTriggered },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "site" },
    site: { type: siteSchema, default: () => ({ ...DEFAULT_SITE }) },
    branding: { type: brandingSchema, default: () => ({ ...DEFAULT_BRANDING }) },
    theme: { type: themeSchema, default: () => ({ ...DEFAULT_THEME }) },
    navigation: {
      type: navigationSchema,
      default: () => ({
        modules: DEFAULT_MODULES.map((module) => ({ ...module })),
        landing: { ...DEFAULT_NAVIGATION.landing },
      }),
    },
    maintenance: { type: maintenanceSchema, default: () => ({ ...DEFAULT_MAINTENANCE }) },
    announcement: { type: announcementSchema, default: () => ({ ...DEFAULT_ANNOUNCEMENT }) },
    registration: { type: registrationSchema, default: () => ({ ...DEFAULT_REGISTRATION }) },
    legal: { type: legalSchema, default: () => ({ ...DEFAULT_LEGAL }) },
    seo: { type: seoSchema, default: () => ({ ...DEFAULT_SEO }) },
    content: {
      type: contentSchema,
      default: () => ({
        ...DEFAULT_CONTENT,
        emptyStates: { ...DEFAULT_CONTENT.emptyStates },
      }),
    },
    tradingDefaults: {
      type: tradingDefaultsSchema,
      default: () => ({ ...DEFAULT_TRADING_DEFAULTS }),
    },
    analysis: {
      type: analysisSchema,
      default: () => ({ ...DEFAULT_ANALYSIS }),
    },
    locale: { type: localeSchema, default: () => ({ ...DEFAULT_LOCALE }) },
    social: { type: socialSchema, default: () => ({ ...DEFAULT_SOCIAL }) },
    pwa: { type: pwaSchema, default: () => ({ ...DEFAULT_PWA }) },
    templates: {
      type: templatesSchema,
      default: () => ({
        email: {
          passwordReset: { ...DEFAULT_TEMPLATES.email.passwordReset },
          verifyEmail: { ...DEFAULT_TEMPLATES.email.verifyEmail },
          adminInvite: { ...DEFAULT_TEMPLATES.email.adminInvite },
        },
        telegram: { ...DEFAULT_TEMPLATES.telegram },
      }),
    },
    webhooks: { type: webhooksSchema, default: () => ({ ...DEFAULT_WEBHOOKS }) },
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

function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

function isLanding(value: unknown): value is LandingKey {
  return value === "home" || value === "analysis" || value === "signals";
}

function isTone(value: unknown): value is AnnouncementTone {
  return value === "info" || value === "success" || value === "warning" || value === "danger";
}

function isRegistrationMode(value: unknown): value is RegistrationMode {
  return value === "open" || value === "approval" || value === "invite" || value === "closed";
}

export function mergeSite(stored: any): SiteAddressSettings {
  const site = stored && typeof stored === "object" ? stored : {};
  return {
    publicBaseUrl:
      typeof site.publicBaseUrl === "string" ? site.publicBaseUrl : DEFAULT_SITE.publicBaseUrl,
  };
}

export function mergeRegistration(stored: any): RegistrationSettings {
  const registration = stored && typeof stored === "object" ? stored : {};
  return {
    mode: isRegistrationMode(registration.mode) ? registration.mode : DEFAULT_REGISTRATION.mode,
    message:
      typeof registration.message === "string"
        ? registration.message
        : DEFAULT_REGISTRATION.message,
    inviteCode:
      typeof registration.inviteCode === "string"
        ? registration.inviteCode
        : DEFAULT_REGISTRATION.inviteCode,
    requireEmailVerification:
      registration.requireEmailVerification === true,
  };
}

export function mergeLegal(stored: any): LegalSettings {
  const legal = stored && typeof stored === "object" ? stored : {};
  return {
    termsUrl: typeof legal.termsUrl === "string" ? legal.termsUrl : DEFAULT_LEGAL.termsUrl,
    privacyUrl:
      typeof legal.privacyUrl === "string" ? legal.privacyUrl : DEFAULT_LEGAL.privacyUrl,
    riskDisclaimer:
      typeof legal.riskDisclaimer === "string"
        ? legal.riskDisclaimer
        : DEFAULT_LEGAL.riskDisclaimer,
  };
}

/**
 * Merge a stored module list over the defaults. Unknown or duplicate keys are
 * dropped, missing modules are appended in the default order, and trading is
 * always signed-in because its API is auth-only.
 */
export function mergeModules(
  stored: unknown,
  base: ModuleSettings[] = DEFAULT_MODULES
): ModuleSettings[] {
  const rows = Array.isArray(stored) ? stored : [];
  const seen = new Set<ModuleKey>();
  const modules: ModuleSettings[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (!isModuleKey(row.key) || seen.has(row.key)) continue;
    const key = row.key;
    seen.add(key);
    const fallback = base.find((module) => module.key === key) ?? DEFAULT_MODULES.find((m) => m.key === key)!;
    modules.push({
      key,
      label:
        typeof row.label === "string" && row.label.trim() ? row.label.trim() : fallback.label,
      hidden: row.hidden === true,
      access:
        key === "trading"
          ? "signed-in"
          : row.access === "admin"
            ? "admin"
            : row.access === "signed-in"
              ? "signed-in"
              : "public",
    });
  }

  for (const fallback of DEFAULT_MODULES) {
    if (seen.has(fallback.key)) continue;
    const current = base.find((module) => module.key === fallback.key) ?? fallback;
    modules.push({
      ...current,
      access: fallback.key === "trading" ? "signed-in" : current.access,
    });
  }

  return modules;
}

export function mergeNavigation(stored: any): NavigationSettings {
  const navigation = stored && typeof stored === "object" ? stored : {};
  const landing = navigation.landing && typeof navigation.landing === "object" ? navigation.landing : {};
  return {
    modules: mergeModules(navigation.modules),
    landing: {
      signedIn: isLanding(landing.signedIn)
        ? landing.signedIn
        : DEFAULT_NAVIGATION.landing.signedIn,
      signedOut: isLanding(landing.signedOut)
        ? landing.signedOut
        : DEFAULT_NAVIGATION.landing.signedOut,
    },
  };
}

export function mergeMaintenance(stored: any): MaintenanceSettings {
  const maintenance = stored && typeof stored === "object" ? stored : {};
  return {
    enabled: maintenance.enabled === true,
    message:
      typeof maintenance.message === "string"
        ? maintenance.message
        : DEFAULT_MAINTENANCE.message,
    allowAdmins: maintenance.allowAdmins !== false,
  };
}

export function mergeAnnouncement(stored: any): AnnouncementSettings {
  const announcement = stored && typeof stored === "object" ? stored : {};
  return {
    enabled: announcement.enabled === true,
    text: typeof announcement.text === "string" ? announcement.text : DEFAULT_ANNOUNCEMENT.text,
    tone: isTone(announcement.tone) ? announcement.tone : DEFAULT_ANNOUNCEMENT.tone,
    linkLabel:
      typeof announcement.linkLabel === "string"
        ? announcement.linkLabel
        : DEFAULT_ANNOUNCEMENT.linkLabel,
    linkUrl:
      typeof announcement.linkUrl === "string"
        ? announcement.linkUrl
        : DEFAULT_ANNOUNCEMENT.linkUrl,
    dismissible: announcement.dismissible !== false,
    startsAt: iso(announcement.startsAt),
    endsAt: iso(announcement.endsAt),
  };
}

export function mergeAnalysis(stored: any): AnalysisSettings {
  const analysis = stored && typeof stored === "object" ? stored : {};
  const limit = Number(analysis.watchlistLimit);
  return {
    watchlistLimit:
      Number.isFinite(limit) && limit >= 1 && limit <= 60
        ? Math.round(limit)
        : DEFAULT_ANALYSIS.watchlistLimit,
  };
}

/** Merge a stored document over the defaults. Exported for the test suite. */
export function mergeSiteSettings(doc: any): SiteSettings {
  const updatedAt = iso(doc?.updatedAt);
  return {
    site: mergeSite(doc?.site),
    branding: { ...DEFAULT_BRANDING, ...(doc?.branding ?? {}) },
    theme: { ...DEFAULT_THEME, ...(doc?.theme ?? {}) },
    navigation: mergeNavigation(doc?.navigation),
    maintenance: mergeMaintenance(doc?.maintenance),
    announcement: mergeAnnouncement(doc?.announcement),
    registration: mergeRegistration(doc?.registration),
    analysis: mergeAnalysis(doc?.analysis),
    legal: mergeLegal(doc?.legal),
    seo: { ...DEFAULT_SEO, ...(doc?.seo ?? {}) },
    content: {
      ...DEFAULT_CONTENT,
      ...(doc?.content ?? {}),
      emptyStates: {
        ...DEFAULT_CONTENT.emptyStates,
        ...(doc?.content?.emptyStates ?? {}),
      },
    },
    tradingDefaults: { ...DEFAULT_TRADING_DEFAULTS, ...(doc?.tradingDefaults ?? {}) },
    locale: { ...DEFAULT_LOCALE, ...(doc?.locale ?? {}) },
    social: { ...DEFAULT_SOCIAL, ...(doc?.social ?? {}) },
    pwa: { ...DEFAULT_PWA, ...(doc?.pwa ?? {}) },
    templates: {
      email: {
        passwordReset: {
          ...DEFAULT_TEMPLATES.email.passwordReset,
          ...(doc?.templates?.email?.passwordReset ?? {}),
        },
        verifyEmail: {
          ...DEFAULT_TEMPLATES.email.verifyEmail,
          ...(doc?.templates?.email?.verifyEmail ?? {}),
        },
        adminInvite: {
          ...DEFAULT_TEMPLATES.email.adminInvite,
          ...(doc?.templates?.email?.adminInvite ?? {}),
        },
      },
      telegram: { ...DEFAULT_TEMPLATES.telegram, ...(doc?.templates?.telegram ?? {}) },
    },
    webhooks: { ...DEFAULT_WEBHOOKS, ...(doc?.webhooks ?? {}) },
    version: updatedAt,
    updatedAt,
    updatedBy: typeof doc?.updatedBy === "string" ? doc.updatedBy : null,
  };
}

// The config endpoint is hit on every page load. A short cache keeps the
// public path off Mongo without delaying an admin save by more than a request.
const CACHE_MS = 3_000;
let cache: { at: number; settings: SiteSettings } | null = null;

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  const doc = await SiteSettingsModel.findOne({ key: "site" }).lean().exec();
  const settings = mergeSiteSettings(doc);
  cache = { at: Date.now(), settings };
  return settings;
}

/**
 * Validate a partial patch, merge it over the stored document and upsert the
 * singleton. `updatedBy` is the admin username, kept for future audit tooling.
 */
export async function saveSiteSettings(
  patch: {
    site?: unknown;
    branding?: unknown;
    theme?: unknown;
    navigation?: unknown;
    maintenance?: unknown;
    announcement?: unknown;
    registration?: unknown;
    analysis?: unknown;
    legal?: unknown;
    seo?: unknown;
    content?: unknown;
    tradingDefaults?: unknown;
    locale?: unknown;
    social?: unknown;
    pwa?: unknown;
    templates?: unknown;
    webhooks?: unknown;
  },
  updatedBy: string
): Promise<SiteSettings> {
  // Read the latest document rather than a value cached before the previous save.
  cache = null;
  const current = await getSiteSettings();
  const site = normalizeSite(patch.site, current.site);
  const branding = normalizeBranding(patch.branding, current.branding);
  const theme = normalizeTheme(patch.theme, current.theme);
  const navigation = normalizeNavigation(patch.navigation, current.navigation);
  const maintenance = normalizeMaintenance(patch.maintenance, current.maintenance);
  const announcement = normalizeAnnouncement(patch.announcement, current.announcement);
  const registration = normalizeRegistration(patch.registration, current.registration);
  const analysis = normalizeAnalysis(patch.analysis, current.analysis);
  const legal = normalizeLegal(patch.legal, current.legal);
  const seo = normalizeSeo(patch.seo, current.seo);
  const content = normalizeContent(patch.content, current.content);
  const tradingDefaults = normalizeTradingDefaults(
    patch.tradingDefaults,
    current.tradingDefaults
  );
  const locale = normalizeLocale(patch.locale, current.locale);
  const social = normalizeSocial(patch.social, current.social);
  const pwa = normalizePwa(patch.pwa, current.pwa);
  const templates = normalizeTemplates(patch.templates, current.templates);
  const webhooks = normalizeWebhooks(patch.webhooks, current.webhooks);

  const doc = await SiteSettingsModel.findOneAndUpdate(
    { key: "site" },
    {
      $set: {
        site,
        branding,
        theme,
        navigation,
        maintenance,
        announcement,
        registration,
        analysis,
        legal,
        seo,
        content,
        tradingDefaults,
        locale,
        social,
        pwa,
        templates,
        webhooks,
        updatedBy,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
    .lean()
    .exec();

  const settings = mergeSiteSettings(doc);
  cache = { at: Date.now(), settings };
  return settings;
}

/** The subset safe to expose without a session. */
export function publicSiteConfig(settings: SiteSettings): SiteConfig {
  return {
    site: settings.site,
    branding: settings.branding,
    theme: settings.theme,
    navigation: settings.navigation,
    maintenance: settings.maintenance,
    announcement: settings.announcement,
    registration: {
      mode: settings.registration.mode,
      message: settings.registration.message,
      inviteRequired: settings.registration.mode === "invite",
      requireEmailVerification: settings.registration.requireEmailVerification,
    },
    legal: settings.legal,
    seo: settings.seo,
    content: settings.content,
    tradingDefaults: settings.tradingDefaults,
    locale: settings.locale,
    social: settings.social,
    pwa: settings.pwa,
    version: settings.version,
  };
}
