# MT5 setup, current state

Status: 2026-11-17. This document describes the current shipped behavior. MT5 is read-only and requires an external HTTP bridge. No bridge daemon ships in this repo.

MT5 productization is parked. See `mt5.md` for the full handoff and pickup checklist.

## Current architecture

```text
browser
  -> Doochy server
    -> MT5 bridge client in `src/server/mt5/bridge.ts`
      -> operator-supplied HTTP bridge
        -> MT5 terminal or broker-specific adapter
```

The bridge is responsible for talking to the MT5 terminal. Doochy only calls the HTTP contract below. Tests stub `fetch`; they do not validate a real bridge or a real broker connection.

## Admin setup

MT5 is configured under **Admin -> Integrations**.

| Field | Required | Purpose |
| --- | --- | --- |
| `bridgeUrl` | Yes | Base URL of the operator-supplied bridge, for example `http://127.0.0.1:8000`. |
| `apiKey` | No | Optional bearer token sent as `Authorization: Bearer <apiKey>`. Strongly recommended for non-loopback bridges. |
| `accountId` | Yes | Bridge-side account or profile label used for shared market data, for example `market-demo`. This is not an MT5 login and not a cTrader `ctid`. |
| `mode` | No | `demo` or `live`. Defaults to `demo`. |
| `enabled` | No | Gates shared market-data use. MT5 can show Ready while disabled. |

Admin values override environment variables and defaults. Secrets saved in the admin panel are encrypted with `INTEGRATIONS_ENCRYPTION_KEY`. Rotating that key makes stored integration secrets unreadable; re-enter them after rotation.

**Check config** calls `/health` and `/symbols`. It proves configuration shape and reachability only. It does not validate quotes, candles, history, per-user positions, broker credentials or trade execution.

## User setup

End users add their own MT5 accounts under **Connect** or **Settings**:

- login
- server
- password
- investor password
- mode
- nickname

Per-user credentials are stored in separate `Mt5Account` documents. Login, server, password and investor password are encrypted with AES-GCM using `INTEGRATIONS_ENCRYPTION_KEY` and AAD bound to user, account and field. Prefer investor password for read-only access where the broker supports it.

The browser never receives stored MT5 credentials. Admin health records only `lastOkAt`, `lastError` and `lastErrorAt`.

## Bridge request contract

All requests are HTTP `GET`. The bridge base URL may include a path prefix. Doochy strips trailing slashes, discards query strings on the base URL and always appends `account`.

Shared market-data requests send only the bridge account label. Per-user requests also send the `X-MT5-*` credential headers.

### Headers

```text
Accept: application/json
Authorization: Bearer <apiKey>
X-MT5-Login: <broker account login>
X-MT5-Server: <broker server name>
X-MT5-Mode: demo|live
X-MT5-Password: <master password>
X-MT5-Investor-Password: <investor password>
```

`Authorization` is omitted when `apiKey` is empty. The `X-MT5-*` headers are omitted for shared market-data calls.

### Endpoints

| Endpoint | Extra query | Called for |
| --- | --- | --- |
| `/health` | `account` | Admin config check |
| `/symbols` | `account` | Catalog, symbol resolution, config check |
| `/quote` | `symbol`, `account` | Live quote lookup |
| `/candles` | `symbol`, `timeframe`, optional `from`, `to`, `count`, `account` | Market candles |
| `/positions` | `account` | Open positions |
| `/orders` | `account` | Pending orders |
| `/history` | `days`, `account` | Closed deals and journal import |

`days` is clamped to integers from 1 to 30 and defaults to 7. Doochy uses a 10 second timeout per bridge request. Non-2xx responses and invalid JSON are treated as bridge failures.

## Response shapes

The bridge should return JSON. Collections may be a top-level array or an object with the expected key.

### `/health`

An object is enough. Doochy reads `broker` for the success message.

```json
{ "ok": true, "broker": "BrokerName-Demo" }
```

### `/symbols`

Return `symbols` or a top-level array. Rows may be strings or objects.

```json
{
  "symbols": [
    {
      "symbol": "EURUSD",
      "digits": 5,
      "lotSize": 100000,
      "minVolume": 0.01,
      "stepVolume": 0.01,
      "maxVolume": 100,
      "quoteAsset": "USD"
    }
  ]
}
```

### `/quote`

```json
{ "bid": 1.08421, "ask": 1.08424, "digits": 5, "time": 1760000000000 }
```

`bid` must be numeric. `ask` defaults to `bid`, `digits` defaults to 2 and `time` defaults to server receipt time.

### `/candles`

Return `candles`, `bars` or a top-level array.

```json
{
  "candles": [
    { "time": 1760000000, "open": 1.0841, "high": 1.0845, "low": 1.0839, "close": 1.0843, "volume": 120 }
  ]
}
```

Numeric times below `1e12` are treated as seconds and converted to milliseconds.

### `/positions`

```json
{
  "positions": [
    {
      "id": "123456",
      "symbol": "EURUSD",
      "side": "BUY",
      "lots": 0.1,
      "entryPrice": 1.0841,
      "stopLoss": 1.0800,
      "takeProfit": 1.0900,
      "profitUsd": 12.5,
      "openedAt": 1760000000000
    }
  ]
}
```

Rows require an id, symbol and entry price. Side values beginning with `S` are treated as `SELL`, otherwise `BUY`.

### `/orders`

```json
{
  "orders": [
    {
      "id": "654321",
      "symbol": "EURUSD",
      "side": "BUY",
      "orderType": "LIMIT",
      "price": 1.0800,
      "lots": 0.1,
      "expiresAt": 1760100000000,
      "expirationType": "GTC"
    }
  ]
}
```

Rows require an id, symbol and price.

### `/history`

```json
{
  "history": [
    {
      "id": "900001",
      "orderId": "800001",
      "positionId": "700001",
      "symbol": "EURUSD",
      "side": "BUY",
      "lots": 0.1,
      "entryPrice": 1.0800,
      "exitPrice": 1.0850,
      "grossProfit": 50,
      "swap": -1,
      "commission": -2,
      "closedAt": 1760000000000
    }
  ],
  "truncated": false
}
```

Rows require an id, symbol and closed time. `net` defaults to `grossProfit + swap + commission`. `truncated` is optional.

## Security notes

- Keep the bridge private. Use loopback, a private network, VPN or HTTPS.
- Set `apiKey` for any non-loopback bridge.
- Do not expose a bridge that can execute trades without authentication.
- Do not put MT5 passwords in admin integration fields for shared market data. The shared feed is identified by `accountId`; per-user credentials belong in user MT5 accounts.
- Do not log `X-MT5-*` headers or bridge request bodies.
- MT5 investor password is preferred for read-only access.
- Broker server names must match the broker terminal exactly.

## Current limitations

- MT5 trading is read-only. Preview, place, modify, cancel, close and SL/TP amendment throw in `src/server/broker/mt5.ts`.
- No bridge daemon ships in this repo. The buyer must supply one or use the advanced external bridge mode with an already running service.
- There is no bridge conformance version, capability negotiation or live conformance suite.
- There has been no live database, bridge or broker validation in this pass.
- One MT5 terminal can hold only one logged-in account. Multi-user concurrency is the bridge operator's responsibility in the current design.
- Docker support requires an external bridge. The current Node app container has no Wine, Windows Python, X server or MT5 terminal.

## Planned managed runtime, not shipped

The next MT5 phase should replace externally built bridge setup with a product-managed runtime:

- Python venv on Windows.
- Windows Python inside Wine on Linux, because the official `MetaTrader5` package is Windows-only.
- Admin panel can launch the official installer, prepare the runtime, check status and expose recovery views.
- Per-account worker pool with locks, lazy start, idle timeout and health restart.
- Dedicated Docker `mt5-runtime` service after host mode works.
- Hosted or cloud MT5 API as the scale fallback.

Do not document these items as available until implemented and verified.
