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

## Backup and restore

```bash
pnpm doochy:backup
pnpm doochy:backup --out /secure/doochy-before-upgrade.json
pnpm doochy:restore /secure/doochy-before-upgrade.json --merge
pnpm doochy:restore /secure/doochy-before-upgrade.json --replace --yes
```

Backups are Extended JSON snapshots of every non-system MongoDB collection. They contain password hashes and encrypted integration secrets, so keep them private and store `.env` with them. Restoring needs the same `INTEGRATIONS_ENCRYPTION_KEY` to read stored integration secrets.

`--merge` overwrites documents with matching `_id` values and keeps everything else. `--replace` deletes each collection present in the backup first; it also requires `--yes`.

## Common commands

```bash
pnpm doochy:setup               # guided setup
pnpm doochy:check               # diagnostics
pnpm doochy:backup              # full database snapshot
pnpm doochy:restore <file> --merge
pnpm dev:server                 # API on 127.0.0.1:9111
pnpm dev:web                    # Vite on 127.0.0.1:5173
pnpm build                      # server + web production build
pnpm start                      # run the production server in the foreground
pm2 start ecosystem.config.cjs  # run under pm2
pnpm test                       # test suite
pnpm admin:grant <username>     # promote an existing user
pnpm admin:revoke <username>    # demote an admin
```

## Buyer handover checklist

1. Set **Admin → Site settings → Site address** to the public HTTPS origin.
2. Set branding, registration policy, legal links, and the risk disclaimer. When a Terms or Privacy URL is configured, new registrations and invite acceptances require agreement, and a cookie/storage notice appears site-wide.
3. Configure SMTP, cTrader and Telegram under **Admin → Integrations**. SMTP is required for password reset, email verification and admin invites.
4. Run `pnpm doochy:check` and confirm the setup checklist has no required todos.
5. Take a `pnpm doochy:backup` snapshot before handing over the server.

### White-label checklist

Everything customer-facing follows **Admin → Site settings → Branding**: product name, tagline, description, logo, support email, website and footer copy. The page title, meta/Open Graph tags, favicons, header, maintenance screen, transactional emails and Telegram messages use the same values. If no logo is uploaded, a monogram is generated from the product name; the bundled mark is only used while the product keeps its default name. The Telegram bot username must match the real username assigned by @BotFather so the deep link works.

## Optional integrations

SMTP, cTrader and Telegram are configured in the admin panel after the first login. Secrets saved there are encrypted with `INTEGRATIONS_ENCRYPTION_KEY`. Site URL, branding, registration policy, and legal links are managed under **Admin → Site settings**.

### Email

Doochy uses generic SMTP through Nodemailer, with no vendor SDK or hardcoded provider. Mailgun, Postmark, Amazon SES, Google Workspace and self-hosted relays all work. For Mailgun, use `smtp.mailgun.org` (US), `smtp.eu.mailgun.org` (EU), port 587, STARTTLS, your SMTP username and SMTP password. The provider must authorize the From address/domain (SPF, DKIM, DMARC).

SMTP enables password reset, optional email verification and admin invites. Verification is off by default and can be enabled under **Admin → Site settings → Registration**; existing accounts are treated as verified. Signed-in users can add or change their email under **Settings**, and the current password is required. The admin **Test** button sends a real email to the signed-in admin.

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
