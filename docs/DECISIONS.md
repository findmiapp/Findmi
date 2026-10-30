# Durable Decisions

Add an entry only when a future developer could reasonably rediscover or
re-debate the decision, when the rationale matters, or when it supersedes
an earlier approach. This isn't a changelog.

Format: **Decision** · Rationale · Supersedes · Status.

---

### Events and Occurrences (Aug–Oct 2026)
An Event is one identity. Its schedule is a Primary Date plus
`event_occurrences`. · Multi-date Events never need duplicate records. ·
Single-date mental model. · **Implemented** [SCHEMA].

### Multi-date creation up front (Oct 2026)
Creation offers Single Date / Date Range / Multiple Dates and writes to
the existing occurrence model. No recurrence rule is stored. · Users
shouldn't create a misleading single-date Event and fix it later. ·
Single-date create flow. · **Implemented** (`lib/event-create-schedule.ts`).

### Appearance model (2026)
A Business at a real-world context is an Appearance (plus `event_businesses`
for official participation), never a duplicated Business or Event. ·
Shared identity and relational integrity. · **Implemented**.

### Availability relationship model (Oct 2026)
Business (+ optional Products) at a Location, with relationships stocked ·
sold · served · featured · sampled, status pending · live · declined, and
an optional date range. · "Available here" is richer than a generic link.
· Simple business–location link. · **Implemented** [SCHEMA].

### My World retired → My Journal + My Moments (Oct 2026)
**My Moments** = a mode of `/moments`. **My Journal** = `/journal`
archive. `/my-world*` redirects. · "My World" was rejected as a concept.
Consolidation put one feed in `/moments` and a separate dated archive. ·
My World, Passbook. · **Implemented** (`aff3c4b`). The package's "My World
→ My Moments" is realized as this split.

### One personal library; Relationship vs Save vs Collection (Oct 2026)
Relationships (Want, Must Do, Have, Been, Like, Dislike), Saves
(bookmarks) and Collections (user folders) are separate concepts with
separate tables. They're presented in one Your Library. Detail pages drop
the generic Save in favor of entity-appropriate actions. · Ambiguous
"save" semantics. · Multiple saved/world pages. · **Implemented**
(`edb0915`, `b2edef2`).

### Pages I Manage (Oct 2026)
Use "Pages I Manage" for managed entities. · Clearer than ownership
wording. · **Implemented** (Account Home).

### "Coming Up" (Oct 2026)
Consumer followed content: "Upcoming Events · From Pages You Follow".
Business Manager Home keeps **Coming Up** for the owner's own schedule. ·
"Coming Up" was ambiguous for followed content and is clear for the
owner's own schedule. · **Implemented**. Owner context: confirm with the
founder if it's ever questioned.

### Business Manager primary navigation (Oct 2026)
Home · Moments · Findmi Here (center) · Performance · More. Products and
Opportunities are desktop-rail-only. · The highest-frequency surfaces stay
one tap away. · Earlier larger tab sets. · **Implemented**
(`v2/business-nav.ts`).

### Persistent Business Manager shell (Oct 2026)
The layout persists. Destination content loads independently. Cached
per-request context. · About 2–3× faster navigation, no duplicate auth.
· **Implemented**.

### Needs Attention lives inside Inbox / Follow-Ups (Oct 2026)
A count badge, not a nav item or a standalone row. · Density.
· **Implemented** (`aa7d1e2`).

### Growth → Opportunities (Oct 2026)
The destination is labelled Opportunities. Home module "Growth Manager" =
Goals · Opportunities · Ideas (· Targets). · **Implemented**.

### Findmi Here / Where I'll Be (Oct 2026)
Findmi Here = real-world presence (feature name, consumer `/find`, manager
center tab). Where I'll Be = owner-facing Appearance wording. · Express
the business's perspective, not database terms. · **Implemented**.

### Performance in primary nav, QR inside Performance (Oct 2026)
· Analytics is core, and QR measurement belongs with overall measurement.
· **Implemented**.

### Public Profile editor (Oct 2026)
Details stays first. "Public Actions" became **Profile Buttons** and moved
last. Photos is its own destination. · The label was unclear.
· **Implemented**, except the stale More-menu description (BACKLOG).

### Brand onboarding is native (Oct 2026)
`/join/brand` = Brand Build (website / Instagram / name analysis → Review
Your Brand). · Better continuity than an external form. · Tally-based
brand intake. · **Implemented**. Tally remains for vendor intake, inquiry
and claim payment.

### Hyperlocal sites reuse Findmi's data layer (Oct 2026)
Hyperlocal products (JerseyCity.guide) get their own route tree and UI and
are host-mapped in `next.config.mjs`. They reuse `lib/data.ts` and are
scoped by Market/Area/Census place. · Feature and data parity without a
fork. · The `SITE=jc` env-config idea and separate clones.
· **Implemented** for JC only.

### Communication boundary (Oct 2026)
Direct org-to-org messaging is off by default
(`DIRECT_BUSINESS_MESSAGING_ENABLED`). Commercial requests go through
Findmi (commercial inquiries). · Findmi brokers commercial relationships.
· **Implemented**.

### Map lenses and contextual filters (Oct 2026)
The Map is a multi-entity surface. Its primary control is a lens (All ·
Happening · Places, with Brands intended next). Refinements belong to a
lens, and options are offered only when the current candidates can
satisfy them. Happening is the consumer word for time-based discovery and
hides the Event vs Pop-Up data distinction. · One flat sheet of every
vocabulary value dead-ended on missing data, and Event-only refinements
silently narrowed All or did nothing under Places. · The Everything /
Events / Pop-Ups / Places sheet with always-visible options; "What =
Event categories" as the Map model. · **Implemented** for All /
Happening / Places (`lib/discovery/map-filters.ts`).

### Map time vocabulary and Happening order (Oct 2026)
On the Map the four-hour window (`when=upnext`) is called **Starting
Soon**; `/events` keeps **Up Next** for its chronological upcoming view.
Inside the Happening lens, time order is authoritative (live first, then
by start) and score only breaks ties, with no per-Brand cap. · Phone QA:
one label meant two different things across surfaces, and ranking put a
5 PM pop-up ahead of 9 AM ones on the same day. · "Up Next" on the Map;
score + diversity order in Happening. · **Implemented**
(`MAP_WHEN_LABELS`, `orderMapResults`).

### Commerce and settlement (Sept 2026, locked)
5% default fee with snapshots, vendor-paid processing by default, held
allocations, manual payouts, no Connect. See `/CLAUDE.md` §8.
