# Doochy Learn — Build Plan

**Purpose:** track what is done and what is not. The idea itself lives in
[`concept2.md`](./concept2.md); the original brainstorm is in [`concept.txt`](./concept.txt).
If this plan and the concept disagree, the concept wins and this plan is corrected.

**Working mode:** an **overseer agent** writes worker prompts; a **worker agent** executes
them in this repo. Every phase ends with `pnpm typecheck` and `pnpm test` passing, plus a
short delivery note. The worker updates the checkboxes and status table in this file.

---

## Locked decisions

| Decision | Value |
|---|---|
| Product | Free chart-reading trainer, `learn.doochy.net`, part of doochyweb |
| Symbols | BTC, ETH, SOL |
| Timeframes | 15m, 1h |
| History mined | 2 years |
| First batch | ~50 curated items (pilot) |
| Pattern tags | Seven-tag core: bullish/bearish engulfing, sweep up/down, S/R flip, BOS, CHoCH |
| Question types | Probability (upper barrier first) + trade/pass |
| Triple barrier | `k = 1.0 × ATR`, `H = 20 bars` |
| Review workflow | CLI + CSV (no labeling UI yet) |
| User identity | Anonymous + `localStorage`; accounts later |
| Scoring | Accuracy first; calibration/Brier later |
| Negative controls / placebos | Deferred (not in this plan) |
| Stack | Reuse existing Node/Express/Mongo/React/Vite/Tailwind |

## Status legend

`not started` · `in progress` · `blocked` · `done`

| Phase | Name | Status |
|---|---|---|
| 0 | Foundations, taxonomy, config | done |
| 1 | Long-history ingestion + bar QA | done |
| 2 | Detector refactor + historical scan | done |
| 3 | CLI + CSV review workflow | done |
| 4 | Outcome, barriers, base rates, publish | done |
| 5 | Public API (server) | done |
| 6 | Minimal public UI + accuracy scoring | done |
| 7 | Pilot review, deploy, docs | in progress - awaiting human curation |

---

## Phase 0 — Foundations, taxonomy, config

**Goal:** agree on precise pattern definitions and scaffold the trainer module without
changing existing market behaviour.

Tasks:
- [x] Add `docs/TRAINER_TAXONOMY.md`: one precise, testable definition per tag (engulfing,
      sweep/false breakout, S/R flip, BOS, CHoCH). State lookback windows, closed-bar rules,
      and what counts as a near-miss. The 2026-11-09 revision reduced this to seven tags.
- [x] Add `src/server/trainer/config.ts` with the locked values (symbols, timeframes,
      history days, `k`, `H`, batch size, tag list). Export typed constants.
- [x] Add `src/server/trainer/types.ts`: `Candidate`, `ReviewRow`, `TrainerItem`,
      `TrainerBatch`, `Barrier`, `Outcome` types. Pointers only (bar indices), no bar copies.
- [x] Create empty module folders/files with doc-comment headers so later phases have a home.
- [x] Do **not** modify `patterns.ts` / `breakoutEngine.ts` yet; trainer detectors are new.

Deliverables: taxonomy doc, config, types, skeleton.
Acceptance: `pnpm typecheck` and `pnpm test` pass; no existing tests broken.

---

## Phase 1 — Long-history ingestion + bar QA

**Goal:** obtain clean, closed, UTC 2-year series for BTC/ETH/SOL at 15m and 1h.

Tasks:
- [x] Add paginated Binance kline ingestion in `src/server/trainer/ingest.ts` (incremental,
      page until `startTime`; 15m and 1h; 2 years). Do not reuse the 480-bar UI cache.
- [x] Persist to a dedicated Mongo collection (`TrainerBars`) keyed `symbol:timeframe`, with
      flat arrays consistent with `persist.ts` conventions. Provide read/write helpers.
- [x] Enforce closed bars only, UTC ms timestamps, sort + de-duplicate by open time.
- [x] Add bar QA: detect gaps > 1 bar, zero/negative prices, obvious bad ticks (e.g. high <
      low, close outside [low, high]). Report counts; never silently drop without logging.
- [x] Add a CLI entry (`pnpm trainer:ingest`) and document it.
- [x] Tests: pagination slicing, merge/dedupe, gap detection, bad-tick detection.

Deliverables: ingestion + QA + CLI.
Acceptance: 2-year series for all six symbol/timeframe pairs stored and QA-clean;
tests + typecheck pass.

---

## Phase 2 — Detector refactor + historical scan

**Goal:** find candidate instances across full history and emit them for review.

Tasks:
- [x] Implement pure detectors in `src/server/trainer/detectors.ts`: `(bars, i) => match | null`
      for each taxonomy tag. Reuse logic/concepts from `patterns.ts` and `breakoutEngine.ts`
      (swings, ATR thresholds) without regressing the live analysis/breakout features.
- [x] Implement `src/server/trainer/scan.ts`: walk every closed bar, run detectors, and
      produce `Candidate { id, symbol, timeframe, cutIndex, tag, family, bounds, notes }`.
- [x] Propose a default `cutIndex` per candidate; record pattern bounds and any reference
      levels the detector can infer.
- [x] Enforce a minimum context (≥ 60 bars) and a minimum forward horizon (`H` bars) so the
      outcome is always computable.
- [x] Emit `data/trainer/candidates/<runId>.csv` with a stable column schema.
- [x] Tests: each detector on small synthetic arrays (positive and negative cases), scan
      range guards, determinism.

Deliverables: detectors, scanner, candidates CSV.
Acceptance: a scan over the ingested history produces a reviewable CSV; tests + typecheck
pass.

---

## Phase 3 — CLI + CSV review workflow

**Goal:** let a human curate candidates without a UI.

Tasks:
- [x] Define and document the CSV schema (see below).
- [x] Add `pnpm trainer:review` commands: `export` (candidates → review CSV), `import`
      (validated review CSV → store), `stats` (counts by tag/status/ambiguity), and
      `set` quick edits.
- [x] Validate on import: known tag, cutIndex within range, required level fields for tags
      that need them, ambiguity 1–5, no unknown ids. Reject bad rows with clear messages.
- [x] Round-trip safety: importing never loses unedited rows; ids are stable.
- [x] Tests: CSV serialise/parse round-trip, validation failures, stats.

Review CSV schema:
`id, symbol, timeframe, cutIndex, tag, family, direction, startIndex, endIndex,
 levelUpper, levelLower, neckline, notes, status(pending|accept|reject), ambiguity(1-5)`

Blank status means `pending`. Candidate identity and bounds are read-only; the human may
edit `status`, `ambiguity`, `cutIndex`, levels and `notes`. Pending rows are imported too.

Deliverables: CLI + validation + docs.
Acceptance: a human can go from candidates CSV to a validated accepted set and back;
tests + typecheck pass.

---

## Phase 4 — Outcome, barriers, base rates, publish

**Goal:** turn accepted items into a labelled, versioned batch.

Tasks:
- [x] Implement `src/server/trainer/outcomes.ts`: triple barrier at cut with `k=1.0×ATR`,
      `H=20`; label `up | down | scratch`; compute MFE/MAE in ATR and R terms.
- [x] Compute per-item realized direction and base rates per tag + pooled baseline.
- [x] Enforce non-overlap where possible and flag near-duplicates; stratify published items
      by outcome so the batch is not all one direction.
- [x] Assert no look-ahead leakage: context is strictly bars `[.. cut]`; reveal is
      `(cut, cut+H]`; nothing from the future is stored in the context payload.
- [x] Publish an immutable batch: `data/trainer/batches/<version>.json` plus Mongo
      `TrainerBatches` / `TrainerItems`.
- [x] Add `pnpm trainer:publish` with a batch version and item count report.
- [x] Tests: barrier resolution (up/down/scratch), MFE/MAE, base-rate math, overlap
      detection, leakage assertion.

Deliverables: outcome engine + batch publisher.
Acceptance: a ~50-item batch (`v1`) is published with base rates; tests + typecheck pass.

---

## Phase 5 — Public API (server)

**Goal:** serve anonymous drill sessions with server-side reveal.

Tasks:
- [x] Add `src/server/trainer/routes.ts`, mounted under `/api/trainer`.
- [x] Endpoints: `GET /batch` (metadata), `GET /session` / `GET /item` (anonymized context
      only), `POST /answer` (validate, record), `POST /reveal` (returns future bars + outcome
      + base rate + why). Reveal is a separate call a client can only make after answering.
- [x] Anonymize payloads: no symbol, no absolute timestamps/dates, no absolute price; provide
      `%`/index-100 normalized values. Strip any field that could leak identity.
- [x] Store anonymous attempts in memory or Mongo keyed by a client session id; no login.
- [x] Tests: no future data in item payload, reveal gating, anonymization fields absent,
      validation.

Deliverables: trainer API.
Acceptance: a client can fetch an anonymized item, answer, then reveal; tests + typecheck
pass.

---

## Phase 6 — Minimal public UI + accuracy scoring

**Goal:** make the drill playable in the browser for a free, anonymous user.

Tasks:
- [x] Add a trainer view under `src/webapp/src/` (no router library; follow existing view
      switching), reusing Tailwind/lucide/framer-motion.
- [x] Render candles client-side (add `lightweight-charts`, Apache 2.0); hide future bars
      until reveal; no symbol/date/price labels.
- [x] Answer panel: probability slider/input + take/pass; submit triggers reveal with
      animated future bars, barriers, outcome, base rate, short "why".
- [x] Daily drill: fixed mix of tags, ~10 items; progress and accuracy in `localStorage`.
- [x] Accuracy v1: probability converted to a directional call at 50% for correctness; store
      the raw probability so calibration can be added later. Trade/pass graded against the
      realized outcome.
- [x] Responsible design: no streak/loss framing; show disclaimer and base-rate context.
- [x] Tests: scoring/selection logic; typecheck for UI.

Deliverables: minimal playable trainer.
Acceptance: a user can complete a drill and see accuracy + base rates; tests + typecheck
pass.

---

## Phase 7 — Pilot review, deploy, docs

**Goal:** validate the pilot end to end and ship it at `learn.doochy.net`.

Tasks:
- [x] Curate the ~50-item pilot batch using the Phase 3 workflow.
- [x] End-to-end pass: ingest → scan → review → publish → play/reveal (API verified locally).
- [x] Add `learn.doochy.net` host/query routing in the SPA and document nginx/DNS/certbot.
- [x] Add the read-only HTML shortlist preview (`trainer:review preview`) and tests, including
      per-tag annotations and the magnified pattern zoom.
- [x] Document the current origin certificate, Cloudflare behavior and the existing nginx
      reality without moving the active `/etc/nginx/sites-enabled/default` blocks.
- [ ] Apply the approved DNS/nginx/certbot deploy and restart pm2.
- [x] Add user-facing docs/disclaimer text; internal README for the trainer CLIs.
- [x] Record known limitations and deferred work (placebos, calibration, accounts,
      more timeframes, paid).
- [x] Final `pnpm typecheck` + `pnpm test`.

Deliverables: deployed pilot.
Acceptance: the pilot is playable on the subdomain with 50 curated items.

---

## Deferred (not in this plan)

- Negative controls / placebo items
- Calibration curve, Brier/log-loss, skill-vs-baseline
- User accounts and server-persisted skill profiles
- Additional symbols, timeframes, and pattern families (chart/ICT/harmonic/Wyckoff)
- Polished human labeling UI
- Live weekly challenges, multiplayer, WebSocket
- Paid tier and B2B

## Progress log

Add a dated line here when a phase starts, blocks, or completes.

- 2026-11-08 — Plan created. Phase 0 ready for worker.
- 2026-11-08 — Phase 0 done: taxonomy, config, pointer-only types and skeleton modules added; `pnpm typecheck` and `pnpm test` pass.
- 2026-11-08 — Phase 1 done: Binance ingestion + TrainerBars + QA + CLI; ingested 262,794 bars across 6 pairs with 0 gaps; `pnpm typecheck` and `pnpm test` pass.
- 2026-11-08 — Phase 2 done: pure detectors for all 11 tags + `scan.ts` guards, deterministic per-tag cap (`SCAN_CAP_PER_TAG_PER_SERIES=10`), candidates CSV and `trainer:scan`; scan emitted 660 rows across 6 pairs; `pnpm typecheck` and `pnpm test` (249) pass.
- 2026-11-08 — Phase 3 done: RFC4180 CSV helpers, export/import validation, `TrainerReviews` store, and `trainer:review` export/import/stats/set; 660-row review round-trip preserved every pending row, one row set to accept; `pnpm typecheck` and `pnpm test` (281) pass.
- 2026-11-08 — Phase 4 done: `outcomes.ts` triple barrier + MFE/MAE/R, no-leak context slices, `publish.ts` deterministic frozen batch, per-series overlap guard, outcome balancing, per-tag + pooled base rates, file/Mongo publisher, and `trainer:publish`; dry run kept 1 accepted row (`sr_flip`, up 1.000) and wrote nothing; `pnpm typecheck` and `pnpm test` (304) pass.
- 2026-11-08 — Phase 5 done: public `/api/trainer` router with lazy latest-batch loading, anonymous session selection, percent/volume-normalized context and reveal payloads, opaque item ids, in-memory first-answer-wins attempt store with TTL/session cap, and answer-gated reveal; `pnpm typecheck` and `pnpm test` (329) pass.
- 2026-11-09 — Phase 6 done: public Learn tab with `lightweight-charts` anonymized candles/barriers, answer + reveal flow, daily 10-item localStorage queue, 50% directional grading and separate take/pass accuracy, tag/pooled base rates, reduced-motion reveal, mobile/a11y states, and scoring/reset tests; `pnpm typecheck`, `pnpm test` (340) and `pnpm build` pass.
- 2026-11-09 — Phase 7A done: `trainer:review shortlist` emits a deterministic 88-row CSV (8/tag, alternating direction, all six series), Learn scoring disclosure, `initialView` for `learn.*` / `?view=learn`, and `docs/TRAINER.md` + `docs/TRAINER_DEPLOY.md`; dry-run `v1` kept the 1 accepted `sr_flip` and wrote nothing. `pnpm typecheck`, `pnpm test` (351) and `pnpm build` pass. Phase 7 remains in progress pending human curation; no publish, DNS/nginx change or pm2 restart.
- 2026-11-09 — Phase 7B done: added the deterministic read-only `trainer:review preview` HTML gallery (`preview.ts`, inline SVG/candles, filters/search, no network, no Mongo writes) and preview tests; generated `data/trainer/review/2026-11-08T16-24-40-459Z.preview.html` with 88 cards and 0 missing series. Updated `TRAINER_DEPLOY.md` with the then-current certificate and nginx notes; the 2026-11-09 revision corrected these to the certificate covering both names and nginx staying in `sites-enabled/default`. Documented that no pm2 restart is needed while `/api/trainer/batch` is already live and 503. `pnpm typecheck`, `pnpm test` (357) and `pnpm build` pass. Curate, import, publish and apply DNS/nginx/certbot/deploy remain unchecked and approval-gated.
- 2026-11-09 — Trainer revision: reduced the taxonomy to seven tags, replaced liquidity sweeps with the recent-confirmed-swing 60/3/0.1 rule, added per-tag preview annotations and a magnified zoom panel, and corrected the certificate/nginx docs. Purged 240 removed-tag reviews (660→420 valid); scan `2026-11-09T14-47-12-487Z` emitted 420 candidates; shortlist is 56 rows (8/tag) and preview is 56 cards with 0 missing. `pnpm typecheck`, `pnpm test` (357) and `pnpm build` pass. No publish, deploy, cert, nginx or pm2 changes were made.
- 2026-11-10 — Phase 7 curation/publish: the 56-row shortlist would keep only 42 after the overlap guard, so generated the approved 70-row fallback (10/tag). Curated 66 accept / 4 reject, carried `SOL:15m:sr_flip:23-60:up` as accept/ambiguity 3, and imported with the explicit run id (70 valid; matched 50, upserted 20; store 440 = 370 pending + 66 accept + 4 reject). Dry-run and publish of `v1` kept 50/66 (16 overlap drops, 0 invalid, 0 balance) with 27 up / 23 down and no scratches. `/api/trainer/batch` returns 200 with `itemCount=50`; a local session -> answer -> reveal pass succeeded. No commit, DNS, nginx, certificate or pm2 change was made.
