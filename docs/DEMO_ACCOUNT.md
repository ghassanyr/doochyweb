# Demo account

The demo account gives new visitors a shared, read-only workspace with fixed sample data. It is meant for evaluation and screenshots, not for live trading or personal data.

## Entry

Visitors can enter from the header, sidebar, sign-in modal, or a sign-in prompt by pressing the configured demo label. The default label is `Try demo`.

The browser calls `POST /api/demo/enter`. The server checks `settings.demo.enabled`, seeds the shared demo user if needed, and returns a short-lived demo JWT. The web app stores that token in the same `localStorage` key as a normal session and removes it on `Exit demo`.

The setting is under **Admin → Site settings → Demo access**. Admin health is under **Admin → Demo account**, with seed version, reset count, last seed time, and a reset action.

## Session model

- One shared user named `doochy-demo`, with `accountType: "demo"` and `role: "user"`.
- The user has no password, email, cTrader credentials, MT5 accounts, alerts, journal rows, paper positions, or briefings.
- The account is seeded on first use and on server boot if missing. Boot failures are warnings only.
- Demo JWTs are purpose-tagged and expire after 2 hours. Normal JWTs last 7 days.
- `sessionFromRequest()` rejects a demo user with a normal token and a normal user with a demo token.
- `adminRequired()` rejects demo sessions even if a role is ever set.
- `demoWriteGuard()` rejects every demo `POST`, `PUT`, `PATCH` and `DELETE` under `/api` with `403 demo account is read-only`. `GET`, `HEAD` and `OPTIONS` pass.
- Resetting the demo account bumps `tokenVersion`, which invalidates every existing demo token.

## Sample data

The fixtures are fixed in code and shared by all demo visitors:

- 7 open positions, 3 pending orders, and a fixed quote set.
- 4 alerts with active, triggered and paused states.
- 15 journal rows: 12 closed trades and 3 open ideas.
- 1 daily briefing snapshot with the open ideas.
- 1 weekly coach report, 12 trade list rows, and 3 detailed trade reviews.

cTrader history uses the closed journal rows. The demo CTID is `900001`. No fixture comes from a broker or from a real user account.

## Commands

```bash
pnpm demo:seed     # create or repair the shared demo user
pnpm demo:reset    # bump tokenVersion and increment the reset counter
pnpm demo:status   # print seed status
```

All three commands need the normal `.env` database connection.

## Limitations

- Demo mode is read-only. The server is authoritative; the UI hides Settings and shows a banner, but the API guard is what prevents writes.
- Visitor actions never create personal data. Demo visits are not counted and demo sessions are not stored.
- Reset affects every visitor at once.
- The demo does not prove that a visitor's broker, AI provider, SMTP, Telegram, or MT5 bridge works.
- A reset invalidates open demo links immediately. Visitors must press the demo entry button again.
