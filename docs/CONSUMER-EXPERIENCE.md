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
- `/map`: Discovery Map (MapLibre, clusters). **Active QA**. Don't redesign
  it before auditing `components/map/MapExplorer.tsx`.
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
