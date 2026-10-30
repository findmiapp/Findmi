# Consumer Experience

## Home (`/`) [CODE][TEST]

A discovery surface, not a feed. The render order is locked by
`tests/homepage-section-order.test.mjs` (see `ROUTES-AND-IA.md`).
Curation is deterministic (`tests/homepage-curation-contract.test.mjs`):

- **What's Happening**: up to 10 Events.
- **Brands We Love**: tiered by upcoming presence (Appearances or hosting
  a live Event with an upcoming occurrence), then soonest, name, id. No
  random shuffle.
- **Featured Locations**: listed Locations with a renderable cover. Only
  `location_visibility = 'hidden'` is withheld.
- **Moments module**: category rail + card rail. Heading actions View All
  (`/moments`) and My Journal (`/journal`). No mode switch.
- Founder-controlled rows, bulletins, lanes and navigation come from
  `/admin/site/*`.

## Discovery

- `/discover`: Discovery Engine (`lib/discovery/`), with topics, chips,
  commercial lens, and Right Now / time filters.
- `/explore/[market]/[area]`: geographic discovery.
- `/find`: **Findmi Here** feed (appearances by now / today / weekend /
  anytime). **Here Now** only when actually live.
- `/map`: Discovery Map (MapLibre, clusters; `components/map/MapExplorer.tsx`,
  `lib/discovery/map-*`). Visual polish is still in QA; the filter model
  below is canonical.

### Map lenses and filters [CODE][TEST]

`lib/discovery/map-filters.ts`, `tests/map-filters-p0.test.mjs`,
`tests/map-p0-corrections.test.mjs`.

- **Lens** is the primary control and leads the chip rail: **All ·
  Happening · Places**. The intended hierarchy adds **Brands** (its own
  Map pass, starting from `lib/geo-results-server` `brandPresence` /
  `brandResults`). No placeholder until it exists.
  - **All**: every type, with broad search, geography and Near Me.
    Under All the filter sheet shows only the lens and "Choose what you
    want to explore to see more filters."
  - **Happening**: time-based discovery. Internally Events + Pop-Ups
    (`type=event&type=appearance`). Refinements: time, Event category /
    format, cost, perks, audience, entry.
  - **Places**: discoverable Locations. Refinement: Open Now. Never
    carries time.
- The lens never changes silently. A time or Free shortcut tapped under
  All visibly switches the lens to Happening (turning that same shortcut
  off again returns to All). Places hides time filters instead of
  switching the lens. The URL is normalized so the visible lens is what
  runs.
- **Time shortcuts** (rail and sheet): Happening Now · **Starting Soon**
  · Today · This Weekend (the sheet adds Tomorrow, This Week, Next Week,
  This Month, Next Month and custom date, range, month and year).
  **Starting Soon** = not started yet and begins within the next 4 hours
  (`time.ts` `UP_NEXT_HOURS`; URL `when=upnext`). The Map never labels
  it "Up Next": `/events`' **Up Next** is a different thing, its
  chronological "everything upcoming" view (`lib/event-filter.ts`). The
  homepage's "Up Next" wording isn't covered by this definition.
- **Happening order is chronological**: live first (ending soonest),
  then upcoming by start time; score (proximity, Featured, image,
  follows) only breaks ties. No per-Brand cap in Happening. This reads
  correctly for Happening Now (ending soonest), Starting Soon (by start),
  Today (live, then by start) and This Weekend (Fri → Sat → Sun). All
  and Places keep score + Brand diversity (`orderMapResults`).
- **Near Me** asks for the browser's location only on a tap
  (`Permissions-Policy: geolocation=(self)`; `/embed` keeps it off). The
  chip shows **Locating…** while the browser answers. Failures are told
  apart (location off for this page, access denied, unavailable, timed
  out) and the map stays usable. The position is rounded to about 100 m,
  held in memory only and never put in the URL; it shapes a 1.5 mi
  viewport. Found but empty: "Nothing near you right now" (or "…matches
  these filters"), with Wider Area as the next step.
- **Markers** (shared canvas, every map): clusters show a count; a
  result shows its Location's or Brand's logo in a compact shell from
  zoom 12.5; no logo → an Aqua dot with an initial; a logo that can't be
  drawn → the Findmi Place mark (`components/map/marker-images.ts`).
  The selected result's label is kept wholly inside the usable map area
  (screen edges, top controls, results sheet, map controls), and its
  second line is dropped when it would only repeat the name.
- Event categories are the Happening refinement, **not** the Map's final
  "What" model. Place categories and Business categories are planned;
  no cross-entity taxonomy mapping exists or is invented.
- **Availability**: options appear only when the current candidates can
  satisfy them (`mapFacets`, one dimension at a time with every other
  constraint applied). An applied option always stays visible and
  removable, even at zero results. This includes the named time
  shortcuts (custom date controls aren't enumerated); the lens control
  itself is always visible. Free, perks, audience and entry stay in the
  engine and surface on their own when data supports them.
- **One definition of applied refinements** (`mapRefinements`) drives
  the Filters badge, the chip rail and the sheet's Clear. Geography and
  the typed search aren't refinements. Refinements the sheet has no
  control for (Topics, Family, access, a legacy single-kind lens) show
  as removable **Also Applied** chips.
- **Clear** removes refinements and keeps the lens, geography, the
  typed search and the Brands that search resolved to.
- Old `type=event` / `type=appearance` links still work: they show as
  Happening plus a removable "Events Only" / "Pop-Ups Only" chip.
- Selecting a marker shows its first results with **Show All N Here**
  for the rest. A result picked from the list leads its marker's
  preview.
- `/search`: search across entities.
- `/guides/[slug]`: curated Discovery Pages.

## Moments [CODE][TEST]

- `/moments`: **Explore · For You · My Moments** on one control row, with
  Feed | Map. Category chips (All, Food & Drink, Pop-Ups, Classes,
  Outdoors) are shared across modes. **Swiping the feed surface moves to
  the adjacent category** (board swipe).
- Signed-out For You shows a compact "Personalize For You" prompt and
  still shows fallback Moments. Signed-out My Moments shows an
  intentional sign-in state.
- Moments map: Moments placed by their real Location (or an Event date's
  Location), never geocoded and never a Business. Tapping a place opens a
  result tray.
- A `following` filter exists with its own empty state. A Following-
  returns-nothing bug was reported in October QA. Live status: [VERIFY].
- **My Journal** (`/journal`): personal archive, Day/Week/Month/Year,
  newest first.
- Composer (`/my-world/journal/new`): guest-first. Signed-out users can
  draft. Identity is required at Save & Publish, and the draft is kept
  (`lib/guest-moment-*`). One guest draft per device. Reopening the same
  context restores it, and URL context only fills what it lacks. Opening a
  different Event / Business / Location / Product context while a Moment
  with real content is in progress asks first (**You Have A Moment In
  Progress**: Continue Moment restores it with its own context; Start A
  New Moment keeps it stored until the new Moment's first edit). Never a
  silent merge. Sections include The Experience, The Place, Food
  & Drink, Products, People, Details, Favorites. Connections to Business /
  Product / Event / Occurrence. Visibility and draft/published states.

## Personal model [CODE][SCHEMA]

From `lib/personal-model.ts`:

- Detail pages have **no generic Save**. Product: Want / Have. Event: Want
  To Do / Been. Location: Want To Go / Been. Business: Follow. Add to
  Collection works everywhere.
- Mark As sheet (`SaveOrganizeSheet`): relationship states + Collections.
- **Your Library** (`/account/saved`): Things I Want · Want To Do · Want To
  Go · Must Do · Have & Been · Following · Saved (legacy bookmarks) +
  Collections. Empty filters are hidden.
- Signed out: device-local saves and follows, imported idempotently on
  sign-in (local data is never cleared).

## Account Home (`/account`)

Personalized sections: Events / Places / Products / Brands You Might
Like, From Pages You Follow, Upcoming Events (From Pages You Follow), Your
Recent Moments, Pages I Manage, Events You Manage, Needs Your Attention,
Inbox, Pending Claims. Pending-review Pages show a "Pending Review" state.

## Public entity pages

Business, Location, Event and Product pages are part of one connected
graph. An Event at a Findmi Location links to the Location page
(`EventLocationCard` → `publicLocationHref`) [CODE][TEST]. Event pages show
the Upcoming Dates rail, rosters per occurrence, calendar actions and
attendance CTAs. Locations show hours, "Happening Here" / "Coming Up Here",
and businesses found there.

## Onboarding

- `/join/brand`: **Brand Build**. Enter a website, Instagram or name.
  Findmi analyzes the site (optionally with Claude enrichment and verified
  Instagram discovery) and prepares a candidate for Review Your Brand,
  carried in a signed draft cookie (`BRAND_DRAFT_SECRET`). Fallback: "Search
  as a Name Instead". The "Search as Instagram Instead" option is gone.
- Post-submit redirect to account Home with pending review: [VERIFY] live.
- `/join/business`: Findmi For Business. `/upgrade/pro`: plans.
