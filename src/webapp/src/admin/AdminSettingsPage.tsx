import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Palette, RotateCcw, Save, Type } from "lucide-react";

import {
  adminApi,
  type BrandingSettings,
  type SiteSettings,
  type ThemeMode,
  type ThemeSettings,
} from "../api";
import { FadeRise } from "../components/motion";
import { Button, Card, Flash, Skeleton, inputCls } from "../components/ui";
import type { ViewKey } from "../routing";
import { FALLBACK_THEME, applyTheme, useSiteConfig } from "../siteConfig";

const HEX = /^#[0-9a-fA-F]{6}$/;

const LIGHT_PRESET: ThemeSettings = {
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

type ColorKey = Exclude<keyof ThemeSettings, "mode">;

const COLOR_GROUPS: { title: string; fields: { key: ColorKey; label: string }[] }[] = [
  {
    title: "Accent",
    fields: [
      { key: "accent", label: "Accent" },
      { key: "accentHover", label: "Accent hover" },
      { key: "accentDeep", label: "Accent deep" },
      { key: "accentFg", label: "On accent" },
    ],
  },
  {
    title: "Surfaces",
    fields: [
      { key: "canvas", label: "Canvas" },
      { key: "canvasSoft", label: "Recessed" },
      { key: "surface", label: "Surface" },
      { key: "surfaceHover", label: "Surface hover" },
      { key: "surfaceActive", label: "Surface active" },
      { key: "borderStrong", label: "Strong border" },
    ],
  },
  {
    title: "Text & status",
    fields: [
      { key: "text", label: "Text" },
      { key: "success", label: "Success" },
      { key: "danger", label: "Danger" },
      { key: "strongSell", label: "Strong sell" },
      { key: "strongBuy", label: "Strong buy" },
      { key: "ratingNeutral", label: "Rating neutral" },
    ],
  },
];

const compactInput =
  "rounded-md border border-hairline-strong bg-canvas px-2 py-1 text-[11px] text-fg " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40";

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  textarea = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  textarea?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {textarea ? (
        <textarea
          className={`${inputCls} min-h-[88px] resize-y`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      ) : (
        <input
          className={inputCls}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      )}
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = HEX.test(value);
  return (
    <label className="flex items-center gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-1.5">
      <input
        type="color"
        value={valid ? value : "#000000"}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label} colour picker`}
        className="h-6 w-7 shrink-0 cursor-pointer rounded border border-hairline-strong bg-transparent p-0"
      />
      <span className="min-w-0 flex-1 text-xs text-fg-muted">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${label} hex value`}
        spellCheck={false}
        className={`${compactInput} w-[86px] font-mono`}
      />
    </label>
  );
}

export default function AdminSettingsPage({
  onNavigate,
}: {
  onNavigate: (view: ViewKey) => void;
}) {
  const { setConfig } = useSiteConfig();
  const [loaded, setLoaded] = useState<SiteSettings | null>(null);
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The last published theme, re-applied when the editor unmounts without a
  // save so a preview never leaks onto the rest of the app.
  const savedThemeRef = useRef<ThemeSettings | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi
      .settings()
      .then(({ settings }) => {
        if (!alive) return;
        setLoaded(settings);
        setBranding(settings.branding);
        setTheme(settings.theme);
        savedThemeRef.current = settings.theme;
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load site settings");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Live preview: every colour edit updates the CSS variables immediately.
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (savedThemeRef.current) applyTheme(savedThemeRef.current);
    };
  }, []);

  const invalidColors = useMemo<ColorKey[]>(() => {
    if (!theme) return [];
    return COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)).filter(
      (key) => !HEX.test(theme[key])
    );
  }, [theme]);

  const dirty = useMemo(() => {
    if (!loaded || !branding || !theme) return false;
    return (
      JSON.stringify(branding) !== JSON.stringify(loaded.branding) ||
      JSON.stringify(theme) !== JSON.stringify(loaded.theme)
    );
  }, [loaded, branding, theme]);

  function reset() {
    if (!loaded) return;
    setBranding(loaded.branding);
    setTheme(loaded.theme);
    applyTheme(loaded.theme);
    setSaved(false);
    setError(null);
  }

  async function save() {
    if (!branding || !theme) return;
    setError(null);
    setSaved(false);
    try {
      const { settings } = await adminApi.saveSettings({ branding, theme });
      setLoaded(settings);
      setBranding(settings.branding);
      setTheme(settings.theme);
      savedThemeRef.current = settings.theme;
      // Push the saved values into the provider so the header, title and
      // palette update without a reload.
      setConfig(settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save site settings");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!branding || !theme) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Flash tone="danger">{error ?? "Site settings are unavailable."}</Flash>
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => onNavigate("admin")}>
          Back to admin
        </Button>
      </div>
    );
  }

  const logoPreview = branding.logoUrl || "/doochy-mark-80.png";

  return (
    <FadeRise>
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => onNavigate("admin")}
              aria-label="Back to admin"
              title="Back to admin"
            />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-fg">Site settings</h1>
              <p className="text-sm text-fg-muted">
                Branding and theme for every visitor. Theme colours preview live; everything
                publishes on save.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={reset}
              disabled={!dirty}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save className="h-4 w-4" />}
              onClickAsync={save}
              disabled={!dirty || invalidColors.length > 0}
            >
              Save changes
            </Button>
          </div>
        </div>

        {error && <Flash tone="danger">{error}</Flash>}
        {saved && (
          <Flash tone="success">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4" /> Saved. Visitors see the new branding on their next load.
            </span>
          </Flash>
        )}
        {invalidColors.length > 0 && (
          <Flash tone="danger">
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> Use 6-digit hex colours for:{" "}
              {invalidColors.join(", ")}
            </span>
          </Flash>
        )}

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Branding</h2>
              <p className="text-xs text-fg-muted">
                Name, logo and the copy shown across the public pages.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-hairline bg-soft px-3 py-2">
            <img
              src={logoPreview}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">
                {branding.name || "Product name"}
              </div>
              <div className="truncate text-xs text-fg-muted">
                {branding.tagline || "Tagline"}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Product name"
              value={branding.name}
              onChange={(name) => setBranding({ ...branding, name })}
              placeholder="Doochy"
              maxLength={60}
            />
            <TextField
              label="Tagline"
              value={branding.tagline}
              onChange={(tagline) => setBranding({ ...branding, tagline })}
              placeholder="Market analysis & trading"
              maxLength={120}
            />
          </div>

          <TextField
            label="Description"
            value={branding.description}
            onChange={(description) => setBranding({ ...branding, description })}
            hint="Used as the hero paragraph and the page meta description."
            textarea
            maxLength={300}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Logo URL"
              value={branding.logoUrl}
              onChange={(logoUrl) => setBranding({ ...branding, logoUrl })}
              placeholder="/doochy-mark-80.png"
              hint="A path starting with / or an https URL. Empty uses the bundled mark."
              maxLength={500}
            />
            <TextField
              label="Footer text"
              value={branding.footerText}
              onChange={(footerText) => setBranding({ ...branding, footerText })}
              placeholder="Optional line under every page"
              maxLength={300}
            />
            <TextField
              label="Support email"
              value={branding.supportEmail}
              onChange={(supportEmail) => setBranding({ ...branding, supportEmail })}
              placeholder="support@example.com"
              maxLength={200}
            />
            <TextField
              label="Website"
              value={branding.websiteUrl}
              onChange={(websiteUrl) => setBranding({ ...branding, websiteUrl })}
              placeholder="https://example.com"
              maxLength={300}
            />
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Theme</h2>
              <p className="text-xs text-fg-muted">
                Colours map to the same semantic tokens the whole app already uses.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">Presets</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTheme({ ...FALLBACK_THEME })}
            >
              Doochy dark
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTheme({ ...LIGHT_PRESET })}>
              Light
            </Button>
            <label className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
              Mode
              <select
                className={`${compactInput} w-[92px]`}
                value={theme.mode}
                onChange={(event) =>
                  setTheme({ ...theme, mode: event.target.value as ThemeMode })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </div>

          {COLOR_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                {group.title}
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <ColorField
                    key={field.key}
                    label={field.label}
                    value={theme[field.key]}
                    onChange={(value) => setTheme({ ...theme, [field.key]: value })}
                  />
                ))}
              </div>
            </div>
          ))}
        </Card>

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Colours preview instantly in this browser. Saving publishes them to every visitor.
        </p>
      </div>
    </FadeRise>
  );
}
