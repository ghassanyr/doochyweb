# shitnals

Signal edge-research sandbox. Backtests conventional RSI + MACD + volume + pivot signals and their
inverted mirrors on cTrader OHLCV, with costs, regime splits, and an out-of-sample holdout.
Research only. No orders, no bot, no live signals. Reads cTrader historical bars and symbol specs.

## Quick start

```
pnpm install
cp .env.example .env            # then fill CTRADER_* (never commit .env)
./node_modules/.bin/tsx src/fetch.ts --symbol=XAUUSD --timeframe=15m --days=730   # cache bars
pnpm test                       # unit tests + no-look-ahead test on cached data
./node_modules/.bin/tsx src/backtest.ts --symbol=XAUUSD --tf=15m --variant=minisig_a
```

Note: `pnpm <script> -- --flag=value` swallows flags in this pnpm version, so call `tsx` directly.

Fetching is incremental: a run with a current cache makes no broker call; otherwise it fetches only
bars after the newest cached bar. Bars that have not closed yet are never cached.

Outputs: `out/runs/{RUN_ID}/` with `trades.csv`, `summary.json`, `log.txt`, `audit.txt`.
`RUN_ID` = UTC timestamp + symbol + timeframe + variant + engine version.

## Fill rules

Applied identically by the engine and the mirror re-simulation (`walkExit` in `src/backtest.ts`).

1. **Decision.** The signal for bar `t` uses only bars `0..t` (closed). Nothing from `t+1` or later.
2. **Fill.** Entry fills at the **open of bar `t+1`**. There is no slippage model beyond the
   round-trip cost below.
3. **Levels.** SL and TP are set from ATR(14) at bar `t`: long SL = fill − `slAtr`·ATR, TP = fill + `tpAtr`·ATR;
   short is mirrored.
4. **Fill bar is checked.** Bar `t+1` is also checked for SL/TP against its high and low.
5. **Gap through a level.** If the bar's OPEN is already beyond SL or TP, the exit fills at that OPEN
   (`SL_GAP` / `TP_GAP`). A gapped TP is therefore filled at the open, which is worse than the target for a long.
6. **Both levels in one bar: SL first.** If the bar's range contains both SL and TP (not a gap), the
   trade is recorded as SL and flagged `tie = true`. This is the conservative choice. It is also the source of the
   mirror divergence reported in the run (see "Known asymmetry").
7. **Time stop.** A position still open at entry + `MAX_HOLD_BARS` (96 bars, 24 h on 15m) closes at the
   OPEN of that bar (`TIME`).
8. **End of data.** Closes at the last bar's close (`EOD`).
9. **One position at a time.** No signals are considered while a position is open. Scanning resumes on the
   exit bar, whose close is known, so a new signal may fire there and fill at the next open.

## Cost model

`netPnl = grossPnl − cost`, charged once per trade. `grossPnl = direction × (exit − fill)`, per one unit of
size, in price units. The per-trade cost is

    cost(P) = spreadPrice + 2 · (commissionUsdPerMillionPerSide / 1,000,000) · P

with `P` = fill price. Costs are defined in `src/config.ts`, `INSTRUMENT_COSTS`.

| Symbol | spreadPrice (median) | Commission USD per M notional per side | Spread samples | Status |
|---|---|---|---|---|
| XAUUSD | 0.10 | 25 | 38 | measured |
| XAGUSD | 0.03 | 25 | 10 | measured (few samples) |
| EURUSD | 0.00001 | 45 | 17 | measured |
| GBPUSD | 0.00004 | 45 | 18 | measured |
| USDJPY | 0.003 | 45 | 27 | measured |
| BTCUSD | 19.28 | 0 | 32 | measured (commission field 0) |
| US100 | n/a | n/a | 0 | **unmeasured, not on the demo account, refuses to run** |

How these were obtained: a read-only probe on the cTrader demo grant for 20 s of spot quotes (median
ask − bid) and `ProtoOASymbolByIdReq` for the commission field.

Two caveats the reader must not skip:
- **The commission scaling is an inference.** The field is `commission` with `USD_PER_MILLION_USD`. Reading
  the value as hundredths of a dollar per million notional gives about 1 pip round-trip on EURUSD. Verify
  against a broker statement before trusting absolute P&L.
- **Spread samples are small** (10–38 quotes). Treat spreads as indicative. Commission is
  proportional to price, so it moves with the market. The table uses the probe-time spread for all history.

## Regime classification

Computed on closed bars only. The regime of a trade is the regime at its **signal bar** (the last closed bar before
entry), and is stored on every trade record.

- **ADX(14), Wilder.** trending if ADX > 25; ranging if ADX < 20; **ambiguous** if 20 ≤ ADX ≤ 25.
  Reported as three separate groups.
- **Range/ATR ratio, 20 bars.** `(highest high − lowest low over the last 20 bars) / ATR(20)`. "ranging" if ratio < 6.0,
  otherwise "not_ranging". The threshold was chosen before any results were seen and has not been tuned.

`regimeFilter` in a SignalSpec uses the ADX regime: `ranging` takes only ADX < 20, `trending` only ADX > 25.
Ambiguous bars are excluded by both filters.

## Indicator conventions

Every indicator at index `i` uses only bars `0..i`. This is tested on real data (`src/lookahead.test.ts`):
indicators on a prefix ending at each window's last bar must equal the full-series values inside that window.

- **EMA:** seeded with the SMA of the first `p` values, alpha = 2/(p+1).
- **RSI:** Wilder smoothing; the seed is the mean of changes 1..p.
- **MACD:** line = EMA(fast) − EMA(slow); signal = EMA(signal period) of the valid line values.
- **TR and ATR:** TR[0] = high − low (no prior close). ATR seed = mean TR[0..p−1], then Wilder.
- **ADX:** DM and TR from bar 1; Wilder-smoothed sums seeded over bars 1..p; DX from index p; ADX seeded as the
  mean of DX[p..2p−1] (first value at index 2p−1); Wilder thereafter.
- **Volume ratio:** volume / SMA(volume, 20), same bar included.
- **Pivots (Traditional, daily):** PP = (H+L+C)/3 of the previous trading day that has bars. R1 = 2PP − L, S1 = 2PP − H,
  R2 = PP + (H−L), S2 = PP − (H−L), R3 = H + 2(PP−L), S3 = L − 2(H−PP). Day boundary is UTC midnight.
  Weekends are skipped, so Monday uses Friday.

## Signal definition

A signal for bar `t`, evaluated on closed bars:

- **Long:** RSI ≤ `rsiBuy`, volume ratio > `volMult`, nearest listed pivot within `pivotProximityAtr` × ATR,
  MACD histogram > 0 if `requireMacd`, and the regime filter passes.
- **Short:** the same with RSI ≥ `rsiSell` and MACD histogram < 0.

The baseline variants in `src/signals.ts` (`minisig_a`, `minisig_b_nomacd`, `minisig_c_vol15`, `minisig_d_ranging`)
are **approximations** of the old MiniSig as described in the brief. The original MiniSig source was not inspected.

## Mirror

For a trade with fill `E`, SL `S`, TP `T`, the mirror is the opposite direction on the same fill bar, with
mirror SL = `T` and mirror TP = `S`. Its path is then re-simulated with the same `walkExit`. For any trade
without a tie or a gap, the mirror exits at the same price and bar as the original, so
`N' = −N − 2C` holds exactly. See `src/mirror.ts`.

## Known asymmetry

When both levels fall inside one bar, the original takes SL (conservative) and the mirror takes its own SL, which
is the original TP. Each strategy is penalized on those bars, so `N + N'` is below `−2C` by a
tie-dependent amount. The mirror check reports this count separately. It is a property of the conservative tie rule,
not a fill or cost bug.

## Limitations

- One series and one timeframe per run. Multi-symbol sweeps come later.
- Pivots are daily Traditional levels from UTC days. Broker session boundaries may differ.
- No slippage beyond the spread, no swap or rollover fees, no partial fills.
- Demo-account symbol specs. Live commission may differ.
- Reported results are research evidence only, not a trading recommendation.
