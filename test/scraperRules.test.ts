import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildCapture, captureType, detectAlignments, diffObservations, engulfClosed, isWeekendClosed,
  newNeedles, sessionLabel, signalFromRating, structureClosed, patternLabels,
  type Obs, type Structure4h,
} from "../src/server/market/scraperRules";
import { detectEngulfing, detectSweep } from "../src/server/market/patterns";
import type { Candle } from "../src/server/market/types";

const NONE: Structure4h = { low4h: false, high4h: false, sweepLow: false, sweepHigh: false, trueLow: false, trueHigh: false };
const WED_NOON = "2026-11-04T12:00:00Z"; // Wednesday, a normal trading moment

function obs(over: Partial<Obs> = {}): Obs {
  return { symbol: "XAUUSD", category: "commodity", price: 4000, signal: "Strong Sell", engulf1h: null, engulf4h: null, structure4h: NONE, asOf: WED_NOON, ...over };
}
const TRUE_LOW = { ...NONE, low4h: true, trueLow: true };
const SWEEP_LOW = { ...NONE, low4h: true, sweepLow: true };

describe("sessions and capture type", () => {
  test("labels by UTC hour", () => {
    assert.equal(sessionLabel("2026-11-04T00:00:00Z"), "tokyo");
    assert.equal(sessionLabel("2026-11-04T08:00:00Z"), "london");
    assert.equal(sessionLabel("2026-11-04T12:00:00Z"), "pre_ny");
    assert.equal(sessionLabel("2026-11-04T13:00:00Z"), "ny");
    assert.equal(sessionLabel("2026-11-04T16:00:00Z"), "ny_afternoon");
    assert.equal(sessionLabel("2026-11-04T04:00:00Z"), "4h_close");
    assert.equal(sessionLabel("2026-11-04T20:00:00Z"), "4h_close");
    assert.equal(sessionLabel("2026-11-04T09:00:00Z"), "hourly");
  });
  test("full at anchors, lightweight otherwise", () => {
    assert.equal(captureType("2026-11-04T13:00:00Z"), "full");
    assert.equal(captureType("2026-11-04T10:00:00Z"), "lightweight");
  });
});

describe("weekend filter (SKILL.md step 3)", () => {
  test("forex closed Fri 21:00 to Sun 21:00 UTC", () => {
    assert.equal(isWeekendClosed("2026-11-06T20:59:00Z"), false); // Fri before 21:00
    assert.equal(isWeekendClosed("2026-11-06T21:00:00Z"), true);  // Fri 21:00
    assert.equal(isWeekendClosed("2026-11-07T12:00:00Z"), true);  // Sat
    assert.equal(isWeekendClosed("2026-11-08T20:59:00Z"), true);  // Sun before 21:00
    assert.equal(isWeekendClosed("2026-11-08T21:00:00Z"), false); // Sun 21:00
  });
  test("suppresses forex and index alignments, keeps crypto", () => {
    const weekend = "2026-11-07T12:00:00Z";
    const a = detectAlignments(obs({ category: "forex", asOf: weekend, engulf1h: "bearish", engulf4h: "bearish", structure4h: TRUE_LOW }));
    assert.equal(a.alignment_1h_4h, false);
    assert.equal(a.alignment_triple, false);
    const c = detectAlignments(obs({ category: "crypto", asOf: weekend, engulf1h: "bearish", engulf4h: "bearish", structure4h: TRUE_LOW }));
    assert.equal(c.alignment_1h_4h, true);
  });
});

describe("alignment rules (SKILL.md step 3)", () => {
  test("1H+4H engulf needs both engulfs present and in the same direction", () => {
    assert.equal(detectAlignments(obs({ engulf1h: "bearish", engulf4h: "bearish" })).alignment_1h_4h, true);
    assert.equal(detectAlignments(obs({ engulf1h: "bullish", engulf4h: "bearish" })).alignment_1h_4h, false, "contradictory pair is not listed");
    assert.equal(detectAlignments(obs({ engulf1h: "bearish", engulf4h: null })).alignment_1h_4h, false);
  });

  test("triple: Strong Sell + bear engulf + TRUE 4H low", () => {
    const a = detectAlignments(obs({ engulf1h: "bearish", engulf4h: "bearish", structure4h: TRUE_LOW }));
    assert.equal(a.alignment_triple, true);
    assert.equal(a.triple_type, "4H low");
  });

  test("a sweep is not a true break, so no triple", () => {
    const a = detectAlignments(obs({ engulf1h: "bearish", engulf4h: "bearish", structure4h: SWEEP_LOW }));
    assert.equal(a.alignment_1h_4h, true);
    assert.equal(a.alignment_triple, false);
    assert.equal(a.triple_type, null);
  });

  test("triple needs the signal to match the engulf direction", () => {
    const a = detectAlignments(obs({ signal: "Strong Buy", engulf1h: "bearish", engulf4h: "bearish", structure4h: TRUE_LOW }));
    assert.equal(a.alignment_triple, false);
  });

  test("Strong Buy mirror: bull engulf + true 4H high", () => {
    const high = { ...NONE, high4h: true, trueHigh: true };
    const a = detectAlignments(obs({ signal: "Strong Buy", engulf1h: "bullish", engulf4h: "bullish", structure4h: high }));
    assert.equal(a.alignment_triple, true);
    assert.equal(a.triple_type, "4H high");
  });
});

describe("pattern labels and changes (SKILL.md step 6)", () => {
  test("labels distinguish sweep from true break", () => {
    assert.deepEqual(patternLabels(obs({ engulf4h: "bearish", structure4h: SWEEP_LOW })), ["4H Bear engulf", "4H low (sweep)"]);
    assert.deepEqual(patternLabels(obs({ structure4h: TRUE_LOW })), ["4H low"]);
  });

  test("a signal flip and a cleared pattern are reported; first sighting is not", () => {
    const prev = [obs({ signal: "Strong Buy", structure4h: TRUE_LOW })];
    const cur = [obs({ signal: "Strong Sell", structure4h: NONE })];
    const ch = diffObservations(prev, cur);
    assert.deepEqual(ch, [
      { symbol: "XAUUSD", field: "signal", old: "Strong Buy", new: "Strong Sell" },
      { symbol: "XAUUSD", field: "patterns", old: "4H low", new: "" },
    ]);
    assert.deepEqual(diffObservations([], cur), []);
  });
});

describe("needles", () => {
  test("fire on a fresh flip to true, once per symbol, session and kind", () => {
    const prev = [obs({ engulf1h: "bearish", engulf4h: null })];
    const cur = [obs({ engulf1h: "bearish", engulf4h: "bearish" })];
    const n1 = newNeedles(prev, cur, "ny", new Set());
    assert.equal(n1.length, 1);
    assert.equal(n1[0].key, "XAUUSD:ny:engulf_1h_4h");
    assert.equal(newNeedles(prev, cur, "ny", new Set([n1[0].key])).length, 0, "already fired this session");
  });

  test("an alignment that was already true does not fire again", () => {
    const both = [obs({ engulf1h: "bearish", engulf4h: "bearish" })];
    assert.equal(newNeedles(both, both, "ny", new Set()).length, 0);
  });

  test("a new session allows the same symbol to fire again", () => {
    const prev = [obs({ engulf1h: "bearish", engulf4h: null })];
    const cur = [obs({ engulf1h: "bearish", engulf4h: "bearish" })];
    assert.equal(newNeedles(prev, cur, "london", new Set(["XAUUSD:ny:engulf_1h_4h"])).length, 1);
  });
});

describe("capture payload matches the write_capture schema", () => {
  test("lists only true alignments and totals them", () => {
    const list = [
      obs({ symbol: "XAUUSD", engulf1h: "bearish", engulf4h: "bearish", structure4h: TRUE_LOW }),
      obs({ symbol: "BTCUSD", category: "crypto", signal: "Strong Buy", engulf1h: "bullish", engulf4h: "bearish" }),
      obs({ symbol: "EURUSD", category: "forex", signal: "Buy" }),
    ];
    const p = buildCapture({ timestamp_utc: WED_NOON, obs: list, changes: [], needles: [] });
    assert.equal(p.session, "pre_ny");
    assert.equal(p.capture_type, "full");
    assert.equal(p.market_count, 3);
    assert.deepEqual(p.true_alignments.engulf_1h_4h, [{ symbol: "XAUUSD", details: "Bear engulf + 4H low", signal: "Strong Sell" }]);
    assert.equal(p.true_alignments.triple[0].symbol, "XAUUSD");
    assert.equal(p.true_alignments.triple[0].type, "Strong Sell + bear engulf + 4H low");
    assert.deepEqual(p.summary, { strong_buy: 1, strong_sell: 1, engulf_alignments: 1, triple_alignments: 1 });
    assert.equal(p.next_check_utc, "2026-11-04T13:00:00Z");
  });
});

describe("rating mapping", () => {
  test("maps analysis ratings to skill labels", () => {
    assert.equal(signalFromRating("strong_sell"), "Strong Sell");
    assert.equal(signalFromRating("buy"), "Buy");
    assert.equal(signalFromRating("nope"), null);
  });
});

// ---- equivalence with the existing bar detectors (same live code path) ----
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function walk(n: number, seed: number): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = o + (r() - 0.5) * 3;
    out.push({ time: i * 14_400_000, open: o, high: Math.max(o, c) + r() * 1.2, low: Math.min(o, c) - r() * 1.2, close: c, volume: 1 });
    p = c;
  }
  return out;
}

describe("closed-bar rules agree with patterns.ts on the same bars", () => {
  test("engulf and sweep match detectEngulfing/detectSweep over 400 random windows", () => {
    let checked = 0, engulfs = 0, sweeps = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const bars = walk(500, seed);
      for (let end = 30; end < bars.length - 1; end++) {
        const closed = bars.slice(0, end);
        // patterns.ts ignores the last element (the forming bar), so append one.
        const withForming = [...closed, { ...bars[end] }];
        const e = engulfClosed(closed);
        assert.equal(e, detectEngulfing(withForming, "4h"), `engulf at ${end}`);
        const s = structureClosed(closed);
        const legacy = detectSweep(withForming);
        assert.equal(s.sweepLow || s.sweepHigh ? (s.sweepLow && s.sweepHigh ? "both" : s.sweepLow ? "low" : "high") : null, legacy, `sweep at ${end}`);
        if (e) engulfs++;
        if (legacy) sweeps++;
        checked++;
      }
    }
    assert.ok(checked > 1000);
    assert.ok(engulfs > 0 && sweeps > 0, `coverage: engulfs=${engulfs} sweeps=${sweeps}`);
  });
});

import { isStale } from "../src/server/market/scraperRules";
describe("freshness", () => {
  const H4 = 4 * 3_600_000;
  const now = Date.UTC(2026, 10, 2, 13, 3); // 13:03 UTC
  test("a series whose newest bar is the last closed bar is fresh (cTrader 02:00 grid)", () => {
    // 06:00 bar closed at 10:00; the 10:00 bar is still forming at 13:03.
    const bars = [{ time: Date.UTC(2026, 10, 2, 2, 0) }, { time: Date.UTC(2026, 10, 2, 6, 0) }] as Candle[];
    assert.equal(isStale(bars, H4, now), false);
  });
  test("a series that stops two closed bars back is stale", () => {
    // Newest bar opened 22:00 the day before, closed 02:00; 06:00 and 10:00 are missing.
    const bars = [{ time: Date.UTC(2026, 10, 1, 18, 0) }, { time: Date.UTC(2026, 10, 1, 22, 0) }] as Candle[];
    assert.equal(isStale(bars, H4, now), true);
  });
  test("an empty series is stale", () => assert.equal(isStale([], H4, now), true));
});

// ---- lastBarForming: cTrader series (no forming bar) vs Binance (forming bar included) ----
import { detectEngulfing as legacyEngulf, detectSweep as legacySweep, isLastBarForming } from "../src/server/market/patterns";
describe("lastBarForming flag", () => {
  const b = (o: number, c: number): Candle => ({ time: 0, open: o, close: c, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, volume: 1 });
  // The shared engulf rule needs ATR20, so give it a flat history first.
  const history = Array.from({ length: 20 }, () => b(50, 50));
  test("closed series: the last bar is the bar under test", () => {
    const closed = [...history, b(10, 8), b(7, 11)]; // bullish engulf on the last bar
    assert.equal(legacyEngulf(closed, "4h", false), "bullish");
    assert.equal(legacyEngulf(closed, "4h", true), null, "old behaviour ignores the last bar");
  });
  test("forming-bar series keeps the old behaviour", () => {
    const withForming = [...history, b(10, 8), b(7, 11), b(1, 1)];
    assert.equal(legacyEngulf(withForming, "4h", true), "bullish");
  });
  test("sweep: closed series reads the last bar", () => {
    const ref = Array.from({ length: 6 }, () => ({ time: 0, open: 9, close: 9, high: 10, low: 8, volume: 1 }) as Candle);
    const sweepHigh = { time: 0, open: 9, close: 9, high: 12, low: 8, volume: 1 } as Candle;
    assert.equal(legacySweep([...ref, sweepHigh], false), "high");
  });
  test("isLastBarForming uses the clock", () => {
    const H = 4 * 3_600_000;
    const now = Date.UTC(2026, 10, 2, 13, 0);
    // 08:00 bar closes at 12:00, before now, so it is closed.
    assert.equal(isLastBarForming([{ time: Date.UTC(2026, 10, 2, 8, 0) }] as Candle[], H, now), false);
    // 12:00 bar closes at 16:00, after now, so it is still forming.
    assert.equal(isLastBarForming([{ time: Date.UTC(2026, 10, 2, 12, 0) }] as Candle[], H, now), true);
  });
});
