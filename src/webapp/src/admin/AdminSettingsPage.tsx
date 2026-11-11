import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Megaphone,
  Navigation,
  Palette,
  RotateCcw,
  Save,
  Type,
  Upload,
  Wrench,
} from "lucide-react";

import {
  adminApi,
  type AnnouncementSettings,
  type AnnouncementTone,
  type BrandingSettings,
  type LandingKey,
  type MaintenanceSettings,
  type ModuleAccess,
  type ModuleSettings,
  type NavigationSettings,
  type SiteSettings,
  type ThemeSettings,
} from "../api";
import { FadeRise } from "../components/motion";
import { Button, Card, Flash, Skeleton, inputCls } from "../components/ui";
import type { ViewKey } from "../routing";
import { FALLBACK_THEME, LIGHT_THEME, applyTheme, useSiteConfig } from "../siteConfig";

const HEX = /^#[0-9a-fA-F]{6}$/;

// Client-side guard mirrors the server limit; the image travels as a data URL
// inside the normal settings save, so no upload endpoint is needed.
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const MAX_LOGO_KB = 200;
const MAX_LOGO_BYTES = MAX_LOGO_KB * 1024;
const LOGO_URL_LIMIT = 350_000;

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

const ACCESS_OPTIONS: { value: ModuleAccess; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "signed-in", label: "Signed-in only" },
];

const LANDING_OPTIONS: { value: LandingKey; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "analysis", label: "Analysis" },
  { value: "signals", label: "Signals" },
];

const TONE_OPTIONS: { value: AnnouncementTone; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "danger", label: "Danger" },
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
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);
  const [navigation, setNavigation] = useState<NavigationSettings | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceSettings | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
        setBranding(settings.branding);
        setTheme(settings.theme);
        setNavigation(settings.navigation);
        setMaintenance(settings.maintenance);
        setAnnouncement(settings.announcement);
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
    if (!loaded || !branding || !theme || !navigation || !maintenance || !announcement) {
      return false;
    }
    return (
      JSON.stringify(branding) !== JSON.stringify(loaded.branding) ||
      JSON.stringify(theme) !== JSON.stringify(loaded.theme) ||
      JSON.stringify(navigation) !== JSON.stringify(loaded.navigation) ||
      JSON.stringify(maintenance) !== JSON.stringify(loaded.maintenance) ||
      JSON.stringify(announcement) !== JSON.stringify(loaded.announcement)
    );
  }, [loaded, branding, theme, navigation, maintenance, announcement]);

  function reset() {
    if (!loaded) return;
    setBranding(loaded.branding);
    setTheme(loaded.theme);
    setNavigation(loaded.navigation);
    setMaintenance(loaded.maintenance);
    setAnnouncement(loaded.announcement);
    applyTheme(loaded.theme);
    setSaved(false);
    setError(null);
  }

  async function save() {
    if (!branding || !theme || !navigation || !maintenance || !announcement) return;
    setError(null);
    setSaved(false);
    try {
      const { settings } = await adminApi.saveSettings({
        branding,
        theme,
        navigation,
        maintenance,
        announcement,
      });
      setLoaded(settings);
      setBranding(settings.branding);
      setTheme(settings.theme);
      setNavigation(settings.navigation);
      setMaintenance(settings.maintenance);
      setAnnouncement(settings.announcement);
      // Push the saved values into the provider so the header, title and
      // palette update without a reload.
      setConfig(settings);
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

  if (!branding || !theme || !navigation || !maintenance || !announcement) {
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
            <div className="space-y-2">
              <TextField
                label="Logo URL"
                value={logoIsUpload ? "" : branding.logoUrl}
                onChange={(logoUrl) => setBranding({ ...branding, logoUrl })}
                placeholder={logoIsUpload ? "Uploaded image" : "/doochy-mark-80.png"}
                hint={
                  logoIsUpload
                    ? "Uploaded image in use. Paste a URL or upload another to replace it."
                    : "A path starting with /, an https URL, or an uploaded image. Empty uses the bundled mark."
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
            <Palette className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-fg">Theme</h2>
              <p className="text-xs text-fg-muted">
                Colours map to the same semantic tokens the whole app already uses. This palette
                is the site default; visitors can flip dark/light from the header.
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
                Rename, reorder and hide tabs. Hidden tabs stay reachable by direct link.
              </p>
            </div>
          </div>

          <div className="space-y-2">
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
              label="Landing page — signed in"
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
              label="Landing page — signed out"
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
