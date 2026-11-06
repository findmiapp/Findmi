# Findmi — Discovery & Map Implementation Plan

Companion to `FINDMI_DISCOVERY_AUDIT.md`.

## Status (2026-11-06)

**Batch 1: implemented** (approved scope):
- **P0-1:** controls and attribution lifted above the `/map` sheet.
- **P0-2:** selected card is the link; View links removed; selected cards a
  step larger.
- **P1-1:** the selected label flips side and clamps its width; a new
  selection pans when hidden (archives, desktop `/map`).
- **P1-3:** duplicate List controls removed; "Feed" → "List" (`view=list`;
  `view=feed` is still read).
- **P1-5:** `/discover` → View On Map keeps Area and When. Category isn't
  carried, because the two category vocabularies differ.
- **P1-4 (partial):** the `/map` error state with Try Again.

**Batch 1 correction: implemented** (`4df9fc2`, `81467cb`). Floating,
image-rich preview anchored to the selected pin on `/map` and every archive
map (`MapFloatingPreview`, placement in `selected-label.ts`). The phone
sheet stays an independent result list.

**Batch 2: implemented**:
- **P0-3, Back restores the discovery context**
  (`lib/discovery/map-restore.ts`):
  - **`/map`:** on mount, the history entry's own URL (filters, search,
    time, area, List/Map) wins over a stale first render. Its
    `history.state` entry carries the camera, the selection (and so its
    floating preview), the sheet position and the search-derived filters.
    It's written with the replaceState `/map` already used.
  - **Archives:** the URL already held filters, view and `bbox`. A
    per-result-set `sessionStorage` hint (30 min) carries the camera,
    selection and sheet.
  - A selection that no longer exists is dropped; the camera and filters
    stay. Near Me never stores a camera.
  - Browser Back, the header back arrow (`router.back()`), and returning
    to the same result set through in-app links within 30 minutes (archives
    only) all restore.
- **P1-4 (rest), `/find` 30-result cap:** the cap hit the map markers, the
  List, the totals (`Math.min(…, 30)`, `truncated: false`), Search This
  Area, and there was no pagination.
  - Now one read per page, bounded by the existing `GEO_LIMIT` (500).
  - Honest totals ("N pop-ups …", "+" only when the bounded read is full).
  - The List pages with `limit` (Load More, "Showing X of Y"), as on
    `/events`.
  - The geo endpoint maps the whole bounded set and reports `truncated`.
  - No unbounded queries; appearances are de-duplicated by id and markers
    fold by Location.
- **Positioning fixes:**
  - **Split hover:** hovering the List only highlights its marker. The
    floating preview opens on a click, and an open preview for another
    place closes, so no card pops over nearby markers.
  - **Search This Area:** never covered (`81467cb`).
  - **Sheet / pins / controls:** re-verified in the browser at 360×640,
    360, 390, 412 and 1280.

**Close-out (2026-11-06): implemented**:
- **Homepage Explore Map:** a Findmi Aqua pill directly under the
  full-width Search, linking to `/map`. It's full width on phones and a
  compact pill from `sm`. No embedded map, and Search is untouched.
  The Oct 28 black "MAP" pill that squeezed the Search row stays rejected
  (`DESIGN-SYSTEM.md` updated).
- **Floating preview:**
  - 270px wide, with a 150px cover where the visible map allows. Shorter
    covers on short maps keep it inside the usable viewport.
  - Metadata on one line (when · where).
  - Immediate press feedback and a small "Opening…" indicator while
    navigating. It clears on a new preview, on timeout and on bfcache
    return; new-tab clicks are ignored.
  - Applies to `/map` and every archive map (shared canvas).
- **Back navigation:** the `/map` filter loss is fixed (Batch 2,
  `9067262`), and the final homepage → map → detail → Back flow passes
  in the browser.

**Workstream status:** closed. Remaining items are founder actions (the nav
row below, attaching Locations to two upcoming Events) and live checks on
production tiles and data.

**Cross-surface consistency (2026-11-06)**

| Map surface | Component | Selectable? | Interaction now |
| --- | --- | --- | --- |
| `/map` | MapExplorer → DiscoveryMapCanvas | yes | Shared floating preview (modified in earlier batches) |
| Events / Locations / Businesses / Findmi Here maps | ArchiveGeoShell | yes | Shared floating preview, using `lib/geo-preview` (refactored to the shared mapping) |
| Brand → Findmi Here → Map (e.g. Tamagotchi → Duffy Square) | AppearanceFindMiHere → ContextMap | yes | **Modified:** shared floating preview |
| Brand "Where to find" | BusinessPublicView → ContextMap | yes | **Modified:** shared floating preview |
| Product "Where to find it" | product page → ContextMap | yes | **Modified:** shared floating preview |
| Event dates map (several places) | UpcomingDatesRail → ContextMap | yes | **Modified:** shared floating preview |
| Guide map section | GuideView → ContextMap | yes | **Modified:** shared floating preview |
| Event / Location page Location block | EventLocationFeature → ContextMap (`directionsOnly`) | no (one known place) | Excluded: directions map, unchanged |
| Opportunity explore (owner) | ContextMap (`directionsOnly`) | no | Excluded: owner tool, single place |
| Business Manager map | ManagerMapView | owner tool | Excluded: no Business Manager changes |
| Moments map | MomentsMap (own place tray of Moment cards) | Moments, not entities | Excluded: approved Moments tray; needs a founder decision if it should change |

Rule: a dated result (Event date, Pop-Up) is drawn on a public discovery map only at a **listed** Location (`is_demo ≠ true`). `/map` now matches Findmi Here, the Events map and the Brands map. An unlisted (Needs Review) Location is drawn in context only on its own Business's map. Listed Locations without imagery still map, unlinked.

**Navigation (founder decision, not applied):** add a top-level **Map**
row in Admin → Site → Navigation:

| Field | Value |
| --- | --- |
| Label | `Map` |
| Destination | Existing Findmi Page → `Map` (`route_key = map`, already in `lib/public-routes.ts`) |
| Parent | none (top level) |
| Audience | Everyone |
| Visible | yes |
| Sort order | `35` (after Moments at 34, so no existing row moves) |
| Icon | `pin` (the curated, test-locked set has no map glyph; Places also uses `pin`). Or no icon. A dedicated map icon would need a small code change and its test updated: ask if wanted |

No code hardcodes a duplicate entry. The homepage Map button stays
rejected.

**Still open:** P1-2 (sheet cap tuning beyond what QA showed is needed),
the event-linked appearance fallback for map placement (latent: 0 rows
today), and P2 docs/data items. Also: with a Market filter,
`getFindMiHereFeed` over-fetches at most 200 rows before geography
filtering, so a "+" can't signal truncation there. Real volume is dozens.

Scope rules: change only what the 13 requirements need, reuse the existing
components, add no new map or sheet framework, and make no schema changes.
Effort estimates are for one developer and include test updates and
360/390/412 QA.

## Decisions needed before starting

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Selected-card tap behavior | **Two-step:** tapping an unselected row selects it (pans the map, as today). Tapping the *selected* card or the preview opens its public page. Save / Place stay as secondary buttons |
| D2 | Which List control survives on phones | **`/map`:** keep the top-bar List/Map switch (the real view change). Turn the sheet pill into nothing (the sheet header already taps and drags to expand). **Archives:** keep the heading action and drop the sheet's duplicate "List" button. Both reverse earlier test-locked choices, so an explicit OK is needed |
| D3 | `/map` "Feed" → "List" | Rename for one vocabulary (List \| Map \| Split). `view=feed` stays accepted in URLs for back-compat |
| D4 | Map entry from primary navigation | Add a "Map" nav item via **Admin → Site → Navigation** (route key `map` already exists). No code. **Don't** re-add the rejected homepage Map button |

---

## P0 — correctness / visible defects

### P0-1 `/map` mobile: controls and attribution above the sheet (Req 6)
- **Files:** `src/components/map/MapExplorer.tsx`
- **Change:** reuse `ArchiveGeoShell`'s pattern. Set `--sheet-h` on the map
  column and add
  `max-lg:[&_.maplibregl-ctrl-bottom-right]:!bottom-[calc(var(--sheet-h)+0.25rem)]`.
  Hide the controls while the sheet is above Peek or being dragged.
  (Attribution is bottom-right too, so it lifts with them.)
- **Depends on:** nothing. **Effort:** S (1–2 h)
- **Acceptance:** with the sheet at Peek, zoom +/- and the ⓘ attribution are
  visible and tappable just above the sheet. They never overlap the sheet
  handle, and no horizontal scroll appears.

### P0-2 Selected card navigates; View links removed (Reqs 1, 2, 3)
- **Files:** `src/components/map/MapResultCard.tsx`,
  `src/components/map/GeoResultCard.tsx`,
  `src/components/map/ArchiveGeoShell.tsx` (selected-card size);
  tests `tests/map-ux-completion.test.mjs`,
  `tests/discovery-engine-map.test.mjs`, `tests/archive-discovery-ux.test.mjs`,
  `tests/map-everywhere.test.mjs`
- **Change:**
  - `MapResultCard`: the `preview` variant and any `selected` row get a
    stretched `<Link>` (`after:absolute after:inset-0`, the same idiom
    `GeoResultCard` already uses). Remove the "View Event/Brand/Place"
    button and the row "View" link. Keep `Save` and `Place` at `z-10`. Feed
    rows (no `onSelect`) become whole-card links.
  - `GeoResultCard`: with `onSelect`, an unselected card selects and a
    selected card is a stretched link. Remove the "View" link.
  - Selected archive card one step larger (64px media, non-`compact`)
    within the sheet cap from P1-2.
- **Depends on:** D1. **Effort:** M (4–6 h)
- **Acceptance:** the whole selected or preview card opens the canonical
  page (`card.href`). Save and Place still work without navigating. No
  "View" text links remain on map cards. Keyboard: Tab reaches one link
  per card and Enter opens it. The focus ring is visible.

### P0-3 Back from a detail page restores `/map` context (Reqs 10, 12)
- **Step 1, verify:** on production, open `/map` → tap Today + a category →
  open a result → Back. Check the URL and chips. If the filters survive,
  skip the "initial query" part below.
- **Files:** `src/components/map/MapExplorer.tsx` (and, for the viewport and
  selection, `src/components/map/ArchiveGeoShell.tsx`)
- **Change:**
  - On mount, if `window.location.search` parses to a different query key
    than `initialQuery`, adopt the URL query. The existing `dataKey`
    comparison then refetches automatically.
  - Persist `{selected, sheet, viewport}` in `sessionStorage` keyed by the
    query key (try/catch, the same style as `findmi-geo-focus:<surface>`),
    and restore it once on mount. In archives, persist `lastView` the same
    way so Back reopens the same pan/zoom.
- **Depends on:** nothing. **Effort:** M (4–6 h)
- **Acceptance:** filters → detail → Back returns the same filters, the same
  map area (within one pan), and the same selected place with its card.
  No extra history entries are created. A fresh visit with no stored state
  behaves exactly as today.

---

## P1 — layout quality

### P1-1 Selected label never clips (Req 5)
- **Files:** `src/components/map/DiscoveryMapCanvas.tsx`,
  `src/components/map/ArchiveGeoShell.tsx`, `src/components/map/MapExplorer.tsx`
- **Change:** in the selection effect, project the point. Use
  `anchor: "right"` (label to the left) when the point is in the right half
  of the canvas, and `"left"` otherwise. Remove the ineffective
  `-translate-y-1/2`. In `ArchiveGeoShell.selectFeature` (marker tap) and on
  desktop in both shells, call `focus` only when the label rect would leave
  the padded safe area. Don't recenter on every tap.
- **Effort:** S–M (3–4 h)
- **Acceptance:** at 360/390/412 and on desktop, the selected marker's label
  is fully inside the map for markers at the left, center and right edges,
  and for names longer than 25 characters. `ContextMap` and `MomentsMap`
  are unaffected.

### P1-2 Preserve visible map with trays (Req 7)
- **Files:** `src/components/map/sheet.ts` (`PEEK_CAP`), possibly the
  `MapExplorer` preview density (show at most 2 "Happening Here" rows at
  Peek, the rest on expand)
- **Change:** cap Peek with a selection at about 0.45 of the column, and
  keep at least about 40% of the screen height as visible map between the
  top controls and the sheet at Peek.
- **Effort:** S (2–3 h, mostly QA in both shells)
- **Acceptance:** at 360×640, 390×844 and 412×915, with a multi-result
  place selected, the selected marker and its neighbors are visible above
  the sheet. A long preview scrolls inside the sheet.

### P1-3 De-duplicate List controls and align naming (Req 8)
- **Files:** `MapExplorer.tsx`, `ArchiveGeoShell.tsx`, and the tests that
  assert the current controls
- **Change:** per D2/D3. Desktop `/map` uses `ViewModeSwitch`
  (`allowSplit={false}`) instead of its own radiogroup. Drop the duplicated
  count line where the sheet header already states it.
- **Effort:** S (2–3 h)
- **Acceptance:** each phone screen has exactly one control that changes
  Map ↔ List. Labels are "List" / "Map" everywhere. `?view=feed` still opens
  the list on `/map`.

### P1-4 Honest `/find` map totals; no silent `/map` failures (Reqs 11, 13)
- **Files:** `src/app/api/geo/[surface]/route.ts`,
  `src/lib/geo-results-server.ts` (`appearanceGeo`/`appearanceResults`),
  `src/components/map/MapExplorer.tsx`
- **Change:**
  - `/find`: report the full count and `truncated: true` when the 30-item
    cap applies.
  - `appearanceResults`: for event-linked appearances without `location_id`,
    fall back to the occurrence's Location. This is latent today (0 rows),
    but it prevents silent drops.
  - `MapExplorer`: on fetch failure, show a quiet notice ("Couldn't update
    results — try again") instead of keeping stale results silently.
- **Effort:** S–M (3–4 h)
- **Acceptance:** the sheet header count matches the List total for the same
  URL, and "zoom in for more" appears when capped. A forced API 500 shows
  the notice and keeps the last results.

### P1-5 `/discover` → Map carries filters (Reqs 9, 10)
- **Files:** `src/app/(public)/discover/page.tsx` (build the href with
  `mapHref` from `lib/discovery/query.ts`)
- **Change:** map `category`, `market`, `area` and `when` to the
  DiscoveryQuery equivalents.
- **Effort:** S (1–2 h)
- **Acceptance:** `/discover?market=X&when=weekend` → "View On Map" opens
  `/map` with the same Area and This Weekend chips.

---

## P2 — discoverability, consistency, docs

| Item | Files | Effort | Acceptance |
| --- | --- | --- | --- |
| P2-1 Nav "Map" item (D4) | none: Admin → Site → Navigation | XS (founder, 5 min) | "Map" is visible in the desktop nav and the mobile drawer |
| P2-2 Filter trigger alignment (Req 11) | `MapExplorer.tsx` search-row button (an icon with an a11y label → visible "Filters" text at `sm:`), with no engine change | S | `/map` and archive filter triggers read alike. Badge counts match the active filters |
| P2-3 Archive strip browsing pans to an off-screen marker (Req 4) | `ArchiveGeoShell.tsx` `onStripScroll` | S | A browsed card's marker is always on-screen |
| P2-4 Canonical docs | `docs/CONSUMER-EXPERIENCE.md`, `docs/ROUTES-AND-IA.md`, `docs/DESIGN-SYSTEM.md` (map card and sheet conventions), `docs/BACKLOG.md` (replace "Map filter audit" with what's left), `README.md` (remove "No map SDK") | S | No `/docs` statement contradicts the code (Map Everywhere, Map-first default, `view`/`bbox` params) |
| P2-5 Data, not code | Attach Locations to the 2 upcoming Events without one (Admin) | XS | Both Events appear on `/map` and `/events?view=map` |

**Out of scope (unchanged):** merging `MapFilterSheet` with `RefineSheet`;
merging `MapResultCard` with `GeoResultCard`; a shared sheet-drag hook; Brand
hosted-Event presence (already in `BACKLOG.md`); any visual redesign.

---

## Effort summary

| Priority | Items | Estimate |
| --- | --- | --- |
| P0 | P0-1, P0-2, P0-3 | ~1.5–2 days |
| P1 | P1-1 … P1-5 | ~1.5–2 days |
| P2 | P2-1 … P2-5 | ~0.5 day (+ founder/admin actions) |
| **Total** | | **~3.5–4.5 developer-days** |

Dependencies: D1 → P0-2. D2/D3 → P1-3. P1-2 should land with or after P0-2,
because larger selected cards interact with the sheet cap. P0-3 starts with
the live verification step.

## Test matrix

Run `npm run build`, `npm run lint`, and `npm test` (name pre-existing
failures separately). Then do manual QA on the deployed preview:

| Scenario | 360×640 | 390×844 | 412×915 | Desktop 1280 | Desktop 1536 |
| --- | --- | --- | --- | --- | --- |
| `/map` Peek: zoom + attribution visible above sheet | ✓ | ✓ | ✓ | n/a (side panel) | n/a |
| Tap marker at left / center / right edge: label fully visible | ✓ | ✓ | ✓ | ✓ | ✓ |
| Selected card → whole card opens the page; Save doesn't navigate | ✓ | ✓ | ✓ | ✓ | ✓ |
| No "View" text links on map cards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Marker ↔ card selection sync (marker tap, card tap, Split hover) | ✓ | ✓ | ✓ | ✓ (Split) | ✓ (Split) |
| Visible map ≥ ~40% with a selection at Peek | ✓ | ✓ | ✓ | — | — |
| Exactly one Map↔List control per screen; labels "List"/"Map" | ✓ | ✓ | ✓ | ✓ | ✓ |
| Filters → detail → Back restores filters, area and selection (`/map`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Same on `/events`, `/locations`, `/businesses`, `/find` (Map and Split) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Map ↔ List keeps filters, `bbox` and lens | ✓ | ✓ | ✓ | ✓ | ✓ |
| Search This Area appears only after a real move; narrows the results | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/discover` → View On Map keeps Area/When | ✓ | ✓ | — | ✓ | — |
| `/find` count matches the List; capped → "zoom in for more" | ✓ | — | ✓ | ✓ | — |
| Empty / failed / loading states render (offline toggle for failure) | ✓ | — | ✓ | ✓ | — |
| No horizontal page scroll; sheet drag doesn't scroll the page (iOS Safari, Android Chrome) | ✓ | ✓ | ✓ | — | — |
| Keyboard: Tab order, Enter opens the selected card, Escape closes the preview | — | — | — | ✓ | ✓ |
| Detail-page `ContextMap` and Moments Map unaffected by canvas changes | ✓ | — | ✓ | ✓ | — |
