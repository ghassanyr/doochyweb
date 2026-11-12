import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ENCRYPTION_KEY_ENV,
  IntegrationCryptoError,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../src/server/integrations/crypto";
import {
  INTEGRATION_DEFS,
  INTEGRATION_PROVIDERS,
  integrationAad,
  integrationField,
  isIntegrationProvider,
} from "../src/server/integrations/registry";
import {
  describeIntegration,
  resolveDraftValues,
  resolveIntegrationValues,
} from "../src/server/integrations/store";
import type { IntegrationFieldDef } from "../src/server/integrations/types";
import {
  IntegrationValidationError,
  applyIntegrationPatch,
  coerceFieldValue,
  normalizeIntegrationPatch,
} from "../src/server/integrations/validate";

// Fixed keys keep the tests deterministic; the production key is random.
const KEY = Buffer.alloc(32, 3);
const OTHER_KEY = Buffer.alloc(32, 5);

const EMPTY_ENV: NodeJS.ProcessEnv = {};
const KEYED_ENV: NodeJS.ProcessEnv = { [ENCRYPTION_KEY_ENV]: KEY.toString("base64") };

function def(provider: "ctrader" | "telegram", key: string): IntegrationFieldDef {
  const found = integrationField(provider, key);
  assert.ok(found, `missing ${provider}.${key}`);
  return found;
}

function storedSecret(provider: "ctrader" | "telegram", key: string, value: string): string {
  return encryptSecret(value, integrationAad(provider, key), KEY);
}

function field(state: ReturnType<typeof describeIntegration>, key: string) {
  const found = state.fields.find((entry) => entry.key === key);
  assert.ok(found, `missing field ${key}`);
  return found;
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof Error, `unexpected error: ${err}`);
    return err;
  }
  assert.fail("expected an error");
}

describe("registry", () => {
  test("lists providers in the documented order and recognises them", () => {
    assert.deepEqual([...INTEGRATION_PROVIDERS], ["ctrader", "telegram"]);
    for (const provider of INTEGRATION_PROVIDERS) {
      assert.equal(isIntegrationProvider(provider), true);
      assert.equal(INTEGRATION_DEFS[provider].provider, provider);
    }
    assert.equal(isIntegrationProvider("smtp"), false);
    assert.equal(isIntegrationProvider(""), false);
    assert.equal(isIntegrationProvider(null), false);
  });

  test("binds each secret to its provider and field", () => {
    assert.equal(integrationAad("telegram", "botToken"), "telegram:botToken");
    assert.equal(integrationAad("ctrader", "clientSecret"), "ctrader:clientSecret");
  });
});

describe("coerceFieldValue", () => {
  test("trims text and treats blank as no value", () => {
    const fieldDef = def("ctrader", "clientId");
    assert.equal(coerceFieldValue(fieldDef, "  abc  "), "abc");
    assert.equal(coerceFieldValue(fieldDef, "   "), null);
    assert.equal(coerceFieldValue(fieldDef, ""), null);
  });

  test("rejects non-string text and secrets", () => {
    for (const key of ["clientId", "clientSecret"]) {
      assert.throws(
        () => coerceFieldValue(def("ctrader", key), 42),
        IntegrationValidationError
      );
    }
  });

  test("enforces maxLength without echoing the value", () => {
    const secret = "x".repeat(501);
    const err = errorOf(() => coerceFieldValue(def("ctrader", "clientSecret"), secret));
    assert.ok(err instanceof IntegrationValidationError);
    assert.equal(err.message.includes(secret), false);
  });

  test("validates http(s) URLs", () => {
    const fieldDef = def("ctrader", "redirectUri");
    assert.equal(
      coerceFieldValue(fieldDef, "https://example.com/api/ctrader/oauth/callback"),
      "https://example.com/api/ctrader/oauth/callback"
    );
    for (const raw of ["example.com", "ftp://example.com", "javascript:alert(1)"]) {
      assert.throws(() => coerceFieldValue(fieldDef, raw), IntegrationValidationError, raw);
    }
  });

  test("validates email addresses", () => {
    const fieldDef: IntegrationFieldDef = {
      key: "to",
      label: "Recipient",
      kind: "text",
      format: "email",
    };
    assert.equal(coerceFieldValue(fieldDef, " ops@example.com "), "ops@example.com");
    for (const raw of ["ops", "ops@", "@example.com", "ops@example"]) {
      assert.throws(() => coerceFieldValue(fieldDef, raw), IntegrationValidationError, raw);
    }
  });

  test("coerces numbers, integers and bounds", () => {
    const ttl = def("telegram", "linkTtlMinutes");
    assert.equal(coerceFieldValue(ttl, "15"), 15);
    assert.equal(coerceFieldValue(ttl, 7), 7);
    assert.throws(() => coerceFieldValue(ttl, "1.5"), IntegrationValidationError);
    assert.throws(() => coerceFieldValue(ttl, "0"), IntegrationValidationError);
    assert.throws(() => coerceFieldValue(ttl, "61"), IntegrationValidationError);
    assert.throws(() => coerceFieldValue(ttl, "abc"), IntegrationValidationError);
    assert.throws(() => coerceFieldValue(ttl, ""), IntegrationValidationError);
    assert.throws(() => coerceFieldValue(ttl, Number.POSITIVE_INFINITY), IntegrationValidationError);
  });

  test("coerces booleans from strings and 0/1", () => {
    const enabled = def("telegram", "enabled");
    for (const raw of [true, 1, "true", "TRUE", "1", "on", "yes"]) {
      assert.equal(coerceFieldValue(enabled, raw), true, String(raw));
    }
    for (const raw of [false, 0, "false", "FALSE", "0", "off", "no"]) {
      assert.equal(coerceFieldValue(enabled, raw), false, String(raw));
    }
    for (const raw of ["", "maybe", 2, null]) {
      assert.throws(() => coerceFieldValue(enabled, raw), IntegrationValidationError, String(raw));
    }
  });

  test("restricts select fields to their options", () => {
    const scope = def("ctrader", "scope");
    assert.equal(coerceFieldValue(scope, "trading"), "trading");
    assert.equal(coerceFieldValue(scope, " accounts "), "accounts");
    const err = errorOf(() => coerceFieldValue(scope, "carrier-pigeon"));
    assert.ok(err instanceof IntegrationValidationError);
    assert.equal(err.message.includes("trading, accounts"), true);
  });
});

describe("normalizeIntegrationPatch", () => {
  test("accepts an empty patch", () => {
    for (const patch of [undefined, null, {}, { values: {} }]) {
      assert.deepEqual(normalizeIntegrationPatch("ctrader", patch), { set: {}, clear: [] });
    }
  });

  test("rejects malformed patch shapes", () => {
    for (const patch of [[], "x", 5, { values: [] }, { values: "x" }, { values: null }]) {
      assert.throws(
        () => normalizeIntegrationPatch("ctrader", patch),
        IntegrationValidationError,
        JSON.stringify(patch)
      );
    }
  });

  test("rejects unknown fields and non-array clear", () => {
    assert.throws(
      () => normalizeIntegrationPatch("ctrader", { values: { nope: "x" } }),
      IntegrationValidationError
    );
    assert.throws(
      () => normalizeIntegrationPatch("ctrader", { clear: "clientId" }),
      IntegrationValidationError
    );
    assert.throws(
      () => normalizeIntegrationPatch("ctrader", { clear: ["nope"] }),
      IntegrationValidationError
    );
    assert.throws(
      () => normalizeIntegrationPatch("ctrader", { clear: [42] }),
      IntegrationValidationError
    );
  });

  test("keeps an empty secret and clears an empty non-secret", () => {
    const patch = normalizeIntegrationPatch("ctrader", {
      values: { clientSecret: "  ", clientId: "  ", scope: "" },
    });
    assert.deepEqual(patch, { set: {}, clear: ["clientId", "scope"] });
  });

  test("treats null and undefined as untouched", () => {
    assert.deepEqual(
      normalizeIntegrationPatch("ctrader", { values: { clientId: null, scope: undefined } }),
      { set: {}, clear: [] }
    );
  });

  test("an empty number or boolean clears the override too", () => {
    assert.deepEqual(
      normalizeIntegrationPatch("telegram", {
        values: { linkTtlMinutes: "  ", enabled: "" },
      }),
      { set: {}, clear: ["linkTtlMinutes", "enabled"] }
    );
  });

  test("validates and normalises supplied values", () => {
    const patch = normalizeIntegrationPatch("telegram", {
      values: {
        botToken: " 123:abc ",
        botUsername: "DoochyBot",
        enabled: "yes",
        linkTtlMinutes: "30",
      },
    });
    assert.deepEqual(patch.set, {
      botToken: "123:abc",
      botUsername: "DoochyBot",
      enabled: true,
      linkTtlMinutes: 30,
    });
    assert.deepEqual(patch.clear, []);
  });

  test("dedupes clear and refuses to set and clear the same field", () => {
    assert.deepEqual(
      normalizeIntegrationPatch("ctrader", { clear: ["scope", "scope"] }),
      { set: {}, clear: ["scope"] }
    );
    assert.throws(
      () =>
        normalizeIntegrationPatch("ctrader", {
          values: { clientId: "abc" },
          clear: ["clientId"],
        }),
      IntegrationValidationError
    );
    // An empty non-secret also means "remove the override", so combining it
    // with an explicit clear is not a contradiction.
    assert.deepEqual(
      normalizeIntegrationPatch("ctrader", {
        values: { scope: "  " },
        clear: ["scope"],
      }),
      { set: {}, clear: ["scope"] }
    );
  });
});

describe("applyIntegrationPatch", () => {
  test("encrypts secrets and stores non-secrets as plain scalars", () => {
    const next = applyIntegrationPatch(
      "telegram",
      {},
      { values: { botToken: "123:abc", botUsername: "DoochyBot", enabled: false } },
      KEY
    );

    assert.equal(typeof next.botToken, "string");
    assert.equal(isEncryptedSecret(next.botToken), true);
    assert.equal((next.botToken as string).includes("123:abc"), false);
    assert.equal(
      decryptSecret(next.botToken as string, integrationAad("telegram", "botToken"), KEY),
      "123:abc"
    );
    assert.equal(next.botUsername, "DoochyBot");
    assert.equal(next.enabled, false);
  });

  test("does not mutate the current values", () => {
    const current = { clientId: "old" };
    const next = applyIntegrationPatch("ctrader", current, { values: { clientId: "new" } }, KEY);
    assert.equal(current.clientId, "old");
    assert.equal(next.clientId, "new");
  });

  test("preserves fields the patch does not mention", () => {
    const current = {
      clientId: "id",
      clientSecret: storedSecret("ctrader", "clientSecret", "shh"),
    };
    const next = applyIntegrationPatch("ctrader", current, { values: { clientId: "id2" } }, KEY);
    assert.equal(next.clientId, "id2");
    assert.equal(next.clientSecret, current.clientSecret);
  });

  test("removes explicitly cleared fields", () => {
    const next = applyIntegrationPatch(
      "ctrader",
      { clientId: "id", scope: "trading" },
      { clear: ["scope"] },
      KEY
    );
    assert.equal("scope" in next, false);
    assert.equal(next.clientId, "id");
  });

  test("leaves an empty secret alone and drops an empty non-secret", () => {
    const current = {
      clientId: "id",
      clientSecret: storedSecret("ctrader", "clientSecret", "shh"),
    };
    const next = applyIntegrationPatch(
      "ctrader",
      current,
      { values: { clientId: "", clientSecret: "" } },
      KEY
    );
    assert.equal("clientId" in next, false);
    assert.equal(next.clientSecret, current.clientSecret);
  });
});

describe("describeIntegration", () => {
  test("reports a completely unconfigured provider", () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const state = describeIntegration(provider, null, EMPTY_ENV, null);
      assert.equal(state.provider, provider);
      assert.equal(state.ready, false);
      assert.equal(state.updatedAt, null);
      assert.equal(state.updatedBy, null);
      assert.equal(state.lastTestAt, null);
      assert.equal(state.lastTestOk, null);
      assert.equal(state.lastTestMessage, null);
      // Non-required fields with defaults are still reported as configured.
      for (const entry of state.fields) {
        assert.equal(entry.hint, null);
        assert.equal(entry.error, null);
      }
    }
  });

  test("marks cTrader ready only with both credentials and a callback", () => {
    const missing = describeIntegration("ctrader", null, EMPTY_ENV, null);
    assert.equal(missing.ready, false);
    assert.equal(field(missing, "clientId").configured, false);
    assert.equal(field(missing, "clientSecret").configured, false);
    assert.equal(field(missing, "scope").source, "default");
    assert.equal(field(missing, "scope").value, "trading");
    assert.equal(missing.errors.length, 0);

    const noCallback = describeIntegration(
      "ctrader",
      { values: { clientId: "id", clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
      EMPTY_ENV,
      KEY
    );
    assert.equal(noCallback.ready, false);

    const ready = describeIntegration(
      "ctrader",
      {
        values: {
          clientId: "id",
          clientSecret: storedSecret("ctrader", "clientSecret", "shh"),
          redirectUri: "https://example.com/callback",
        },
      },
      EMPTY_ENV,
      KEY
    );
    assert.equal(ready.ready, true);
    assert.equal(field(ready, "clientId").source, "database");
    assert.equal(field(ready, "clientSecret").source, "database");
  });

  test("marks Telegram ready from defaults plus a token", () => {
    const state = describeIntegration(
      "telegram",
      { values: { botToken: storedSecret("telegram", "botToken", "123:abc") } },
      EMPTY_ENV,
      KEY
    );
    assert.equal(state.ready, true);
    assert.equal(field(state, "botUsername").value, "DoochyBot");
    assert.equal(field(state, "botUsername").source, "default");
    assert.equal(field(state, "baseUrl").value, "https://doochy.net");
    assert.equal(field(state, "enabled").value, true);
    assert.equal(field(state, "linkTtlMinutes").value, 15);
  });

  test("falls back to the environment when nothing is stored", () => {
    const state = describeIntegration(
      "ctrader",
      null,
      {
        CTRADER_CLIENT_ID: "env-id",
        CTRADER_CLIENT_SECRET: "env-secret",
        CTRADER_REDIRECT_URI: "https://example.com/callback",
      },
      null
    );
    assert.equal(state.ready, true);
    assert.equal(field(state, "clientId").value, "env-id");
    assert.equal(field(state, "clientId").source, "environment");
    assert.equal(field(state, "clientSecret").configured, true);
    assert.equal(field(state, "clientSecret").source, "environment");
    // Environment secrets are never hinted at.
    assert.equal(field(state, "clientSecret").hint, null);
    assert.equal(field(state, "clientSecret").value, null);
    assert.equal(field(state, "redirectUri").value, "https://example.com/callback");
  });

  test("database values win over the environment", () => {
    const state = describeIntegration(
      "ctrader",
      {
        values: {
          clientId: "db-id",
          clientSecret: storedSecret("ctrader", "clientSecret", "db-secret"),
          scope: "accounts",
        },
      },
      {
        CTRADER_CLIENT_ID: "env-id",
        CTRADER_CLIENT_SECRET: "env-secret",
        CTRADER_OAUTH_SCOPE: "env-scope",
      },
      KEY
    );
    assert.equal(field(state, "clientId").value, "db-id");
    assert.equal(field(state, "clientId").source, "database");
    assert.equal(field(state, "scope").value, "accounts");
    assert.equal(field(state, "scope").source, "database");
    assert.equal(field(state, "clientSecret").source, "database");
  });

  test("returns a masked hint for a database secret and never the plaintext", () => {
    const secret = "123456:AAH-super-secret-bot-token";
    const state = describeIntegration(
      "telegram",
      { values: { botToken: storedSecret("telegram", "botToken", secret) } },
      EMPTY_ENV,
      KEY
    );
    const token = field(state, "botToken");
    assert.equal(token.configured, true);
    assert.equal(token.value, null);
    assert.equal(token.hint, "••••oken");
    assert.equal(JSON.stringify(state).includes(secret), false);
    assert.equal(JSON.stringify(state).includes(KEY.toString("base64")), false);
  });

  test("reports a stored secret that needs a missing key", () => {
    const state = describeIntegration(
      "ctrader",
      { values: { clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
      EMPTY_ENV,
      null
    );
    const secret = field(state, "clientSecret");
    assert.equal(secret.configured, true);
    assert.equal(secret.source, "database");
    assert.equal(secret.error, `${ENCRYPTION_KEY_ENV} is not set`);
    assert.equal(state.ready, false);
  });

  test("reports a stored secret that cannot be decrypted", () => {
    const state = describeIntegration(
      "ctrader",
      { values: { clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
      EMPTY_ENV,
      OTHER_KEY
    );
    assert.equal(field(state, "clientSecret").error, "stored secret could not be decrypted");
    assert.equal(state.ready, false);
  });

  test("reports a legacy plaintext stored secret", () => {
    const state = describeIntegration(
      "ctrader",
      { values: { clientSecret: "plain-secret" } },
      EMPTY_ENV,
      KEY
    );
    const secret = field(state, "clientSecret");
    assert.equal(secret.configured, true);
    assert.equal(secret.error, "stored secret is not encrypted");
    assert.equal(JSON.stringify(state).includes("plain-secret"), false);
    assert.equal(state.ready, false);
  });

  test("reports a non-string stored secret", () => {
    const state = describeIntegration(
      "ctrader",
      { values: { clientSecret: 42 } },
      EMPTY_ENV,
      KEY
    );
    assert.equal(field(state, "clientSecret").error, "stored secret is invalid");
  });

  test("reports an invalid environment value", () => {
    const state = describeIntegration(
      "ctrader",
      null,
      { CTRADER_CLIENT_ID: "x".repeat(201) },
      null
    );
    const clientId = field(state, "clientId");
    assert.equal(clientId.source, "environment");
    assert.equal(clientId.configured, false);
    assert.match(clientId.error ?? "", /Client ID must be 200 characters or fewer/);
    assert.equal(state.ready, false);
  });

  test("reports an invalid stored non-secret", () => {
    const state = describeIntegration(
      "telegram",
      { values: { linkTtlMinutes: 999 } },
      EMPTY_ENV,
      null
    );
    const ttl = field(state, "linkTtlMinutes");
    assert.equal(ttl.source, "database");
    assert.equal(ttl.configured, false);
    assert.match(ttl.error ?? "", /at most 60/);
  });

  test("falls back to the environment when a stored non-secret is blank", () => {
    const state = describeIntegration(
      "ctrader",
      { values: { clientId: "   " } },
      { CTRADER_CLIENT_ID: "env-id" },
      null
    );
    assert.equal(field(state, "clientId").value, "env-id");
    assert.equal(field(state, "clientId").source, "environment");
  });

  test("passes through test metadata", () => {
    const updatedAt = new Date("2026-11-10T12:00:00.000Z");
    const lastTestAt = new Date("2026-11-11T09:30:00.000Z");
    const state = describeIntegration(
      "telegram",
      {
        values: {},
        updatedAt,
        updatedBy: "admin-1",
        lastTestAt,
        lastTestOk: false,
        lastTestMessage: "401 Unauthorized",
        lastTestDraft: true,
      },
      EMPTY_ENV,
      null
    );
    assert.equal(state.updatedAt, updatedAt.toISOString());
    assert.equal(state.updatedBy, "admin-1");
    assert.equal(state.lastTestAt, lastTestAt.toISOString());
    assert.equal(state.lastTestOk, false);
    assert.equal(state.lastTestMessage, "401 Unauthorized");
    assert.equal(state.lastTestDraft, true);
  });

  test("ignores malformed metadata", () => {
    const state = describeIntegration(
      "telegram",
      {
        values: {},
        updatedAt: "not-a-date",
        updatedBy: 42 as unknown as string,
        lastTestAt: "also-not-a-date",
        lastTestOk: "yes" as unknown as boolean,
        lastTestMessage: 7 as unknown as string,
      },
      EMPTY_ENV,
      null
    );
    assert.equal(state.updatedAt, null);
    assert.equal(state.updatedBy, null);
    assert.equal(state.lastTestAt, null);
    assert.equal(state.lastTestOk, null);
    assert.equal(state.lastTestMessage, null);
    assert.equal(state.lastTestDraft, false);
  });
});

describe("resolveIntegrationValues", () => {
  test("resolves defaults and reports missing required fields", () => {
    const resolved = resolveIntegrationValues("ctrader", null, EMPTY_ENV, null);
    assert.deepEqual(resolved.missing, ["clientId", "clientSecret", "redirectUri"]);
    assert.equal(resolved.values.scope, "trading");
    assert.equal(resolved.sources.scope, "default");
    assert.equal("clientId" in resolved.values, false);
    assert.equal("clientSecret" in resolved.values, false);
    assert.equal("redirectUri" in resolved.values, false);
  });

  test("decrypts database secrets and applies database precedence", () => {
    const resolved = resolveIntegrationValues(
      "ctrader",
      {
        values: {
          clientId: "db-id",
          clientSecret: storedSecret("ctrader", "clientSecret", "db-secret"),
          redirectUri: "https://example.com/callback",
          scope: "trading",
        },
      },
      { CTRADER_CLIENT_ID: "env-id", CTRADER_CLIENT_SECRET: "env-secret" },
      KEY
    );
    assert.deepEqual(resolved.missing, []);
    assert.equal(resolved.values.clientId, "db-id");
    assert.equal(resolved.values.clientSecret, "db-secret");
    assert.equal(resolved.sources.clientId, "database");
    assert.equal(resolved.sources.clientSecret, "database");
    assert.equal(resolved.values.scope, "trading");
  });

  test("uses the environment when the database has no override", () => {
    const resolved = resolveIntegrationValues(
      "telegram",
      { values: {} },
      {
        TELEGRAM_BOT_TOKEN: "123:env",
        TELEGRAM_BOT_USERNAME: "EnvBot",
        PUBLIC_BASE_URL: "https://env.example",
        TELEGRAM_ENABLED: "false",
        TELEGRAM_LINK_TTL_MINUTES: "5",
      },
      null
    );
    assert.deepEqual(resolved.missing, []);
    assert.equal(resolved.values.botToken, "123:env");
    assert.equal(resolved.values.botUsername, "EnvBot");
    assert.equal("mode" in resolved.values, false);
    assert.equal(resolved.values.baseUrl, "https://env.example");
    assert.equal(resolved.values.enabled, false);
    assert.equal(resolved.values.linkTtlMinutes, 5);
    for (const source of Object.values(resolved.sources)) {
      assert.equal(source, "environment");
    }
  });

  test("an empty stored secret falls back to the environment", () => {
    const resolved = resolveIntegrationValues(
      "telegram",
      { values: { botToken: "" } },
      { TELEGRAM_BOT_TOKEN: "123:env" },
      KEY
    );
    assert.equal(resolved.values.botToken, "123:env");
    assert.equal(resolved.sources.botToken, "environment");
  });

  test("reports a missing required secret", () => {
    const resolved = resolveIntegrationValues(
      "telegram",
      { values: { botUsername: "MyBot" } },
      EMPTY_ENV,
      KEY
    );
    assert.deepEqual(resolved.missing, ["botToken"]);
    assert.equal(resolved.values.botUsername, "MyBot");
  });

  test("throws when a stored secret cannot be decrypted without a key", () => {
    const err = errorOf(() =>
      resolveIntegrationValues(
        "ctrader",
        { values: { clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
        EMPTY_ENV,
        null
      )
    );
    assert.ok(err instanceof IntegrationValidationError);
    assert.equal(err.message.includes(ENCRYPTION_KEY_ENV), true);
  });

  test("throws on a wrong key", () => {
    assert.throws(
      () =>
        resolveIntegrationValues(
          "ctrader",
          { values: { clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
          EMPTY_ENV,
          OTHER_KEY
        ),
      IntegrationCryptoError
    );
  });

  test("throws on a tampered ciphertext", () => {
    const payload = storedSecret("ctrader", "clientSecret", "shh");
    const parts = payload.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0x01;
    parts[3] = bytes.toString("base64url");

    assert.throws(
      () =>
        resolveIntegrationValues(
          "ctrader",
          { values: { clientSecret: parts.join(".") } },
          EMPTY_ENV,
          KEY
        ),
      IntegrationCryptoError
    );
  });

  test("throws on a legacy plaintext secret instead of trusting it", () => {
    const err = errorOf(() =>
      resolveIntegrationValues(
        "ctrader",
        { values: { clientSecret: "plain-secret" } },
        EMPTY_ENV,
        KEY
      )
    );
    assert.ok(err instanceof IntegrationValidationError);
    assert.equal(err.message.includes("plain-secret"), false);
  });

  test("throws on an invalid stored non-secret", () => {
    assert.throws(
      () =>
        resolveIntegrationValues(
          "telegram",
          { values: { linkTtlMinutes: 0 } },
          EMPTY_ENV,
          null
        ),
      IntegrationValidationError
    );
  });

  test("resolves a full Telegram configuration from the database", () => {
    const resolved = resolveIntegrationValues(
      "telegram",
      {
        values: {
          botToken: storedSecret("telegram", "botToken", "123:abc"),
          botUsername: "MyBot",
          baseUrl: "https://bot.example",
          enabled: true,
          linkTtlMinutes: 10,
        },
      },
      EMPTY_ENV,
      KEY
    );
    assert.deepEqual(resolved.values, {
      botToken: "123:abc",
      botUsername: "MyBot",
      baseUrl: "https://bot.example",
      enabled: true,
      linkTtlMinutes: 10,
    });
    assert.deepEqual(resolved.missing, []);
  });
});

describe("resolveDraftValues", () => {
  const stored = {
    values: {
      clientId: "saved-id",
      clientSecret: storedSecret("ctrader", "clientSecret", "saved-secret"),
      redirectUri: "https://example.com/callback",
    },
  };

  test("merges a draft over the saved values without writing", () => {
    const resolved = resolveDraftValues(
      "ctrader",
      stored,
      { values: { clientId: "draft-id" } },
      EMPTY_ENV,
      KEY
    );
    assert.equal(resolved.values.clientId, "draft-id");
    assert.equal(resolved.values.clientSecret, "saved-secret");
    assert.equal(resolved.values.redirectUri, "https://example.com/callback");
    assert.deepEqual(resolved.missing, []);
  });

  test("an empty secret keeps the saved one", () => {
    const resolved = resolveDraftValues(
      "ctrader",
      stored,
      { values: { clientSecret: "  " } },
      EMPTY_ENV,
      KEY
    );
    assert.equal(resolved.values.clientSecret, "saved-secret");
  });

  test("clear removes a stored override and falls back to the environment", () => {
    const resolved = resolveDraftValues(
      "ctrader",
      stored,
      { clear: ["redirectUri"] },
      { CTRADER_REDIRECT_URI: "https://env.example/callback" },
      KEY
    );
    assert.equal(resolved.values.redirectUri, "https://env.example/callback");
    assert.equal(resolved.sources.redirectUri, "environment");
  });

  test("a draft secret can replace one that cannot be decrypted", () => {
    const resolved = resolveDraftValues(
      "ctrader",
      { values: { clientSecret: storedSecret("ctrader", "clientSecret", "shh") } },
      { values: { clientSecret: "replacement" } },
      EMPTY_ENV,
      OTHER_KEY
    );
    assert.equal(resolved.values.clientSecret, "replacement");
  });

  test("rejects an unknown draft field", () => {
    assert.throws(
      () =>
        resolveDraftValues(
          "ctrader",
          stored,
          { values: { nope: "x" } },
          EMPTY_ENV,
          KEY
        ),
      IntegrationValidationError
    );
  });
});
