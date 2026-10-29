# Backlog

Unresolved work only. Remove an item when it's verified done. Put
uncertain completion state under **Needs live verification**, not as
active work. Reconciled against code on 2026-10-29.

## Bugs

- **Stale copy: "Public Actions"** (the tab is now "Profile Buttons").
  These are the user-facing occurrences. The comments, identifiers,
  `entity_public_actions` and test titles are fine as they are.
  Owner-facing:
  - `v2/business-nav.ts:84`: More description "details, Public Actions,
    links and Announcement". Proposed: "details, photos, links,
    Announcement and Profile Buttons".
  - `account/business/[id]/CustomerInquiriesForm.tsx:53`: link text
    "Public Actions". Proposed: "Profile Buttons".
  - `account/public-actions-actions.ts:120`: error "Only an owner or
    manager can change Public Actions." Proposed: "… change Profile
    Buttons."
  - `components/public-actions/PublicActionsEditor.tsx:108` ("Public
    Actions are almost ready") and `lib/public-actions.ts:96` ("Public
    Actions aren't available yet"): missing-table fallbacks. The table is
    live, so these are effectively unreachable. Proposed: "Profile
    Buttons …".
  Admin-facing (founder only, optional):
  `admin/(protected)/businesses/[id]/page.tsx:532` help text.
- **Stale plan copy:** `lib/commerce/plans.ts` lists "QR & Tools" as an
  *upcoming* Pro/Managed Pro feature that "has not shipped". In fact,
  owner self-serve QR creation has shipped and is free.
- **Stale comment**: `v2/BusinessAppShell.tsx:14` lists the old nav order.

## Needs live verification (code exists; confirm behavior in production)

- Moments **Following** (October QA report). Code investigation on
  2026-10-29 found the standalone Following filter no longer exists:
  `?filter=following` → **For You**, which puts Moments connected to
  followed Businesses/Events/Locations first (account follows + device
  lists) and shows distinct empty-state copy. Against production data,
  only 2 of 8 users with follows have any overlap with the 10 public
  Moments, so "nothing from your follows" is the *correct* result for the
  other 6. Remaining risk: matching runs client-side over the first page
  (24) only. Needs a live check while signed in as an account that
  follows a Page with a public Moment.
- Production billing mode: are the recurring env vars set in Vercel?
  Evidence points to the **legacy $99 path** (0 rows in
  `business_subscriptions`). Check `/admin/api/stripe-subscriptions-diagnostic`.
- Photos / media: Logo and Cover vs gallery as one coherent media manager.
- Square profile imagery consistency.
- Whether anything still calls the legacy `/api/follow*` / `/api/saved`.

## Map / discovery

- **Map filter audit** (active QA, Oct 28–29). Filters must be
  understandable, correctly scoped, and reflect the selected discovery
  state. Audit `components/map/MapExplorer.tsx` and `lib/discovery/map-*`
  before redesigning.

## Moments

- **Photo selection UI redesign**: replace the rejected Take Photo /
  Choose From Photos presentation while keeping grouping, organization
  and reordering (`moment-photo-composer`, `SortableImageGrid`).

## Business Manager

- Manager sub-navigation / section rail consistency across destinations.
- Growth Manager tiles as useful preview/action links: verify every
  destination is meaningful.

## Imports / integrations

- Store-locator **XML** ingestion: extend `lib/locator-import`, not a new
  importer.
- Calendar and event-platform sync (Google Calendar, iCal, Eventbrite,
  Luma, Facebook Events, Dice, Partiful, Bandsintown). Planned only. Build
  on `lib/event-import` + provenance.

## Hyperlocal

- Explore Staten Island, SoHo Centric, The Hamptons Guide: no code. Follow
  the JC pattern (`src/app/jc`, host mapping, Market/Area scope) if
  approved.
- JC parity: keep JC on the shared data layer.

## Mobile

- iOS / Android packaging path. Nothing exists yet.

## Process / technical debt

- **Migration ledger drift**: decide whether to backfill
  `schema_migrations` for the about 33 repo migrations applied out of band
  (needs approval. See `DEPLOYMENT.md`).
- Choose the preferred rollback option and decide whether to add CI (none
  in repo). The production branch is now established (see
  `DEPLOYMENT.md`).
- Legacy `membership_plans` rows (Founding 500 at `annual_price` 1, Pro
  249, Multi-Region 750) are still flagged active/public even though no UI
  renders them. Decide whether to deactivate them (needs approval; data
  change).
- Legacy identifiers to keep (route compatibility, not user-facing):
  `/my-world/journal/new` composer path, `journal_entries` table,
  `entity_public_actions`, `/join/passbook`.

## Verified done on 2026-10-29 (removed from backlog)

Multi-date Event creation up front · whole-feed Moments board swipe ·
Save / Mark As sheet · Collections · Event → Location internal link · QR
Occurrence selection and QR search · QR inside Performance · Admin Logout
· removal of "Search as Instagram Instead" · Needs Attention folded into
Home Inbox · "Coming Up" retired for consumer followed content · My World
retired · existing event importer exposed to owners (`import-event`) ·
SEO metadata/icons (reported done in October; not re-audited here) ·
Brand Build → `/account?created=<id>` "Pending Review" card (code path
verified; 5 real `pending_review` Businesses in production, latest
2026-10-27) · Performance Pro gating mapped (`PRODUCT.md` §
Monetization).
