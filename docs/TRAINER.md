# Doochy Learn trainer

Internal guide for the `learn.doochy.net` chart-reading trainer. The product idea lives in
[`concept2.md`](./concept2.md); the build history and deferred work live in
[`TRAINER_PLAN.md`](./TRAINER_PLAN.md); pattern definitions live in
[`TRAINER_TAXONOMY.md`](./TRAINER_TAXONOMY.md).

This is an educational practice tool. It is not a signal service, does not place trades and
does not promise an edge.

## Architecture

| Area | Files | Responsibility |
|---|---|---|
| Locked config | `src/server/trainer/config.ts` | Symbols, timeframes, `k=1.0×ATR`, `H=20`, tags, caps |
| Shared types | `src/server/trainer/types.ts` | Pointer-based candidates, reviews and published items |
| Ingestion | `ingest.ts`, `bars.ts` | Two years of closed Binance bars in `TrainerBars` |
| Detection | `detectors.ts`, `scan.ts` | Deterministic candidates, guards and per-series cap |
| Human review | `review.ts`, `preview.ts`, `reviewStore.ts` | CSV export/import, validation, shortlist, local HTML preview, stats, Mongo reviews |
| Outcomes | `outcomes.ts` | Triple-barrier result, MFE/MAE in ATR and R |
| Publish | `publish.ts` | Overlap/invalid/balance filters, base rates, snapshot + Mongo |
| Public API | `payload.ts`, `attempts.ts`, `routes.ts` | Anonymized session, answer-gated reveal, in-memory attempts |
| Web UI | `src/webapp/src/learn/` | Daily drill, chart, answer/reveal, browser-local scoring |
| Path routing | `src/webapp/src/routing.ts` | Canonical paths such as `/learn` and `/breakouts?note=`; legacy query links redirect |

Data is written under the git-ignored `data/` directory:

- `data/trainer/candidates/<runId>.csv`
- `data/trainer/review/<runId>.review.csv`
- `data/trainer/review/<runId>.shortlist.csv`
- `data/trainer/review/<runId>.preview.html`
- `data/trainer/batches/<version>.json`

Mongo collections are `TrainerBars`, `TrainerReviews`, `TrainerBatches` and `TrainerItems`.
The public API reads the latest `TrainerBatches` document by `publishedAt` and its items.

## Environment

Use the repo `.env`; never commit it.

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string, default `mongodb://127.0.0.1:27017` |
| `MONGO_DB` | Database name, default `doochyweb` |
| `PORT` | Express port, default `9111`; binds to `127.0.0.1` |
| `TRAINER_ITEM_SECRET` | Optional stable key for opaque public item ids |

If `TRAINER_ITEM_SECRET` is unset, each server process generates a random key. Item ids and
in-memory answer sessions are then invalidated by a restart, which is acceptable for live
anonymous drills but not ideal across deploys.

## Local workflow

```bash
pnpm install
pnpm trainer:ingest
pnpm trainer:scan
pnpm trainer:review export
pnpm trainer:review shortlist --from=data/trainer/review/<runId>.review.csv
pnpm trainer:review preview --file=data/trainer/review/<runId>.shortlist.csv
```

`trainer:review shortlist` writes `<runId>.shortlist.csv` next to the review CSV. It keeps
only pending rows, takes at most 8 per tag, alternates direction within a tag, round-robins
across the six `symbol:timeframe` series, and targets the pilot review size of 56 rows
(8 per tag across the seven tags).
The output uses the normal review header with literal `status=pending` and blank `ambiguity`;
it does not touch Mongo.

`trainer:review preview` writes `<runId>.preview.html` next to the shortlist, or to `--out`.
The page is a read-only gallery with inline CSS/JS and two SVG panels per card: a `--context`
window (120 bars by default) and a magnified pattern zoom. Both panels end at `cutIndex` and
never show a bar after the cut. Per-tag annotations mark the swept range extreme, rejection
close, flipped level, retest, break bar or structure trend lines; BOS/CHoCH use the shared
`readTrend` at `row.endIndex`. The old filled pattern rectangle is gone. Missing bars render a
placeholder card instead of stopping the run. The preview only reads the shortlist and
`TrainerBars`; it does not import, publish or write Mongo. Open the HTML locally to review the
shortlist before editing the CSV.

A reviewer then edits the shortlist:

- Allowed: `status`, `ambiguity`, `cutIndex`, levels and `notes`.
- Required for `accept`: `ambiguity` from 1 (clear) to 5 (very ambiguous).
- Read-only: `id`, `symbol`, `timeframe`, `tag`, `family`, `direction`, `startIndex`,
  `endIndex`. The id is derived from the read-only bounds.
- Blank `status` and `pending` both mean pending.

Import and inspect the edited file:

```bash
pnpm trainer:review import --file=data/trainer/review/<shortlist>.csv \
  --candidates=data/trainer/candidates/<runId>.csv
pnpm trainer:review stats
```

Import upserts every valid row, including pending rows, so edits are not dropped. Use
`pnpm trainer:review stats --file=<csv>` to inspect a file without touching the store, and
`pnpm trainer:review set --id=<id> --status=accept --ambiguity=3` for a quick status edit.

## Publish

Always dry-run first and inspect accepted/kept/dropped, overlap, invalid and base-rate counts:

```bash
pnpm trainer:publish --version=v1 --runId=<runId> --dry-run
```

Publishing is approval-gated:

```bash
pnpm trainer:publish --version=v1 --runId=<runId> --balance --skip-invalid
```

`--balance` downsamples an outcome above `BALANCE_MAX_SHARE`; `--skip-invalid` drops accepted
rows whose bars or barriers cannot be built; `--allow-overlap` is for exceptional batches.
Without `--skip-invalid`, any invalid accepted row fails the whole publish.

A real publish writes `data/trainer/batches/<version>.json` and upserts `TrainerBatches` /
`TrainerItems`. Existing versions are immutable by convention and the CLI refuses to
overwrite them unless `--force` is passed. Do not use `--force` without explicit approval.

### Rollback

The public API serves the most recently published batch. To roll back safely:

1. Stop and identify the last approved source run/version.
2. Rebuild and publish a new version from the known-good reviewed rows with explicit
   approval. This is preferred because it leaves an audit trail.
3. If an exact snapshot restore is required, restore both the Mongo batch/items and
   `data/trainer/batches/<version>.json` from backup, or republish the old version with
   `--force` after approval.

No rollback command deletes review or bar data.

## API and UI

The server mounts the public router at `/api/trainer`. The pre-answer payload contains
normalized candles, barrier percentages and an opaque item id only. `POST /reveal` refuses
until that session has answered the item. Answers are first-answer-wins and kept in memory.

Useful local checks:

```bash
curl -s http://127.0.0.1:9111/api/trainer/batch
curl -s "http://127.0.0.1:9111/api/trainer/session?sessionId=local-test-0001"
```

`503 no batch published` is expected until a batch exists. The Learn tab is public; no
Authorization header is sent by the trainer client.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` writes the server to `dist/` and the SPA to `webapp/dist/`. The running pm2
process keeps its old code until it is restarted; restart is a deploy action and needs
approval. See [`TRAINER_DEPLOY.md`](./TRAINER_DEPLOY.md).

## Pilot snapshot (2026-11-09 revision; curated 2026-11-10)

- Taxonomy revision: seven tags only. Removed `inside_bar`, `outside_bar`, `double_top` and
  `double_bottom`; `v1` was built with the confirmed-swing 60/3/0.1 sweep rule. The
  2026-11-10 accuracy revision changes the detector code to 20-bar-range sweeps,
  wick-clearing/body-expanding engulfing and alternating BOS/CHoCH structure; `v1` remains
  unchanged until a future publish.
- Mongo cleanup: purged 240 removed-tag reviews from `TrainerReviews`, leaving 420 valid
  reviews (60 each for the remaining tags). Valid existing reviews were not deleted.
- Scan run `2026-11-09T14-47-12-487Z`: 420 candidates, 60 per tag, across all six
  `symbol:timeframe` series.
- Export: `data/trainer/review/2026-11-09T14-47-12-487Z.review.csv`, 420 pending rows. It was
  not imported wholesale, so existing review decisions remained intact.
- First shortlist: `data/trainer/review/2026-11-09T14-47-12-487Z.shortlist.csv`, 56 rows,
  8 per tag, 28 up / 28 down. It was superseded because accepting all 56 leaves only 42 rows
  after the 20-bar overlap guard.
- Curated fallback shortlist: `data/trainer/review/2026-11-09T14-47-12-487Z.shortlist10.csv`,
  70 rows, 10 per tag, 35 up / 35 down. Curated to 66 accept / 4 reject; the existing
  `SOL:15m:sr_flip:23-60:up` decision was carried forward as accept/ambiguity 3.
- Preview: `data/trainer/review/2026-11-09T14-47-12-487Z.shortlist10.preview.html`, 70 cards,
  0 missing series, 120-bar context plus per-card zoom, inline annotations and no network
  assets.
- Import: run with the explicit run id and candidate CSV; 70 valid rows, matched 50 and
  upserted 20. The store now holds 440 reviews: 370 pending, 66 accept, 4 reject.
- Publish: `v1`, accepted 66, kept 50, dropped 16 by overlap, 0 invalid, 0 balance issues.
  Kept mix is 27 up / 23 down with no scratches: bullish engulfing 5, bearish engulfing 5,
  sweep up 7, sweep down 8, SR flip 9, BOS 8, CHoCH 8.
- Verification: `/api/trainer/batch` returns `200` with `itemCount=50` on both hosts;
  `doochy.net/learn` returns `200`; the legacy `?view=learn` link redirects. A local
  session -> answer -> reveal pass returned an anonymized context and a reveal with tag,
  outcome and base rates.
- No DNS, nginx, certificate or pm2 change was made. Any deploy/restart remains
  approval-gated.
- Certificate: the current origin cert covers both `doochy.net` and `learn.doochy.net`; the
  current nginx blocks live in `/etc/nginx/sites-enabled/default` and were not moved.
  [`TRAINER_DEPLOY.md`](./TRAINER_DEPLOY.md) records the verification commands.

Historical `2026-11-08T16-24-40-459Z` files include removed tags and are superseded; do not
use them as the current pilot snapshot.

## Troubleshooting

| Symptom | Check |
|---|---|
| `/api/trainer/batch` returns 503 | No published batch; run the dry run, then publish with approval |
| Publish reports missing bars | Run `pnpm trainer:ingest`; affected series cannot be labelled |
| Import rejects ids | Pass the matching `--candidates=<runId>.csv`; ids must exist there |
| Accepted row fails publish | Run with `--dry-run`; fix levels/bounds or explicitly use `--skip-invalid` |
| Batch already exists | Do not overwrite; choose a new version or get approval for `--force` |
| Shortlist does not include a row | It filters to pending rows and caps/samples per tag/series |
| Preview card says no stored bars | Run `pnpm trainer:ingest` for that series, then regenerate the preview |
| Drill resets after restart | Attempts are in memory; set `TRAINER_ITEM_SECRET` for stable item ids |

## Limitations and deferred work

- Pilot sample only; base rates are descriptive, not proof of an edge.
- No calibration curve, Brier/log-loss or skill-vs-baseline scoring yet.
- No accounts or server-persisted profiles; progress is browser-local.
- No placebos, shuffled returns, live challenges or multiplayer.
- No labeling UI; review is CLI + CSV.
- No paid tier, automated trading or signals.
- Additional symbols, timeframes and pattern families are out of scope for the pilot.
