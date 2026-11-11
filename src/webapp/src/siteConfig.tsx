// Runtime site presentation.
//
// The server stores branding and theme in Mongo; this provider fetches the
// public subset once at boot and translates the colour tokens into the CSS
// variables every component already uses. Saving from the admin page pushes the
// new values straight into the same provider, so the header and palette update
// without a reload.

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
  type BrandingSettings,
  type SiteConfig,
  type ThemeSettings,
} from "./api";

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

function applyBranding(branding: BrandingSettings): void {
  if (typeof document === "undefined") return;
  document.title = branding.name || FALLBACK_BRANDING.name;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && branding.description) meta.setAttribute("content", branding.description);
}

export function applySiteConfig(config: SiteConfig): void {
  applyTheme(config.theme);
  applyBranding(config.branding);
}

interface SiteConfigContextValue {
  config: SiteConfig | null;
  branding: BrandingSettings;
  refresh: () => Promise<void>;
  setConfig: (config: SiteConfig) => void;
}

const SiteConfigContext = createContext<SiteConfigContextValue | null>(null);

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<SiteConfig | null>(null);

  const setConfig = useCallback((next: SiteConfig) => {
    setConfigState(next);
    applySiteConfig(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await configApi.get();
      setConfig(next);
    } catch {
      // Keep the compiled defaults; a config outage must not blank the site.
    }
  }, [setConfig]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SiteConfigContextValue>(
    () => ({
      config,
      branding: config?.branding ?? FALLBACK_BRANDING,
      refresh,
      setConfig,
    }),
    [config, refresh, setConfig]
  );

  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig(): SiteConfigContextValue {
  const value = useContext(SiteConfigContext);
  if (!value) throw new Error("useSiteConfig must be used inside SiteConfigProvider");
  return value;
}
