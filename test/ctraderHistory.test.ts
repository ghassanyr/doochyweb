import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clampHistoryDays,
  mapClosedDeal,
} from "../src/server/ctrader/history";
import type { SymbolSpec } from "../src/server/ctrader/reads";

const EURUSD: SymbolSpec = {
  name: "EURUSD",
  lotSize: 10_000_000,
  digits: 5,
  minVolume: 100_000,
  stepVolume: 100_000,
  maxVolume: 100_000_000,
  quoteAsset: "USD",
};

function closeDeal(overrides: Record<string, any> = {}): any {
  return {
    dealId: 42,
    orderId: 7,
    positionId: 9,
    symbolId: 1,
    tradeSide: "SELL",
    executionPrice: 1.105,
    executionTimestamp: 1_750_000_000_000,
    filledVolume: 20_000_000,
    dealStatus: 2,
    closePositionDetail: {
      entryPrice: 1.101,
      grossProfit: 8000,
      swap: -500,
      commission: -200,
      moneyDigits: 2,
    },
    ...overrides,
  };
}

describe("clampHistoryDays", () => {
  test("defaults to one week when the value is missing or not a number", () => {
    assert.equal(clampHistoryDays(undefined), 7);
    assert.equal(clampHistoryDays(null), 7);
    assert.equal(clampHistoryDays(""), 7);
    assert.equal(clampHistoryDays("not a number"), 7);
  });

  test("rounds and keeps the value inside the supported range", () => {
    assert.equal(clampHistoryDays(7.4), 7);
    assert.equal(clampHistoryDays(14), 14);
    assert.equal(clampHistoryDays("30"), 30);
    assert.equal(clampHistoryDays(90), 30);
  });

  test("never returns less than one day", () => {
    assert.equal(clampHistoryDays(0), 1);
    assert.equal(clampHistoryDays(-10), 1);
  });
});

describe("mapClosedDeal", () => {
  test("maps a filled closing deal to a round-trip row", () => {
    const row = mapClosedDeal(closeDeal(), EURUSD);

    assert.ok(row);
    assert.equal(row.dealId, 42);
    assert.equal(row.orderId, 7);
    assert.equal(row.positionId, 9);
    assert.equal(row.symbol, "EURUSD");
    // The closing deal sells, so the original position was a buy.
    assert.equal(row.side, "BUY");
    assert.equal(row.lots, 2);
    assert.equal(row.entryPrice, 1.101);
    assert.equal(row.exitPrice, 1.105);
    assert.equal(row.grossProfit, 80);
    assert.equal(row.swap, -5);
    assert.equal(row.commission, -2);
    assert.equal(row.net, 73);
    assert.equal(row.digits, 5);
    assert.equal(row.closeTimestamp, 1_750_000_000_000);
  });

  test("flips the side for a closing buy deal", () => {
    const row = mapClosedDeal(closeDeal({ tradeSide: "BUY" }), EURUSD);
    assert.equal(row?.side, "SELL");
  });

  test("uses the close position detail's own money digits when present", () => {
    const row = mapClosedDeal(
      closeDeal({
        closePositionDetail: {
          entryPrice: 1.101,
          grossProfit: 80_000,
          swap: -5_000,
          commission: -2_000,
          moneyDigits: 4,
        },
      }),
      EURUSD
    );

    assert.equal(row?.grossProfit, 8);
    assert.equal(row?.net, 7.3);
  });

  test("skips opening deals and deals without a close detail", () => {
    assert.equal(mapClosedDeal(closeDeal({ closePositionDetail: undefined }), EURUSD), null);
  });

  test("skips deals that are not filled", () => {
    assert.equal(mapClosedDeal(closeDeal({ dealStatus: 4 }), EURUSD), null);
    assert.equal(mapClosedDeal(closeDeal({ dealStatus: "REJECTED" }), EURUSD), null);
  });

  test("skips deals without a usable execution timestamp", () => {
    assert.equal(mapClosedDeal(closeDeal({ executionTimestamp: 0 }), EURUSD), null);
    assert.equal(mapClosedDeal(closeDeal({ executionTimestamp: undefined }), EURUSD), null);
  });

  test("keeps the raw volume when the broker has no lot size", () => {
    const row = mapClosedDeal(closeDeal(), { ...EURUSD, lotSize: 0 });
    assert.equal(row?.lots, 20_000_000);
  });
});
