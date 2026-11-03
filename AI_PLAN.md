# OpenClaw AI Plan and TODO

Status as of 2026-11-03. The detector fix and scraper runner are deployed to doochy.net from the working tree but NOT committed. Update this file as items close. Keep one item in progress at a time.

## Where things stand

- **Breakouts**: detection runs in the doochyweb server (`src/server/market/breakoutRunner.ts`), hourly at HH:02 UTC, on cTrader and Binance bars. Output: `~/doochyweb/openclaw-breakouts.jsonl`. The old OpenClaw writer is a passthrough and does no detection.
- **Scrape cron**: replacement is built and deployed inside doochyweb (`scraperRunner.ts`), but still gated off (`SCRAPER_ENABLED=false`). OpenClaw still owns the live cron for the parity week. After parity, disable the OpenClaw cron and flip the gate. Scraping is then the only part that no longer depends on the agent.
- **Captures file**: line 1 held two objects glued together. Split, backed up to `~/doochyweb-backups/`. `write_capture.py` now starts a new line if the last write left none.
- **Agent knowledge**: `doochy-scraper` and `doochy-breakout-storage` SKILL.md updated. Active directives added to the workspace `USER.md`. Summary in `memory/2026-11-02-doochy-changes.md`.
- **Watchlist**: SPX removed (2026-11-02). US500 stays. 17 symbols.

## Decisions open

1. **Scrape cron move (decided: move, inside this repo, via the analysis API, not the browser).** Built and deployed. Telegram token is set and validated. Open item: the parity week, then disable the OpenClaw cron.
3. **Model for narration and hypotheses** (see below).

## Model choice (not yet tested)

Candidates: nemotron ultra 3 550B, nemotron 3.5 super vl, deepseek v4.1 flash, nemotron 3.5 lightning 30b, nemotron 3 super 120b, kimi k2.6.

I have not benchmarked any of them. Names alone don't tell me their accuracy or cost, so this is a recommendation to test, not a result.

- **Narration (frequent, short, structured input)**: a small, fast model. Candidate: nemotron 3.5 lightning 30b, or deepseek v4.1 flash.
- **Hypothesis generation (rare, reasoning over sweep tables)**: the strongest model that fits the budget. Candidates: kimi k2.6 or nemotron ultra 550B.
- **Test before choosing**: 20 saved run records. Score each output on groundedness (every number traceable to the input), refusal to claim a fired breakout that is not in the input, and format. Use the same prompts for each model. Pick the cheapest that passes.

## Plan (order from the earlier discussion)

### Phase 0: housekeeping (done)
- [x] Captures file fixed, guard added
- [x] Skill docs and workspace directives updated
- [x] Who runs the cron answered

### Phase 1: analogue search tool (use case 2) - DONE, uncommitted
- [x] Features on closed 4H bars: RSI14, ATR%, ADX14, volume ratio, range ratio. NOT yet: pivot distance (needs daily grouping) and breakout type
- [x] Deterministic k-nearest search over about 2 years of 4H history (src/server/market/analogues.ts), past outcomes only
- [x] Per match: outcome (up_first / down_first / tie / neither), MFE and MAE in ATR units. Base rate, train/test split, Wilson 95% intervals
- [x] Interface: CLI (src/server/market/analogueCli.ts), called by OpenClaw via exec. Chosen over HTTP: no open port, nothing to keep running, stdout is JSON only
- [x] History: src/server/market/history.ts pages cTrader 4H trendbars into data/history/ (incremental, closed bars only). The analysis provider serves only about 480 bars, so it cannot be used for this
- [x] Tests: 12 analogue tests, including outcome paths and no-lookahead
- [x] Hand check: XAUUSD top match, outcome and MFE/MAE recomputed from raw bars, matched
- [x] Skill doc: ~/literate-octo/skills/doochy-analogues/SKILL.md
- [ ] Gaps: four crypto symbols are Binance-only (no cTrader history) and fail clearly. FTSERAFIUS1000 series ends 2017 and is refused as stale

## Scrape cron port (2026-11-02): status

Done (uncommitted):
- src/server/market/scraperRules.ts: alignment, weekend, session, capture type, change diff, needle dedup, capture builder, freshness. Pure.
- test/scraperRules.test.ts: 20 tests, including closed-bar engulf and sweep equal to patterns.ts over 2000 random windows.
- src/server/market/scraperDryRun.ts: runs the rules on live bars, writes nothing, and compares with the doochy.net API.

Dry run result (2026-11-02 13:04 UTC): 16 of 17 evaluated (FTSERAFIUS1000 refused as stale).
- Ratings: 16 of 16 equal to the API.
- Engulf and sweep: 48 comparisons, 42 equal, 6 explained, 0 unexplained.
- The 6 explained are a one-bar lag in the existing detectors (see below), not a rules difference.

Port decisions (differences from SKILL.md, on purpose):
1. Engulf timeframe comes from the bar set, not from a "1H" tag in pattern text. The recorded CSVs never carried that tag: all 8 logged alignment_1h_4h=true rows have none, so the written rule could never fire on them. The CSV is not usable as an oracle.
2. alignment_1h_4h needs both engulfs in the same direction (the spec says not to list contradictory combos).
3. "4H low" is rebuilt from bars: the newest closed 4H bar's low is below the prior 5 lows. Sweep = closes back above; true break = closes at or below. The browser flag is not available to check against.
4. Freshness: a series whose newest bar closed more than one bar ago is not evaluated.

Finding, existing code (FIXED, uncommitted 2026-11-03): patterns.ts detectEngulfing and detectSweep assumed the last bar is still forming. cTrader series contain no forming bar, so the Analysis page and the doochy.net API read one bar too far back for cTrader symbols. Binance series include the forming bar, so crypto was unaffected. Fix: both detectors take lastBarForming (default true, old behaviour); callers pass isLastBarForming(bars, tfMs), which compares the newest bar's close time to the clock. Local consistency after the fix: 17/17 symbols agree between analyze()/route and the port for engulf and sweep, across cTrader and Binance. Deployed 2026-11-03 (built from the working tree, not committed). Post-deploy dry run against doochy.net: 48/48 comparisons equal, 0 lag, 0 unexplained.

Cutover checklist (2026-11-03):
- [x] Change detection state persisted: data/scraper-state.json.
- [x] Needle dedup store persisted (symbol:session:date:kind, reset daily).
- [x] Telegram token in doochyweb env; @DoochyBot validated, test message delivered.
- [x] In-process trigger at HH:02 UTC, gated by SCRAPER_ENABLED (default false).
- [x] Detector one-bar-lag bug fixed; deployed. Post-deploy dry run: 48/48 comparisons equal, 0 lag, 0 unexplained.
- [ ] Parity week: SCRAPER_ENABLED=true alongside the OpenClaw cron, timestamp-matched.
- [ ] Compare change/needle output for the week, then disable the OpenClaw cron.
- [ ] Commit the branch (deploy was built from the working tree).
- Dry run compares our rules with our own code's output on the API. It proves deployment consistency, not signal accuracy. Twelve Data now gives an independent check for FX and gold.
- The 16 vs 17 market count: the stale row is parsed but not evaluated.

## Scrape cron move: assessment (2026-11-02)
- doochy.net is this same app. Its public /api/market/analysis returns the fields the scraper reads from the browser: summary rating, oscillator and MA rows, sweep4h flags.
- Spot check against the 12:04 CSV: sweep flags match (4H LOW). Ratings mostly match; XRPUSD differs (scraped Strong Sell, API sell). Prices differ by about 0.5%, probably timing. Not parity yet.
- Implication: no headless browser and no LLM parsing needed. A deterministic job in doochyweb can read the API, apply the alignment and change rules, write the capture, and send Telegram.
- Before cutover: (1) port the alignment and change rules from SKILL.md to code, tested against recorded CSV rows; (2) timestamp-matched parity for at least a week; (3) Telegram bot token in doochyweb env (today OpenClaw's message tool sends to chat 555334666); (4) choose the trigger inside the server.
- Recommendation: no cutover before parity. Run both for a week and compare.

### Phase 2: narrator (use case 1)
- [ ] Input: the breakout run JSON plus analogue output. The model may cite only fields it was given
- [ ] Model bake-off on 20 saved runs (above)
- [ ] Label every Telegram output as research, with sample size and out-of-sample result
- [ ] Audit log: input snapshot, run ID, output

### Phase 3: hypothesis generator (use case 3)
- [ ] Input: sweep summary, train columns only
- [ ] Cap variants per round (for example 12) to limit multiple comparisons
- [ ] The sweep scores proposals. The model never judges its own proposals

### Phase 4: entry and exit selection (use case 4)
- [ ] Model chooses among computed candidates only (pivots, swings, ATR multiples)
- [ ] Every choice is scored by the backtester out of sample. Keep only choices that beat the baseline

### Phase 5: chart second opinion (use case 5)
- [ ] Filter only: may reject engine candidates, not create them, until measured

## Rules (apply to every phase)

- The AI never places orders or changes accounts.
- Deterministic code computes numbers. The model explains them.
- Any claimed edge is shown with sample size and out-of-sample result.
- Measure the AI's calls against outcomes. If its "likely" calls don't beat the base rate, it is noise.

## Known issues

- Captures line 1 was corrupt (fixed). The 12:00 full capture has no `breakouts` field because the skill called the old writer path. The skill now says not to.
- `process_doochy.py` in `literate-octo` is a stale one-off with hard-coded data. The cron does not run it.
- The breakout panel has not been checked in a browser.
- The breakout engine has been run only on the server's own bars, not compared with doochy.net's own alerts.

## Detector fix, binance data question, persistence, trigger, telegram (2026-11-03)

### Data source: can Binance replace cTrader for metals/forex?
No. Checked live exchangeInfo:
- Spot: no metals, no forex. XAU/XAG only as crypto tokens (PAXG, XAUT), not the metal.
- USD-M futures: 235 TradFi contracts, including XAUUSDT and XAGUSDT (COMMODITY, TRADIFI_PERPETUAL), plus single stocks and QQQ/SPY. No FX pairs and no US100/DAX/FTSE index.
- EURUSDT etc. are stablecoin pairs, not EUR/USD.
So Binance can supply gold and silver, but not forex or the index watchlist. It cannot replace cTrader.

Free alternatives that do carry FX + metals + indices (checked Oct 2026):
- Twelve Data: 800 credits/day, 8/min, FX + indices + commodities; best multi-asset free tier. Credit weights vary by endpoint.
- Finnhub: ~60 calls/min, FX + crypto, no indices on the free plan; personal/non-commercial only.
- Alpha Vantage: 25 requests/day, FX + some commodities/indices; too small for a 17-symbol hourly loop.
- OANDA: free demo account with a streaming/rest API covering FX, metals and indices CFDs; closest cTrader analogue.
- Yahoo Finance (unofficial, e.g. yahoo-finance2) and Stooq CSV: free, delayed, no key; good for cross-checks, not a production dependency.
Measured, 2026-11-03, cTrader vs Binance USD-M perpetual:
- 1H bars share the hour grid; exact-timestamp overlap 479 bars (2026-10-05 14:00 .. 2026-11-03 11:00).
  XAU: mean close gap +7.02 USD (17.2 bps), max 11.93 (30.6 bps); 1H return correlation 0.99854.
  XAG: mean close gap +0.120 USD (21.5 bps), max 0.210 (41.0 bps); 1H return correlation 0.99781.
  The gap is a persistent futures basis (USDT vs USD, funding), not noise.
- 4H bars do not line up at all: cTrader grid is broker-server time (hours 1,5,9,... and 2,6,10,... after DST), Binance is UTC 0,4,8,12,16,20. Exact-timestamp overlap: 0. They cannot be compared or swapped without resampling, which changes OHLC.
- Binance perps trade 24/7: 288 weekend 1H bars vs 7 on cTrader in the same window. Spot gold is closed at weekends, so weekend structure highs/lows differ.
Conclusion: XAUUSDT/XAGUSDT track spot gold/silver closely (corr ~0.998) but are not the same instrument. Different bar boundaries, weekend trading, and a 17-41 bps basis. Fine as a direction cross-check, not as a drop-in replacement. Forex and indices still have no Binance source.

Recommendation: stay on cTrader now that the detector bug is fixed. Add Twelve Data only if we want an independent second source to cross-check cTrader prices/patterns. Do not add a source just to work around the bug.

### Persistence (done, deployed, uncommitted)
src/server/market/scraperRunner.ts writes data/scraper-state.json (gitignored via data/):
- obs: last observation per symbol, for change and needle detection.
- firedDate + fired: needle dedup keys, reset when the UTC date rolls over.
- lastRunUtc.
Skipped/stale symbols keep their previous observation, so a data gap does not look like a new alignment when the series recovers.
Dedup key is symbol:session:date:kind. The date is added on purpose: the skill's symbol:session:kind would fire "hourly" at most once ever.

### Trigger (done, deployed, uncommitted)
- startScraperScheduler() wired in src/server/index.ts.
- SCRAPER_ENABLED gate, default false, so it runs alongside the OpenClaw cron during the parity week.
- Runs at HH:02 UTC, capture stamped at the last closed hour boundary.
- Append to the same JSONL the UI reads, with the newline guard.
- CLI: tsx src/server/market/scraperRunner.ts --once [--no-notify].
During parity, point OPENCLAW_CAPTURES_FILE at a separate file so the UI does not show duplicate captures, or disable the OpenClaw cron.

### Telegram (done, deployed)
- src/server/market/notify.ts, env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
- One Telegram message per run at most: the capture summary plus any needles bundled into it. Full session anchors always report; quiet hourly captures stay silent. SCRAPER_TELEGRAM=false silences it.
- .env has TELEGRAM_BOT_TOKEN set and TELEGRAM_CHAT_ID=555334666; .env is mode 600. Token validated as @DoochyBot; a test message was delivered.

### Shared collector
- src/server/market/scraperCollect.ts is used by both the runner and the dry run, so the diagnostic cannot drift from production.
- Dry run parity after the 2026-11-03 deploy: all comparisons equal.

### Verification
- pnpm typecheck clean; pnpm test 175 pass; web build clean.
- Runner test writes temp state and captures only; live end-to-end run used temp paths and --no-notify (16 evaluated, stale symbol skipped).

### Still to do
- [x] Deploy and re-run the dry run: post-deploy result is 48/48 equal.
- [ ] Run SCRAPER_ENABLED=true for a week alongside OpenClaw, timestamp-matched (compressed by the replay harness below).
- [ ] Compare needle/change output for the week, then disable the OpenClaw cron.
- [x] Deterministic replay harness over stored bars (169 hourly boundaries, 17 symbols).
- [ ] Commit the branch; the deploy was built from the working tree.
- pm2 restart only with approval.

## Replay harness (2026-11-03)

src/server/market/scraperReplay.ts. Steps the exact ported rules across every hourly boundary of a window, using bars fetched once per symbol, so session anchors, capture types, change detection, needle dedup (daily reset) and the weekend filter all run without waiting a real week.

- Pure core: replay(symbols, boundaries, {rating?}) -> captures, changes, needles, perSession, weekend stats, alignment counts. Rating defaults to analyze() on the closed 4H series; tests inject a stub.
- CLI: pnpm replay -- --days=7 [--end=ISO] [--symbols=A,B] [--write=FILE] [--compare=FILE]. Fetches 1H+4H per symbol with 1.5s spacing and one 60s retry on cTrader rate limiting (forcing 34 requests without pacing loses ~7 symbols).
- Replay uses only closed bars (live ratings include the forming 4H bar). Documented divergence; it does not affect rule verification.
- Compare mode matches by UTC hour and reports summary/change/needle diffs. Caveat: the four legacy OpenClaw rows use three different summary schemas (true_1h_4h_alignments / true_1h4h / engulf_1h_4h_count) and one line is still two JSON objects, so replay-vs-legacy counts are NOT comparable. Post-deploy dry run (48/48) remains the parity evidence.

7-day result, 2026-10-27 13:00 to 2026-11-03 13:00 UTC, all 17 symbols:
- 169 captures: 50 full, 119 lightweight, 0 empty. Avg 13.0 markets evaluated per capture.
- Sessions: 4h_close 14, ny 8, london 7, tokyo 7, pre_ny 7, ny_afternoon 7, hourly 119.
- 1088 changes: 165 signal, 923 patterns. 30 needles: 28 engulf_1h_4h, 2 triple (both XAUUSD Strong Sell, 2026-10-29/30).
- Weekend: 48 boundaries, 3 evaluated a non-crypto symbol, 0 non-crypto alignments. Filter exercised and held.
- Needle rate is ~4.3/day; dedup resets daily and keys include session, so a flip-and-refire can alert twice in a day. Notifications are one message per run (needles bundled), so the user sees at most one alert per hour and quiet hours are silent. Decision: keep every needle for the parity week; do not filter by rating yet.

## Twelve Data second source (2026-11-03)

Key stored in /home/san/doochyweb/.env as TWELVE_DATA_API_KEY (mode 600). .env.example has a placeholder. Token validated; Telegram test message delivered to chat 555334666.

Integration:
- src/server/market/providers/twelveData.ts: client, symbol/interval map, pacing (free plan 8 credits/min), datetime parsing, resampleToGrid.
- src/server/market/crossCheck.ts: read-only CLI comparing the production source (Binance for crypto, cTrader for FX/metals/indices) with Twelve Data. Writes nothing.
- Run: pnpm crosscheck -- --timeframe=1h [--symbols=XAUUSD,BTCUSD] [--output=300]
- Deliberately NOT in the production provider order, so the Analysis page is unchanged. Promoting it later means adding "twelvedata" to ProviderId, REGISTRY, persist and rateLimit.

Free-plan coverage (verified live):
- Works: FX pairs, XAU/USD, crypto.
- Paid only: XAG/USD, US100/SPX/FTSE/DAX indices. Those 5 watchlist symbols are skipped, not guessed.

Cross-check results, 2026-11-03:
- 12 supported symbols, 1H and 4H. Engulf and sweep on the last closed bar agree 12/12 on both timeframes.
- FX + gold (independent feed): 1H return corr 0.919-0.981, 4H 0.980-0.996. Mean close gap 0.8-2.25 bps, max ~25 bps.
- Crypto: 0.00 bps and corr 1.0000. Twelve Data sources crypto from Binance, so it is NOT independent there; the cross-check is meaningless for crypto.
- 4H comparison resamples Twelve Data 1H onto the cTrader 4H grid, because the two do not share bar boundaries.

Interpretation: for FX and gold, an independent vendor reproduces the broker's bars closely and the 4H engulf/sweep signals agree on the sample checked. That is the confirmation we wanted. For crypto, keep using Binance directly.
