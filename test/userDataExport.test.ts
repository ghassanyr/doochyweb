import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { PriceAlert } from "../src/server/alerts/store";
import { Briefing } from "../src/server/briefing/store";
import { CoachReportModel } from "../src/server/coach/store";
import { Credentials, User } from "../src/server/db";
import { JournalEntry, JournalSync } from "../src/server/journal/store";
import { UserWatchlist } from "../src/server/market/userWatchlist";
import { PaperPosition } from "../src/server/simulation/store";
import { TelegramLink } from "../src/server/telegram/store";
import {
  USER_EXPORT_FORMAT,
  USER_EXPORT_VERSION,
  exportUserData,
  userDataExportFilename,
} from "../src/server/userDataExport";

const USER_ID = "507f1f77bcf86cd799439011";

function leanQuery<T>(value: T) {
  return { lean: () => ({ exec: async () => value }) };
}

function sortedQuery<T>(value: T) {
  return { sort: () => leanQuery(value) };
}

const originals = {
  userFindById: User.findById,
  credentialsFindOne: Credentials.findOne,
  alertFind: PriceAlert.find,
  journalFind: JournalEntry.find,
  syncFindOne: JournalSync.findOne,
  paperFind: PaperPosition.find,
  briefingFind: Briefing.find,
  coachFind: CoachReportModel.find,
  telegramFindOne: TelegramLink.findOne,
  watchlistFindOne: UserWatchlist.findOne,
};

afterEach(() => {
  (User as any).findById = originals.userFindById;
  (Credentials as any).findOne = originals.credentialsFindOne;
  (PriceAlert as any).find = originals.alertFind;
  (JournalEntry as any).find = originals.journalFind;
  (JournalSync as any).findOne = originals.syncFindOne;
  (PaperPosition as any).find = originals.paperFind;
  (Briefing as any).find = originals.briefingFind;
  (CoachReportModel as any).find = originals.coachFind;
  (TelegramLink as any).findOne = originals.telegramFindOne;
  (UserWatchlist as any).findOne = originals.watchlistFindOne;
});

describe("user data export", () => {
  test("maps owned data without password hashes or integration secrets", async () => {
    (User as any).findById = () =>
      leanQuery({
        _id: USER_ID,
        username: "ada",
        email: "ada@example.com",
        passwordHash: "password-hash-secret",
        tokenVersion: 7,
        role: "user",
        status: "active",
        emailVerified: true,
        termsAcceptedAt: new Date("2026-11-01T00:00:00.000Z"),
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      });
    (Credentials as any).findOne = () =>
      leanQuery({
        userId: USER_ID,
        clientId: "client-id",
        clientSecret: "client-secret",
        accessToken: "access-token-secret",
        refreshToken: "refresh-token-secret",
        accounts: [
          { ctid: 1, login: 123, broker: "Broker", isLive: false, nickname: "Main", color: "teal" },
        ],
        updatedAt: new Date("2026-11-02T00:00:00.000Z"),
      });
    (PriceAlert as any).find = () =>
      sortedQuery([
        {
          _id: "alert-1",
          symbol: "EURUSD",
          condition: "above",
          level: 1.1,
          note: "watch",
          status: "active",
          createdAt: new Date("2026-11-03T00:00:00.000Z"),
          updatedAt: new Date("2026-11-03T00:00:00.000Z"),
        },
      ]);
    (JournalEntry as any).find = () =>
      sortedQuery([
        {
          _id: "journal-1",
          source: "manual",
          symbol: "EURUSD",
          side: "buy",
          status: "open",
          tags: [],
          createdAt: new Date("2026-11-04T00:00:00.000Z"),
          updatedAt: new Date("2026-11-04T00:00:00.000Z"),
        },
      ]);
    (JournalSync as any).findOne = () =>
      leanQuery({ lastRunAt: new Date("2026-11-05T00:00:00.000Z"), lastImported: 2 });
    (PaperPosition as any).find = () =>
      sortedQuery([
        {
          _id: "paper-1",
          symbol: "EURUSD",
          side: "buy",
          notional: 1000,
          entryPrice: 1.1,
          status: "open",
          openedAt: new Date("2026-11-06T00:00:00.000Z"),
          createdAt: new Date("2026-11-06T00:00:00.000Z"),
        },
      ]);
    (Briefing as any).find = () =>
      sortedQuery([
        {
          dateKey: "2026-11-07",
          generatedAt: new Date("2026-11-07T00:00:00.000Z"),
          model: "test-model",
          narrative: "brief",
          snapshot: {
            dateKey: "2026-11-07",
            generatedAt: "2026-11-07T00:00:00.000Z",
            movers: [],
            signals: [],
          },
        },
      ]);
    (CoachReportModel as any).find = () =>
      sortedQuery([
        {
          kind: "trade",
          key: "journal-1",
          generatedAt: new Date("2026-11-07T01:00:00.000Z"),
          model: "test-model",
          error: null,
          facts: { id: "journal-1" },
          sections: { summary: "review" },
        },
      ]);
    (TelegramLink as any).findOne = () =>
      leanQuery({
        userId: USER_ID,
        chatId: "chat-1",
        telegramUserId: "tg-1",
        username: "ada",
        firstName: "Ada",
        notificationsEnabled: true,
        linkedAt: new Date("2026-11-08T00:00:00.000Z"),
      });
    (UserWatchlist as any).findOne = () =>
      leanQuery({
        userId: USER_ID,
        mode: "mine",
        symbols: ["EURUSD", "XAUUSD"],
        order: ["XAUUSD", "EURUSD"],
      });

    const data = await exportUserData(USER_ID, new Date("2026-11-15T10:00:00.000Z"));
    assert.ok(data);
    assert.equal(data.format, USER_EXPORT_FORMAT);
    assert.equal(data.version, USER_EXPORT_VERSION);
    assert.equal(data.user.username, "ada");
    assert.equal(data.ctrader.connected, true);
    assert.equal(data.ctrader.mode, "manual");
    assert.equal(data.ctrader.accounts[0].nickname, "Main");
    assert.equal(data.alerts.length, 1);
    assert.equal(data.journal.entries.length, 1);
    assert.equal(data.journal.sync?.lastImported, 2);
    assert.equal(data.paperTrading.length, 1);
    assert.equal(data.paperTrading[0].sizeMode, "usd");
    assert.equal(data.paperTrading[0].lots, null);
    assert.equal(data.briefings.length, 1);
    assert.equal(data.coachReports.length, 1);
    assert.equal(data.coachReports[0].key, "journal-1");
    assert.equal(data.telegram?.chatId, "chat-1");
    assert.deepEqual(data.watchlist, {
      mode: "mine",
      symbols: ["EURUSD", "XAUUSD"],
      order: ["XAUUSD", "EURUSD"],
    });

    const text = JSON.stringify(data);
    for (const secret of [
      "password-hash-secret",
      "client-secret",
      "access-token-secret",
      "refresh-token-secret",
    ]) {
      assert.equal(text.includes(secret), false);
    }
    assert.equal(text.includes("tokenVersion"), false);
  });

  test("returns null for an unknown or malformed user id", async () => {
    assert.equal(await exportUserData("not-an-object-id"), null);
    (User as any).findById = () => leanQuery(null);
    (Credentials as any).findOne = () => leanQuery(null);
    (PriceAlert as any).find = () => sortedQuery([]);
    (JournalEntry as any).find = () => sortedQuery([]);
    (JournalSync as any).findOne = () => leanQuery(null);
    (PaperPosition as any).find = () => sortedQuery([]);
    (Briefing as any).find = () => sortedQuery([]);
    (CoachReportModel as any).find = () => sortedQuery([]);
    (TelegramLink as any).findOne = () => leanQuery(null);
    (UserWatchlist as any).findOne = () => leanQuery(null);
    assert.equal(await exportUserData(USER_ID), null);
  });

  test("builds a safe download filename", () => {
    assert.equal(
      userDataExportFilename(" Ada / Lovelace! ", new Date("2026-11-15T10:11:12.345Z")),
      "doochy-Ada-Lovelace-2026-11-15T10-11-12-345Z.json"
    );
  });
});
