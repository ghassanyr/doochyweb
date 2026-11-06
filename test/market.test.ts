// Assertions for the Analysis engine (indicator math, rating rules, symbol
// resolution and the simulator). Ported from the standalone `gauge` project's
// hand-rolled runner onto node:test.
//
// Run with: pnpm test

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { analyze, RATINGS } from "../src/server/market/analysis";
import { detectEngulfing, detectSweep } from "../src/server/market/patterns";
import * as ti from "../src/server/market/indicators";
import { buildCatalog, resolveAgainstBroker, toSymbolMeta, searchCatalog } from "../src/server/market/symbols";
import { deriveCryptoPairs, cryptoCatalogEntries, type RawPair } from "../src/server/market/crypto";
import { providerOrder } from "../src/server/market/providers/index";
import { maskClientId, resolveConnectInput } from "../src/server/credentials";
import { normalizeCapture } from "../src/server/market/captures";
import { aggregate } from "../src/server/market/providers/binance";
import { getTimeframe, TIMEFRAMES } from "../src/server/market/timeframes";
import { noSourceError } from "../src/server/market/providers/index";
import * as breaker from "../src/server/market/providers/breaker";
import type { Candle, Timeframe } from "../src/server/market/types";
import { applyOrder, moveTo, dropIndex } from "../src/webapp/src/market/order";
import { changedSymbolCount, dayKey, dayLabel, fmtUtc3, groupChanges, matchesCapture, relativeTime } from "../src/webapp/src/market/captures";

// Deterministic OHLC series: a slow sine drift around price 100, so every
// indicator has something non-degenerate to chew on.
function makeCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    price += Math.sin(i / 5) * 1.5 + Math.cos(i / 11) * 0.8 + 0.1;
    const high = Math.max(open, price) + Math.abs(Math.sin(i)) * 0.6;
    const low = Math.min(open, price) - Math.abs(Math.cos(i)) * 0.6;
    out.push({ time: i * 86400000, open, high, low, close: price, volume: 1000 });
  }
  return out;
}

describe("moving averages", () => {
  test("sma computes trailing average", () => {
    const out = ti.sma([1, 2, 3, 4, 5], 3);
    assert.equal(out[4], 4);
    assert.equal(out[3], 3);
    assert.equal(out[0], null);
  });

  test("ema seeds with sma then smooths", () => {
    const out = ti.ema([1, 2, 3, 4, 5], 3);
    assert.equal(out[2], 2);
    assert.equal(Math.round((out[4] as number) * 1000) / 1000, 4);
  });

  test("aggregate resamples candles", () => {
    const candles = makeCandles(8);
    const agg = ti.aggregate(candles, 4);
    assert.equal(agg.length, 2);
    assert.equal(agg[0].open, candles[0].open);
    assert.equal(agg[0].close, candles[3].close);
  });
});

describe("oscillators", () => {
  test("rsi stays within 0..100", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    for (const v of ti.rsi(values, 14).filter((x) => x !== null)) {
      assert.ok(v >= 0 && v <= 100, `rsi out of range: ${v}`);
    }
  });

  test("rsi is 100 for a strictly rising series", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    assert.equal(ti.last(ti.rsi(values, 14)), 100);
  });

  test("macd/atr/adx produce finite latest values", () => {
    const candles = makeCandles(300);
    assert.ok(Number.isFinite(ti.last(ti.macd(candles.map((c) => c.close)).macd)));
    assert.ok(Number.isFinite(ti.last(ti.atr(candles, 14))));
    assert.ok(Number.isFinite(ti.last(ti.adx(candles, 14).adx)));
  });

  test("remaining oscillators are defined", () => {
    const candles = makeCandles(300);
    const closes = candles.map((c) => c.close);
    assert.ok(Number.isFinite(ti.last(ti.stochastic(candles).k)));
    assert.ok(Number.isFinite(ti.last(ti.stochRsi(closes).k)));
    assert.ok(Number.isFinite(ti.last(ti.cci(candles, 20))));
    assert.ok(Number.isFinite(ti.last(ti.ultimateOscillator(candles))));
    assert.ok(Number.isFinite(ti.last(ti.roc(closes, 14))));
    assert.ok(Number.isFinite(ti.last(ti.highsLows(candles, 14))));
    assert.ok(Number.isFinite(ti.last(ti.bullBearPower(candles, 13))));
  });

  test("roc math is correct", () => {
    assert.equal(ti.last(ti.roc([1, 2, 4], 2)), 300);
  });

  test("williams %R within -100..0", () => {
    for (const v of ti.williamsR(makeCandles(120), 14)) {
      if (v !== null) assert.ok(v >= -100 && v <= 0, `wr out of range: ${v}`);
    }
  });
});

describe("analysis", () => {
  test("returns 12 oscillators + 12 MAs and a valid rating", () => {
    const result = analyze(makeCandles(320), { symbol: "TEST", name: "Test", type: "crypto" }, "1d");
    assert.equal(result.oscillators.rows.length, 12);
    assert.equal(result.movingAverages.rows.length, 12);
    assert.ok(RATINGS.includes(result.summary.rating), `bad rating ${result.summary.rating}`);
    assert.ok(result.summary.score >= -1 && result.summary.score <= 1);
    assert.equal(result.summary.buy + result.summary.sell + result.summary.neutral, 24);
    assert.ok(result.engulfing === null || result.engulfing === "bullish" || result.engulfing === "bearish");
  });

  test("rejects too little data", () => {
    assert.throws(() => analyze(makeCandles(10), { symbol: "X" }, "1d"));
  });
});

describe("engulfing candle", () => {
  const bar = (open: number, close: number, wick = 1): Candle => ({
    time: 0,
    open,
    close,
    high: Math.max(open, close) + wick,
    low: Math.min(open, close) - wick,
    volume: 1,
  });
  // Index -1 is the forming bar and must never decide the pattern.
  const series = (prior: Candle, closed: Candle, forming: Candle = bar(1, 1)): Candle[] => [
    bar(50, 50),
    prior,
    closed,
    forming,
  ];

  test("bullish: green body covers the prior red body", () => {
    const candles = series(bar(10, 8), bar(7, 11));
    assert.equal(detectEngulfing(candles, "15m"), "bullish");
    assert.equal(detectEngulfing(candles, "1d"), "bullish");
  });

  test("bearish: red body covers the prior green body", () => {
    assert.equal(detectEngulfing(series(bar(8, 10), bar(11, 7)), "1h"), "bearish");
  });

  test("a longer wick is not enough when the body does not cover", () => {
    // Prior body 8-10. Current range engulfs it via wicks, but the body (9-9.5) does not.
    const prior = bar(8, 10, 0);
    const current: Candle = { time: 0, open: 9, close: 9.5, high: 12, low: 6, volume: 1 };
    assert.equal(detectEngulfing(series(prior, current), "15m"), null);
  });

  test("a doji on either bar is not a match", () => {
    assert.equal(detectEngulfing(series(bar(10, 10), bar(9, 11)), "15m"), null);
    assert.equal(detectEngulfing(series(bar(10, 8), bar(9, 9)), "15m"), null);
  });

  test("a pattern only on the forming bar is ignored", () => {
    const clean = series(bar(10, 10.5), bar(10.4, 10.2), bar(9, 12));
    assert.equal(detectEngulfing(clean, "1d"), null);
  });

  test("below M15 is always null", () => {
    const candles = series(bar(10, 8), bar(7, 11));
    for (const id of ["1m", "3m", "5m"]) {
      assert.equal(detectEngulfing(candles, id), null, id);
    }
  });

  test("equal body edges still count as a cover", () => {
    assert.equal(detectEngulfing(series(bar(10, 8), bar(8, 10)), "30m"), "bullish");
  });
});

describe("4H sweep", () => {
  const flat = (high: number, low: number, close = (high + low) / 2): Candle => ({
    time: 0,
    open: close,
    high,
    low,
    close,
    volume: 1,
  });
  // Five reference bars, the closed sweep bar, then a forming bar that must not count.
  const withRef = (closed: Candle, forming: Candle = flat(10, 9)): Candle[] => [
    flat(10, 8),
    flat(10, 8),
    flat(10, 8),
    flat(10, 8),
    flat(10, 8),
    closed,
    forming,
  ];

  test("a wick above the prior 5 highs that closes back below is a high sweep", () => {
    assert.equal(detectSweep(withRef(flat(12, 8, 9))), "high");
  });

  test("a wick below the prior 5 lows that closes back above is a low sweep", () => {
    assert.equal(detectSweep(withRef(flat(10, 6, 9))), "low");
  });

  test("a close that stays beyond the level is not a return", () => {
    assert.equal(detectSweep(withRef(flat(12, 10.5, 11))), null);
    assert.equal(detectSweep(withRef(flat(7.5, 6, 7))), null);
  });

  test("touching the prior high is not a sweep", () => {
    assert.equal(detectSweep(withRef(flat(10, 8, 9))), null);
  });

  test("a sweep that exists only on the forming bar is ignored", () => {
    assert.equal(detectSweep(withRef(flat(10, 8, 9), flat(14, 7, 8))), null);
  });

  test("fewer than 7 bars cannot name a 5-bar reference", () => {
    assert.equal(detectSweep([flat(12, 6, 9), flat(12, 6, 9), flat(1, 1)]), null);
  });

  test("one candle can sweep both sides and close back inside", () => {
    assert.equal(detectSweep(withRef(flat(12, 6, 9))), "both");
  });
});

describe("cTrader bar reading", () => {
  // The failure message is the only diagnostic a user gets when a market cannot
  // be priced, so it must say what failed and why. An earlier edit dropped the
  // interpolation and shipped a bare sentence.
  test("names the source and the reason", () => {
    const msg = noSourceError([
      { provider: "ctrader", message: "only 12 bars (broker history may not reach that far back)" },
    ]);
    assert.match(msg, /Could not read bars from cTrader/);
    assert.match(msg, /only 12 bars/);
  });

  test("is specific rather than a bare sentence", () => {
    const msg = noSourceError([{ provider: "ctrader", message: "rate limited" }]);
    assert.ok(msg.length > 60, `message too short to diagnose: ${msg}`);
  });
});

describe("symbol resolution against the broker", () => {
  // The broker names indices differently from the short forms people type, and
  // those short forms are what the watchlist stores.
  const BROKER = [
    "EURUSD", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD",
    "US 500", "US 30", "US TECH 100", "UK 100", "GERMANY 40",
    "FRANCE 40", "ITALY 40", "AUSTRALIA 200", "JAPAN 225", "SPAIN 35",
    "DB US DOLLAR INDEX", "S&P 500 LOW VOLATILITY",
  ];

  test("passes majors through untouched", () => {
    for (const s of ["EURUSD", "XAUUSD", "XAGUSD", "BTCUSD"]) {
      assert.equal(resolveAgainstBroker(s, BROKER), s);
    }
  });

  test("maps index aliases to the broker's wording", () => {
    assert.equal(resolveAgainstBroker("US500", BROKER), "US 500");
    assert.equal(resolveAgainstBroker("NAS100", BROKER), "US TECH 100");
    assert.equal(resolveAgainstBroker("GER40", BROKER), "GERMANY 40");
    assert.equal(resolveAgainstBroker("VIX", BROKER), "S&P 500 LOW VOLATILITY");
    assert.equal(resolveAgainstBroker("DXY", BROKER), "DB US DOLLAR INDEX");
  });

  test("tolerates punctuation and spacing", () => {
    assert.equal(resolveAgainstBroker("eur/usd", BROKER), "EURUSD");
    assert.equal(resolveAgainstBroker(" us 500 ", BROKER), "US 500");
  });

  test("refuses symbols the account cannot trade", () => {
    assert.equal(resolveAgainstBroker("SOLUSD", BROKER), null);
    assert.equal(resolveAgainstBroker("US2000", BROKER), null);
    assert.equal(resolveAgainstBroker("", BROKER), null);
  });

  test("classifies asset types from the broker name", () => {
    assert.equal(toSymbolMeta("EURUSD").type, "forex");
    assert.equal(toSymbolMeta("XAUUSD").type, "commodity");
    assert.equal(toSymbolMeta("BTCUSD").type, "crypto");
    assert.equal(toSymbolMeta("US 500").type, "index");
  });

  test("catalog exposes both broker names and the short aliases", () => {
    const catalog = buildCatalog(BROKER);
    const bySymbol = new Map(catalog.map((c) => [c.symbol, c]));
    assert.equal(bySymbol.get("US500")?.name, "US 500");
    assert.equal(bySymbol.get("GER40")?.name, "GERMANY 40");
    assert.equal(bySymbol.get("AUS200")?.name, "AUSTRALIA 200");
    assert.ok(searchCatalog(catalog, "ger").some((c) => c.symbol === "GER40"));
  });

  test("omits aliases the account cannot trade", () => {
    // Same aliases, but this account lists no Japan or Spain index, so the
    // convenience names for them must not be advertised.
    const partial = BROKER.filter((n) => n !== "JAPAN 225" && n !== "SPAIN 35");
    const bySymbol = new Set(buildCatalog(partial).map((c) => c.symbol));
    assert.equal(bySymbol.has("JP225"), false);
    assert.equal(bySymbol.has("ESP35"), false);
    assert.equal(bySymbol.has("GER40"), true);
  });
});

describe("timeframes", () => {
  // Every timeframe must carry a cTrader period, or a card silently fails.
  test("all ten map to a trendbar period and a history limit", () => {
    const { TIMEFRAMES } = require("../src/server/market/timeframes");
    assert.equal(TIMEFRAMES.length, 10);
    for (const tf of TIMEFRAMES) {
      assert.ok(Number.isInteger(tf.ctrader) && tf.ctrader > 0, `${tf.id} has no cTrader period`);
      assert.ok(tf.ctraderMaxRange > 0, `${tf.id} has no cTrader history limit`);
      // Five weeks covers M1-M5; longer periods get more.
      assert.ok(tf.ctraderMaxRange >= 302_400_000, `${tf.id} range too small`);
    }
  });

  test("unknown ids fall back to the default rather than throwing", () => {
    const { getTimeframe, DEFAULT_TIMEFRAME } = require("../src/server/market/timeframes");
    assert.equal(getTimeframe("nonsense").id, DEFAULT_TIMEFRAME);
  });
});

describe("provider circuit breaker", () => {
  // The breaker is what keeps a dead provider from billing its timeout to every
  // symbol on every sweep, so its trip/cooldown arithmetic is worth pinning.
  const FIVE_MIN = 5 * 60 * 1000;

  test("stays closed until the failure threshold is reached", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("ctrader", "", now);
    assert.equal(breaker.isAvailable("ctrader", now), true);
    assert.equal(breaker.cooldownRemaining("ctrader", now), 0);
  });

  test("opens after the threshold and blocks calls", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("ctrader", "", now);
    breaker.recordFailure("ctrader", "", now);
    assert.equal(breaker.isAvailable("ctrader", now), false);
    assert.equal(breaker.cooldownRemaining("ctrader", now), FIVE_MIN);
  });

  test("more failures in the same outage do not lengthen the cooldown", () => {
    breaker.reset();
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) breaker.recordFailure("ctrader", "", now);
    // One sweep analyses many symbols; all those failures are one incident.
    assert.equal(breaker.cooldownRemaining("ctrader", now), FIVE_MIN);
  });

  test("cooldown doubles per later trip and is capped", () => {
    breaker.reset();
    let now = 1_000_000;
    const trip = (at: number) => {
      breaker.recordFailure("ctrader", "", at);
      breaker.recordFailure("ctrader", "", at);
    };
    trip(now);
    assert.equal(breaker.cooldownRemaining("ctrader", now), FIVE_MIN);
    // Cooldown expires, the probe fails again, so the next trip is longer.
    now += FIVE_MIN;
    trip(now);
    assert.equal(breaker.cooldownRemaining("ctrader", now), FIVE_MIN * 2);
    now += FIVE_MIN * 2;
    trip(now);
    assert.equal(breaker.cooldownRemaining("ctrader", now), FIVE_MIN * 4);
  });

  test("a rate limit gets a short cooldown, not the long dead-provider one", () => {
    breaker.reset();
    const now = 1_000_000;
    // Twelve Data answers 429 "out of API credits for the current minute"; its
    // quota refills every 60s, so parking it for 5+ minutes wastes availability.
    breaker.recordFailure("ctrader", "HTTP 429: You have run out of API credits for the current minute.", now);
    const cooling = breaker.cooldownRemaining("ctrader", now);
    assert.ok(cooling > 0 && cooling < FIVE_MIN, `expected a short cooldown, got ${cooling}`);
    assert.equal(breaker.snapshot().ctrader.trips, 0, "rate limits must not escalate");
    // And it comes straight back once the quota window rolls over.
    assert.equal(breaker.isAvailable("ctrader", now + cooling), true);
  });

  test("a success closes it and resets the escalation", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("ctrader", "", now);
    breaker.recordFailure("ctrader", "", now);
    assert.equal(breaker.isAvailable("ctrader", now), false);
    breaker.recordSuccess("ctrader");
    assert.equal(breaker.isAvailable("ctrader", now), true);
    assert.equal(breaker.snapshot().ctrader.trips, 0);
  });

  test("a provider that keeps working is never blocked", () => {
    breaker.reset();
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) {
      breaker.recordSuccess("ctrader");
      assert.equal(breaker.isAvailable("ctrader", now), true);
    }
  });
});

describe("card ordering", () => {
  const items = (syms: string[]) => syms.map((symbol) => ({ symbol }));

  test("applyOrder is a no-op when nothing is saved", () => {
    const list = items(["A", "B", "C"]);
    assert.deepEqual(applyOrder(list, []).map((i) => i.symbol), ["A", "B", "C"]);
  });

  test("applyOrder follows the saved layout", () => {
    const list = items(["A", "B", "C"]);
    assert.deepEqual(applyOrder(list, ["C", "A", "B"]).map((i) => i.symbol), ["C", "A", "B"]);
  });

  test("applyOrder keeps symbols missing from the saved layout", () => {
    // A symbol added after the layout was saved must not vanish.
    const list = items(["A", "B", "NEW"]);
    assert.deepEqual(applyOrder(list, ["B", "A"]).map((i) => i.symbol), ["B", "A", "NEW"]);
  });

  test("moveTo puts the card at the requested FINAL index", () => {
    const list = items(["A", "B", "C", "D"]);
    assert.deepEqual(moveTo(list, "A", 3).map((i) => i.symbol), ["B", "C", "D", "A"]);
    assert.deepEqual(moveTo(list, "D", 0).map((i) => i.symbol), ["D", "A", "B", "C"]);
    // Moving forward one step must actually move.
    assert.deepEqual(moveTo(list, "B", 2).map((i) => i.symbol), ["A", "C", "B", "D"]);
    assert.deepEqual(moveTo(list, "C", 1).map((i) => i.symbol), ["A", "C", "B", "D"]);
  });

  test("moveTo ignores unknown symbols and clamps out-of-range targets", () => {
    const list = items(["A", "B"]);
    assert.deepEqual(moveTo(list, "ZZ", 0).map((i) => i.symbol), ["A", "B"]);
    assert.deepEqual(moveTo(list, "A", 99).map((i) => i.symbol), ["B", "A"]);
    assert.deepEqual(moveTo(list, "B", -5).map((i) => i.symbol), ["B", "A"]);
  });

  test("dropIndex accounts for the dragged card vacating its slot", () => {
    // Dragging the first card onto the last: target stays at 3, dragged goes after.
    assert.equal(dropIndex(0, 3, "after"), 3);
    assert.equal(dropIndex(0, 3, "before"), 2);
    // Dragging a later card onto an earlier one: the target shifts left, so the
    // dragged card lands one past it.
    assert.equal(dropIndex(3, 0, "before"), 0);
    assert.equal(dropIndex(3, 0, "after"), 1);
    // Same side, no shift.
    assert.equal(dropIndex(1, 3, "before"), 2);
    assert.equal(dropIndex(1, 3, "after"), 3);
  });
});

// ------------------------------------------------------------ crypto routing

const raw = (base: string, quote: string, status = "TRADING"): RawPair => ({
  symbol: base + quote,
  baseAsset: base,
  quoteAsset: quote,
  status,
});

describe("Binance crypto catalog", () => {
  test("keeps one pair per asset and prefers USDT", () => {
    // SOL is listed against a dozen quotes; only the USDT one should surface.
    const pairs = deriveCryptoPairs([
      raw("SOL", "BRL"), raw("SOL", "JPY"), raw("SOL", "USDT"), raw("SOL", "USDC"), raw("SOL", "USD"),
    ]);
    assert.deepEqual(pairs, [{ symbol: "SOLUSD", pair: "SOLUSDT", base: "SOL" }]);
  });

  test("suppresses the USD quote when a USDT quote exists", () => {
    // The literal case: SOLUSD must not appear beside SOLUSDT.
    const pairs = deriveCryptoPairs([raw("SOL", "USD"), raw("SOL", "USDT")]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].pair, "SOLUSDT");
    assert.ok(!pairs.some((p) => p.pair === "SOLUSD"));
  });

  test("falls back to a plain USD pair when no USDT pair exists", () => {
    assert.deepEqual(deriveCryptoPairs([raw("XYZ", "USD")]), [
      { symbol: "XYZUSD", pair: "XYZUSD", base: "XYZ" },
    ]);
  });

  test("excludes fiat bases so they cannot collide with FX pairs", () => {
    // Binance lists EURUSDT, which would render as EURUSD and shadow the real
    // cTrader forex pair.
    const pairs = deriveCryptoPairs([raw("EUR", "USDT"), raw("BTC", "USDT")]);
    assert.ok(!pairs.some((p) => p.symbol === "EURUSD"));
    assert.ok(pairs.some((p) => p.symbol === "BTCUSD"));
  });

  test("drops USD stablecoins, which would render as USDCUSD", () => {
    const pairs = deriveCryptoPairs([
      raw("USDC", "USDT"), raw("TUSD", "USDT"), raw("FDUSD", "USDT"), raw("BTC", "USDT"),
    ]);
    assert.deepEqual(pairs.map((p) => p.symbol), ["BTCUSD"]);
  });

  test("drops unusable tickers: too short, too long, non-ASCII", () => {
    const pairs = deriveCryptoPairs([
      raw("A", "USDT"), raw("BROCCOLI714", "USDT"), { ...raw("BTC", "USDT"), baseAsset: "牛来" },
    ]);
    assert.deepEqual(pairs, []);
  });

  test("ignores pairs that are not trading", () => {
    assert.deepEqual(deriveCryptoPairs([raw("BTC", "USDT", "BREAK")]), []);
  });

  test("catalog entries are typed crypto and tagged to Binance", () => {
    const entries = cryptoCatalogEntries(deriveCryptoPairs([raw("SOL", "USDT")]));
    assert.deepEqual(entries, [
      { symbol: "SOLUSD", name: "SOLUSDT", type: "crypto", provider: "binance" },
    ]);
  });
});

describe("catalog merge", () => {
  const crypto = deriveCryptoPairs([raw("BTC", "USDT"), raw("ETH", "USDT"), raw("SOL", "USDT")]);

  test("Binance crypto replaces the broker's own crypto lines", () => {
    const cat = buildCatalog(["BTCUSD", "BTCUSDT", "ETHUSD", "ETHUSDT", "EURUSD"], crypto);
    const byId = new Map(cat.map((c) => [c.symbol, c]));
    assert.equal(byId.get("BTCUSD")!.provider, "binance");
    assert.equal(byId.get("BTCUSD")!.name, "BTCUSDT");
    assert.equal(byId.get("ETHUSD")!.provider, "binance");
    // The broker's USDT tickers are the same assets and must not linger.
    assert.ok(!byId.has("BTCUSDT"));
    assert.ok(!byId.has("ETHUSDT"));
  });

  test("a real FX pair is never displaced by a same-named crypto entry", () => {
    const cat = buildCatalog(["EURUSD", "BTCUSD"], deriveCryptoPairs([raw("EUR", "USDT")]));
    const eur = cat.find((c) => c.symbol === "EURUSD")!;
    assert.equal(eur.provider, undefined);
    assert.equal(eur.type, "forex");
  });

  test("symbols merely inferred as crypto are kept when Binance has no such asset", () => {
    // inferType files these as crypto; they are real broker symbols.
    const cat = buildCatalog(["NVIDIA", "USDNOK", "MAPFRE"], []);
    const ids = cat.map((c) => c.symbol);
    assert.ok(ids.includes("NVIDIA"));
    assert.ok(ids.includes("USDNOK"));
    assert.ok(ids.includes("MAPFRE"));
  });

  test("non-crypto broker symbols are untouched when crypto is merged in", () => {
    const cat = buildCatalog(["EURUSD", "XAUUSD", "USTECH100", "ETHUSD"], crypto);
    assert.ok(cat.some((c) => c.symbol === "EURUSD" && c.provider === undefined));
    assert.ok(cat.some((c) => c.symbol === "XAUUSD"));
    assert.ok(cat.some((c) => c.symbol === "USTECH100"));
  });
});

describe("source routing", () => {
  test("crypto reads from Binance first and keeps cTrader as a fallback", () => {
    const meta = toSymbolMeta("BTCUSDT", "BTCUSD", "BTCUSDT");
    assert.deepEqual(providerOrder(meta), ["binance", "ctrader"]);
  });

  test("non-crypto is broker-only", () => {
    const meta = toSymbolMeta("XAUUSD", "XAUUSD");
    assert.deepEqual(providerOrder(meta), ["ctrader"]);
  });

  test("crypto with no broker line has nothing to fall back to", () => {
    const meta = toSymbolMeta(null, "SOLUSD", "SOLUSDT");
    assert.deepEqual(providerOrder(meta), ["binance"]);
  });

  test("meta for a Binance-only market is typed crypto", () => {
    const meta = toSymbolMeta(null, "SOLUSD", "SOLUSDT");
    assert.equal(meta.type, "crypto");
    assert.equal(meta.providers.binance, "SOLUSDT");
    assert.equal(meta.providers.ctrader, undefined);
  });
});

describe("timeframe coverage per source", () => {
  test("every timeframe is servable by at least one source", () => {
    for (const tf of TIMEFRAMES) {
      const ok = tf.ctrader !== null || tf.binance;
      assert.ok(ok, `${tf.id} has no source`);
    }
  });

  test("Binance serves the intraday intervals natively", () => {
    for (const id of ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]) {
      assert.equal(getTimeframe(id).binance, id, id);
    }
  });

  test("weekly and monthly are aggregated from daily, since Binance has neither", () => {
    for (const id of ["1w", "1M"]) {
      const tf = getTimeframe(id);
      assert.equal(tf.binance, null, id);
      assert.equal(tf.aggregate, "1d", id);
    }
  });
});

describe("bar aggregation", () => {
  const DAY = 24 * 60 * 60 * 1000;

  test("folds daily bars into Monday-aligned UTC weeks", () => {
    // Jan 1 2024 is a Monday. Dividing the epoch by 7 days would start the
    // week on Thursday instead, which is what a chart must not show.
    const start = Date.UTC(2024, 0, 1);
    assert.equal(new Date(start).getUTCDay(), 1, "fixture must start on a Monday");
    const daily = Array.from({ length: 14 }, (_, i) => ({
      time: start + i * DAY,
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
    const weeks = aggregate(daily, "week");
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0].time, start);
    assert.equal(weeks[1].time, start + 7 * DAY);
    // First open, last close, summed volume.
    assert.equal(weeks[0].open, 100);
    assert.equal(weeks[0].close, 106);
    assert.equal(weeks[0].volume, 7);
  });

  test("weeks beginning mid-week still start on the Monday", () => {
    const wed = Date.UTC(2024, 0, 3); // Wednesday
    const [week] = aggregate([{ time: wed, open: 5, high: 5, low: 5, close: 5, volume: 1 }], "week");
    assert.equal(new Date(week.time).getUTCDay(), 1, "bucket must start on Monday");
    assert.equal(week.time, Date.UTC(2024, 0, 1));
  });

  test("months are calendar months, not 30-day blocks", () => {
    const jan = Date.UTC(2024, 0, 1);
    // Jan has 31 days: a 30-day bucket would spill into February.
    const daily = Array.from({ length: 31 }, (_, i) => ({
      time: jan + i * DAY,
      open: i,
      high: i,
      low: i,
      close: i,
      volume: 1,
    }));
    const months = aggregate(daily, "month");
    assert.equal(months.length, 1);
    assert.equal(months[0].time, jan);
    assert.equal(months[0].volume, 31);
  });

  test("separate calendar months do not merge", () => {
    const bars = [
      { time: Date.UTC(2024, 0, 31), open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: Date.UTC(2024, 1, 1), open: 2, high: 2, low: 2, close: 2, volume: 1 },
    ];
    const months = aggregate(bars, "month");
    assert.equal(months.length, 2);
    assert.equal(months[0].volume, 1);
    assert.equal(months[1].volume, 1);
  });

  test("keeps the extremes rather than the last value", () => {
    const bars = [
      { time: Date.UTC(2024, 0, 1), open: 10, high: 12, low: 9, close: 11, volume: 1 },
      { time: Date.UTC(2024, 0, 2), open: 11, high: 30, low: 2, close: 20, volume: 1 },
    ];
    const [bucket] = aggregate(bars, "week");
    assert.equal(bucket.high, 30);
    assert.equal(bucket.low, 2);
    assert.equal(bucket.close, 20);
  });

  test("buckets are stable regardless of input order", () => {
    const mk = (d: number) => ({ time: Date.UTC(2024, 0, d), open: d, high: d, low: d, close: d, volume: 1 });
    const ascending = aggregate([mk(1), mk(2), mk(8)], "week");
    const descending = aggregate([mk(8), mk(2), mk(1)], "week");
    assert.deepEqual(ascending, descending);
  });
});

describe("cTrader credential input", () => {
  const saved = { clientId: "saved-client-id", clientSecret: "saved-client-secret" };

  test("tokens alone are enough once the app details are stored", () => {
    // The whole point: retyping an app secret on every reconnect is busywork.
    const r = resolveConnectInput({ accessToken: "a", refreshToken: "r" }, saved);
    assert.ok(r.ok, r.ok ? "" : r.error);
    assert.deepEqual(r.value, { ...saved, accessToken: "a", refreshToken: "r" });
  });

  test("the first ever connect still requires all four fields", () => {
    const r = resolveConnectInput({ accessToken: "a", refreshToken: "r" }, null);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error.includes("clientId"));
  });

  test("both tokens are always required", () => {
    assert.equal(resolveConnectInput({ accessToken: "a" }, saved).ok, false);
    assert.equal(resolveConnectInput({ refreshToken: "r" }, saved).ok, false);
    assert.equal(resolveConnectInput({}, saved).ok, false);
  });

  test("sent app details override the stored ones, so a recreated app works", () => {
    const r = resolveConnectInput(
      { clientId: " new-id ", clientSecret: " new-secret ", accessToken: "a", refreshToken: "r" },
      saved
    );
    assert.ok(r.ok);
    assert.equal(r.value.clientId, "new-id");
    assert.equal(r.value.clientSecret, "new-secret");
  });

  test("an empty string means omitted rather than blanking the stored value", () => {
    const r = resolveConnectInput({ clientId: "", clientSecret: "   ", accessToken: "a", refreshToken: "r" }, saved);
    assert.ok(r.ok);
    assert.equal(r.value.clientId, saved.clientId);
    assert.equal(r.value.clientSecret, saved.clientSecret);
  });

  test("values are trimmed", () => {
    const r = resolveConnectInput({ accessToken: " a ", refreshToken: " r " }, saved);
    assert.ok(r.ok);
    assert.equal(r.value.accessToken, "a");
    assert.equal(r.value.refreshToken, "r");
  });
});

describe("client id masking", () => {
  test("never reveals the whole id", () => {
    const masked = maskClientId("2845ABCDEF01234567890123456ABCDEF1bOE");
    assert.ok(masked.includes("*"));
    assert.notEqual(masked, "2845ABCDEF01234567890123456ABCDEF1bOE");
    assert.ok(!masked.includes("CDEF0123456789"), "middle must be hidden");
  });

  test("keeps enough to recognise the app", () => {
    assert.ok(maskClientId("2845ABCDEF01234567890123456ABCDEF1bOE").startsWith("2845"));
    assert.ok(maskClientId("2845ABCDEF01234567890123456ABCDEF1bOE").endsWith("1bOE"));
  });

  test("a short id is fully hidden", () => {
    assert.equal(maskClientId("abc"), "***");
    assert.equal(maskClientId(""), "");
  });
});

describe("OpenClaw capture normalization", () => {
  test("reads the documented field/old/new shape", () => {
    const c = normalizeCapture({
      timestamp_utc: "2026-10-26T13:04:00Z",
      session: "london",
      capture_type: "full",
      market_count: 17,
      changes: [{ symbol: "BNBUSD", field: "signal", old: "Strong Sell", new: "Strong Buy" }],
      true_alignments: {
        engulf_1h_4h: [{ symbol: "XAUUSD", details: "Bear engulf + 4H low", signal: "Strong Sell" }],
        triple: [{ symbol: "XAUUSD", type: "Strong Sell + bear engulf + 4H low" }],
      },
      needles_fired: [{ symbol: "XAUUSD", kind: "triple", level: "Strong Sell" }],
      summary: { strong_buy: 0, strong_sell: 10, engulf_alignments: 0, triple_alignments: 0 },
      next_check_utc: "2026-10-26T15:00:00Z",
    });
    assert.equal(c.changes[0].field, "signal");
    assert.equal(c.true_alignments.engulf_1h_4h[0].details, "Bear engulf + 4H low");
    assert.equal(c.summary.engulf_alignments, 0);
    assert.equal(c.next_check_utc, "2026-10-26T15:00:00Z");
  });

  test("reads the cron's change_type/from/to shape and its summary keys", () => {
    const c = normalizeCapture({
      timestamp_utc: "2026-10-26T16:04:00Z",
      session: "ny_afternoon",
      capture_type: "hourly",
      market_count: 18,
      changes: [
        { symbol: "BCHUSD", change_type: "signal_flip", from: "Strong Sell", to: "Buy" },
        { symbol: "EURUSD", change_type: "pattern_change", from: "4H high", to: "Bear engulf" },
      ],
      true_alignments: { engulf_1h_4h: [], triple: [] },
      needles_fired: [],
      summary: { strong_buy: 2, strong_sell: 7, engulf_1h_4h: 0, triple: 0 },
      next_check_utc: "2026-10-26T17:00:00Z",
    });
    assert.deepEqual(
      c.changes.map((x) => [x.field, x.old, x.new]),
      [
        ["signal", "Strong Sell", "Buy"],
        ["patterns", "4H high", "Bear engulf"],
      ]
    );
    assert.equal(c.summary.engulf_alignments, 0);
    assert.equal(c.summary.triple_alignments, 0);
  });

  test("splits a signal flip that also removed a pattern", () => {
    const c = normalizeCapture({
      timestamp_utc: "2026-10-26T17:04:00Z",
      session: "hourly",
      capture_type: "hourly",
      changes: [
        { symbol: "GER40", change: "signal_flip", from: "Buy", to: "Strong Buy", pattern_change: "Bull engulf removed" },
      ],
      summary: { strong_buy: 1, strong_sell: 1, true_1h_4h_alignments: 0, triple_alignments: 0 },
    });
    assert.deepEqual(
      c.changes.map((x) => [x.symbol, x.field, x.old, x.new]),
      [
        ["GER40", "signal", "Buy", "Strong Buy"],
        ["GER40", "patterns", "Bull engulf", ""],
      ]
    );
    assert.equal(c.summary.engulf_alignments, 0);
  });
});

describe("market snapshot UI helpers", () => {
  function cap(overrides: Partial<import("../src/webapp/src/market/types").MarketSnapshot> = {}) {
    return {
      schema_version: 1,
      timestamp_utc: "2026-10-26T17:04:00Z",
      session: "hourly",
      capture_type: "hourly",
      market_count: 4,
      changes: [],
      true_alignments: { engulf_1h_4h: [], triple: [] },
      needles_fired: [],
      summary: { strong_buy: 1, strong_sell: 1, engulf_alignments: 0, triple_alignments: 0 },
      next_check_utc: null,
      ...overrides,
    };
  }

  test("converts UTC to a fixed UTC+3 clock", () => {
    const now = Date.parse("2026-10-26T18:00:00Z");
    assert.equal(fmtUtc3("2026-10-26T17:04:00Z", now), "20:04 UTC+3");
    assert.equal(fmtUtc3("2026-10-23T17:04:00Z", now), "23 Oct 20:04 UTC+3");
  });

  test("day keys and labels roll over in UTC+3", () => {
    assert.equal(dayKey("2026-10-26T22:30:00Z"), "2026-10-27");
    const now = Date.parse("2026-10-26T12:00:00Z");
    assert.equal(dayLabel("2026-10-26", now), "Today");
    assert.equal(dayLabel("2026-10-25", now), "Yesterday");
    assert.equal(dayLabel("2026-10-23", now), "23 Oct 2026");
  });

  test("relative time is compact", () => {
    const now = Date.parse("2026-10-26T18:00:00Z");
    assert.equal(relativeTime("2026-10-26T17:50:00Z", now), "10m ago");
    assert.equal(relativeTime("2026-10-26T16:00:00Z", now), "2h ago");
    assert.equal(relativeTime("2026-10-23T18:00:00Z", now), "3d ago");
    assert.equal(relativeTime("2026-10-26T18:00:00Z", now), "just now");
  });

  test("groups multiple fields for one symbol", () => {
    const groups = groupChanges([
      { symbol: "GER40", field: "signal", old: "Buy", new: "Strong Buy" },
      { symbol: "GER40", field: "patterns", old: "Bull engulf", new: "" },
      { symbol: "XRPUSD", field: "signal", old: "Neutral", new: "Sell" },
    ]);
    assert.deepEqual(
      groups.map((g) => [g.symbol, g.changes.length]),
      [
        ["GER40", 2],
        ["XRPUSD", 1],
      ]
    );
    assert.equal(changedSymbolCount([
      { symbol: "GER40", field: "signal", old: "", new: "" },
      { symbol: "GER40", field: "patterns", old: "", new: "" },
    ]), 1);
  });

  test("search matches symbols, sessions and types", () => {
    const c = cap({
      true_alignments: {
        engulf_1h_4h: [{ symbol: "XAUUSD", details: "Bear engulf + 4H low", type: "", signal: "Strong Sell" }],
        triple: [],
      },
    });
    assert.equal(matchesCapture(c, "xau"), true);
    assert.equal(matchesCapture(c, "hourly"), true);
    assert.equal(matchesCapture(c, "btcusd"), false);
    assert.equal(matchesCapture(c, "  "), true);
  });
});
