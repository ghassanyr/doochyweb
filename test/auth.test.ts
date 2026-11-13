import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { configuredAdminUsernames, setRole } from "../src/server/admin/roles";
import { adminRequired, signToken } from "../src/server/auth";
import { User } from "../src/server/db";
import { registrationDecision } from "../src/server/registrationPolicy";
import { DEFAULT_REGISTRATION } from "../src/server/settings/defaults";

const USER_ID = "507f1f77bcf86cd799439011";

// The guards are thin wrappers over two mongoose queries, so the tests swap the
// model statics for stubs instead of needing a live database.

type LeanQuery<T> = { lean: () => { exec: () => Promise<T> } };

function leanQuery<T>(value: T): LeanQuery<T> {
  return { lean: () => ({ exec: async () => value }) };
}

const originals = {
  findById: User.findById,
  findOne: User.findOne,
  countDocuments: User.countDocuments,
  updateOne: User.updateOne,
};

afterEach(() => {
  (User as any).findById = originals.findById;
  (User as any).findOne = originals.findOne;
  (User as any).countDocuments = originals.countDocuments;
  (User as any).updateOne = originals.updateOne;
});

// --- Express stubs --------------------------------------------------------

function mockRes() {
  const captured: { status: number | null; body: any } = { status: null, body: undefined };
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
  };
  return { res, captured };
}

function requestWith(token?: string) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as any;
}

async function runAdmin(token?: string) {
  const { res, captured } = mockRes();
  let nextCalled = false;
  const req = requestWith(token);
  await adminRequired(req, res, () => {
    nextCalled = true;
  });
  return { req, captured, nextCalled };
}

describe("adminRequired", () => {
  test("rejects a request without a bearer token", async () => {
    const { captured, nextCalled } = await runAdmin();
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });

  test("rejects an invalid token", async () => {
    const { captured, nextCalled } = await runAdmin("not-a-jwt");
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });

  test("rejects a token whose user no longer exists", async () => {
    (User as any).findById = () => leanQuery(null);
    const { captured, nextCalled } = await runAdmin(signToken(USER_ID));
    assert.equal(captured.status, 401);
    assert.equal(nextCalled, false);
  });

  test("treats a missing role as a plain user", async () => {
    (User as any).findById = () => leanQuery({ _id: USER_ID, username: "old" });
    const { captured, nextCalled } = await runAdmin(signToken(USER_ID));
    assert.equal(captured.status, 403);
    assert.equal(nextCalled, false);
  });

  test("rejects a signed-in non-admin", async () => {
    (User as any).findById = () => leanQuery({ _id: USER_ID, role: "user" });
    const { captured, nextCalled } = await runAdmin(signToken(USER_ID));
    assert.equal(captured.status, 403);
    assert.equal(nextCalled, false);
  });

  test("lets an admin through and records the role", async () => {
    (User as any).findById = () => leanQuery({ _id: USER_ID, role: "admin" });
    const { req, captured, nextCalled } = await runAdmin(signToken(USER_ID));
    assert.equal(nextCalled, true);
    assert.equal(captured.status, null);
    assert.equal(req.userId, USER_ID);
    assert.equal(req.role, "admin");
  });

  test("returns 500 when the role lookup fails", async () => {
    (User as any).findById = () => ({
      lean: () => ({
        exec: async () => {
          throw new Error("db down");
        },
      }),
    });
    const { captured, nextCalled } = await runAdmin(signToken(USER_ID));
    assert.equal(captured.status, 500);
    assert.equal(captured.body.error, "db down");
    assert.equal(nextCalled, false);
  });
});

// --- setRole --------------------------------------------------------------

function stubFindOne(user: any) {
  (User as any).findOne = () => leanQuery(user);
}

function stubCount(value: number) {
  (User as any).countDocuments = () => ({ exec: async () => value });
}

function stubUpdate() {
  const calls: any[][] = [];
  (User as any).updateOne = (...args: any[]) => {
    calls.push(args);
    return { exec: async () => ({}) };
  };
  return calls;
}

describe("setRole", () => {
  test("reports a missing user", async () => {
    stubFindOne(null);
    assert.equal(await setRole("ghost", "admin"), "missing");
  });

  test("promotes a user", async () => {
    stubFindOne({ _id: "id-1", role: "user" });
    const calls = stubUpdate();
    assert.equal(await setRole("alice", "admin"), "promoted");
    assert.deepEqual(calls, [[{ _id: "id-1" }, { $set: { role: "admin" } }]]);
  });

  test("is idempotent when already admin", async () => {
    stubFindOne({ _id: "id-1", role: "admin" });
    const calls = stubUpdate();
    assert.equal(await setRole("alice", "admin"), "already_admin");
    assert.equal(calls.length, 0);
  });

  test("is idempotent when already a plain user", async () => {
    stubFindOne({ _id: "id-1", role: "user" });
    const calls = stubUpdate();
    assert.equal(await setRole("alice", "user"), "not_admin");
    assert.equal(calls.length, 0);
  });

  test("demotes an admin when another admin remains", async () => {
    stubFindOne({ _id: "id-1", role: "admin" });
    stubCount(2);
    const calls = stubUpdate();
    assert.equal(await setRole("alice", "user"), "demoted");
    assert.deepEqual(calls, [[{ _id: "id-1" }, { $set: { role: "user" } }]]);
  });

  test("refuses to demote the last admin", async () => {
    stubFindOne({ _id: "id-1", role: "admin" });
    stubCount(1);
    const calls = stubUpdate();
    assert.equal(await setRole("alice", "user"), "last_admin");
    assert.equal(calls.length, 0);
  });
});

describe("configuredAdminUsernames", () => {
  test("parses a comma-separated list and trims blanks", () => {
    const previous = process.env.ADMIN_USERNAME;
    process.env.ADMIN_USERNAME = " alice, bob ,, ";
    try {
      assert.deepEqual(configuredAdminUsernames(), ["alice", "bob"]);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_USERNAME;
      else process.env.ADMIN_USERNAME = previous;
    }
  });

  test("returns nothing when unset", () => {
    const previous = process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_USERNAME;
    try {
      assert.deepEqual(configuredAdminUsernames(), []);
    } finally {
      if (previous !== undefined) process.env.ADMIN_USERNAME = previous;
    }
  });
});

describe("registration policy", () => {
  test("open registration activates the account", () => {
    assert.deepEqual(registrationDecision(DEFAULT_REGISTRATION, ""), {
      allowed: true,
      status: "active",
    });
  });

  test("approval registration creates a pending account", () => {
    assert.deepEqual(
      registrationDecision({ ...DEFAULT_REGISTRATION, mode: "approval" }, ""),
      { allowed: true, status: "pending" }
    );
  });

  test("invite registration requires the exact trimmed code", () => {
    const registration = {
      ...DEFAULT_REGISTRATION,
      mode: "invite" as const,
      inviteCode: "secret-code",
    };
    assert.deepEqual(registrationDecision(registration, " secret-code "), {
      allowed: true,
      status: "active",
    });
    assert.deepEqual(registrationDecision(registration, "wrong-code"), {
      allowed: false,
      error: "That invite code is not valid.",
    });
    assert.deepEqual(registrationDecision(registration, undefined), {
      allowed: false,
      error: "That invite code is not valid.",
    });
  });

  test("closed registration uses the configured message", () => {
    assert.deepEqual(
      registrationDecision(
        { ...DEFAULT_REGISTRATION, mode: "closed", message: "Invite only." },
        "anything"
      ),
      { allowed: false, error: "Invite only." }
    );
  });
});
