# Daily Briefing v2 Plan

## Goal
Replace the single AI paragraph with a grounded, structured briefing containing:

1. Dated headline, overview, session focus, and missing-data notes.
2. Per-symbol watchlist notes: What happened, Why it matters, Watch for.
3. Open journal ideas with plan levels and current-price relationships.
4. Key risks.
5. What to monitor.

## Locked Decisions
- Headlines: omit for now, show an explicit "no news feed connected" caveat. Never let the model invent news.
- Session focus: add a per-user briefing preference. Default to London and New York.
- Open ideas: use open journal entries only. Do not include paper positions or active signals in that section.
- Keep active signals visible in a separate card.
- No new dependencies.

## Data Model

### Updated BriefingSnapshot
Add:

```ts
version: 2
focusSessions: ("asia" | "london" | "newyork")[]
sessions: {
  key: "asia" | "london" | "newyork"
  label: string
  status: "open" | "closed"
  nextChange: string | null
}[]
watchlist: {
  symbol: string
  name: string | null
  type: string | null
  last: number
  previousClose: number
  changePct: number
  dayHigh: number
  dayLow: number
  barTime: string
  quote: { price: number; at: string } | null
}[]
signals: {
  ...existing fields
  target2: number | null
  target3: number | null
  timeframe: string | null
  note: string
  quote: { price: number; at: string } | null
  toEntryPct: number | null
  toStopPct: number | null
  toTargetPct: number | null
}[]
journalIdeas: {
  id: string
  symbol: string
  side: "buy" | "sell"
  entryPrice: number | null
  stop: number | null
  target: number | null
  verified: boolean
  openedAt: string | null
  note: string
  quote: { price: number; at: string } | null
  toEntryPct: number | null
  toStopPct: number | null
  toTargetPct: number | null
}[]
dataNotes: string[]
```

- Replace `movers` with `watchlist`, but normalize legacy stored `movers` into watchlist rows when reading.
- Include every effective watchlist symbol, up to the existing 12-symbol cap.
- Prioritize watchlist symbols in journal and signal limits.
- Compute distances from the latest quote when available, otherwise the daily close, and label the source.
- Add a data note when no news feed is connected, when a symbol has no daily data, or when a plan level or quote is missing.

### Structured AI Output
Add `sections` to `BriefingRecord`:

```ts
interface BriefingSections {
  headline: string
  overview: string
  watchlist: { symbol: string; whatHappened: string; whyItMatters: string; watchFor: string }[]
  journalIdeas: { id: string; update: string }[]
  risks: string[]
  monitor: string[]
  caveats: string[]
}
```

- Keep the existing plain `narrative` field only for compatibility with stored briefs.
- New generations write `sections`; `narrative` stays null.
- `toBriefingRecord` safely normalizes missing or legacy fields.

## Per-User Focus Sessions
- Add a `BriefingPreference` collection keyed by `userId`.
- Fields: `focusSessions`, `updatedAt`.
- Default: `["london", "newyork"]`.
- Validate to the allowed set, deduplicate, require at least one.
- Add `GET /api/briefing/preferences` support through the existing `GET /api/briefing` response.
- Add `PATCH /api/briefing/preferences` accepting `{ focusSessions }`.
- Saving a new focus selection clears today's stored brief.
- The frontend saves the preference and rebuilds the brief so the selected sessions appear immediately.

Add a pure session helper in `src/server/briefing/sessions.ts`:
- Asia, London, New York windows in UTC.
- Open or closed status.
- Next session change label.
- Weekday/weekend handling for FX.
- Default preference normalization.

## Server Changes

### src/server/briefing/build.ts
- Replace mover-only builders with watchlist-row builders that include previous close, daily high/low, bar time, and quote.
- Add journal-idea builders with level distances.
- Expand signal rows with quote and level distances.
- Add `buildSessionRows`.
- Add `buildFallbackSections(snapshot)`, producing readable deterministic sections when no AI is configured or the AI response is invalid.
- Replace the free-text prompt with a strict JSON contract:
  - Return only JSON.
  - No markdown or code fences.
  - Use only supplied facts.
  - Do not invent news, events, levels, support/resistance, or forecasts.
  - Mention the missing-news caveat.
  - Include exactly one watchlist note per supplied symbol.
  - Include exactly one journal update per supplied open idea.
  - Keep risk and monitoring bullets tied to provided data.
  - Never give advice or predict.
  - Never use an em dash.
- Add `parseBriefingSections(raw, snapshot)`:
  - Tolerate optional JSON fences.
  - Validate strings and arrays.
  - Align watchlist notes by symbol and journal notes by id.
  - Drop unknown symbols or ids.
  - Fill missing sections or notes from the deterministic fallback.
  - Trim and cap lengths and array sizes.
  - Normalize em dashes.
  - Return fallback sections on malformed JSON while preserving an error note.

### src/server/briefing/service.ts
- Gather effective watchlist daily bars for the existing 12-symbol cap.
- Gather active signals up to a larger candidate pool, then select 6, preferring watchlist symbols and newest age.
- Gather open journal entries with `listJournal(userId, { status: "open" })`, select 6, preferring watchlist symbols and newest open date.
- Fetch latest quotes for the union of watchlist, signal, and journal symbols in chunks of 16 through `signalPrices`.
- Read and validate focus-session preferences.
- Build the v2 snapshot.
- Call AI with `maxTokens` around 1800, low temperature, and a 45-second timeout.
- Parse structured sections and fall back deterministically on failure.
- Store both the snapshot and sections.

### src/server/briefing/store.ts
- Add `sections` to the briefing schema.
- Store snapshot version 2.
- Normalize legacy snapshots in `toBriefingRecord`.
- Add `BriefingPreference` schema and read/save helpers.
- Treat any stored brief with `snapshot.version !== 2` as stale and regenerate on read.

### src/server/briefing/routes.ts
- Add `PATCH /preferences`.
- Validate focus-session input and return the normalized preference.
- Clear today's brief after saving a preference.

### Journal invalidation
- Clear today's brief after open journal entries are created, edited, or deleted so the next visit reflects new plans.
- Leave signal freeze semantics unchanged. Active signals remain frozen until Refresh.

## Frontend Changes

### src/webapp/src/api.ts
Mirror the new snapshot, sections, and preference types. Add:
- `briefingApi.savePreferences()`
- `BriefingResponse.preferences`

### src/webapp/src/briefing/BriefingPage.tsx
Replace the current summary plus two tables with:

1. Hero card
   - Long date plus AI headline.
   - Overview.
   - Session badges for the user's selected sessions.
   - Model, built time, Refresh.
   - Inline focus-session toggles with save/rebuild.
   - AI-unavailable warning when applicable.

2. Your watchlist
   - One card or row per symbol.
   - Signed daily change, last, daily high/low, quote source when available.
   - What happened, Why it matters, Watch for.
   - Clear missing-data state.

3. Open journal ideas
   - One card per open journal entry.
   - Side, verified/unverified badge, opened date.
   - Entry, stop, target, current quote.
   - Distance to entry, stop, and target.
   - AI or fallback update text.
   - Empty state when there are no open ideas.

4. Published signals
   - Keep the existing signals table, optionally enriched with current quote or distance.

5. Key risks and What to monitor
   - Two responsive bullet cards.

6. Data notes
   - Visible caveat that no news feed is connected and any missing quote or level notes.

Old stored briefs should render through normalization. If sections are absent, regenerate on read or show the legacy narrative safely.

## Tests

Extend test/briefing.test.ts with:
- Watchlist row construction, including high/low, missing bars, and quote fallback.
- Journal idea selection, prioritization, and level-distance math.
- Signal row expansion and distance math.
- Focus-session defaults, validation, open/closed states, and next-change labels.
- Prompt contains the JSON contract, focus sessions, journal ideas, no-news caveat, and no em dash.
- Parser accepts valid and fenced JSON.
- Parser drops unknown symbols and fills missing watchlist or journal notes.
- Parser falls back on malformed JSON.
- Em dash normalization and field length caps.
- Deterministic fallback sections with and without AI data.
- Legacy snapshot normalization and stale-version detection.
- Preference save normalization and at-least-one-session rule.

Add or update journal tests for briefing invalidation after open-entry mutations.

## Verification
- `pnpm test`
- `pnpm build`
- `git diff --check`
- Manually confirm:
  - Five requested sections render.
  - No headlines or levels are fabricated.
  - Focus preference persists and rebuilds the brief.
  - Open journal ideas show plan levels and current-price relationships.
  - AI failure still produces a structured deterministic briefing.
  - Old stored briefs do not crash the page.

## Out of Scope
- RSS, news APIs, or manual headline entry.
- Paper positions in open ideas.
- Technical support/resistance levels.
- Economic calendar events.
- Notifications or webhooks for briefing updates.

## Suggested Implementation Order
1. Types, session helper, builders, fallback sections.
2. Prompt and structured parser.
3. Snapshot gathering and service integration.
4. Persistence, preferences, invalidation.
5. API routes and frontend types.
6. Briefing page UI.
7. Tests, docs, full verification.
