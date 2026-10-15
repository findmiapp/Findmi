// Event Import → Missing canonical Location Quick Create. When a reviewed
// place is a real, specific physical place that isn't on Findmi, the
// operator creates it inline (the existing createInlinePlace) and it is
// selected like a strong match — Review state only; the Event is saved
// later by normal persistence. Batch rows at the same place reuse it.
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

const R = await import("../src/lib/event-import/review.ts");
const T = await import("../src/lib/event-import/types.ts");
const P = await import("../src/lib/event-import/persist.ts");
const read = (p) => readFileSync(p, "utf8");
const PARTS = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
const IMPORTER = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");

const place = (over = {}) => ({
  venueName: "The Glasshouse", address: "660 12th Avenue", city: "New York", state: "NY", postalCode: "10019",
  useLocationId: null, matchKey: null, matchDecision: null, ...over,
});
const exact = { locationVisibility: "exact", online: false };
const can = (over, ctx = exact) => R.canOfferLocationCreate(place(over), ctx);

// ── ELIGIBILITY ───────────────────────────────────────────────────────────

test("1. a named place with a numbered street, city and state can be created", () => {
  assert.equal(can({}), true);
  assert.equal(can({}, { locationVisibility: null, online: false }), true, "no visibility recorded (typed / pasted) is allowed");
  assert.equal(can({ address: "20-30 Main St", postalCode: null }), true, "hyphenated building numbers; ZIP optional");
  assert.equal(can({ useLocationId: "x" }), false, "already linked → nothing to create");
});

test("2–4. placeholder names are never created: TBA/TBD, Secret Location, Online/Virtual/Zoom", () => {
  for (const name of ["TBA", "TBD", "Location TBA", "To Be Announced", "Secret Location", "Location Announced Later", "Online", "Virtual Event", "Zoom", "Livestream"]) {
    assert.equal(can({ venueName: name }), false, name);
  }
  assert.equal(can({ address: "Online" }), false);
});

test("5–7. neighborhood/city-only, intersections and incomplete addresses are never created", () => {
  for (const address of ["SoHo", "Hudson Yards", "New York City", "5th Ave", "Broadway & 42nd St", "Corner of Bedford and N 7th", "Prince St at Mercer St", "between 3rd and 4th Ave"]) {
    assert.equal(can({ address }), false, address);
  }
  assert.equal(can({ address: "100 Bedford Ave & N 7th St" }), false, "an intersection, even with a number");
  assert.equal(can({ address: null }), false);
  assert.equal(can({ venueName: null }), false);
  assert.equal(can({ venueName: "  " }), false);
  assert.equal(can({ city: null }), false);
  assert.equal(can({ state: "" }), false);
});

test("8. hidden / broad / none / online Events can never Quick Create", () => {
  for (const locationVisibility of ["hidden", "broad", "none"]) assert.equal(can({}, { locationVisibility, online: false }), false, locationVisibility);
  assert.equal(can({}, { locationVisibility: "exact", online: true }), false, "online");
  // Wiring: every place's offer goes through the same check with the
  // review's own visibility and the candidate's online flag.
  assert.match(PARTS, /eligible: canOfferLocationCreate\(place, \{ locationVisibility: review\.locationVisibility, online: quickCreate\.online \}\)/);
  assert.match(PARTS, /\{!place\.useLocationId && quickCreate\?\.eligible && <QuickCreateLocation /);
  assert.match(IMPORTER, /online: Boolean\(candidate\.online\)/);
  assert.match(MULTI, /quickCreate=\{\{ online: Boolean\(e\.candidate\.online\), onCreated: onLocationCreated \}\}/);
});

// ── CREATE / SELECT ───────────────────────────────────────────────────────

const LOC = (key, id = "aaaaaaaa-0000-4000-8000-000000000001") => ({ key, id, name: "The Glasshouse", address: "660 12th Avenue", city: "New York", state: "NY", postalCode: "10019" });
const occ = (id, p) => ({ id, date: "2026-11-05", startTime: "18:00", endTime: "21:00", place: p });
const review = (over = {}) => ({
  intent: "participating", title: "Launch Party", description: null, imageUrl: null, sourceUrl: "https://example.com/e",
  occurrences: [occ("d1", place())], sharedPlace: true, place: place(), organizer: null, useEventId: null, asEvent: true,
  locationVisibility: "exact", ...over,
});
const noMatches = { event: null, organizerBusiness: null, existingAppearance: null, locations: [] };

test("9. a created Location becomes the place's selected canonical Location (a strong match), Review state only", () => {
  const p = place({ matchKey: T.venueKey({ name: "The Glasshouse", address: "660 12th Avenue" }) });
  const key = R.placeKeyFor(p);
  const loc = LOC(key);
  const next = R.selectCreatedLocation(review({ place: p }), "shared", loc);
  assert.equal(next.place.useLocationId, loc.id);
  assert.equal(next.place.matchDecision, "use");
  const matches = R.withCreatedLocations(noMatches, [loc]);
  assert.deepEqual(matches.locations[0], { ...loc, confidence: "strong" });
  // A typed place without a page key gets the same venueKey identity.
  const typed = R.selectCreatedLocation(review({ place: place() }), "shared", LOC(R.placeKeyFor(place())));
  assert.equal(typed.place.matchKey, T.venueKey({ name: "The Glasshouse", address: "660 12th Avenue" }));
  // An earlier (rejected) possible match for the same key is replaced by the chosen Location.
  const withOld = { ...noMatches, locations: [{ key, id: "old", name: "Glass House Bar", address: null, city: null, state: null, confidence: "possible" }] };
  assert.deepEqual(R.withCreatedLocations(withOld, [loc]).locations.map((l) => l.id), [loc.id]);
});

test("10–11. duplicates are offered (Use This Location) and Create Anyway is the explicit force path", () => {
  assert.match(PARTS, /const result = await createInlinePlace\(form\);/, "the one existing creation action");
  assert.match(PARTS, /if \(force\) form\.set\("force", "1"\);/);
  assert.match(PARTS, /\} else if \(result\.status === "duplicates"\) \{\n\s+setDuplicates\(result\.duplicates\);/, "nothing inserted on a likely duplicate");
  assert.match(PARTS, /onClick=\{\(\) => onSelected\(toCreated\(key, d\)\)\}[\s\S]{0,200}Use This Location/, "a duplicate is selected the same way as a created one");
  assert.match(PARTS, /onClick=\{\(\) => create\(true\)\}[\s\S]{0,200}Create Anyway/);
  // createInlinePlace itself still runs the server duplicate check unless forced.
  assert.match(LOC_ACTIONS, /if \(!force\) \{\n\s+const duplicates = await findLikelyDuplicateLocations\(admin, \{ name, address, city, state, postal_code: postalCode \}\);\n\s+if \(duplicates\.length > 0\) return \{ status: "duplicates", duplicates \};/);
});

test("12 & 20. creating a Location never creates the Event, and grants no ownership / membership / Business link", () => {
  const component = PARTS.slice(PARTS.indexOf("export function QuickCreateLocation"));
  assert.doesNotMatch(component, /commitEventImport|persistEventImport|from\("events"\)/);
  const fn = LOC_ACTIONS.slice(LOC_ACTIONS.indexOf("export async function createInlinePlace"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /\.insert\(\{ name, slug, address, city, state, postal_code: postalCode, is_demo: true \}\)/, "unlisted, never published");
  assert.doesNotMatch(body, /location_members"\)\.insert|business_locations|create_owned_location|from\("events"\)/);
});

test("13. later Event persistence writes the selected Location as event_occurrences.location_id", async () => {
  const id = "aaaaaaaa-0000-4000-8000-000000000001";
  const p = place({ matchKey: "k", useLocationId: id, matchDecision: "use" });
  const r = P.normalizeReview(review({ place: p, occurrences: [occ("d1", p)] }));
  assert.equal(r.ok, true);
  assert.equal(r.value.occurrences[0].place.locationId, id);
  const ops = [];
  const client = {
    from: (table) => {
      const api = {
        select: () => api, eq: () => api, is: () => api, in: () => api, neq: () => api, limit: () => api, order: () => api,
        maybeSingle: async () => ({ data: table === "locations" ? { id, name: "The Glasshouse", address: "660 12th Avenue", city: "New York", state: "NY", postal_code: "10019", latitude: null, longitude: null } : null }),
        then: (res) => res({ data: [] }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, rows });
          return { select: () => ({ single: async () => ({ data: { id: `${table}-1` }, error: null }), then: (cb) => cb({ data: [{ id: "occ-1" }] }) }), then: (cb) => cb({ error: null }) };
        },
        upsert: () => Promise.resolve({ error: null }),
        update: () => {
          const chain = { eq: () => chain, then: (cb) => cb({ error: null }) };
          return chain;
        },
      };
      return api;
    },
  };
  const deps = { admin: client, userId: "u", businessId: "b", businessName: "B", applyToEvent: async () => "approved_now", canHost: async () => true, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "launch-party", notifyNewEvent: async () => {}, propagateDates: async () => {}, findEventBySourceUrl: async () => null };
  assert.equal((await P.persistEventImport(r.value, deps)).ok, true);
  const o = ops.find((x) => x.table === "event_occurrences").rows[0];
  assert.equal(o.location_id, id);
  assert.equal(o.venue_name, "The Glasshouse", "the Location's own snapshot, as for any matched Location");
});

// ── PROPAGATION ───────────────────────────────────────────────────────────

test("14. several dates of one Event at the same place resolve together (existing decidePlaceFrom path)", () => {
  const key = T.venueKey({ name: "The Glasshouse", address: "660 12th Avenue" });
  const p = place({ matchKey: key });
  const other = place({ venueName: "Other Hall", address: "1 Main St", matchKey: T.venueKey({ name: "Other Hall", address: "1 Main St" }) });
  const rv = review({ sharedPlace: false, occurrences: [occ("d1", p), occ("d2", p), occ("d3", other)] });
  const next = R.selectCreatedLocation(rv, "d1", LOC(key));
  assert.deepEqual(next.occurrences.map((o) => o.place.useLocationId), [LOC(key).id, LOC(key).id, null]);
  assert.match(PARTS, /set\(selectCreatedLocation\(review, target, location\)\);/);
});

test("15–16. batch rows sharing the place key resolve to the ONE created Location, and become Ready", () => {
  const key = T.venueKey({ name: "The Glasshouse", address: "660 12th Avenue" });
  const loc = LOC(key);
  const rows = { r3: review({ place: place({ matchKey: key }) }), r6: review({ place: place({ matchKey: key }) }), r11: review({ place: place({ matchKey: key }) }), r23: review({ place: place({ matchKey: key }) }) };
  // Row 3 creates it…
  rows.r3 = R.selectCreatedLocation(rows.r3, "shared", loc);
  // …the batch applies it to every other row (MultiEventImport.onLocationCreated).
  for (const k of ["r6", "r11", "r23"]) rows[k] = R.applyCreatedLocation(rows[k], loc);
  assert.deepEqual(Object.values(rows).map((r) => r.place.useLocationId), [loc.id, loc.id, loc.id, loc.id]);
  const matches = R.withCreatedLocations(noMatches, [loc]);
  for (const r of Object.values(rows)) {
    assert.equal(R.canOfferLocationCreate(r.place, exact), false, "the Create prompt disappears");
    assert.equal(R.batchItemStatus(r, matches).kind, "ready");
  }
  assert.match(MULTI, /setCreatedLocations\(\(prev\) => \[\.\.\.prev\.filter\(\(c\) => c\.key !== location\.key\), location\]\);/);
  assert.match(MULTI, /for \(const k of Object\.keys\(next\)\) next\[k\] = applyCreatedLocation\(next\[k\], location\);/);
  assert.match(MULTI, /const statusOf = \(key: string\) => batchItemStatus\(reviews\[key\], matchesOf\(byKey\.get\(key\)!\)\);/);
  assert.match(MULTI, /matches=\{matchesOf\(e\)\}/);
});

test("17. a different place key is never silently attached; an already-linked place keeps its Location", () => {
  const key = T.venueKey({ name: "The Glasshouse", address: "660 12th Avenue" });
  const loc = LOC(key);
  const different = review({ place: place({ venueName: "Glasshouse NYC", matchKey: T.venueKey({ name: "Glasshouse NYC", address: "660 12th Avenue" }) }) });
  assert.equal(R.applyCreatedLocation(different, loc).place.useLocationId, null);
  const linked = review({ place: place({ matchKey: key, useLocationId: "existing", matchDecision: "use" }) });
  assert.equal(R.applyCreatedLocation(linked, loc).place.useLocationId, "existing");
});

// ── UNCHANGED BEHAVIOR ────────────────────────────────────────────────────

test("18. existing Location matching is unchanged (strong starts linked, possible waits)", () => {
  const key = T.venueKey({ name: "Corgi Cafe NYC", address: "121 East 27th Street" });
  const candidate = {
    title: "X", description: null, imageUrl: null, sourceUrl: "https://e.com", organizer: null, online: false, platform: null, origin: "url",
    occurrences: [{ start: "2026-11-05T22:00:00.000Z", end: "2026-11-06T01:00:00.000Z", venue: { name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "New York", state: "NY", postalCode: null } }],
    sources: {}, attendance: null, locationVisibility: "exact",
  };
  for (const [confidence, linked] of [["strong", true], ["possible", false]]) {
    const m = { ...noMatches, locations: [{ key, id: "loc-1", name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "New York", state: "NY", confidence }] };
    const rv = R.reviewDefaults(candidate, m, "participating", "Biz");
    assert.equal(rv.place.useLocationId, linked ? "loc-1" : null, confidence);
  }
});

test("19. privacy unchanged: a hidden place still saves no venue or Location, whatever was selected", () => {
  const p = place({ matchKey: "k", useLocationId: "aaaaaaaa-0000-4000-8000-000000000001", matchDecision: "use" });
  const r = P.normalizeReview(review({ place: p, occurrences: [occ("d1", p)], locationVisibility: "hidden" }));
  assert.deepEqual(r.value.occurrences[0].place, { name: null, address: null, postalCode: null, locationId: null, city: "New York", state: "NY" });
  // The quick-create panel only ever shows the place already in Review —
  // it never reads or reveals another Location's private data.
  assert.match(PARTS, /setFields\(\{ name: place\.venueName \?\? "", address: place\.address \?\? "", city: place\.city \?\? "", state: place\.state \?\? "", postal_code: place\.postalCode \?\? "" \}\);/);
});
