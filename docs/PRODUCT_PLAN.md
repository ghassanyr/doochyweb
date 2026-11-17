# Product readiness plan

Status snapshot: 2026-11-17, working tree on top of HEAD `63deb79`.
Sources: the original buyer-readiness plan (P0/P1/P2) and the cTrader fresh-buyer audit.

The separate Trade AI feature backlog lives in `docs/AI_PLAN.md`; it is not part of this plan.

## Current state

- P0 is complete. The setup checklist now covers backups and guided AI provider setup, and backups have retention, status, per-user export and secure-deletion guidance.
- P1 is complete: metadata, content copy, defaults, locale/formats, roles, templates and theme extras are implemented.
- P2 is complete: PWA metadata, social links, webhooks and deployment version information are implemented.
- The daily briefing is now a structured, per-user brief over the effective watchlist, active signals and open journal ideas, with saved focus sessions, deterministic fallback sections and legacy snapshot regeneration.
- AI Coach adds manual individual trade reviews and fixed UTC weekly behaviour reports over the Trade Journal, with deterministic fallbacks and report invalidation on journal changes.
- Last verified: `pnpm typecheck`, `pnpm test` with 935 tests, `pnpm build` and `git diff --check` all pass.

## P0: needed for a sellable self-hosted product

| # | Item | Status | What remains |
| --- | --- | --- | --- |
| 1 | Registration/access policy | Done | Open, approval, invite and closed modes are implemented and enforced server side. |
| 2 | Canonical site URL | Done | One saved site origin drives callbacks, bot links, share links and account email links. |
| 3 | Email/SMTP, reset, verification, invites | Done | SMTP is admin-configurable; password reset, email verification and admin invites are implemented. |
| 4 | Legal/risk content | Done | Built-in legal pages, admin links, risk disclaimer, cookie notice and acceptance are implemented. |
| 5 | Buyer setup checklist | Done | The checklist covers admin, database, site URL, encryption, cTrader, Telegram, SMTP, legal, market data, backups and guided AI provider setup. |
| 6 | White-label runtime strings | Done | Branding now drives titles, meta, favicons, logos, email and Telegram copy. Remaining Doochy references are internal defaults, comments and setup CLI text. |
| 7 | Admin user management | Done | List, create, invite, reset password, promote/demote, approve and block future sign-ins are present. "Block" is represented by moving a user to pending/approval. |
| 8 | Backups/export/retention | Done | Full Mongo backup and restore, timestamped snapshot retention with configurable count and directory, 7-day freshness status in the admin checklist, per-user JSON export from Settings and Admin, and documented secure-deletion guidance. |

## P1

| Item | Status | What remains |
| --- | --- | --- |
| SEO/social | Done | Admin fields cover title, description, canonical URL, OG image, keywords, noindex, analytics provider/ID/consent, robots.txt, sitemap and a dynamic manifest. |
| Content editor | Done | Hero, features, login/register intros and module empty states are editable. |
| Defaults | Done | Shared watchlist and Analysis defaults plus default order type, risk percent, signal expiry and market timeframe. |
| Locale, timezone, currency, date/number formats | Done | Locale, timezone, currency, date format and number format are admin-configurable and applied to shared formatters. |
| Role-based module access | Done | Modules support public, signed-in and admin access, enforced on the server and reflected in navigation. |
| Email templates and notification copy | Done | Email and Telegram templates are editable with variables, fall back to defaults, and use the existing test-send paths. |
| Theme extras | Done | Font family, border radius and density sit alongside palette editing. |

## P2

All done.

- PWA manifest, install icons, theme/background colours and display mode.
- Social links beyond the single website URL.
- Signed outbound webhooks for signal and alert events.
- Deployment version and runtime information in the admin panel.

## P3: MT5 productization - parked

MT5 read-only support is implemented, but it is not yet a normal buyer-facing integration. See `mt5.md` for the full handoff and `docs/MT5_SETUP.md` for the current bridge contract.

| Item | Status | What remains |
| --- | --- | --- |
| Read-only MT5 foundation | Done | Encrypted per-user accounts, namespaced routes, journal import, export, admin health and read-only UI are implemented. Tests stub the bridge; live broker validation has not been done. |
| Product-managed runtime | Parked | Replace the externally built bridge with a bundled Python helper. Windows uses native Python; Linux uses Windows Python inside Wine. Admin panel must prepare the runtime and report plain-language status. |
| Multi-user concurrency | Parked | One terminal holds one account. Add a per-account worker pool with locks, lazy start, idle timeout and health restart before claiming multi-user MT5 support. |
| Docker runtime | Parked | Add a dedicated `mt5-runtime` service with Wine, Windows Python, Xvfb and persistent state. The current Node container cannot host it. |
| MT5 write trading | Not started | Implement preview, place, modify, cancel, close and SL/TP amendment through the adapter and worker pool. Validate with demo accounts before enabling for users. |
| Buyer docs | Partial | Current limitations and bridge contract are documented. Docs must be rewritten again when the managed runtime ships. |

## cTrader fresh-buyer audit

| Gap | Status | What remains |
| --- | --- | --- |
| 1. Test result wording is misleading | Partial | The UI says the check proves reachability. A true end-to-end trading verification is not implemented. |
| 2. End users see the developer form | Done | The manual own-app flow is gated by `CTRADER_ALLOW_MANUAL` and exposed only when enabled. |
| 3. No setup status on the admin dashboard | Done | The admin setup checklist now reports cTrader readiness. |
| 4. External app registration underspecified | Done | Guidance covers account/approval prerequisites, rejected apps, connectivity-only checks and troubleshooting. |
| 5. Duplicate base URLs | Done | cTrader and Telegram use the canonical site URL. |
| 6. Credential rotation risk | Done | The admin integration card warns that rotating the platform client breaks existing tokens and documents the reauthorisation path. |
| 7. Manual and OAuth flows lack a product policy | Done | OAuth is the primary flow; manual mode is controlled by `CTRADER_ALLOW_MANUAL`. |
| 8. No admin visibility into failed user connections | Done | Admin connection health shows counts and per-user last failure, token and reauthorisation state. |

## Suggested order

1. Add a real end-to-end cTrader verification if the connection check is not enough for buyers.
2. Commit the completed cTrader/P1/P2 work.
3. Resume MT5 P3 only after choosing the expected maximum concurrent MT5 accounts per install.
