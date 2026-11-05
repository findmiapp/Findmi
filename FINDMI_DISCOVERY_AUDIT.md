# Findmi — Consumer Discovery & Map Audit

**Type:** read-only audit. No code, schema, or package changes were made.
**Branch / HEAD audited:** `claude/findmi-discovery-map-audit-o0rv9x` @ `36f2448`
**Date:** 2026-11-05
**Evidence used:** source code (strongest), `tests/*.test.mjs`, `/docs`, and
read-only production queries through the Supabase MCP (project `findmi`).

**Runtime limits.** This sandbox has no `node_modules`, and the audit brief
forbids installing packages, so nothing was run in a browser. Every behavior
marked IMPLEMENTED comes from code plus the tests that already exist for it.
Anything that depends on how a real browser behaves (scroll, history,
gestures, pixel layout) is marked UNVERIFIED unless code alone settles it.

---

## 1. Current architecture

Findmi already has **two separate map systems**. Both draw with the same
MapLibre canvas.

### 1a. Discovery Map: `/map`

| Layer | File | Role |
| --- | --- | --- |
| Route | `src/app/(public)/map/page.tsx` | Turns the URL into a `DiscoveryQuery` (`lib/discovery/query.ts`), falls back to `DEFAULT_MAP_BBOX` (lower/mid Manhattan), and renders the first result set on the server through `runMapDiscovery` |
| Engine | `src/lib/discovery/map-server.ts`, `map-core.ts`, `time.ts`, `engine.ts`, `search-state.ts`, `chips.ts` | Loads candidates: occurrences, appearances and places joined `!inner` to a real Location (`loadMapItems`). It checks time in each occurrence's own timezone, then ranks, diversifies, pages (24 per page), and builds chips and relaxations |
| API | `src/app/api/discovery/map/route.ts` (+ `/preview`) | The same engine on the client side, plus `focus=`, `count=1` and `nl=` (natural-language search) |
| Client shell | `src/components/map/MapExplorer.tsx` (774 lines) | One query and one result set with two renderers: **Map** and **Feed**. Has its own search bar, quick chips, mobile bottom sheet, desktop side panel (38%), Search This Area, Near Me, and a filters button that opens `MapFilterSheet` |
| Card | `src/components/map/MapResultCard.tsx` | `row` variant (Feed, desktop list, mobile sheet list) and `preview` variant (selected place) |
| Filters | `src/components/map/MapFilterSheet.tsx` | Client-state filter sheet with a live result count |
| Sheet math | `src/components/map/sheet.ts` | Pure functions: Peek/Browse/Expanded heights sized to content (`PEEK_CAP 0.62`, `BROWSE_CAP 0.56`), drag snapping, and the `movedMeaningfully` check for Search This Area |
| Canvas | `src/components/map/DiscoveryMapCanvas.tsx` | Native MapLibre layers on one clustered GeoJSON source (cluster → dot → logo → label → label + status). The **selected** result is the only DOM marker. Never fetches on pan |
| Chrome | `src/components/SiteChrome.tsx:80` | `/map` is full-bleed with no footer |

### 1b. Map Everywhere: archive List / Map / Split

| Layer | File | Role |
| --- | --- | --- |
| Shell | `src/components/map/ArchiveGeoShell.tsx` (586 lines) | Wraps the server-rendered List of `/events`, `/locations`, `/businesses` and `/find`. Adds Map mode (a fixed full screen on phones with its own sheet) and Split (desktop map beside the list, with hover ↔ marker sync) |
| View rule | `src/lib/geo-results.ts` `resolveView` | An explicit `?view=` always wins. **A fresh visit opens Split** (on phones that means the Map screen). `/find` opens Map because it has no Split. Locked by `tests/map-everywhere-final.test.mjs:143` |
| Param parsing | `src/lib/archive-params.ts` | One reading of each archive's URL, shared by the List page and the geo endpoint |
| API | `src/app/api/geo/[surface]/route.ts` | `eventGeo`, `placeGeo`, `brandGeo` and `appearanceGeo` in `src/lib/geo-results-server.ts` |
| Card | `src/components/map/GeoResultCard.tsx` | Archive sheet card. With `onSelect`: tapping selects and a separate "View" link navigates. Without it: the whole card is a link |
| View switch | `src/components/map/ViewModeSwitch.tsx` | List \| Map \| Split (desktop) |
| Filters | `src/components/discover/RefineSheet.tsx` | A GET form filter sheet driven by the URL |

### 1c. Other map consumers (same canvas)

- `src/components/map/ContextMap.tsx`: detail-page maps (Event location,
  Business, Product), with a "View On Map" deep link (`contextMapHref`).
- `src/components/moments/MomentsMap.tsx`: Moments Feed | Map, with a
  selected-place tray.
- `src/components/map/ManagerMapView.tsx`: Business Manager map.
- `src/components/UpcomingDatesRail.tsx`, `AppearanceFindMiHere.tsx`,
  `guides/GuideView.tsx`: Cards / List / Map via `ViewToggle` +
  `useStoredView`.

### 1d. Entry points into map exploration

| Entry | Evidence | Map reachable? |
| --- | --- | --- |
| Header nav (production `nav_items`) | Top level: Discover, Events, Places, Brands, Moments. Children include Findmi Here and Happening Now (`/events?when=live`). **There is no `/map` item** (live query) | Yes, indirectly: Events, Places, Brands and Findmi Here open **Map-first on a fresh visit** |
| Homepage `/` | No map link anywhere in `page.tsx`. A homepage Map button was tried and **reverted** (`4a2aa92` → `1c34590`). `docs/DESIGN-SYSTEM.md` lists "Homepage Map button next to Search" as a **rejected pattern** | No direct entry. Homepage links into archives open Map-first |
| `/discover` | `discover/page.tsx:172` has "View On Map" → plain `/map` | Yes, but **filters are dropped** |
| Detail pages | `ContextMap` "View On Map" → `/map?bbox=…` / `?place=` / `?brand=…` | Yes, scoped |
| `/search` | No map | No |
| `/moments` | Feed \| Map toggle | Yes, Moments only |

### 1e. Live data shape (read-only, 2026-11-05)

- Locations: 71 total, 68 geocoded. 63 listed, of which 60 are geocoded.
- Upcoming scheduled, non-demo occurrences: **3**. One has a Location. Two
  ("KILLMEYER'S 3RD ANNUAL German Christmas MARKET" and "Kahlúa + Dunkin'
  Friendsgiving Event") have **no Location and no coordinates**, so they
  correctly don't appear on any map.
- Upcoming, not-canceled appearances: **19**. Ten have a Location (4
  standalone, 6 event-linked). Nine don't (7 standalone, 2 event-linked).
- Every upcoming occurrence has a timezone and an end time.

So on production the map is currently dominated by **Places** (60). Dated
content is thin: about 1 Event and about 10 Pop-Ups. That is a data
condition, not a code fault, but it shapes what QA will see.

---

## 2. Existing functionality (verified in code + tests)

| Capability | `/map` | Archives (Map Everywhere) |
| --- | --- | --- |
| Clustering, zoom-tiered markers, logo shells, LIVE as a word and not just a color | ✅ `DiscoveryMapCanvas` | ✅ same canvas, plus up to 6 promoted labels |
| Marker ↔ card selection as one shared state | ✅ `selectFeature` / `selectCard`; one rich DOM marker (`DiscoveryMapCanvas.tsx:383-397`) | ✅ `selectFeature` / `selectResult`; strip browsing highlights the marker; Split hover selects |
| Pan the selected marker clear of the sheet | ✅ mobile only (`MapExplorer.tsx:618-624`) | ⚠️ only when a card is tapped (`selectResult`), not when a marker is tapped |
| Search This Area (only after a meaningful move) | ✅ `movedMeaningfully`. Client state, not pushed to history | ✅ writes `bbox` into the URL, plus a removable "Map Area" chip |
| Mobile bottom sheet (Peek / Browse / Expanded, sized to content) | ✅ | ✅ (Peek is a horizontal strip) |
| Map/List switching keeps filters | ✅ same query in client state | ✅ the URL is the source of truth; `router.push` with `view` |
| Map → List keeps context | n/a | ✅ scrolls to and highlights the selected item (`ArchiveGeoShell.tsx:138-191`) |
| URL state | ✅ `replaceState` of the whole query plus `view` (never the viewer's position) | ✅ every filter, `view` and `bbox` are in the URL |
| Loading state | ✅ spinner in the search field, "Finding…", skeleton canvas | ✅ "Finding…", skeleton |
| Empty state | ✅ "Nothing matches all of these filters." plus counted relaxations | ✅ "No {Events} match these filters." / "None of these … are on the map yet." plus Show List |
| Partial geography honesty | ✅ `mapReady` and `truncated` notices | ✅ "N on the map · M without locations" |
| Map failure | ✅ "The map couldn't load right now…" | ✅ "The map couldn't load. The List still has every result." |
| Near Me | ✅ only after an explicit tap; position coarsened and never in the URL | — |
| Natural-language search | ✅ `nl=` → structured query; Clear also removes derived filters | List search field (GET) |
| Time accuracy | ✅ occurrence-local timezone windows (`lib/discovery/time.ts`); live = `starts_at ≤ now < ends_at` | ✅ the archive's own data functions (`getEventsDiscoveryRows` etc.) |
| Privacy | ✅ Events that withhold their location never reach a map | ✅ `withholdPreciseLocation` on the `/find` feed |

---

## 3. Requirement-by-requirement classification

| # | Requirement | Status | Evidence | Remaining work |
| --- | --- | --- | --- | --- |
| 1 | Selected map cards slightly larger | **PARTIAL** | `/map` preview is already larger than rows (96px image vs 72px, 4 perks vs 2: `MapResultCard.tsx:59,67`). Archive selected cards still use `GeoResultCard compact` (56px image) in the strip, the vertical list and the desktop overlay (`ArchiveGeoShell.tsx:486,494,512`) | Give the archive's selected state a larger card size. Balance it against req 7 |
| 2 | Whole selected card navigates to its public page | **PARTIAL** | `/map` preview: only the title (`Link`) and the "View Event/Brand/Place" button navigate; the card body does not (`MapResultCard.tsx:91-99,118-129`). `/map` Feed rows: title link only, with no stretched link. Archive: the desktop selection overlay **is** whole-card (`GeoResultCard` without `onSelect` uses `after:absolute`). The mobile strip and list cards only *select* when tapped, even when already selected | Stretched link on the preview and on already-selected cards. Whole-card link on Feed rows. Keep Save / Place as secondary actions above the link (`z-10`) |
| 3 | Separate View links unnecessary | **PARTIAL (still present)** | "View" text links on every row (`MapResultCard.tsx:132-138`, `GeoResultCard.tsx:58-62`). "View Event" button on the preview (`:120`). Tests assert "View Event" (`tests/map-ux-completion.test.mjs:197,207`, `tests/discovery-engine-map.test.mjs:546`) | Remove the links after req 2 lands. Update those tests (they encode approved copy, so this needs sign-off) |
| 4 | Selected marker and selected card stay in sync | **IMPLEMENTED** (with gaps) | One `selected` state drives both the canvas (`selectedId`) and the cards in both shells. The population marker is filtered out and replaced by the DOM marker. Any query change clears both (`apply`) | Gap: archive strip *browsing* highlights a marker without panning to it, so the highlight can be off-screen. UNVERIFIED on device |
| 5 | Marker labels never clip outside the viewport | **BROKEN (selected label, by code geometry)** / UNVERIFIED (native labels) | The selected DOM marker is always anchored `"left"` with the label extending right, up to about 232px (`DiscoveryMapCanvas.tsx:122-145,396`). `/map` mobile centers the selection (`easeTo` center at x≈195 on a 390px screen with 28px padding), so the label spans about 177→409px and **clips at 390px and at 360px** for long names. The archive and the desktop `/map` don't pan when a marker is tapped, so a marker near the right edge clips there too. Native symbol labels use `text-optional` and collision handling, but MapLibre can still cut labels at the canvas edge. The `-translate-y-1/2` class on the DOM marker has no effect because MapLibre writes the element's inline `transform` | Pick the anchor side by screen position (flip to `"right"` in the right half), or clamp. Pan on marker tap wherever the label wouldn't fit |
| 6 | Markers/labels never overlap map controls | **BROKEN on `/map` mobile** / PARTIAL elsewhere | `/map` mobile: `NavigationControl` is added at bottom-right (`DiscoveryMapCanvas.tsx:182`), and the compact **attribution** sits at the bottom too. The results sheet (`absolute bottom-0 z-10`) covers both permanently: zoom buttons are unreachable and **OSM/OpenFreeMap attribution is hidden** (a licensing concern). `ArchiveGeoShell` already fixes this by lifting controls above the sheet with `--sheet-h` (`:562-563`). `MapExplorer` doesn't. The top search and chips overlay the map, so markers can render under them (camera padding only affects fits and focus). The archive desktop selection overlay (`bottom-3 left-3 w-96`) can cover markers | Port the `--sheet-h` lift to `MapExplorer`. Pan the selected marker into the safe area on desktop as well |
| 7 | Bottom trays keep enough map visible | **PARTIAL** | The content-sized sheet is good. But `PEEK_CAP = 0.62`, so a long selected preview can take 62% of the map column. On `/map` mobile the top controls already reserve about 110–130px. At 360×640 with a selection, visible map can drop to about 25–30% of the screen (computed from caps; UNVERIFIED in a browser). `MomentsMap` reserves 190px. The archive's `topReserve` is fixed at 64 | Lower the Peek cap with a selection (e.g. ≤ 0.45) and/or tighten the preview. Guarantee a minimum map band |
| 8 | Duplicate List controls / redundant text | **PARTIAL (duplicates exist, partly by design)** | `/map` mobile Map view has **two "List"-looking controls that do different things**: the top-bar icon (→ Feed view, `MapExplorer.tsx:460-462`) and the sheet pill "List"/"Map" (expands or collapses the sheet, `:715-720`). Desktop adds a third "Map \| Feed" radiogroup (`:756-762`). The archive mobile Map has **two List buttons with the same action**: the heading action (`ArchiveGeoShell.tsx:385-398`) and the sheet "List" (`:473-476`). Both are asserted by tests (`tests/archive-discovery-ux.test.mjs:201,212`, `tests/map-ux-completion.test.mjs:181-184`). Naming is inconsistent: `/map` says **Feed**, archives say **List** | A decision is needed on which control stays (see the implementation plan). Then update the tests. Rename `/map` "Feed" → "List" for consistency (copy change, needs approval) |
| 9 | Map exploration immediately discoverable from primary entry points | **PARTIAL** | Events, Places, Brands and Findmi Here **already open Map-first** on a fresh visit (`resolveView`), so every primary nav item already lands on a map on phones. The standalone `/map` (time chips, NL search, Near Me) has **no nav item** in production `nav_items` and no homepage entry. A homepage Map button is a **documented rejected pattern**. `/discover` "View On Map" exists | Recommend a founder-controlled nav item (Admin → Site → Navigation → route key `map`, which already exists in `lib/public-routes.ts:32`). That needs no code. Don't re-add a homepage Map button without explicit approval |
| 10 | Map/List switching preserves filters and state | **IMPLEMENTED** (filters) / PARTIAL (other state) | `/map`: same query object, and switching never refetches (test `map-ux-completion.test.mjs:176-187`). Archives: URL push with `view`; filters, `bbox` and lenses persist; Map→List focuses the selected item. Not preserved: an archive's **map viewport when it has no `bbox`** (in-memory `lastView` only, lost on remount); `/map` → `/discover` and back; `/discover` → `/map` drops `/discover`'s filters | Carry `/discover` params into `/map` |
| 11 | Filters easy to access and consistent | **PARTIAL** | Two separate filter systems: `/map` uses `MapFilterSheet` (client state, live count, full DiscoveryQuery vocabulary). Archives use `RefineSheet` (server GET form, per-archive modules). Also present: `FilterSheet`, `CategoryFilterSheet`. Entry styles differ (icon-only sliders button vs a "Refine" text trigger). Time lenses differ (`/map` chips: Happening Now / Up Next / Today / This Weekend / Free / Near Me; `/events` tabs come from `TIME_TABS`) | Don't unify the engines (a large rewrite). Align trigger affordance and label, and time-lens labels, where cheap |
| 12 | Returning from a detail page restores discovery context | **UNVERIFIED — high risk on `/map`** / PARTIAL on archives | `/map` keeps its state in client memory and writes the URL with `window.history.replaceState` (`MapExplorer.tsx:213-216`). On Back, Next 15 can restore the page from the RSC tree rendered for the **original** URL. `MapExplorer` would then mount with the original `initialQuery`, and its replaceState effect would **overwrite the URL with the unfiltered query**. This is a plausible filter-loss regression that needs a live test. Selection, sheet state and pan/zoom (without Search This Area) are never persisted. Archives: filters, view and `bbox` survive Back because they're in the URL. Selection, sheet state and viewport (without `bbox`) are lost, and the map re-fits to the results | Verify live. If confirmed: initialize from `window.location.search` when it differs from the server query, and store selection/viewport per URL in `sessionStorage` (the pattern `ArchiveGeoShell` already uses for `findmi-geo-focus`) |
| 13 | Geographic and time results reflect the data | **PARTIAL** | Strong: canonical Location is the only geographic anchor; no invented points; occurrence-local time; live = real start/end; privacy withholding; the honest "without locations" count. Issues: **(a)** `/find` map is capped at 30 with no disclosure. With `bbox`, `total: Math.min(inside.length, 30)` and `truncated: false` (`api/geo/[surface]/route.ts:33-35`); without it, `appearanceGeo(when, 30)` reports `total = items.length` ≤ 30. **(b)** Brand map Pop-Ups ignore hosted Events (`brandPresence`, already in `BACKLOG.md`). **(c)** `appearanceResults` maps an appearance only by its own `location_id`. An event-linked appearance whose Location lives only on its occurrence would be dropped. Production has 0 such rows today, so this is latent. **(d)** `/map` requires `location:locations!inner` on occurrences, so Events whose occurrence lacks a Location are excluded. That's correct, but 2 of 3 upcoming Events are currently unmapped because of data | Make the `/find` total and `truncated` honest. Fall back to the occurrence's Location for event-linked appearances. Brand hosted Events stay in the backlog. Data: attach Locations to the two upcoming Events |

---

## 4. Verified issues (code-evident, no runtime needed)

1. **`/map` mobile: zoom control and map attribution are hidden under the
   results sheet** (`MapExplorer.tsx:686-689` + `DiscoveryMapCanvas.tsx:182`).
   The archive shell already solved this.
2. **The selected marker label always extends to the right**, so it clips
   on narrow screens when the marker is centered or near the right edge
   (`DiscoveryMapCanvas.tsx:396`).
3. **The archive shell doesn't pan when a marker is tapped.** After the
   sheet resizes, the marker can end up under the sheet or off-edge
   (`ArchiveGeoShell.tsx:243-248` vs `selectResult`).
4. **Confusing duplicate "List" controls**: `/map` has two controls with
   different meanings; the archive Map has two with the same meaning.
5. **The selected `/map` preview card isn't fully tappable**, and View
   links remain everywhere.
6. **`/discover` → "View On Map" drops `/discover`'s filters**
   (`discover/page.tsx:172`).
7. **The `/find` map count can understate the result set** (capped at 30
   with `truncated: false`).
8. **`/map` API failures are silent**: `fetch(...).catch(() => undefined)`
   leaves stale results with no message (`MapExplorer.tsx:204, 259, 396`).
   The archive shell shows a failure state.
9. **Terminology drift**: `/map` uses "Feed" while archives use "List";
   `/map` has its own Map | Feed radiogroup instead of `ViewModeSwitch`.

## 5. Unverified behavior (needs live/browser QA)

- Back-button restoration on `/map` after client-side filter changes (req 12;
  see the classification above).
- Actual visible map band at 360/390/412 with a selected preview (req 7).
- Whether native symbol labels visibly collide with the `/map` top overlay
  or get cut at canvas edges at common zooms (reqs 5, 6).
- Archive strip browsing highlighting a marker that's off-screen.
- Scroll restoration of the archive List on Back from a detail page (Next
  default behavior, not custom code).
- Sheet drag vs page scroll on iOS Safari and Android Chrome (dynamic
  viewport, `100dvh`, `touch-none`).
- Whether the `/map` default area (Manhattan bbox) shows meaningful content
  given only about 1 mappable upcoming Event in production.

## 6. Missing requirements

Nothing in the 13 requirements is wholly **MISSING**. Every one has existing
infrastructure. The closest items:
- A persisted map viewport and selection across navigation. No storage of
  it exists, but the `sessionStorage` focus-hint pattern does.
- A primary-nav link to `/map`. The route key exists; the nav row doesn't.

## 7. Shared vs duplicated implementations / reuse opportunities

| Concern | Shared today | Duplicated today | Reuse opportunity |
| --- | --- | --- | --- |
| Map rendering | `DiscoveryMapCanvas` (all maps) | — | Fix label anchoring and control safe areas **once** here |
| Sheet geometry | `sheet.ts` (both shells) | Pointer-drag handlers copied in `MapExplorer` and `ArchiveGeoShell` (about 40 lines each) | Optional later: a small `useSheetDrag` hook. Not required for these requirements |
| Control-over-sheet lift | `ArchiveGeoShell` `--sheet-h` CSS | Missing in `MapExplorer` | Copy the same two-class pattern; no new abstraction |
| Result cards | — | `MapResultCard` vs `GeoResultCard` (same look, different data types) | Apply the same interaction rule (selected = stretched link; drop View) to both. Don't merge the types now |
| View switch | `ViewModeSwitch` (archives), `ViewToggle` (detail sections) | `MapExplorer` own radiogroup + icon button | Use `ViewModeSwitch` (`allowSplit={false}`) on desktop `/map` with the "List" label |
| Filter sheet | `RefineSheet` (archives) | `MapFilterSheet`, `FilterSheet`, `CategoryFilterSheet` | Out of scope to unify. Align trigger look and label only |
| Context restore | `findmi-geo-focus:<surface>` in `ArchiveGeoShell` | None on `/map` | Extend the same pattern (selection + viewport per URL) |

## 8. Potential regression risks

- **Approved copy and composition are locked by source-inspection tests**
  (`map-ux-completion`, `discovery-engine-map`, `archive-discovery-ux`,
  `map-everywhere(-final)`). Removing View links or a List control needs
  test updates *and* product sign-off. These tests record past approvals.
- **Tap semantics.** A row tap currently selects (and pans). Turning row
  taps into navigation would lose the "browse on map" behavior. The plan
  keeps tap-to-select for unselected rows and makes the selected card the
  link (a two-step pattern).
- **Sheet caps** feed `sheetHeights`, which both shells use. Lowering
  `PEEK_CAP` affects `/map` *and* the archives. The tests read the
  constants, so they adapt, but the visuals need QA in both.
- **Canvas changes affect every map** (detail pages, Moments, Manager). The
  anchor flip must keep `ContextMap` and `MomentsMap` correct.
- **Back-navigation fix** must not reintroduce history spam. `/map`
  deliberately uses `replaceState`.
- **The "Map-first" default** is test-locked and a deliberate decision. Don't
  flip archives to List-first as a side effect.
- **The homepage Map button is a rejected pattern.** Re-adding it without
  approval would reverse a recorded decision.

## 9. Documentation ↔ code discrepancies

| Doc | Statement | Reality |
| --- | --- | --- |
| `README.md:216-217` | "No map SDK — … a map view can be layered on" | MapLibre GL 5.24 with a full map system |
| `docs/CONSUMER-EXPERIENCE.md` § Discovery, `docs/ROUTES-AND-IA.md` | Map is only `/map` ("Active QA") | Archives (`/events`, `/locations`, `/businesses`, `/find`) have List/Map/Split and **open Map-first on a fresh visit**. "Map Everywhere" isn't documented anywhere in `/docs` |
| `docs/ROUTES-AND-IA.md` | `/moments` Feed or Map; no `view=` on archives | Archives take `view=list\|map\|split` and `bbox=` |
| `docs/BACKLOG.md` § Map / discovery | Only "Map filter audit" | The items in this audit should replace or augment it once approved |
| `docs/DESIGN-SYSTEM.md` | Map UX "isn't canonical yet" | Still accurate. Card, sheet and control conventions could become canonical after this pass |

These were **not** edited, because the audit is read-only. The plan includes
them.

---

## 10. Bottom line

About **75–80% of the requested experience already exists**: one shared
canvas, synchronized selection, content-sized sheets, Search This Area, URL
state, filter-preserving Map/List switching, Map-first archives, and honest
empty and partial-geography states. The remaining work is refinement, not
construction. Specifically: selected-card interaction (stretched link, drop
View), label anchoring, the control safe area on `/map`, the sheet cap,
de-duplicating List controls, `/map` back-navigation persistence, and two
data-honesty fixes.
