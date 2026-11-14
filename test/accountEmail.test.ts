import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import type { Request } from "express";

import { updateOwnEmail, type OwnEmailDeps } from "../src/server/accountEmail";
import { hashPassword } from "../src/server/auth";
import { AuthToken } from "../src/server/authTokens";
import { User } from "../src/server/db";

const USER_ID = "507f1f77bcf86cd799439011";
const req = {} as Request;

type LeanQuery<T> = { lean: () => { exec: () => Promise<T> } };

function leanQuery<T>(value: T): LeanQuery<T> {
  return { lean: () => ({ exec: async () => value }) };
}

function execQuery<T>(value: T) {
  return { exec: async () => value };
}

const originals = {
  findById: User.findById,
  findOne: User.findOne,
  updateOne: User.updateOne,
  tokenDeleteMany: AuthToken.deleteMany,
};

afterEach(() => {
  (User as any).findById = originals.findById;
  (User as any).findOne = originals.findOne;
  (User as any).updateOne = originals.updateOne;
  (AuthToken as any).deleteMany = originals.tokenDeleteMany;
});

function stubFindById(user: any) {
  (User as any).findById = () => leanQuery(user);
}

function stubFindOne(user: any) {
  (User as any).findOne = () => leanQuery(user);
}

function stubUpdate(matchedCount = 1) {
  const calls: any[][] = [];
  (User as any).updateOne = (...args: any[]) => {
    calls.push(args);
    return execQuery({ matchedCount });
  };
  return calls;
}

function stubTokenDelete() {
  const filters: any[] = [];
  (AuthToken as any).deleteMany = (filter: any) => {
    filters.push(filter);
    return execQuery({});
  };
  return filters;
}

function deps(overrides: OwnEmailDeps = {}): OwnEmailDeps {
  return {
    emailConfigured: async () => false,
    getSiteSettings: async () =>
      ({ registration: { requireEmailVerification: false } }) as any,
    sendVerification: async () => {},
    ...overrides,
  };
}

describe("updateOwnEmail", () => {
  test("rejects an invalid address before touching the database", async () => {
    const result = await updateOwnEmail(USER_ID, "not-an-email", "secret", req, deps());
    assert.deepEqual(result, { ok: false, status: 400, error: "email must be a valid address" });
  });

  test("requires the current password", async () => {
    const result = await updateOwnEmail(USER_ID, "new@example.test", "", req, deps());
    assert.deepEqual(result, {
      ok: false,
      status: 400,
      error: "Enter your current password to change your email.",
    });
  });

  test("rejects a wrong current password", async () => {
    stubFindById({
      _id: USER_ID,
      email: null,
      passwordHash: await hashPassword("correct"),
    });
    const result = await updateOwnEmail(USER_ID, "new@example.test", "wrong", req, deps());
    assert.deepEqual(result, {
      ok: false,
      status: 401,
      error: "Current password is incorrect.",
    });
  });

  test("refuses to reuse another account's email", async () => {
    stubFindById({
      _id: USER_ID,
      email: null,
      passwordHash: await hashPassword("secret"),
    });
    stubFindOne({ _id: "someone-else" });
    const update = stubUpdate();
    const result = await updateOwnEmail(USER_ID, "new@example.test", "secret", req, deps());
    assert.deepEqual(result, { ok: false, status: 409, error: "email already registered" });
    assert.equal(update.length, 0);
  });

  test("requires working delivery when verification is mandatory", async () => {
    stubFindById({
      _id: USER_ID,
      email: null,
      passwordHash: await hashPassword("secret"),
    });
    const update = stubUpdate();
    const result = await updateOwnEmail(
      USER_ID,
      "new@example.test",
      "secret",
      req,
      deps({
        emailConfigured: async () => false,
        getSiteSettings: async () =>
          ({ registration: { requireEmailVerification: true } }) as any,
      })
    );
    assert.deepEqual(result, {
      ok: false,
      status: 503,
      error: "Email verification is required but email delivery is not configured.",
    });
    assert.equal(update.length, 0);
  });

  test("saves and verifies a new address when delivery is available", async () => {
    stubFindById({
      _id: USER_ID,
      email: null,
      passwordHash: await hashPassword("secret"),
    });
    stubFindOne(null);
    const update = stubUpdate();
    const tokenFilters = stubTokenDelete();
    let sentTo: string | null = null;

    const result = await updateOwnEmail(
      USER_ID,
      " New@Example.TEST ",
      "secret",
      req,
      deps({
        emailConfigured: async () => true,
        sendVerification: async (userId) => {
          sentTo = userId;
        },
      })
    );

    assert.deepEqual(result, {
      ok: true,
      email: "new@example.test",
      emailVerified: false,
      verificationSent: true,
    });
    assert.equal(sentTo, USER_ID);
    assert.deepEqual(update, [
      [{ _id: USER_ID }, { $set: { email: "new@example.test", emailVerified: false } }],
    ]);
    assert.deepEqual(tokenFilters, [{ userId: USER_ID, purpose: "email_verification" }]);
  });

  test("stores an address as verified when delivery is not configured", async () => {
    stubFindById({
      _id: USER_ID,
      email: null,
      passwordHash: await hashPassword("secret"),
    });
    stubFindOne(null);
    const update = stubUpdate();
    stubTokenDelete();
    let sent = false;

    const result = await updateOwnEmail(
      USER_ID,
      "new@example.test",
      "secret",
      req,
      deps({
        emailConfigured: async () => false,
        sendVerification: async () => {
          sent = true;
        },
      })
    );

    assert.deepEqual(result, {
      ok: true,
      email: "new@example.test",
      emailVerified: true,
      verificationSent: false,
    });
    assert.equal(sent, false);
    assert.deepEqual(update, [
      [{ _id: USER_ID }, { $set: { email: "new@example.test", emailVerified: true } }],
    ]);
  });

  test("rolls the address back when the verification email fails", async () => {
    stubFindById({
      _id: USER_ID,
      email: "old@example.test",
      emailVerified: true,
      passwordHash: await hashPassword("secret"),
    });
    stubFindOne(null);
    const update = stubUpdate();
    stubTokenDelete();

    const result = await updateOwnEmail(
      USER_ID,
      "new@example.test",
      "secret",
      req,
      deps({
        emailConfigured: async () => true,
        sendVerification: async () => {
          throw new Error("smtp down");
        },
      })
    );

    assert.deepEqual(result, {
      ok: false,
      status: 502,
      error: "The email could not be sent, so it was not changed.",
    });
    assert.equal(update.length, 2);
    assert.deepEqual(update[1], [
      { _id: USER_ID },
      { $set: { emailVerified: true, email: "old@example.test" } },
    ]);
  });
});
