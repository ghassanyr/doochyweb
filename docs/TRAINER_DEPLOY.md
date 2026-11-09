# Deploying Doochy Learn

Phase 7B documents the deploy; it does **not** edit DNS or nginx, obtain certificates,
publish a batch or restart pm2. Those remain approval-gated actions after human curation.

## Topology

`learn.doochy.net` uses the same Express app and pm2 process as `doochy.net`:

```text
browser -> nginx :443 -> 127.0.0.1:9111 (doochyweb) -> API + webapp/dist
```

There is no second Node process, database or build. The SPA chooses the initial tab from the
hostname (`learn.*`) or `?view=learn`; `doochy.net` keeps its existing Analysis default and
shared `?note=` links still open Breakouts.

## Verified certificate state (2026-11-09)

The existing origin certificate is **not valid for `learn.doochy.net`**:

- Origin certificate: `CN=doochy.net`, `SAN DNS:doochy.net` only.
- The default SNI certificate on this host is `CN=doochy.route07.com`.
- Reusing the current origin certificate directly for `learn.doochy.net` will produce a
  hostname mismatch.
- The planned path is to expand the existing `doochy.net` lineage with
  `learn.doochy.net`, then reuse `/etc/letsencrypt/live/doochy.net/*` in the new nginx block.

Check the current certificate before changing anything:

```bash
sudo certbot certificates
sudo openssl x509 -in /etc/letsencrypt/live/doochy.net/fullchain.pem \
  -noout -subject -ext subjectAltName
```

Expected after expansion:

```text
subject=CN = doochy.net
X509v3 Subject Alternative Name:
    DNS:doochy.net, DNS:learn.doochy.net
```

## Prerequisites

- A DNS `A` record for `learn.doochy.net` pointing at this host. Add an `AAAA` record only if
  the host and nginx are configured for IPv6.
- Inbound TCP 80 and 443 open.
- nginx and certbot already installed, as used by `doochy.net`.
- The current app builds and runs on `127.0.0.1:9111`.
- `ecosystem.config.cjs` runs `doochyweb` from `dist/server/index.js` in this repo.
- Do not edit `/etc/nginx/sites-enabled/default`; add a separate site file and symlink it.

Check DNS before touching nginx or requesting a certificate:

```bash
dig +short learn.doochy.net
```

The result must be the public address of this host. If Cloudflare proxying is enabled, turn
the record grey-cloud (DNS-only) for the HTTP-01 challenge, then re-enable the proxy.

## Certificate options

### Option 1: Expand the existing `doochy.net` certificate (recommended)

This keeps one lineage and one renewal job for both hostnames.

1. Add the HTTP-only `learn.doochy.net` nginx server block first so certbot can answer the
   challenge, or confirm an existing HTTP server block serves this hostname.
2. Run the exact expansion command:

```bash
sudo certbot certonly --nginx -d doochy.net -d learn.doochy.net \
  --cert-name doochy.net --expand
```

3. Confirm both names are in the SAN:

```bash
sudo certbot certificates
sudo openssl x509 -in /etc/letsencrypt/live/doochy.net/fullchain.pem \
  -noout -subject -ext subjectAltName
```

4. Use `/etc/letsencrypt/live/doochy.net/fullchain.pem` and `privkey.pem` in the final
   `learn.doochy.net` block below. Existing `doochy.net` blocks can keep the same paths.

`certbot renew` keeps both names because they belong to the same lineage.

### Option 2: Separate certificate for `learn.doochy.net`

Use this if the existing `doochy.net` certificate must not change.

```bash
sudo certbot certonly --nginx -d learn.doochy.net
```

Then use `/etc/letsencrypt/live/learn.doochy.net/fullchain.pem` and `privkey.pem` in the
nginx block. The `doochy.net` certificate stays untouched, but there are two lineages and two
renewal checks.

### Option 3: Cloudflare proxy with “Full” (non-strict), no origin SAN change

This is a fallback, not the recommended origin setup:

- Add a proxied `CNAME` `learn` -> `doochy.net`, or a proxied `A` record pointing at the
  public address.
- Use grey-cloud/DNS-only during the HTTP-01 challenge, then turn the proxy back on.
- Cloudflare Universal SSL covers the edge certificate for `learn.doochy.net`.
- Set SSL/TLS mode to **Full** (non-strict), not **Full (strict)**, because the origin
  certificate does not contain `learn.doochy.net`.
- **Full (strict)** requires the expanded origin certificate from Option 1 or the separate
  certificate from Option 2.
- Direct, grey-cloud HTTPS to the origin will still fail certificate validation unless the
  origin certificate covers `learn.doochy.net`.

## nginx

Create a separate site file. Do not edit `/etc/nginx/sites-enabled/default`.

```bash
sudo tee /etc/nginx/sites-available/learn.doochy.net >/dev/null <<'EOF'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name learn.doochy.net;

    ssl_certificate /etc/letsencrypt/live/doochy.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/doochy.net/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:9111;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name learn.doochy.net;
    return 301 https://$host$request_uri;
}
EOF

sudo ln -sfn /etc/nginx/sites-available/learn.doochy.net \
  /etc/nginx/sites-enabled/learn.doochy.net
sudo nginx -t
sudo systemctl reload nginx
```

If Option 2 was chosen, replace both certificate paths with
`/etc/letsencrypt/live/learn.doochy.net/...`.

Run `sudo nginx -t` before every reload. Never copy the `doochy.net` certificate paths for the
subdomain unless the certificate actually covers `learn.doochy.net`.

## pm2 and runtime changes

No pm2 restart is needed for Phase 7B preview/docs work.

`/api/trainer/batch` is already live on `doochy.net` and returns `503` (no batch published);
that is the expected state. Restart pm2 only if the **runtime server code** changes, not for
preview HTML, documentation, DNS, nginx or certificate changes.

If a future change does modify server code:

```bash
pnpm build
ls -l dist/server/index.js webapp/dist/index.html
sudo -u san pm2 restart doochyweb
sudo -u san pm2 status
```

The build also runs typecheck, tests and the Vite production build. Run the restart only
after explicit approval. Check the process log if it fails:

```bash
sudo -u san pm2 logs doochyweb --lines 100
```

The server binds to `127.0.0.1:${PORT}` (`9111` by default) and must stay behind nginx.

## Verification

After an approved DNS/nginx/certificate change:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://learn.doochy.net/
curl -sS https://learn.doochy.net/api/trainer/batch
curl -sS https://doochy.net/api/trainer/batch
```

Expected:

- `/` returns `200` and serves the SPA.
- `/api/trainer/batch` returns `503 {"error":"no batch published"}` until `v1` is published.
- After a published batch, both hosts return the same batch metadata.
- Opening `https://learn.doochy.net/` selects the Learn tab without signing in.
- Opening `https://doochy.net/?view=learn` also selects Learn.
- Opening `https://doochy.net/?note=<id>` still opens Breakouts.
- Signing in and the Trading tab are unaffected.

Do not use the production hosts for publish or answer/reveal tests until a pilot batch is
approved; use the existing route/payload tests and local dry runs instead.

## Rollback

If the subdomain must be withdrawn:

1. Remove the `learn.doochy.net` symlink or restore the previous nginx config from backup.
2. Run `sudo nginx -t && sudo systemctl reload nginx`.
3. Leave DNS in place or remove the `learn` record per the DNS provider.
4. If the certificate was expanded, it is valid for both names; no rollback is required
   unless the extra SAN must be removed by reissuing the certificate with approval.

If the app build is faulty, redeploy the last approved commit, run `pnpm build`, then restart
pm2 with approval. If the batch is faulty, follow the publish rollback procedure in
[`TRAINER.md`](./TRAINER.md#rollback). No rollback step deletes review or bar data.

## Operational notes

- The Learn UI and `/api/trainer` are public; the existing account APIs keep their auth.
- The trainer client never sends an Authorization header.
- There are no new environment variables required for deploy. `TRAINER_ITEM_SECRET` is
  optional and recommended if stable public item ids across restarts are desired.
- The Express SPA fallback serves `webapp/dist/index.html`; nginx must proxy all paths,
  including `/api/trainer`, to `127.0.0.1:9111`.
- No CORS changes are needed because the SPA and API share the same origin.
