# shitnals

Signal edge-research sandbox. Backtests conventional RSI + MACD + volume + pivot signals and their
inverted mirrors on cTrader OHLCV, with costs, tie-bar bands, regime splits, and an out-of-sample
holdout. Research evidence only. No orders, no bot, no live signals.

## Hard rules

1. **No broker connection from this project.** Price history comes from the cached candle files.
   Costs are hard-coded constants in `src/config.ts`. Do not add code that logs in to cTrader.
2. **If a cost probe is ever needed,** it runs on a read-only sub-account, never the shared grant that
   DoochyWeb and DoochyBot use. The token-refresh request is never called, because refresh rotates the
   grant for every connection.
3. **No code path may trade or place orders.** The engine only reads bars and writes files.
4. **Costs are first class.** A symbol with no measured spread (`US100`) throws and refuses to run.

## Quick start

```
pnpm install
cp .env.example .env            # CTRADER_* only needed for fetch; never commit .env
./node_modules/.bin/tsx src/fetch.ts --symbol=XAUUSD --timeframe=15m --days=730
pnpm test                       # 32 tests, including real-data look-ahead and identity checks
./node_modules/.bin/tsx src/backtest.ts --symbol=XAUUSD --tf=15m --variant=minisig_b_nomacd [--tiePolicy=TP]
./node_modules/.bin/tsx src/mirror.ts --variant=minisig_b_nomacd [--tiePolicy=SL|TP]
./node_modules/.bin/tsx src/funnel.ts --variant=minisig_c_vol15       # why a variant has zero trades
./node_modules/.bin/tsx src/sweep.ts [--commissionDivisor=100] [--csv=out/sweep_summary.csv]
```

`pnpm <script> -- --flag=value` swallows flags in this pnpm version, so call `tsx` directly.
Fetching is incremental. A current cache makes no broker call. Bars that have not closed are never cached.

Outputs: `out/runs/{RUN_ID}/` (`trades.csv`, `summary.json`, `log.txt`, `audit.txt`) and
`out/sweep_summary.csv`. Run IDs carry the UTC time, symbol, timeframe, variant, and engine version.

## Fill rules

Identical in the engine and the mirror re-simulation (`walkExit` in `src/backtest.ts`).

1. **Decision.** The signal for bar `t` uses only closed bars `0..t`.
2. **Fill.** Entry fills at the **open of bar `t+1`**, with no slippage beyond the spread.
3. **Levels.** SL and TP are set from ATR(14) at bar `t`. Long: SL = fill − `slAtr`·ATR, TP = fill + `tpAtr`·ATR. Short is mirrored.
4. **Fill bar is checked.** Bar `t+1` is checked for SL/TP against its high and low.
5. **Gap through a level.** If the bar's OPEN is already beyond SL or TP, the exit fills at that OPEN
   (`SL_GAP` / `TP_GAP`). A gapped target is therefore filled at the open, which is worse than the target for a long.
6. **Tie bar.** If both SL and TP are inside the bar's range (not a gap), the exit is resolved by
   `tiePolicy`. `SL` (pessimistic) exits at SL. `TP` (optimistic) exits at TP. The trade is flagged `tie = true`.
   The sweep reports both policies as a band. See "Tie bands".
7. **Time stop.** A position open at entry + `MAX_HOLD_BARS` (96 bars, 24 h on 15m) closes at that bar's OPEN.
8. **End of data.** Closes at the last close.
9. **One position at a time.** Scanning resumes on the exit bar, whose close is known, so a new signal may fire there.

## Cost model

`netPnl = grossPnl − cost`, charged once per trade, in price units per unit traded.

    cost(P) = spreadPrice + 2 · commissionRate · P
    commissionRate = (COMMISSION_RAW / COMMISSION_DIVISOR) / 1,000,000

`P` is the fill price. `COMMISSION_DIVISOR = 100` is an assumption (see "Commission unit").

**SPREAD_TABLE** (dated 2026-10-27, `src/config.ts`). Measured once: median ask − bid over 20 s of spot quotes.
Verify against a broker statement before relying on absolute results.

| Symbol | Spread (price units) | Spread samples | Commission raw (USD/M per side, pre-divisor) |
|---|---|---|---|
| XAUUSD | 0.10 | 38 | 2500 |
| XAGUSD | 0.03 | 10 | 2500 |
| EURUSD | 0.00001 | 17 | 4500 |
| GBPUSD | 0.00004 | 18 | 4500 |
| USDJPY | 0.003 | 27 | 4500 |
| BTCUSD | 19.28 | 32 | 0 |
| US100 | **null (unmeasured, refuses to run)** | 0 | n/a |

Sample counts are small (10 to 38 quotes). Spreads are indicative.

### Commission unit: NOT VERIFIED

- The proto documents `USD_PER_MILLION_USD` as "USD per million USD volume… 50 USD for 1 mil". It does not
  state a scale for the deprecated `commission` field. The replacement, `preciseTradingCommissionRate`, is stored ×10^8.
- The raw value 4500 read as plain USD/M is 0.45% per side, which is implausible for FX. The assumed
  hundredths reading gives $45/M, about 1 pip round trip on EURUSD. Plausibility supports ÷100, but the
  docs do not prove it.
- **Sensitivity** (full sweep at divisors 100, 10, and 1000, the two 10× alternatives):
  - Ranging top-4 and trending top-20 **ordering is the same at ÷100 and ÷10**. At ÷1000 the trending order differs,
    so the top 20 are not fully stable.
  - **Magnitudes move about 7–10×.** The top ranging |G|/C is 9.1 at ÷100, 1.3 at ÷10, and 22.7 at ÷1000.
  - **Signs do not move.** Gross is independent of cost, so G/C keeps its sign.
  - The baseline's gross-vs-cost conclusion **depends on the unit**: |G|/C 0.45 at ÷100, 0.06 at ÷10, and 1.09 at ÷1000
    (net +2.76 at ÷1000, so the sign of net flips).
- **Resolution needed:** read `preciseTradingCommissionRate` for XAUUSD from a read-only sub-account, or check a
  deal's commission in a broker statement against lot size and price. Until then, all absolute P&L is provisional.

## Mirror identity, corrected

For a trade with fill `E`, direction `d`, stop `S`, target `T`, cost `C`, and net `N = G − C`, the mirror
is the opposite direction on the same fill, with stop' = `T` and target' = `S`, re-simulated by `walkExit`
with the same tie policy.

    N' = −N − 2C − 2 · Σ tieLoss

    tieLoss_i = policySign · (s_i + t_i) / 2     on tie trades, 0 otherwise
    s = |E − S|,  t = |T − E|,  policySign = +1 for SL-first, −1 for TP-first

Derivation: on a non-tie trade the mirror exits at the same bar and price as the original, so `G' = −G` and
`N' = −N − 2C`. On a tie bar each side takes the policy's level and gives up the other, so `G + G' = −(s+t)` under SL-first
and `+(s+t)` under TP-first.

**Verification.** `src/identity.test.ts` runs the mirror engine on real data at 1.0/1.0, 0.5/0.5, and 0.3/0.3 ATR, under
both policies. The aggregate residual `N'_sim − (−N − 2C − 2Σ tieLoss)` is below 1e-6, and the per-trade residual below 1e-9.
At 0.5/0.5 SL-first (373 trades, 55 ties) the observed divergence is **−507.994619**, and the formula gives **−2·Σ tieLoss = −507.994619**.
At the baseline fixed variant, 0 ties, the identity holds to 1e-13.

A nonzero residual is a bug in the mirror engine, not a tie effect.

## Tie bands

Each variant is run twice: SL-first and TP-first. Both are reported:

- `tieRate`: tie trades / trades in the SL-first run.
- `slFirstNet`, `tpFirstNet`: variant-level net under each policy.
- `band_width`: per regime, |net(TP-first) − net(SL-first)|.

A variant with `tieRate` > 5% is excluded from ranked lists. It stays in the full CSV with `qualified = false`.
On the 1.5/2.0 ATR grid no variant has a tie: all band widths are 0. Ties appear at tighter levels
(15% of trades at 0.5/0.5), where the variant is excluded.

## Regime classification

Computed on closed bars. A trade's regime is the regime at its **signal bar**, stored on every trade record.

- **ADX(14), Wilder:** trending if ADX > 25; ranging if ADX < 20; **ambiguous** if 20 ≤ ADX ≤ 25.
- **Range/ATR ratio, 20 bars:** `(highest high − lowest low over 20 bars) / ATR(20)`. Ranging if < 6.0, not ranging otherwise.
  Chosen before results were seen and not tuned. Reported in the trade records, not yet in the sweep.

`regimeFilter` in a SignalSpec uses the ADX regime. Ambiguous bars are excluded by both `ranging` and `trending`.

## Indicator conventions

Every indicator at index `i` uses only bars `0..i`. This is tested on real data (`src/lookahead.test.ts`):
prefix equality over three non-overlapping windows, 135,000 values.

- **EMA:** seeded with the SMA of the first `p` values, alpha = 2/(p+1).
- **RSI:** Wilder smoothing; the seed is the mean of changes 1..p.
- **MACD:** line = EMA(fast) − EMA(slow); signal = EMA of the valid line values.
- **TR and ATR:** TR[0] = high − low. ATR seed = mean TR[0..p−1], then Wilder.
- **ADX:** DM and TR from bar 1; Wilder-smoothed sums seeded over bars 1..p; first ADX at index 2p−1.
- **Volume ratio:** volume / SMA(volume, 20).
- **Pivots (Traditional, daily):** from the previous trading day that has bars. Day boundary is UTC midnight.

Expected values for the 20-bar fixture come from an independent Python implementation.

## Signal definition

For bar `t`, on closed bars:

- **Long:** RSI ≤ `rsiBuy`, volume ratio > `volMult`, nearest listed pivot within `pivotProximityAtr` × ATR,
  MACD histogram > 0 if `requireMacd`, regime filter passes.
- **Short:** the same with RSI ≥ `rsiSell` and MACD histogram < 0.

### Baseline finding (read this before the sweep)

`minisig_b_nomacd` on XAUUSD 15m: 247 trades, gross +32.23, costs 72.43, net −40.19, |G|/C = 0.45 at ÷100.

This is a **near-zero-edge signal, not a reliably wrong one**. Gross edge is smaller than cost under the current
commission assumption. Under ÷1000 the gross exceeds cost, so this conclusion is unit-dependent (see
"Commission unit"). Inverting a near-zero-edge signal cannot produce a profit, because the mirror inherits the same
cost. The sweep's job is to find variants with large negative G/C in a specific regime, which are the only
ones whose inverse is meaningful. None of the baselines qualifies on that test.

### Why minisig_c and minisig_d fire nothing

Funnel diagnostic (`src/funnel.ts`):

- **minisig_c_vol15:** 37 long and 45 short candidates survive RSI, volume (> 1.5), and pivot proximity. After the MACD sign gate: **0**.
- **minisig_d_ranging:** 12 long and 30 short candidates survive regime, RSI, volume, and pivot. After the MACD sign gate: **0**.
- **minisig_a** (volume > 1.0, MACD gate on) has 1 long and 2 short trades in two years.

**Cause: the MACD sign gate is anti-correlated with the RSI extreme it is paired with.**
- P(MACD hist > 0) overall: 49.8%.
- P(MACD hist > 0 | RSI ≤ 30): **3.7%** (73 of 1,968 bars).
- P(MACD hist < 0 | RSI ≥ 70): **9.9%** (293 of 2,956 bars).

Oversold readings coincide with falling momentum, so requiring positive momentum selects the rare bounce starts. The
gate is over-constrained by construction, not by the window. A broader window will not fix it. A
different MACD condition (a turn: histogram rising, or no MACD gate) would change the signal definition, and that is a decision for you.
No new variants were added for this.

## Report and sweep

`src/report.ts` produces one row per (variant, regime) with: `variant, regime, trades, gross, costs, net,
|G|/C, winrate, tieRate, band_width, qualified`, plus `G_over_C` (signed), `slFirstNet`, `tpFirstNet`,
`train_G_over_C`, `test_G_over_C`, `identityResidual`, `excludeReason`, and the parameters.

- **Regimes:** `ranging`, `trending`, `ambiguous`, and `all`. `all` is for context only.
- **|G|/C** = |Σ gross| / Σ costs per regime.
- **Ranking:** regime-specific |G|/C, descending, on qualified rows only. Ranging is the primary regime.
- **qualified** = tieRate ≤ 5% and regime trades ≥ 30. The 30-trade minimum is **our addition**, not in the brief.
  It stops tiny-sample ratios from ranking.

`src/sweep.ts`: 162 variants (4 baselines and 158 grid points after deduplication). Grid:
rsiBuy ∈ {20, 25, 30}, rsiSell = 100 − rsiBuy, MACD gate on/off, volMult ∈ {1.0, 1.5, 2.0},
pivot proximity ∈ {0.25, 0.5, 1.0} ATR, regime ∈ {any, ranging, trending}. SL/TP fixed at 1.5/2.0 ATR, not swept.
Runtime about 1 second on XAUUSD 15m.

Two caveats on the ranking:
- **Multiple comparisons.** With 162 variants, top-ranked in-sample values are expected by chance. The train and test columns are the check.
- **Sign stability.** Among qualified ranging rows, the top |G|/C row (`minisig_b_nomacd`) has G/C −9.14 with train −17.15 and test +16.25. The sign flips out of sample, so it is not a candidate.

## Limitations

- One series and one timeframe per run. Multi-symbol sweeps are not built yet.
- Daily pivots use UTC days. Broker session boundaries may differ.
- No slippage beyond the spread, no swap or rollover, no partial fills.
- Costs are demo-account, measured once, and the commission unit is unverified.
- SL/TP are fixed in the grid. Tie bands are inactive at 1.5/2.0 ATR.
- Results are research evidence, not a trading recommendation.
