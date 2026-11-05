# OpenClaw AI Plan and TODO

Status as of 2026-11-05. Detector fix and scraper runner are committed (`06897f1`); this plan lives in `docs/AI_PLAN.md` (`fb0dd93`). Cutover is done and the operational soak continues. Phase 2 narrator is live: `nvidia/nemotron-3.5-lightning-30b-a3b` writes one research note per breakout event, the public Breakouts feed has a per-event note and `?note=` deep link, and 47 events now have published v3 notes. Output v3 is live (server restarted 2026-11-05; live API verified): deterministic brief, compact model facts, prompt v3 (structured JSON, separate no-history prompt), lint v2, 150-word cap and stats panel. On 2026-11-05 the user asked to remove the `RESEARCH ONLY...` disclaimer; prompt v4/template v3 and a stored-note cleanup are implemented but not yet deployed. User feedback: v3 notes are much more readable but still not very helpful, so further output improvement is deferred. Remaining: deploy the disclaimer removal and commit. Update this file as items close. Keep one item in progress at a time.

## Where things stand

- **Current**: cutover done 2026-11-03. Soak runs to 2026-11-05; check live captures against replay at each 4H close.
- **Breakouts**: detection runs in the doochyweb server (`src/server/market/breakoutRunner.ts`), hourly at HH:02 UTC, on cTrader and Binance bars. Output: `~/doochyweb/openclaw-breakouts.jsonl`. The old OpenClaw writer is a passthrough and does no detection.
- **Scrape cron**: live inside doochyweb (`scraperRunner.ts`), `SCRAPER_ENABLED=true`, writing the UI captures file. All OpenClaw Doochy capture crons are disabled. Remaining: a 24-48h ops soak (live vs replay at 4H closes). Scraping is now the only part that no longer depends on the agent.
- **Captures file**: repaired again at cutover (9 rows, all parse); backup at `/tmp/opencode/openclaw-captures.bak`. `write_capture.py` now starts a new line if the last write left none.
- **Agent knowledge**: `doochy-scraper` and `doochy-breakout-storage` SKILL.md updated. Active directives added to the workspace `USER.md`. Summary in `memory/2026-11-02-doochy-changes.md`.
- **Watchlist**: SPX removed (2026-11-02). US500 stays. 17 symbols.
- **Narrator**: model, grounding, per-event generation, public API and Breakouts UI are live on doochy.net. 47 events have published v3 notes (all lint-clean; 71 words average, 107 max after disclaimer cleanup, 0 retries on the final regeneration); none are withheld. Output v3 stores a deterministic brief and the Breakouts panel renders its stats separately. Live runs generate notes when `NARRATION_ENABLED=true`. Delivery is website-only. The public disclaimer was removed on 2026-11-05 (prompt v4/template v3 + stored-note cleanup); deployment is pending. User feedback: readable, but still not very helpful; revisit later.

## Decisions open

1. **Scrape cron move (closed 2026-11-03).** Live inside this repo via the analysis API, not the browser. OpenClaw crons disabled. A/B against OpenClaw dropped; only the ops soak remains.
3. **Model for narration and hypotheses.** Narration closed 2026-11-04: lightning 30b. Delivery closed 2026-11-04: public website UI, one note per breakout event. Hypothesis model still open (see below).

## Model choice (narration tested 2026-11-04)

- **Narration (frequent, short, structured input)**: `nvidia/nemotron-3.5-lightning-30b-a3b` with thinking disabled. On 17 event runs: 0 failures, 1 lint flag, avg 106 words, avg 3.4s. The one flagged run was clean on three reruns, so the guard before publishing to the site should be one retry when the lint flags or the note exceeds 180 words.
- **Rejected for narration**: `nvidia/nemotron-3-ultra-550b-a55b` is usable only with `reasoning_effort: "low"` and a much larger token budget; at 900 tokens it returned empty on 11/17 runs, fabricated two numbers in the rest, and averaged 20s. It is a candidate for hypothesis work, not frequent narration.
- **Unavailable on this key**: deepseek v4.1 flash hangs; kimi k2.6, nemotron 3 super 120b and several other ids return 404 `Not found for account`.
- **Hypothesis generation (rare, reasoning over sweep tables)**: still open. Candidates are ultra 550B (with a larger budget) and lightning; test on sweep tables, not narration runs.
- **Test rule**: score every number against the input, reject claimed breakouts absent from the input, and check the format. Model names do not decide; the measured results do.

## Plan (order from the earlier discussion)

### Phase 0: housekeeping (done)
- [x] Captures file fixed, guard added
- [x] Skill docs and workspace directives updated
- [x] Who runs the cron answered

### Phase 1: analogue search tool (use case 2) - DONE, committed
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

Done (committed in `06897f1`):
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

Finding, existing code (FIXED, committed 2026-11-03 in `06897f1`): patterns.ts detectEngulfing and detectSweep assumed the last bar is still forming. cTrader series contain no forming bar, so the Analysis page and the doochy.net API read one bar too far back for cTrader symbols. Binance series include the forming bar, so crypto was unaffected. Fix: both detectors take lastBarForming (default true, old behaviour); callers pass isLastBarForming(bars, tfMs), which compares the newest bar's close time to the clock. Local consistency after the fix: 17/17 symbols agree between analyze()/route and the port for engulf and sweep, across cTrader and Binance. Deployed 2026-11-03; committed in `06897f1`. Post-deploy dry run against doochy.net: 48/48 comparisons equal, 0 lag, 0 unexplained.

Cutover checklist (2026-11-03):
- [x] Change detection state persisted: data/scraper-state.json.
- [x] Needle dedup store persisted (symbol:session:date:kind, reset daily).
- [x] In-process trigger at HH:02 UTC, gated by SCRAPER_ENABLED (default false).
- [x] Detector one-bar-lag bug fixed; deployed. Post-deploy dry run: 48/48 comparisons equal, 0 lag, 0 unexplained.
- [x] In-process scheduler enabled (SCRAPER_ENABLED=true); captures now written to the UI file.
- [x] All seven OpenClaw Doochy capture crons disabled (hourly, 4H closes, session opens).
- [ ] Operational soak: 24-48h, with live-vs-replay spot-checks at 4H closes.
- [x] Commit the branch (`06897f1`); plan moved to `docs/AI_PLAN.md` (`fb0dd93`).
- Dry run compares our rules with our own code's output on the API. It proves deployment consistency, not signal accuracy. Twelve Data now gives an independent check for FX and gold.
- The 16 vs 17 market count: the stale row is parsed but not evaluated.

## Scrape cron move: assessment (2026-11-02)
- doochy.net is this same app. Its public /api/market/analysis returns the fields the scraper reads from the browser: summary rating, oscillator and MA rows, sweep4h flags.
- Spot check against the 12:04 CSV: sweep flags match (4H LOW). Ratings mostly match; XRPUSD differs (scraped Strong Sell, API sell). Prices differ by about 0.5%, probably timing. Not parity yet.
- Implication: no headless browser and no LLM parsing needed. A deterministic job in doochyweb can read the API, apply the alignment and change rules, and write the capture the website reads.
- Before cutover: (1) port the alignment and change rules from SKILL.md to code, tested against recorded CSV rows; (2) timestamp-matched parity for at least a week; (3) write captures to the UI file; (4) choose the trigger inside the server.
- Recommendation: no cutover before parity. Run both for a week and compare.

### Phase 2: narrator (use case 1) - DONE AND DEPLOYED (2026-11-04)
- [x] Input contract: NarrationInput built from the breakout run plus analogue results; citable fields only
- [x] Audit log: data/narrations/<run>__<model>__v<n>.json, input snapshot stored with output
- [x] Research label, sample size and out-of-sample line in the template baseline
- [x] Template narrator, NIM client (OpenAI-compatible), and CLI (pnpm narrate)
- [x] Model failures are audited with the input snapshot and exit non-zero
- [x] Bake-off on 17 saved event runs (20 was the target; 1H history capped the yield)
- [x] One-retry guard: if the lint flags or the note exceeds 180 words, regenerate once; publish only if the retry passes
- [x] Per-event notes: filter the run input to one breakout; stable event key; one saved note per event
- [x] Backfill: 35 events across 18 historical runs generated; all 35 published after retry (6 needed the second call)
- [x] Live hook: after a live run with new events, generate in the background when `NARRATION_ENABLED=true`
- [x] Public read API: GET /api/market/narrations?event=<key>; reads saved records only, never calls the model
- [x] Breakouts feed: expandable Research note under each live/history row, plus a shareable `?note=<key>` deep link
- [x] Telegram removed (2026-11-04); captures and narration are website-only

### Phase 2b: narrator output v3 - LIVE (2026-11-05)
- [x] Deterministic `NarrationBrief` per event: plain-English event facts, decisive-case shares, base-rate comparison, recent-pool comparison, MFE/MAE, sample split, quality labels and data limits
- [x] The model receives only compact facts plus caveats; run ids, skipped symbols, raw analogue JSON and field names are not sent
- [x] Prompt v3: structured JSON (`what_happened`, `history`, `quality`) joined into three paragraphs, 90-120 words, max ~5 statistics, mandatory field-name translation, no CIs/raw ISO/snake_case
- [x] Separate no-history prompt: no invented sample, base rate, recent pool or 4H limits when no analogue exists
- [x] Lint v2 rejects raw field names, raw ISO timestamps, CI notation and number-heavy prose; keeps number grounding, count and inference checks; 150-word cap
- [x] Template v2 renders the same facts, so the fallback is useful without the model
- [x] API returns `brief`; Breakouts note panel has an expandable deterministic "Historical data" section (sample, counts, base/recent rates, MFE/MAE, split, limits)
- [x] 201 tests, typecheck and production build pass
- [x] Regenerate all 47 events with prompt v3; final run 47/47 published, 0 retries, average 91 words, max 127; after disclaimer cleanup, average 71, max 107
- [x] Restart the server with the v3 code and verify the live API/UI (2026-11-05)
- [x] 2026-11-05 feedback: v3 is much more readable, but still not very helpful. Further output improvement is deferred until requested.
- [ ] Remove the `RESEARCH ONLY...` disclaimer from public notes: prompt v4/template v3, no disclaimer in the model payload, and all 47 stored v3 notes cleaned. Code/data done; deploy with next restart.
- [ ] Keep generic-4H-bar labelling until a breakout-aware analogue phase

**Next up:** deploy the disclaimer removal, then commit. After that, Phase 3 (hypothesis generator) is the next major phase.

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

- Captures line 1 was corrupt; repaired again at cutover and all 9 rows now parse. The 12:00 full capture has no `breakouts` field because the skill called the old writer path. The skill now says not to.
- `process_doochy.py` in `literate-octo` is a stale one-off with hard-coded data. The cron does not run it.
- The breakout panel has not been checked in a browser.
- The breakout engine has been run only on the server's own bars, not compared with doochy.net's own alerts.

## Detector fix, binance data question, persistence and trigger (2026-11-03)

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

### Persistence (done, deployed, committed)
src/server/market/scraperRunner.ts writes data/scraper-state.json (gitignored via data/):
- obs: last observation per symbol, for change and needle detection.
- firedDate + fired: needle dedup keys, reset when the UTC date rolls over.
- lastRunUtc.
Skipped/stale symbols keep their previous observation, so a data gap does not look like a new alignment when the series recovers.
Dedup key is symbol:session:date:kind. The date is added on purpose: the skill's symbol:session:kind would fire "hourly" at most once ever.

### Trigger (done, deployed, committed)
- startScraperScheduler() wired in src/server/index.ts.
- SCRAPER_ENABLED gate; true at cutover. OpenClaw capture crons are disabled, so there is no second writer.
- Runs at HH:02 UTC, capture stamped at the last closed hour boundary.
- Appends to the UI JSONL (default `~/doochyweb/openclaw-captures.json`) with the newline guard.
- CLI: tsx src/server/market/scraperRunner.ts --once.
- The temporary OPENCLAW_CAPTURES_FILE override was removed; its one capture was merged back and the temp file deleted.

### Telegram (removed 2026-11-04)
- Removed `src/server/market/notify.ts`, the capture-message builder, `SCRAPER_TELEGRAM`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Captures and needles are now consumed in the website only; no chat delivery remains.
- Historical note: @DoochyBot was validated and used until this removal.

### Shared collector
- src/server/market/scraperCollect.ts is used by both the runner and the dry run, so the diagnostic cannot drift from production.
- Dry run parity after the 2026-11-03 deploy: all comparisons equal.

### Verification
- pnpm typecheck clean; pnpm test 175 pass; web build clean.
- Runner test writes temp state and captures only; live end-to-end run used temp paths and --no-notify (16 evaluated, stale symbol skipped).

### Still to do
- [x] Deploy and re-run the dry run: post-deploy result is 48/48 equal.
- [x] SCRAPER_ENABLED=true; OpenClaw capture crons disabled. The dual-run A/B was dropped: the OpenClaw captures are not a stable reference (mixed schemas, torn JSONL).
- [ ] Operational soak 24-48h; compare live captures with replay at 4H closes.
- [x] Deterministic replay harness over stored bars (169 hourly boundaries, 17 symbols).
- [x] Commit the branch (`06897f1`).
- pm2 restart only with approval (done at cutover).

## Cutover (2026-11-03)

- .env: SCRAPER_ENABLED=true. OPENCLAW_CAPTURES_FILE override removed, so captures go to the default ~/doochyweb/openclaw-captures.json that the UI reads. The one capture written to the temporary parity file was merged back; the file was removed.
- Repaired openclaw-captures.json: it contained two objects on one line. All 9 rows now parse.
- Disabled all seven OpenClaw Doochy capture crons (hourly 1H, 4H closes 04/12/20, Tokyo/London/NY opens). Heartbeat and memory crons were left alone.
- Rebuilt and restarted pm2. First in-process run 2026-11-03 16:02 UTC: 16 evaluated, 1 stale skipped, capture + summary notification.
- The week-long A/B against OpenClaw is dropped. What remains is an ops soak and a live-vs-replay spot-check at each 4H close. No waiting on the OpenClaw cron.

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
- Needle rate is ~4.3/day; dedup resets daily and keys include session, so a flip-and-refire can alert twice in a day. Notifications are one message per run (needles bundled), so the user sees at most one alert per hour and quiet hours are silent. Decision: keep every needle during the soak; do not filter by rating yet.

## Phase 2 scaffolding (2026-11-03)

- src/server/market/narration.ts: NarrationInput contract, analogue join, template narrator, record ids. Pure.
- src/server/market/narrationStore.ts: one audit JSON per run + model + prompt version under data/narrations/.
- src/server/market/narrateCli.ts: `pnpm narrate -- --run=latest|<ISO> [--k=20] [--days=730] [--model=<id>|--template]`; `--events`, `--event=<key> [--force]`, `--event-runs[=N]`, `--list`, `--id=`.
- src/server/market/narrationEvents.ts: per-event input, retry guard, published flag, analogue loader, and the live hook shared with the CLI.
- src/server/market/narrationModel.ts: NVIDIA NIM chat-completions client, injectable fetch, prompt version 3. Structured JSON output plus a separate no-history prompt; forbids numbers not in the supplied facts.
- 198 tests; total suite passes. Ran on the latest empty run, the 2026-10-27 XAUUSD backfill, and the full 35-event backfill.
- Sparse sample: 251 breakout runs, only 10 contain an event. A 20-run bake-off needs backfilled events first, not waiting for live ones.
- Provider: NVIDIA NIM via the OpenAI-compatible endpoint at https://integrate.api.nvidia.com/v1. Model ids look like nvidia/nemotron-3-ultra-550b-a55b. The key is not stored in plaintext in openclaw.json, so it must be added to .env as NVIDIA_API_KEY, with NARRATION_MODEL set to an id confirmed by GET /v1/models.
- The pre-bake-off deepseek/kimi recommendation is void on this key; see the 2026-11-04 availability section below. The bake-off, not the names, decides.

## Twelve Data second source (2026-11-03)

Key stored in /home/san/doochyweb/.env as TWELVE_DATA_API_KEY (mode 600). .env.example has a placeholder. Token validated.

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

## Phase 2 model availability and grounding (2026-11-04)

Why: the pre-bake-off recommendation (deepseek v4.1 flash) could not be used on this NVIDIA account, and reasoning models silently returned empty content.

Availability, tested with the real 2026-10-27 XAUUSD input against GET /v1/models:
- `nvidia/nemotron-3.5-lightning-30b-a3b`: works. Reasoning by default (empty content, `finish_reason: length`), but with `chat_template_kwargs: { enable_thinking: false }` it returns a full note in ~2s. Chosen as the narrator default.
- `nvidia/nemotron-3-ultra-550b-a55b`: works with `reasoning_effort: "low"` in ~10s; without it, 55s and still all reasoning. Keep it for hypothesis work where depth matters.
- `deepseek-ai/deepseek-v4.1-flash`: hangs (HTTP 000 after 150s, no bytes).
- 404 `Not found for account`: `moonshotai/kimi-k2.6`, `nvidia/nemotron-3-super-120b-a12b`, `writer/palmyra-fin-70b-32k`, `mistralai/mistral-large-2-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`, `nvidia/nemotron-nano-3-30b-a3b`.
- `openai/gpt-oss-20b`, `z-ai/glm-5.3-flash`: timeout at 90s.
- `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`: reasoning-only, empty content at 1200 tokens.

Client changes: `NARRATION_DISABLE_THINKING=true` (default) sends the thinking off switch; optional `NARRATION_REASONING_EFFORT`; `max_tokens` raised 700 -> 900; a length-finish with empty content now says the budget was spent on reasoning instead of "empty completion". Audit records now carry `groundedness: string[]`.

Grounding results on the XAUUSD run, in order:
1. First lightning output garbled counts: "1 tie and 1 neither" while the match is tie=0, neither=1.
2. With a prompt rule against restating counts, the next run fabricated a statistical claim: the match CI (0.219-0.613) was said not to overlap the base rate (0.468), which is false.
3. Added "do not interpret the statistics (significance, overlap, probability of direction)" and a lint flag for overlap/significance wording.
4. Final run: no numbers outside the snapshot, no count restatement, no inference claim, lint `[]`. It cites the match/base/train/test rates and the correct 6-bar outcome window.

Deterministic lint (`groundednessWarnings` in narration.ts): every output number must appear in the input snapshot (allowing integer/rounded/percentage matches); flags restated outcome counts and overlap/significance wording. It is a red-flag filter, not proof of truth; it cannot catch a wrong association of two correct numbers, which is why the prompt also forbids interpretation.

Resolved: a 30-day forced backfill raised the sample from 10 to 35 events across 18 runs; the bake-off and the per-event backfill both used it.

## Phase 2 bake-off results (2026-11-04)

Sample: all 17 runs with a breakout in the log, 33 events. Why not 20: a 30-day forced backfill added only 10 events, because cTrader's 1H fetch is 480 bars (~20 days); older runs cannot confirm 1H and are rejected. Log backed up to `/tmp/opencode/openclaw-breakouts.<timestamp>.bak` before the backfill.

| model | runs | failures | lint-flagged | avg words | avg latency |
|---|---|---|---|---|---|
| template | 17 | 0 | 0 | 165 | 0 |
| nemotron 3.5 lightning 30b, thinking off | 17 | 0 | 1 | 106 | 3.4s |
| nemotron 3 ultra 550B, reasoning_effort low, 900 tokens | 17 | 11 | 2 | 14 | 20s |

- Lightning's flagged run restated counts and reached 191 words; three reruns of the same input were clean (98-126 words, no flags). Stochastic, not systematic.
- Ultra's empties all ended with `finish_reason: length`; it needs a 3000-token budget and still averages ~20s. Its two non-empty fabrications were `1.1` and `20000`, neither in the input. Rejected.
- Manual review found and fixed three prompt problems at v2: "17 evaluated runs" (it is a list of symbols), a false "no other symbols had sufficient history" when the skipped map said otherwise, and raw float precision (`1.2608353033884936`). The prompt now forbids speculating about missing fields/symbols and asks for at most 4 decimals.
- Audit ids now include the prompt version: `...__<model>__v2.json`; template stays `...__template__v1.json`.
- Residual risk: the lint catches absent numbers, restated counts, and overlap/significance wording, but not a wrong association of two correct numbers. Keep the one-retry guard and review a sample before trusting unattended public notes.
- Batch command: `pnpm narrate -- --event-runs[=N] [--models=a,b] [--template] [--no-save]`. Single-run command unchanged.

## Narrator delivery: public website UI (2026-11-04)

Decision: the narrator is a public, shareable website feature, not a chat message. The user wants to send the same note to someone else, so the note lives in doochy.net and anyone with the link can read it.

Surface and access:
- One expandable "Research note" under each event row in the Breakouts feed (not one note for the whole run).
- Public, like the Analysis page. No login needed; notes contain only public market data already shown on the site.
- A deep link selects and expands the note (for example `/breakouts?note=<event-key>`), so a single note can be shared directly.
- No chat copy. Scraper and breakout signals are website-only.

Data and generation:
- Granularity: one note per breakout event. Build the input from that event only, not every event in the run.
- Identity: use `breakoutKey()` (`symbol|levelKey|type|session-start`) as the event key; store it as `event_key` (plus `symbol`) and expose it in the Breakouts response.
- Storage: reuse the narration audit format under `data/narrations/`, keyed by event + model + prompt version. The event key is hashed into the filename; the run id stays for traceability.
- Generation: pre-generate after a live run that produced new events, and backfilled 35 historical events once. Never call the model from a public GET request.
- Publish rule: show a note only if it has no lint warnings and is within 150 words after at most one retry. Failed or flagged notes stay unpublished (not shown as an error).
- Cost: about one model call per new event (a few per day), ~3-4s each; no per-page-view cost.

API and UI:
- `GET /api/market/breakouts` adds the event key to each breakout.
- `GET /api/market/narrations?event=<key>` returns the latest saved public note, or 404 when none is published. Read-only and unauthenticated. It now also returns the deterministic `brief`, used for the expandable stats panel.
- `Breakouts.tsx` adds a toggle per row; expanding fetches the note once and renders plain text with model and created-at metadata. Historical log rows get the same toggle.
- Loading, empty ("No research note for this event yet") and unavailable states must not break the feed.

Resolved decisions:
- Deep link is a query string: `?note=<event-key>`. There is no client router, so the feed reads and updates the query with `history.replaceState`.
- The API returns `text`, `symbol`, `model`, `created_at`, `prompt_version` and `brief`; the UI shows text plus symbol, relative time, model and a deterministic stats panel.
- The lint result stays internal. A flagged note is simply absent from the public feed (404), while the audit record keeps the warnings.

Deployment (2026-11-04): `pnpm build` passed, pm2 restarted, and both `https://doochy.net/api/market/breakouts` (event keys) and `https://doochy.net/api/market/narrations?event=<key>` (published note) returned 200. No error-log entries. Next check: the first live note after a breakout run.

Implementation status (2026-11-05):
- `narration.ts`: per-event input filter, `NarrationBrief`, deterministic facts, compact model payload, prompt/lint v2, 150-word cap, publish guard, event-scoped audit id.
- `narrationEvents.ts`: analogue load, two-attempt guard, existing-note skip, `published` flag, live hook.
- `breakoutRunner.ts`: calls the hook after a live run with new events (background, gated by `NARRATION_ENABLED`).
- `routes.ts`: `/breakouts` adds `event_key`; `/narrations?event=` returns the published note or 404.
- `Breakouts.tsx`: note toggle on live and history rows, inline panel, loading/missing states, copy-link, and a deep-link panel when the event is outside the current page.
- `.env`: `NARRATION_ENABLED=true`; `.env.example` keeps it off by default.
- Deployed and verified end to end on doochy.net (v2 notes). Output v3 is code-complete and all 47 notes are regenerated in the audit store; the running server still needs a restart to serve the new API `brief` and stats panel. Pending: restart with approval, commit.
