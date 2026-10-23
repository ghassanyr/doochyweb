// Central timeframe definition. Each source maps an id to its own vocabulary,
// so adding a source means touching one place.
//
// cTrader serves bars through ProtoOAGetTrendbarsReq, whose `period` is an enum
// (not a minute count) and which caps how far back a single request may reach
// per period. Both are encoded here so the provider stays a thin adapter.
//
// Binance publishes klines on its own interval names. It has no weekly or
// monthly interval at all, so `aggregate` names the interval those two are
// built from instead.

import type { Timeframe } from "./types";

/** ProtoOATrendbarPeriod enum values. NOT the minute counts. */
const M1 = 1, M2 = 2, M3 = 3, M4 = 4, M5 = 5, M10 = 6, M15 = 7, M30 = 8;
const H1 = 9, H4 = 10, H12 = 11, D1 = 12, W1 = 13, MN1 = 14;

// toTimestamp - fromTimestamp ceilings, from the proto's own documentation.
const FIVE_WEEKS = 302_400_000;      // M1, M2, M3, M4, M5
const THIRTY_FIVE_WEEKS = 21_168_000_000; // M10, M15, M30, H1
const ONE_YEAR = 31_622_400_000;     // H4, H12, D1
const FIVE_YEARS = 158_112_000_000;  // W1, MN1

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m",  label: "1 min",   ms: 60 * 1000,           ttl: 60,   ctrader: M1,  ctraderMaxRange: FIVE_WEEKS, binance: "1m" },
  { id: "3m",  label: "3 min",   ms: 3 * 60 * 1000,       ttl: 60,   ctrader: M3,  ctraderMaxRange: FIVE_WEEKS, binance: "3m" },
  { id: "5m",  label: "5 min",   ms: 5 * 60 * 1000,       ttl: 60,   ctrader: M5,  ctraderMaxRange: FIVE_WEEKS, binance: "5m" },
  { id: "15m", label: "15 min",  ms: 15 * 60 * 1000,      ttl: 120,  ctrader: M15, ctraderMaxRange: THIRTY_FIVE_WEEKS, binance: "15m" },
  { id: "30m", label: "30 min",  ms: 30 * 60 * 1000,      ttl: 180,  ctrader: M30, ctraderMaxRange: THIRTY_FIVE_WEEKS, binance: "30m" },
  { id: "1h",  label: "1 hour",  ms: 60 * 60 * 1000,      ttl: 300,  ctrader: H1,  ctraderMaxRange: THIRTY_FIVE_WEEKS, binance: "1h" },
  { id: "4h",  label: "4 hours", ms: 4 * 60 * 60 * 1000,  ttl: 600,  ctrader: H4,  ctraderMaxRange: ONE_YEAR, binance: "4h" },
  { id: "1d",  label: "1 day",   ms: 24 * 60 * 60 * 1000, ttl: 900,  ctrader: D1,  ctraderMaxRange: ONE_YEAR, binance: "1d" },
  { id: "1w",  label: "1 week",  ms: 7 * 24 * 60 * 60 * 1000, ttl: 3600, ctrader: W1, ctraderMaxRange: FIVE_YEARS, binance: null, aggregate: "1d", bucket: "week" },
  { id: "1M",  label: "1 month", ms: 30 * 24 * 60 * 60 * 1000, ttl: 3600, ctrader: MN1, ctraderMaxRange: FIVE_YEARS, binance: null, aggregate: "1d", bucket: "month" },
];

export const DEFAULT_TIMEFRAME = "4h";

export function getTimeframe(id: string): Timeframe {
  return (
    TIMEFRAMES.find((t) => t.id === id) ||
    TIMEFRAMES.find((t) => t.id === DEFAULT_TIMEFRAME)!
  );
}

export function isTimeframeId(id: string): boolean {
  return TIMEFRAMES.some((t) => t.id === id);
}

export function timeframeLabels(): { id: string; label: string }[] {
  return TIMEFRAMES.map(({ id, label }) => ({ id, label }));
}