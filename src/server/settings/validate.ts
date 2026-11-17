// Validation for the admin settings editor.
//
// The API merges a partial patch over the current document, so every function
// accepts whatever the client sent plus the base value it should fall back to.
// Anything that reaches the database has been trimmed, length-checked and, for
// colours and URLs, format-checked.

import { DEFAULT_MODULES, DEFAULT_NAV_GROUPS, MODULE_KEYS } from "./defaults";
import type {
  AnalysisSettings,
  AnnouncementSettings,
  AnnouncementTone,
  BrandingSettings,
  ContentSettings,
  DateFormat,
  DemoSettings,
  LandingKey,
  LegalSettings,
  LocaleSettings,
  MaintenanceSettings,
  ModuleAccess,
  ModuleKey,
  ModuleSettings,
  NavGroupSettings,
  NavigationSettings,
  NumberFormat,
  PwaSettings,
  RegistrationMode,
  RegistrationSettings,
  SeoSettings,
  SiteAddressSettings,
  SocialSettings,
  TemplateSettings,
  ThemeDensity,
  ThemeFont,
  ThemeMode,
  ThemeSettings,
  TradingDefaultsSettings,
  WebhookSettings,
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

  if (source.font !== undefined) {
    const font = source.font;
    if (font !== "inter" && font !== "system" && font !== "serif") {
      throw new SettingsValidationError("font must be inter, system or serif");
    }
    next.font = font as ThemeFont;
  }

  if (source.density !== undefined) {
    const density = source.density;
    if (density !== "compact" && density !== "comfortable" && density !== "spacious") {
      throw new SettingsValidationError("density must be compact, comfortable or spacious");
    }
    next.density = density as ThemeDensity;
  }

  if (source.radius !== undefined) {
    const radius = typeof source.radius === "number" ? source.radius : Number.NaN;
    if (!Number.isInteger(radius) || radius < 0 || radius > 24) {
      throw new SettingsValidationError("radius must be a whole number from 0 to 24");
    }
    next.radius = radius;
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

const GROUP_KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;

function slugifyGroup(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || "group";
}

/**
 * Normalise the ordered sidebar sections. The client always sends the full
 * list, so removing a group is allowed. Keys are stable slugs; a label that
 * arrives without one gets a slug derived from the label.
 */
export function normalizeGroups(patch: unknown, base: NavGroupSettings[]): NavGroupSettings[] {
  if (patch === undefined) return base.map((group) => ({ ...group }));
  if (!Array.isArray(patch) || patch.length === 0) {
    throw new SettingsValidationError("groups must be a non-empty array");
  }

  const seen = new Set<string>();
  const next: NavGroupSettings[] = [];

  for (const entry of patch) {
    const source = plainObject(entry);
    const label = readString(source, "label", "", 24);
    if (!label) throw new SettingsValidationError("group labels cannot be empty");

    const rawKey = typeof source.key === "string" ? source.key.trim().toLowerCase() : "";
    const key = GROUP_KEY.test(rawKey) ? rawKey : slugifyGroup(label);
    if (seen.has(key)) {
      throw new SettingsValidationError(`duplicate group: ${key}`);
    }
    seen.add(key);
    next.push({ key, label });
  }

  return next;
}

/** Keep a module inside a group that exists, preferring its default section. */
function groupFor(moduleKey: ModuleKey, group: string, groupKeys: string[]): string {
  if (groupKeys.includes(group)) return group;
  const fallback = defaultModule(moduleKey).group;
  return groupKeys.includes(fallback) ? fallback : groupKeys[0];
}

/**
 * Normalise the ordered module list. The client always sends the full list;
 * any module it omits is appended in the default order so a partial patch can
 * never make a tab disappear from the shell entirely.
 */
export function normalizeModules(
  patch: unknown,
  base: ModuleSettings[],
  groupKeys: string[] = DEFAULT_NAV_GROUPS.map((group) => group.key)
): ModuleSettings[] {
  if (patch === undefined) {
    return base.map((module) => ({
      ...module,
      group: groupFor(module.key, module.group, groupKeys),
    }));
  }
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
      if (source.access !== "public" && source.access !== "signed-in" && source.access !== "admin") {
        throw new SettingsValidationError("module access must be public, signed-in or admin");
      }
      access = source.access;
    }
    // Trading always needs a session; the trading API is auth-only.
    if (moduleKey === "trading") access = "signed-in";

    const requestedGroup = typeof source.group === "string" ? source.group : current.group;

    next.push({
      key: moduleKey,
      label,
      hidden: readBoolean(source, "hidden", current.hidden),
      access,
      group: groupFor(moduleKey, requestedGroup, groupKeys),
    });
  }

  for (const fallback of DEFAULT_MODULES) {
    if (seen.has(fallback.key)) continue;
    const current = base.find((module) => module.key === fallback.key) ?? fallback;
    next.push({
      ...current,
      group: groupFor(fallback.key, current.group, groupKeys),
      access: fallback.key === "trading" ? "signed-in" : current.access,
    });
  }

  return next;
}

export function normalizeNavigation(
  patch: unknown,
  base: NavigationSettings
): NavigationSettings {
  const source = plainObject(patch);
  const landingSource = plainObject(source.landing);
  const groups = normalizeGroups(source.groups, base.groups);

  return {
    groups,
    modules: normalizeModules(
      source.modules,
      base.modules,
      groups.map((group) => group.key)
    ),
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

// ---------------------------------------------------------------------------
// SEO, content, trading defaults, locale, social, PWA, templates and webhooks
// ---------------------------------------------------------------------------

function readNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (!(key in source) || source[key] === undefined) return fallback;
  const raw = source[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max) {
    throw new SettingsValidationError(`${key} must be a number from ${min} to ${max}`);
  }
  return raw;
}

function checkHttp(value: string, key: string, allowPath = false): string {
  if (!value) return value;
  if ((allowPath && value.startsWith("/")) || HTTP_URL.test(value)) return value;
  throw new SettingsValidationError(`${key} must be an http(s) URL${allowPath ? " or start with /" : ""}`);
}

const ANALYTICS_PROVIDERS = ["none", "plausible", "umami", "google"] as const;

export function normalizeSeo(patch: unknown, base: SeoSettings): SeoSettings {
  const source = plainObject(patch);
  let analyticsProvider = base.analyticsProvider;
  if (source.analyticsProvider !== undefined) {
    if (
      typeof source.analyticsProvider !== "string" ||
      !(ANALYTICS_PROVIDERS as readonly string[]).includes(source.analyticsProvider)
    ) {
      throw new SettingsValidationError("analyticsProvider must be none, plausible, umami or google");
    }
    analyticsProvider = source.analyticsProvider as SeoSettings["analyticsProvider"];
  }
  const canonicalUrl = checkHttp(
    readString(source, "canonicalUrl", base.canonicalUrl, 500),
    "canonicalUrl"
  );
  const ogImageUrl = checkHttp(
    readString(source, "ogImageUrl", base.ogImageUrl, 500),
    "ogImageUrl",
    true
  );
  const analyticsScriptUrl = checkHttp(
    readString(source, "analyticsScriptUrl", base.analyticsScriptUrl, 500),
    "analyticsScriptUrl",
    true
  );
  return {
    title: readString(source, "title", base.title, 120),
    description: readString(source, "description", base.description, 300),
    canonicalUrl,
    ogImageUrl,
    keywords: readString(source, "keywords", base.keywords, 300),
    noindex: readBoolean(source, "noindex", base.noindex),
    analyticsProvider,
    analyticsScriptUrl,
    analyticsSiteId: readString(source, "analyticsSiteId", base.analyticsSiteId, 200),
    analyticsRequireConsent: readBoolean(
      source,
      "analyticsRequireConsent",
      base.analyticsRequireConsent
    ),
  };
}

export function normalizeContent(patch: unknown, base: ContentSettings): ContentSettings {
  const source = plainObject(patch);
  const empty = plainObject(source.emptyStates);
  return {
    heroTitle: readString(source, "heroTitle", base.heroTitle, 300),
    heroBody: readString(source, "heroBody", base.heroBody, 1000),
    featuresTitle: readString(source, "featuresTitle", base.featuresTitle, 120),
    featuresBody: readString(source, "featuresBody", base.featuresBody, 500),
    loginIntro: readString(source, "loginIntro", base.loginIntro, 500),
    registerIntro: readString(source, "registerIntro", base.registerIntro, 500),
    emptyStates: {
      analysis: readString(empty, "analysis", base.emptyStates.analysis, 300),
      signals: readString(empty, "signals", base.emptyStates.signals, 300),
      breakouts: readString(empty, "breakouts", base.emptyStates.breakouts, 300),
      trading: readString(empty, "trading", base.emptyStates.trading, 300),
      alerts: readString(empty, "alerts", base.emptyStates.alerts, 300),
      briefing: readString(empty, "briefing", base.emptyStates.briefing, 300),
      coach: readString(empty, "coach", base.emptyStates.coach, 300),
    },
  };
}

export function normalizeTradingDefaults(
  patch: unknown,
  base: TradingDefaultsSettings
): TradingDefaultsSettings {
  const source = plainObject(patch);
  let defaultOrderType = base.defaultOrderType;
  if (source.defaultOrderType !== undefined) {
    if (source.defaultOrderType !== "MARKET" && source.defaultOrderType !== "LIMIT") {
      throw new SettingsValidationError("defaultOrderType must be MARKET or LIMIT");
    }
    defaultOrderType = source.defaultOrderType;
  }
  return {
    defaultOrderType,
    defaultRiskPercent: readNumber(
      source,
      "defaultRiskPercent",
      base.defaultRiskPercent,
      0,
      100
    ),
    signalExpiryHours: Math.round(
      readNumber(source, "signalExpiryHours", base.signalExpiryHours, 0, 720)
    ),
  };
}

const DATE_FORMATS: readonly DateFormat[] = ["locale", "iso", "dmy", "mdy"];
const NUMBER_FORMATS: readonly NumberFormat[] = ["locale", "comma-dot", "dot-comma"];

export function normalizeDemo(patch: unknown, base: DemoSettings): DemoSettings {
  const source = plainObject(patch);
  const label = readString(source, "label", base.label, 40);
  return {
    enabled: readBoolean(source, "enabled", base.enabled),
    label: label || base.label,
  };
}

export function normalizeAnalysis(patch: unknown, base: AnalysisSettings): AnalysisSettings {
  const source = plainObject(patch);
  return {
    watchlistLimit: Math.round(
      readNumber(source, "watchlistLimit", base.watchlistLimit, 1, 60)
    ),
  };
}

export function normalizeLocale(patch: unknown, base: LocaleSettings): LocaleSettings {
  const source = plainObject(patch);
  const locale = readString(source, "locale", base.locale, 35);
  if (locale && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    throw new SettingsValidationError("locale must look like en or en-GB");
  }
  const timezone = readString(source, "timezone", base.timezone, 80);
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
    } catch {
      throw new SettingsValidationError("timezone must be a valid IANA zone such as Europe/London");
    }
  }
  const currency = readString(source, "currency", base.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new SettingsValidationError("currency must be a three-letter ISO code");
  }
  let dateFormat = base.dateFormat;
  if (source.dateFormat !== undefined) {
    if (typeof source.dateFormat !== "string" || !(DATE_FORMATS as readonly string[]).includes(source.dateFormat)) {
      throw new SettingsValidationError("dateFormat must be locale, iso, dmy or mdy");
    }
    dateFormat = source.dateFormat as DateFormat;
  }
  let numberFormat = base.numberFormat;
  if (source.numberFormat !== undefined) {
    if (
      typeof source.numberFormat !== "string" ||
      !(NUMBER_FORMATS as readonly string[]).includes(source.numberFormat)
    ) {
      throw new SettingsValidationError("numberFormat must be locale, comma-dot or dot-comma");
    }
    numberFormat = source.numberFormat as NumberFormat;
  }
  return { locale, timezone, currency, dateFormat, numberFormat };
}

const SOCIAL_KEYS = ["x", "telegram", "discord", "youtube", "linkedin", "github"] as const;

export function normalizeSocial(patch: unknown, base: SocialSettings): SocialSettings {
  const source = plainObject(patch);
  const next = { ...base };
  for (const key of SOCIAL_KEYS) {
    next[key] = checkHttp(readString(source, key, base[key], 500), key);
  }
  return next;
}

export function normalizePwa(patch: unknown, base: PwaSettings): PwaSettings {
  const source = plainObject(patch);
  const themeColor = readString(source, "themeColor", base.themeColor, 7);
  const backgroundColor = readString(source, "backgroundColor", base.backgroundColor, 7);
  if (!HEX.test(themeColor) || !HEX.test(backgroundColor)) {
    throw new SettingsValidationError("PWA colours must be 6-digit hex values");
  }
  let display = base.display;
  if (source.display !== undefined) {
    if (source.display !== "standalone" && source.display !== "browser") {
      throw new SettingsValidationError("PWA display must be standalone or browser");
    }
    display = source.display;
  }
  return {
    enabled: readBoolean(source, "enabled", base.enabled),
    shortName: readString(source, "shortName", base.shortName, 30),
    themeColor: themeColor.toLowerCase(),
    backgroundColor: backgroundColor.toLowerCase(),
    display,
  };
}

function normalizeEmailTemplate(
  patch: unknown,
  base: { subject: string; body: string }
): { subject: string; body: string } {
  const source = plainObject(patch);
  return {
    subject: readString(source, "subject", base.subject, 200),
    body: readString(source, "body", base.body, 5000),
  };
}

export function normalizeTemplates(patch: unknown, base: TemplateSettings): TemplateSettings {
  const source = plainObject(patch);
  const email = plainObject(source.email);
  const telegram = plainObject(source.telegram);
  return {
    email: {
      passwordReset: normalizeEmailTemplate(email.passwordReset, base.email.passwordReset),
      verifyEmail: normalizeEmailTemplate(email.verifyEmail, base.email.verifyEmail),
      adminInvite: normalizeEmailTemplate(email.adminInvite, base.email.adminInvite),
    },
    telegram: {
      signalPublished: readString(
        telegram,
        "signalPublished",
        base.telegram.signalPublished,
        2000
      ),
      alertTriggered: readString(telegram, "alertTriggered", base.telegram.alertTriggered, 2000),
      test: readString(telegram, "test", base.telegram.test, 500),
    },
  };
}

export function normalizeWebhooks(patch: unknown, base: WebhookSettings): WebhookSettings {
  const source = plainObject(patch);
  const enabled = readBoolean(source, "enabled", base.enabled);
  const url = checkHttp(readString(source, "url", base.url, 500), "webhook url");
  if (enabled && !url) throw new SettingsValidationError("webhook URL is required when enabled");
  return {
    enabled,
    url,
    secret: readString(source, "secret", base.secret, 200),
    signalPublished: readBoolean(source, "signalPublished", base.signalPublished),
    alertTriggered: readBoolean(source, "alertTriggered", base.alertTriggered),
  };
}
