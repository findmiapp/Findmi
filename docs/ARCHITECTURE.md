# Architecture

Evidence tags are defined in `RECONCILIATION-2026-10-29.md`.

## Stack [CODE]

Next.js 15.5 App Router · React 18.3 · TypeScript · Tailwind 3.4 ·
Supabase (Postgres 17, Auth, Storage, RLS) through `@supabase/ssr` and
`supabase-js` · Stripe · Anthropic SDK · Resend · MapLibre GL ·
`sharp`/`heic-convert` for images · zod. Deployed on Vercel.

## Application surfaces

| Surface | Location | Auth |
| --- | --- | --- |
| Public consumer app | `src/app/(public)/**` | None (anon client + RLS) |
| Consumer account | `src/app/(public)/account/**`, `/journal`, `/my-world/journal/**` | Supabase Auth |
| Business Manager | `src/app/(public)/account/business/[id]/**` | Supabase Auth + membership |
| Founder Admin | `src/app/admin/**` | Shared `ADMIN_PASSWORD`, HMAC cookie |
| JerseyCity.guide | `src/app/jc/**` | None |
| Embed widget | `src/app/embed/business/[slug]` | None |
| APIs / webhooks | `src/app/api/**`, `src/app/q/[code]` (QR redirect), `src/app/auth/callback` | Varies |

## Auth boundaries [CODE]

`src/middleware.ts` gates two independent boundaries and never shares a
cookie between them:

- `/admin/*`: `verifyToken` from `lib/admin/auth.ts`. Session revocation
  through `ADMIN_SESSION_VERSION`. Settled. Don't rebuild.
- `/account/*` and `/my-world/journal/*`: Supabase `getUser()`.
  Guest-accessible creation entry points are `/account/business/new`,
  `/account/location/new`, `/account/event/new` and
  `/my-world/journal/new`. Identity is required only at submit, and the
  draft is preserved.

Page management permissions: `business_members`, `location_members`,
`event_members` plus `lib/permissions.ts` / `lib/capabilities.ts`.
Ownership transfer is done through RPCs.

## Data access

- Public reads: `lib/supabase.ts` (anon) and `lib/data.ts` (shared read
  layer, also used by JC).
- Signed-in reads: `lib/supabase/*` (SSR clients).
- Admin and privileged writes: `getAdminSupabase()`, server-only.
- Sensitive columns are restricted by column grants (for example internal
  commerce columns and business contact columns). Visibility is enforced
  in SQL functions such as `can_view_event` and `viewer_manages_event`.

## Shared infrastructure — reuse, don't rebuild

| Concern | Where |
| --- | --- |
| Event scheduling / occurrences | `lib/event-create-schedule.ts`, `lib/schedule-*.ts`, `lib/event-time.ts`, `lib/event-range-mirror.ts` |
| Appearances ↔ Events | `lib/appearance-event-sync.ts`, `lib/appearance-conversion.ts`, `lib/event-participation.ts` |
| Availability | `lib/business-availability-*.ts`, `lib/business-location-availability.ts`, `lib/findmi-here.ts` |
| Event import | `lib/event-import/` (one engine, Review step, then persist) |
| Location / store-locator import | `lib/location-import/`, `lib/locator-import/` (CSV) |
| Brand import / onboarding | `lib/brand-*.ts`, `lib/admin/brand-import*.ts` |
| Provenance / trust | `lib/provenance.ts` (`entity_provenance`) |
| Matching / dedupe | `lib/business-matching.ts`, `lib/location-matching.ts`, `lib/event-matching.ts` |
| Analytics | `lib/analytics/` (taxonomy, track, serverTrack, ownerPerformance, QR) |
| Discovery engine + map | `lib/discovery/`, `components/map/` |
| Moments | `lib/journal*.ts`, `lib/moment-*.ts`, `components/moments/`, `components/journal/` |
| Personal model | `lib/personal-model.ts`, `lib/collections*.ts`, `lib/product-wants*.ts`, `lib/useAccountFollow.ts` / `useAccountSaved.ts` |
| Taxonomy | `lib/taxonomy/` (v2: `taxonomy_terms`, `category_tree_v2`, aliases) |
| Media | `lib/image-variants*.ts`, `lib/media-variants-registry.ts`, Supabase Storage |
| Geography | `lib/geo/`, Census tables, `lib/geography-scope.ts`, geocode cron |
| Notifications | `lib/notifications/` (Resend, best-effort) |
| Commerce | `lib/commerce/` |
| Messaging / inbox | `lib/inbox*.ts`, `lib/communication-policy.ts` |

## Business Manager shell [CODE][TEST]

`account/business/[id]/(manager)/layout.tsx` renders `v2/BusinessAppShell`
once. Destinations are `?tab=` views of the same page, so only content
re-renders. `managerContext.ts` caches reads per request. Home modules
(Inbox, Performance) stream behind their own Suspense boundaries.
Skeletons come from `v2/ManagerSkeleton.tsx` and optimistic tab highlight
from `v2/OptimisticTabs.tsx`.

Historical measurements (390px, 4× CPU, about 40ms DB, October 2026):
Home → Moments about 1502 → 547 ms, Moments → Findmi Here about 1203 →
512 ms, Findmi Here → Performance about 1263 → 425 ms. These are history,
not SLAs.

## Hyperlocal / multi-site [CODE]

- **JerseyCity.guide** is a separate product layer at `src/app/jc/**`
  with its own UI and CSS. It reuses Findmi's data layer.
  `next.config.mjs` maps host `(www.)jerseycity.guide` to `/jc` routes.
  Scope = Market `north-jersey`, Area `jersey-city` (with child
  neighborhood Areas), or Census place `place:3436000` (`lib/jc/config.ts`).
  There's no `SITE=` env var.
- Findmi-only redirects use `missing: [jcHost]`.
- SoHo Centric, The Hamptons Guide and Explore Staten Island have **no
  code**.
- **Highperlocal** is a separate brand deployment prepared on an unmerged
  branch, with its own Supabase project. It isn't part of Findmi
  production. See `INTEGRATIONS.md`.

## Security posture [CODE]

A CSP and security headers are built in `next.config.mjs`. SSRF-safe
fetching goes through `lib/safe-fetch.ts` for importers and brand
analysis. Rate limits apply to brand lookup, anonymous Location submission,
analytics and admin login. Webhooks (Stripe, Tally) fail closed without
their secrets.

## Background work

Vercel cron `/api/cron/geocode` runs at minute 17 of every hour
(`vercel.json`). There are no other job runners.
