# Integrations

`.env.example` is the authoritative env var list.

| Integration | Status | Where / notes |
| --- | --- | --- |
| **Supabase** | Core [CODE][SCHEMA] | Postgres 17, Auth, Storage, RLS. Production project `findmi` (`drcbrzwchlirfspjgtik`). See Highperlocal below |
| **Vercel** | Deployment [CODE] | Git-integrated. Production = default branch `claude/findmi-mvp-marketplace-3tvcik`, previews for every branch. See `DEPLOYMENT.md`. `vercel.json` cron for `/api/cron/geocode` |
| **Stripe: marketplace + legacy membership** | Implemented [CODE] | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, `/api/webhooks/stripe` (branches on `findmi_order_id` vs `findmi_membership_id`) |
| **Stripe: recurring billing** | Implemented, env-gated [CODE] | Separate key and webhook (`/api/webhooks/stripe/subscriptions`) plus four Price IDs. Falls back to the legacy $99 one-time checkout until all are set |
| Stripe Connect | **Not built (locked)** | Columns exist for future readiness only |
| **Tally** | Implemented [CODE] | Vendor onboarding intake, consumer inquiry form, $20 claim payment. `/api/webhooks/tally` fails closed without `TALLY_WEBHOOK_SECRET`. **Not** used by `/join/brand` |
| **Anthropic (Claude)** | Implemented [CODE] | Appearance import from text/flyers (vision), event import AI fill-in, Brand Build enrichment, optional paid Instagram web search (`BRAND_INSTAGRAM_SEARCH_ENABLED=1`). Usage/cost: `lib/anthropic-pricing.ts` |
| **Resend** | Implemented, best-effort [CODE] | Admin operational notifications (`lib/notifications/`). Failures never block user actions |
| **Geocoding** | Implemented [CODE] | Geocodio when `GEOCODIO_API_KEY` is set, otherwise the U.S. Census geocoder. Hourly cron |
| **Map tiles** | Implemented [CODE] | OpenFreeMap positron by default (`NEXT_PUBLIC_MAP_STYLE_URL`) |
| **Open-Meteo** | Implemented [CODE] | Homepage weather, keyless. The city is set at `/admin/site/homepage` |
| QR generation | Internal [CODE] | `qrcode` package. `/q/[code]` redirect |

## Highperlocal (separate brand deployment — not Findmi production)

- **What it is:** a second-brand deployment of the Findmi codebase.
  Branch `claude/highperlocal-findmi-prep-dghnn2` (last commit
  2026-09-09, **not merged** into the default branch) adds
  `lib/site-config.ts` (`NEXT_PUBLIC_SITE_BRAND = findmi | highperlocal`),
  a `commerceEnabled = false` switch for "no Stripe processing, no cannabis
  product checkout", and `supabase/highperlocal-bootstrap/` (a
  schema-only snapshot of Findmi production taken around Sept 8, intended
  for the empty Highperlocal project `ewwctvowukrwqzuqfttq`. It must never
  be applied to Findmi production).
- **Findmi code on the default branch doesn't reference it.** No
  project ref, no `NEXT_PUBLIC_SITE_BRAND`. The only mentions are in
  `/docs`.
- **Vercel:** a `highperlocal` Vercel project built previews from this
  repo from 2026-10-11 to 2026-10-28 (the sampled one failed) and has no
  production deployments in the visible record. It looks disconnected
  after 2026-10-28.
- **Supabase project `Highperlocal`:** ACTIVE_HEALTHY, created
  2026-09-09. This session's Supabase MCP grant is **denied** for it
  (`list_tables` / `get_project` / `execute_sql` all refused), so its
  schema and content weren't inspected.
- Status: an experimental sibling deployment. Whether it's active or
  abandoned is for the founder to say. Don't touch it from Findmi work.

## Importers (internal) — find these before building another

| Importer | Inputs | Entry points |
| --- | --- | --- |
| Event import (`lib/event-import/`) | Event URL (safe-fetch + structured data), pasted text, multi-paste, AI fill-in. Review then persist. Matches existing Events, Locations and Businesses | `/account/business/[id]/import-event`, `/admin/events/import` |
| Appearance import (`lib/admin/appearance-import.ts`) | Pasted schedules + flyer/screenshot images (Claude vision, not stored) | `/admin/appearances/import`, then `/admin/appearances/convert` (Convert To Events) |
| Brand import (`lib/admin/brand-import*.ts`) | Batches of brand candidates | `/admin/businesses/import` |
| Location import (`lib/location-import/`) | Website / Tally / parsed lists | `/admin/locations/import` |
| Store locator import (`lib/locator-import/`) | **CSV** + source fetch, matching, history | `/account/business/[id]/import-locations` |
| Availability bulk (`lib/business-availability-bulk*.ts`) | Bulk Find Us entries | Manager Findmi Here |

There's no generic Event CSV importer. XML store-locator import isn't
built. Provenance for imported records goes to `entity_provenance`.

## Planned / discussed only — no code

Google Calendar, iCal feeds, Eventbrite, Luma, Facebook Events, Dice,
Partiful, Bandsintown, XML locator feeds, native iOS/Android packaging.
Operational use of Luma for Findmi's own events isn't a software
integration.
