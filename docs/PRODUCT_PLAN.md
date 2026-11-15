# Product readiness plan

Status snapshot: 2026-11-15, HEAD `692d6d0`.
Sources: the original buyer-readiness plan (P0/P1/P2) and the cTrader fresh-buyer audit.

The separate Trade AI feature backlog lives in `update.md`; it is not part of this plan.

## Current state

- P0 is complete. The setup checklist now covers backups and the generic AI provider, and backups have retention, status, per-user export and secure-deletion guidance.
- P1 is partly done through white-label metadata, favicons, branding copy and some market defaults.
- P2 has not started.
- Last verified: `pnpm typecheck`, `pnpm test` with 818 tests, and `pnpm build` all pass.

## P0: needed for a sellable self-hosted product

| # | Item | Status | What remains |
| --- | --- | --- | --- |
| 1 | Registration/access policy | Done | Open, approval, invite and closed modes are implemented and enforced server side. |
| 2 | Canonical site URL | Done | One saved site origin drives callbacks, bot links, share links and account email links. |
| 3 | Email/SMTP, reset, verification, invites | Done | SMTP is admin-configurable; password reset, email verification and admin invites are implemented. |
| 4 | Legal/risk content | Done | Built-in legal pages, admin links, risk disclaimer, cookie notice and acceptance are implemented. |
| 5 | Buyer setup checklist | Done | The checklist covers admin, database, site URL, encryption, cTrader, Telegram, SMTP, legal, market data, backups and the generic AI provider. |
| 6 | White-label runtime strings | Done | Branding now drives titles, meta, favicons, logos, email and Telegram copy. Remaining Doochy references are internal defaults, comments and setup CLI text. |
| 7 | Admin user management | Done | List, create, invite, reset password, promote/demote, approve and block future sign-ins are present. "Block" is represented by moving a user to pending/approval. |
| 8 | Backups/export/retention | Done | Full Mongo backup and restore, timestamped snapshot retention with configurable count and directory, 7-day freshness status in the admin checklist, per-user JSON export from Settings and Admin, and documented secure-deletion guidance. |

## P1

| Item | Status | What remains |
| --- | --- | --- |
| SEO/social | Partial | Title, description, OG/Twitter title and description, and dynamic favicons are done. Add an admin-configurable OG image, per-page canonical links, robots.txt/sitemap support, and optional analytics IDs with consent handling. |
| Content editor | Partial | Product name, tagline, description, footer text and registration message are editable. Hero, feature, empty-state and login copy beyond those fields are still hardcoded. |
| Defaults | Partial | Shared watchlist and Analysis defaults for timeframe, refresh interval and strong ratio exist. Missing central defaults for signal expiry, risk sizing and order preferences. |
| Locale, timezone, currency, date/number formats | Open | Date formatting exists, but locale, timezone, currency and number/date formats are not admin-configurable. |
| Role-based module access | Open | Access is still only public or signed-in. Add roles and per-module access beyond the current binary gate. |
| Email templates and notification copy | Open | Email subjects and bodies, plus Telegram notification copy, are hardcoded. Add editable templates with variables, preview and test send. |
| Theme extras | Open | Palette editing is done. Font family, border radius and density controls are not implemented. |

## P2

- PWA manifest, install icons and related metadata.
- Social links beyond the single website URL.
- Webhooks and API keys.
- Version and update information for the deployment.

## cTrader fresh-buyer audit

| Gap | Status | What remains |
| --- | --- | --- |
| 1. Test result wording is misleading | Partial | The UI now says the check proves reachability, but the button is still called Test and the integration card still says Ready based on configuration. Add a real end-to-end verification, or rename the state to Config check and Configuration complete. |
| 2. End users see the developer form | Partial | Unconfigured deployments now show "Trading is not configured; contact the admin". The own-app manual flow is still reachable by ordinary users when OAuth is available; it should sit behind an explicit admin toggle. |
| 3. No setup status on the admin dashboard | Done | The admin setup checklist now reports cTrader readiness. |
| 4. External app registration underspecified | Partial | A basic cTrader setup checklist exists. It still needs account/approval prerequisites and troubleshooting guidance for rejected or unapproved apps. |
| 5. Duplicate base URLs | Done | cTrader and Telegram use the canonical site URL. |
| 6. Credential rotation risk | Open | Changing the platform Client ID or secret has no warning or migration guidance for existing users whose stored tokens may break. |
| 7. Manual and OAuth flows lack a product policy | Partial | OAuth is the primary flow, but manual mode is not controlled by an admin policy. |
| 8. No admin visibility into failed user connections | Open | There is no aggregate connection-health warning or per-user cTrader last-failure/reauth status. |

## Suggested order

1. Finish the cTrader operator experience: admin manual-mode toggle, rotation warning, connection health.
2. P1: canonical links and OG image, email templates, roles, locale/currency settings, theme extras.
3. P2: PWA, social links, webhooks/API keys, version/update info.
