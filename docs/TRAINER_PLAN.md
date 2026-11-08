# Doochy Learn — Build Plan

**Purpose:** track what is done and what is not. The idea itself lives in
[`concept2.md`](../concept2.md); the original brainstorm is in [`concept.txt`](../concept.txt).
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
| Pattern tags | Mechanical core: engulfing, inside/outside bar, sweep/false breakout, double top/bottom, S/R flip, BOS/CHoCH |
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
| 4 | Outcome, barriers, base rates, publish | not started |
| 5 | Public API (server) | not started |
| 6 | Minimal public UI + accuracy scoring | not started |
| 7 | Pilot review, deploy, docs | not started |

---

## Phase 0 — Foundations, taxonomy, config

**Goal:** agree on precise pattern definitions and scaffold the trainer module without
changing existing market behaviour.

Tasks:
- [x] Add `docs/TRAINER_TAXONOMY.md`: one precise, testable definition per tag (engulfing,
      inside bar, outside bar, sweep/false breakout, double top, double bottom, S/R flip,
      BOS, CHoCH). State lookback windows, closed-bar rules, and what counts as a near-miss.
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
- [ ] Implement `src/server/trainer/outcomes.ts`: triple barrier at cut with `k=1.0×ATR`,
      `H=20`; label `up | down | scratch`; compute MFE/MAE in ATR and R terms.
- [ ] Compute per-item realized direction and base rates per tag + pooled baseline.
- [ ] Enforce non-overlap where possible and flag near-duplicates; stratify published items
      by outcome so the batch is not all one direction.
- [ ] Assert no look-ahead leakage: context is strictly bars `[.. cut]`; reveal is
      `(cut, cut+H]`; nothing from the future is stored in the context payload.
- [ ] Publish an immutable batch: `data/trainer/batches/<version>.json` plus Mongo
      `TrainerBatches` / `TrainerItems`.
- [ ] Add `pnpm trainer:publish` with a batch version and item count report.
- [ ] Tests: barrier resolution (up/down/scratch), MFE/MAE, base-rate math, overlap
      detection, leakage assertion.

Deliverables: outcome engine + batch publisher.
Acceptance: a ~50-item batch (`v1`) is published with base rates; tests + typecheck pass.

---

## Phase 5 — Public API (server)

**Goal:** serve anonymous drill sessions with server-side reveal.

Tasks:
- [ ] Add `src/server/trainer/routes.ts`, mounted under `/api/trainer`.
- [ ] Endpoints: `GET /batch` (metadata), `GET /session` / `GET /item` (anonymized context
      only), `POST /answer` (validate, record), `POST /reveal` (returns future bars + outcome
      + base rate + why). Reveal is a separate call a client can only make after answering.
- [ ] Anonymize payloads: no symbol, no absolute timestamps/dates, no absolute price; provide
      `%`/index-100 normalized values. Strip any field that could leak identity.
- [ ] Store anonymous attempts in memory or Mongo keyed by a client session id; no login.
- [ ] Tests: no future data in item payload, reveal gating, anonymization fields absent,
      validation.

Deliverables: trainer API.
Acceptance: a client can fetch an anonymized item, answer, then reveal; tests + typecheck
pass.

---

## Phase 6 — Minimal public UI + accuracy scoring

**Goal:** make the drill playable in the browser for a free, anonymous user.

Tasks:
- [ ] Add a trainer view under `src/webapp/src/` (no router library; follow existing view
      switching), reusing Tailwind/lucide/framer-motion.
- [ ] Render candles client-side (add `lightweight-charts`, Apache 2.0); hide future bars
      until reveal; no symbol/date/price labels.
- [ ] Answer panel: probability slider/input + take/pass; submit triggers reveal with
      animated future bars, barriers, outcome, base rate, short "why".
- [ ] Daily drill: fixed mix of tags, ~10 items; progress and accuracy in `localStorage`.
- [ ] Accuracy v1: probability converted to a directional call at 50% for correctness; store
      the raw probability so calibration can be added later. Trade/pass graded against the
      realized outcome.
- [ ] Responsible design: no streak/loss framing; show disclaimer and base-rate context.
- [ ] Tests: scoring/selection logic; typecheck for UI.

Deliverables: minimal playable trainer.
Acceptance: a user can complete a drill and see accuracy + base rates; tests + typecheck
pass.

---

## Phase 7 — Pilot review, deploy, docs

**Goal:** validate the pilot end to end and ship it at `learn.doochy.net`.

Tasks:
- [ ] Curate the ~50-item pilot batch using the Phase 3 workflow.
- [ ] End-to-end pass: ingest → scan → review → publish → play → reveal.
- [ ] Add `learn.doochy.net` routing (Express + nginx) alongside the existing app.
- [ ] Add user-facing docs/disclaimer text; internal README for the trainer CLIs.
- [ ] Record known limitations and deferred work (placebos, calibration, accounts,
      more timeframes, paid).
- [ ] Final `pnpm typecheck` + `pnpm test`.

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
