# Doochy

Self-hosted trading dashboard and signal workspace.

## Requirements

- Node.js 20 or newer
- pnpm 11
- Docker with Docker Compose v2, only if you want the bundled MongoDB

## Quick start

```bash
pnpm install
pnpm doochy:setup
pnpm build
pm2 start ecosystem.config.cjs
```

`pnpm doochy:setup` is interactive. It will:

- Detect an existing MongoDB, start the bundled `mongo:7.0` container, or accept an external connection string.
- Test the connection before writing anything.
- Generate `JWT_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`, and `TRAINER_ITEM_SECRET`.
- Write `.env` with `MONGO_DB=doochy` and back up any previous file.
- Create or promote the first admin account.
- Ask for a domain, or fall back to `http://localhost:9111`.

The bundled compose file publishes MongoDB on `127.0.0.1:27017` only.

## Check an existing install

```bash
pnpm doochy:check
```

This is read-only. It checks Node, `.env`, secrets, MongoDB, the admin account, Docker, and the build output.

## Common commands

```bash
pnpm doochy:setup               # guided setup
pnpm doochy:check               # diagnostics
pnpm dev:server                 # API on 127.0.0.1:9111
pnpm dev:web                    # Vite on 127.0.0.1:5173
pnpm build                      # server + web production build
pnpm start                      # run the production server in the foreground
pm2 start ecosystem.config.cjs  # run under pm2
pnpm test                       # test suite
pnpm admin:grant <username>     # promote an existing user
pnpm admin:revoke <username>    # demote an admin
```

## Optional integrations

cTrader, Telegram, and SMTP are configured in the admin panel after the first login. Secrets saved there are encrypted with `INTEGRATIONS_ENCRYPTION_KEY`.

Telegram uses long polling only, so it needs no inbound route or webhook.

cTrader OAuth needs HTTPS outside localhost. Register these callback URLs in the cTrader Open API portal:

```
https://<your-domain>/callback
https://<your-domain>/api/ctrader/oauth/callback
```

## Security notes

- Keep `.env` private. Setup writes it with mode 0600 on POSIX.
- The bundled MongoDB is bound to loopback and has no authentication. This is deliberate for a single-VPS install. Revisit before exposing the host, sharing the server, or moving the database off the machine.
- The server binds to `127.0.0.1`. Put nginx or another reverse proxy in front of it for public access.
- Rotating `INTEGRATIONS_ENCRYPTION_KEY` makes stored integration secrets unreadable. Re-enter them in the admin panel after rotating.

## Database name

New installs use `MONGO_DB=doochy`. If an existing `.env` points at a different database, setup keeps that value by default so existing data is not hidden.
