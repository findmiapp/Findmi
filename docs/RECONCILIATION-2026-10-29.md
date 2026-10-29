# Findmi Knowledge Reconciliation — 2026-10-29

This is the audit record behind the canonical `/docs` set and the rewritten
`/CLAUDE.md`. It compares the "Findmi Canonical Knowledge Package" (the
conversation-derived draft from 2026-10-29) with what the repository,
production schema and test suite actually show. It's a point-in-time
record, not a living doc. Keep the living docs current, not this file.

## Evidence tags used across `/docs`

| Tag | Meaning |
| --- | --- |
| **[CODE]** | Confirmed by reading current code on `ccr-b4f5a02e-wyusgw` @ `aa7d1e2` |
| **[SCHEMA]** | Confirmed against the live production Supabase schema (project `findmi`, `drcbrzwchlirfspjgtik`) |
| **[TEST]** | Covered by a test in `tests/*.test.mjs` |
| **[DECISION]** | An approved product decision. Code may or may not match yet |
| **[BACKLOG]** | Requested and not yet built (or not fully built) |
| **[SUPERSEDED]** | Previously used or proposed, later replaced |
| **[VERIFY]** | Not safely established by code, schema or tests |

## 1. Repository state

- Repo root: `/home/user/Findmi` (GitHub `findmiapp/findmi`).
- Working branch: `ccr-b4f5a02e-wyusgw`, HEAD `aa7d1e2` ("Business Manager
  Overview: final density correction", 2026-10-29). Clean working tree.
- Other branch: `claude/findmi-mvp-marketplace-3tvcik`. It points to the
  same commit (0/0 divergence).
- **Production branch / production SHA: [VERIFY].** Nothing in the repo
  maps a branch to Vercel production. `vercel.json` only declares a cron.
  The clone is shallow (52 commits visible).
- Stack: Next.js 15.5.25 (App Router), React 18.3, TypeScript 5.5,
  Tailwind 3.4, `@supabase/ssr` + `supabase-js` 2.x, Stripe 22, Anthropic
  SDK 0.120, Resend, MapLibre GL 5.24, qrcode, sharp, zod 4. Node 22 in
  this sandbox.
- Scripts: `dev`, `build`, `start`, `lint` (`next lint`), `test`
  (`node --experimental-strip-types --test tests/*.test.mjs`).

## 2. Test baseline (2026-10-29)

`npm test`: **3465 tests, 3464 pass, 1 fail**.

- Pre-existing, deterministic failure:
  `tests/guest-moment-reload.test.mjs:237` "precedence: an existing guest
  draft wins; URL Event context only FILLS what is missing". The title
  comes back as `Spring Pop-Up` instead of `Earlier Story`, so the URL
  Event prefill overwrites an existing guest draft title. This reconciliation
  didn't cause it (it's a docs-only change). It's listed in `BACKLOG.md`.
- Most tests read source files and check what they contain (they're
  source-inspection tests). They encode approved composition and copy
  decisions, so they work as a decision record as well as a check.

## 3. Database: migration ledger drift (important)

- The repo has 136 files in `supabase/migrations/`.
  `supabase_migrations.schema_migrations` in production has 151 entries,
  latest version `20261113000000`.
- **33 repo migrations are missing from the production ledger.** Spot
  checks show their schema **is** live, so they were applied outside
  `apply_migration` (for example with `execute_sql` or the dashboard):
  `profile_public_visibility`, `location_geocode_automation`,
  `discovery_engine_map_v1`, `event_date_time_precision`,
  `consolidation_publication_rules`, `hotfix_event_visibility_policy_grants`,
  `pages_sections_v1b`, `discovery_pages_guides_v1a`, `product_wants`,
  `user_collections`, `media_variants_registry`, `journal_entry_sections`,
  `event_formats_v1`, `business_locations`, `business_location_availability`,
  `admin_intelligence_reviews`, `taxonomy_v2_*`, `opportunity_commercial_terms_*`,
  and others. Run a `comm` of names to get the full list.
- About 30 production ledger entries have no matching repo file (early
  migrations such as `findmi_initial_schema`, `commerce_orders`,
  `create_homepage_rows`). `supabase/schema.sql` is the historical base.
- Consequence: **the ledger can't be used to tell whether a migration is
  applied.** Check for the object itself (column, table, function or
  constraint). See `DEPLOYMENT.md`.
- Live row counts (rough scale, 2026-10-29): businesses 111, events 73,
  event_occurrences 196, appearances 333, locations 67, products 42,
  journal_entries (Moments) 27, qr_campaigns 8, business_location_availability 1,
  analytics_events about 12.4k, markets 7, market_areas 34,
  user_collections 1, product_wants 3.

## 4. Claim-by-claim reconciliation (package → reality)

| Package claim | Reality | Tag |
| --- | --- | --- |
| Event identity vs scheduled Occurrences | `events` (Primary Date `start_at`/`end_at`, `start_date`/`end_date`) + `event_occurrences` (`occurrence_date`, details, vendors, timezone) | [SCHEMA][CODE] |
| Multi-date creation up front = backlog | **Already built.** `lib/event-create-schedule.ts`: Single Date / Date Range / Multiple Dates, writing to the existing occurrence model | [CODE][TEST] |
| Appearances are relationships | `appearances` (business_id, event_id, event_occurrence_id, location_id, market/area, source, admin_reviewed_at) | [SCHEMA] |
| Availability: stocked/sold/served/featured/sampled + pending/live/declined + products + date range | Exactly that: `business_location_availability` (`relationships[]` 1–5, `status`, `source` admin/business, `starts_on`/`ends_on`, external id, import batch) + `business_location_availability_products` | [SCHEMA] |
| Event importer exists, exposure unclear | One engine `lib/event-import/engine.ts` (URL / paste / multi-paste / AI fill-in → Review → persist). Exposed to owners at `/account/business/[id]/import-event` and to admins at `/admin/events/import` | [CODE][TEST] |
| Bulk CSV: maybe Appearance-only, no generic Event CSV | Appearance import is AI text/flyer (`/admin/appearances/import`). CSV exists for **store locator / locations** (`lib/locator-import/csv.ts`, `/account/business/[id]/import-locations`). No generic Event CSV importer | [CODE] |
| Provenance exists | `entity_provenance` + `lib/provenance.ts` (service-role only; public sees only `getPageTrust()`) | [SCHEMA][CODE] |
| QR: occurrence selection, search, analytics | `qr_campaigns` targets business/event/occurrence/appearance/location/product/url. Occurrence selection in `qr/new/QrIntelligentCreator.tsx`. Search in `QrCampaignGroups.tsx`. QR analytics are part of Performance (`destinationGroup` qr → performance). **QR creation isn't plan-gated** | [SCHEMA][CODE] |
| Persistent Business Manager shell | `account/business/[id]/(manager)/layout.tsx` → `BusinessAppShell`, per-request cached `managerContext` | [CODE][TEST] |
| Manager nav Home · Moments · Findmi Here · Performance · More | Matches `v2/business-nav.ts` `BUSINESS_NAV`. Products and Opportunities are desktop-rail-only. A doc comment in `BusinessAppShell.tsx` still lists the old order | [CODE] |
| Growth = Goals / Opportunities / Ideas | Destination is labelled **Opportunities**. "Growth Manager" on Home = Set Goals · Opportunities · Ideas (· Set Targets) | [CODE] |
| Needs Attention not a standalone Home row | Confirmed: an amber count badge in the Inbox / Follow-Ups heading (`aa7d1e2`) | [CODE] |
| My World → **My Moments** | Code split it in two: **My Moments** is a mode of `/moments` (Explore · For You · My Moments). **My Journal** (`/journal`) is the personal dated archive. `/my-world*` 308-redirects to `/journal`. The composer is still at `/my-world/journal/new` | [CODE][TEST] |
| "Coming Up" → "Upcoming from Pages You Follow" | Consumer Account Home uses "Upcoming Events" with subtitle "From Pages You Follow". **Business Manager Home still uses "Coming Up"** for the owner's own upcoming schedule (approved in `012cd7b`). Location pages use "Coming Up Here" | [CODE] — owner context: [VERIFY] with founder |
| "Public Actions" not a prominent 2nd tab | Profile editor tabs are now Details · Photos · Contact & Links · Announcement · **Profile Buttons** (last). The More-menu description still says "Public Actions" (stale copy). The model and table are still `entity_public_actions` | [CODE] |
| Photos = complete media manager | Photos is its own More destination again (`gallery`). Logo + Cover vs gallery split: [VERIFY] fully coherent |
| Whole-feed Moments swipe = backlog | **Built.** `components/moments/useBoardSwipe.ts` on the feed surface (grid layout) in `MomentsDiscovery.tsx` | [CODE] |
| Save / preference modal = backlog | **Built in this form:** `SaveOrganizeSheet` ("Mark As" relationships + Collections). Relationship vocabulary in schema: want, must_do, like, dislike, been, have | [CODE][SCHEMA] |
| Collections: unknown | **Exists.** `user_collections` + `user_collection_items` (private, polymorphic). Live in production. `/api/collections`, `CollectionPicker` | [SCHEMA][CODE] |
| Event → Location internal link = backlog | **Built.** `EventLocationCard` links to `publicLocationHref`. Test `location-link-integrity` | [CODE][TEST] |
| `/join/brand` with Tally | **Superseded.** `/join/brand` is a native Brand Build flow (website / Instagram / name analysis, optional Claude enrichment). Tally is still used for vendor onboarding intake, the inquiry form and claim payments (`/api/webhooks/tally`) | [CODE] |
| Remove "Search as Instagram Instead" | Gone. Only "Search as a Name Instead" remains | [CODE] |
| Brand onboarding → account Home pending review | Account Home shows pending-review state for owned Businesses. End-to-end redirect: [VERIFY] live |
| Admin direct Logout | **Built.** `/admin/more` → `logout` action | [CODE] |
| Pro $20/mo, $149/yr | Recurring billing plans Pro + Managed Pro, monthly/annual, Stripe Price IDs from env only. Code comment names $20/$149/$49/$399 but no amounts are encoded. Falls back to the legacy $99/yr one-time checkout until all six env vars are set. Which applies in production: [VERIFY] |
| Performance is Pro | Performance headline is reachable on Free. **Change labels/deltas are Pro-only** (`012cd7b`). Exact gate matrix: [VERIFY] per view |
| Hyperlocal: Jersey City via `SITE=jc` | **Superseded mechanism.** No `SITE` env var. JC is `src/app/jc/**` + host-based redirects/rewrites for `jerseycity.guide` in `next.config.mjs`. It reuses `lib/data.ts`, scoped to Market `north-jersey` / Area `jersey-city` / Census place `place:3436000`. SoHo Centric, Hamptons Guide, Staten Island: **no code** | [CODE] |
| Following filter returns nothing (bug) | A `following` filter exists in `lib/moment-filters.ts` with its own empty state. Bug status: [VERIFY] live |
| Map filters under active QA | `/map` = `components/map/MapExplorer.tsx` + `lib/discovery/map-*`. Treat its UX as not canonical | [CODE] |
| Orders: uncertain | Real system: orders, order_items, vendor allocations, settlements, refunds; manager Orders tab; `/account/orders` | [SCHEMA][CODE] |
| Opportunities: persistence uncertain | Real system: `opportunities`, `opportunity_listings`, `opportunity_recipients`, `opportunity_ideas`, `business_opportunity_goals`, `opportunity_options`/components (commercial terms), threads | [SCHEMA] |
| Analytics event names unknown | Canonical list in `lib/analytics/taxonomy.ts`. Stored in `analytics_events`. Optional retention (`ANALYTICS_RETENTION_DAYS`) | [CODE] |
| Markets / Areas, `/explore/[market]/[area]` | Confirmed route + `markets`, `market_areas` | [CODE][SCHEMA] |

## 5. Things the package didn't know about (now documented)

Consumer **accounts** (Supabase Auth: `/login`, `/signup`, `/account/**`),
public user profiles and handles (`/[username]`, `/user/[username]`,
`handles`), People (`/people`), messaging and inboxes (`conversations*`),
customer inquiries and commercial inquiries, Business Targets and Follow-Ups,
Business Development CRM (`/admin/bd`), Activations, referral partners,
Pro invites, claims ($20 listing activation), trust/privacy (reports,
privacy requests, consent), Discovery Pages / Guides (`/guides/[slug]`),
Discovery Lanes, taxonomy v2, the embed widget (`/embed/business/[slug]`),
`/q/[code]` QR redirect, and the Vercel geocode cron.

## 6. Stale items found in the old `/CLAUDE.md`

- "Follow / Save (per-device localStorage, no accounts)". Wrong now.
  Accounts exist. Device-local lists are only the signed-out fallback, and
  they're imported into the account on sign-in.
- "Admin authentication … no accounts". Still true **for `/admin` only**.
  Consumer and business-owner auth is Supabase Auth.
- The Founding Member $99/yr Payment Link is superseded by plan-aware
  checkout (`NEXT_PUBLIC_STRIPE_FOUNDING_LINK` is no longer read).
- The env var list was incomplete (Resend, Anthropic, Tally secrets,
  subscriptions, map/geocoder, retention, direct messaging flag).

## 7. Addendum: operational verification pass (2026-10-29, later)

These are read-only findings. Nothing in production was changed.
Canonical facts were moved into `DEPLOYMENT.md`, `PRODUCT.md`,
`INTEGRATIONS.md`, `ARCHITECTURE.md` and `BACKLOG.md`.

- **Deployment.** Evidence comes from the GitHub Deployments API (the
  repo is public) and git ancestry. Production = the default branch
  `claude/findmi-mvp-marketplace-3tvcik`. It auto-deploys on push, and
  every push to any branch gets a Preview. Production was running
  `aa7d1e2` (deployed 2026-10-29 15:41 UTC). `3b2f195` was Preview only.
  The rollback procedure isn't documented. The options are listed in
  `DEPLOYMENT.md`.
- **Billing.** Public copy says Business Pages are free. `/upgrade/pro`
  shows the recurring picker only when the recurring Stripe env is fully
  set, and otherwise shows the legacy $99/yr one-time checkout.
  Production has 0 `business_subscriptions` rows and 1 paid Pro (a
  one-time live Checkout). The legacy `membership_plans` checkout is
  unreachable from the UI. Vercel env values can't be read from here.
- **Moments → Following.** The standalone filter has been replaced by
  For You ordering. With current production data an empty result is
  correct for 6 of the 8 users who follow something. Live check still
  pending.
- **Brand Build.** Code path: `/join/brand` → Review Your Brand
  (`/account/business/new?source=brand…`) → `create_owned_business`
  (free, `pending_review`) → `/account?created=<id>` → "Pending Review"
  card. Production has 5 `pending_review` Businesses. No test records
  were created.
- **"Public Actions".** There are 5 owner-facing stale strings plus 1
  admin help text, listed in `BACKLOG.md` with proposed replacements.
  None were changed.
- **Highperlocal.** A separate brand deployment on an unmerged Sept 9
  branch, using its own Supabase project. The Vercel previews stopped
  around Oct 28. Supabase MCP access to the project is denied, so its
  schema and content weren't inspected.
- **Live site.** `findmi.app` is outside this session's network
  allowlist, so no live page was fetched.
