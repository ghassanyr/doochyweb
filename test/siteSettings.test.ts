import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_BRANDING, DEFAULT_THEME } from "../src/server/settings/defaults";
import { mergeSiteSettings, publicSiteConfig } from "../src/server/settings/store";
import {
  SettingsValidationError,
  normalizeBranding,
  normalizeTheme,
} from "../src/server/settings/validate";

// The settings document is a singleton merged over compiled defaults, so these
// tests cover the merge and validation without needing a live database.

describe("site settings defaults", () => {
  test("a missing document returns the compiled defaults", () => {
    const settings = mergeSiteSettings(null);
    assert.deepEqual(settings.branding, DEFAULT_BRANDING);
    assert.deepEqual(settings.theme, DEFAULT_THEME);
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
    assert.deepEqual(Object.keys(config).sort(), ["branding", "theme", "version"]);
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
