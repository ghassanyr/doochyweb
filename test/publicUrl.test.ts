import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { siteOrigin, siteUrlFor } from "../src/webapp/src/publicUrl";

const FALLBACK = "https://preview.example";

describe("siteUrlFor", () => {
  test("uses the saved site URL when present", () => {
    const config = { site: { publicBaseUrl: "https://public.example/app?x=1" } };
    assert.equal(siteOrigin(config, FALLBACK), "https://public.example");
    assert.equal(
      siteUrlFor(config, "/signals", { signal: "s1" }, FALLBACK),
      "https://public.example/signals?signal=s1"
    );
  });

  test("falls back to the browser origin", () => {
    assert.equal(
      siteUrlFor({ site: { publicBaseUrl: "" } }, "/breakouts", { note: "n1" }, FALLBACK),
      "https://preview.example/breakouts?note=n1"
    );
    assert.equal(siteUrlFor(null, "/", {}, FALLBACK), "https://preview.example/");
  });

  test("ignores unsafe or malformed overrides", () => {
    for (const value of ["javascript:alert(1)", "not a url", "ftp://example.com"]) {
      assert.equal(
        siteUrlFor({ site: { publicBaseUrl: value } }, "/signals", {}, FALLBACK),
        "https://preview.example/signals"
      );
    }
  });

  test("replaces query values and omits empty ones", () => {
    assert.equal(
      siteUrlFor({}, "/signals?signal=old", { signal: "new" }, FALLBACK),
      "https://preview.example/signals?signal=new"
    );
    assert.equal(
      siteUrlFor({}, "/signals?signal=old", { signal: null }, FALLBACK),
      "https://preview.example/signals"
    );
  });
});
