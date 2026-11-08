# Doochy Learn — Pattern Taxonomy

**Status:** Phase 0 baseline. This document is the contract for the trainer detectors in
`src/server/trainer/detectors.ts` and the scanner in `src/server/trainer/scan.ts`. If a
detector and this document disagree, the detector is wrong until this document is changed.

The live analysis code in `src/server/market/patterns.ts` and
`src/server/market/breakoutEngine.ts` is the reference for closed-bar handling, wicks,
doji rejection, confirmed swings and ATR thresholds. The trainer may reuse those concepts,
but it must not change or reinterpret the live market behaviour.

## Conventions

### Bars and indices

- A bar is `{ time, open, high, low, close, volume }`, sorted ascending by open time.
- All trainer series are **closed bars only**. A bar is closed at `time + timeframeMs`;
  a still-forming bar is never passed to a detector.
- The detector is called with the full stored series and an index `i`. The **candidate bar**
  is `bars[i]`, always a closed bar. Bars at indices `> i` are future data and must never be
  read by a detector.
- Pattern bounds are inclusive bar indices: `startIndex .. endIndex`, with
  `endIndex <= i`.
- The cut bar is the last bar shown to the user. Context is `[0 .. cutIndex]`; reveal is
  `(cutIndex .. cutIndex + H]`. A detector may propose a cut at or after its pattern's
  `endIndex`, never before it.

### Bar anatomy

- **Body:** `close - open`. A positive body is bullish, negative is bearish.
- **Body top / bottom:** `max(open, close)` / `min(open, close)`.
- **Range:** `high - low`.
- **Doji:** `open === close` exactly, matching `patterns.ts`. An engulfing pattern with a
  doji on either bar has no direction and is not valid. Neutral patterns (inside bar,
  outside bar) do not reject dojis.
- **Wick:** the part of the range outside the body. Wicks are ignored by engulfing, as in
  `patterns.ts`. Range patterns (inside/outside/sweep) use high/low, not body.

### ATR and break thresholds

- `ATR20(i)` is the simple mean true range over the 20 bars ending at `i`, exactly as
  `meanTrueRange(bars, 20)` in `breakoutEngine.ts`. It requires at least 21 closed bars.
- `thr(i) = max(close[i] * 0.002, ATR20(i))`, matching `MIN_PCT` and the ATR threshold in
  `breakoutEngine.ts`. A **break** is a close strictly beyond a level by at least `thr(i)`.
- `0.5 × ATR20(i)` is the double-top/bottom price tolerance, matching `PATTERN_TOL_ATR`.
- `0.1 × ATR20(i)` is the near-miss epsilon used below. A near-miss is a review label, not
  a valid detector match.

### Confirmed swings

A confirmed **swing high** at index `s` requires:

```
high[s] > high[s-2] && high[s] > high[s-1] &&
high[s] > high[s+1] && high[s] > high[s+2]
```

A confirmed **swing low** is the mirror with `low`. This is the strict two-bars-each-side
rule from `breakoutEngine.ts`; equal highs/lows do not count. A swing at `s` is only known
at bar `i` when `s <= i - 2`. The trainer uses no other swing definition.

### Tags and families

| Tag | Family | Direction |
|---|---|---|
| `bullish_engulfing` | candle | up |
| `bearish_engulfing` | candle | down |
| `inside_bar` | candle | none |
| `outside_bar` | candle | none |
| `sweep_up` | liquidity | down |
| `sweep_down` | liquidity | up |
| `double_top` | reversal | down |
| `double_bottom` | reversal | up |
| `sr_flip` | structure | up or down |
| `bos` | structure | up or down |
| `choch` | structure | up or down |

`Direction` is the directional implication of the setup, not the side of the candle or
break. For example, `sweep_up` swept a high and failed above it, so its implication is
`down`. Neutral patterns leave direction `null`.

### Near-miss policy

Phase 2 emits **valid** matches only. The near-miss criteria below define the boundary so
the Phase 3 reviewer can accept or reject ambiguous rows consistently; a near-miss may be
carried as a candidate note, but it is never silently promoted to a valid match.

---

## Engulfing

### Bullish engulfing

- **Rule at bar `i`:** let `p = i - 1`.
  - `body[p] < 0` (prior bar red, non-doji)
  - `body[i] > 0` (current bar green, non-doji)
  - `open[i] <= close[p]`
  - `close[i] >= open[p]`
- **Wicks:** ignored. The engulfing test is body-only, exactly as `detectEngulfing`.
- **Lookback:** 2 bars, `p .. i`. Minimum history is `i >= 1`.
- **Valid:** all four conditions above.
- **Near miss:** either containment test misses by at most `0.1 × ATR20(i)` while the
  colour test still holds; or the current body covers the prior body but either bar is a
  doji (direction is undefined, so it is not valid).
- **Emit:** `bounds = { startIndex: p, endIndex: i }`; `levelUpper = null`,
  `levelLower = null`, `neckline = null`; `cutIndex = i`; `direction = "up"`.

### Bearish engulfing

Mirror of bullish:

- `body[p] > 0`, `body[i] < 0`
- `open[i] >= close[p]`, `close[i] <= open[p]`
- Lookback and near-miss mirror the bullish case.
- **Emit:** same bounds and null levels; `cutIndex = i`; `direction = "down"`.

---

## Inside bar

- **Rule at bar `i`:** let `p = i - 1`.
  - `high[i] <= high[p]`
  - `low[i] >= low[p]`
  - at least one inequality is strict, so the current range is strictly smaller.
- **Doji:** allowed; inside bar is a range pattern, not a directional candle.
- **Lookback:** 2 bars, `p .. i`. Minimum history is `i >= 1`.
- **Valid:** both range containment tests pass and at least one is strict.
- **Near miss:** equal ranges (`high[i] === high[p]` and `low[i] === low[p]`); or exactly
  one edge misses containment by at most `0.1 × ATR20(i)` while the other edge is
  contained.
- **Emit:** `bounds = { startIndex: p, endIndex: i }`; `levelUpper = high[p]`,
  `levelLower = low[p]`, `neckline = null`; `cutIndex = i`; `direction = null`.

---

## Outside bar

- **Rule at bar `i`:** let `p = i - 1`.
  - `high[i] > high[p]`
  - `low[i] < low[p]`
- **Doji:** allowed; outside bar is a range-expansion pattern.
- **Lookback:** 2 bars, `p .. i`. Minimum history is `i >= 1`.
- **Valid:** both edges strictly exceed the prior bar's range.
- **Near miss:** exactly one edge strictly exceeds the prior range while the other is equal
  or misses by at most `0.1 × ATR20(i)`.
- **Emit:** `bounds = { startIndex: p, endIndex: i }`; `levelUpper = high[p]`,
  `levelLower = low[p]`, `neckline = null`; `cutIndex = i`; `direction = null`.

---

## Sweep / false breakout

The reference window is the **5 closed bars before the candidate bar**, matching
`SWEEP_LOOKBACK = 5` in `patterns.ts`.

- `refHigh = max(high[i-5] .. high[i-1])`
- `refLow = min(low[i-5] .. low[i-1])`

### Sweep up (failed break above `refHigh`)

- **Rule at bar `i`:**
  - `high[i] > refHigh` (wick trades strictly above the prior extreme)
  - `close[i] < refHigh` (close returns strictly below the level)
- **Lookback:** 6 bars, `i-5 .. i`. Minimum history is `i >= 5`.
- **Valid:** both strict inequalities above. Touching the level is not enough.
- **Near miss:** `high[i] === refHigh` with `close[i] < refHigh` (touch only); or
  `high[i] > refHigh` with `close[i] === refHigh` (failed return). A valid match whose
  penetration is less than `0.1 × ATR20(i)` should be flagged ambiguous in notes.
- **Emit:** `bounds = { startIndex: i - 5, endIndex: i }`; `levelUpper = refHigh`,
  `levelLower = refLow`, `neckline = null`; `cutIndex = i`; `direction = "down"`.

### Sweep down (failed break below `refLow`)

- **Rule at bar `i`:**
  - `low[i] < refLow`
  - `close[i] > refLow`
- **Lookback:** 6 bars, `i-5 .. i`. Minimum history is `i >= 5`.
- **Valid:** both strict inequalities.
- **Near miss:** `low[i] === refLow` with `close[i] > refLow`; or `low[i] < refLow` with
  `close[i] === refLow`.
- **Emit:** same bounds and levels as sweep up; `cutIndex = i`; `direction = "up"`.

A single bar can satisfy both sweep rules. Emit both tags, each with its own direction;
do not collapse them into one match.

---

## Double top

Uses the confirmed-swing, gap and tolerance rules from `breakoutEngine.ts`.

- **Lookback:** confirmed swing highs in the last **120 closed bars**, with the newest
  eligible swing at `i - 2`. Minimum history is 21 bars for ATR20.
- **Pattern:** two confirmed swing highs `a < b` with:
  - gap `b - a` in `5 .. 60` bars inclusive (`PATTERN_GAP_MIN` / `PATTERN_GAP_MAX`)
  - price tolerance `abs(high[a] - high[b]) <= 0.5 × ATR20(i)`
- **Neckline:** `min(low[a] .. low[b])`, the lowest low between the two tops.
- **Validity at the cut:** the cut is `cutIndex = b + 2`, the first bar at which the second
  swing is confirmed. Require no close strictly below the neckline in `b + 1 .. b + 2`;
  otherwise the neckline has already broken and this is a completed pattern break, not a
  pending double top.
- **Valid:** both swings confirmed, gap and tolerance pass, and the neckline is intact at
  the cut.
- **Near miss:** exactly one criterion fails within the relaxed range:
  - gap is `4` or `61 .. 90`, or
  - tolerance is `> 0.5 ×` and `<= 1.0 × ATR20(i)`,
  while both swings remain confirmed and the neckline is intact.
- **Emit:** `bounds = { startIndex: a, endIndex: b }`;
  `levelUpper = max(high[a], high[b])`, `levelLower = neckline`,
  `neckline = neckline`; `cutIndex = b + 2`; `direction = "down"`.

## Double bottom

Mirror of double top:

- Two confirmed swing lows `a < b`, gap `5 .. 60`, tolerance
  `abs(low[a] - low[b]) <= 0.5 × ATR20(i)`.
- **Neckline:** `max(high[a] .. high[b])`, the highest high between the two bottoms.
- **Validity at the cut:** `cutIndex = b + 2`; no close strictly above the neckline in
  `b + 1 .. b + 2`.
- **Near miss:** same relaxed gap/tolerance rule as double top.
- **Emit:** `bounds = { startIndex: a, endIndex: b }`;
  `levelUpper = neckline`, `levelLower = min(low[a], low[b])`,
  `neckline = neckline`; `cutIndex = b + 2`; `direction = "up"`.

---

## S/R flip

A support/resistance flip is a broken swing level that is retested and holds on the new
side. Swings use the confirmed-swing rule and a 120-bar lookback. `thr(i)` and `ATR20(i)`
are defined above.

### Bullish flip (resistance becomes support)

- **Level:** a confirmed swing high `L` at index `s` in the last 120 bars, with `s <= i - 2`.
- **Break:** there is a first bar `k` with `s < k < i` and `close[k] > L + thr(k)`.
- **Hold:** no close in `k .. i` is below `L - thr(i)`; the level must not close back
  through the broken side by the break threshold.
- **Retest:** bar `i` is the first retest after `k`:
  - `low[i] <= L <= high[i]` (the bar trades at the flipped level)
  - `close[i] > L` (closes back above it)
  - `i - k <= 60` bars
- **Valid:** all of the above.
- **Near miss:** a break occurred and price approached but did not touch the level
  (`low[i] > L` and `low[i] <= L + 0.5 × ATR20(i)`); or the level was touched but the bar
  closed back below `L`; or the first retest arrived after 60 bars.
- **Emit:** `bounds = { startIndex: s, endIndex: i }`; `levelUpper = null`,
  `levelLower = L` (support), `neckline = null`; `cutIndex = i`; `direction = "up"`.

### Bearish flip (support becomes resistance)

Mirror:

- **Level:** confirmed swing low `L` at `s` in the last 120 bars.
- **Break:** first `k` with `s < k < i` and `close[k] < L - thr(k)`.
- **Hold:** no close in `k .. i` is above `L + thr(i)`.
- **Retest:** bar `i` is the first retest after `k`:
  - `low[i] <= L <= high[i]`
  - `close[i] < L`
  - `i - k <= 60`
- **Near miss:** approach without touch (`high[i] < L` and
  `high[i] >= L - 0.5 × ATR20(i)`); touch but close back above `L`; or retest after 60 bars.
- **Emit:** `bounds = { startIndex: s, endIndex: i }`; `levelUpper = L` (resistance),
  `levelLower = null`, `neckline = null`; `cutIndex = i`; `direction = "down"`.

---

## BOS and CHoCH

Both use confirmed swings, the 120-bar swing lookback, and the break threshold `thr(i)`.
Trend is read from the last **two** confirmed swing highs (`H1` older, `H2` newer) and the
last **two** confirmed swing lows (`L1` older, `L2` newer) before the candidate bar. All four
swing indices must be `<= i - 2`.

- **Uptrend:** `H2 > H1` and `L2 > L1` (higher highs and higher lows).
- **Downtrend:** `H2 < H1` and `L2 < L1` (lower highs and lower lows).
- Anything else is **range/unclear**; BOS and CHoCH do not fire.

A break is a close beyond a level by at least `thr(i)`, and must be the first such break of
that level since the swing: no close in `(s, i)` may already be beyond the level by `thr`.

### BOS (break of structure, continuation)

- **Bullish BOS:** uptrend, `close[i] > H2 + thr(i)`, first break above `H2`.
  Emit `levelUpper = H2`, `levelLower = null`, `direction = "up"`.
- **Bearish BOS:** downtrend, `close[i] < L2 - thr(i)`, first break below `L2`.
  Emit `levelUpper = null`, `levelLower = L2`, `direction = "down"`.
- **Lookback:** 120 bars for the swing structure; `bounds = { startIndex: s, endIndex: i }`
  where `s` is the broken swing (`h2` or `l2`); `cutIndex = i`.
- **Near miss:** close beyond the level but by less than `thr(i)`; or a qualifying close
  break with mixed structure (only higher highs or only higher lows, not both).

### CHoCH (change of character, reversal)

- **Bearish CHoCH:** uptrend, `close[i] < L2 - thr(i)`, first break below the latest higher
  low `L2`. Emit `levelUpper = null`, `levelLower = L2`, `direction = "down"`.
- **Bullish CHoCH:** downtrend, `close[i] > H2 + thr(i)`, first break above the latest lower
  high `H2`. Emit `levelUpper = H2`, `levelLower = null`, `direction = "up"`.
- **Lookback and emit:** same as BOS, using the broken swing `s` (`l2` or `h2`) as
  `startIndex`, `cutIndex = i`, `neckline = null`.
- **Near miss:** close beyond the opposing level but by less than `thr(i)`; or a qualifying
  break without an established opposing trend (fewer than two confirmed highs or lows, or
  mixed structure).

---

## Detector output summary

In addition to the per-tag fields above, every candidate carries:

- `id`: stable within a scan, derived from symbol, timeframe, tag and pattern indices.
- `symbol`, `timeframe`: the series identity.
- `tag`, `family`: from the table above.
- `direction`: `"up"`, `"down"`, or `null`.
- `bounds`: inclusive `startIndex`/`endIndex` into the stored series.
- `levels`: `levelUpper`, `levelLower`, `neckline`, each a price or `null`.
- `cutIndex`: as specified per tag.
- `notes`: optional ambiguity/context notes, never future data.

Scan-level guards are applied after detection: at least **60 closed bars of context** before
the cut and at least `H = 20` closed bars after it, otherwise the candidate is not
reviewable in this batch. No detector may use the reveal window to decide whether a pattern
is valid.
