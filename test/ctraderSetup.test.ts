import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CTRADER_CALLBACK_PATHS,
  callbackCandidates,
  providerIssuesFromValues,
  validateCtraderSetup,
} from "../src/server/integrations/ctraderSetup";
import { describeIntegration } from "../src/server/integrations/store";

const BASE = "https://doochy.example";

describe("callbackCandidates", () => {
  test("builds the two mounted callbacks from an origin", () => {
    assert.deepEqual(callbackCandidates(BASE), {
      baseUrl: BASE,
      primary: `${BASE}/callback`,
      api: `${BASE}/api/ctrader/oauth/callback`,
    });
  });

  test("drops paths, queries and trailing slashes to the origin", () => {
    assert.equal(callbackCandidates("https://doochy.example/some/path?x=1").baseUrl, BASE);
    assert.equal(callbackCandidates("https://doochy.example/").primary, `${BASE}/callback`);
  });

  test("returns nulls for missing or non-http values", () => {
    for (const value of [null, undefined, "", "not a url", "ftp://example.com"]) {
      assert.deepEqual(callbackCandidates(value), { baseUrl: null, primary: null, api: null });
    }
  });
});

describe("validateCtraderSetup", () => {
  test("accepts a matching https callback", () => {
    const issues = validateCtraderSetup({
      publicBaseUrl: BASE,
      redirectUri: `${BASE}/callback`,
      scope: "trading",
    });
    assert.deepEqual(issues.errors, []);
    assert.deepEqual(issues.warnings, []);
  });

  test("requires the callback to live on the public origin", () => {
    const issues = validateCtraderSetup({
      publicBaseUrl: BASE,
      redirectUri: "https://other.example/callback",
    });
    assert.equal(issues.errors.some((error) => /public base URL origin/.test(error)), true);
  });

  test("allows localhost callbacks while the public base is https", () => {
    const issues = validateCtraderSetup({
      publicBaseUrl: BASE,
      redirectUri: "http://localhost:5173/api/ctrader/oauth/callback",
    });
    assert.deepEqual(issues.errors, []);
    assert.equal(issues.warnings.some((warning) => /local development/.test(warning)), true);
  });

  test("rejects unknown paths, queries and http outside localhost", () => {
    assert.equal(
      validateCtraderSetup({ redirectUri: `${BASE}/cb` }).errors.length > 0,
      true
    );
    assert.equal(
      validateCtraderSetup({ redirectUri: `${BASE}/callback?x=1` }).errors.length > 0,
      true
    );
    assert.equal(
      validateCtraderSetup({ redirectUri: "http://doochy.example/callback" }).errors.length > 0,
      true
    );
  });

  test("rejects a public base URL with a path", () => {
    const issues = validateCtraderSetup({ publicBaseUrl: `${BASE}/app` });
    assert.equal(issues.errors.some((error) => /origin only/.test(error)), true);
  });

  test("warns about the view-only scope", () => {
    const issues = validateCtraderSetup({
      redirectUri: `${BASE}/callback`,
      scope: "accounts",
    });
    assert.deepEqual(issues.errors, []);
    assert.equal(issues.warnings.some((warning) => /view-only/.test(warning)), true);
  });

  test("rejects an unknown scope", () => {
    const issues = validateCtraderSetup({
      redirectUri: `${BASE}/callback`,
      scope: "accounts trading",
    });
    assert.equal(issues.errors.some((error) => /Scope must be/.test(error)), true);
  });

  test("only the two mounted paths are listed", () => {
    assert.deepEqual([...CTRADER_CALLBACK_PATHS], [
      "/callback",
      "/api/ctrader/oauth/callback",
    ]);
  });
});

describe("providerIssuesFromValues", () => {
  test("passes through cTrader validation", () => {
    const issues = providerIssuesFromValues("ctrader", {
      publicBaseUrl: BASE,
      redirectUri: "https://other.example/callback",
    });
    assert.equal(issues.errors.length > 0, true);
  });

  test("ignores other providers", () => {
    assert.deepEqual(providerIssuesFromValues("telegram", { baseUrl: "nope" }), {
      errors: [],
      warnings: [],
    });
  });
});

describe("describeIntegration cross-field state", () => {
  test("blocks readiness when the callback origin disagrees with the base URL", () => {
    const state = describeIntegration(
      "ctrader",
      {
        values: {
          clientId: "id",
          redirectUri: "https://other.example/callback",
          publicBaseUrl: BASE,
        },
      },
      { CTRADER_CLIENT_SECRET: "secret" },
      null
    );
    assert.equal(state.ready, false);
    assert.equal(state.errors.some((error) => /public base URL origin/.test(error)), true);
    // The secret came from the environment, so the provider is otherwise set up.
    assert.equal(
      state.fields.find((field) => field.key === "clientSecret")?.configured,
      true
    );
  });
});
