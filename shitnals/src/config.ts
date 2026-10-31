/**
 * Central configuration. Every number that affects results lives here so it is versioned
 * and visible. Changing any value here changes results: bump ENGINE_VERSION and note it.
 *
 * HARD RULE: this project makes no broker connection for cost data. Costs below are hard-coded
 * constants. Refreshing them requires a read-only sub-account, never the shared grant.
 */

export const ENGINE_VERSION = "0.2.0";

/* ------------------------------------------------------------------
 * SPREAD_TABLE: measured once, verify against broker statement before relying on absolute results.
 * Price units per unit traded. Median (ask - bid) of spot quotes sampled for 20 s on the cTrader
 * demo grant, 2026-10-27. Sample counts are small (10 to 38 quotes per symbol): indicative only.
 * US100 is not on that account: null, and the engine refuses to run it.
 * ------------------------------------------------------------------ */
export const SPREAD_TABLE_DATE = "2026-10-27";
export const SPREAD_TABLE: Record<string, number | null> = {
  XAUUSD: 0.1,
  XAGUSD: 0.03,
  EURUSD: 0.00001,
  GBPUSD: 0.00004,
  USDJPY: 0.003,
  BTCUSD: 19.28,
  US100: null,
};
export const SPREAD_SAMPLES: Record<string, number> = {
  XAUUSD: 38,
  XAGUSD: 10,
  EURUSD: 17,
  GBPUSD: 18,
  USDJPY: 27,
  BTCUSD: 32,
};

/* ------------------------------------------------------------------
 * COMMISSION. Raw value of the DEPRECATED ProtoOASymbol.commission field, commissionType
 * USD_PER_MILLION_USD, read on the same date as the spreads above.
 *
 * UNIT IS NOT VERIFIED. Per the cTrader proto (OpenApiModelMessages.proto):
 *   - USD_PER_MILLION_USD means "USD per million USD of volume" (docs example: 50 USD per 1M).
 *   - `commission` is documented only as "commission base amount"; its unit is not stated.
 *   - `preciseTradingCommissionRate` (the replacement) is stored ×10^8. We have not read it.
 * COMMISSION_DIVISOR = 100 assumes the raw value is in hundredths of USD per million. Plausibility
 * supports it (raw 4500 -> $45/M per side, about 1 pip round trip on EURUSD; raw 4500 read as
 * plain USD would be 0.45% per side, implausible). A 10x error changes the ranking. Sweep reports
 * a sensitivity run with divisor 1 and 10 (see README "Commission unit").
 * ------------------------------------------------------------------ */
export const COMMISSION_RAW: Record<string, number> = {
  XAUUSD: 2500,
  XAGUSD: 2500,
  EURUSD: 4500,
  GBPUSD: 4500,
  USDJPY: 4500,
  BTCUSD: 0,
};
export const COMMISSION_DIVISOR = 100;
export const COMMISSION_UNIT_STATUS = "ASSUMED (hundredths of USD per million), NOT VERIFIED";

/**
 * Round-trip cost in price units for a trade entered at `entryPrice`:
 *     cost(P) = spread + 2 * commissionRate * P
 *     commissionRate = (COMMISSION_RAW / divisor) / 1_000_000   (USD per USD of notional, per side)
 * Notional per unit = P for quote-USD pairs and XAU/XAG; for USDJPY (USD base) it is 1 USD = P JPY,
 * which reduces to the same rate * P in quote units.
 */
export function roundTripCost(symbol: string, entryPrice: number, divisor: number = COMMISSION_DIVISOR): number {
  const spread = SPREAD_TABLE[symbol];
  if (spread == null) throw new Error(`No spread measurement for ${symbol}; refusing to run without costs`);
  const raw = COMMISSION_RAW[symbol];
  if (raw == null) throw new Error(`No commission entry for ${symbol}`);
  const rate = raw / divisor / 1_000_000;
  return spread + 2 * rate * entryPrice;
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

/** Engine and report constants. */
export const ENGINE = {
  /** Time stop: a position still open at entry + MAX_HOLD_BARS is closed at that bar's open. */
  MAX_HOLD_BARS: 96,
  /** Out-of-sample: trades whose ENTRY time falls in the final TEST_MONTHS months are test. */
  TEST_MONTHS: 6,
} as const;

/** Qualification thresholds for the sweep (see README "Qualification"). */
export const QUALIFY = {
  /** A variant with tieRate above this is excluded from ranked lists. */
  MAX_TIE_RATE: 0.05,
  /** A regime row needs at least this many trades to be ranked. Added by us, not in the brief. */
  MIN_REGIME_TRADES: 30,
} as const;
