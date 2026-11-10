import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";

import express, { type Router } from "express";

import type { Candle } from "../src/server/market/types";
import {
  createAttemptStore,
  type AttemptStore,
} from "../src/server/trainer/attempts";
import { publicItemId } from "../src/server/trainer/payload";
import { createTrainerRouter } from "../src/server/trainer/routes";
import type {
  TrainerBatch,
  TrainerItem,
  TrainerSymbol,
  TrainerTimeframe,
} from "../src/server/trainer/types";

const SESSION = "session-0001";
const OTHER_SESSION = "session-0002";

function bar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): Candle {
  return { time, open, high, low, close, volume };
}

function makeBars(length = 120): Candle[] {
  const bars = Array.from({ length }, (_, i) =>
    bar(1_700_000_000_000 + i * 60_000, 100, 101, 99, 100, 10)
  );
  bars[61] = bar(bars[61].time, 100, 102, 99, 101, 20);
  bars[62] = bar(bars[62].time, 101, 101.5, 98, 99, 30);
  return bars;
}

function makeItem(overrides: Partial<TrainerItem> = {}): TrainerItem {
  const cutIndex = 60;
  return {
    id: "BTC:15m:bearish_engulfing:55-60:none",
    batchVersion: "test-v1",
    symbol: "BTC" as TrainerSymbol,
    timeframe: "15m" as TrainerTimeframe,
    tag: "bearish_engulfing",
    family: "candle",
    direction: null,
    contextStartIndex: 50,
    cutIndex,
    bounds: { startIndex: 55, endIndex: cutIndex },
    levels: { levelUpper: 101, levelLower: 99, neckline: null },
    barrier: {
      cutIndex,
      endIndex: cutIndex + 20,
      entry: 100,
      upper: 101,
      lower: 99,
      atr: 1,
      atrMult: 1,
      horizon: 20,
    },
    outcome: "up",
    outcomeIndex: cutIndex + 1,
    mfeAtr: 2,
    maeAtr: 1,
    mfeR: 2,
    maeR: 1,
    why: "bearish_engulfing: upper barrier reached after 1 bar(s).",
    ...overrides,
  };
}

function makeBatch(
  items: TrainerItem[],
  overrides: Partial<TrainerBatch> = {}
): TrainerBatch {
  return {
    version: "test-v1",
    createdAt: 123,
    symbols: ["BTC"],
    timeframes: ["15m"],
    barrierAtrMult: 1,
    barrierHorizon: 20,
    baseRates: {
      bearish_engulfing: { up: 0.5, down: 0.25, scratch: 0.25 },
      bullish_engulfing: { up: 0.25, down: 0.5, scratch: 0.25 },
      all: { up: 0.4, down: 0.4, scratch: 0.2 },
    },
    baseRateCounts: {
      bearish_engulfing: { up: 2, down: 1, scratch: 1 },
      bullish_engulfing: { up: 1, down: 2, scratch: 1 },
      all: { up: 4, down: 4, scratch: 2 },
    },
    items,
    ...overrides,
  };
}

function loadBarsFrom(series: Record<string, Candle[]>) {
  return async (
    symbol: TrainerSymbol,
    timeframe: TrainerTimeframe
  ): Promise<readonly Candle[] | null> => {
    return series[`${symbol}:${timeframe}`] ?? null;
  };
}

async function startServer(
  router: Router
): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/api/trainer", router);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function withRouter<T>(
  router: Router,
  fn: (base: string) => Promise<T>
): Promise<T> {
  const server = await startServer(router);
  try {
    return await fn(server.base);
  } finally {
    await server.close();
  }
}

async function getJson(
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() };
}

function postJson(url: string, body: unknown) {
  return getJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routerFor(
  batch: TrainerBatch | null,
  attempts?: AttemptStore,
  loadBars = loadBarsFrom({ "BTC:15m": makeBars() })
): Router {
  return createTrainerRouter({ batch, attempts, loadBars });
}

describe("trainer API: batch metadata", () => {
  test("returns 503 until a batch is published", async () => {
    await withRouter(routerFor(null), async (base) => {
      const { status, body } = await getJson(`${base}/api/trainer/batch`);
      assert.equal(status, 503);
      assert.deepEqual(body, { error: "no batch published" });
    });
  });

  test("returns metadata only, never items or identity", async () => {
    const batch = makeBatch([makeItem()]);
    await withRouter(routerFor(batch), async (base) => {
      const { status, body } = await getJson(`${base}/api/trainer/batch`);
      assert.equal(status, 200);
      assert.deepEqual(body, {
        version: "test-v1",
        createdAt: 123,
        itemCount: 1,
        barrierAtrMult: 1,
        barrierHorizon: 20,
      });
      assert.equal(JSON.stringify(body).includes("BTC"), false);
      assert.equal(JSON.stringify(body).includes("bearish_engulfing"), false);
    });
  });
});

describe("trainer API: session and item payloads", () => {
  test("validates the session id", async () => {
    await withRouter(routerFor(makeBatch([makeItem()])), async (base) => {
      const missing = await getJson(`${base}/api/trainer/session`);
      assert.equal(missing.status, 400);
      assert.deepEqual(missing.body, { error: "invalid sessionId" });

      const short = await getJson(
        `${base}/api/trainer/session?sessionId=short`
      );
      assert.equal(short.status, 400);
    });
  });

  test("clamps count and returns a deterministic, anonymized session", async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      makeItem({ id: `item-${String(i).padStart(2, "0")}` })
    );
    const batch = makeBatch(items);
    await withRouter(routerFor(batch), async (base) => {
      const first = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}&count=100`
      );
      assert.equal(first.status, 200);
      assert.equal(first.body.count, 20);
      assert.equal(first.body.items.length, 20);
      assert.equal(first.body.sessionId, SESSION);

      for (const item of first.body.items) {
        assert.deepEqual(Object.keys(item).sort(), [
          "context",
          "itemId",
          "question",
        ]);
        assert.ok(item.context.every((entry: { offset: number }) => entry.offset <= 0));
      }

      const json = JSON.stringify(first.body);
      assert.equal(json.includes("BTC"), false);
      assert.equal(json.includes("15m"), false);
      assert.equal(json.includes("bearish_engulfing"), false);
      assert.equal(json.includes("outcome"), false);
      assert.equal(json.includes('"time"'), false);

      const again = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}&count=100`
      );
      assert.deepEqual(
        again.body.items.map((item: { itemId: string }) => item.itemId),
        first.body.items.map((item: { itemId: string }) => item.itemId)
      );

      const zero = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}&count=0`
      );
      assert.equal(zero.body.count, 1);

      const invalid = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}&count=nope`
      );
      assert.equal(invalid.body.count, 10);
    });
  });

  test("excludes answered items and round-robins across tags", async () => {
    const items = [
      makeItem({ id: "inside-1", tag: "bearish_engulfing" }),
      makeItem({ id: "inside-2", tag: "bearish_engulfing" }),
      makeItem({ id: "engulf-1", tag: "bullish_engulfing", family: "candle" }),
      makeItem({ id: "engulf-2", tag: "bullish_engulfing", family: "candle" }),
    ];
    const attempts = createAttemptStore();
    attempts.record({
      sessionId: SESSION,
      itemId: "inside-2",
      probability: 0.5,
      trade: null,
    });

    await withRouter(routerFor(makeBatch(items), attempts), async (base) => {
      const { status, body } = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}&count=2`
      );
      assert.equal(status, 200);
      assert.equal(body.items.length, 2);
      const ids = body.items.map((item: { itemId: string }) => item.itemId);
      assert.equal(ids.includes(publicItemId("inside-2")), false);

      const byPublicId = new Map(
        body.items.map((item: { itemId: string }) => [item.itemId, item])
      );
      const tags = items
        .filter((item) => byPublicId.has(publicItemId(item.id)))
        .map((item) => item.tag);
      assert.equal(new Set(tags).size, 2);

      const other = await getJson(
        `${base}/api/trainer/session?sessionId=${OTHER_SESSION}&count=10`
      );
      assert.equal(other.status, 200);
      assert.equal(other.body.items.length, 4);
    });
  });

  test("serves one anonymized item and 404s unknown ids", async () => {
    const item = makeItem();
    await withRouter(routerFor(makeBatch([item])), async (base) => {
      const found = await getJson(
        `${base}/api/trainer/item/${encodeURIComponent(publicItemId(item.id))}`
      );
      assert.equal(found.status, 200);
      assert.equal(found.body.item.itemId, publicItemId(item.id));
      assert.equal("outcome" in found.body.item, false);
      assert.equal("symbol" in found.body.item, false);

      const missing = await getJson(`${base}/api/trainer/item/nope`);
      assert.equal(missing.status, 404);
      assert.deepEqual(missing.body, { error: "item not found" });
    });
  });

  test("returns 503 when stored bars are unavailable", async () => {
    const batch = makeBatch([makeItem()]);
    await withRouter(
      routerFor(batch, undefined, async () => null),
      async (base) => {
        const { status, body } = await getJson(
          `${base}/api/trainer/item/${encodeURIComponent(publicItemId(makeItem().id))}`
        );
        assert.equal(status, 503);
        assert.deepEqual(body, { error: "trainer data unavailable" });
      }
    );
  });
});

describe("trainer API: answer and reveal", () => {
  test("validates answers and never returns the outcome", async () => {
    const item = makeItem();
    const batch = makeBatch([item]);
    await withRouter(routerFor(batch), async (base) => {
      const endpoint = `${base}/api/trainer/answer`;
      const common = { sessionId: SESSION, itemId: publicItemId(item.id) };

      const empty = await postJson(endpoint, common);
      assert.equal(empty.status, 400);
      assert.deepEqual(empty.body, {
        error: "at least one of probability or trade is required",
      });

      for (const probability of [-0.1, 1.1, "0.5", Number.NaN]) {
        const bad = await postJson(endpoint, { ...common, probability });
        assert.equal(bad.status, 400);
      }

      const badTrade = await postJson(endpoint, { ...common, trade: "buy" });
      assert.equal(badTrade.status, 400);
      assert.deepEqual(badTrade.body, {
        error: 'trade must be "take" or "pass"',
      });

      const unknown = await postJson(endpoint, {
        sessionId: SESSION,
        itemId: "nope",
        probability: 0.5,
      });
      assert.equal(unknown.status, 404);

      const ok = await postJson(endpoint, { ...common, probability: 0.8 });
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body, { ok: true, conflict: false });
      assert.equal("outcome" in ok.body, false);
      assert.equal("reveal" in ok.body, false);

      const tradeOnly = await postJson(endpoint, {
        sessionId: OTHER_SESSION,
        itemId: publicItemId(item.id),
        trade: "pass",
      });
      assert.equal(tradeOnly.status, 200);
    });
  });

  test("keeps the first answer and reports a conflict", async () => {
    const item = makeItem();
    const attempts = createAttemptStore();
    await withRouter(
      routerFor(makeBatch([item]), attempts),
      async (base) => {
        const first = await postJson(`${base}/api/trainer/answer`, {
          sessionId: SESSION,
          itemId: publicItemId(item.id),
          probability: 0.8,
        });
        assert.equal(first.body.conflict, false);

        const second = await postJson(`${base}/api/trainer/answer`, {
          sessionId: SESSION,
          itemId: publicItemId(item.id),
          probability: 0.2,
          trade: "take",
        });
        assert.equal(second.status, 200);
        assert.deepEqual(second.body, { ok: true, conflict: true });

        const stored = attempts.get(SESSION, item.id);
        assert.equal(stored?.probability, 0.8);
        assert.equal(stored?.trade, null);
      }
    );
  });

  test("gates reveal on a stored answer", async () => {
    const item = makeItem();
    const batch = makeBatch([item]);
    await withRouter(routerFor(batch), async (base) => {
      const reveal = `${base}/api/trainer/reveal`;
      const blocked = await postJson(reveal, {
        sessionId: SESSION,
        itemId: publicItemId(item.id),
      });
      assert.equal(blocked.status, 409);
      assert.deepEqual(blocked.body, { error: "answer required" });

      await postJson(`${base}/api/trainer/answer`, {
        sessionId: SESSION,
        itemId: publicItemId(item.id),
        probability: 0.65,
        trade: "take",
      });

      const opened = await postJson(reveal, {
        sessionId: SESSION,
        itemId: publicItemId(item.id),
      });
      assert.equal(opened.status, 200);

      const payload = opened.body.reveal;
      assert.equal(payload.itemId, publicItemId(item.id));
      assert.equal(payload.outcome, "up");
      assert.equal(payload.outcomeOffset, 1);
      assert.equal(payload.tag, "bearish_engulfing");
      assert.equal(payload.reveal.length, 20);
      assert.equal(payload.reveal[0].offset, 1);
      assert.equal(payload.reveal.at(-1).offset, 20);
      assert.deepEqual(payload.baseRates.tag, {
        n: 4,
        counts: { up: 2, down: 1, scratch: 1 },
        rates: { up: 0.5, down: 0.25, scratch: 0.25 },
      });

      const json = JSON.stringify(opened.body);
      assert.equal(json.includes("BTC"), false);
      assert.equal(json.includes("15m"), false);
      assert.equal(json.includes("1700000000000"), false);
      assert.equal(json.includes('"time"'), false);
      assert.equal(json.includes('"context"'), false);
    });
  });

  test("404s reveal for an unknown item", async () => {
    const attempts = createAttemptStore();
    attempts.record({
      sessionId: SESSION,
      itemId: "nope",
      probability: 0.5,
      trade: null,
    });
    await withRouter(
      routerFor(makeBatch([makeItem()]), attempts),
      async (base) => {
        const { status, body } = await postJson(`${base}/api/trainer/reveal`, {
          sessionId: SESSION,
          itemId: "nope",
        });
        assert.equal(status, 404);
        assert.deepEqual(body, { error: "item not found" });
      }
    );
  });

  test("503s answer, session and reveal when no batch exists", async () => {
    await withRouter(routerFor(null), async (base) => {
      const session = await getJson(
        `${base}/api/trainer/session?sessionId=${SESSION}`
      );
      assert.equal(session.status, 503);

      const answer = await postJson(`${base}/api/trainer/answer`, {
        sessionId: SESSION,
        itemId: "anything",
        probability: 0.5,
      });
      assert.equal(answer.status, 503);

      const reveal = await postJson(`${base}/api/trainer/reveal`, {
        sessionId: SESSION,
        itemId: "anything",
      });
      assert.equal(reveal.status, 503);
    });
  });
});

describe("attempt store", () => {
  test("keeps the first answer and reports conflicts", () => {
    const store = createAttemptStore();
    const first = store.record({
      sessionId: SESSION,
      itemId: "item-a",
      probability: 0.7,
      trade: "take",
    });
    assert.equal(first.conflict, false);
    assert.equal(first.attempt.probability, 0.7);

    const second = store.record({
      sessionId: SESSION,
      itemId: "item-a",
      probability: 0.1,
      trade: "pass",
    });
    assert.equal(second.conflict, true);
    assert.equal(second.attempt.probability, 0.7);
    assert.equal(second.attempt.trade, "take");
    assert.equal(store.get(SESSION, "item-a")?.probability, 0.7);
  });

  test("expires attempts after the ttl", () => {
    let now = 1_000;
    const store = createAttemptStore({ now: () => now, ttlMs: 100 });
    store.record({
      sessionId: SESSION,
      itemId: "item-a",
      probability: 0.5,
      trade: null,
    });
    assert.equal(store.get(SESSION, "item-a")?.probability, 0.5);

    now += 99;
    assert.ok(store.get(SESSION, "item-a"));

    now += 1;
    assert.equal(store.get(SESSION, "item-a"), undefined);
    assert.equal(store.answeredIds(SESSION).size, 0);
  });

  test("caps the number of live sessions and evicts the oldest", () => {
    let now = 0;
    const store = createAttemptStore({ now: () => now, maxSessions: 2 });

    store.record({
      sessionId: "session-0001",
      itemId: "a",
      probability: 0.5,
      trade: null,
    });
    now = 1;
    store.record({
      sessionId: "session-0002",
      itemId: "a",
      probability: 0.5,
      trade: null,
    });
    now = 2;
    store.record({
      sessionId: "session-0003",
      itemId: "a",
      probability: 0.5,
      trade: null,
    });

    assert.equal(store.get("session-0001", "a"), undefined);
    assert.ok(store.get("session-0002", "a"));
    assert.ok(store.get("session-0003", "a"));
  });
});
