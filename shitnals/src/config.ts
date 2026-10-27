/**
 * Central configuration. Every number that affects results lives here so it is versioned
 * and visible. Changing any value here changes results: bump ENGINE_VERSION and note it.
 */

export const ENGINE_VERSION = "0.1.0";

/**
 * Per-instrument costs, in PRICE UNITS per unit traded (same unit as the price).
 *
 * Round-trip cost for a trade entered at price P:
 *     cost(P) = spreadPrice + 2 * commissionRate * P
 *     commissionRate = commissionUsdPerMillionPerSide / 1_000_000
 * The commission term is proportional to price because cTrader quotes commission as USD per
 * million USD of notional; for every instrument here, USD notional per unit = P (quote USD) or
 * 1 USD (USDJPY base), and both reduce to rate * P in quote price units.
 *
 * Sources (read-only probe against the cTrader demo grant, 2026-10-27, 20 s of spot quotes):
 *   spreadPrice = median(ask - bid) over the sampled quotes.
 *   commission  = ProtoOASymbolByIdReq.commission / 100, read as USD per million notional
 *                 per side. The /100 scaling is an INFERENCE (4500 -> $45/M, about 1 pip round
 *                 trip on EURUSD). Verify against a broker statement before trusting absolute P&L.
 * Sample counts are small (10 to 38 quotes per symbol), so spreads are indicative, not
 * a precise average. US100 is not on this account, so it is UNMEASURED and cannot be run.
 */
export interface InstrumentCost {
  spreadPrice: number;
  commissionUsdPerMillionPerSide: number;
  spreadSamples: number;
}

export const INSTRUMENT_COSTS: Record<string, InstrumentCost | null> = {
  XAUUSD: { spreadPrice: 0.1, commissionUsdPerMillionPerSide: 25, spreadSamples: 38 },
  XAGUSD: { spreadPrice: 0.03, commissionUsdPerMillionPerSide: 25, spreadSamples: 10 },
  EURUSD: { spreadPrice: 0.00001, commissionUsdPerMillionPerSide: 45, spreadSamples: 17 },
  GBPUSD: { spreadPrice: 0.00004, commissionUsdPerMillionPerSide: 45, spreadSamples: 18 },
  USDJPY: { spreadPrice: 0.003, commissionUsdPerMillionPerSide: 45, spreadSamples: 27 },
  BTCUSD: { spreadPrice: 19.28, commissionUsdPerMillionPerSide: 0, spreadSamples: 32 },
  US100: null, // unmeasured: not on the demo account
};

/** Round-trip cost in price units for a trade entered at `entryPrice`. Throws if unmeasured. */
export function roundTripCost(symbol: string, entryPrice: number): number {
  const c = INSTRUMENT_COSTS[symbol];
  if (!c) throw new Error(`No cost measurement for ${symbol}; refusing to run without costs`);
  const rate = c.commissionUsdPerMillionPerSide / 1_000_000;
  return c.spreadPrice + 2 * rate * entryPrice;
}

/** Regime thresholds (decided before any results were seen; not tuned). */
export const REGIME = {
  /** ADX(14) > ADX_TRENDING -> trending. ADX_RANGING <= ADX <= ADX_TRENDING -> ambiguous. ADX < ADX_RANGING -> ranging. */
  ADX_PERIOD: 14,
  ADX_TRENDING: 25,
  ADX_RANGING: 20,
  /** Range/ATR ratio over the last RANGE_BARS bars, using ATR(RANGE_BARS). Ratio < RANGE_ATR_RANGING -> ranging. */
  RANGE_BARS: 20,
  RANGE_ATR_RANGING: 6.0,
} as const;

/** Engine constants. */
export const ENGINE = {
  /** Time stop: a position still open at entry + MAX_HOLD_BARS is closed at that bar's open. */
  MAX_HOLD_BARS: 96,
  /** Out-of-sample: trades whose ENTRY time falls in the final TEST_MONTHS months are test. */
  TEST_MONTHS: 6,
  RSI_PERIOD_DEFAULT: 14,
} as const;
