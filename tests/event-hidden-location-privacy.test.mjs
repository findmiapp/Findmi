// Hidden Event location privacy across PUBLIC reads. When a parent Event's
// location_visibility = 'hidden', no public surface exposes the precise
// venue, street, postal code, Location link or Directions — for the Event,
// its dates, or its linked Appearances — and the Event never appears on a
// precise Location's own page. Exact Events / standalone Appearances at the
// same Location are unaffected, and reads keep working before the
// location_visibility migration exists. Fake anon client only — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// The public anon client is replaced by a fake table store (same exports).
const FAKE_SUPABASE = "data:text/javascript,export const getSupabase = () => globalThis.__fakeSupabase ?? null;";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "./supabase" && context.parentURL?.includes("/src/lib/")) return { url: FAKE_SUPABASE, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/data.ts");
const V = await import("../src/lib/event-location-privacy.ts");
const FMT = await import("../src/lib/format.ts");
const read = (p) => readFileSync(p, "utf8");
const { orPredicate, withDates } = await import("./helpers/postgrest-or.mjs");

const CORGI_CAFE = { id: "660d3744-dc88-4e91-856c-c0a296c9e776", name: "Corgi Cafe NYC" };
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const FUTURE_END = new Date(Date.now() + 7 * 86_400_000 + 3 * 3_600_000).toISOString();

/** A tiny PostgREST-like store: in/eq/is/neq/gt filters, thenable/maybeSingle.
 * migrated=false → any filter/select naming location_visibility errors,
 * exactly like production before the migration. */
function fakeClient(tables, { migrated = true } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let selectCols = "";
      let missingColumn = false;
      const api = {
        select: (cols = "*") => ((selectCols = cols), (missingColumn ||= !migrated && /location_visibility/.test(cols)), api),
        in: (k, v) => (filters.push((r) => v.includes(r[k])), api),
        eq: (k, v) => ((missingColumn ||= !migrated && k === "location_visibility"), filters.push((r) => (k.includes(".") ? true : r[k] === v)), api),
        is: (k, v) => (filters.push((r) => (r[k] ?? null) === v), api),
        neq: (k, v) => (filters.push((r) => r[k] !== v), api),
        gt: (k, v) => (filters.push((r) => (k.includes(".") ? true : r[k] > v)), api),
        lte: (k, v) => (filters.push((r) => r[k] <= v), api),
        // `.or(...)` windows evaluated like PostgREST (helpers/postgrest-or).
        or: (expr) => (filters.push(orPredicate(expr)), api),
        not: () => api, order: () => api, limit: () => api, range: () => api,
        then: (resolve) => {
          calls.push({ table, selectCols });
          if (missingColumn) return resolve({ data: null, error: { code: "42703", message: "column events.location_visibility does not exist" } });
          return resolve({ data: (tables[table] ?? []).map(withDates).filter((r) => filters.every((f) => f(r))), error: null });
        },
        maybeSingle: async () => ({ data: (tables[table] ?? []).map(withDates).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      };
      return api;
    },
  };
}

const ev = (id, name, visibility) => ({ id, slug: id, name, cover_image_url: null, organizer_name: null, is_demo: false, start_at: FUTURE, end_at: FUTURE_END, location_visibility: visibility });
const occ = (event) => ({ location_id: CORGI_CAFE.id, event_id: event.id, start_at: FUTURE, end_at: FUTURE_END, status: "scheduled", event });

function corgiTables() {
  const hidden = ev("founders-after-hours", "Founders After Hours: A Mixer", "hidden");
  const exact = ev("spooktober", "Spooktober Movie Night", "exact");
  const legacy = ev("legacy-event", "Legacy Event", null);
  return {
    events: [hidden, exact, legacy],
    event_occurrences: [occ(hidden), occ(exact), occ(legacy)],
    appearances: [
      // Standalone schedule item at Corgi Cafe — unaffected.
      { id: "standalone", location_id: CORGI_CAFE.id, event_id: null, status: "confirmed", title: "Corgi Pop-Up", start_at: FUTURE, end_at: FUTURE_END, description: null, flyer_image_url: null, business: { slug: "corgi", name: "Corgi", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live" } },
    ],
    location_images: [],
  };
}

test("Location page: a hidden Event linked to Corgi Cafe is absent; exact + legacy Events and standalone items remain", async () => {
  globalThis.__fakeSupabase = fakeClient(corgiTables());
  const items = await D.getUpcomingAtLocation(CORGI_CAFE);
  const titles = items.map((i) => i.title).sort();
  assert.deepEqual(titles, ["Corgi Pop-Up", "Legacy Event", "Spooktober Movie Night"]);
  assert.ok(!titles.includes("Founders After Hours: A Mixer"), "occurrence.location_id still points at Corgi Cafe, yet it never shows there");
});

test("Location page before the migration: reads still succeed and nothing is hidden (no Event can be hidden yet)", async () => {
  globalThis.__fakeSupabase = fakeClient(corgiTables(), { migrated: false });
  const items = await D.getUpcomingAtLocation(CORGI_CAFE);
  assert.equal(items.length, 4, "no 500, no failed query — the privacy lookup alone errors and means 'none hidden'");
  assert.deepEqual(await V.fetchHiddenEventIds(globalThis.__fakeSupabase, ["founders-after-hours"]), new Set());
});

test("Business Findmi Here: an Appearance of a hidden Event shows no venue / address / Location; exact ones are untouched", async () => {
  const base = { business_id: "corgi", status: "confirmed", start_at: FUTURE, end_at: FUTURE_END, source: "official_participation", description: null, created_at: FUTURE };
  const tables = {
    events: [ev("founders-after-hours", "Founders After Hours", "hidden"), ev("spooktober", "Spooktober", "exact")],
    appearances: [
      { ...base, id: "a-hidden", title: "Founders After Hours", event_id: "founders-after-hours", event_occurrence_id: "o1", location_id: CORGI_CAFE.id, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: 40.7, longitude: -73.9, event: { slug: "founders-after-hours", name: "Founders After Hours", cover_image_url: null }, location: { id: CORGI_CAFE.id, name: "Corgi Cafe NYC", slug: "corgi-cafe-nyc" } },
      { ...base, id: "a-exact", title: "Spooktober", event_id: "spooktober", event_occurrence_id: "o2", location_id: CORGI_CAFE.id, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: 40.7, longitude: -73.9, event: { slug: "spooktober", name: "Spooktober", cover_image_url: null }, location: { id: CORGI_CAFE.id, name: "Corgi Cafe NYC", slug: "corgi-cafe-nyc" } },
    ],
  };
  globalThis.__fakeSupabase = fakeClient(tables);
  const rows = await D.getUpcomingAppearancesForBusiness("corgi");
  const hidden = rows.find((r) => r.id === "a-hidden");
  const exact = rows.find((r) => r.id === "a-exact");
  assert.deepEqual(
    [hidden.venue_name, hidden.address, hidden.location_id, hidden.location, hidden.latitude, hidden.longitude, hidden.location_hidden],
    [null, null, null, null, null, null, true]
  );
  assert.deepEqual([hidden.city, hidden.state], ["Manhattan", "NY"], "broad city/state stay public");
  assert.equal(exact.venue_name, "Corgi Cafe NYC");
  assert.equal(exact.location.slug, "corgi-cafe-nyc");
  assert.equal(exact.location_hidden, undefined);
  // Displayed label: the registration message, never the venue.
  assert.equal(FMT.resolveVenueLabel(hidden), "Location shared after registration");
  assert.equal(FMT.resolveVenueLabel(exact), "Corgi Cafe NYC");
  // Stored rows are never mutated by a read.
  assert.equal(tables.appearances[0].venue_name, "Corgi Cafe NYC");
});

test("Event page dates: a hidden Event's occurrences carry no Location / venue", async () => {
  const tables = {
    events: [ev("founders-after-hours", "Founders After Hours", "hidden")],
    event_occurrences: [{ id: "o1", event_id: "founders-after-hours", location_id: CORGI_CAFE.id, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", postal_code: "10016", start_at: FUTURE, end_at: FUTURE_END, status: "scheduled" }],
    locations: [{ id: CORGI_CAFE.id, name: "Corgi Cafe NYC", slug: "corgi-cafe-nyc", address: "121 East 27th Street", city: "Manhattan", state: "NY" }],
  };
  globalThis.__fakeSupabase = fakeClient(tables);
  const [o] = await D.getUpcomingOccurrencesForEvent("founders-after-hours");
  assert.deepEqual([o.location, o.location_id, o.venue_name, o.address, o.postal_code, o.location_hidden], [null, null, null, null, null, true]);
  assert.equal(o.city, "Manhattan");
});

test("privacy helper: withholds only precise fields, keeps shape and city/state", () => {
  const row = { id: "x", venue_name: "V", address: "A", postal_code: "10016", latitude: 1, longitude: 2, location_id: "L", location: { slug: "l" }, city: "C", state: "NY", title: "T" };
  assert.deepEqual(V.withholdPreciseLocation(row), { id: "x", venue_name: null, address: null, postal_code: null, latitude: null, longitude: null, location_id: null, location: null, city: "C", state: "NY", title: "T", location_hidden: true });
  assert.deepEqual(V.withholdPreciseLocation({ id: "y", title: "no place fields" }), { id: "y", title: "no place fields", location_hidden: true }, "never adds fields that weren't there");
});

test("every public read that can expose a place applies the parent Event's visibility", () => {
  const data = read("src/lib/data.ts");
  // Location-scoped feeds/counts exclude hidden Events.
  assert.match(data, /const occurrenceRows = await excludeHiddenEventRows\(supabase, rawOccurrenceRows \?\? \[\], \(row\) => row\.event_id/, "Location page (exact + Within)");
  assert.match(data, /const occurrenceCountRows = await excludeHiddenEventRows/, "Location discovery counts");
  assert.match(data, /const occurrencePreviewRows = await excludeHiddenEventRows/, "Location discovery previews");
  assert.match(data, /Hidden-location Events never count toward a precise place\./, "Locations list counts");
  // Appearance / occurrence / event reads mask.
  assert.equal((data.match(/return applyEventLocationPrivacy\(supabase, dedupeAppearances\(rows\)\.slice\(0, limit\), \(r\) => r\.event_id\);/g) ?? []).length, 2, "Business upcoming + past");
  assert.match(data, /const visible = hidden\.size \? reconciled\.map/, "Business Findmi Here reconciled activity");
  assert.match(data, /const reconciled = hiddenEvents\.size/, "Business card previews/counts");
  assert.equal((data.match(/return applyEventLocationPrivacy\(supabase, withLocations, \(\) => eventId\);/g) ?? []).length, 2, "Event dates (upcoming + all)");
  assert.match(data, /r\.event\.location_visibility === "hidden"\n\s+\? \{ \.\.\.r, event: withholdPreciseLocation\(r\.event\)/, "Event cards / discovery / search");
  assert.match(data, /rows\.filter\(\(r\) => r\.event\.location_visibility !== "hidden" \|\| \(!options\.locationId && matchesWithoutVenue/, "no search hit by a hidden venue");
  assert.match(data, /return applyEventLocationPrivacy\(supabase, items, \(r\) => r\.event_id\);/, "homepage appearance feed");
  assert.match(data, /const hiddenEvents = await fetchHiddenEventIds\(supabase, items\.map\(\(i\) => i\.event_id\)\);/, "/find feed");
  assert.match(data, /const rows = await applyEventLocationPrivacy\(supabase, \(data \?\? \[\]\) as Row\[\], \(r\) => r\.event_id\);/, "homepage bulletins");
  assert.match(data, /return applyEventLocationPrivacy\(supabase, \(data \?\? \[\]\) as Appearance\[\], \(\) => eventId\);/, "Event lineup Appearances");
  // No public read selects the new column by name (migration-tolerant).
  assert.doesNotMatch(data, /select\([^)]*location_visibility/);
  // Location featured Event never a hidden one.
  assert.match(read("src/lib/featured-event.ts"), /if \(\(await fetchHiddenEventIds\(supabase, \[eventId\]\)\)\.has\(eventId\)\) return false;/);
});

test("UI: hidden → 'Location shared after registration', no Location link, no Directions", () => {
  const card = read("src/components/AppearanceCard.tsx");
  assert.match(card, /const mapsQuery = locationHidden \? "" :/);
  assert.match(card, /const venueLabel = locationHidden \? HIDDEN_LOCATION_COPY :/);
  const qv = read("src/components/AppearanceQuickView.tsx");
  assert.match(qv, /const mapsQuery = locationHidden \? "" :/);
  assert.match(qv, /const venueLabel = locationHidden \? HIDDEN_LOCATION_COPY :/);
  const oqv = read("src/components/EventOccurrenceQuickView.tsx");
  assert.match(oqv, /const location = locationHidden \? null :/);
  assert.match(oqv, /const mapsQuery = locationHidden\n\s+\? ""/);
  assert.match(read("src/components/EventOccurrenceCard.tsx"), /occurrence\.location_hidden \? HIDDEN_LOCATION_COPY :/);
  assert.match(read("src/components/EventUtilityActions.tsx"), /mapQuery && !selected\.location_hidden/);
  assert.match(read("src/components/HomeEventCard.tsx"), /event\.location_visibility === "hidden"\) return null;/);
  const biz = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(biz, /!featuredAppearance\.location_hidden && publicLocationHref\(featuredAppearance\.location\)/);
  assert.match(biz, /const featuredMapsQuery = featuredAppearance && !featuredAppearance\.location_hidden/);
  assert.match(biz, /featuredAppearance\?\.location_hidden\n\s+\? HIDDEN_LOCATION_COPY/);
});

test("Admin: choosing Hidden clears the Event's own venue in the same save; dates/Appearances/Locations are not rewritten", () => {
  const admin = read("src/app/admin/(protected)/events/actions.ts");
  const i = admin.indexOf('if (str(formData, "location_visibility") === "hidden")');
  assert.ok(i > 0 && i < admin.indexOf("let eventId = id;"), "applied to the payload before the write");
  assert.match(admin.slice(i, i + 200), /venue_name: null, address: null, postal_code: null, latitude: null, longitude: null/);
  assert.doesNotMatch(admin.slice(i, admin.indexOf("let eventId = id;")), /from\("(locations|event_occurrences|appearances)"\)/);
});
