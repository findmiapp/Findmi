// (1) ensureEventAppearance never manufactures a second Appearance for a
//     Business already on an Event's schedule (production: Admin re-saving
//     a converted Event created a duplicate Run Club Appearance).
// (2) Business hero precedence: Business pick → Findmi Featured Event it
//     approved-participates in → Happening Now → nearest.
// (3) Event discovery: Findmi Featured Events lead on the opted-in pages.
// (4) Location page behavior unchanged.
// Stateful fake database / pure functions / source guards — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const S = await import("../src/lib/appearance-event-sync.ts");
const H = await import("../src/lib/business-hero.ts");
const D = await import("../src/lib/data.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI = "corgi";
const RUN_EVENT = "b33bcc29-c8aa-4972-97a8-f7ca4dfbbd8c";

/** Stateful fake: filters select real rows; inserts/updates change them. */
function fakeDb(seed) {
  const t = { appearances: [], events: [], ...structuredClone(seed) };
  let n = 0;
  const from = (table) => {
    t[table] ??= [];
    const filters = [];
    let patch = null;
    let lim = Infinity;
    const rows = () => t[table].filter((r) => filters.every(([op, k, v]) => (op === "eq" ? r[k] === v : op === "neq" ? r[k] !== v : op === "is" ? (r[k] ?? null) === v : true))).slice(0, lim);
    const run = () => {
      const hit = rows();
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return hit;
    };
    const q = {
      select: () => q, order: () => q,
      limit: (k) => ((lim = k), q),
      eq: (k, v) => (filters.push(["eq", k, v]), q),
      neq: (k, v) => (filters.push(["neq", k, v]), q),
      is: (k, v) => (filters.push(["is", k, v]), q),
      maybeSingle: async () => {
        const hit = run();
        return hit.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: hit[0] ?? null, error: null };
      },
      then: (resolve) => resolve({ data: run(), error: null }),
      update: (p) => ((patch = p), q),
      insert: (row) => {
        t[table].push({ id: `${table}-${++n}`, created_at: new Date().toISOString(), event_occurrence_id: null, ...row });
        return Promise.resolve({ error: null });
      },
    };
    return q;
  };
  return { t, client: { from } };
}
const EVENT = { id: RUN_EVENT, name: "Aleph x Corgi Run Club NYC", start_at: "2026-10-17T13:00:00Z", end_at: "2026-10-17T14:00:00Z", venue_name: "Pier 34 at Hudson River Park", address: null, city: "New York", state: "NY", latitude: null, longitude: null };
const OCC_LINKED = { id: "de7bc12f-3313-4c28-ab44-e7679b613878", business_id: CORGI, event_id: RUN_EVENT, event_occurrence_id: "bdcd915c", status: "confirmed", source: "official_participation", start_at: EVENT.start_at, end_at: EVENT.end_at };

// ── 1. no duplicate Appearance ───────────────────────────────────────────
test("an occurrence-linked Appearance already on the schedule → no second (Event-level) Appearance", async () => {
  const db = fakeDb({ events: [EVENT], appearances: [{ ...OCC_LINKED }] });
  await S.ensureEventAppearance(db.client, RUN_EVENT, CORGI);
  assert.equal(db.t.appearances.length, 1);
  assert.equal(db.t.appearances[0].id, OCC_LINKED.id, "the real Run Club Appearance is untouched");
});

test("Admin Event save re-submitting the roster (approved Corgi) repeatedly never adds an Appearance", async () => {
  const db = fakeDb({ events: [EVENT], appearances: [{ ...OCC_LINKED }] });
  for (let i = 0; i < 3; i++) await S.ensureEventAppearance(db.client, RUN_EVENT, CORGI); // saveEvent's per-approved-row call
  assert.equal(db.t.appearances.length, 1);
  // That save path still calls the shared helper for every approved roster row.
  assert.match(read("src/app/admin/(protected)/events/actions.ts"), /if \(row\.status === "approved"\) \{\s*await ensureEventAppearance\(supabase, eventId as string, row\.business_id\);/);
});

test("a legitimately missing Appearance is still created (Event-level, official participation, Event's own details)", async () => {
  const db = fakeDb({ events: [EVENT], appearances: [] });
  await S.ensureEventAppearance(db.client, RUN_EVENT, CORGI);
  assert.equal(db.t.appearances.length, 1);
  const a = db.t.appearances[0];
  assert.deepEqual([a.business_id, a.event_id, a.event_occurrence_id, a.status, a.source, a.title, a.start_at], [CORGI, RUN_EVENT, null, "confirmed", "official_participation", EVENT.name, EVENT.start_at]);
});

test("a different Business on the same Event still gets its own Appearance", async () => {
  const db = fakeDb({ events: [EVENT], appearances: [{ ...OCC_LINKED }] });
  await S.ensureEventAppearance(db.client, RUN_EVENT, "aleph");
  assert.equal(db.t.appearances.length, 2);
  assert.equal(db.t.appearances[1].business_id, "aleph");
});

test("a canceled Appearance doesn't count: re-approval reactivates the canceled official row (unchanged semantics)", async () => {
  const canceled = { id: "old", business_id: CORGI, event_id: RUN_EVENT, event_occurrence_id: null, status: "canceled", source: "official_participation", start_at: EVENT.start_at, end_at: EVENT.end_at };
  const db = fakeDb({ events: [EVENT], appearances: [canceled] });
  await S.ensureEventAppearance(db.client, RUN_EVENT, CORGI);
  assert.equal(db.t.appearances.length, 1);
  assert.equal(db.t.appearances[0].status, "confirmed");
});

// ── 2. Business hero precedence ──────────────────────────────────────────
const NOW = Date.parse("2026-10-14T02:00:00Z");
const item = (id, start, end, event_id = null) => ({ id, start_at: start, end_at: end, event_id });
const ROUNDTABLE = item("roundtable", "2026-10-14T22:00:00Z", "2026-10-15T01:00:00Z", "ev-roundtable");
const QSBS = item("qsbs", "2026-10-15T14:00:00Z", "2026-10-15T16:00:00Z", "ev-qsbs");
const RUN = item("run", "2026-10-17T13:00:00Z", "2026-10-17T14:00:00Z", RUN_EVENT);
const PANCAKE = item("pancake", "2026-10-21T14:00:00Z", "2026-10-21T17:00:00Z", "ev-pancake");
const CORGI_UPCOMING = [ROUNDTABLE, QSBS, RUN, PANCAKE];

test("Run Club: Findmi Featured Event becomes Corgi's hero when Corgi has no explicit pick", () => {
  const hero = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [{ eventId: RUN_EVENT, sortOrder: null }], now: NOW });
  assert.deepEqual([hero.item.id, hero.reason], ["run", "findmi_featured"]);
});

test("the Business's own pick always beats Findmi Featured", () => {
  const hero = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: "pancake", featuredEvents: [{ eventId: RUN_EVENT, sortOrder: 1 }], now: NOW });
  assert.deepEqual([hero.item.id, hero.reason], ["pancake", "business"]);
  // A stale pick (no longer upcoming) falls through to Findmi Featured.
  const stale = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: "gone", featuredEvents: [{ eventId: RUN_EVENT, sortOrder: null }], now: NOW });
  assert.equal(stale.reason, "findmi_featured");
});

test("no feature → Happening Now, else nearest (previous behavior)", () => {
  assert.deepEqual(Object.values(H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [], now: NOW })).map((v) => v.id ?? v), ["roundtable", "nearest"]);
  const during = Date.parse("2026-10-15T15:00:00Z");
  const hero = H.resolveBusinessHero([QSBS, RUN], { overrideId: null, featuredEvents: [], now: during });
  assert.deepEqual([hero.item.id, hero.reason], ["qsbs", "live"]);
});

test("multiple Featured Events: featured_sort_order first, then nearest date — deterministic", () => {
  const f = (eventId, sortOrder) => ({ eventId, sortOrder });
  const byDate = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [f("ev-pancake", null), f(RUN_EVENT, null)], now: NOW });
  assert.equal(byDate.item.id, "run", "no order set → nearest featured date");
  const byOrder = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [f(RUN_EVENT, 5), f("ev-pancake", 1)], now: NOW });
  assert.equal(byOrder.item.id, "pancake", "the founder's order wins");
  const mixed = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [f(RUN_EVENT, null), f("ev-pancake", 2)], now: NOW });
  assert.equal(mixed.item.id, "pancake", "an ordered feature beats an unordered one");
});

test("past Featured Event can't lead; a non-participating / hidden / archived Featured Event can't lend its feature", () => {
  const after = Date.parse("2026-10-17T15:00:00Z"); // Run Club over
  const hero = H.resolveBusinessHero(CORGI_UPCOMING, { overrideId: null, featuredEvents: [{ eventId: RUN_EVENT, sortOrder: null }], now: after });
  assert.notEqual(hero.item.id, "run");
  const approved = new Set([RUN_EVENT, "ev-hidden", "ev-archived"]);
  const events = [
    { id: RUN_EVENT, is_featured: true, featured_sort_order: null },
    { id: "ev-not-mine", is_featured: true },
    { id: "ev-hidden", is_featured: true, is_demo: true },
    { id: "ev-archived", is_featured: true, archived_at: "2026-10-13" },
    { id: "ev-plain", is_featured: false },
  ];
  assert.deepEqual(H.editorialFeaturedEventsFor(events, approved), [{ eventId: RUN_EVENT, sortOrder: null }]);
});

test("the Business page uses the shared resolver with the activity's approved Featured Events; no field is merged", () => {
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(view, /resolveBusinessHero\(appearances, \{ overrideId: featuredOverrideId, featuredEvents: activity\.featuredEvents \}\)/);
  const data = read("src/lib/data.ts");
  assert.match(data, /const approvedEventIds = new Set<string>\(\[\s*\.\.\.\(\(eventLinks \?\? \[\]\)[\s\S]*?\.\.\.occurrences\.map\(\(o\) => o\.event_id\),\s*\]\);/);
  assert.match(data, /editorialFeaturedEventsFor\(events\.values\(\), approvedEventIds\)/);
  assert.match(data, /\.from\("event_businesses"\)\.select\("event_id"\)\.eq\("business_id", businessId\)\.eq\("status", "approved"\)/, "approved participation only");
  // Never written: featuring doesn't touch the Business's own pick or hosting.
  assert.doesNotMatch(read("src/lib/business-hero.ts"), /featured_appearance_id\s*=|host_business_id/);
});

// ── 3. Event discovery ───────────────────────────────────────────────────
test("discovery: Findmi Featured Events lead (founder order, then date); the rest keep date order", () => {
  const r = (id, start, is_featured = false, featured_sort_order = null) => ({ event: { id, is_featured, featured_sort_order }, effectiveStart: start });
  const rows = [r("a", "2026-10-15"), r("b", "2026-10-16", true), r("c", "2026-10-17"), r("d", "2026-10-30", true, 1), r("e", "2026-10-20", true)];
  assert.deepEqual(D.sortFeaturedFirst(rows).map((x) => x.event.id), ["d", "b", "e", "a", "c"]);
});

test("discovery: /events and /discover opt in; homepage rows, search and /find keep date order; cards show Featured", () => {
  assert.match(read("src/app/(public)/events/page.tsx"), /limit: limit \+ 1,\s*featuredFirst: true[,\s}]/);
  assert.match(read("src/app/(public)/discover/page.tsx"), /getEventsDiscovery\(\{ when: toDiscoveryWindow\(whenKey\), marketSlug, areaSlug, canonicalGeo, limit: 8, featuredFirst: true \}\)/);
  for (const f of ["src/lib/homepage-rows.ts", "src/app/api/homepage-search/route.ts", "src/app/api/homepage-events/route.ts", "src/app/(public)/find/page.tsx"]) {
    assert.doesNotMatch(read(f), /featuredFirst/, f);
  }
  assert.match(read("src/lib/data.ts"), /if \(params\.featuredFirst\) sortFeaturedFirst\(rows\);\s*\n\s*const offset = params\.offset \?\? 0;/, "sorted before paging");
  const card = read("src/components/discover/EventDiscoveryCard.tsx");
  assert.match(card, /\{event\.is_featured && \(\s*<span className="rounded-full bg-findmi [^"]*text-white">Featured<\/span>/);
});

// ── 4. Location unchanged ────────────────────────────────────────────────
test("Location page: same query, same Location featured pointer, same 3-at-a-time reveal", () => {
  const data = read("src/lib/data.ts");
  const fn = data.slice(data.indexOf("async function queryUpcomingHappenings("), data.indexOf("export async function getLocationDescendants("));
  // Event date/time precision: "not ended" also keeps a date with no
  // published end through its calendar day (occurrenceUpcomingOr).
  assert.match(fn, /\.from\("event_occurrences"\)[\s\S]*?\.in\("location_id", locationIds\)\s*\.eq\("status", "scheduled"\)[\s\S]{0,120}\.or\(occurrenceUpcomingOr\(nowIso, todayIn\(APP_TIMEZONE\)\)\)/);
  assert.match(fn, /\.in\("location_id", locationIds\)\s*\.is\("event_id", null\)/);
  assert.doesNotMatch(fn, /is_featured/);
  const view = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  assert.match(view, /resolveFeaturedLocationHappening\(happenings, location\.featured_event_id \?\? null\)/);
  assert.doesNotMatch(view, /is_featured|resolveBusinessHero/);
  assert.match(read("src/components/ProgressiveList.tsx"), /export const PROGRESSIVE_STEP = 3;/);
});
