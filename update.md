# Doochy feature tracker

Living document for the Trade AI feature port. Keep the checkboxes current as
work lands so the scope and the remaining backlog are always visible.

## Source

Inspected on 14 November 2026 at `https://tradeai.smartchain.consulting`, a
product of Smart Chain Technology. The signed-in member hub was reviewed
read-only. No AI runs were generated, no purchases were made, and nothing was
published or deleted.

Trade AI ships two products:

- **Individual**: a trading coach loop. Signal, journal, simulation, weekly AI
  review, all feeding each other.
- **Business**: a multi-tenant trading intelligence API with keys, quotas,
  webhooks, SDKs and child Telegram bots.

Only the individual side is in scope for Doochy. The business API is tracked as
a separate, later decision.

What makes the individual product work is the loop, not any single screen:
generate an idea, paper trade it, journal the result, get coached on the
behaviour. Doochy already has the idea and execution halves. It is missing the
review half.

Reference notes taken from the live product:

- Chart analysis costs 75 to 100 credits per run and uses a vision model.
- Signals cost 15 credits, news sentiment 20, portfolio analysis 120.
- Journal edits, simulation trades, watchlist runs and alert runs are all 15.
- Daily briefing is 50, trade review 50, weekly coach report 100.
- Credits are sold at 100 credits = 1 USD.
- Free plan is capped at 5 journal entries. Pro is unlimited.
- Journal separates verified P&L from self-reported P&L.
- Signal performance is public and verified per signal.

## Tiers

### Tier 1: highest return, reuses existing Doochy data

- [x] **Signal Performance**: public verified hit rate, average R, per symbol and
      per month breakdowns, and a cumulative R curve over resolved signals.
      Reuses the existing signal store and resolver.
- [x] **Watchlist & Alerts**: personal price alerts on symbols, delivered through
      the existing Telegram outbox, with a live watchlist price strip on the
      page. Reuses the market price cache and Telegram integration.
- [x] **Trade Journal**: personal trade log with manual entries and automatic
      import of closed cTrader trades. Imported rows carry verified P&L. Includes
      stats and CSV export. Becomes the foundation for AI Coach.

### Tier 2: differentiators

- [ ] **Simulation**: paper book with long and short entries, SL/TP auto-close,
      and trade history. Reuses the order ticket patterns.
- [ ] **Daily Briefing**: personalised morning summary built from watchlist,
      journal and open signals.
- [ ] **AI Coach trade review**: post-trade and weekly behaviour reports. Needs
      the journal and an AI provider key in the integrations admin.

### Tier 3: later

- [ ] Portfolio import and Risk Radar.
- [ ] Chart image analysis.
- [ ] News and sentiment.
- [ ] Market replay.
- [ ] Leaderboard, XP and credits. Credits imply billing, which a white-label
      deployment may not want.
- [ ] Public business API. Effectively a second product. Separate decision.

## Full feature list

Status legend: `done` means shipped in Doochy, `planned` means agreed but not
started, `later` means deliberately deferred, `skip` means not planned.

| Feature | Trade AI behaviour | Doochy status |
| --- | --- | --- |
| Chart Analysis | AI reads a symbol or a screenshot | later |
| Signal Studio | AI signal with entry, SL, TP and confidence | done (curated signals) |
| Portfolio | Holdings, allocation, Risk Radar, file import | later |
| Watchlist & Alerts | Follow symbols, rule based alert runs | done (Tier 1) |
| Simulation | 100k paper book, SL/TP auto-close | later (Tier 2) |
| My Journal | Ideas, linked trades, verified P&L, CSV export | done (Tier 1) |
| Daily Briefing | Morning brief from watchlist, portfolio, journal | later (Tier 2) |
| AI Coach | Post-trade reviews and weekly behaviour report | later (Tier 2) |
| Signal Performance | Public verified hit rate per signal | done (Tier 1) |
| News & Sentiment | Headlines scored by sentiment | later |
| Market Replay | Historical bar replay for practice | later |
| Leaderboard and XP | Gamified retention | later |
| Arcade and TCoins | Games and soft currency | skip |
| AI Credits and plans | Metered usage and subscriptions | later |
| Business API | Keys, quotas, webhooks, SDKs | later |
| Browser extension | Page summariser, separate product | skip |

## Tier 1 implementation notes

### Signal Performance

- New `GET /api/signals/performance` read built from resolved signals only.
- Overall, per symbol, per direction and per month buckets.
- Cumulative R curve in resolution order.
- Rendered as a Performance tab inside the Signals page, so no new nav module.
- Self-tested by `test/signalsPerformance.test.ts` (scoring, buckets, curve).

### Watchlist & Alerts

- New `alerts` module, signed-in only.
- Personal alert rows: symbol, condition (above or below), level, note, status.
- A one minute in-process checker reuses the market price cache.
- Triggers queue a Telegram message through the existing outbox for that user
  only. Users without a linked chat still get the in-app triggered state.
- Page also shows live prices for the shared market watchlist with quick
  prefill.
- The price helper reads at most 16 symbols per tick, so a user with more than
  16 distinct alert symbols has the remainder checked on later ticks.
- Self-tested by `test/alerts.test.ts` (validation, condition matching, the
  Telegram message).

### Trade Journal

- Lives as the Journal tab inside `/trading`, replacing the old order-history
  tab, so it shares that module's signed-in access rule. There is no separate
  journal tab in the primary navigation.
- Manual entries plus automatic import from cTrader closed deal history.
- Import is automatic in two ways: a ten-minute background pass over every user
  with stored credentials, and a sync after a journal read when the last run is
  older than five minutes. Both paths share the same minimum-gap guard and the
  unique (userId, dealId) index, so a trade is never imported twice.
- The tab shows the last sync time and refreshes every minute, so new broker
  trades appear without a reload. There is no import button.
- Every row has a note action next to delete. Notes are the member's own layer:
  `PATCH /api/journal/:id/note` changes only the note, so verified broker prices
  and P&L are never overwritten.
- Imported rows are keyed by `(userId, dealId)` so repeated imports are
  idempotent and never duplicate a trade.
- Verified P&L badge on imported rows, self-reported badge on manual rows.
- Stats: open, closed, verified, win rate, average P&L, total P&L, profit factor.
- CSV export with the same filters as the list.
- Self-tested by `test/journal.test.ts` (validation, stats, CSV escaping,
  cTrader mapping).

## Verification

- `pnpm typecheck` covers the server, webapp and test projects.
- `pnpm test`: 776 tests, 185 suites, all passing.
- `pnpm build` produces the server build and the webapp bundle.
- Not exercised against a live database, a broker socket or a Telegram chat in
  this pass; those paths need a running deployment to confirm end to end.

## Guardrails

- No em dashes anywhere in the repository.
- No secrets returned to the browser.
- Keep `doochyweb_*` storage keys, package name, pm2 name and deploy paths.
- No commit and no deploy without explicit approval.
