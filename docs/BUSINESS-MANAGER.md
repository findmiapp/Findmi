# Business Manager

The operational interface for a managed Business at
`/account/business/[id]`. It answers: what needs attention, where will I
be, where am I available, what have I published, which products and QR
codes do I have, which opportunities should I act on, how am I performing,
and what does the public see.

Routes and tab keys are in `ROUTES-AND-IA.md`. The single nav definition
is `v2/business-nav.ts`.

## Shell [CODE][TEST]

- Persistent layout: `(manager)/layout.tsx` → `v2/BusinessAppShell`
  (identity, account switcher, rail or bottom bar, Search and Inbox
  icons). Only page content re-renders between tabs.
- `managerContext.ts`: per-request cached core reads, shared by the
  layout and the page. Duplicate auth work was removed.
- Nav order: **Home · Moments · Findmi Here · Performance · More**.
  Products and Opportunities show on the desktop rail only.
- Minor drift: the doc comment at `v2/BusinessAppShell.tsx:14` still lists
  "Home · Findmi Here · Moments …". The code order is correct.

## Home (`overview`) [CODE][TEST]

Order (from `012cd7b` / `aa7d1e2`): Status → sticky section nav →
**Create & Manage** (swipe rail of Events, Locations, Products, QR Codes,
Moments, Targets cards + Add / View All) → **Coming Up** (chronological
rail, up to six; a multi-date Event is one card with "+ N More Dates") →
**Inbox / Follow-Ups** (ranked over follow-ups, inbox threads and requests,
from `lib/home-inbox.ts`. The **Needs Attention** count is an amber badge
in this heading, not a row) → **Growth Manager** (Goals · Opportunities ·
Ideas tiles with real statuses) → **Performance** pulse (Impressions,
Profile Views, Actions, Followers, Last 30 Days. Change labels are Pro
only) → Public Profile link. Inbox and Performance stream behind their own
Suspense boundaries.

## Findmi Here (`findmi-here`) [CODE]

Real-world presence. Lenses: **Upcoming** (Where I'll Be management:
hosted Events plus Appearances, without exposing the internal split) ·
**Places** (Find Us Here = Availability, Our Locations =
`business_locations`) · **Past**. Bulk Find Us entry is in `v2/FindUsBulk`.

The **+ Add** sheet (`v2/AddToPresence`, `v2/createActions.ts`) lets the
owner choose by intent: Where I'll Be · Host an Event · At a Location · Add
To Product Catalog · Create A QR Code, plus Grow Your Business shortcuts.
Reuse Appearances, Availability, `event_businesses` and Locations. Never
add a parallel presence model.

## Events, Appearances, import

- Event creation offers **Single Date / Date Range / Multiple Dates** up
  front (`lib/event-create-schedule.ts`) and writes Primary Date +
  occurrences. Done. [CODE][TEST]
- Owner event import: `import-event` (URL, paste, multi-paste, Review,
  persist) on the shared `lib/event-import` engine. Location quick-create
  and confirmation happen during review. [CODE][TEST]
- Store locator / Location import: `import-locations` (CSV and website)
  with history. [CODE]

## Moments (`moments`) [CODE]

The Business's Moments and their display curation (`entity_moment_display`,
`v2/MomentProfileControl`).

## Performance (`performance`, `qr`) [CODE]

Headline metrics, discovery sources, ranked Appearances and Products,
audience and followers (`lib/analytics/ownerPerformance.ts`). QR Codes is
a view inside Performance: a searchable, grouped list
(`QrCampaignGroups`), an intelligent creator with Occurrence selection
(`qr/new/QrIntelligentCreator`), and per-code detail (unique visitors,
actions). QR creation isn't plan-gated. Exact Pro gating per view:
[VERIFY].

## Products (`products`) [CODE]

Catalog, marketplace distribution and readiness
(`MarketplaceReadinessPanel`), product sets used in Availability, and
where each product is available.

## Opportunities (`growth`) [CODE]

Set Goals · Opportunities (inbox and Explore listings) · Ideas · Set
Targets. Threads at `opportunities/[recipientId]`. Commercial terms come
from `opportunity_options`.

## More [CODE]

- **Public Profile** (`profile`): tabs Details · Photos · Contact & Links ·
  Announcement · **Profile Buttons** (`entity_public_actions`). The More
  description still says "Public Actions". That's stale copy (BACKLOG).
- **Photos** (`gallery`): its own destination again. Logo/Cover handling
  vs gallery as one coherent media manager: [VERIFY].
- Inquiry Settings, Orders (marketplace fulfillment), Plan & Settings (Pro,
  areas).

## Do not rebuild without auditing

Manager shell, auth/session handling, Events/Occurrences, multi-date
creation, Appearances, Availability, QR creation and analytics,
Performance, Products, Moments, event importer, location/locator import,
provenance, Opportunities, Targets/Follow-Ups, inbox, host routing.
