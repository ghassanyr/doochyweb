import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ctraderAccountRef,
  ctraderBrokerAdapter,
  getBrokerAdapter,
  isBrokerId,
  registeredBrokerIds,
} from "../src/server/broker";
import type { BrokerAccountRef, BrokerAdapter } from "../src/server/broker";

const ADAPTER_METHODS = [
  "listAccounts",
  "reconcile",
  "resolveSymbol",
  "listSymbolNames",
  "quote",
  "quoteUsdFactor",
  "fetchHistory",
  "fetchCandles",
  "previewOrder",
  "placeOrder",
  "modifyOrder",
  "cancelOrder",
  "closePosition",
  "amendPositionSLTP",
] as const;

const fakeMt5Adapter: BrokerAdapter = {
  id: "mt5",

  async listAccounts() {
    return [
      {
        id: "mt5-1",
        broker: "mt5",
        login: "5001",
        name: "Fake MT5",
        mode: "demo",
        balance: 1000,
        currency: "USD",
        nickname: null,
        color: null,
      },
    ];
  },

  async reconcile(ref) {
    assert.equal(ref.broker, "mt5");
    return { positions: [], orders: [] };
  },

  async resolveSymbol(ref, symbol) {
    assert.equal(ref.broker, "mt5");
    return {
      id: symbol,
      spec: {
        symbol,
        lotSize: 100_000,
        digits: 5,
        minVolume: 1_000,
        stepVolume: 1_000,
        maxVolume: 10_000_000,
        quoteAsset: "USD",
      },
    };
  },

  async listSymbolNames() {
    return ["EURUSD"];
  },

  async quote() {
    return { symbol: "EURUSD", bid: 1.1, ask: 1.1001, digits: 5, time: 1 };
  },

  async quoteUsdFactor() {
    return 1;
  },

  async fetchHistory() {
    return { trades: [], days: 7, truncated: false };
  },

  async fetchCandles(_ref, query) {
    return [
      {
        time: query.timeframe.ms,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      },
    ];
  },

  async previewOrder() {
    return {
      ok: true,
      preview: {
        symbol: "EURUSD",
        snapped: false,
        lots: 0.1,
        minLots: 0.01,
        lotStep: 0.01,
        entryRef: 1.1,
        riskUsd: 10,
        rewardUsd: 20,
        rr: 2,
        warnings: [],
      },
    };
  },

  async placeOrder() {
    return { ok: true, note: "placed" };
  },

  async modifyOrder() {
    return { ok: true };
  },

  async cancelOrder() {
    return { ok: true };
  },

  async closePosition() {
    return { ok: true };
  },

  async amendPositionSLTP() {
    return { ok: true };
  },
};

function assertAdapterContract(adapter: BrokerAdapter): void {
  assert.ok(adapter.id);
  for (const method of ADAPTER_METHODS) {
    assert.equal(typeof adapter[method], "function", `${adapter.id} must implement ${method}`);
  }
}

describe("broker adapter seam", () => {
  test("cTrader adapter satisfies the broker contract", () => {
    assertAdapterContract(ctraderBrokerAdapter);
    assert.equal(ctraderBrokerAdapter.id, "ctrader");
  });

  test("fake MT5 adapter satisfies the broker contract", () => {
    assertAdapterContract(fakeMt5Adapter);
    assert.equal(fakeMt5Adapter.id, "mt5");
  });

  test("cTrader account references are provider neutral", () => {
    assert.deepEqual(ctraderAccountRef("u1", 42, false), {
      userId: "u1",
      broker: "ctrader",
      accountId: "42",
      mode: "demo",
    });
    assert.deepEqual(ctraderAccountRef("u1", 42, true), {
      userId: "u1",
      broker: "ctrader",
      accountId: "42",
      mode: "live",
    });
  });

  test("fake MT5 adapter accepts MT5 account references", async () => {
    const ref: BrokerAccountRef = {
      userId: "u1",
      broker: "mt5",
      accountId: "mt5-1",
      mode: "demo",
    };
    const accounts = await fakeMt5Adapter.listAccounts(ref.userId);
    assert.equal(accounts[0].broker, "mt5");

    const symbol = await fakeMt5Adapter.resolveSymbol(ref, "EURUSD");
    assert.equal(symbol?.id, "EURUSD");
    assert.equal(symbol?.spec.lotSize, 100_000);

    const preview = await fakeMt5Adapter.previewOrder(ref, { symbol: "EURUSD", lots: 0.1 });
    assert.equal(preview.ok, true);
    assert.equal(preview.preview?.rewardUsd, 20);
  });

  test("registry exposes only implemented adapters", () => {
    assert.equal(getBrokerAdapter("ctrader"), ctraderBrokerAdapter);
    assert.deepEqual(registeredBrokerIds(), ["ctrader"]);
    assert.throws(() => getBrokerAdapter("mt5"), /No broker adapter registered for mt5/);
    assert.equal(isBrokerId("mt5"), true);
    assert.equal(isBrokerId("binance"), false);
  });
});
