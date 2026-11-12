# Doochy: Phase 1 project plan & build brief

Status: plan approved, awaiting build. Reference implementation for all cTrader
Open API protocol details: the `doochy` repository on this machine
(`/home/san/doochy`). Build the new app as a **separate sibling project** at
`/home/san/doochyweb` (own package, own git repo). It shares protocol knowledge
with `doochy`, but is **not wired into doochybot**; Doochy is a manual
management view, DoochyBot stays fully automated.

## 1. Purpose

A single web dashboard for managing several cTrader trading accounts from a
browser, without juggling a mobile app per account. User enters their cTrader
Open API app credentials once; the app discovers every account under that grant
(demo and live together) and shows their open positions and pending orders.

- **Explicitly not automated.** No auto-orders, no risk engine, no copy-trading,
  no connection to doochybot's settings. All actions are read-only/manual.
- **Phase 1 scope (this build):** credentials entry → account discovery →
  two read-only tabs (Orders, Open Positions) for every account. Balanced
  display via `ProtoOATraderReq` is an optional nicety.
- **Phase 2+ (NOT this build):** deals/history, equity graph, live quote
  streaming, embedded cTrader `market-chart` widget, manual order placement,
  bulk multi-account views.

## 2. Locked-in decisions (from planning)

- **Dual demo/live, no toggle.** Each account self-classifies (`isLive`) from the
  account-list call; Doochy routes it to the correct host automatically. One
  credential set exposes all accounts of the cTrader ID.
- **Database:** `pnpm doochy:setup` can start the bundled `mongo:7.0` container with
  `docker compose up -d`, or connect to an existing MongoDB. Doochy uses its
  **own database**, name `doochy`. Connection via `MONGO_URI` + `MONGO_DB` env
  vars. The bundled container publishes `127.0.0.1:27017` only and runs without
  authentication. Revisit that before exposing the host or sharing the server.
- **User management:** open self-registration (username + password, bcrypt,
  JWT). Temporary, minimal hardening. Do **not** log secrets/tokens anywhere.
- **Domain:** `doochy.net` (not yet owned, being purchased). Deploy/nginx step
  treats it as the eventual hostname; development happens on
  `http://127.0.0.1:9111` until the domain is live.

## 3. Layout & stack

```
/home/san/doochyweb/
  package.json            # own workspace, pnpm
  tsconfig.json
  .env                    # PORT, MONGO_URI, MONGO_DB, JWT_SECRET
  src/
    server/
      index.ts            # express: REST api + serve webapp/dist
      db.ts               # mongoose connect (models: users, credentials)
      auth.ts             # register / login / JWT middleware
      ctrader/
        connection.ts     # per-user per-env socket pool (see §5.5)
        auth.ts           # app auth + account-list + refresh (§5)
        reads.ts          # reconcile → positions/orders, symbol resolution (§5.4)
    webapp/               # React + Vite + TS SPA (build output served by express)
      src/
        App.tsx           # login/onboarding → dashboard
        Dashboard.tsx     # account selector + tabs
        PositionsTab.tsx
        OrdersTab.tsx
        api.ts
```

- **Backend:** Node + TypeScript + Express on `127.0.0.1:9111` (port confirmed
  free). `dotenv`, `mongoose`, `bcrypt`, `jsonwebtoken`.
- **cTrader protocol:** reuse npm package **`@reiryoku/ctrader-layer`**, the
  exact package doochy depends on. It does protobuf serialization + WebSocket;
  `new CTraderConnection({ host, port })`, `await connection.open()`,
  `connection.sendCommand("ProtoXxxReq", {...})`, `connection.sendHeartbeat()`,
  `connection.on("ProtoOAExecutionEvent", ...)`. Installing this is most of the
  hard protocol work done; do not write raw protobuf/WebSocket handling.
- **Frontend:** React + Vite + TS, dark theme, single page, two tabs + a global
  account switcher. Same Express process serves the built SPA.
- **Process:** pm2 app `doochyweb`; nginx reverse-proxy block to `:9111`
  (added when the domain is owned).

## 4. cTrader Open API: endpoints & message spec

> All fields the builder needs are lifted from doochy's working code; reference
> those files rather than re-researching the Open API docs.

### 4.1 Environments (confirmed against official docs)

| Environment | Protobuf endpoint |
| --- | --- |
| Demo | `demo.ctraderapi.com:5035` |
| Live | `live.ctraderapi.com:5035` |

- Port **5035 for both** (5036 is the JSON variant, irrelevant here).
- Demo and live are **fully separated**: operations on one environment cannot
  go over the other's connection. At most **two** connections are ever needed
  (one demo, one live); each supports any number of accounts of its type.
- The account-**list** call can be made on the demo endpoint and answers for
  live accounts too (each entry carries its own `isLive`). This is what enables
  "one connect, see everything, no toggle". See `scripts/setup.ts:79-103`.

### 4.2 Auth + account discovery (copy `src/ctrader/lifecycle.ts`, `scripts/setup.ts`)

1. **User-entered credentials** (dashboard form):
   `CLIENT_ID`, `CLIENT_SECRET`, `ACCESS_TOKEN`, `REFRESH_TOKEN`
   (from the Open API app portal, `openapi.ctrader.com/apps`:
   see the exact instructions text in `scripts/setup.ts:112-120`).
2. Connect: `new CTraderConnection({ host: "demo.ctraderapi.com", port: 5035 })`,
   `await connection.open()`. Wrap in a timeout (doochy uses ~15s).
3. `sendCommand("ProtoOAApplicationAuthReq", { clientId, clientSecret })`.
4. `sendCommand("ProtoOAGetAccountListByAccessTokenReq", { accessToken })`
   → `ctidTraderAccount[]`. Each:
   - `ctidTraderAccountId` (int64, arrives as **string** → `Number()`)
   - `traderLogin` (the 7-digit UI login, for display, NOT an identifier)
   - `brokerName`, `isLive` (boolean or `"true"` string, test both)
5. **Routing:** for each account, `host = acc.isLive ? "live.ctraderapi.com" :
   "demo.ctraderapi.com"`, port 5035. Emit the account list grouped/tagged
   demo vs live in the UI.
6. Before reading anything on an account:
   `sendCommand("ProtoOAAccountAuthReq", { ctidTraderAccountId, accessToken })`
   on the connection for that account's environment.

### 4.3 Token refresh: single-use rotation (copy `src/ctrader/token.ts`)

- `sendCommand("ProtoOARefreshTokenReq", { refreshToken })`
  → `{ accessToken, refreshToken, expiresIn }`.
- **Refresh tokens are single-use and ROTATE.** Persist the rotated pair back
  to Mongo on every refresh, or the next login breaks when the old refresh
  token dies. (doochy writes the new pair to `.env`; Doochy writes to the
  user's credentials doc.)
- Trigger refresh on token error codes:
  `CH_ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`, `OA_AUTH_TOKEN_EXPIRED`,
  `CH_EXPIRED_ACCESS_TOKEN`, `INVALID_REQUEST` (copy doochy's `TOKEN_ERROR_CODES`,
  `src/ctrader/lifecycle.ts:36-42`), then retry once.

### 4.4 Positions + orders: one call each (`ProtoOAReconcileReq`)

`sendCommand("ProtoOAReconcileReq", { ctidTraderAccountId })` returns both:

- `res.position[]`, open positions:
  - `positionId`
  - `tradeData.{ symbolId, volume, tradeSide }` (`tradeSide`: `"BUY"`/`"SELL"`)
  - `price`, `stopLoss`, `takeProfit`, `commission`, `swap`
- `res.order[]`, resting (pending) orders:
  - `orderId`
  - `orderType` (`"LIMIT"` / `"STOP"` / `"STOP_LOSS_TAKE_PROFIT"`)
  - `tradeData.{ symbolId, volume, tradeSide }`
  - `limitPrice` (LIMIT) or `stopPrice` (STOP)
  - `stopLoss`, `takeProfit`, `expirationTimestamp` (0/absent = GTC)

Field-usage references: `src/ctrader/orders.ts` (reconcile at ~:174, pending
orders read + `limitPrice`/`stopPrice` at ~:272-310), and the position reading
in `src/copytrade/sourceWatcher.ts`.

Shared rules:
- int64 ids/timestamps arrive as **strings**, always `Number()`.
- Money scaling: integer fields scaled by `10^moneyDigits` (`moneyDigits ?? 2`)
  See `src/ctrader/account.ts`; optional, only needed if showing balance.

### 4.5 Symbol resolution (names, lot size): copy `src/ctrader/orders.ts:464`, `src/ctrader/symbols.ts`

`symbolId` is broker-local per account. To display names:

- `sendCommand("ProtoOASymbolByIdReq", { ctidTraderAccountId, symbolId: [id] })`
  → `symbol[].{ name, lotSize, digits }`. Cache per account (the map is static
  per account; fetch once per session and reuse).

**Volume display:** `tradeData.volume` is broker volume units. Displayed lots =
`volume / lotSize` (e.g. FX lotSize = 100000 → volume 1000 = 0.01 lots).

### 4.6 Live updates (optional Phase 1)

After account auth, `connection.on("ProtoOAExecutionEvent", ...)` streams
fill/position events. Simplest Phase-1 approach: poll `ProtoOAReconcileReq`
every ~5-10s per selected account and diff. Not required for the read-only tabs
to be useful.

### 4.7 Connection hygiene (do NOT skip)

- **Never** open a socket per HTTP request; connects are slow. Keep a
  per-user, per-environment socket pool in memory (user → { demo?, live? }).
- Only two connections max per user (one per env), each authed with the same
  app credentials; account scoping is per `ProtoOAAccountAuthReq` on the socket.
- Reconnect with backoff; re-auth after reconnect (app auth → account auth).
- Configure heartbeat ~10s (`connection.sendHeartbeat()`) to keep the channel
  alive (official docs recommend heartbeating every 10s; doochy does ~10s).
- Enforce rate limits on your side: the proxies throttle at 50 req/s/app and
  25 concurrent connections. A poll loop across a few accounts is nowhere near
  this; still, guard against request storms (single-flight per account).
- Send messages on a queue to avoid concurrent sends on the same socket.

## 5. Backend API (Phase 1)

```
POST /api/auth/register              { username, password }
POST /api/auth/login                 → JWT (Authorization header)
GET  /api/me                         → { hasCredentials, accounts }
PUT  /api/credentials                { clientId, clientSecret, accessToken, refreshToken }
POST /api/connect                    validate creds → persist to Mongo → { accounts }
GET  /api/accounts                   → [{ ctid, login, broker, isLive, balance?, currency? }]
GET  /api/accounts/:ctid/positions   → mapped reconcile rows (positions)
GET  /api/accounts/:ctid/orders      → mapped reconcile rows (pending orders)
```

- `/api/connect` is the only heavy endpoint: app-auth + account-list on the
  demo host, classify accounts, persist credentials doc, warm the socket pool.
- `/api/me` returns accounts from Mongo (fast, cached after connect).
- Balance (optional): `ProtoOATraderReq { ctidTraderAccountId }` →
  `trader.balance` / `10^moneyDigits`, per account on connect or on request.

## 6. Data model (Mongo, db `doochy`)

```
users        { username (unique), passwordHash (bcrypt), createdAt }
credentials  { userId, clientId, clientSecret, accessToken, refreshToken,
               updatedAt }             # stored together intentionally
```

- One open socket per user per env in server memory (pool keyed by userId+env).
- JWT payload: `userId`; an `auth` middleware guards all `/api/*` except
  register/login.
- Plaintext secrets accepted for now (explicitly temporary), add a code comment
  that next iteration should encrypt `accessToken`/`refreshToken`/`clientSecret`
  at rest. Never write tokens to logs.

## 7. Frontend (Phase 1)

- **Register / Login** screens (open self-registration).
- **Onboarding:** "Connect cTrader" form with the 4 credential fields →
  `POST /api/connect` → account list (demo vs live tagged).
- **Dashboard:** global account selector across all accounts; two tabs:
  - **Positions**: symbol, side, lots, entry, SL, TP, swap/commission, id.
  - **Orders**: symbol, side, type (limit/stop), resting level, lots, SL, TP,
    expiry (GTC vs dated).
- Manual refresh button + auto-poll of the selected account.
- Dark theme; state in plain React (no heavy state lib needed for Phase 1).

## 8. Deploy / run

1. Scaffold the repo per §3; `pnpm install`.
2. `pnpm doochy:setup` starts MongoDB with Docker (or connects to an existing one),
   generates the secrets, writes `.env`, and can create the first admin.
3. `pnpm build` (tsc + vite) → `dist/server/index.js` serving `webapp/dist`.
4. Smoke test locally on `127.0.0.1:9111`: register → connect credentials →
   accounts appear → tabs populate for both a demo and a live account.
5. `pm2 start ecosystem.config.cjs` (process name `doochyweb`, listens on
   127.0.0.1:9111). The config uses its own directory, so it is not tied to one
   machine's path.
6. When `doochy.net` is owned: DNS + nginx `server` block
   (`server_name doochy.net; location / { proxy_pass http://127.0.0.1:9111; }`)
   + `certbot --nginx -d doochy.net`. Certbot is already in use on this box.

Notes: `pm2` currently runs `hub`, `feed-server`, `source-node`; add `doochyweb`
without disturbing them. nginx config lives in `/etc/nginx/sites-enabled/default`.

## 9. Builder verification checklist

- [ ] `pnpm typecheck` clean (covers `tsconfig.server.json` AND `src/webapp/tsconfig.json`); `pnpm build` succeeds.
- [ ] No secrets in logs or git history.
- [ ] Register + login work; `POST /api/connect` with real credentials returns
      ALL accounts (demo + live tagged), which proves `isLive` routing.
- [ ] Positions and Orders tabs render reconcilable data for at least one live
      and one demo account (both exist in the current grant).
- [ ] Refresh-token rotation: after `/api/connect`, the credentials doc in Mongo
      holds the rotated pair; a subsequent reconnect still works with the stored
      token.
- [ ] Serverside restart mid-session does not require re-entering credentials.
- [ ] Poll loop never opens more than two sockets per user total.

## 10. Phase 2: manual order management (create / modify / close)

Agreed direction (folded in 2026-09-14). This app already reads everything it
needs (per-user per-env sockets with account re-auth + token rotation, cacheable
symbol specs, a single-flight reconcile); phase 2 turns those read paths into
manual writes. Use doochy **only** as protocol reference; do NOT port its
automation: `/home/san/doochy/src/ctrader/orders.ts`, `amend.ts`,
`risk/midnightClose.ts`, `bot/commands/order.ts`.

### Scope (in) / (out)
- IN: place market/limit/stop orders; move a resting order's level + SL/TP;
  cancel a resting order; close a position; edit a position's SL/TP.
- OUT: no doochy automation, no risk engine, cooldowns, profit caps, signal
  sizing, or auto-anything. Manual management only; say so in UI copy.

### Broker calls (protocol only)
| Op | Command | Correlation |
| --- | --- | --- |
| Market | `ProtoOANewOrderReq { orderType:"MARKET", tradeSide, volume, timeInForce:"IMMEDIATE_OR_CANCEL", label }` | label → accept/fill on `ProtoOAExecutionEvent` |
| Limit/Stop | same req, `LIMIT`/`STOP`, `limitPrice`/`stopPrice`, `GOOD_TILL_CANCEL` (or `expirationTimestamp`), SL/TP attached | label |
| Amend order | `ProtoOAAmendOrderReq { orderId, volume, limitPrice\|stopPrice, stopLoss?, takeProfit?, expirationTimestamp? }` | `clientMsgId`; confirm = `ORDER_REPLACED`, reject = `ProtoOAOrderErrorEvent` |
| Cancel order | `ProtoOACancelOrderReq { orderId }` | - |
| Close position | `ProtoOAClosePositionReq { positionId, volume }` | - |
| Position SL/TP | `ProtoOAAmendPositionSLTPReq { positionId, stopLoss?, takeProfit? }`, amend **replaces** both sides, resend both | `clientMsgId` |

There are **no synchronous responses**: every op resolves async via execution
events with a timeout (doochy: 10s rest-ack, 30s market-fill, 5s amend). One
shared `waitForOrderOutcome(msgId/label)` helper on `ProtoOAExecutionEvent` +
`ProtoOAOrderErrorEvent`; order-error events echo `clientMsgId`.

### Server: new `src/server/ctrader/execute.ts`
`placeOrder / amendOrder / cancelOrder / closePosition / amendPositionSLTP`,
each returning `{ ok, error?, description? }`. Routes (all `authRequired`, all
re-verify the ctid belongs to the user like index.ts:169-174):
```
POST   /api/accounts/:ctid/orders                  { orderType, side, lots, price?, sl?, tp?, expiration? }
PATCH  /api/accounts/:ctid/orders/:orderId         { price?, sl?, tp? }   (omit/null = keep)
POST   /api/accounts/:ctid/orders/:orderId/cancel
POST   /api/accounts/:ctid/positions/:positionId/close
PATCH  /api/accounts/:ctid/positions/:positionId   { sl?, tp? }
```
Validation (server-authoritative; mirror doochy but REJECT, don't silently
drop): BUY `SL < entry < TP`, SELL `TP < entry < SL`; volume snapped to the
symbol grid (`minVolume`/`stepVolume`/`maxVolume`, extend the `reads.ts` spec
cache which currently lacks these); price rounded to symbol `digits`; only
entry (`LIMIT`/`STOP`) orders are cancellable/amendable. At-most-once per-account
op latch so a double-click can't double-submit; errors surfaced as
`errorCode + description`.

### Frontend
- New-order panel akin to doochy `Trade.tsx` (symbol picker, BUY/SELL,
  MARKET/LIMIT/STOP, lots, SL, TP, confirm modal) in the dark theme; only for a
  single selected account, disabled in Combined mode.
- Row actions: Positions → Close / edit SL+TP; Orders → Cancel / edit level ±
  SL/TP, with confirm modal / inline form.
- After any write, trigger that account's reconcile so the table reflects broker
  truth within the existing 8s poll (reconcile is already single-flight).
- Optional: risk/reward preview like doochy `orderPreview` (orders.ts:534);
  cheap in-memory audit log (last 20 order actions per user).

### Verify
Place MARKET/LIMIT/STOP + cancel each + close + both-side SL/TP amends on a
demo account; wrong-side SL/TP rejected clearly; off-grid lots snapped; GTD
expiry; double-submit guarded; restart mid-order still reconciles. All green
through `pnpm typecheck` + `pnpm build`.

## 11. Later roadmap (not this build)

Deals/history (ProtoOADealListReq), equity graph, live quotes
(ProtoOASubscribeSpotsReq, see `src/ctrader/livePrices.ts`), embedded cTrader
`market-chart` widget (view-only embed works without a login; changing symbol =
re-running `runPlugin` with a new route; it cannot overlay your own
entries/SL/TP), encrypted-at-rest credentials.