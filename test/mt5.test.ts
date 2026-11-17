import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMt5BrokerAdapter, mt5AccountRef, getBrokerAdapter } from "../src/server/broker";
import {
  mt5ConfigFromValues,
  mt5FetchHistory,
  mt5ListPositions,
  mt5SetupIssues,
  parseMt5Candles,
  parseMt5History,
  parseMt5Orders,
  parseMt5Positions,
  parseMt5Symbols,
  testMt5Bridge,
  type Mt5BridgeConfig,
} from "../src/server/mt5/bridge";

const CONFIG: Mt5BridgeConfig = {
  bridgeUrl: "http://127.0.0.1:8000",
  apiKey: "bridge-secret",
  accountId: "market-demo",
  mode: "demo",
  enabled: true,
  userId: "market",
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("MT5 configuration", () => {
  test("normalizes stored values", () => {
    const config = mt5ConfigFromValues({
      bridgeUrl: "http://127.0.0.1:8000/",
      apiKey: "secret",
      accountId: "main",
      mode: "live",
      enabled: true,
    });
    assert.equal(config.bridgeUrl, "http://127.0.0.1:8000");
    assert.equal(config.mode, "live");
    assert.equal(config.enabled, true);
    assert.equal(config.userId, "market");
  });

  test("rejects an invalid bridge URL and warns about remote keys", () => {
    const bad = mt5SetupIssues({ bridgeUrl: "ftp://bridge" });
    assert.equal(bad.errors.length, 1);
    const remote = mt5SetupIssues({ bridgeUrl: "http://bridge.local", mode: "live" });
    assert.equal(remote.errors.length, 0);
    assert.equal(remote.warnings.some((line) => /https/.test(line)), true);
    assert.equal(remote.warnings.some((line) => /API key/.test(line)), true);
    assert.equal(remote.warnings.some((line) => /Live/.test(line)), true);
  });

  test("registers the broker adapter", () => {
    assert.equal(getBrokerAdapter("mt5").id, "mt5");
  });
});

describe("MT5 bridge payloads", () => {
  test("parses symbol records and candle aliases", () => {
    const symbols = parseMt5Symbols({
      symbols: [
        "EURUSD",
        {
          name: "XAUUSD",
          lot_size: 100,
          digits: 2,
          min_volume: 0.01,
          step_volume: 0.01,
          max_volume: 50,
          quote_asset: "USD",
        },
      ],
    });
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].lotSize, 100_000);
    assert.equal(symbols[1].symbol, "XAUUSD");
    assert.equal(symbols[1].quoteAsset, "USD");

    const candles = parseMt5Candles({
      candles: [{ t: 1_700_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }],
    });
    assert.equal(candles[0].time, 1_700_000_000_000);
    assert.equal(candles[0].close, 1.5);
  });

  test("parses positions, orders and closed deals", () => {
    const positions = parseMt5Positions({
      positions: [
        {
          ticket: 11,
          symbolName: "EURUSD",
          type: "buy",
          volume: 0.25,
          openPrice: 1.1,
          profit: 12.5,
          openTime: 1_700_000_000,
        },
      ],
    });
    assert.equal(positions[0].id, "11");
    assert.equal(positions[0].symbol, "EURUSD");
    assert.equal(positions[0].side, "BUY");
    assert.equal(positions[0].profitUsd, 12.5);

    const orders = parseMt5Orders({
      orders: [
        { ticket: 12, symbol: "XAUUSD", type: "sell limit", volume: 0.1, openPrice: 4100 },
      ],
    });
    assert.equal(orders[0].id, "12");
    assert.equal(orders[0].side, "SELL");
    assert.equal(orders[0].price, 4100);

    const history = parseMt5History(
      {
        history: [
          {
            dealId: 99,
            symbol: "EURUSD",
            type: "sell",
            volume: 1,
            entryPrice: 1.2,
            closePrice: 1.1,
            profit: 100,
            swap: -2,
            commission: -3,
            closeTime: 1_700_000_000,
          },
        ],
      },
      7
    );
    assert.equal(history.trades.length, 1);
    assert.equal(history.trades[0].id, "99");
    assert.equal(history.trades[0].net, 95);
    assert.equal(history.days, 7);
  });

  test("sends per-user credentials as headers", async () => {
    const original = globalThis.fetch;
    let headers = new Headers();
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return jsonResponse({ positions: [] });
    }) as typeof fetch;
    try {
      await mt5ListPositions({
        ...CONFIG,
        credentials: {
          login: "12345",
          server: "Broker-Demo",
          password: "secret",
          investorPassword: "viewer",
        },
      });
      assert.equal(headers.get("X-MT5-Login"), "12345");
      assert.equal(headers.get("X-MT5-Server"), "Broker-Demo");
      assert.equal(headers.get("X-MT5-Mode"), "demo");
      assert.equal(headers.get("X-MT5-Password"), "secret");
      assert.equal(headers.get("X-MT5-Investor-Password"), "viewer");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("MT5 read-only adapter", () => {
  test("reads symbols, quotes and candles through the bridge", async () => {
    const original = globalThis.fetch;
    const requests: URL[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname === "/health") {
        return jsonResponse({ ok: true, broker: "MT5 Demo" });
      }
      if (url.pathname === "/symbols") {
        return jsonResponse({
          symbols: [
            {
              symbol: "XAUUSD",
              lotSize: 100,
              digits: 2,
              minVolume: 0.01,
              stepVolume: 0.01,
              maxVolume: 50,
              quoteAsset: "USD",
            },
          ],
        });
      }
      if (url.pathname === "/quote") {
        return jsonResponse({ bid: 4100.1, ask: 4100.3, digits: 2, time: 123 });
      }
      if (url.pathname === "/candles") {
        return jsonResponse({
          candles: [{ time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 4 }],
        });
      }
      if (url.pathname === "/positions") {
        return jsonResponse({
          positions: [
            {
              ticket: 1,
              symbol: "XAUUSD",
              side: "BUY",
              lots: 0.1,
              entryPrice: 4100,
              profit: 10,
            },
          ],
        });
      }
      if (url.pathname === "/orders") {
        return jsonResponse({
          orders: [
            {
              ticket: 2,
              symbol: "XAUUSD",
              side: "SELL",
              orderType: "LIMIT",
              lots: 0.1,
              price: 4200,
            },
          ],
        });
      }
      if (url.pathname === "/history") {
        return jsonResponse({
          history: [
            {
              ticket: 3,
              symbol: "XAUUSD",
              side: "BUY",
              lots: 0.1,
              entryPrice: 4000,
              closePrice: 4100,
              profit: 10,
              closeTime: 1_700_000_000,
            },
          ],
        });
      }
      throw new Error(`unexpected path ${url.pathname}`);
    }) as typeof fetch;

    try {
      const adapter = createMt5BrokerAdapter(async () => CONFIG);
      const ref = mt5AccountRef(CONFIG);
      const symbol = await adapter.resolveSymbol(ref, "xauusd");
      assert.equal(symbol?.spec.symbol, "XAUUSD");
      assert.equal(symbol?.spec.lotSize, 100);
      assert.equal(await adapter.quoteUsdFactor(ref, "XAUUSD"), 1);
      assert.equal((await adapter.quote(ref, "XAUUSD"))?.bid, 4100.1);
      const candles = await adapter.fetchCandles(ref, {
        symbol: "XAUUSD",
        timeframe: { id: "15m", ms: 900_000, native: { mt5: "M15" } },
      });
      assert.equal(candles.length, 1);
      assert.equal(candles[0].close, 1.5);
      const reconciliation = await adapter.reconcile(ref);
      assert.equal(reconciliation.positions[0].id, "1");
      assert.equal(reconciliation.orders[0].id, "2");
      const history = await adapter.fetchHistory(ref, 7);
      assert.equal(history.trades[0].id, "3");
      assert.equal(
        requests.some((url) => url.pathname === "/history" && url.searchParams.get("days") === "7"),
        true
      );

      const result = await testMt5Bridge({
        bridgeUrl: CONFIG.bridgeUrl,
        apiKey: CONFIG.apiKey,
        accountId: CONFIG.accountId,
      });
      assert.equal(result.ok, true);
      assert.match(result.message, /MT5 Demo/);

      assert.equal(requests.every((url) => url.searchParams.get("account") === "market-demo"), true);
      assert.equal(
        requests.some((url) => url.searchParams.get("timeframe") === "M15"),
        true
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  test("rejects write actions", async () => {
    const adapter = createMt5BrokerAdapter(async () => CONFIG);
    const ref = mt5AccountRef(CONFIG);
    await assert.rejects(() => adapter.placeOrder(ref, {}), /read-only phase/);
  });
});
