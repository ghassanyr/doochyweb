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
pnpm doochy:backup --keep 30
pnpm doochy:backup --out /secure/doochy-before-upgrade.json
pnpm doochy:restore /secure/doochy-before-upgrade.json --merge
pnpm doochy:restore /secure/doochy-before-upgrade.json --replace --yes
```

Backups are Extended JSON snapshots of every non-system MongoDB collection. They contain password hashes and encrypted integration secrets, so keep them private and store `.env` with them. Restoring needs the same `INTEGRATIONS_ENCRYPTION_KEY` to read stored integration secrets.

`--merge` overwrites documents with matching `_id` values and keeps everything else. `--replace` deletes each collection present in the backup first; it also requires `--yes`.

`pnpm doochy:backup` keeps the 14 newest timestamped snapshots in `backups/` by default. Change that with `--keep <count>` or `BACKUP_KEEP`, and change the directory with `BACKUP_DIR`. Retention only removes files named `doochy-<timestamp>.json`; custom `--out` files are left alone. The admin setup checklist asks for a snapshot less than 7 days old.

Old snapshots keep data that was later deleted from the database. Match retention to your own policy, then remove expired snapshots securely. On POSIX use `shred -u <file>` when the filesystem supports it; on SSDs, cloud volumes and snapshots, full-disk or volume encryption is the reliable protection because overwriting a file cannot guarantee every stored copy is gone.

Signed-in users can download their own JSON export under **Settings → Your data**. Admins can download the same export from the user row in **Admin**. Exports include profile data, cTrader account labels, alerts, journal, paper trades, briefings, coaching reports and the Telegram link; password hashes and integration secrets are excluded.

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
pnpm demo:seed                  # create or repair the shared demo user
pnpm demo:reset                 # invalidate demo links and increment resets
pnpm demo:status                # print demo seed status
```

## Buyer handover checklist

1. Set **Admin → Site settings → Site address** to the public HTTPS origin.
2. Set branding, registration policy, legal links, and the risk disclaimer. When a Terms or Privacy URL is configured, new registrations and invite acceptances require agreement, and a cookie/storage notice appears site-wide.
3. Configure SMTP, cTrader and Telegram under **Admin → Integrations**. SMTP is required for password reset, email verification and admin invites. MT5 is optional and read-only in this release; leave it disabled unless the operator is prepared to run an external bridge. See `docs/MT5_SETUP.md`.
4. Decide whether demo access should be enabled and set its label under **Admin → Site settings → Demo access**.
5. Run `pnpm doochy:check` and confirm the setup checklist has no required todos.
6. Take a `pnpm doochy:backup` snapshot before handing over the server. Keep backups within the 7-day freshness window the admin checklist expects.

### White-label checklist

Everything customer-facing follows **Admin → Site settings → Branding**: product name, tagline, description, logo, support email, website and footer copy. The page title, meta/Open Graph tags, favicons, header, maintenance screen, transactional emails and Telegram messages use the same values. If no logo is uploaded, a monogram is generated from the product name; the bundled mark is only used while the product keeps its default name. The Telegram bot username must match the real username assigned by @BotFather so the deep link works.

## Demo account

The optional demo gives visitors a shared, read-only workspace with fixed sample positions, orders, alerts, briefing and coaching data. It uses one seeded user, short-lived purpose-tagged tokens, and a server-side guard that blocks every write under `/api`. The default entry label is `Explore sample account`. Manage it under **Admin → Site settings → Demo access** and **Admin → Demo account**. See `docs/DEMO_ACCOUNT.md` for the full behavior, fixed counts and reset commands.

## Optional integrations

SMTP, cTrader, Telegram and optional read-only MT5 are configured in the admin panel after the first login. Secrets saved there are encrypted with `INTEGRATIONS_ENCRYPTION_KEY`. Site URL, branding, registration policy, and legal links are managed under **Admin → Site settings**. The MT5 card configures access to an external bridge; no bridge daemon ships in this repo.

### Email

Doochy uses generic SMTP through Nodemailer, with no vendor SDK or hardcoded provider. Mailgun, Postmark, Amazon SES, Google Workspace and self-hosted relays all work. For Mailgun, use `smtp.mailgun.org` (US), `smtp.eu.mailgun.org` (EU), port 587, STARTTLS, your SMTP username and SMTP password. The provider must authorize the From address/domain (SPF, DKIM, DMARC).

SMTP enables password reset, optional email verification and admin invites. Verification is off by default and can be enabled under **Admin → Site settings → Registration**; existing accounts are treated as verified. Verification mail uses the dark site palette and signs the user in when the link is opened. Signed-in users can add or change their email under **Settings**, and the current password is required. The admin **Test** button sends a real email to the signed-in admin.

Telegram uses long polling only, so it needs no inbound route or webhook.

### AI provider

AI features are optional and configured under **Admin → Integrations**. Pick OpenAI, OpenRouter, Groq, NVIDIA or a local Ollama server, or enter any other OpenAI-compatible endpoint with **Custom**. The page links to the provider key page, fills in the endpoint and, when available, a recommended model, loads the models the endpoint advertises, checks which ones the key can actually use, and tests the connection before you save. NVIDIA's catalog is filtered to chat models and probed because its `/v1/models` response lists models that the key cannot invoke. Ollama needs no API key. The key is encrypted at rest and never returned to the browser.

### Daily briefing

The Briefing page stores one brief per user per UTC day from the effective watchlist, active published signals and open journal ideas. The snapshot is frozen when the brief is generated, so the page keeps showing the numbers the write-up was based on until you refresh it. Each brief includes per-symbol notes, open ideas with recorded plan levels, active signals, key risks, levels to monitor, and data notes. Members choose their focus sessions under the briefing header; the default is London and New York.

The first open builds a fast deterministic snapshot from cached data and returns it right away while the written summary is prepared in the background. The page polls until the AI prose is ready or fails. With an AI provider configured, the brief is written as structured JSON and validated against a fresh snapshot built without the first-open time budget. If no provider is saved or the response is unusable, the page still renders a deterministic data summary. No news feed is connected, so the brief never invents headlines or event context.

### AI Coach

The Coach page reviews the member's own Trade Journal. It uses fixed UTC weeks, Monday 00:00 through Sunday 23:59, so a report does not move with the viewer's timezone. Individual trade reviews are available for any closed trade. Weekly behaviour reports need at least five closed trades in the week.

Generation is manual. Opening the page only reads stored reports and deterministically rebuilt facts; it never calls the AI provider. Press Generate or Regenerate to write a review. Weekly reports cover results, plan completeness, grouping by symbol, side, strategy, tag and weekday, and data quality. Trade reviews cover the recorded plan, execution, risk definition and journal quality. Journal mutations clear the affected coaching reports.

With an AI provider configured, the review is written as structured JSON over a frozen fact snapshot. If no provider is saved or the response is unusable, the page still shows a deterministic review. P&L is shown as recorded and is never converted between account currencies. The coach does not predict markets, recommend trades or give financial advice, and note text is treated as untrusted data.

### Webhooks

Outbound webhooks are configured under **Admin → Site settings → Webhooks**. Enable the events you want and set an HTTPS endpoint; the optional secret signs each JSON payload with `X-Doochy-Signature: sha256=<hex>`. Deliveries are queued in the background and retried, and the settings page has a test button that uses the saved configuration.

### MT5

MT5 support is read-only in this release. Configure it only if the operator is prepared to run a bridge service beside the app; no bridge daemon ships in this repo. Admins enter the bridge URL, optional API key, bridge-side account label, mode and enabled flag under **Admin → Integrations**. End users add their own MT5 login, server and password under **Connect** or **Settings**. cTrader remains the default provider.

Open MT5 positions, pending orders and history are read through the user's encrypted MT5 account settings. Closed deals can be imported into the trade journal with source `mt5`. MT5 account metadata is included in user exports. MT5 write trading is not implemented.

See `docs/MT5_SETUP.md` for the bridge contract, security notes and current limitations.

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
