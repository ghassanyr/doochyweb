import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Clock,
  FileText,
  Globe,
  Mail,
  Megaphone,
  Navigation,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Type,
  Upload,
  UserPlus,
  Webhook,
  Wrench,
} from "lucide-react";

import {
  adminApi,
  type AnalysisSettings,
  type AnnouncementSettings,
  type AnnouncementTone,
  type BrandingSettings,
  type ContentSettings,
  type DateFormat,
  type DemoSettings,
  type LandingKey,
  type LegalSettings,
  type LocaleSettings,
  type MaintenanceSettings,
  type ModuleAccess,
  type ModuleSettings,
  type NavigationSettings,
  type NumberFormat,
  type PwaSettings,
  type RegistrationMode,
  type RegistrationSettings,
  type SeoSettings,
  type SiteAddressSettings,
  type SiteSettings,
  type SocialSettings,
  type TemplateSettings,
  type ThemeSettings,
  type TradingDefaultsSettings,
  type WebhookSettings,
} from "../api";
import { FadeRise } from "../components/motion";
import { Button, Card, Flash, Skeleton, inputCls } from "../components/ui";
import type { ViewKey } from "../routing";
import {
  FALLBACK_THEME,
  LIGHT_THEME,
  applyTheme,
  brandMarkUrl,
  useSiteConfig,
} from "../siteConfig";

const HEX = /^#[0-9a-fA-F]{6}$/;

// Client-side guard mirrors the server limit; the image travels as a data URL
// inside the normal settings save, so no upload endpoint is needed.
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const MAX_LOGO_KB = 200;
const MAX_LOGO_BYTES = MAX_LOGO_KB * 1024;
const LOGO_URL_LIMIT = 350_000;

type ColorKey = Exclude<keyof ThemeSettings, "mode" | "font" | "density" | "radius">;

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

const ACCESS_OPTIONS: { value: ModuleAccess; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "signed-in", label: "Signed-in only" },
  { value: "admin", label: "Admins only" },
];

const LANDING_OPTIONS: { value: LandingKey; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "analysis", label: "Analysis" },
  { value: "signals", label: "Signals" },
];

const REGISTRATION_OPTIONS: { value: RegistrationMode; label: string }[] = [
  { value: "open", label: "Open registration" },
  { value: "approval", label: "Admin approval" },
  { value: "invite", label: "Invite code" },
  { value: "closed", label: "Closed" },
];

const TONE_OPTIONS: { value: AnnouncementTone; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "danger", label: "Danger" },
];

const ANALYTICS_OPTIONS = [
  { value: "none" as const, label: "Disabled" },
  { value: "plausible" as const, label: "Plausible" },
  { value: "umami" as const, label: "Umami" },
  { value: "google" as const, label: "Google Analytics" },
];

const FONT_OPTIONS = [
  { value: "inter" as const, label: "Inter (bundled)" },
  { value: "system" as const, label: "System UI" },
  { value: "serif" as const, label: "Serif" },
];

const DENSITY_OPTIONS = [
  { value: "compact" as const, label: "Compact" },
  { value: "comfortable" as const, label: "Comfortable" },
  { value: "spacious" as const, label: "Spacious" },
];

const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "locale", label: "Follow locale" },
  { value: "iso", label: "2026-11-15" },
  { value: "dmy", label: "15/11/2026" },
  { value: "mdy", label: "11/15/2026" },
];

const NUMBER_FORMAT_OPTIONS: { value: NumberFormat; label: string }[] = [
  { value: "locale", label: "Follow locale" },
  { value: "comma-dot", label: "1,234.56" },
  { value: "dot-comma", label: "1.234,56" },
];

const EMPTY_FIELD_OPTIONS: { key: keyof ContentSettings["emptyStates"]; label: string }[] = [
  { key: "analysis", label: "Analysis" },
  { key: "signals", label: "Signals" },
  { key: "breakouts", label: "Breakouts" },
  { key: "trading", label: "Trading" },
  { key: "alerts", label: "Alerts" },
  { key: "briefing", label: "Briefing" },
  { key: "coach", label: "Coach" },
];

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

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  suffix?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={inputCls}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix && <span className="text-xs text-fg-muted">{suffix}</span>}
      </div>
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

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs font-medium ${
        disabled ? "text-fg-faint" : "text-fg-muted"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <select
        className={inputCls}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO timestamp -> the local value a datetime-local input expects. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** datetime-local value -> ISO, or null when the field is empty. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export default function AdminSettingsPage({
  onNavigate,
}: {
  onNavigate: (view: ViewKey) => void;
}) {
  const { setConfig, restoreTheme } = useSiteConfig();
  const [loaded, setLoaded] = useState<SiteSettings | null>(null);
  const [site, setSite] = useState<SiteAddressSettings | null>(null);
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [navigation, setNavigation] = useState<NavigationSettings | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceSettings | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementSettings | null>(null);
  const [demo, setDemo] = useState<DemoSettings | null>(null);
  const [registration, setRegistration] = useState<RegistrationSettings | null>(null);
  const [legal, setLegal] = useState<LegalSettings | null>(null);
  const [seo, setSeo] = useState<SeoSettings | null>(null);
  const [content, setContent] = useState<ContentSettings | null>(null);
  const [tradingDefaults, setTradingDefaults] = useState<TradingDefaultsSettings | null>(null);
  const [locale, setLocale] = useState<LocaleSettings | null>(null);
  const [social, setSocial] = useState<SocialSettings | null>(null);
  const [pwa, setPwa] = useState<PwaSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateSettings | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookSettings | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [webhookTest, setWebhookTest] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  // Re-apply the live theme (including the visitor's mode preference) when the
  // editor unmounts without a save so a preview never leaks onto the app.
  const restoreThemeRef = useRef(restoreTheme);
  restoreThemeRef.current = restoreTheme;

  useEffect(() => {
    let alive = true;
    adminApi
      .settings()
      .then(({ settings }) => {
        if (!alive) return;
        setLoaded(settings);
        setSite(settings.site);
        setBranding(settings.branding);
        setTheme(settings.theme);
        setNavigation(settings.navigation);
        setMaintenance(settings.maintenance);
        setAnnouncement(settings.announcement);
        setDemo(settings.demo);
        setRegistration(settings.registration);
        setLegal(settings.legal);
        setSeo(settings.seo);
        setContent(settings.content);
        setTradingDefaults(settings.tradingDefaults);
        setLocale(settings.locale);
        setSocial(settings.social);
        setPwa(settings.pwa);
        setTemplates(settings.templates);
        setWebhooks(settings.webhooks);
        setAnalysis(settings.analysis);
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
      restoreThemeRef.current();
    };
  }, []);

  const invalidColors = useMemo<ColorKey[]>(() => {
    if (!theme) return [];
    return COLOR_GROUPS.flatMap((group) => group.fields.map((field) => field.key)).filter(
      (key) => !HEX.test(theme[key])
    );
  }, [theme]);

  const dirty = useMemo(() => {
    if (
      !loaded ||
      !site ||
      !branding ||
      !theme ||
      !navigation ||
      !maintenance ||
      !announcement ||
      !demo ||
      !registration ||
      !legal ||
      !seo ||
      !content ||
      !tradingDefaults ||
      !locale ||
      !social ||
      !pwa ||
      !templates ||
      !webhooks ||
      !analysis
    ) {
      return false;
    }
    return (
      JSON.stringify(site) !== JSON.stringify(loaded.site) ||
      JSON.stringify(branding) !== JSON.stringify(loaded.branding) ||
      JSON.stringify(theme) !== JSON.stringify(loaded.theme) ||
      JSON.stringify(navigation) !== JSON.stringify(loaded.navigation) ||
      JSON.stringify(maintenance) !== JSON.stringify(loaded.maintenance) ||
      JSON.stringify(announcement) !== JSON.stringify(loaded.announcement) ||
      JSON.stringify(demo) !== JSON.stringify(loaded.demo) ||
      JSON.stringify(registration) !== JSON.stringify(loaded.registration) ||
      JSON.stringify(legal) !== JSON.stringify(loaded.legal) ||
      JSON.stringify(seo) !== JSON.stringify(loaded.seo) ||
      JSON.stringify(content) !== JSON.stringify(loaded.content) ||
      JSON.stringify(tradingDefaults) !== JSON.stringify(loaded.tradingDefaults) ||
      JSON.stringify(locale) !== JSON.stringify(loaded.locale) ||
      JSON.stringify(social) !== JSON.stringify(loaded.social) ||
      JSON.stringify(pwa) !== JSON.stringify(loaded.pwa) ||
      JSON.stringify(templates) !== JSON.stringify(loaded.templates) ||
      JSON.stringify(webhooks) !== JSON.stringify(loaded.webhooks) ||
      JSON.stringify(analysis) !== JSON.stringify(loaded.analysis)
    );
  }, [
    loaded,
    site,
    branding,
    theme,
    navigation,
    maintenance,
    announcement,
    demo,
    registration,
    legal,
    seo,
    content,
    tradingDefaults,
    locale,
    social,
    pwa,
    templates,
    webhooks,
    analysis,
  ]);

  function reset() {
    if (!loaded) return;
    setSite(loaded.site);
    setBranding(loaded.branding);
    setTheme(loaded.theme);
    setNavigation(loaded.navigation);
    setMaintenance(loaded.maintenance);
    setAnnouncement(loaded.announcement);
    setDemo(loaded.demo);
    setRegistration(loaded.registration);
    setLegal(loaded.legal);
    setSeo(loaded.seo);
    setContent(loaded.content);
    setTradingDefaults(loaded.tradingDefaults);
    setLocale(loaded.locale);
    setSocial(loaded.social);
    setPwa(loaded.pwa);
    setTemplates(loaded.templates);
    setWebhooks(loaded.webhooks);
    setAnalysis(loaded.analysis);
    applyTheme(loaded.theme);
    setSaved(false);
    setError(null);
  }

  async function save() {
    if (
      !site ||
      !branding ||
      !theme ||
      !navigation ||
      !maintenance ||
      !announcement ||
      !demo ||
      !registration ||
      !legal ||
      !seo ||
      !content ||
      !tradingDefaults ||
      !locale ||
      !social ||
      !pwa ||
      !templates ||
      !webhooks ||
      !analysis
    ) {
      return;
    }
    setError(null);
    setSaved(false);
    try {
      const { settings } = await adminApi.saveSettings({
        site,
        branding,
        theme,
        navigation,
        maintenance,
        announcement,
        demo,
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
      });
      setLoaded(settings);
      setSite(settings.site);
      setBranding(settings.branding);
      setTheme(settings.theme);
      setNavigation(settings.navigation);
      setMaintenance(settings.maintenance);
      setAnnouncement(settings.announcement);
      setDemo(settings.demo);
      setRegistration(settings.registration);
      setLegal(settings.legal);
      setSeo(settings.seo);
      setContent(settings.content);
      setTradingDefaults(settings.tradingDefaults);
      setLocale(settings.locale);
      setSocial(settings.social);
      setPwa(settings.pwa);
      setTemplates(settings.templates);
      setWebhooks(settings.webhooks);
      setAnalysis(settings.analysis);
      // Push the saved values into the provider so the header, title and
      // palette update without a reload.
      setConfig({
        ...settings,
        registration: {
          mode: settings.registration.mode,
          message: settings.registration.message,
          inviteRequired: settings.registration.mode === "invite",
          requireEmailVerification: settings.registration.requireEmailVerification,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save site settings");
    }
  }

  // Read the picked image into a data URL and stash it in the logo field, so
  // the existing settings save publishes it like any other URL.
  function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setError("Logo must be a PNG, JPEG, WebP, GIF or SVG image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`Logo must be ${MAX_LOGO_KB} KB or smaller.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setBranding((current) => (current ? { ...current, logoUrl: reader.result as string } : current));
    };
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(file);
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

  if (
    !site ||
    !branding ||
    !theme ||
    !navigation ||
    !maintenance ||
    !announcement ||
    !demo ||
    !registration ||
    !legal ||
    !seo ||
    !content ||
    !tradingDefaults ||
    !locale ||
    !social ||
    !pwa ||
    !templates ||
    !webhooks ||
    !analysis
  ) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Flash tone="danger">{error ?? "Site settings are unavailable."}</Flash>
        <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => onNavigate("admin")}>
          Back to admin
        </Button>
      </div>
    );
  }

  const logoPreview = brandMarkUrl(branding, theme, 80);
  const logoIsUpload = branding.logoUrl.startsWith("data:");

  function updateModule(index: number, patch: Partial<ModuleSettings>) {
    setNavigation((current) => {
      if (!current) return current;
      return {
        ...current,
        modules: current.modules.map((module, i) =>
          i === index ? { ...module, ...patch } : module
        ),
      };
    });
  }

  function moveModule(index: number, delta: number) {
    setNavigation((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.modules.length) return current;
      const modules = [...current.modules];
      [modules[index], modules[target]] = [modules[target], modules[index]];
      return { ...current, modules };
    });
  }

  function updateGroup(index: number, patch: { label?: string }) {
    setNavigation((current) => {
      if (!current) return current;
      return {
        ...current,
        groups: current.groups.map((group, i) =>
          i === index ? { ...group, ...patch } : group
        ),
      };
    });
  }

  function moveGroup(index: number, delta: number) {
    setNavigation((current) => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.groups.length) return current;
      const groups = [...current.groups];
      [groups[index], groups[target]] = [groups[target], groups[index]];
      return { ...current, groups };
    });
  }

  function addGroup() {
    setNavigation((current) => {
      if (!current) return current;
      let suffix = current.groups.length + 1;
      while (current.groups.some((group) => group.key === `section-${suffix}`)) suffix += 1;
      return {
        ...current,
        groups: [...current.groups, { key: `section-${suffix}`, label: "New section" }],
      };
    });
  }

  function removeGroup(index: number) {
    setNavigation((current) => {
      if (!current || current.groups.length <= 1) return current;
      const removed = current.groups[index];
      const fallback = current.groups[index === 0 ? 1 : 0].key;
      return {
        ...current,
        groups: current.groups.filter((_, i) => i !== index),
        modules: current.modules.map((module) =>
          module.group === removed.key ? { ...module, group: fallback } : module
        ),
      };
    });
  }

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
                Branding, navigation and access for every visitor. Theme colours preview live;
                everything publishes on save.
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
            Saved. Visitors see the changes on their next load.
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
            <Globe className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Site address</h2>
              <p className="text-xs text-fg-muted">
                The public origin used in cTrader callbacks, Telegram links and shared URLs.
              </p>
            </div>
          </div>
          <TextField
            label="Public base URL"
            value={site.publicBaseUrl}
            onChange={(publicBaseUrl) => setSite({ ...site, publicBaseUrl })}
            placeholder="https://your-domain.com"
            hint="Origin only, with no path. Leave empty to use PUBLIC_BASE_URL or the current request origin."
            maxLength={300}
          />
          <p className="text-[11px] text-fg-faint">
            cTrader callback: <code>{site.publicBaseUrl || "https://your-domain.com"}/callback</code>
            {" "}or <code>{site.publicBaseUrl || "https://your-domain.com"}/api/ctrader/oauth/callback</code>
          </p>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Registration</h2>
              <p className="text-xs text-fg-muted">
                Decide who can create an account on this site.
              </p>
            </div>
          </div>
          <SelectField
            label="Registration policy"
            value={registration.mode}
            onChange={(mode) => setRegistration({ ...registration, mode })}
            options={REGISTRATION_OPTIONS}
            hint={
              registration.mode === "approval"
                ? "New accounts stay pending until an admin approves them under Users."
                : registration.mode === "invite"
                  ? "Visitors must enter the invite code below to register."
                  : registration.mode === "closed"
                    ? "The register form is disabled; admins can still create accounts."
                    : "Anyone with the site URL can create an account."
            }
          />
          {registration.mode === "invite" && (
            <TextField
              label="Invite code"
              value={registration.inviteCode}
              onChange={(inviteCode) => setRegistration({ ...registration, inviteCode })}
              placeholder="At least 6 characters"
              hint="Never shown publicly. Share it with the people you invite."
              maxLength={64}
            />
          )}
          <TextField
            label="Message"
            value={registration.message}
            onChange={(message) => setRegistration({ ...registration, message })}
            placeholder={
              registration.mode === "approval"
                ? "Account created. An admin must approve it before you can sign in."
                : "Registration is closed."
            }
            hint="Optional wording shown on the login/register screen or after submitting."
            textarea
            maxLength={500}
          />
          <Toggle
            checked={registration.requireEmailVerification}
            onChange={(requireEmailVerification) =>
              setRegistration({ ...registration, requireEmailVerification })
            }
            label="Require new users to verify their email"
          />
          <p className="text-[11px] text-fg-faint">
            Requires SMTP under Integrations. Existing accounts are treated as verified, so
            turning this on never locks them out.
          </p>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Legal and risk</h2>
              <p className="text-xs text-fg-muted">
                Links and copy shown in the public footer. Especially important for trading products.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Terms URL"
              value={legal.termsUrl}
              onChange={(termsUrl) => setLegal({ ...legal, termsUrl })}
              placeholder="Leave blank for the built-in /terms page"
              hint="Set this to replace the built-in Terms link and require acceptance at signup."
              maxLength={500}
            />
            <TextField
              label="Privacy URL"
              value={legal.privacyUrl}
              onChange={(privacyUrl) => setLegal({ ...legal, privacyUrl })}
              placeholder="Leave blank for the built-in /privacy page"
              hint="Set this to replace the built-in Privacy link and require acceptance at signup."
              maxLength={500}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-fg-faint">
            Footer links always include the built-in Legal, Terms, Privacy, Risk disclosure, and
            Cookie pages. Have the built-in templates reviewed for your jurisdiction before
            relying on them.
          </p>
          <TextField
            label="Risk disclaimer"
            value={legal.riskDisclaimer}
            onChange={(riskDisclaimer) => setLegal({ ...legal, riskDisclaimer })}
            placeholder="Trading involves risk. Past performance does not guarantee future results."
            hint="Shown in the footer and under the Trading tabs. Leave blank to use the built-in not-financial-advice notice on Trading."
            textarea
            maxLength={1000}
          />
        </Card>

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
              placeholder="Your product"
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
            <div className="space-y-2">
              <TextField
                label="Logo URL"
                value={logoIsUpload ? "" : branding.logoUrl}
                onChange={(logoUrl) => setBranding({ ...branding, logoUrl })}
                placeholder={logoIsUpload ? "Uploaded image" : "https://example.com/logo.png"}
                hint={
                  logoIsUpload
                    ? "Uploaded image in use. Paste a URL or upload another to replace it."
                    : "A path starting with /, an https URL, or an uploaded image. Empty uses a mark generated from the product name."
                }
                maxLength={LOGO_URL_LIMIT}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept={LOGO_TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    pickLogo(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Upload className="h-3.5 w-3.5" />}
                  onClick={() => logoInputRef.current?.click()}
                >
                  Upload logo
                </Button>
                {branding.logoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBranding({ ...branding, logoUrl: "" })}
                  >
                    Clear
                  </Button>
                )}
                <span className="text-[11px] text-fg-faint">
                  PNG, JPEG, WebP, GIF or SVG up to {MAX_LOGO_KB} KB.
                </span>
              </div>
            </div>
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
            <Search className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">SEO and analytics</h2>
              <p className="text-xs text-fg-muted">
                Search metadata, link previews and optional, consent-aware analytics.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Page title"
              value={seo.title}
              onChange={(title) => setSeo({ ...seo, title })}
              placeholder={branding.name || "Your product"}
              hint="Empty falls back to the product name."
              maxLength={120}
            />
            <TextField
              label="Canonical URL"
              value={seo.canonicalUrl}
              onChange={(canonicalUrl) => setSeo({ ...seo, canonicalUrl })}
              placeholder="https://example.com"
              hint="Empty uses the public base URL."
              maxLength={500}
            />
          </div>
          <TextField
            label="Meta description"
            value={seo.description}
            onChange={(description) => setSeo({ ...seo, description })}
            placeholder={branding.description || "A short description for search and social."}
            hint="Leave empty to reuse the branding description."
            textarea
            maxLength={300}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Social preview image"
              value={seo.ogImageUrl}
              onChange={(ogImageUrl) => setSeo({ ...seo, ogImageUrl })}
              placeholder="/doochy-mark-512.png"
              maxLength={500}
            />
            <TextField
              label="Keywords"
              value={seo.keywords}
              onChange={(keywords) => setSeo({ ...seo, keywords })}
              placeholder="market analysis, trading journal"
              hint="Comma-separated; a weak ranking hint in modern search."
              maxLength={300}
            />
          </div>
          <Toggle
            checked={seo.noindex}
            onChange={(noindex) => setSeo({ ...seo, noindex })}
            label="Hide this deployment from search engines"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Analytics provider"
              value={seo.analyticsProvider}
              onChange={(analyticsProvider) => setSeo({ ...seo, analyticsProvider })}
              options={ANALYTICS_OPTIONS}
            />
            <TextField
              label="Site id or measurement id"
              value={seo.analyticsSiteId}
              onChange={(analyticsSiteId) => setSeo({ ...seo, analyticsSiteId })}
              placeholder="example.com or G-XXXXXXX"
              hint="Required when analytics is enabled."
              maxLength={200}
            />
          </div>
          {seo.analyticsProvider !== "none" && (
            <>
              <TextField
                label="Script URL (optional)"
                value={seo.analyticsScriptUrl}
                onChange={(analyticsScriptUrl) => setSeo({ ...seo, analyticsScriptUrl })}
                placeholder="Provider default"
                hint="Use a self-hosted or custom analytics script."
                maxLength={500}
              />
              <Toggle
                checked={seo.analyticsRequireConsent}
                onChange={(analyticsRequireConsent) =>
                  setSeo({ ...seo, analyticsRequireConsent })
                }
                label="Load analytics only after the cookie notice is accepted"
              />
            </>
          )}
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Content</h2>
              <p className="text-xs text-fg-muted">
                Hero, feature and login copy, plus the message shown in empty lists.
              </p>
            </div>
          </div>
          <TextField
            label="Hero title"
            value={content.heroTitle}
            onChange={(heroTitle) => setContent({ ...content, heroTitle })}
            hint="Line breaks are preserved on the home page."
            textarea
            maxLength={300}
          />
          <TextField
            label="Hero supporting copy"
            value={content.heroBody}
            onChange={(heroBody) => setContent({ ...content, heroBody })}
            placeholder={branding.description}
            hint="Empty falls back to the branding description."
            textarea
            maxLength={1000}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Features title"
              value={content.featuresTitle}
              onChange={(featuresTitle) => setContent({ ...content, featuresTitle })}
              placeholder="Everything in one workspace"
              maxLength={120}
            />
            <TextField
              label="Features copy"
              value={content.featuresBody}
              onChange={(featuresBody) => setContent({ ...content, featuresBody })}
              maxLength={500}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Login intro"
              value={content.loginIntro}
              onChange={(loginIntro) => setContent({ ...content, loginIntro })}
              placeholder="Welcome back."
              textarea
              maxLength={500}
            />
            <TextField
              label="Register intro"
              value={content.registerIntro}
              onChange={(registerIntro) => setContent({ ...content, registerIntro })}
              placeholder="Create your account."
              textarea
              maxLength={500}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {EMPTY_FIELD_OPTIONS.map((field) => (
              <TextField
                key={field.key}
                label={`${field.label} empty state`}
                value={content.emptyStates[field.key]}
                onChange={(value) =>
                  setContent({
                    ...content,
                    emptyStates: { ...content.emptyStates, [field.key]: value },
                  })
                }
                maxLength={300}
              />
            ))}
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                Defaults, locale and formats
              </h2>
              <p className="text-xs text-fg-muted">
                Starting values for tickets and signals, plus how dates, numbers and money are
                shown.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Default order type"
              value={tradingDefaults.defaultOrderType}
              onChange={(defaultOrderType) =>
                setTradingDefaults({ ...tradingDefaults, defaultOrderType })
              }
              options={[
                { value: "MARKET", label: "Market" },
                { value: "LIMIT", label: "Limit" },
              ]}
            />
            <NumberField
              label="Suggested risk per trade"
              value={tradingDefaults.defaultRiskPercent}
              onChange={(defaultRiskPercent) =>
                setTradingDefaults({ ...tradingDefaults, defaultRiskPercent })
              }
              min={0}
              max={100}
              step={0.1}
              suffix="%"
            />
            <NumberField
              label="Signal expiry"
              value={tradingDefaults.signalExpiryHours}
              onChange={(signalExpiryHours) =>
                setTradingDefaults({ ...tradingDefaults, signalExpiryHours })
              }
              min={0}
              max={720}
              suffix="hours"
              hint="0 means signals never expire."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Locale"
              value={locale.locale}
              onChange={(value) => setLocale({ ...locale, locale: value })}
              placeholder="en-GB"
              hint="Empty follows each browser."
              maxLength={35}
            />
            <TextField
              label="Timezone"
              value={locale.timezone}
              onChange={(timezone) => setLocale({ ...locale, timezone })}
              placeholder="Europe/London"
              hint="IANA zone. Empty follows each browser."
              maxLength={80}
            />
            <TextField
              label="Currency"
              value={locale.currency}
              onChange={(currency) => setLocale({ ...locale, currency })}
              placeholder="USD"
              hint="Three-letter ISO code used for display defaults."
              maxLength={3}
            />
            <SelectField
              label="Date format"
              value={locale.dateFormat}
              onChange={(dateFormat) => setLocale({ ...locale, dateFormat })}
              options={DATE_FORMAT_OPTIONS}
            />
            <SelectField
              label="Number format"
              value={locale.numberFormat}
              onChange={(numberFormat) => setLocale({ ...locale, numberFormat })}
              options={NUMBER_FORMAT_OPTIONS}
            />
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Analysis</h2>
              <p className="text-xs text-fg-muted">
                Limits for the market analysis page. The site watchlist is managed under Admin.
              </p>
            </div>
          </div>
          <NumberField
            label="Personal watchlist limit"
            value={analysis.watchlistLimit}
            onChange={(watchlistLimit) => setAnalysis({ ...analysis, watchlistLimit })}
            min={1}
            max={60}
            suffix="markets"
            hint="Signed-in members can keep this many symbols in their own watchlist. The site list is separate."
          />
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Social links</h2>
              <p className="text-xs text-fg-muted">
                Optional links shown in the footer. Leave a field empty to hide it.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["x", "telegram", "discord", "youtube", "linkedin", "github"] as const).map(
              (key) => (
                <TextField
                  key={key}
                  label={key === "x" ? "X / Twitter" : key[0].toUpperCase() + key.slice(1)}
                  value={social[key]}
                  onChange={(value) => setSocial({ ...social, [key]: value })}
                  placeholder={`https://${key}.com/...`}
                  maxLength={500}
                />
              )
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Installable app</h2>
              <p className="text-xs text-fg-muted">
                Web app manifest details for adding the site to a home screen.
              </p>
            </div>
          </div>
          <Toggle
            checked={pwa.enabled}
            onChange={(enabled) => setPwa({ ...pwa, enabled })}
            label="Offer an installable web app manifest"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Short name"
              value={pwa.shortName}
              onChange={(shortName) => setPwa({ ...pwa, shortName })}
              placeholder={branding.name || "Doochy"}
              hint="Shown under the home-screen icon."
              maxLength={30}
            />
            <SelectField
              label="Display"
              value={pwa.display}
              onChange={(display) => setPwa({ ...pwa, display })}
              options={[
                { value: "standalone", label: "Standalone window" },
                { value: "browser", label: "Browser tab" },
              ]}
            />
            <TextField
              label="Theme colour"
              value={pwa.themeColor}
              onChange={(themeColor) => setPwa({ ...pwa, themeColor })}
              placeholder="#0a0e14"
              hint="Six-digit hex."
              maxLength={7}
            />
            <TextField
              label="Background colour"
              value={pwa.backgroundColor}
              onChange={(backgroundColor) => setPwa({ ...pwa, backgroundColor })}
              placeholder="#0a0e14"
              hint="Six-digit hex."
              maxLength={7}
            />
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">
                Email and Telegram templates
              </h2>
              <p className="text-xs text-fg-muted">
                Variables: {"{{brand}}"}, {"{{username}}"}, {"{{url}}"}, {"{{expiresMinutes}}"},{" "}
                {"{{symbol}}"}, {"{{direction}}"}, {"{{entry}}"}, {"{{target}}"}, {"{{stop}}"},{" "}
                {"{{condition}}"}, {"{{level}}"} and {"{{price}}"}.
              </p>
            </div>
          </div>
          {(
            [
              ["passwordReset", "Password reset"],
              ["verifyEmail", "Email verification"],
              ["adminInvite", "Admin invite"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-2 rounded-lg border border-hairline bg-soft p-3">
              <h3 className="text-xs font-semibold text-fg">{label}</h3>
              <TextField
                label="Subject"
                value={templates.email[key].subject}
                onChange={(subject) =>
                  setTemplates({
                    ...templates,
                    email: {
                      ...templates.email,
                      [key]: { ...templates.email[key], subject },
                    },
                  })
                }
                maxLength={200}
              />
              <TextField
                label="Body"
                value={templates.email[key].body}
                onChange={(body) =>
                  setTemplates({
                    ...templates,
                    email: {
                      ...templates.email,
                      [key]: { ...templates.email[key], body },
                    },
                  })
                }
                textarea
                maxLength={5000}
              />
            </div>
          ))}
          {(
            [
              ["signalPublished", "Published signal"],
              ["alertTriggered", "Triggered alert"],
              ["test", "Test message"],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={`Telegram: ${label}`}
              value={templates.telegram[key]}
              onChange={(value) =>
                setTemplates({ ...templates, telegram: { ...templates.telegram, [key]: value } })
              }
              textarea
              maxLength={2000}
            />
          ))}
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Webhooks</h2>
              <p className="text-xs text-fg-muted">
                Signed JSON events for published signals and triggered alerts. The secret is never
                exposed publicly.
              </p>
            </div>
          </div>
          <Toggle
            checked={webhooks.enabled}
            onChange={(enabled) => setWebhooks({ ...webhooks, enabled })}
            label="Send outbound webhooks"
          />
          <TextField
            label="Endpoint URL"
            value={webhooks.url}
            onChange={(url) => setWebhooks({ ...webhooks, url })}
            placeholder="https://example.com/hooks/doochy"
            hint="Required when enabled. Requests are signed with X-Doochy-Signature."
            maxLength={500}
          />
          <TextField
            label="Signing secret"
            value={webhooks.secret}
            onChange={(secret) => setWebhooks({ ...webhooks, secret })}
            placeholder="Long random string"
            hint="Used as the HMAC SHA-256 key. Leave empty to send unsigned requests."
            maxLength={200}
          />
          <div className="flex flex-wrap gap-4">
            <Toggle
              checked={webhooks.signalPublished}
              onChange={(signalPublished) => setWebhooks({ ...webhooks, signalPublished })}
              label="Signal published"
            />
            <Toggle
              checked={webhooks.alertTriggered}
              onChange={(alertTriggered) => setWebhooks({ ...webhooks, alertTriggered })}
              label="Alert triggered"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClickAsync={async () => {
                setWebhookTest(null);
                try {
                  await adminApi.testWebhook();
                  setWebhookTest("Test webhook delivered.");
                } catch (err) {
                  setWebhookTest(
                    err instanceof Error ? err.message : "Webhook test failed"
                  );
                }
              }}
              disabled={!webhooks.enabled || !webhooks.url.trim()}
            >
              Send test webhook
            </Button>
            <span className="text-[11px] text-fg-faint">
              Uses the saved configuration. Save changes first.
            </span>
          </div>
          {webhookTest && (
            <Flash tone={webhookTest === "Test webhook delivered." ? "success" : "danger"}>
              {webhookTest}
            </Flash>
          )}
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Theme</h2>
              <p className="text-xs text-fg-muted">
                Colours map to the same semantic tokens the whole app already uses. This palette
                is the site default; visitors can flip dark/light from the header.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              label="Font"
              value={theme.font}
              onChange={(font) => setTheme({ ...theme, font })}
              options={FONT_OPTIONS}
            />
            <SelectField
              label="Density"
              value={theme.density}
              onChange={(density) => setTheme({ ...theme, density })}
              options={DENSITY_OPTIONS}
            />
            <NumberField
              label="Corner radius"
              value={theme.radius}
              onChange={(radius) => setTheme({ ...theme, radius })}
              min={0}
              max={24}
              suffix="px"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">Presets</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTheme({ ...FALLBACK_THEME })}
            >
              {branding.name || "Default"} dark
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTheme({ ...LIGHT_THEME })}>
              Light
            </Button>
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

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Navigation</h2>
              <p className="text-xs text-fg-muted">
                Group, rename, reorder and hide tabs. Hidden tabs stay reachable by direct link.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Sections
              </h3>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={addGroup}
              >
                Add section
              </Button>
            </div>
            {navigation.groups.map((group, index) => (
              <div
                key={group.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-2"
              >
                <span className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wide text-fg-faint">
                  {group.key}
                </span>
                <input
                  value={group.label}
                  onChange={(event) => updateGroup(index, { label: event.target.value })}
                  maxLength={24}
                  aria-label={`${group.key} section label`}
                  className={`${compactInput} min-w-[120px] flex-1`}
                />
                <div className="flex items-center gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveGroup(index, -1)}
                    aria-label={`Move ${group.label} section up`}
                    title="Move up"
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === navigation.groups.length - 1}
                    onClick={() => moveGroup(index, 1)}
                    aria-label={`Move ${group.label} section down`}
                    title="Move down"
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={navigation.groups.length <= 1}
                    onClick={() => removeGroup(index)}
                    aria-label={`Remove ${group.label} section`}
                    title={
                      navigation.groups.length <= 1
                        ? "Keep at least one section"
                        : "Remove section"
                    }
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-fg-faint">
              Removing a section moves its tabs into the first remaining section.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
              Tabs
            </h3>
            {navigation.modules.map((module, index) => (
              <div
                key={module.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-soft px-2.5 py-2"
              >
                <span className="w-[74px] shrink-0 font-mono text-[10px] uppercase tracking-wide text-fg-faint">
                  {module.key}
                </span>
                <input
                  value={module.label}
                  onChange={(event) => updateModule(index, { label: event.target.value })}
                  maxLength={32}
                  aria-label={`${module.key} tab label`}
                  className={`${compactInput} min-w-[120px] flex-1`}
                />
                <select
                  value={module.access}
                  disabled={module.key === "trading"}
                  onChange={(event) =>
                    updateModule(index, { access: event.target.value as ModuleAccess })
                  }
                  aria-label={`${module.key} access`}
                  className={`${compactInput} w-[128px]`}
                >
                  {ACCESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={module.group}
                  onChange={(event) => updateModule(index, { group: event.target.value })}
                  aria-label={`${module.key} section`}
                  className={`${compactInput} w-[128px]`}
                >
                  {navigation.groups.map((group) => (
                    <option key={group.key} value={group.key}>
                      {group.label}
                    </option>
                  ))}
                </select>
                <Toggle
                  checked={!module.hidden}
                  onChange={(visible) => updateModule(index, { hidden: !visible })}
                  label="Show"
                />
                <div className="flex items-center gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveModule(index, -1)}
                    aria-label={`Move ${module.label} up`}
                    title="Move up"
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === navigation.modules.length - 1}
                    onClick={() => moveModule(index, 1)}
                    aria-label={`Move ${module.label} down`}
                    title="Move down"
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Landing page: signed in"
              value={navigation.landing.signedIn}
              onChange={(signedIn) =>
                setNavigation({
                  ...navigation,
                  landing: { ...navigation.landing, signedIn },
                })
              }
              options={LANDING_OPTIONS}
              hint="Applied when a signed-in visitor opens the site root."
            />
            <SelectField
              label="Landing page: signed out"
              value={navigation.landing.signedOut}
              onChange={(signedOut) =>
                setNavigation({
                  ...navigation,
                  landing: { ...navigation.landing, signedOut },
                })
              }
              options={LANDING_OPTIONS}
              hint="Home remains reachable from the header."
            />
          </div>
          <p className="text-[11px] text-fg-faint">
            Trading is always signed-in only because it shows broker accounts.
          </p>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Demo access</h2>
              <p className="text-xs text-fg-muted">
                Offer a shared read-only session from sign-in and navigation.
              </p>
            </div>
          </div>
          <Toggle
            checked={demo.enabled}
            onChange={(enabled) => setDemo({ ...demo, enabled })}
            label="Enable demo mode"
          />
          <TextField
            label="Entry label"
            value={demo.label}
            onChange={(label) => setDemo({ ...demo, label })}
            placeholder="Explore sample account"
            hint="Shown on the sign-in button and demo banner."
            maxLength={40}
          />
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Maintenance</h2>
              <p className="text-xs text-fg-muted">
                Show a maintenance notice instead of the public site.
              </p>
            </div>
          </div>

          <Toggle
            checked={maintenance.enabled}
            onChange={(enabled) => setMaintenance({ ...maintenance, enabled })}
            label="Enable maintenance mode"
          />
          <TextField
            label="Message"
            value={maintenance.message}
            onChange={(message) => setMaintenance({ ...maintenance, message })}
            placeholder="We're making some improvements. Please check back soon."
            hint="Shown to visitors while maintenance is on."
            textarea
            maxLength={500}
          />
          <Toggle
            checked={maintenance.allowAdmins}
            onChange={(allowAdmins) => setMaintenance({ ...maintenance, allowAdmins })}
            label="Allow signed-in admins to bypass maintenance"
          />
          {maintenance.enabled && !maintenance.allowAdmins && (
            <Flash tone="danger">
              With this off, nobody can sign in to turn maintenance back off. You would need to
              edit the database directly.
            </Flash>
          )}
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Announcement</h2>
              <p className="text-xs text-fg-muted">
                A dismissible banner under the header, optionally scheduled.
              </p>
            </div>
          </div>

          <Toggle
            checked={announcement.enabled}
            onChange={(enabled) => setAnnouncement({ ...announcement, enabled })}
            label="Show the announcement banner"
          />
          <TextField
            label="Message"
            value={announcement.text}
            onChange={(text) => setAnnouncement({ ...announcement, text })}
            placeholder="New signals are live this week."
            textarea
            maxLength={300}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Tone"
              value={announcement.tone}
              onChange={(tone) => setAnnouncement({ ...announcement, tone })}
              options={TONE_OPTIONS}
            />
            <TextField
              label="Link label"
              value={announcement.linkLabel}
              onChange={(linkLabel) => setAnnouncement({ ...announcement, linkLabel })}
              placeholder="Learn more"
              hint="Shown only when a link URL is set."
              maxLength={40}
            />
          </div>

          <TextField
            label="Link URL"
            value={announcement.linkUrl}
            onChange={(linkUrl) => setAnnouncement({ ...announcement, linkUrl })}
            placeholder="https://example.com or /signals"
            hint="Leave empty for a text-only banner."
            maxLength={500}
          />

          <Toggle
            checked={announcement.dismissible}
            onChange={(dismissible) => setAnnouncement({ ...announcement, dismissible })}
            label="Visitors can dismiss it"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-muted">Starts at</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={isoToLocalInput(announcement.startsAt)}
                onChange={(event) =>
                  setAnnouncement({
                    ...announcement,
                    startsAt: localInputToIso(event.target.value),
                  })
                }
              />
              <span className="block text-[11px] text-fg-faint">Empty means immediately.</span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-muted">Ends at</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={isoToLocalInput(announcement.endsAt)}
                onChange={(event) =>
                  setAnnouncement({
                    ...announcement,
                    endsAt: localInputToIso(event.target.value),
                  })
                }
              />
              <span className="block text-[11px] text-fg-faint">Empty means no end date.</span>
            </label>
          </div>
        </Card>

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Colours preview instantly in this browser. Saving publishes them to every visitor.
        </p>
      </div>
    </FadeRise>
  );
}
