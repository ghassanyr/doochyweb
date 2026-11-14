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
  type MaintenanceSettings,
  type LegalSettings,
  type ModuleSettings,
  type NavigationSettings,
  type PublicRegistrationSettings,
  type SiteAddressSettings,
  type SiteConfig,
  type ThemeMode,
  type ThemeSettings,
} from "./api";
import { monogramDataUrl } from "./brandMark";

export const FALLBACK_SITE: SiteAddressSettings = {
  publicBaseUrl: "",
};

export const FALLBACK_REGISTRATION: PublicRegistrationSettings = {
  mode: "open",
  message: "",
  inviteRequired: false,
  requireEmailVerification: false,
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
export const FALLBACK_MODULES: ModuleSettings[] = [
  { key: "analysis", label: "Analysis", hidden: false, access: "public" },
  { key: "signals", label: "Signals", hidden: false, access: "public" },
  { key: "breakouts", label: "Breakouts", hidden: false, access: "public" },
  { key: "learn", label: "Learn", hidden: false, access: "public" },
  { key: "trading", label: "Trading", hidden: false, access: "signed-in" },
];

export const FALLBACK_NAVIGATION: NavigationSettings = {
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

type ColorKey = Exclude<keyof ThemeSettings, "mode">;

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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && hexToRgbTriplet(theme.canvas)) meta.setAttribute("content", theme.canvas);
}

function setMeta(selector: string, content: string): void {
  const meta = document.querySelector(selector);
  if (meta) meta.setAttribute("content", content);
}

function applyBranding(branding: BrandingSettings, theme: ThemeSettings): void {
  if (typeof document === "undefined") return;
  const name = branding.name.trim() || FALLBACK_BRANDING.name;
  const description = branding.description.trim() || FALLBACK_BRANDING.description;
  document.title = name;
  setMeta('meta[name="description"]', description);
  setMeta('meta[name="application-name"]', name);
  setMeta('meta[name="apple-mobile-web-app-title"]', name);
  setMeta('meta[property="og:title"]', name);
  setMeta('meta[property="og:site_name"]', name);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[name="twitter:title"]', name);
  setMeta('meta[name="twitter:description"]', description);

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

interface SiteConfigContextValue {
  config: SiteConfig | null;
  branding: BrandingSettings;
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

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyBranding(branding, theme);
  }, [branding, theme]);

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
      theme,
      mode: activeMode,
      toggleMode,
      restoreTheme,
      refresh,
      setConfig,
    }),
    [config, branding, theme, activeMode, toggleMode, restoreTheme, refresh, setConfig]
  );

  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig(): SiteConfigContextValue {
  const value = useContext(SiteConfigContext);
  if (!value) throw new Error("useSiteConfig must be used inside SiteConfigProvider");
  return value;
}
