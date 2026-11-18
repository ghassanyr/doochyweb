// Runtime site presentation.
//
// The server stores branding and one admin-edited palette in Mongo; this
// provider fetches the public subset once at boot and translates the colour
// tokens into the CSS variables every component already uses. Saving from the
// admin page pushes the new values straight into the same provider, so the
// header and palette update without a reload.
//
// Visitors can flip dark/light from the header. The stored palette is the site
// default; the opposite mode is the built-in counterpart palette with the
// brand's accent colours carried over, and the choice is remembered per
// browser.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  configApi,
  type AnnouncementSettings,
  type BrandingSettings,
  type ContentSettings,
  type DemoSettings,
  type LocaleSettings,
  type MaintenanceSettings,
  type LegalSettings,
  type ModuleSettings,
  type NavGroupSettings,
  type NavigationSettings,
  type PublicRegistrationSettings,
  type PwaSettings,
  type SeoSettings,
  type SiteAddressSettings,
  type SiteConfig,
  type SocialSettings,
  type ThemeMode,
  type ThemeSettings,
  type TradingDefaultsSettings,
} from "./api";
import { monogramDataUrl } from "./brandMark";
import { CONSENT_CHANGED_EVENT, hasCookieConsent } from "./consent";
import { setLocaleSettings } from "./format";
import { setDefaultTimeOptions } from "./time";

export const FALLBACK_SITE: SiteAddressSettings = {
  publicBaseUrl: "",
};

export const FALLBACK_REGISTRATION: PublicRegistrationSettings = {
  mode: "open",
  message: "",
  inviteRequired: false,
  requireEmailVerification: false,
};

export const FALLBACK_DEMO: DemoSettings = {
  enabled: true,
  label: "Explore sample account",
};

export const FALLBACK_LEGAL: LegalSettings = {
  termsUrl: "",
  privacyUrl: "",
  riskDisclaimer: "",
};

export const FALLBACK_BRANDING: BrandingSettings = {
  name: "Doochy",
  tagline: "Market analysis & trading",
  description:
    "Doochy brings multi timeframe analysis, curated trade ideas, automated breakout research, and a pattern trainer into one focused workspace.",
  logoUrl: "",
  supportEmail: "",
  websiteUrl: "",
  footerText: "",
};

/**
 * True only for the untouched default brand. A renamed deployment without a
 * uploaded logo gets a generated monogram instead of the bundled Doochy mark.
 */
export function isBundledBrand(branding: BrandingSettings): boolean {
  const name = (branding.name.trim() || FALLBACK_BRANDING.name).toLowerCase();
  return !branding.logoUrl && name === FALLBACK_BRANDING.name.toLowerCase();
}

/** The logo shown in the header, settings and maintenance screen. */
export function brandMarkUrl(
  branding: BrandingSettings,
  theme: Pick<ThemeSettings, "accent" | "accentFg">,
  size: number
): string {
  if (branding.logoUrl) return branding.logoUrl;
  if (isBundledBrand(branding)) return `/doochy-mark-${size}.png`;
  return monogramDataUrl(
    branding.name.trim() || FALLBACK_BRANDING.name,
    theme.accent,
    theme.accentFg,
    size
  );
}

export const FALLBACK_THEME: ThemeSettings = {
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

/** Built-in light palette, also offered as a starting point in the editor. */
export const LIGHT_THEME: ThemeSettings = {
  mode: "light",
  font: "inter",
  density: "comfortable",
  radius: 10,
  accent: "#0f766e",
  accentHover: "#0d9488",
  accentDeep: "#115e59",
  accentFg: "#ffffff",
  canvas: "#f6f7f9",
  canvasSoft: "#eef1f5",
  surface: "#ffffff",
  surfaceHover: "#f3f5f8",
  surfaceActive: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: "#101828",
  success: "#059669",
  danger: "#dc2626",
  strongSell: "#dc2626",
  strongBuy: "#16a34a",
  ratingNeutral: "#64748b",
};

const MODE_KEY = "doochyweb_theme_mode";

/** Compiled navigation used before /api/config resolves. */
export const FALLBACK_NAV_GROUPS: NavGroupSettings[] = [
  { key: "market", label: "Market" },
  { key: "workspace", label: "Workspace" },
  { key: "learn", label: "Learn" },
];

export const FALLBACK_MODULES: ModuleSettings[] = [
  { key: "analysis", label: "Analysis", hidden: false, access: "public", group: "market" },
  { key: "signals", label: "Signals", hidden: false, access: "public", group: "market" },
  { key: "breakouts", label: "Breakouts", hidden: false, access: "public", group: "market" },
  { key: "learn", label: "Learn", hidden: false, access: "public", group: "learn" },
  { key: "trading", label: "Trading", hidden: false, access: "signed-in", group: "workspace" },
  { key: "alerts", label: "Alerts", hidden: false, access: "signed-in", group: "workspace" },
  { key: "briefing", label: "Briefing", hidden: false, access: "signed-in", group: "workspace" },
  { key: "coach", label: "Coach", hidden: false, access: "signed-in", group: "workspace" },
];

export const FALLBACK_NAVIGATION: NavigationSettings = {
  groups: FALLBACK_NAV_GROUPS,
  modules: FALLBACK_MODULES,
  landing: { signedIn: "home", signedOut: "home" },
};

export const FALLBACK_MAINTENANCE: MaintenanceSettings = {
  enabled: false,
  message: "We're making some improvements. Please check back soon.",
  allowAdmins: true,
};

export const FALLBACK_ANNOUNCEMENT: AnnouncementSettings = {
  enabled: false,
  text: "",
  tone: "info",
  linkLabel: "",
  linkUrl: "",
  dismissible: true,
  startsAt: null,
  endsAt: null,
};

export const FALLBACK_SEO: SeoSettings = {
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

export const FALLBACK_CONTENT: ContentSettings = {
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
    coach: "Close a few trades to build your first coaching review.",
  },
};

export const FALLBACK_TRADING_DEFAULTS: TradingDefaultsSettings = {
  defaultOrderType: "MARKET",
  defaultRiskPercent: 1,
  signalExpiryHours: 0,
};

export const FALLBACK_LOCALE: LocaleSettings = {
  locale: "",
  timezone: "",
  currency: "USD",
  dateFormat: "locale",
  numberFormat: "locale",
};

export const FALLBACK_SOCIAL: SocialSettings = {
  x: "",
  telegram: "",
  discord: "",
  youtube: "",
  linkedin: "",
  github: "",
};

export const FALLBACK_PWA: PwaSettings = {
  enabled: true,
  shortName: "",
  themeColor: "#0a0e14",
  backgroundColor: "#0a0e14",
  display: "standalone",
};

type ColorKey = Exclude<keyof ThemeSettings, "mode" | "font" | "density" | "radius">;

// Maps the stored hex values to the RGB-triplet variables in index.css.
const THEME_VARS: Record<ColorKey, string> = {
  accent: "--accent",
  accentHover: "--accent-hover",
  accentDeep: "--accent-deep",
  accentFg: "--accent-fg",
  canvas: "--canvas",
  canvasSoft: "--canvas-soft",
  surface: "--surface",
  surfaceHover: "--surface-hover",
  surfaceActive: "--surface-active",
  borderStrong: "--line-strong",
  text: "--text",
  success: "--success",
  danger: "--danger",
  strongSell: "--strong-sell",
  strongBuy: "--strong-buy",
  ratingNeutral: "--rating-neutral",
};

/** "#14b8a6" -> "20 184 166", the format the CSS tokens expect. */
export function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

export function applyTheme(theme: ThemeSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.colorScheme = theme.mode;
  for (const [key, cssVar] of Object.entries(THEME_VARS) as [ColorKey, string][]) {
    const triplet = hexToRgbTriplet(theme[key]);
    if (triplet) root.style.setProperty(cssVar, triplet);
  }
  root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.setProperty(
    "--density",
    theme.density === "compact" ? "0.85" : theme.density === "spacious" ? "1.15" : "1"
  );
  root.style.setProperty(
    "--font-ui",
    theme.font === "serif"
      ? 'Georgia, "Times New Roman", serif'
      : theme.font === "system"
        ? 'system-ui, -apple-system, "Segoe UI", sans-serif'
        : 'Inter, ui-sans-serif, system-ui, sans-serif'
  );
  root.dataset.density = theme.density;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && hexToRgbTriplet(theme.canvas)) meta.setAttribute("content", theme.canvas);
}

function setMeta(selector: string, content: string): void {
  const meta = document.querySelector(selector);
  if (meta) meta.setAttribute("content", content);
}

function applyBranding(branding: BrandingSettings, theme: ThemeSettings): void {
  if (typeof document === "undefined") return;
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="apple-touch-icon"]'
  )) {
    const width = Number.parseInt(link.getAttribute("sizes")?.split("x")[0] ?? "", 10);
    link.href = brandMarkUrl(branding, theme, Number.isFinite(width) ? width : 192);
    // The generated or uploaded asset may not be a PNG, so let the browser
    // infer the type from the URL instead of keeping the static hint.
    link.removeAttribute("type");
  }
}

/**
 * The palette to paint for `mode`. If the stored palette already matches, it is
 * used as-is; otherwise the built-in counterpart supplies the surfaces and the
 * brand accent colours carry over.
 */
export function themeForMode(theme: ThemeSettings, mode: ThemeMode): ThemeSettings {
  if (theme.mode === mode) return theme;
  const base = mode === "light" ? LIGHT_THEME : FALLBACK_THEME;
  return {
    ...base,
    accent: theme.accent,
    accentHover: theme.accentHover,
    accentDeep: theme.accentDeep,
    accentFg: theme.accentFg,
    mode,
  };
}

function readStoredMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  if (typeof document === "undefined") return;
  let meta = document.querySelector(`meta[${attr}="${key}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attr, key);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function upsertLink(rel: string, href: string, extra: Record<string, string> = {}): void {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
  for (const [key, value] of Object.entries(extra)) link.setAttribute(key, value);
}

function removeLink(rel: string): void {
  document.querySelector(`link[rel="${rel}"]`)?.remove();
}

function applySeo(
  seo: SeoSettings,
  branding: BrandingSettings,
  pwa: PwaSettings,
  baseUrl: string
): void {
  if (typeof document === "undefined") return;
  const name = branding.name.trim() || FALLBACK_BRANDING.name;
  const title = seo.title.trim() || name;
  const description =
    seo.description.trim() ||
    branding.description.trim() ||
    FALLBACK_BRANDING.description;
  document.title = title;
  setMeta('meta[name="description"]', description);
  setMeta('meta[name="application-name"]', name);
  setMeta('meta[name="apple-mobile-web-app-title"]', name);
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:site_name"]', name);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[name="twitter:title"]', title);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:card"]', seo.ogImageUrl ? "summary_large_image" : "summary");
  if (seo.keywords.trim()) setMeta('meta[name="keywords"]', seo.keywords.trim());
  upsertMeta("name", "robots", seo.noindex ? "noindex, nofollow" : "index, follow");

  const canonical = seo.canonicalUrl.trim() || baseUrl;
  if (canonical) {
    upsertLink("canonical", canonical);
    setMeta('meta[property="og:url"]', canonical);
  } else {
    removeLink("canonical");
  }
  const image = seo.ogImageUrl.trim();
  if (image) {
    const absolute = new URL(image, baseUrl || window.location.origin).toString();
    setMeta('meta[property="og:image"]', absolute);
    setMeta('meta[name="twitter:image"]', absolute);
  }

  const themeColor = pwa.themeColor || FALLBACK_PWA.themeColor;
  setMeta('meta[name="theme-color"]', themeColor);
  setMeta('meta[name="apple-mobile-web-app-capable"]', "yes");
  setMeta('meta[name="apple-mobile-web-app-status-bar-style"]', "default");

  if (pwa.enabled) {
    const manifest = {
      name,
      short_name: pwa.shortName.trim() || name,
      description,
      start_url: "/",
      scope: "/",
      display: pwa.display,
      background_color: pwa.backgroundColor,
      theme_color: themeColor,
      icons: [
        { src: brandMarkUrl(branding, FALLBACK_THEME, 192), sizes: "192x192", type: "image/png" },
        {
          src: brandMarkUrl(branding, FALLBACK_THEME, 512),
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" })
    );
    upsertLink("manifest", url);
  } else {
    removeLink("manifest");
  }
}

function removeAnalytics(): void {
  document.getElementById("doochy-analytics")?.remove();
  document.getElementById("doochy-analytics-inline")?.remove();
}

function applyAnalytics(seo: SeoSettings, consent: boolean): void {
  if (typeof document === "undefined") return;
  if (seo.analyticsProvider === "none") {
    removeAnalytics();
    return;
  }
  if (seo.analyticsRequireConsent && !consent) {
    removeAnalytics();
    return;
  }
  if (seo.analyticsProvider !== "google" && !seo.analyticsSiteId.trim()) return;
  if (seo.analyticsProvider === "google" && !seo.analyticsSiteId.trim()) return;
  const signature = [seo.analyticsProvider, seo.analyticsSiteId, seo.analyticsScriptUrl].join("|");
  const existing = document.getElementById("doochy-analytics");
  if (existing?.getAttribute("data-signature") === signature) return;
  removeAnalytics();

  const script = document.createElement("script");
  script.id = "doochy-analytics";
  script.async = true;
  script.defer = true;
  script.setAttribute("data-signature", signature);
  if (seo.analyticsProvider === "plausible") {
    script.src = seo.analyticsScriptUrl.trim() || "https://plausible.io/js/script.js";
    script.setAttribute("data-domain", seo.analyticsSiteId.trim());
  } else if (seo.analyticsProvider === "umami") {
    script.src = seo.analyticsScriptUrl.trim() || "https://analytics.umami.is/script.js";
    script.setAttribute("data-website-id", seo.analyticsSiteId.trim());
  } else {
    script.src =
      seo.analyticsScriptUrl.trim() ||
      `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
        seo.analyticsSiteId.trim()
      )}`;
    const inline = document.createElement("script");
    inline.id = "doochy-analytics-inline";
    inline.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(
      seo.analyticsSiteId.trim()
    )});`;
    document.head.appendChild(inline);
  }
  document.head.appendChild(script);
}

interface SiteConfigContextValue {
  config: SiteConfig | null;
  branding: BrandingSettings;
  seo: SeoSettings;
  content: ContentSettings;
  tradingDefaults: TradingDefaultsSettings;
  locale: LocaleSettings;
  social: SocialSettings;
  pwa: PwaSettings;
  demo: DemoSettings;
  /** The palette currently painted, after the visitor's mode preference. */
  theme: ThemeSettings;
  mode: ThemeMode;
  toggleMode: () => void;
  /** Re-apply the live theme, discarding an unsaved admin preview. */
  restoreTheme: () => void;
  refresh: () => Promise<void>;
  setConfig: (config: SiteConfig) => void;
}

const SiteConfigContext = createContext<SiteConfigContextValue | null>(null);

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<SiteConfig | null>(null);
  // Null means "follow the site default" until the visitor flips the switch.
  const [userMode, setUserMode] = useState<ThemeMode | null>(readStoredMode);

  const activeMode: ThemeMode = userMode ?? config?.theme.mode ?? FALLBACK_THEME.mode;
  const theme = useMemo(
    () => themeForMode(config?.theme ?? FALLBACK_THEME, activeMode),
    [config, activeMode]
  );
  const branding = config?.branding ?? FALLBACK_BRANDING;
  const seo = config?.seo ?? FALLBACK_SEO;
  const content = config?.content ?? FALLBACK_CONTENT;
  const tradingDefaults = config?.tradingDefaults ?? FALLBACK_TRADING_DEFAULTS;
  const locale = config?.locale ?? FALLBACK_LOCALE;
  const social = config?.social ?? FALLBACK_SOCIAL;
  const pwa = config?.pwa ?? FALLBACK_PWA;
  const demo = config?.demo ?? FALLBACK_DEMO;
  const [consent, setConsent] = useState(hasCookieConsent);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    setLocaleSettings(locale);
    setDefaultTimeOptions({
      timeZone: locale.timezone.trim() || undefined,
      locale: locale.locale.trim() || undefined,
      dateFormat: locale.dateFormat,
    });
  }, [locale]);

  useEffect(() => {
    applyBranding(branding, theme);
  }, [branding, theme]);

  useEffect(() => {
    const base =
      config?.seo.canonicalUrl.trim() ||
      config?.site.publicBaseUrl.trim() ||
      window.location.origin;
    applySeo(seo, branding, pwa, base);
  }, [seo, branding, pwa, config?.seo.canonicalUrl, config?.site.publicBaseUrl]);

  useEffect(() => {
    applyAnalytics(seo, consent);
    const onChange = () => setConsent(hasCookieConsent());
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [seo, consent]);

  const setConfig = useCallback((next: SiteConfig) => {
    setConfigState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setConfigState(await configApi.get());
    } catch {
      // Keep the compiled defaults; a config outage must not blank the site.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleMode = useCallback(() => {
    const next: ThemeMode = activeMode === "dark" ? "light" : "dark";
    setUserMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private browsing can reject storage; the toggle still works for this tab.
    }
  }, [activeMode]);

  const restoreTheme = useCallback(() => applyTheme(theme), [theme]);

  const value = useMemo<SiteConfigContextValue>(
    () => ({
      config,
      branding,
      seo,
      content,
      tradingDefaults,
      locale,
      social,
      pwa,
      demo,
      theme,
      mode: activeMode,
      toggleMode,
      restoreTheme,
      refresh,
      setConfig,
    }),
    [
      config,
      branding,
      seo,
      content,
      tradingDefaults,
      locale,
      social,
      pwa,
      demo,
      theme,
      activeMode,
      toggleMode,
      restoreTheme,
      refresh,
      setConfig,
    ]
  );

  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig(): SiteConfigContextValue {
  const value = useContext(SiteConfigContext);
  if (!value) throw new Error("useSiteConfig must be used inside SiteConfigProvider");
  return value;
}
