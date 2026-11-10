# Doochy Learn — Pattern Taxonomy

**Status:** revised 2026-11-09 for the seven-tag pilot. This document is the contract for
the trainer detectors in `src/server/trainer/detectors.ts` and the scanner in
`src/server/trainer/scan.ts`. If a detector and this document disagree, the detector is wrong
until this document is changed.

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
  doji on either bar has no direction and is not valid.
- **Wick:** the part of the range outside the body. Wicks are ignored by engulfing, as in
  `patterns.ts`. Sweeps use high/low, not body.

### ATR and break thresholds

- `ATR20(i)` is the simple mean true range over the 20 bars ending at `i`, exactly as
  `meanTrueRange(bars, 20)` in `breakoutEngine.ts`. It requires at least 21 closed bars.
- `thr(i) = max(close[i] * 0.002, ATR20(i))`, matching `MIN_PCT` and the ATR threshold in
  `breakoutEngine.ts`. A **break** is a close strictly beyond a level by at least `thr(i)`.
- `0.1 × ATR20(i)` is the sweep penetration epsilon and the near-miss epsilon used below.
  A near-miss is a review label, not a valid detector match.

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
| `sweep_up` | liquidity | down |
| `sweep_down` | liquidity | up |
| `sr_flip` | structure | up or down |
| `bos` | structure | up or down |
| `choch` | structure | up or down |

`Direction` is the directional implication of the setup, not the side of the candle or
break. For example, `sweep_up` swept a high and failed above it, so its implication is
`down`. Every remaining tag has a direction; the pilot has no neutral tag and no `reversal`
family.

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

## Sweep / false breakout

A sweep is a failed break of the most recent confirmed swing, not a fixed five-bar
range. The trainer uses its own swing lookback for this detector.

- `SWEEP_SWING_LOOKBACK = 60`
- `SWEEP_MIN_GAP = 3`
- `SWEEP_PENETRATION_ATR = 0.1`

The candidate is bar `i`; `ATR20(i)` must exist. Find the most recent confirmed swing at
`s` in the last 60 bars with `i - s >= 3`. Evaluate only that swing, not older ones that
were already broken. A close beyond the level by `0.1 × ATR20(i)` anywhere in `s+1 .. i-1`
means the level was already broken and the sweep is rejected; use the same `isFirstBreak`
check as the live break code.

### Sweep up (failed break above a swing high)

- **Level:** `high[s]` for the most recent eligible confirmed swing high.
- **No prior break:** no close in `s+1 .. i-1` is above `level + 0.1 × ATR20(i)`.
- **Wick:** `high[i] > level + 0.1 × ATR20(i)`.
- **Return:** `close[i] < level`.
- **Rejection close:** `close[i] < (high[i] + low[i]) / 2` (lower half of the sweep bar).
- **Emit:** `bounds = { startIndex: s, endIndex: i }`; `levelUpper = level`;
  `levelLower = min(low[s..i])`; `neckline = null`; `cutIndex = i`; `direction = "down"`.
  The note records the swept swing index.

### Sweep down (failed break below a swing low)

Mirror against the most recent eligible confirmed swing low:

- **Level:** `low[s]`.
- **No prior break:** no close in `s+1 .. i-1` is below `level - 0.1 × ATR20(i)`.
- **Wick:** `low[i] < level - 0.1 × ATR20(i)`.
- **Return:** `close[i] > level`.
- **Rejection close:** `close[i] > (high[i] + low[i]) / 2` (upper half of the sweep bar).
- **Emit:** `bounds = { startIndex: s, endIndex: i }`; `levelLower = level`;
  `levelUpper = max(high[s..i])`; `neckline = null`; `cutIndex = i`; `direction = "up"`.
  The note records the swept swing index.

Touch-only, close-through, prior-break and weak-rejection cases are not valid sweeps. The
two mirrors cannot match the same bar: `sweep_up` needs a lower-half close while
`sweep_down` needs an upper-half close.

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

## Preview annotations

The local HTML preview is a review aid; it must not invent a new pattern definition. It
draws a 120-bar context chart ending at `cutIndex` and a magnified pattern panel. The
context chart has no filled pattern rectangle.

Per-tag annotations are derived from the row and the stored bars:

- **Engulfing:** highlight both candles in the pattern bounds.
- **Sweep:** horizontal liquidity level from the swept swing to the sweep, markers at the
  swing extreme and the sweep wick, and an arrow back toward the rejection close.
- **S/R flip:** horizontal flipped level, marker at the original swing, the first break bar
  between `startIndex` and `endIndex`, and the retest bar at `endIndex`.
- **BOS / CHoCH:** read structure with the existing confirmed-swing `readTrend` logic at
  `row.endIndex`, not at `cutIndex`, so the preview reproduces the detector context. Draw
  diagonal trend lines `H1->H2` and `L1->L2`. Highlight the line relevant to the setup,
  mark the broken swing and the break bar, and show the broken swing level only as a short
  dashed horizontal reference. BOS shows the continuation break through `H2`/`L2`; CHoCH
  down highlights the failed rising support `L1->L2`; CHoCH up highlights the failed
  falling resistance `H1->H2`.
- If structure cannot be read for a BOS/CHoCH row, fall back to the row's horizontal level
  instead of throwing.

Both preview panels end at or before `cutIndex`, are clipped to stored bars, and are drawn
from inline SVG only. Missing bars render a placeholder card.

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
