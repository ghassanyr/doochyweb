import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { replay, type ReplaySymbol } from "../src/server/market/scraperReplay";
import type { Candle, SymbolMeta } from "../src/server/market/types";

const H = 3_600_000;
const meta = (symbol: string, type: SymbolMeta["type"]): SymbolMeta =>
  ({ symbol, name: symbol, type, providers: {} });
const bar = (time: number, open: number, close: number): Candle => ({
  time, open, close, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, volume: 1,
});
const neutral = () => "Neutral";

/** 4H is bullish engulf at the last closed bar; 1H flips from flat to bullish engulf. */
function flippingSymbol(B: number): ReplaySymbol {
  // The shared engulf rule needs ATR20, so lead with a flat history.
  const flat4h = Array.from({ length: 20 }, (_, i) =>
    bar(B - 8 * H - (20 - i) * 4 * H, 10, 10)
  );
  const flat1h = Array.from({ length: 20 }, (_, i) =>
    bar(B - 2 * H - (20 - i) * H, 10, 10)
  );
  return {
    symbol: "EURUSD",
    meta: meta("EURUSD", "forex"),
    bars4h: [...flat4h, bar(B - 8 * H, 10, 9), bar(B - 4 * H, 8.5, 10.5)],
    bars1h: [...flat1h, bar(B - 2 * H, 10, 9), bar(B - 1 * H, 9, 8), bar(B, 7, 10)],
  };
}

describe("scraper replay", () => {
  const B1 = Date.UTC(2026, 10, 3, 4); // Tuesday 04:00 UTC, a full-capture anchor
  test("a fresh alignment fires one needle and one pattern change", () => {
    const r = replay([flippingSymbol(B1)], [B1, B1 + H], { rating: neutral });
    assert.equal(r.captures.length, 2);
    assert.equal(r.needles.length, 1);
    assert.equal(r.needles[0].kind, "engulf_1h_4h");
    assert.equal(r.changes.filter((c) => c.field === "patterns").length, 1);
    assert.equal(r.captures[0].true_alignments.engulf_1h_4h.length, 0, "not aligned at the first boundary");
    assert.equal(r.captures[1].true_alignments.engulf_1h_4h.length, 1, "aligned at the second");
  });

  test("an alignment that stays true does not fire again", () => {
    const r = replay([flippingSymbol(B1)], [B1, B1 + H, B1 + 2 * H], { rating: neutral });
    assert.equal(r.needles.length, 1);
  });

  test("weekend suppresses non-crypto alignments and needles", () => {
    const S = Date.UTC(2026, 10, 7, 12); // Saturday
    assert.equal(new Date(S).getUTCDay(), 6);
    const s = flippingSymbol(S);
    const r = replay([s], [S], { rating: neutral });
    assert.equal(r.captures[0].true_alignments.engulf_1h_4h.length, 0);
    assert.equal(r.needles.length, 0);
    assert.equal(r.weekend.nonCryptoAlignments, 0);
    assert.equal(r.weekend.withNonCrypto, 1, "the symbol was evaluated, so the filter was exercised");
  });

  test("session labels and capture types follow the clock", () => {
    const r = replay([flippingSymbol(B1)], [B1, B1 + H], { rating: neutral });
    assert.equal(r.captures[0].session, "4h_close");
    assert.equal(r.captures[0].capture_type, "full");
    assert.equal(r.captures[1].session, "hourly");
    assert.equal(r.captures[1].capture_type, "lightweight");
    assert.deepEqual(r.perSession, { "4h_close": 1, hourly: 1 });
  });

  test("no capture is produced when every symbol is stale", () => {
    const stale: ReplaySymbol = {
      symbol: "EURUSD", meta: meta("EURUSD", "forex"),
      bars4h: [bar(B1 - 40 * H, 10, 9)], bars1h: [bar(B1 - 40 * H, 10, 9)],
    };
    const r = replay([stale], [B1], { rating: neutral });
    assert.equal(r.captures.length, 1);
    assert.equal(r.captures[0].market_count, 0);
    assert.equal(r.empty, 1);
  });
});
