// Area Visibility + Creation Geography — "Visible on Findmi" is the existing
// consumer_visible flag on Markets (parents) and Areas (children). It only
// decides what the public Area selectors expose; creation of Businesses,
// Locations, Events and Appearances checks `active` alone and never
// requires a Findmi Area. Pure rule tests + source guards + a fake-client
// test of the consumer expansion request. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const V = await import("../src/lib/area-visibility.ts");
const MR = await import("../src/lib/market-requests.ts");
const read = (p) => readFileSync(p, "utf8");

const market = (id, consumer_visible = true, active = true) => ({ id, name: id, active, consumer_visible });
const area = (name, market_id, consumer_visible = true, active = true) => ({ name, market_id, active, consumer_visible });
const tree = (markets, areas) => V.buildVisibleAreaTree(markets, areas).map((m) => [m.id, m.areas.map((a) => a.name)]);

test("A. visible parent + visible children → both shown", () => {
  assert.deepEqual(tree([market("New York City")], [area("Manhattan", "New York City"), area("Brooklyn", "New York City")]), [["New York City", ["Manhattan", "Brooklyn"]]]);
});

test("B. visible parent + hidden child → parent shown, hidden child not", () => {
  const areas = [area("Manhattan", "New York City"), area("Brooklyn", "New York City"), area("Queens", "New York City", false), area("Bronx", "New York City", false)];
  assert.deepEqual(tree([market("New York City"), market("North Jersey")], [...areas, area("Jersey City", "North Jersey"), area("Hoboken", "North Jersey")]), [
    ["New York City", ["Manhattan", "Brooklyn"]],
    ["North Jersey", ["Jersey City", "Hoboken"]],
  ]);
});

test("C/D. hidden parent hides children; children's own settings are untouched and return when the parent is on again", () => {
  const areas = [area("Manhattan", "New York City"), area("Brooklyn", "New York City"), area("Queens", "New York City", false)];
  const snapshot = JSON.stringify(areas);
  assert.deepEqual(tree([market("New York City", false)], areas), []);
  assert.equal(JSON.stringify(areas), snapshot, "child preferences never rewritten");
  assert.deepEqual(tree([market("New York City", true)], areas), [["New York City", ["Manhattan", "Brooklyn"]]]);
  assert.equal(V.isAreaVisibleOnFindmi(areas[0], market("New York City", false)), false);
  assert.equal(V.isAreaVisibleOnFindmi(areas[0], market("New York City", true)), true);
});

test("E/K. hidden standalone Market and inactive rows never reach the public selector", () => {
  assert.deepEqual(tree([market("Huntsville", false), market("Retired", true, false), market("Long Island")], [area("Hamptons", "Long Island"), area("Old", "Long Island", true, false)]), [["Long Island", ["Hamptons"]]]);
  assert.equal(V.isMarketVisibleOnFindmi({ active: true, consumer_visible: undefined }), true, "older rows default visible");
});

test("K. every public Area selector uses the visible-only tree; the tree is the one rule", () => {
  for (const page of ["page.tsx", "businesses/page.tsx", "events/page.tsx", "locations/page.tsx", "discover/page.tsx", "find/page.tsx"]) {
    const src = read(`src/app/(public)/${page}`);
    assert.match(src, /getConsumerVisibleMarketsWithAreas\(\)/, page);
    assert.doesNotMatch(src, /getActiveMarkets\(|getActiveMarketsWithAreaOptions\(/, `${page} never lists internal-only geography`);
  }
  const data = read("src/lib/data.ts");
  const fn = data.slice(data.indexOf("export async function getConsumerVisibleMarketsWithAreas"), data.indexOf("export function getMarketAreaLabel"));
  assert.match(fn, /return buildVisibleAreaTree\(markets, \(areaRows \?\? \[\]\) as MarketArea\[\]\);/);
  assert.match(data, /export async function getConsumerVisibleMarkets\(\)[\s\S]*?\.eq\("active", true\)\s*\.eq\("consumer_visible", true\)/);
});

test("F. no migration: existing columns default to visible, so current public Areas are unchanged", () => {
  const files = readdirSync("supabase/migrations");
  assert.match(read(`supabase/migrations/${files.find((f) => f.includes("area_picker_and_market_requests"))}`), /add column if not exists consumer_visible boolean not null default true;/);
  assert.match(read(`supabase/migrations/${files.find((f) => f.includes("market_areas_and_request_resolution"))}`), /consumer_visible boolean not null default true,/);
  assert.equal(files.filter((f) => f.endsWith(".sql")).sort().at(-1), "20261015000000_business_location_availability.sql" /* a later pass (Find Us At) */, "this pass adds no migration");
});

test("G/H/I. creation never depends on visibility: pickers list ACTIVE geography and the database checks `active` only", () => {
  assert.match(read("src/app/(public)/account/business/new/page.tsx"), /getActiveMarkets\(\)/);
  assert.match(read("src/app/(public)/account/event/new/page.tsx"), /getActiveMarkets\(\)/);
  assert.match(read("src/app/(public)/account/location/new/page.tsx"), /getActiveMarketsWithAreaOptions\(\)/);
  for (const f of readdirSync("supabase/migrations")) {
    const sql = read(`supabase/migrations/${f}`);
    for (const fn of ["create_owned_business", "create_owned_event", "create_owned_location"]) {
      const at = sql.indexOf(`create or replace function public.${fn}`);
      if (at === -1) continue;
      const body = sql.slice(at, sql.indexOf("$$;", at));
      assert.doesNotMatch(body, /consumer_visible/, `${f} ${fn} never checks visibility`);
    }
  }
  // Event + Location: a Market is optional (only "pick one OR request one").
  for (const p of ["src/app/(public)/account/event/actions.ts", "src/app/(public)/account/location/actions.ts"]) {
    const src = read(p);
    assert.match(src, /Choose an existing Market OR request one, not both\./);
    assert.doesNotMatch(src, /fail\("(Choose|Select) a (Market|Findmi Area)/);
  }
  // Free-typed place geography (Appearance city/state, requests) is matched against ALL active rows, hidden or not.
  const mr = read("src/lib/market-requests.ts");
  assert.match(mr, /admin\.from\("markets"\)\.select\("id, name, display_name, slug, areas_included"\)\.eq\("active", true\)/);
  assert.match(mr, /admin\.from\("market_areas"\)\.select\("id, market_id, name, display_name, slug, aliases"\)\.eq\("active", true\)/);
  assert.doesNotMatch(mr.slice(mr.indexOf("export async function findExistingGeographyMatch"), mr.indexOf("export async function findOrCreateConsumerMarketRequest")), /consumer_visible/);
  // No "not available here" gate anywhere in creation.
  for (const p of ["src/app/(public)/account/event/actions.ts", "src/app/(public)/account/location/actions.ts", "src/app/(public)/account/business/actions.ts"]) {
    assert.doesNotMatch(read(p), /not available here|isn['’]t on Findmi yet/i);
  }
});

/** Fake service-role client: Markets/Areas reads + a recorded insert log. */
function fakeAdmin({ markets, areas }) {
  const inserts = [];
  const from = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      neq: () => q,
      maybeSingle: async () => ({ data: null }),
      insert: (row) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "req-1" }, error: null }) }) };
      },
      then: (resolve) => resolve({ data: table === "markets" ? markets : table === "market_areas" ? areas : [] }),
    };
    return q;
  };
  return { client: { from }, inserts };
}

test("J. 'Bring Huntsville to Findmi' when Huntsville exists but is hidden → reuses it, never creates an Area", async () => {
  const { client, inserts } = fakeAdmin({
    markets: [{ id: "m-al", name: "Alabama", display_name: null, slug: "alabama", areas_included: null }],
    areas: [{ id: "a-hsv", market_id: "m-al", name: "Huntsville", display_name: null, slug: "huntsville", aliases: null }],
  });
  const result = await MR.findOrCreateConsumerMarketRequest(client, { text: "Huntsville" });
  assert.equal(result.match?.areaId, "a-hsv");
  assert.deepEqual(inserts.map((i) => i.table), ["market_requests"], "only a request row — never markets/market_areas");
  assert.equal(inserts[0].row.mapped_area_id, "a-hsv");
  assert.equal(inserts[0].row.status, "mapped");
});

test("J2. the consumer sees the same answer whether or not the place exists internally", () => {
  const picker = read("src/components/discover/AreaPicker.tsx");
  assert.doesNotMatch(picker, /already known to Findmi|matchedLabel/);
  assert.match(picker, /You&rsquo;re on the list!/);
  assert.match(picker, /We&rsquo;ll notify you when Findmi launches there\./);
});

test("Admin: one 'Visible on Findmi' control per Market and per Area, visible at a glance with effective state", () => {
  assert.match(read("src/app/admin/(protected)/markets/MarketForm.tsx"), /label="Visible on Findmi"\s+name="consumer_visible"/);
  assert.match(read("src/app/admin/(protected)/markets/AreaForm.tsx"), /label="Visible on Findmi"\s+name="consumer_visible"/);
  assert.doesNotMatch(read("src/app/admin/(protected)/market-requests/page.tsx"), /Show in consumer Area picker/);
  const list = read("src/app/admin/(protected)/markets/page.tsx");
  assert.match(list, /\{adminVisibilityLabel\(m\)\}/);
  assert.match(list, /const label = adminVisibilityLabel\(a, m\);/);
  assert.match(read("src/app/admin/(protected)/markets/[id]/page.tsx"), /\{a\.active \? adminVisibilityLabel\(a, market\) : "Inactive"\}/);
  assert.equal(V.adminVisibilityLabel({ active: true, consumer_visible: true }), "Visible on Findmi");
  assert.equal(V.adminVisibilityLabel({ active: true, consumer_visible: false }), "Hidden");
  assert.equal(V.adminVisibilityLabel({ active: true, consumer_visible: true }, { name: "New York City", active: true, consumer_visible: false }), "Visible on Findmi — not shown while New York City is hidden");
  // the actions persist exactly what the checkbox says (no parent→child rewrite)
  const actions = read("src/app/admin/(protected)/markets/actions.ts");
  assert.match(actions, /consumer_visible: bool\(formData, "consumer_visible"\),/);
  assert.doesNotMatch(actions, /from\("market_areas"\)\.update\(\{ consumer_visible/);
});
