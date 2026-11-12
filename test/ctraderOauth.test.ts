import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { signOAuthState, signToken, verifyOAuthState } from "../src/server/auth";
import {
  buildAuthorizeUrl,
  ctraderOAuthConfigFrom,
  ctraderOAuthIssueFrom,
  exchangeAuthorizationCode,
  type CtraderOAuthConfig,
} from "../src/server/ctrader/oauth";

const USER_ID = "507f1f77bcf86cd799439011";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ctraderOAuthConfigFrom", () => {
  const base = {
    clientId: "28457",
    clientSecret: "secret",
    redirectUri: "https://example.com/callback",
  };

  test("stays disabled until both app credentials are present", () => {
    assert.equal(ctraderOAuthConfigFrom({}), null);
    assert.equal(ctraderOAuthConfigFrom({ clientId: "28457" }), null);
    assert.equal(ctraderOAuthConfigFrom({ clientSecret: "secret" }), null);
    assert.equal(ctraderOAuthConfigFrom({ clientId: "  ", clientSecret: "  " }), null);
    assert.equal(ctraderOAuthIssueFrom({}), "app_not_configured");
  });

  test("requires an explicit callback with no compiled-in fallback", () => {
    assert.equal(ctraderOAuthConfigFrom({ clientId: "28457", clientSecret: "secret" }), null);
    assert.equal(
      ctraderOAuthIssueFrom({ clientId: "28457", clientSecret: "secret" }),
      "redirect_missing"
    );
  });

  test("rejects callbacks this server does not mount", () => {
    assert.equal(
      ctraderOAuthIssueFrom({ ...base, redirectUri: "https://example.com/cb" }),
      "redirect_invalid"
    );
    assert.equal(
      ctraderOAuthIssueFrom({ ...base, redirectUri: "http://example.com/callback" }),
      "redirect_invalid"
    );
    assert.equal(
      ctraderOAuthIssueFrom({
        ...base,
        redirectUri: "https://example.com/callback?x=1",
      }),
      "redirect_invalid"
    );
  });

  test("allows the localhost http callbacks", () => {
    for (const redirectUri of [
      "http://localhost:9009/callback",
      "http://localhost:5173/api/ctrader/oauth/callback",
    ]) {
      assert.equal(ctraderOAuthIssueFrom({ ...base, redirectUri }), null);
      assert.equal(ctraderOAuthConfigFrom({ ...base, redirectUri })?.redirectUri, redirectUri);
    }
  });

  test("applies the default scope", () => {
    assert.deepEqual(ctraderOAuthConfigFrom(base), {
      clientId: "28457",
      clientSecret: "secret",
      redirectUri: "https://example.com/callback",
      scope: "trading",
    });
  });

  test("honours resolved overrides and trims whitespace", () => {
    assert.deepEqual(
      ctraderOAuthConfigFrom({
        clientId: " 1 ",
        clientSecret: " 2 ",
        redirectUri: "http://localhost:5173/api/ctrader/oauth/callback",
        scope: "accounts",
      }),
      {
        clientId: "1",
        clientSecret: "2",
        redirectUri: "http://localhost:5173/api/ctrader/oauth/callback",
        scope: "accounts",
      }
    );
  });

  test("rejects a space-separated scope", () => {
    assert.equal(ctraderOAuthConfigFrom({ ...base, scope: "accounts trading" }), null);
    assert.equal(ctraderOAuthIssueFrom({ ...base, scope: "accounts trading" }), "invalid_config");
  });

  test("ignores non-string resolved values", () => {
    assert.equal(ctraderOAuthConfigFrom({ clientId: 1, clientSecret: true }), null);
  });
});

describe("buildAuthorizeUrl", () => {
  test("encodes the consent parameters", () => {
    const cfg: CtraderOAuthConfig = {
      clientId: "28457",
      clientSecret: "secret",
      redirectUri: "https://doochy.net/callback",
      scope: "trading",
    };
    const url = new URL(buildAuthorizeUrl(cfg, "state.with/slash"));

    assert.equal(url.origin + url.pathname, "https://openapi.ctrader.com/apps/auth");
    assert.equal(url.searchParams.get("client_id"), "28457");
    assert.equal(url.searchParams.get("redirect_uri"), "https://doochy.net/callback");
    assert.equal(url.searchParams.get("scope"), "trading");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "state.with/slash");
    assert.equal(url.searchParams.get("product"), "web");
    assert.equal(url.searchParams.has("client_secret"), false);
  });
});

describe("OAuth state", () => {
  test("round-trips the user id", () => {
    const state = signOAuthState(USER_ID);
    assert.equal(verifyOAuthState(state), USER_ID);
  });

  test("rejects a normal login token and garbage", () => {
    assert.equal(verifyOAuthState(signToken(USER_ID)), null);
    assert.equal(verifyOAuthState("not-a-jwt"), null);
    assert.equal(verifyOAuthState(""), null);
  });
});

const cfg: CtraderOAuthConfig = {
  clientId: "28457",
  clientSecret: "shh",
  redirectUri: "https://doochy.net/callback",
  scope: "trading",
};

describe("exchangeAuthorizationCode", () => {
  test("sends the code and returns both tokens", async () => {
    let requested = "";
    globalThis.fetch = (async (input: any) => {
      requested = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "access", refreshToken: "refresh" }),
      } as any;
    }) as typeof fetch;

    const tokens = await exchangeAuthorizationCode(cfg, "the-code");
    assert.deepEqual(tokens, { accessToken: "access", refreshToken: "refresh" });

    const url = new URL(requested);
    assert.equal(url.origin + url.pathname, "https://openapi.ctrader.com/apps/token");
    assert.equal(url.searchParams.get("grant_type"), "authorization_code");
    assert.equal(url.searchParams.get("code"), "the-code");
    assert.equal(url.searchParams.get("redirect_uri"), cfg.redirectUri);
    assert.equal(url.searchParams.get("client_id"), cfg.clientId);
    assert.equal(url.searchParams.get("client_secret"), cfg.clientSecret);
  });

  test("surfaces an errorCode payload", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ errorCode: "invalid_grant", description: "expired code" }),
      }) as any) as typeof fetch;

    await assert.rejects(
      () => exchangeAuthorizationCode(cfg, "stale"),
      /invalid_grant.*expired code/
    );
  });

  test("surfaces HTTP failures and missing tokens", async () => {
    globalThis.fetch = (async () =>
      ({ ok: false, status: 500, json: async () => ({}) }) as any) as typeof fetch;
    await assert.rejects(() => exchangeAuthorizationCode(cfg, "x"), /HTTP 500/);

    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ accessToken: "only-access" }) }) as any) as typeof fetch;
    await assert.rejects(() => exchangeAuthorizationCode(cfg, "x"), /missing tokens/);
  });
});
