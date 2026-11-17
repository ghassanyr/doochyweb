import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { paperLotBounds, paperVolumeForLots, snapPaperLots } from "../src/server/simulation/specs";
import type { PaperLotSpecSnapshot, PaperPositionView } from "../src/server/simulation/types";
import {
  PAPER_START_BALANCE,
  closeDecision,
  computePaperAccount,
  levelError,
  paperLotPnl,
  paperPnl,
  paperPnlFor,
  validatePaperInput,
} from "../src/server/simulation/validate";

const LOT_SPEC: PaperLotSpecSnapshot = {
  symbolId: 7,
  brokerSymbol: "EURUSD",
  lotSize: 100_000,
  minVolume: 1_000,
  stepVolume: 1_000,
  maxVolume: 10_000_000,
  quoteAsset: "USD",
  digits: 5,
  quoteUsdFactor: 1,
  ctid: 123,
  isLive: false,
};

function position(overrides: Partial<PaperPositionView> = {}): PaperPositionView {
  return {
    id: "p1",
    symbol: "EURUSD",
    side: "buy",
    sizeMode: "usd",
    notional: 10_000,
    lots: null,
    volume: null,
    spec: null,
    entryPrice: 1.1,
    stop: 1.09,
    target: 1.12,
    exitPrice: null,
    pnl: null,
    status: "open",
    closeReason: null,
    lastPrice: 1.1,
    openedAt: "2026-01-10T10:00:00.000Z",
    closedAt: null,
    createdAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("validatePaperInput", () => {
  test("normalizes the symbol and defaults levels to null", () => {
    const parsed = validatePaperInput({ symbol: "eur/usd", side: "BUY", notional: "5000" });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.symbol, "EURUSD");
    assert.equal(parsed.value.side, "buy");
    assert.equal(parsed.value.notional, 5000);
    assert.equal(parsed.value.stop, null);
    assert.equal(parsed.value.target, null);
  });

  test("requires a symbol, a side and a positive size", () => {
    assert.equal(validatePaperInput({ side: "buy", notional: 100 }).ok, false);
    assert.equal(validatePaperInput({ symbol: "EURUSD", notional: 100 }).ok, false);
    assert.equal(validatePaperInput({ symbol: "EURUSD", side: "buy", notional: 0 }).ok, false);
    assert.equal(validatePaperInput({ symbol: "EURUSD", side: "buy" }).ok, false);
  });

  test("caps the position size", () => {
    const parsed = validatePaperInput({ symbol: "EURUSD", side: "buy", notional: 1_000_001 });
    assert.equal(parsed.ok, false);
  });

  test("accepts lot sizing without a client account", () => {
    const parsed = validatePaperInput({
      symbol: "EURUSD",
      side: "buy",
      sizeMode: "lots",
      lots: "0.10",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.sizeMode, "lots");
    assert.equal(parsed.value.lots, 0.1);
    assert.equal(parsed.value.notional, null);
    assert.equal("ctid" in parsed.value, false);
  });

  test("requires a lot amount for lot sizing", () => {
    assert.equal(
      validatePaperInput({ symbol: "EURUSD", side: "buy", sizeMode: "lots" }).ok,
      false
    );
  });

  test("rejects negative levels", () => {
    assert.equal(
      validatePaperInput({ symbol: "EURUSD", side: "buy", notional: 100, stop: -1 }).ok,
      false
    );
  });
});

describe("levelError", () => {
  test("a buy needs its stop below and target above the entry", () => {
    assert.equal(levelError({ side: "buy", stop: 1.09, target: 1.12 }, 1.1), null);
    assert.match(levelError({ side: "buy", stop: 1.11, target: 1.12 }, 1.1) ?? "", /stop/);
    assert.match(levelError({ side: "buy", stop: 1.09, target: 1.09 }, 1.1) ?? "", /target/);
  });

  test("a sell is the mirror image", () => {
    assert.equal(levelError({ side: "sell", stop: 1.12, target: 1.08 }, 1.1), null);
    assert.match(levelError({ side: "sell", stop: 1.09, target: 1.08 }, 1.1) ?? "", /stop/);
    assert.match(levelError({ side: "sell", stop: 1.12, target: 1.11 }, 1.1) ?? "", /target/);
  });

  test("missing levels are allowed", () => {
    assert.equal(levelError({ side: "buy", stop: null, target: null }, 1.1), null);
  });
});

describe("paperPnl", () => {
  test("a buy profits when price rises", () => {
    assert.equal(paperPnl("buy", 10_000, 100, 110), 1000);
    assert.equal(paperPnl("buy", 10_000, 100, 95), -500);
  });

  test("a sell profits when price falls", () => {
    assert.equal(paperPnl("sell", 10_000, 100, 90), 1000);
    assert.equal(paperPnl("sell", 10_000, 100, 105), -500);
  });

  test("rounds to cents and guards a zero entry", () => {
    assert.equal(paperPnl("buy", 1000, 3, 3.3333), 111.1);
    assert.equal(paperPnl("buy", 1000, 0, 10), 0);
  });
});

describe("lot sizing", () => {
  test("derives lot bounds from broker volume fields", () => {
    assert.deepEqual(paperLotBounds(LOT_SPEC), {
      minLots: 0.01,
      maxLots: 100,
      lotStep: 0.01,
    });
  });

  test("snaps lots to the broker volume grid", () => {
    assert.equal(paperVolumeForLots(0.105, LOT_SPEC), 11_000);
    assert.equal(snapPaperLots(0.105, LOT_SPEC), 0.11);
    assert.equal(snapPaperLots(0.001, LOT_SPEC), 0.01);
    assert.equal(snapPaperLots(500, LOT_SPEC), 100);
  });
});

describe("lot P&L", () => {
  test("uses broker volume and quote conversion", () => {
    assert.equal(paperLotPnl("buy", 100_000, 1, 1.1, 1.11), 10);
    assert.equal(paperLotPnl("sell", 100_000, 1, 1.11, 1.1), 10);
    assert.equal(paperLotPnl("buy", 100_000, 0.5, 1.1, 1.11), 5);
  });

  test("paperPnlFor selects the stored size mode", () => {
    const usd = position({ lastPrice: 110 });
    const lots = position({
      sizeMode: "lots",
      notional: 0,
      lots: 0.1,
      volume: 100_000,
      spec: LOT_SPEC,
      lastPrice: 110,
    });
    assert.equal(paperPnlFor(usd, 100, 110), 1000);
    assert.equal(paperPnlFor(lots, 100, 110), 10_000);
  });
});

describe("closeDecision", () => {
  test("a buy closes at its stop below and its target above", () => {
    const row = { side: "buy" as const, stop: 99, target: 110 };
    assert.deepEqual(closeDecision(row, 98), { reason: "stop", price: 99 });
    assert.deepEqual(closeDecision(row, 111), { reason: "target", price: 110 });
    assert.equal(closeDecision(row, 105), null);
  });

  test("a sell closes at its stop above and its target below", () => {
    const row = { side: "sell" as const, stop: 110, target: 90 };
    assert.deepEqual(closeDecision(row, 111), { reason: "stop", price: 110 });
    assert.deepEqual(closeDecision(row, 89), { reason: "target", price: 90 });
    assert.equal(closeDecision(row, 100), null);
  });

  test("the stop wins when both levels are inside one tick", () => {
    const row = { side: "buy" as const, stop: 99, target: 101 };
    assert.equal(closeDecision(row, 99)?.reason, "stop");
  });

  test("a position with no levels never auto-closes", () => {
    assert.equal(closeDecision({ side: "buy", stop: null, target: null }, 500), null);
  });

  test("a non-finite price is ignored", () => {
    assert.equal(closeDecision({ side: "buy", stop: 99, target: 110 }, Number.NaN), null);
  });
});

describe("computePaperAccount", () => {
  test("realized and open profit both feed equity", () => {
    const account = computePaperAccount(
      [
        position({ id: "open", lastPrice: 110 }),
        position({
          id: "closed",
          status: "closed",
          exitPrice: 105,
          pnl: 500,
          notional: 10_000,
        }),
      ],
      { EURUSD: 1.11 }
    );
    assert.equal(account.startBalance, PAPER_START_BALANCE);
    assert.equal(account.realizedPnl, 500);
    // 111 against a 110 entry on 10k is +90.91.
    assert.equal(account.unrealizedPnl, 90.91);
    assert.equal(account.equity, PAPER_START_BALANCE + 590.91);
    assert.equal(account.openCount, 1);
    assert.equal(account.closedCount, 1);
    assert.equal(account.exposure, 10_000);
    assert.equal(account.wins, 1);
    assert.equal(account.losses, 0);
    assert.equal(account.winRate, 1);
  });

  test("falls back to the last mark when no fresh price exists", () => {
    const account = computePaperAccount([position({ lastPrice: 1.15 })]);
    assert.equal(account.unrealizedPnl, 454.55);
  });

  test("mixed lot and USD rows report USD exposure", () => {
    const account = computePaperAccount(
      [
        position({ id: "usd", symbol: "EURUSD", entryPrice: 100, lastPrice: 110, notional: 1_000 }),
        position({
          id: "lot",
          symbol: "GBPUSD",
          sizeMode: "lots",
          notional: 1_000,
          lots: 1,
          volume: 100_000,
          spec: LOT_SPEC,
          entryPrice: 1.1,
          lastPrice: 1.11,
        }),
      ],
      { EURUSD: 110, GBPUSD: 1.11 }
    );
    assert.equal(account.unrealizedPnl, 110);
    assert.equal(account.exposure, 2_000);
  });

  test("an empty book reports a null win rate", () => {
    const account = computePaperAccount([]);
    assert.equal(account.equity, PAPER_START_BALANCE);
    assert.equal(account.winRate, null);
    assert.equal(account.exposure, 0);
  });
});
