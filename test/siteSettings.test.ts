import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_BRANDING,
  DEFAULT_MAINTENANCE,
  DEFAULT_NAVIGATION,
  DEFAULT_THEME,
} from "../src/server/settings/defaults";
import { mergeSiteSettings, publicSiteConfig } from "../src/server/settings/store";
import {
  SettingsValidationError,
  normalizeAnnouncement,
  normalizeBranding,
  normalizeMaintenance,
  normalizeNavigation,
  normalizeTheme,
} from "../src/server/settings/validate";

// The settings document is a singleton merged over compiled defaults, so these
// tests cover the merge and validation without needing a live database.

describe("site settings defaults", () => {
  test("a missing document returns the compiled defaults", () => {
    const settings = mergeSiteSettings(null);
    assert.deepEqual(settings.branding, DEFAULT_BRANDING);
    assert.deepEqual(settings.theme, DEFAULT_THEME);
    assert.deepEqual(settings.navigation, DEFAULT_NAVIGATION);
    assert.deepEqual(settings.maintenance, DEFAULT_MAINTENANCE);
    assert.deepEqual(settings.announcement, DEFAULT_ANNOUNCEMENT);
    assert.equal(settings.version, null);
    assert.equal(settings.updatedAt, null);
    assert.equal(settings.updatedBy, null);
  });

  test("stored values override defaults and new fields still appear", () => {
    const settings = mergeSiteSettings({
      branding: { name: "Acme" },
      theme: { accent: "#ff0000" },
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      updatedBy: "alice",
    });

    assert.equal(settings.branding.name, "Acme");
    assert.equal(settings.branding.tagline, DEFAULT_BRANDING.tagline);
    assert.equal(settings.theme.accent, "#ff0000");
    assert.equal(settings.theme.canvas, DEFAULT_THEME.canvas);
    assert.equal(settings.version, "2026-01-02T03:04:05.000Z");
    assert.equal(settings.updatedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(settings.updatedBy, "alice");
  });

  test("the public config omits audit fields", () => {
    const settings = mergeSiteSettings({
      updatedAt: new Date("2026-01-02T03:04:05.000Z"),
      updatedBy: "alice",
    });
    const config = publicSiteConfig(settings);
    assert.deepEqual(Object.keys(config).sort(), [
      "announcement",
      "branding",
      "maintenance",
      "navigation",
      "theme",
      "version",
    ]);
    assert.equal("updatedBy" in config, false);
  });
});

describe("normalizeBranding", () => {
  test("trims strings and keeps unspecified fields", () => {
    const branding = normalizeBranding({ name: "  Acme  ", tagline: "  Trade  " }, DEFAULT_BRANDING);
    assert.equal(branding.name, "Acme");
    assert.equal(branding.tagline, "Trade");
    assert.equal(branding.description, DEFAULT_BRANDING.description);
    assert.equal(branding.logoUrl, DEFAULT_BRANDING.logoUrl);
  });

  test("rejects an empty name", () => {
    assert.throws(() => normalizeBranding({ name: "   " }, DEFAULT_BRANDING), SettingsValidationError);
  });

  test("rejects a non-string name", () => {
    assert.throws(() => normalizeBranding({ name: 42 }, DEFAULT_BRANDING), SettingsValidationError);
  });

  test("accepts a relative logo path", () => {
    assert.equal(normalizeBranding({ logoUrl: "/logo.png" }, DEFAULT_BRANDING).logoUrl, "/logo.png");
  });

  test("accepts an https logo", () => {
    assert.equal(
      normalizeBranding({ logoUrl: "https://cdn.example.com/logo.png" }, DEFAULT_BRANDING).logoUrl,
      "https://cdn.example.com/logo.png"
    );
  });

  test("accepts an uploaded image data URL", () => {
    const logoUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    assert.equal(normalizeBranding({ logoUrl }, DEFAULT_BRANDING).logoUrl, logoUrl);
  });

  test("rejects a data URL that is not an allowed image", () => {
    assert.throws(
      () =>
        normalizeBranding(
          { logoUrl: "data:text/html;base64,PHNjcmlwdD4=" },
          DEFAULT_BRANDING
        ),
      SettingsValidationError
    );
  });

  test("rejects an oversized uploaded logo", () => {
    const logoUrl = "data:image/png;base64," + "A".repeat(350_000);
    assert.throws(() => normalizeBranding({ logoUrl }, DEFAULT_BRANDING), SettingsValidationError);
  });

  test("rejects a javascript logo URL", () => {
    assert.throws(
      () => normalizeBranding({ logoUrl: "javascript:alert(1)" }, DEFAULT_BRANDING),
      SettingsValidationError
    );
  });

  test("rejects an invalid support email", () => {
    assert.throws(
      () => normalizeBranding({ supportEmail: "not-an-email" }, DEFAULT_BRANDING),
      SettingsValidationError
    );
  });

  test("rejects a non-http website", () => {
    assert.throws(
      () => normalizeBranding({ websiteUrl: "ftp://example.com" }, DEFAULT_BRANDING),
      SettingsValidationError
    );
  });
});

describe("normalizeTheme", () => {
  test("keeps unspecified colours and lowercases supplied ones", () => {
    const theme = normalizeTheme({ accent: "#AABBCC", mode: "light" }, DEFAULT_THEME);
    assert.equal(theme.accent, "#aabbcc");
    assert.equal(theme.mode, "light");
    assert.equal(theme.canvas, DEFAULT_THEME.canvas);
  });

  test("rejects short hex colours", () => {
    assert.throws(() => normalizeTheme({ accent: "#fff" }, DEFAULT_THEME), SettingsValidationError);
  });

  test("rejects named colours", () => {
    assert.throws(() => normalizeTheme({ accent: "teal" }, DEFAULT_THEME), SettingsValidationError);
  });

  test("rejects an unknown mode", () => {
    assert.throws(() => normalizeTheme({ mode: "sepia" }, DEFAULT_THEME), SettingsValidationError);
  });

  test("an empty patch returns the base theme", () => {
    assert.deepEqual(normalizeTheme(undefined, DEFAULT_THEME), DEFAULT_THEME);
  });
});

describe("normalizeNavigation", () => {
  test("keeps the submitted order and applies labels", () => {
    const navigation = normalizeNavigation(
      {
        modules: [
          { key: "signals", label: "Ideas", hidden: false, access: "public" },
          { key: "analysis", label: "Market", hidden: true, access: "signed-in" },
        ],
      },
      DEFAULT_NAVIGATION
    );

    assert.equal(navigation.modules[0].key, "signals");
    assert.equal(navigation.modules[0].label, "Ideas");
    assert.equal(navigation.modules[1].hidden, true);
    assert.equal(navigation.modules[1].access, "signed-in");
    // Omitted modules are appended from the defaults so no tab vanishes.
    assert.deepEqual(
      navigation.modules.slice(2).map((module) => module.key),
      ["breakouts", "learn", "trading"]
    );
  });

  test("forces trading to signed-in", () => {
    const navigation = normalizeNavigation(
      { modules: [{ key: "trading", label: "Desk", hidden: false, access: "public" }] },
      DEFAULT_NAVIGATION
    );
    assert.equal(navigation.modules.find((module) => module.key === "trading")?.access, "signed-in");
  });

  test("accepts landing pages", () => {
    const navigation = normalizeNavigation(
      { landing: { signedIn: "analysis", signedOut: "signals" } },
      DEFAULT_NAVIGATION
    );
    assert.deepEqual(navigation.landing, { signedIn: "analysis", signedOut: "signals" });
  });

  test("rejects an unknown module", () => {
    assert.throws(
      () => normalizeNavigation({ modules: [{ key: "news" }] }, DEFAULT_NAVIGATION),
      SettingsValidationError
    );
  });

  test("rejects duplicate modules", () => {
    assert.throws(
      () =>
        normalizeNavigation(
          { modules: [{ key: "signals" }, { key: "signals" }] },
          DEFAULT_NAVIGATION
        ),
      SettingsValidationError
    );
  });

  test("rejects an empty label", () => {
    assert.throws(
      () =>
        normalizeNavigation(
          { modules: [{ key: "signals", label: "   " }] },
          DEFAULT_NAVIGATION
        ),
      SettingsValidationError
    );
  });

  test("rejects an unknown landing page", () => {
    assert.throws(
      () => normalizeNavigation({ landing: { signedIn: "trading" } }, DEFAULT_NAVIGATION),
      SettingsValidationError
    );
  });

  test("an empty patch returns the base", () => {
    assert.deepEqual(normalizeNavigation(undefined, DEFAULT_NAVIGATION), DEFAULT_NAVIGATION);
  });
});

describe("normalizeMaintenance", () => {
  test("merges booleans and trims the message", () => {
    const maintenance = normalizeMaintenance(
      { enabled: true, message: "  Back soon  " },
      DEFAULT_MAINTENANCE
    );
    assert.equal(maintenance.enabled, true);
    assert.equal(maintenance.message, "Back soon");
    assert.equal(maintenance.allowAdmins, DEFAULT_MAINTENANCE.allowAdmins);
  });

  test("rejects a non-boolean", () => {
    assert.throws(
      () => normalizeMaintenance({ enabled: "yes" }, DEFAULT_MAINTENANCE),
      SettingsValidationError
    );
  });
});

describe("normalizeAnnouncement", () => {
  test("accepts a scheduled announcement", () => {
    const announcement = normalizeAnnouncement(
      {
        enabled: true,
        text: "  New signals  ",
        tone: "success",
        linkUrl: "/signals",
        linkLabel: "Open",
        startsAt: "2026-01-01T10:00:00.000Z",
        endsAt: "2026-01-02T10:00:00.000Z",
      },
      DEFAULT_ANNOUNCEMENT
    );

    assert.equal(announcement.text, "New signals");
    assert.equal(announcement.tone, "success");
    assert.equal(announcement.linkUrl, "/signals");
    assert.equal(announcement.startsAt, "2026-01-01T10:00:00.000Z");
  });

  test("requires text when enabled", () => {
    assert.throws(
      () => normalizeAnnouncement({ enabled: true, text: "   " }, DEFAULT_ANNOUNCEMENT),
      SettingsValidationError
    );
  });

  test("rejects an unknown tone", () => {
    assert.throws(
      () => normalizeAnnouncement({ tone: "purple" }, DEFAULT_ANNOUNCEMENT),
      SettingsValidationError
    );
  });

  test("rejects a javascript link", () => {
    assert.throws(
      () => normalizeAnnouncement({ linkUrl: "javascript:alert(1)" }, DEFAULT_ANNOUNCEMENT),
      SettingsValidationError
    );
  });

  test("rejects an end before the start", () => {
    assert.throws(
      () =>
        normalizeAnnouncement(
          {
            startsAt: "2026-01-02T00:00:00.000Z",
            endsAt: "2026-01-01T00:00:00.000Z",
          },
          DEFAULT_ANNOUNCEMENT
        ),
      SettingsValidationError
    );
  });

  test("clears a date with null", () => {
    const announcement = normalizeAnnouncement(
      { startsAt: null, endsAt: null },
      { ...DEFAULT_ANNOUNCEMENT, startsAt: "2026-01-01T00:00:00.000Z" }
    );
    assert.equal(announcement.startsAt, null);
  });
});
