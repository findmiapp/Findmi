# Backlog

Unresolved work only. Remove an item when it's verified done. Put
uncertain completion state under **Needs live verification**, not as
active work. Reconciled against code on 2026-10-29.

## Bugs

- **Guest Moment draft precedence (test failing).**
  `tests/guest-moment-reload.test.mjs:237`: opening an Event link replaces
  an existing guest draft's title ("Earlier Story" → "Spring Pop-Up").
  The URL Event context should only fill missing fields. Deterministic,
  and it predates this reconciliation. Reuse: `lib/guest-moment-draft.ts` /
  the composer.
- **Stale copy: "Public Actions"** in the More-menu description
  (`v2/business-nav.ts` `BUSINESS_MORE_TABS.profile`). The tab is now
  "Profile Buttons".
- **Stale comment**: `v2/BusinessAppShell.tsx:14` lists the old nav order.

## Needs live verification (code exists; confirm behavior in production)

- Moments **Following** filter showing no content (October QA report).
- Brand onboarding → account Home with a pending-review state.
- Production billing mode: recurring Pro/Managed Pro configured, or the
  legacy $99 fallback?
- Performance Pro gating per view.
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
- Establish the production branch, rollback procedure and CI (none in
  repo).
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
SEO metadata/icons (reported done in October; not re-audited here).
