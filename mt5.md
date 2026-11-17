# MT5 support plan

## Goal

Add MT5 as a broker option in phases, without destabilising the current cTrader implementation. The first phase is a provider-neutral adapter seam. Phase 1 uses a self-hosted terminal bridge for read-only data; a cloud API can replace the transport behind the same adapter later.

## Scope decisions

- Full support is the long-term goal.
- The adapter contract comes first.
- Existing cTrader routes and behaviour stay intact during Phase 0.
- MT5 logins and server names are never treated as cTrader `ctid` values.
- Shared public market data must never use or refresh a visitor's broker credentials.
- Secrets stay server side, encrypted through the integration registry where applicable.
- No em dashes. No commit or deploy without explicit approval.

## Current pause note - 2026-11-17

MT5 work is paused after Phase 2. Phases 0, 1 and 2 are complete and committed. The shipped implementation is still read-only and still expects an external HTTP bridge. Do not describe MT5 as one-click, self-contained or fully productized yet.

### What exists now

- Provider-neutral broker adapter seam.
- MT5 integration registry fields and admin UI.
- MT5 market provider wiring and paper lot specs.
- Encrypted per-user MT5 accounts with UUID account ids.
- Namespaced `/api/mt5/accounts` management and read routes.
- Read-only positions, orders, history, symbols and quote through a bridge.
- MT5 journal import, user export and admin health.
- Tests cover config parsing, payload parsers, credential headers, encrypted account storage, adapter reads, export and admin cleanup.
- Live database, real bridge and real broker behavior have not been validated.

### Current bridge contract

The current implementation in `src/server/mt5/bridge.ts` calls these endpoints:

- `/health`
- `/symbols`
- `/quote`
- `/candles`
- `/positions`
- `/orders`
- `/history`

Every request appends `account=<bridge account id>`. Per-user requests also send `X-MT5-Login`, `X-MT5-Server`, `X-MT5-Mode`, `X-MT5-Password` and `X-MT5-Investor-Password`.

No bridge daemon ships in this repo. The repo contains only the HTTP client. Tests stub `fetch`; they do not prove a real bridge works.

### Decisions made while paused

- Python venv is accepted for a future managed runtime.
- Official MT5 or Wine installer launch from the admin panel is accepted.
- On Windows, the managed helper can use native Python plus `MetaTrader5`.
- On Linux, the managed helper must use Windows Python inside Wine plus `MetaTrader5`, because the official package has Windows-only wheels.
- Buyer/admin may still need the MT5 terminal installed once, but the admin panel should automate the installer, runtime preparation and status checks.
- One MT5 terminal can only hold one logged-in account. A single shared terminal is unsafe for concurrent multi-user account access.
- True multi-user MT5 needs a per-account worker pool: one terminal process or terminal profile per active MT5 account.
- Docker can be supported, but not inside the current Node app container. It needs a product-managed `mt5-runtime` service with Wine, Windows Python, Xvfb and persistent terminal state.
- Hosted/cloud MT5 API remains the fallback for very large installs where terminal pools become too heavy.

### Why paused

The external bridge model is technically complete but not product-ready for a buyer who expects everything to work from `/admin/integrations`. Making it product-ready means adding a managed runtime, per-account worker pool, installer automation, Docker runtime support and then MT5 write parity. That is a separate phase.

### Pickup checklist

1. Ask for expected maximum concurrent MT5 accounts per install.
2. Choose the first target tier:
   - 1 to 5 accounts: serialized single-terminal mode is simplest.
   - 5 to 20 accounts: per-account native or Wine worker pool.
   - 20+ accounts: Docker worker pool or hosted/cloud MT5 API.
3. Add a transport abstraction around `src/server/mt5/bridge.ts`:
   - `managed`
   - `external`
   - `cloud`
4. Build the bundled Python helper, likely `bridge/mt5_bridge.py`.
5. Build the per-account worker pool with locks, lazy start, idle timeout and health restart.
6. Extend `/admin/integrations` with runtime preparation, installer launch, status and recovery views.
7. Add Docker `mt5-runtime` support only after the host mode works.
8. Implement MT5 write parity only after live demo reads are stable.
9. Update README and setup docs before advertising MT5 as a buyer-facing feature.

## Phase 0 - Broker adapter seam - done

- Add `src/server/broker/` with provider-neutral adapter types.
- Cover accounts, symbols, specs, quotes, bars, history, reconcile, and the order lifecycle in the contract.
- Add a cTrader adapter that delegates to the existing cTrader modules without changing behaviour.
- Keep `/api/accounts/:ctid/*` untouched.
- Add adapter contract tests using a fake MT5 adapter.

## Phase 1 - MT5 read-only foundation - done

- Add `mt5` to the integration registry, admin integrations UI, and `.env.example`.
- Define the self-hosted bridge contract: `/health`, `/symbols`, `/quote` and `/candles` with an optional bearer token.
- Add MT5 market provider wiring in the market provider registry, persistence keys, catalog, and shared account resolution.
- Generalize paper trading lot specs so they come from the configured broker adapter instead of cTrader directly.
- Keep the paper trading USD/Lots UI. Lots stays disabled when the active provider has no spec for the symbol.

## Phase 2 - Per-user MT5 accounts, read-only - done

- Added an `Mt5Account` store with UUID account ids. Login, server, password and investor password are encrypted with `INTEGRATIONS_ENCRYPTION_KEY` and AES-GCM AAD bound to user, account and field.
- Extended the bridge with read-only `/positions`, `/orders` and `/history?days=` endpoints. Per-user calls send credentials in `X-MT5-*` headers; the `account` query value stays the MT5 account id.
- Added authenticated `/api/mt5/accounts` management and `/api/mt5/accounts/:id/{positions,orders,history,symbols,quote}` read routes. cTrader routes remain unchanged.
- Added additive `brokerAccounts` to `/api/me` and `/api/accounts`, keeping the legacy numeric `ctid` account shape intact.
- Added MT5 connection and management controls to Trading, Today, Settings and Connect. MT5 appears as read-only alongside cTrader; positions, pending orders and history are shown through the bridge without enabling writes.
- Added MT5 closed-deal import to the journal with `source: "mt5"` and string external ids. Existing cTrader deal ids and unique constraints remain intact.
- Added MT5 data to the user export at version 5 and MT5 account health to the admin dashboard and status checks.
- Admin cleanup removes encrypted MT5 accounts when a user is deleted.

## Phase 3 - MT5 trading parity - not started

- Implement adapter writes: preview, place, modify, cancel, close, and amend SL/TP.
- Normalise lot sizes, volume steps, price digits, order types, expiry, fill rules, event correlation, and timeout behaviour.
- Use per-account operation locks like the current cTrader execution path.
- Add mapping tests for every order action and failure mode.

## Phase 4 - Polish and rollout - not started

- Update README, `docs/MT5_SETUP.md`, admin setup checklist and verification notes.
- Extend tests for registry, setup, export, admin cleanup and UI labels.
- Verify live reads and a small demo order for each broker before enabling MT5 trading for users.

## Phase 5 - Productized managed runtime - parked

- See the current pause note above for the full handoff.
- Replace externally built bridge setup with a product-managed runtime.
- Use Python venv on Windows and Windows Python inside Wine on Linux.
- Allow the admin panel to launch the official installer, prepare the runtime, report status and expose recovery views.
- Add a per-account worker pool before claiming multi-user support.
- Add a dedicated Docker `mt5-runtime` service after host mode works.
- Keep cloud or hosted MT5 API as the scale fallback.

## Decision gate

- Chosen for Phase 1: self-hosted MT5 terminal bridge. It keeps credentials and the terminal on the operator's machine, and the window into broker data stays read-only.
- A cloud MT5 API remains an option for a later transport swap behind `BrokerAdapter`.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`
- Scan for em dashes
- No commit or deploy without explicit approval
