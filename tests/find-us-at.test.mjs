// Find Us At V1 — business_location_availability: third-party canonical
// Locations where a Business/Brand is normally available. Distinct from
// Our Locations (business_locations) and Findmi Here (Events/Appearances).
// Fake service/anon client over in-memory tables — no network, no data.
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

const A = await import("../src/lib/business-location-availability.ts");
const read = (p) => readFileSync(p, "utf8");

const loc = (id, name, over = {}) => ({ id, name, slug: id, address: `${name} St`, city: "New York", state: "NY", logo_url: null, cover_image_url: null, hours: null, is_demo: false, archived_at: null, trashed_at: null, ...over });
const biz = (id, name, over = {}) => ({ id, name, slug: id, logo_url: null, is_demo: false, publication_status: "live", ...over });

/** Tables: locations, businesses, business_locations, business_location_availability
 * (+ any others, recorded but never consulted by the helpers). */
function store(init = {}) {
  const t = {
    locations: [], businesses: [], business_locations: [], business_location_availability: [], business_location_availability_products: [], products: [], appearances: [], event_occurrences: [], event_businesses: [],
    ...init,
  };
  let n = 0;
  const read = [];
  const embed = (table, row) => {
    if (table === "business_location_availability_products") return { ...row, products: t.products?.find((p) => p.id === row.product_id) ?? null };
    if (table !== "business_location_availability") return row;
    return { ...row, locations: t.locations.find((l) => l.id === row.location_id) ?? null, businesses: t.businesses.find((b) => b.id === row.business_id) ?? null };
  };
  // Column defaults from the Where To Find Us details migration: status 'live',
  // no dates (ongoing) — rows in these fixtures predate/ignore those columns.
  const DEFAULTS = { status: "live", starts_on: null, ends_on: null };
  const get = (row, key) => (key.includes(".") ? row[key.split(".")[0]]?.[key.split(".")[1]] : (row[key] ?? DEFAULTS[key]));
  return {
    t,
    read,
    from(table) {
      read.push(table);
      const filters = [];
      let op = "select";
      let payload = null;
      const rows = () => t[table].map((r) => embed(table, r)).filter((r) => filters.every((f) => f(r)));
      const finish = () => {
        if (op === "delete") {
          const hit = rows().map((r) => r.id);
          t[table] = t[table].filter((r) => !hit.includes(r.id));
          return { data: hit.map((id) => ({ id })), error: null };
        }
        if (op === "upsert") {
          const exists = t[table].some((r) => r.business_id === payload.business_id && r.location_id === payload.location_id);
          if (exists) return { data: [], error: null };
          const row = { id: `row-${++n}`, created_at: `2026-10-15T00:00:${String(n).padStart(2, "0")}Z`, ...payload };
          t[table].push(row);
          return { data: [{ id: row.id }], error: null };
        }
        return { data: rows().filter((r) => (table === "business_location_availability" ? r.locations && r.businesses : true)), error: null };
      };
      const api = {
        select: () => api,
        eq: (k, v) => (filters.push((r) => get(r, k) === v), api),
        in: (k, list) => (filters.push((r) => list.includes(get(r, k))), api),
        is: (k, v) => (filters.push((r) => (get(r, k) ?? null) === v), api),
        not: (k, opName, list) => {
          const ids = list.replace(/[()]/g, "").split(",");
          filters.push((r) => !ids.includes(get(r, k)));
          return api;
        },
        // PostgREST "col.op.value,col.op.value" (OR of the clauses), enough for
        // the in-effect date window: is.null / lte / gte.
        or: (expr) => {
          const clauses = expr.split(",").map((c) => c.split("."));
          filters.push((r) =>
            clauses.some(([col, op, val]) => {
              const v = get(r, col) ?? null;
              return op === "is" ? v === null : op === "lte" ? v !== null && v <= val : v !== null && v >= val;
            })
          );
          return api;
        },
        order: () => api,
        range: (from, to) => Promise.resolve(((res) => ({ ...res, data: res.data.slice(from, to + 1) }))(finish())),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        upsert: (p) => ((op = "upsert"), (payload = p), api),
        delete: () => ((op = "delete"), api),
        then: (resolve) => resolve(finish()),
      };
      return api;
    },
  };
}

const WHOLE_FOODS = loc("whole-foods-bowery", "Whole Foods Bowery");
const EATALY = loc("eataly-flatiron", "Eataly Flatiron");
const CORGI_CAFE = loc("corgi-cafe-nyc", "Corgi Cafe NYC");
const HUDSON_YARDS = loc("hudson-yards", "Hudson Yards");
const BRAND = biz("brand-x", "Brand X");
const CORGI = biz("corgi", "Corgi");

test("connect (Admin path): an eligible canonical Location; idempotent — never a duplicate", async () => {
  const s = store({ locations: [WHOLE_FOODS], businesses: [BRAND] });
  assert.deepEqual(await A.connectBusinessLocationAvailability(s, "brand-x", "whole-foods-bowery"), { ok: true, already: false });
  assert.deepEqual(await A.connectBusinessLocationAvailability(s, "brand-x", "whole-foods-bowery"), { ok: true, already: true });
  assert.equal(s.t.business_location_availability.length, 1);
  assert.deepEqual(Object.keys(s.t.business_location_availability[0]).sort(), ["business_id", "created_at", "id", "location_id"], "no copied place data");
  const sql = read("supabase/migrations/20261015000000_business_location_availability.sql");
  assert.match(sql, /constraint business_location_availability_business_location_key\n\s+unique \(business_id, location_id\)/, "DB-level uniqueness");
});

test("connect is refused for a Location the Business operates (Our Locations) — nothing converted or removed", async () => {
  const s = store({ locations: [CORGI_CAFE], businesses: [CORGI], business_locations: [{ id: "bl1", business_id: "corgi", location_id: "corgi-cafe-nyc" }] });
  const r = await A.connectBusinessLocationAvailability(s, "corgi", "corgi-cafe-nyc");
  assert.deepEqual(r, { ok: false, error: A.ALREADY_OUR_LOCATION_ERROR });
  assert.equal(s.t.business_location_availability.length, 0);
  assert.equal(s.t.business_locations.length, 1, "Our Locations untouched");
});

test("connect is refused for a trashed/missing Location (never creates one)", async () => {
  const s = store({ locations: [loc("gone", "Gone", { trashed_at: "2026-01-01" })], businesses: [BRAND] });
  assert.equal((await A.connectBusinessLocationAvailability(s, "brand-x", "gone")).ok, false);
  assert.equal((await A.connectBusinessLocationAvailability(s, "brand-x", "nope")).ok, false);
  assert.equal(s.t.locations.length, 1);
});

test("remove deletes ONLY the availability row — Location, Business, Our Locations, Events, Appearances stay", async () => {
  const s = store({
    locations: [WHOLE_FOODS], businesses: [BRAND],
    business_location_availability: [{ id: "a1", business_id: "brand-x", location_id: "whole-foods-bowery", created_at: "2026-10-15" }],
    business_locations: [{ id: "bl9", business_id: "brand-x", location_id: "other" }],
    appearances: [{ id: "ap1", location_id: "whole-foods-bowery" }],
  });
  assert.deepEqual(await A.removeBusinessLocationAvailability(s, "brand-x", "whole-foods-bowery"), { ok: true });
  assert.equal(s.t.business_location_availability.length, 0);
  assert.deepEqual([s.t.locations.length, s.t.businesses.length, s.t.business_locations.length, s.t.appearances.length], [1, 1, 1, 1]);
  assert.equal((await A.removeBusinessLocationAvailability(s, "brand-x", "whole-foods-bowery")).ok, false, "nothing to remove");
  const fn = read("src/lib/business-location-availability.ts");
  const remove = fn.slice(fn.indexOf("export async function removeBusinessLocationAvailability"));
  assert.doesNotMatch(remove, /from\("(locations|businesses|business_locations|events|event_occurrences|appearances)"\)/);
});

test("Brand page: one / several Find Us At Locations — canonical data, each once; none → no section", async () => {
  const s = store({
    locations: [WHOLE_FOODS, EATALY, loc("pending", "Pending", { is_demo: true }), loc("archived", "Archived", { archived_at: "2026-01-01" })],
    businesses: [BRAND],
    business_location_availability: [
      { id: "a1", business_id: "brand-x", location_id: "whole-foods-bowery", created_at: "1" },
      { id: "a2", business_id: "brand-x", location_id: "eataly-flatiron", created_at: "2" },
      { id: "a3", business_id: "brand-x", location_id: "pending", created_at: "3" },
      { id: "a4", business_id: "brand-x", location_id: "archived", created_at: "4" },
    ],
  });
  const page = await A.getAvailabilityLocationsForBusiness(s, "brand-x", { publicOnly: true, limit: A.FIND_US_AT_PUBLIC_LIMIT });
  assert.deepEqual(page.items.map((i) => i.name), ["Whole Foods Bowery", "Eataly Flatiron"], "pending/archived excluded; each once");
  assert.equal(page.items[0].address, "Whole Foods Bowery St", "address read from the canonical Location");
  assert.equal(A.FIND_US_AT_PUBLIC_LIMIT, 6);
  const one = await A.getAvailabilityLocationsForBusiness(s, "nobody", { publicOnly: true });
  assert.deepEqual(one.items, []);
  assert.match(read("src/components/FindUsAt.tsx"), /if \(locations\.length === 0\) return null;/);
  assert.match(read("src/components/FindUsAt.tsx"), /<CompactLocationCard location=\{l\} \/>/, "same canonical card (links to /location/[slug])");
  assert.match(read("src/components/OurLocations.tsx"), /href = publicLocationHref\(\{ slug: location\.slug \}\)/, "a contextual reference links to the Location page, discovery-ready or not");
});

test("public Find Us At excludes a pair that is also an Our Location (bad data defense)", async () => {
  const s = store({
    locations: [CORGI_CAFE, WHOLE_FOODS], businesses: [CORGI],
    business_locations: [{ id: "bl1", business_id: "corgi", location_id: "corgi-cafe-nyc" }],
    business_location_availability: [
      { id: "a1", business_id: "corgi", location_id: "corgi-cafe-nyc", created_at: "1" },
      { id: "a2", business_id: "corgi", location_id: "whole-foods-bowery", created_at: "2" },
    ],
  });
  assert.deepEqual((await A.getAvailabilityLocationsForBusiness(s, "corgi", { publicOnly: true })).items.map((i) => i.name), ["Whole Foods Bowery"]);
});

test("Events / Appearances at a Location never make it Find Us At (nothing infers availability)", async () => {
  const s = store({
    locations: [HUDSON_YARDS], businesses: [biz("illy", "illy")],
    appearances: [{ id: "ap", business_id: "illy", location_id: "hudson-yards" }],
    event_occurrences: [{ id: "o", location_id: "hudson-yards" }],
    event_businesses: [{ business_id: "illy" }],
  });
  assert.deepEqual((await A.getAvailabilityLocationsForBusiness(s, "illy", { publicOnly: true })).items, []);
  assert.deepEqual((await A.getAvailableBrandsForLocation(s, "hudson-yards", { publicOnly: true })).items, []);
  assert.ok(!s.read.some((t) => ["appearances", "event_occurrences", "event_businesses", "events"].includes(t)), "Event/Appearance tables are never read");
  // No code path writes availability except the Admin action.
  const lib = read("src/lib/business-location-availability.ts");
  assert.equal((lib.match(/from\("business_location_availability"\)\s*\n?\s*\.upsert/g) ?? []).length, 1);
});

test("Location page: Brands Available Here — live Brands only, never this place's operator; none → no section", async () => {
  const s = store({
    locations: [CORGI_CAFE],
    businesses: [CORGI, BRAND, biz("draft", "Draft Brand", { publication_status: "pending_review" }), biz("demo", "Demo Brand", { is_demo: true })],
    business_locations: [{ id: "bl1", business_id: "corgi", location_id: "corgi-cafe-nyc" }],
    business_location_availability: [
      { id: "a0", business_id: "corgi", location_id: "corgi-cafe-nyc", created_at: "0" },
      { id: "a1", business_id: "brand-x", location_id: "corgi-cafe-nyc", created_at: "1" },
      { id: "a2", business_id: "draft", location_id: "corgi-cafe-nyc", created_at: "2" },
      { id: "a3", business_id: "demo", location_id: "corgi-cafe-nyc", created_at: "3" },
    ],
  });
  const brands = await A.getAvailableBrandsForLocation(s, "corgi-cafe-nyc", { publicOnly: true });
  assert.deepEqual(brands.items.map((b) => [b.name, b.slug]), [["Brand X", "brand-x"]], "Corgi operates it → Operated By only, not here");
  const view = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  assert.match(view, /\{availableBrands\.items\.length > 0 && \(/);
  assert.match(view, /Brands Available Here/);
  assert.match(view, /href=\{`\/business\/\$\{b\.slug\}`\}/);
  // Operated By unchanged and separate.
  assert.match(view, /getOperatorsForLocation\(getSupabase\(\), location\.id, \{ limit: 6, publicOnly: true \}\)/);
  assert.match(view, /<p className="text-xs font-bold uppercase tracking-wide text-ink\/45">Operated By<\/p>/);
  assert.ok(view.indexOf(">Operated By<") < view.indexOf('id="brands-available-here"'), "Operated By first, then Brands Available Here");
});

test("placement, Admin wiring, RLS migration, no map", () => {
  const page = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  const ours = page.indexOf("<OurLocations ");
  const find = page.indexOf("<FindUsAt ");
  assert.ok(ours > 0 && find > ours && find < page.indexOf("{products.length > 0 && ("), "Findmi Here → Our Locations → Find Us At → Products");
  assert.match(page, /getAvailabilityLocationsForBusiness\(getSupabase\(\), business\.id, \{ publicOnly: true, limit: FIND_US_AT_PUBLIC_LIMIT \}\)/);
  const markup = read("src/components/FindUsAt.tsx").replace(/\/\*\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(markup, />\s*View All|href=\{?["`'][^"`']*find-us-at|View on Map|\/map\b/i, "no dead View All, no map");
  const adminPage = read("src/app/admin/(protected)/businesses/[id]/page.tsx");
  assert.doesNotMatch(adminPage, /\{ key: "find-us-at", label: "Find Us At" \}/, "no longer a separate top-level tab");
  assert.match(adminPage, /"find-us-at": "locations"/, "old ?tab=find-us-at links land on Locations");
  assert.match(adminPage, /tab === "locations" && \(\s*<div className="mt-5[^"]*">\s*<p className="text-sm font-semibold text-ink">Find Us Here<\/p>/, "Find Us Here is the second section inside Locations");
  assert.match(adminPage, /<form action=\{adminConnectFindUsAt\.bind\(null, id\)\}/);
  assert.match(adminPage, /entity="locations"/, "existing searchable Location picker");
  assert.match(read("src/app/admin/(protected)/businesses/availability-actions.ts"), /const admin = await requireAdminSupabase\(\);/, "Admin only");
  const sql = read("supabase/migrations/20261015000000_business_location_availability.sql");
  assert.match(sql, /alter table public\.business_location_availability enable row level security;/);
  assert.match(sql, /for select\n\s+to anon, authenticated\n\s+using \(true\);/);
  assert.match(sql, /revoke all on public\.business_location_availability from anon, authenticated;/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /insert into|update public\.|delete from|for (insert|update|delete|all)\b/i, "no write policies, no data");
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /address|latitude|longitude|hours|kind|status|product_id/, "no copied/speculative columns");
});

test("public detail: relationship, products, dates come through for Live in-effect entries only; Pending/Declined/expired never do", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const s = store({
    locations: [WHOLE_FOODS, EATALY, HUDSON_YARDS, CORGI_CAFE],
    businesses: [BRAND],
    products: [
      { id: "p1", name: "Espresso", slug: "espresso", is_active: true },
      { id: "p2", name: "Lungo", slug: "lungo", is_active: true },
      { id: "p3", name: "Retired", slug: "retired", is_active: false },
    ],
    business_location_availability: [
      { id: "a-live", business_id: "brand-x", location_id: "eataly-flatiron", created_at: "2026-10-15T00:00:01Z", relationship: "served", status: "live", starts_on: null, ends_on: day(20), note: "Counter" },
      { id: "a-pending", business_id: "brand-x", location_id: "whole-foods-bowery", created_at: "2026-10-15T00:00:02Z", relationship: "sold", status: "pending" },
      { id: "a-declined", business_id: "brand-x", location_id: "hudson-yards", created_at: "2026-10-15T00:00:03Z", relationship: "sold", status: "declined" },
      { id: "a-expired", business_id: "brand-x", location_id: "corgi-cafe-nyc", created_at: "2026-10-15T00:00:04Z", relationship: "sold", status: "live", ends_on: day(-3) },
    ],
    business_location_availability_products: [
      { availability_id: "a-live", product_id: "p1" },
      { availability_id: "a-live", product_id: "p2" },
      { availability_id: "a-live", product_id: "p3" },
      { availability_id: "a-pending", product_id: "p1" },
    ],
  });
  const page = await A.getAvailabilityLocationsForBusiness(s, "brand-x", { publicOnly: true });
  assert.deepEqual(page.items.map((i) => i.locationId), ["eataly-flatiron"], "only the Live, in-effect entry");
  const d = page.items[0].detail;
  assert.deepEqual(d.relationships, ["served"]);
  assert.equal(d.endsOn, day(20));
  assert.equal(d.note, "Counter");
  assert.deepEqual(d.products.map((p) => p.name), ["Espresso", "Lungo"], "inactive products never named");
  const brands = await A.getAvailableBrandsForLocation(s, "eataly-flatiron", { publicOnly: true });
  assert.deepEqual(brands.items[0].detail.relationships, ["served"]);
  assert.deepEqual((await A.getAvailableBrandsForLocation(s, "whole-foods-bowery", { publicOnly: true })).items, [], "Pending not public from the Location side either");
  assert.deepEqual((await A.getAvailableBrandsForLocation(s, "hudson-yards", { publicOnly: true })).items, [], "Declined neither");
  assert.ok(today);
});
