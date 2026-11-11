import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { deleteUser, listUsers } from "../src/server/admin/users";
import { Credentials, User } from "../src/server/db";
import { TelegramLink, TelegramLinkCode } from "../src/server/telegram/store";

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f1f77bcf86cd799439012";

// The helpers are thin wrappers over mongoose queries, so these tests stub the
// model statics rather than needing a live database.

type LeanQuery<T> = { lean: () => { exec: () => Promise<T> } };

function leanQuery<T>(value: T): LeanQuery<T> {
  return { lean: () => ({ exec: async () => value }) };
}

function execQuery<T>(value: T) {
  return { exec: async () => value };
}

const originals = {
  findById: User.findById,
  find: User.find,
  countDocuments: User.countDocuments,
  deleteOne: User.deleteOne,
  credentialsDeleteMany: Credentials.deleteMany,
  linkDeleteMany: TelegramLink.deleteMany,
  codeDeleteMany: TelegramLinkCode.deleteMany,
};

afterEach(() => {
  (User as any).findById = originals.findById;
  (User as any).find = originals.find;
  (User as any).countDocuments = originals.countDocuments;
  (User as any).deleteOne = originals.deleteOne;
  (Credentials as any).deleteMany = originals.credentialsDeleteMany;
  (TelegramLink as any).deleteMany = originals.linkDeleteMany;
  (TelegramLinkCode as any).deleteMany = originals.codeDeleteMany;
});

function stubFindById(user: any) {
  (User as any).findById = () => leanQuery(user);
}

function stubCount(value: number) {
  (User as any).countDocuments = () => execQuery(value);
}

function stubList(docs: any[]) {
  (User as any).find = () => ({ sort: () => leanQuery(docs) });
}

function stubDeletes() {
  const calls: string[] = [];
  (Credentials as any).deleteMany = (filter: any) => {
    calls.push(`credentials:${String(filter.userId)}`);
    return execQuery({});
  };
  (TelegramLink as any).deleteMany = (filter: any) => {
    calls.push(`link:${String(filter.userId)}`);
    return execQuery({});
  };
  (TelegramLinkCode as any).deleteMany = (filter: any) => {
    calls.push(`code:${String(filter.userId)}`);
    return execQuery({});
  };
  (User as any).deleteOne = (filter: any) => {
    calls.push(`user:${String(filter._id)}`);
    return execQuery({});
  };
  return calls;
}

describe("listUsers", () => {
  test("maps users to the admin shape and never leaks the password hash", async () => {
    stubList([
      {
        _id: USER_ID,
        username: "alice",
        email: "alice@example.com",
        role: "admin",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        passwordHash: "secret",
      },
      { _id: OTHER_ID, username: "bob", role: undefined },
    ]);

    const rows = await listUsers();
    assert.deepEqual(rows, [
      {
        id: USER_ID,
        username: "alice",
        email: "alice@example.com",
        role: "admin",
        createdAt: "2026-01-02T03:04:05.000Z",
      },
      {
        id: OTHER_ID,
        username: "bob",
        email: null,
        role: "user",
        createdAt: null,
      },
    ]);
    assert.equal("passwordHash" in rows[0], false);
  });
});

describe("deleteUser", () => {
  test("rejects an invalid id", async () => {
    assert.equal(await deleteUser("not-an-object-id", OTHER_ID), "missing");
  });

  test("refuses to delete the acting admin", async () => {
    assert.equal(await deleteUser(USER_ID, USER_ID), "self");
  });

  test("reports a user that no longer exists", async () => {
    stubFindById(null);
    assert.equal(await deleteUser(USER_ID, OTHER_ID), "missing");
  });

  test("refuses to delete the last admin", async () => {
    stubFindById({ _id: USER_ID, role: "admin" });
    stubCount(1);
    const calls = stubDeletes();
    assert.equal(await deleteUser(USER_ID, OTHER_ID), "last_admin");
    assert.deepEqual(calls, []);
  });

  test("deletes a regular user and cleans up owned rows", async () => {
    stubFindById({ _id: USER_ID, role: "user" });
    const calls = stubDeletes();
    assert.equal(await deleteUser(USER_ID, OTHER_ID), "deleted");
    assert.deepEqual(calls.sort(), [
      `code:${USER_ID}`,
      `credentials:${USER_ID}`,
      `link:${USER_ID}`,
      `user:${USER_ID}`,
    ]);
  });

  test("deletes an admin when another admin remains", async () => {
    stubFindById({ _id: USER_ID, role: "admin" });
    stubCount(2);
    const calls = stubDeletes();
    assert.equal(await deleteUser(USER_ID, OTHER_ID), "deleted");
    assert.ok(calls.includes(`user:${USER_ID}`));
  });
});
