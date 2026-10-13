// Event Import — canonical Location confirmation. Imported places that
// look like an existing Findmi Location are offered for an explicit answer
// (Use This Location / Not the Same Place); strong matches start linked and
// visible; one answer covers the same place across a batch; any single
// date can still be changed. Fake clients only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const E = await import("../src/lib/event-import/engine.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const LC = await import("../src/lib/locationCreation.ts");
const F = await import("./fixtures/event-sources.mjs");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-13T20:00:00Z");
const CORGI_NYC = { id: "660d3744-dc88-4e91-856c-c0a296c9e776", name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", postal_code: "10016" };
const ROSE = { id: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001", name: "Rose Hill", address: "34 E 32nd St", city: "New York", state: "NY", postal_code: "10016" };

// ── the matcher's possible tier ───────────────────────────────────────
function locationsAdmin(rows) {
  return {
    from: () => {
      let pattern = "";
      const api = { select: () => api, is: () => api, ilike: (_c, p) => ((pattern = p.replace(/%/g, "").toLowerCase()), api), limit: async () => ({ data: rows.filter((r) => r.name.toLowerCase().includes(pattern)) }) };
      return api;
    },
  };
}

test("possible tier: 'Corgi Cafe' offers 'Corgi Cafe NYC' (borough vs city doesn't block); vague or other-state names don't", async () => {
  const rows = [{ ...CORGI_NYC, slug: "corgi-cafe-nyc", is_demo: false, category: null }, { id: "x", slug: "cafe", name: "The Cafe", address: null, city: "New York", state: "NY", postal_code: null, is_demo: false, category: null }];
  const admin = locationsAdmin(rows);
  assert.deepEqual((await LC.findPossibleLocations(admin, { name: "Corgi Cafe", state: null })).map((r) => r.id), [CORGI_NYC.id]);
  assert.deepEqual((await LC.findPossibleLocations(admin, { name: "Corgi Cafe", state: "New York" })).map((r) => r.id), [CORGI_NYC.id], "'New York' and 'NY' are the same state");
  assert.deepEqual((await LC.findPossibleLocations(admin, { name: "Corgi Cafe", state: "NY" })).map((r) => r.id), [CORGI_NYC.id]);
  assert.equal((await LC.findPossibleLocations(admin, { name: "Corgi", state: null })).length, 0, "one word is too vague");
  assert.equal((await LC.findPossibleLocations(admin, { name: "Cafe", state: null })).length, 0, "generic words never match");
  assert.equal((await LC.findPossibleLocations(admin, { name: "Corgi Cafe", state: "CA" })).length, 0, "other state");
});

// ── analysis: strong vs possible, per distinct place ──────────────────
function deps(html, over = {}) {
  return {
    fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchPossibleLocations: async (v) => (/corgi cafe/i.test(v.name) ? [CORGI_NYC] : []),
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}

test("J: a calendar's many 'Corgi Cafe' Events all get the same possible Corgi Cafe NYC match; other places stay independent", async () => {
  const r = await E.analyzeEventUrl({ url: "https://luma.com/usecorginyc", businessId: "corgi", rateKey: "u" }, deps(F.lumaCalendar(), { matchLocations: async (v) => (v.name === "Rose Hill" ? [ROSE] : []) }));
  assert.equal(r.kind, "multi");
  const atCorgi = r.events.filter((e) => e.candidate.occurrences.some((o) => o.venue.name === "Corgi Cafe"));
  assert.ok(atCorgi.length >= 6);
  const keys = new Set(atCorgi.map((e) => e.matches.locations[0].key));
  assert.equal(keys.size, 1, "one page place → one key across Events");
  for (const e of atCorgi) assert.deepEqual([e.matches.locations[0].id, e.matches.locations[0].confidence, e.matches.locations[0].postalCode], [CORGI_NYC.id, "possible", "10016"]);
  const rose = r.events.find((e) => e.candidate.title === "AI Founders Roundtable");
  assert.equal(rose.matches.locations[0].id, ROSE.id);
  assert.equal(rose.matches.locations[0].confidence, "strong", "an exact match with an address stays strong");
  const park = r.events.find((e) => e.candidate.title.startsWith("Aleph"));
  assert.deepEqual(park.matches.locations, [], "no match → keeps the typed place");
});

test("A + B: a strong match starts visibly linked; a possible match waits for an answer and isn't linked silently", async () => {
  const r = await E.analyzeEventUrl({ url: "https://luma.com/usecorginyc", businessId: "corgi", rateKey: "u" }, deps(F.lumaCalendar(), { matchLocations: async (v) => (v.name === "Rose Hill" ? [ROSE] : []) }));
  const rose = r.events.find((e) => e.candidate.title === "AI Founders Roundtable");
  const rr = R.reviewDefaults(rose.candidate, rose.matches, "participating", "Corgi");
  assert.deepEqual([rr.place.useLocationId, rr.place.matchDecision], [ROSE.id, "use"]);
  const qsbs = r.events.find((e) => e.candidate.title.startsWith("QSBS"));
  const qr = R.reviewDefaults(qsbs.candidate, qsbs.matches, "participating", "Corgi");
  assert.deepEqual([qr.place.useLocationId, qr.place.matchDecision], [null, null]);
  assert.deepEqual(R.pendingPlaceMatches(qr, qsbs.matches), [qr.place.matchKey]);
  assert.equal(R.batchItemStatus(qr, qsbs.matches).kind, "possible_match", "shown as needing a look, not blocked");
  const ui = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  for (const s of ['"On Findmi"', '"Possible Findmi Location"', 'title="Use This Location"', 'title="Not the Same Place"']) assert.ok(ui.includes(s), s);
});

// ── batch confirmation + override ─────────────────────────────────────
async function corgiReviews() {
  const r = await E.analyzeEventUrl({ url: "https://luma.com/usecorginyc", businessId: "corgi", rateKey: "u" }, deps(F.lumaCalendar()));
  return r.events.filter((e) => !e.past).map((e) => ({ e, review: R.reviewDefaults(e.candidate, e.matches, "participating", "Corgi") }));
}

test("F + G: one confirmation covers every Event at Corgi Cafe; other places are untouched", async () => {
  const items = await corgiReviews();
  const key = items.find((i) => i.review.place.venueName === "Corgi Cafe").review.place.matchKey;
  const decided = items.map((i) => R.decidePlace(i.review, key, "use", CORGI_NYC.id));
  const corgi = decided.filter((rv) => rv.place.venueName === "Corgi Cafe");
  assert.ok(corgi.length >= 6);
  assert.ok(corgi.every((rv) => rv.place.useLocationId === CORGI_NYC.id && rv.place.matchDecision === "use"));
  const others = decided.filter((rv) => rv.place.venueName !== "Corgi Cafe");
  assert.ok(others.length > 0 && others.every((rv) => rv.place.useLocationId === null), "Rose Hill, The Ten Bells, parks unchanged");
  const ui = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  assert.match(ui, /for \(const e of chosen\) if \(next\[e\.key\]\) next\[e\.key\] = decidePlace\(next\[e\.key\], matchKey, decision, locationId\);/);
  assert.match(ui, /Confirm each place once — it applies to every Event there\./);
});

test("H: inside one multi-date Event, the first answer fills the same unanswered place; a later change to one date stays on that date", () => {
  const place = (venueName, extra = {}) => ({ venueName, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, matchKey: venueName ? `${venueName.toLowerCase()}|` : null, matchDecision: null, ...extra });
  const review = {
    intent: "participating", title: "Residency", description: null, imageUrl: null, sourceUrl: null, sharedPlace: false, place: place(null), organizer: null, useEventId: null,
    occurrences: [
      { id: "a", date: "2026-10-16", startTime: "18:00", endTime: "23:00", place: place("Corgi Cafe") },
      { id: "b", date: "2026-10-17", startTime: "18:00", endTime: "23:00", place: place("Corgi Cafe") },
      { id: "c", date: "2026-10-18", startTime: "18:00", endTime: "23:00", place: place("Rose Hill") },
    ],
  };
  const once = R.decidePlaceFrom(review, "a", "use", CORGI_NYC.id);
  assert.deepEqual(once.occurrences.map((o) => o.place.useLocationId), [CORGI_NYC.id, CORGI_NYC.id, null]);
  const override = R.decidePlaceFrom(once, "b", "reject", CORGI_NYC.id);
  assert.deepEqual(override.occurrences.map((o) => [o.place.useLocationId, o.place.matchDecision]), [[CORGI_NYC.id, "use"], [null, "reject"], [null, null]]);
  assert.equal(once.occurrences[1].place.useLocationId, CORGI_NYC.id, "earlier state not mutated");
});

// ── persistence ───────────────────────────────────────────────────────
function fakeAdmin(locations = {}) {
  const ops = [];
  const builder = (table) => {
    const filters = [];
    const api = {
      select: () => api, neq: () => api, is: () => api, in: () => api,
      eq: (k, v) => (filters.push([k, v]), api),
      maybeSingle: async () => ({ data: table === "locations" ? (locations[filters.find(([k]) => k === "id")?.[1]] ?? null) : null }),
      then: (resolve) => resolve({ data: [] }),
      insert: (rows) => {
        ops.push({ table, rows });
        const res = { error: null, data: null };
        return { ...res, select: async () => ({ data: rows.map((_, i) => ({ id: `o${i}` })) }), then: (r) => r(res) };
      },
      update: (patch) => (ops.push({ table, update: patch }), { eq: async () => ({ error: null }) }),
    };
    return api;
  };
  return { ops, client: { from: builder, rpc: async (name, args) => (ops.push({ rpc: name, args }), { data: { id: "new-event" }, error: null }) } };
}
const pdeps = (admin) => ({ admin, userId: "u", businessId: "corgi", businessName: "Corgi", applyToEvent: async () => "applied", canHost: async () => true, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "slug", notifyNewEvent: async () => {}, propagateDates: async () => {} });
const LOCS = { [CORGI_NYC.id]: { ...CORGI_NYC, latitude: 40.74, longitude: -73.98 }, [ROSE.id]: { ...ROSE, latitude: null, longitude: null } };
const single = (place, over = {}) => ({ intent: "participating", title: "Spooktober Movie Night", description: null, imageUrl: null, sourceUrl: "https://luma.com/spooktober-movie-night", sharedPlace: true, place, occurrences: [{ id: "a", date: "2026-10-15", startTime: "19:00", endTime: "22:00", place }], organizer: null, useEventId: null, ...over });
const corgiPlace = (extra = {}) => ({ venueName: "Corgi Cafe", address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, matchKey: "corgi cafe|", matchDecision: null, ...extra });

test("C: 'Not the Same Place' keeps the written place and no canonical Location", async () => {
  const { client, ops } = fakeAdmin(LOCS);
  await P.persistEventImport(P.normalizeReview(single(corgiPlace({ matchDecision: "reject" }))).value, pdeps(client));
  const row = ops.find((o) => o.table === "appearances").rows[0];
  assert.deepEqual([row.location_id, row.venue_name, row.city], [null, "Corgi Cafe", "New York"]);
});

test("E: confirming the Location links the participating schedule item to Corgi Cafe NYC", async () => {
  const { client, ops } = fakeAdmin(LOCS);
  await P.persistEventImport(P.normalizeReview(single(corgiPlace({ matchDecision: "use", useLocationId: CORGI_NYC.id }))).value, pdeps(client));
  const row = ops.find((o) => o.table === "appearances").rows[0];
  assert.deepEqual([row.location_id, row.venue_name, row.address], [CORGI_NYC.id, "Corgi Cafe NYC", "121 East 27th Street"]);
  assert.equal(row.event_id, undefined, "standalone — no Event manufactured");
});

test("D + I: hosting writes each date's confirmed Location to event_occurrences.location_id (different places stay different)", async () => {
  const { client, ops } = fakeAdmin(LOCS);
  const review = {
    ...single(corgiPlace(), { intent: "hosting", title: "Corgi Tour" }),
    sharedPlace: false,
    occurrences: [
      { id: "a", date: "2026-10-15", startTime: "19:00", endTime: "22:00", place: corgiPlace({ matchDecision: "use", useLocationId: CORGI_NYC.id }) },
      { id: "b", date: "2026-10-16", startTime: "19:00", endTime: "22:00", place: { venueName: "Rose Hill", address: null, city: null, state: null, postalCode: null, useLocationId: ROSE.id, matchKey: "rose hill|", matchDecision: "use" } },
      { id: "c", date: "2026-10-17", startTime: "19:00", endTime: "22:00", place: corgiPlace({ matchDecision: "reject" }) },
    ],
  };
  await P.persistEventImport(P.normalizeReview(review).value, pdeps(client));
  const occ = ops.find((o) => o.table === "event_occurrences").rows;
  assert.deepEqual(occ.map((r) => [r.location_id, r.venue_name]), [[CORGI_NYC.id, "Corgi Cafe NYC"], [ROSE.id, "Rose Hill"], [null, "Corgi Cafe"]]);
  assert.equal(ops.filter((o) => o.table === "appearances").length, 0, "host gets no Appearance");
});

test("K: the public Location page reads linked dates and standalone schedule items by location_id, once each", () => {
  const data = read("src/lib/data.ts");
  const fn = data.slice(data.indexOf("async function queryUpcomingHappenings("), data.indexOf("export async function getLocationDescendants("));
  assert.match(fn, /\.from\("event_occurrences"\)[\s\S]*?\.in\("location_id", locationIds\)/);
  assert.match(fn, /\.from\("appearances"\)[\s\S]*?\.in\("location_id", locationIds\)\s*\.is\("event_id", null\)/, "Event-linked items aren't shown twice");
});
