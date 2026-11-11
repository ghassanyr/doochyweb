# Deploying Doochy Learn

This document records the verified deploy state. It does **not** edit DNS, nginx or
certificates, publish a batch, or restart pm2. Those remain approval-gated actions after
human curation.

## Topology

`learn.doochy.net` uses the same Express app and pm2 process as `doochy.net`:

```text
browser -> nginx :443 -> 127.0.0.1:9111 (doochyweb) -> API + webapp/dist
```

There is no second Node process, database or build. The SPA uses canonical paths:
`/` is the public home page, `/analysis` is the default workspace, `/learn` opens the
trainer, and `/breakouts?note=<id>` keeps shared notes on Breakouts. Legacy `?view=` and
bare `?note=` links redirect once.

## Verified state (2026-11-09)

- The existing origin certificate covers **both** `doochy.net` and `learn.doochy.net`.
- The active nginx server blocks live in `/etc/nginx/sites-enabled/default`.
- Do **not** move those blocks into a new site file or create a duplicate
  `learn.doochy.net` server block.
- Cloudflare **Automatic** SSL/TLS works with this origin certificate.
- `learn.doochy.net` is served by the same pm2 process as `doochy.net`.
- No DNS, nginx, certificate or pm2 change was made for the trainer preview/docs work.
- `v1` was published on 2026-11-10 with 50 items; publishing was a data/Mongo action, not a
  code deploy. No pm2 restart was performed.

Verify the certificate and active nginx configuration before any future deploy:

```bash
sudo openssl x509 -in /etc/letsencrypt/live/doochy.net/fullchain.pem \
  -noout -subject -ext subjectAltName
sudo nginx -T
```

Expected certificate output includes both names:

```text
DNS:doochy.net, DNS:learn.doochy.net
```

If that output is missing `learn.doochy.net`, stop and get approval before running certbot.
Do not replace the certificate or rewrite nginx to work around a stale local command output.

## Cloudflare

- With the record proxied, **Automatic** SSL/TLS is sufficient because the origin certificate
  covers both hostnames.
- **Full (strict)** is also valid when the origin certificate check above includes both names.
- Grey-cloud/DNS-only is only needed for an HTTP-01 certificate challenge. It is not part of
  the current operating setup.
- Do not switch to Full (strict) or reissue a certificate without verifying the SAN first.

## nginx

The current configuration is in `/etc/nginx/sites-enabled/default`. Keep it there.

- Do not move the file, split the server blocks, or add a second `learn.doochy.net` block.
- Do not edit nginx as part of preview or documentation work.
- If a future approved change is required, back up the current file first, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Never reload nginx when `nginx -t` fails. The app listens on `127.0.0.1:${PORT}` (`9111` by
default) and must stay behind nginx.

## pm2 and runtime changes

No pm2 restart is needed for preview HTML, CSV, documentation, DNS, nginx or certificate
changes. No restart was performed for this revision.

`/api/trainer/batch` is already live and returns `503 {"error":"no batch published"}` until a
batch is published; that is the expected state. Restart pm2 only when runtime server code
changes and the deploy is approved:

```bash
pnpm build
ls -l dist/server/index.js webapp/dist/index.html
sudo -u san pm2 restart doochyweb
sudo -u san pm2 status
```

The build runs typecheck, tests and the Vite production build. Check logs if the restart
fails:

```bash
sudo -u san pm2 logs doochyweb --lines 100
```

## Verification

After an approved deploy:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://learn.doochy.net/
curl -sS https://learn.doochy.net/api/trainer/batch
curl -sS https://doochy.net/api/trainer/batch
```

Expected:

- `/` returns `200` and serves the SPA.
- `/api/trainer/batch` returns `503 {"error":"no batch published"}` until `v1` is published.
  `v1` was published on 2026-11-10, so the current API returns `200` with `itemCount=50`.
- After a published batch, both hosts return the same batch metadata.
- Opening `https://doochy.net/` shows the public home page; the logo also links home.
- Opening `https://doochy.net/learn` selects the Learn tab without signing in.
- Legacy `https://doochy.net/?view=learn` redirects to `/learn`.
- Opening `https://doochy.net/breakouts?note=<id>` opens Breakouts; legacy bare `?note=` links redirect there.
- Signing in and the Trading tab are unaffected.

Do not use the production hosts for publish or answer/reveal tests until a pilot batch is
approved; use the existing route/payload tests and local dry runs instead.

## Rollback

If the Learn deploy must be withdrawn:

1. Restore the last approved nginx configuration from backup.
2. Run `sudo nginx -t && sudo systemctl reload nginx`.
3. Leave DNS and the shared certificate unchanged unless a separate approved change requires
   otherwise.
4. If the app build is faulty, redeploy the last approved commit, run `pnpm build`, then
   restart pm2 with approval.
5. If the batch is faulty, follow the publish rollback procedure in
   [`TRAINER.md`](./TRAINER.md#rollback).

No rollback step deletes review or bar data.

## Operational notes

- The Learn UI and `/api/trainer` are public; the existing account APIs keep their auth.
- The trainer client never sends an Authorization header.
- No new environment variables are required for deploy. `TRAINER_ITEM_SECRET` is optional and
  recommended if stable public item ids across restarts are desired.
- The Express SPA fallback serves `webapp/dist/index.html`; nginx must proxy all paths,
  including `/api/trainer`, to `127.0.0.1:9111`.
- No CORS changes are needed because the SPA and API share the same origin.
