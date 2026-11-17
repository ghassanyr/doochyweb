import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { demoWriteGuard, sessionFromRequest, signDemoToken, signToken } from "../src/server/auth";
import { isDemoUser, User } from "../src/server/db";
import {
  demoAlerts,
  demoBriefing,
  demoCoachTrades,
  demoCoachWeekly,
  demoHistory,
  demoJournalList,
  demoOrders,
  demoPositions,
  demoQuote,
} from "../src/server/demo/fixtures";
import { DEFAULT_DEMO } from "../src/server/settings/defaults";
import { normalizeDemo } from "../src/server/settings/validate";

const DEMO_ID = "507f1f77bcf86cd799439011";
const NORMAL_ID = "507f1f77bcf86cd799439012";

type LeanQuery<T> = { lean: () => { exec: () => Promise<T> } };

function leanQuery<T>(value: T): LeanQuery<T> {
  return { lean: () => ({ exec: async () => value }) };
}

const originalFindById = User.findById;

afterEach(() => {
  (User as any).findById = originalFindById;
});

function bearer(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as any;
}

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

async function runWriteGuard(token: string, method: string) {
  const { res, captured } = mockRes();
  let nextCalled = false;
  await demoWriteGuard({ method, headers: { authorization: `Bearer ${token}` } } as any, res, () => {
    nextCalled = true;
  });
  return { captured, nextCalled };
}

describe("demo fixtures", () => {
  test("expose the fixed account, positions and orders", () => {
    assert.equal(demoPositions().length, 7);
    assert.equal(demoOrders().length, 3);
    assert.equal(demoQuote("EURUSD")?.symbol, "EURUSD");
    assert.equal(demoQuote("NOPE"), null);
  });

  test("expose 12 closed trades and 3 open ideas", () => {
    assert.equal(demoJournalList().total, 15);
    assert.equal(demoJournalList({ status: "closed" }).total, 12);
    assert.equal(demoJournalList({ status: "open" }).total, 3);
    assert.equal(demoHistory(30).trades.length, 12);
    const briefing = demoBriefing();
    assert.equal(briefing.briefing?.snapshot.journalIdeas.length, 3);
    assert.deepEqual(briefing.preferences.focusSessions, ["london", "newyork"]);
  });

  test("expose the fixed alerts and coach reports", () => {
    assert.equal(demoAlerts().alerts.length, 4);
    assert.equal(demoAlerts().counts.total, 4);
    assert.equal(demoCoachWeekly().weeks.length, 1);
    const trades = demoCoachTrades().trades;
    assert.equal(trades.length, 12);
    assert.equal(trades.filter((trade) => trade.reviewed).length, 3);
  });
});

describe("demo sessions", () => {
  test("accepts a demo token for the demo user", async () => {
    (User as any).findById = () =>
      leanQuery({ _id: DEMO_ID, username: "doochy-demo", role: "user", accountType: "demo", tokenVersion: 0 });
    const session = await sessionFromRequest(bearer(signDemoToken(DEMO_ID)));
    assert.equal(session?.demo, true);
    assert.equal(session?.accountType, "demo");
    assert.equal(session?.role, "user");
  });

  test("rejects a normal token for the demo user", async () => {
    (User as any).findById = () =>
      leanQuery({ _id: DEMO_ID, username: "doochy-demo", role: "user", accountType: "demo", tokenVersion: 0 });
    const session = await sessionFromRequest(bearer(signToken(DEMO_ID)));
    assert.equal(session, null);
  });

  test("rejects a demo token for a normal user", async () => {
    (User as any).findById = () =>
      leanQuery({ _id: NORMAL_ID, username: "member", role: "user", accountType: "normal", tokenVersion: 0 });
    const session = await sessionFromRequest(bearer(signDemoToken(NORMAL_ID)));
    assert.equal(session, null);
  });

  test("recognizes the demo account type", () => {
    assert.equal(isDemoUser({ accountType: "demo" }), true);
    assert.equal(isDemoUser({ accountType: "normal" }), false);
    assert.equal(isDemoUser(null), false);
  });

  test("blocks demo writes and allows demo reads", async () => {
    (User as any).findById = () =>
      leanQuery({ _id: DEMO_ID, username: "doochy-demo", role: "user", accountType: "demo", tokenVersion: 0 });
    const blocked = await runWriteGuard(signDemoToken(DEMO_ID), "POST");
    assert.equal(blocked.captured.status, 403);
    assert.equal(blocked.captured.body.error, "demo account is read-only");
    assert.equal(blocked.nextCalled, false);

    const allowed = await runWriteGuard(signDemoToken(DEMO_ID), "GET");
    assert.equal(allowed.captured.status, null);
    assert.equal(allowed.nextCalled, true);
  });
});

describe("demo settings", () => {
  test("normalizes demo settings without dropping the enabled flag", () => {
    assert.deepEqual(normalizeDemo({}, DEFAULT_DEMO), DEFAULT_DEMO);
    assert.deepEqual(normalizeDemo({ enabled: false, label: "Preview" }, DEFAULT_DEMO), {
      enabled: false,
      label: "Preview",
    });
  });
});
