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

## Phase 2 - Per-user MT5 accounts, read-only

- Add encrypted MT5 credential storage and namespaced routes such as `/api/mt5/accounts/:id/{positions,orders,history,symbols,quote}`.
- Show cTrader and MT5 accounts side by side in Trading, Today, Settings, Connect, Journal, user data export, and admin health.
- Keep legacy cTrader routes available while the UI learns the provider-aware account reference.

## Phase 3 - MT5 trading parity

- Implement adapter writes: preview, place, modify, cancel, close, and amend SL/TP.
- Normalise lot sizes, volume steps, price digits, order types, expiry, fill rules, event correlation, and timeout behaviour.
- Use per-account operation locks like the current cTrader execution path.
- Add mapping tests for every order action and failure mode.

## Phase 4 - Polish and rollout

- Update README, update.md, admin setup checklist, and verification notes.
- Extend tests for registry, setup, export, admin cleanup, and UI labels.
- Verify live reads and a small demo order for each broker before enabling MT5 trading for users.

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
