import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ENCRYPTION_KEY_ENV,
  IntegrationCryptoError,
  decryptSecret,
  encryptSecret,
  encryptionKeyFromEnv,
  isEncryptedSecret,
  maskSecret,
  parseEncryptionKey,
  requireEncryptionKey,
} from "../src/server/integrations/crypto";

// Fixed keys keep the tests deterministic; the production key is random.
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const AAD = "telegram:botToken";
const SECRET = "123456:AAH-super-secret-bot-token";

function tamper(payload: string, index: 1 | 2 | 3): string {
  const parts = payload.split(".");
  const bytes = Buffer.from(parts[index], "base64url");
  bytes[bytes.length - 1] ^= 0x01;
  parts[index] = bytes.toString("base64url");
  return parts.join(".");
}

function errorOf(fn: () => unknown): IntegrationCryptoError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof IntegrationCryptoError, `unexpected error: ${err}`);
    return err;
  }
  assert.fail("expected an IntegrationCryptoError");
}

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a secret", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.equal(decryptSecret(payload, AAD, KEY), SECRET);
  });

  test("uses a fresh IV so the same input never repeats", () => {
    const first = encryptSecret(SECRET, AAD, KEY);
    const second = encryptSecret(SECRET, AAD, KEY);
    assert.notEqual(first, second);
    assert.equal(decryptSecret(first, AAD, KEY), SECRET);
    assert.equal(decryptSecret(second, AAD, KEY), SECRET);
  });

  test("keeps the plaintext out of the stored value", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.equal(payload.includes(SECRET), false);
    assert.equal(payload.split(".")[0], "v1");
    assert.equal(payload.split(".").length, 4);
  });

  test("round-trips unicode and empty values", () => {
    for (const value of ["pässwörd-🔐", ""]) {
      const payload = encryptSecret(value, AAD, KEY);
      assert.equal(decryptSecret(payload, AAD, KEY), value);
    }
  });

  test("rejects the wrong key", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    const err = errorOf(() => decryptSecret(payload, AAD, OTHER_KEY));
    assert.equal(err.message.includes(SECRET), false);
    assert.equal(err.message.includes(KEY.toString("base64")), false);
  });

  test("rejects a tampered ciphertext", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.throws(() => decryptSecret(tamper(payload, 3), AAD, KEY), IntegrationCryptoError);
  });

  test("rejects a tampered auth tag", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.throws(() => decryptSecret(tamper(payload, 2), AAD, KEY), IntegrationCryptoError);
  });

  test("binds the ciphertext to its provider and field", () => {
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.throws(
      () => decryptSecret(payload, "smtp:password", KEY),
      IntegrationCryptoError
    );
  });

  test("rejects malformed payloads", () => {
    const iv = Buffer.alloc(12, 1).toString("base64url");
    const tag = Buffer.alloc(16, 2).toString("base64url");
    const cases = [
      "",
      "not-a-payload",
      `v2.${iv}.${tag}.abc`,
      `v1.${iv}.${tag}`,
      `v1.!!!!.${tag}.abc`,
      `v1.${iv}.!!!!.abc`,
      `v1.${Buffer.alloc(8, 1).toString("base64url")}.${tag}.abc`,
      `v1.${iv}.${Buffer.alloc(8, 1).toString("base64url")}.abc`,
    ];
    for (const payload of cases) {
      assert.throws(() => decryptSecret(payload, AAD, KEY), IntegrationCryptoError, payload);
    }
  });

  test("requires a non-empty field name", () => {
    assert.throws(() => encryptSecret(SECRET, "  ", KEY), IntegrationCryptoError);
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.throws(() => decryptSecret(payload, "", KEY), IntegrationCryptoError);
  });

  test("rejects a key of the wrong size", () => {
    assert.throws(() => encryptSecret(SECRET, AAD, Buffer.alloc(16, 1)), IntegrationCryptoError);
    const payload = encryptSecret(SECRET, AAD, KEY);
    assert.throws(() => decryptSecret(payload, AAD, Buffer.alloc(16, 1)), IntegrationCryptoError);
  });
});

describe("parseEncryptionKey", () => {
  test("accepts standard, URL-safe and unpadded base64", () => {
    const standard = KEY.toString("base64");
    assert.deepEqual(parseEncryptionKey(standard), KEY);
    assert.deepEqual(parseEncryptionKey(KEY.toString("base64url")), KEY);
    assert.deepEqual(parseEncryptionKey(standard.replace(/=+$/, "")), KEY);
    assert.deepEqual(parseEncryptionKey(`  ${standard}  `), KEY);
  });

  test("rejects missing, blank and invalid values", () => {
    for (const raw of [undefined, null, "", "   ", "not base64!!!"]) {
      assert.throws(() => parseEncryptionKey(raw), IntegrationCryptoError);
    }
  });

  test("rejects a key that decodes to the wrong length", () => {
    assert.throws(
      () => parseEncryptionKey(Buffer.alloc(16, 1).toString("base64")),
      IntegrationCryptoError
    );
    assert.throws(
      () => parseEncryptionKey(Buffer.alloc(64, 1).toString("base64")),
      IntegrationCryptoError
    );
  });
});

describe("environment key loading", () => {
  test("returns null when the variable is absent or blank", () => {
    assert.equal(encryptionKeyFromEnv({}), null);
    assert.equal(encryptionKeyFromEnv({ [ENCRYPTION_KEY_ENV]: "   " }), null);
  });

  test("loads a valid key and throws on an invalid one", () => {
    assert.deepEqual(
      encryptionKeyFromEnv({ [ENCRYPTION_KEY_ENV]: KEY.toString("base64") }),
      KEY
    );
    assert.throws(
      () => encryptionKeyFromEnv({ [ENCRYPTION_KEY_ENV]: "short" }),
      IntegrationCryptoError
    );
  });

  test("requireEncryptionKey explains how to create one", () => {
    const err = errorOf(() => requireEncryptionKey({}));
    assert.equal(err.message.includes(ENCRYPTION_KEY_ENV), true);
    assert.equal(err.message.includes("openssl rand -base64 32"), true);
    assert.deepEqual(
      requireEncryptionKey({ [ENCRYPTION_KEY_ENV]: KEY.toString("base64") }),
      KEY
    );
  });
});

describe("isEncryptedSecret", () => {
  test("recognises generated payloads", () => {
    assert.equal(isEncryptedSecret(encryptSecret(SECRET, AAD, KEY)), true);
    assert.equal(isEncryptedSecret(encryptSecret("", AAD, KEY)), true);
  });

  test("rejects plaintext and malformed values", () => {
    const iv = Buffer.alloc(12, 1).toString("base64url");
    const tag = Buffer.alloc(16, 2).toString("base64url");
    for (const value of [
      SECRET,
      "",
      null,
      undefined,
      42,
      {},
      `v2.${iv}.${tag}.abc`,
      `v1.${iv}.${tag}`,
      `v1.${Buffer.alloc(8, 1).toString("base64url")}.${tag}.abc`,
    ]) {
      assert.equal(isEncryptedSecret(value), false, String(value));
    }
  });
});

describe("maskSecret", () => {
  test("shows only the last four characters", () => {
    assert.equal(maskSecret("supersecret"), "••••cret");
    assert.equal(maskSecret("abcd"), "••••");
    assert.equal(maskSecret("abc"), "••••");
    assert.equal(maskSecret(""), "");
  });
});
