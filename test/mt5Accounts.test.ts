import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { decryptSecret, parseEncryptionKey } from "../src/server/integrations/crypto";
import {
  addMt5Account,
  Mt5AccountModel,
  normalizeMt5AccountInput,
} from "../src/server/mt5/accounts";

const USER_ID = "507f1f77bcf86cd799439011";
const KEY = Buffer.alloc(32, 7).toString("base64");
const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
const originalCreate = Mt5AccountModel.create;
const originalFindOne = Mt5AccountModel.findOne;

afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
  else process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
  (Mt5AccountModel as any).create = originalCreate;
  (Mt5AccountModel as any).findOne = originalFindOne;
});

describe("MT5 account normalization", () => {
  test("requires login, server and password", () => {
    assert.deepEqual(normalizeMt5AccountInput({}), {
      ok: false,
      error: "login is required",
    });
    const result = normalizeMt5AccountInput({
      login: " 12345 ",
      server: " Broker-Demo ",
      password: " secret ",
      mode: "live",
      nickname: " Main ",
    });
    assert.deepEqual(result, {
      ok: true,
      value: {
        login: "12345",
        server: "Broker-Demo",
        password: "secret",
        investorPassword: null,
        mode: "live",
        currency: null,
        nickname: "Main",
        color: null,
      },
    });
  });
});

describe("MT5 account storage", () => {
  test("encrypts passwords with account-bound AAD", async () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = KEY;
    let created: any = null;
    (Mt5AccountModel as any).create = async (doc: any) => {
      created = doc;
      return doc;
    };
    (Mt5AccountModel as any).findOne = () => ({
      lean: () => ({ exec: async () => created }),
    });

    const view = await addMt5Account(USER_ID, {
      login: "12345",
      server: "Broker-Demo",
      password: "main-secret",
      investorPassword: "viewer-secret",
      mode: "demo",
      currency: "USD",
      nickname: "Main",
      color: null,
    });

    assert.equal(view.login, "12345");
    assert.equal(view.broker, "mt5");
    assert.match(created.password, /^v1\./);
    assert.match(created.investorPassword, /^v1\./);
    const serialized = JSON.stringify(created);
    assert.equal(serialized.includes("main-secret"), false);
    assert.equal(serialized.includes("viewer-secret"), false);

    const key = parseEncryptionKey(KEY);
    assert.equal(
      decryptSecret(
        created.password,
        `mt5:${USER_ID}:${created.accountId}:password`,
        key
      ),
      "main-secret"
    );
    assert.equal(
      decryptSecret(
        created.investorPassword,
        `mt5:${USER_ID}:${created.accountId}:investorPassword`,
        key
      ),
      "viewer-secret"
    );
    assert.throws(() =>
      decryptSecret(created.password, `mt5:${USER_ID}:other:password`, key)
    );
  });
});
