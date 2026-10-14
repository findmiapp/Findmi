// Our Locations — the public Brand-page section for permanent places a
// Business operates, from the EXISTING business_locations relationship
// (explicit Business ↔ Location links only). Never Event venues, Appearance
// places, pop-ups or stockists. Fake anon client only — no network.
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

const BL = await import("../src/lib/business-locations.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI = "ef134d41-4264-46e4-8fa5-aacd0f6afa50";
const BABYLIST = "308e92ba-2134-4926-a337-f815715c2864";
const loc = (id, name, slug, over = {}) => ({ id, name, slug, address: null, city: "New York", state: "NY", logo_url: null, cover_image_url: null, hours: null, is_demo: false, archived_at: null, trashed_at: null, ...over });
const CORGI_CAFE = loc("660d3744-dc88-4e91-856c-c0a296c9e776", "Corgi Cafe NYC", "corgi-cafe-nyc", { address: "121 East 27th Street", city: "Manhattan", hours: { mon: { open: "08:00", close: "18:00" } } });
const BABYLIST_SOHO = loc("b70ecb01-835a-4a04-bcf8-f717ed3bef14", "Babylist Soho", "babylist-soho", { address: "477 Broadway" });
const HUDSON_YARDS = loc("hy", "Hudson Yards", "hudson-yards");

/** business_locations with an embedded `locations` row; supports the
 * reader's eq / is filters (dotted = on the embed), order and range. */
function fakeClient(links, extraTables = {}) {
  const tablesRead = [];
  return {
    tablesRead,
    from(table) {
      tablesRead.push(table);
      const filters = [];
      const get = (row, key) => (key.includes(".") ? row[key.split(".")[0]]?.[key.split(".")[1]] : row[key]);
      const api = {
        select: () => api,
        eq: (k, v) => (filters.push((r) => get(r, k) === v), api),
        is: (k, v) => (filters.push((r) => (get(r, k) ?? null) === v), api),
        in: (k, v) => (filters.push((r) => v.includes(get(r, k))), api),
        order: () => api,
        range: (from, to) => {
          const rows = (table === "business_locations" ? links : (extraTables[table] ?? []))
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at))
            .slice(from, to + 1);
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}
const link = (business_id, location, is_primary, created_at = "2026-10-01") => ({ business_id, location_id: location.id, is_primary, created_at, locations: location });

test("one operated Location → Our Locations item with canonical data (address, hours) and its own link", async () => {
  const c = fakeClient([link(CORGI, CORGI_CAFE, true)]);
  const page = await BL.getLocationsForBusiness(c, CORGI, { publicOnly: true });
  assert.equal(page.items.length, 1);
  const [l] = page.items;
  assert.deepEqual([l.name, l.slug, l.address, l.city, l.isPrimary], ["Corgi Cafe NYC", "corgi-cafe-nyc", "121 East 27th Street", "Manhattan", true]);
  assert.deepEqual(l.hours?.mon, { closed: false, open: "08:00", close: "18:00" }, "the Location's own hours (no copy)");
  assert.deepEqual(c.tablesRead, ["business_locations"], "only the explicit relationship is read");
  const card = read("src/components/OurLocations.tsx");
  assert.match(card, /href=\{`\/location\/\$\{location\.slug\}`\}/, "links to the canonical Location page");
});

test("several operated Locations → each exactly once, primary first; Corgi/Babylist shapes representable", async () => {
  const second = loc("corgi-2", "Corgi Cafe Brooklyn", "corgi-cafe-brooklyn");
  const c = fakeClient([link(CORGI, second, false, "2026-10-05"), link(CORGI, CORGI_CAFE, true, "2026-10-09"), link(BABYLIST, BABYLIST_SOHO, true)]);
  const corgi = await BL.getLocationsForBusiness(c, CORGI, { publicOnly: true });
  assert.deepEqual(corgi.items.map((i) => i.name), ["Corgi Cafe NYC", "Corgi Cafe Brooklyn"]);
  const babylist = await BL.getLocationsForBusiness(c, BABYLIST, { publicOnly: true });
  assert.deepEqual(babylist.items.map((i) => i.slug), ["babylist-soho"]);
});

test("Event participation / Appearances at a Location never make it 'Our Location'", async () => {
  // illy appearing at Hudson Yards: an Appearance + an Event date there, no link.
  const c = fakeClient([], {
    appearances: [{ business_id: "illy", location_id: HUDSON_YARDS.id }],
    event_occurrences: [{ location_id: HUDSON_YARDS.id }],
    event_businesses: [{ business_id: "illy" }],
  });
  const page = await BL.getLocationsForBusiness(c, "illy", { publicOnly: true });
  assert.deepEqual(page.items, []);
  assert.ok(!c.tablesRead.some((t) => t !== "business_locations"), "no Event/Appearance table is consulted");
  // The public page section reads only this relationship.
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(view, /getLocationsForBusiness\(getSupabase\(\), business\.id, \{ publicOnly: true, limit: OUR_LOCATIONS_LIMIT \}\)/);
  assert.match(view, /<OurLocations businessName=\{business\.name\} locations=\{ourLocations\.items\}/);
});

test("public: pending, archived or trashed Locations are not shown", async () => {
  const c = fakeClient([
    link(CORGI, loc("p", "Pending", "pending", { is_demo: true }), false),
    link(CORGI, loc("a", "Archived", "archived", { archived_at: "2026-01-01" }), false),
    link(CORGI, loc("t", "Trashed", "trashed", { trashed_at: "2026-01-01" }), false),
    link(CORGI, CORGI_CAFE, true),
  ]);
  assert.deepEqual((await BL.getLocationsForBusiness(c, CORGI, { publicOnly: true })).items.map((i) => i.name), ["Corgi Cafe NYC"]);
});

test("no operated Locations → no empty section", () => {
  const section = read("src/components/OurLocations.tsx");
  assert.match(section, /if \(locations\.length === 0\) return null;/);
  assert.match(section, />\s*Our Locations\s*</, "Title Case heading");
});

test("adding an existing Location never duplicates; removing deletes only the relationship", () => {
  const sql = read("supabase/migrations/20261003020000_business_locations.sql");
  assert.match(sql, /constraint business_locations_business_location_key unique \(business_id, location_id\)/);
  assert.match(sql, /on conflict \(business_id, location_id\) do nothing/, "link is idempotent");
  const unlink = sql.slice(sql.indexOf("create or replace function public.unlink_business_location"), sql.indexOf("revoke all on function"));
  assert.match(unlink, /delete from public\.business_locations/);
  assert.doesNotMatch(unlink, /delete from public\.(locations|events|event_occurrences|appearances|businesses)\b/, "never deletes the Location, Events, Appearances or the Business");
  // Management stays on the existing, authorized paths.
  assert.match(read("src/app/(public)/account/business/location-actions.ts"), /await requireBusinessManager\(businessId\);\n\s+await requireLocationManager\(businessId, locationId\);/, "a Business can only connect a Location it also manages");
  assert.match(read("src/app/admin/(protected)/businesses/[id]/page.tsx"), /<p className="text-sm font-semibold text-ink">Our Locations<\/p>/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/PresenceViews.tsx"), /\{ key: "locations", label: "Our Locations" \}/);
});

test("placement + mobile: right after Findmi Here; compact cards, one column on phones", () => {
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  const here = view.indexOf('<section id="findmi-here"');
  const ours = view.indexOf("<OurLocations ");
  const products = view.indexOf("{products.length > 0 && (");
  assert.ok(here > 0 && here < ours && ours < products, "Findmi Here → Our Locations → Products");
  const section = read("src/components/OurLocations.tsx");
  assert.match(section, /grid gap-3 \$\{single \? "" : "sm:grid-cols-2"\}/, "single column on phones; two from sm when several");
  assert.match(section, /truncate/, "long names/addresses never overflow");
  assert.match(section, /<LocationOpenBadge hours=\{location\.hours\} \/>/, "open/closed from existing Location hours");
});
