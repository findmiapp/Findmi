// Commercial Discovery Foundation (Growth → Targets → Discover): the pure rules
// (lib/discovery/commercial.ts), the server reader against an in-memory fake
// client (lib/discovery/commercial-server.ts) — geography per entity, derived
// roles, categories, search, paging, organic ranking, Target state, Opportunity
// context, privacy — Target creation through the live business_targets path,
// the additive category seed, and the page wiring. No network, no database.
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

const C = await import("../src/lib/discovery/commercial.ts");
const S = await import("../src/lib/discovery/commercial-server.ts");
const L = await import("../src/lib/business-targets.ts");
const I = await import("../src/lib/commercial-intents.ts");
const read = (p) => readFileSync(p, "utf8");
const MIGRATION = "supabase/migrations/20261107000000_commercial_discovery_categories.sql";
const V2 = "src/app/(public)/account/business/[id]/v2";
const PAGE = "src/app/(public)/account/business/[id]/(manager)/page.tsx";
const NOW = new Date("2026-10-23T16:00:00.000Z");

// ── Ids ────────────────────────────────────────────────────────────────────
const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const M_NYC = u(1), M_NJ = u(2);
const A_MANHATTAN = u(10), A_SOHO = u(11), A_BROOKLYN = u(12), A_JC = u(13), A_BERGEN = u(14), A_DOWNTOWN_JC = u(15);
const CAT_RETAIL = u(20), CAT_COMMUNITY = u(21), CAT_RESIDENTIAL = u(22), CAT_BEVERAGE = u(23), CAT_AGENCY = u(24), CAT_FOOD_EVT = u(25), CAT_BEER_EVT = u(26), F_MARKET = u(27), F_FESTIVAL = u(28), CAT_PRODUCT = u(29);
const L_BABYLIST = u(30), L_3ACRES = u(31), L_UNLISTED = u(32), L_ARCHIVED = u(33), L_LAVAZZA = u(34), L_JC_PLAZA = u(35), L_DRAFT_OPS = u(36), L_OURS = u(37);
const B_MOCKTAIL = u(40), B_BABYLIST = u(41), B_LAVAZZA = u(42), B_FREEBEAN = u(43), B_PAID = u(44), B_ORGANIC = u(45), B_GROWING = u(46), B_APPEARING = u(47), B_PAST = u(48), B_DRAFT = u(49), B_BEVERAGE = u(50), B_JC_AREA = u(51), B_PROMO_AREA = u(52);
const E_SOHO_MARKET = u(60), E_BK_FEST = u(61), E_PAST = u(62), E_LISTED = u(63), E_GEOLESS = u(64), E_GHOST = u(65), E_DRAFT = u(66), E_JC = u(67), E_ELSEWHERE = u(68);
const T_EXISTING = u(70);
const O_3ACRES = u(80), O_EVENT = u(81), O_SENT = u(82), O_PRIVATE = u(83), O_LAVAZZA_LOC = u(84);

function seed() {
  const loc = (id, name, market_id, market_area_id, category_id, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), city: "New York", state: "NY", address: "1 Main St", cover_image_url: null, logo_url: null, is_demo: false, archived_at: null, trashed_at: null, market_id, market_area_id, category_id, place_type: "store", ...extra });
  const biz = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), city: "New York", state: "NY", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, market_area_id: null, is_featured: false, ...extra });
  const evt = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), city: "New York", venue_name: null, cover_image_url: null, start_date: null, end_date: null, start_at: null, end_at: null, market_id: null, market_area_id: null, host_business_id: null, organizer_name: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, is_featured: false, ...extra });
  const occ = (event_id, occurrence_date, extra = {}) => ({ id: `occ-${event_id}-${occurrence_date}`, event_id, occurrence_date, start_at: `${occurrence_date}T22:00:00.000Z`, end_at: null, location_id: null, market_id: null, status: "scheduled", ...extra });
  const listing = (id, title, extra = {}) => ({ id, title, status: "open", opportunity_type: "activation", location_id: null, event_id: null, starts_at: null, response_deadline: null, visibility: "discoverable", market_id: null, market_area_id: null, created_at: "2026-10-01", ...extra });
  return {
    markets: [
      { id: M_NYC, name: "NYC", slug: "nyc", sort_order: 1, active: true },
      { id: M_NJ, name: "North Jersey", slug: "north-jersey", sort_order: 2, active: true },
    ],
    market_areas: [
      { id: A_MANHATTAN, name: "Manhattan", display_name: null, slug: "manhattan", market_id: M_NYC, parent_area_id: null, active: true },
      { id: A_SOHO, name: "SoHo", display_name: null, slug: "soho", market_id: M_NYC, parent_area_id: A_MANHATTAN, active: true },
      { id: A_BROOKLYN, name: "Brooklyn", display_name: null, slug: "brooklyn", market_id: M_NYC, parent_area_id: null, active: true },
      { id: A_JC, name: "Jersey City", display_name: null, slug: "jersey-city", market_id: M_NJ, parent_area_id: null, active: true },
      { id: A_BERGEN, name: "Bergen-Lafayette", display_name: null, slug: "bergen-lafayette", market_id: M_NJ, parent_area_id: A_JC, active: true },
      { id: A_DOWNTOWN_JC, name: "Downtown", display_name: "Downtown JC", slug: "downtown", market_id: M_NJ, parent_area_id: A_JC, active: true },
    ],
    categories: [
      { id: CAT_RETAIL, name: "Retail Store", kind: "location", parent_id: null },
      { id: CAT_COMMUNITY, name: "Community Space", kind: "location", parent_id: null },
      { id: CAT_RESIDENTIAL, name: "Residential", kind: "location", parent_id: null },
      { id: CAT_BEVERAGE, name: "Coffee, Tea & Beverages", kind: "business", parent_id: null },
      { id: CAT_AGENCY, name: "Agency", kind: "business", parent_id: null },
      { id: CAT_FOOD_EVT, name: "Food & Drink", kind: "event", parent_id: null },
      { id: CAT_BEER_EVT, name: "Beer", kind: "event", parent_id: CAT_FOOD_EVT },
      { id: F_MARKET, name: "Market", kind: "event_format", parent_id: null },
      { id: F_FESTIVAL, name: "Festival", kind: "event_format", parent_id: null },
      { id: CAT_PRODUCT, name: "Snacks", kind: "product", parent_id: null },
    ],
    locations: [
      loc(L_BABYLIST, "Babylist Soho", M_NYC, A_SOHO, CAT_RETAIL),
      loc(L_3ACRES, "3 Acres Jersey City", M_NJ, A_BERGEN, CAT_RESIDENTIAL, { city: "Jersey City", state: "NJ" }),
      loc(L_UNLISTED, "Unlisted Shop", M_NYC, A_SOHO, CAT_RETAIL, { is_demo: true }),
      loc(L_ARCHIVED, "Gone Store", M_NYC, A_SOHO, CAT_RETAIL, { archived_at: "2026-01-01" }),
      loc(L_LAVAZZA, "Lavazza Flagship", M_NYC, A_MANHATTAN, CAT_RETAIL),
      loc(L_JC_PLAZA, "JC Plaza", M_NJ, A_DOWNTOWN_JC, CAT_COMMUNITY, { city: "Jersey City", state: "NJ" }),
      loc(L_DRAFT_OPS, "Draft Brand Shop", M_NYC, A_BROOKLYN, CAT_RETAIL),
      loc(L_OURS, "Mocktail Mart Shop", M_NYC, A_SOHO, CAT_RETAIL),
    ],
    businesses: [
      biz(B_MOCKTAIL, "Mocktail Mart"),
      biz(B_BABYLIST, "Babylist", { is_featured: true }),
      biz(B_LAVAZZA, "Lavazza"),
      biz(B_FREEBEAN, "Free Bean"),
      biz(B_PAID, "Paid Placement Co", { is_featured: true }),
      biz(B_ORGANIC, "Organic Serve Co"),
      biz(B_GROWING, "Growing Co"),
      biz(B_APPEARING, "Appearing Co"),
      biz(B_PAST, "Past Appearer"),
      biz(B_DRAFT, "Draft Brand", { publication_status: "draft" }),
      biz(B_BEVERAGE, "Beverage Co", { market_area_id: A_MANHATTAN }),
      biz(B_JC_AREA, "JC Area Co"),
      biz(B_PROMO_AREA, "Promo Area Co"),
    ],
    business_categories: [
      { business_id: B_BEVERAGE, category_id: CAT_BEVERAGE },
      { business_id: B_LAVAZZA, category_id: CAT_BEVERAGE },
      { business_id: B_FREEBEAN, category_id: CAT_BEVERAGE },
      { business_id: B_ORGANIC, category_id: CAT_AGENCY },
    ],
    business_locations: [
      { id: "bl1", business_id: B_LAVAZZA, location_id: L_LAVAZZA, is_primary: true },
      { id: "bl2", business_id: B_DRAFT, location_id: L_DRAFT_OPS, is_primary: true },
      { id: "bl3", business_id: B_MOCKTAIL, location_id: L_OURS, is_primary: true },
      { id: "bl4", business_id: B_BABYLIST, location_id: L_BABYLIST, is_primary: true },
    ],
    business_markets: [
      { id: "bm1", business_id: B_PAID, market_id: M_NYC, active: true, provenance: "paid" },
      { id: "bm2", business_id: B_ORGANIC, market_id: M_NYC, active: true, provenance: "self_selected" },
      { id: "bm3", business_id: B_GROWING, market_id: M_NYC, active: false, provenance: null },
      { id: "bm4", business_id: B_JC_AREA, market_id: M_NJ, active: true, provenance: "admin" },
      { id: "bm5", business_id: B_PROMO_AREA, market_id: M_NJ, active: true, provenance: "promotional" },
    ],
    business_market_areas: [
      { id: "bma1", business_id: B_JC_AREA, market_id: M_NJ, market_area_id: A_JC },
      { id: "bma2", business_id: B_PROMO_AREA, market_id: M_NJ, market_area_id: A_JC },
    ],
    brand_audit_markets: [{ id: "ba1", business_id: B_GROWING, intent: "priority", market_id: M_NYC, market_area_id: null, source: "declared" }],
    business_opportunity_goals: [],
    appearances: [
      { id: "ap1", business_id: B_APPEARING, status: "confirmed", start_at: "2026-10-30T15:00:00.000Z", end_at: "2026-10-30T20:00:00.000Z", location_id: L_BABYLIST, market_id: null, market_area_id: null },
      { id: "ap2", business_id: B_PAST, status: "confirmed", start_at: "2026-09-01T15:00:00.000Z", end_at: "2026-09-01T20:00:00.000Z", location_id: L_BABYLIST, market_id: null, market_area_id: null },
      { id: "ap3", business_id: B_PAST, status: "canceled", start_at: "2026-11-01T15:00:00.000Z", end_at: null, location_id: L_BABYLIST, market_id: null, market_area_id: null },
    ],
    events: [
      evt(E_SOHO_MARKET, "Soho Night Market", { host_business_id: B_FREEBEAN, start_date: "2026-11-07" }),
      evt(E_BK_FEST, "Brooklyn Beer Fest", { start_date: "2026-11-01" }),
      evt(E_PAST, "Past Market", { host_business_id: B_LAVAZZA, start_date: "2026-09-01" }),
      evt(E_LISTED, "Listed Only Pop-Up", { market_id: M_NYC, market_area_id: A_SOHO, start_date: "2026-11-20", host_business_id: B_LAVAZZA }),
      evt(E_GEOLESS, "Queens Night Market", { market_id: M_NYC, market_area_id: null, start_date: "2026-10-24" }),
      evt(E_GHOST, "Ghost Organizer Fair", { organizer_name: "Ghost Org LLC", market_id: M_NYC, start_date: "2026-11-02" }),
      evt(E_DRAFT, "Secret Launch", { publication_status: "pending_review", host_business_id: B_BABYLIST, market_id: M_NYC, start_date: "2026-11-03" }),
      evt(E_JC, "JC Makers Market", { start_date: "2026-11-08" }),
      evt(E_ELSEWHERE, "Philly Market", { market_id: M_NYC, start_date: "2026-11-09" }),
    ],
    event_occurrences: [
      occ(E_SOHO_MARKET, "2026-11-07", { location_id: L_BABYLIST }),
      occ(E_SOHO_MARKET, "2026-10-01", { location_id: L_BABYLIST }),
      occ(E_BK_FEST, "2026-11-01", { market_id: M_NYC }),
      occ(E_PAST, "2026-09-01", { location_id: L_LAVAZZA }),
      occ(E_GEOLESS, "2026-10-24"),
      occ(E_GHOST, "2026-11-02", { location_id: L_LAVAZZA }),
      occ(E_DRAFT, "2026-11-03", { location_id: L_BABYLIST }),
      occ(E_JC, "2026-11-08", { location_id: L_JC_PLAZA }),
      // Event-level says NYC, but its one upcoming occurrence is in Jersey City: occurrence geography wins.
      occ(E_ELSEWHERE, "2026-11-09", { location_id: L_JC_PLAZA }),
    ],
    event_categories: [{ event_id: E_BK_FEST, category_id: CAT_BEER_EVT }],
    event_formats: [
      { event_id: E_SOHO_MARKET, category_id: F_MARKET },
      { event_id: E_PAST, category_id: F_MARKET },
      { event_id: E_GEOLESS, category_id: F_MARKET },
      { event_id: E_BK_FEST, category_id: F_FESTIVAL },
      { event_id: E_JC, category_id: F_MARKET },
    ],
    business_targets: [
      { id: T_EXISTING, business_id: B_MOCKTAIL, target_location_id: L_BABYLIST, target_business_id: null, target_event_id: null, intents: ["placement"], status: "in_conversation", internal_notes: "FINDMI SECRET", context: null, next_action: null, next_action_at: null, source: "business" },
    ],
    opportunity_listings: [
      listing(O_3ACRES, "3 Acres Lobby Activation", { location_id: L_3ACRES }),
      listing(O_EVENT, "Sampling at Soho Night Market", { event_id: E_SOHO_MARKET, location_id: L_BABYLIST }),
      listing(O_SENT, "NYC Holiday Pop-Up", { visibility: "private", market_id: M_NYC }),
      listing(O_PRIVATE, "Someone Else's Private Deal", { visibility: "private", location_id: L_BABYLIST }),
      listing(O_LAVAZZA_LOC, "Lavazza Flagship Sampling", { location_id: L_LAVAZZA }),
    ],
    opportunity_recipients: [
      { id: "rcpt1", listing_id: O_SENT, business_id: B_MOCKTAIL, status: "offered", offered_at: "2026-10-10" },
      { id: "rcpt2", listing_id: O_PRIVATE, business_id: B_BABYLIST, status: "offered", offered_at: "2026-10-10" },
    ],
  };
}

// ── In-memory fake of the service-role client (PostgREST subset) ──────────

const FK = { locations: "location_id", opportunity_listings: "listing_id", markets: "market_id", market_areas: "market_area_id", categories: "category_id", businesses: "business_id", events: "event_id" };

function parseSelect(sel) {
  const fields = [];
  let depth = 0, cur = "";
  for (const ch of sel ?? "") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { fields.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) fields.push(cur.trim());
  return fields.map((f) => {
    const m = f.match(/^(?:(\w+):)?(\w+)(!inner)?\((.*)\)$/s);
    if (!m) return { col: f.split(":").pop() };
    return { embed: true, alias: m[1] ?? m[2], table: m[2], inner: Boolean(m[3]), children: parseSelect(m[4]) };
  });
}

function shape(tables, row, fields) {
  const out = { ...row };
  for (const f of fields.filter((x) => x.embed)) {
    const target = (tables[f.table] ?? []).find((x) => x.id === row[FK[f.table]]) ?? null;
    out[f.alias] = target ? shape(tables, target, f.children) : null;
  }
  return out;
}

const getPath = (row, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), row);

function splitTop(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function orTerm(term) {
  const and = term.match(/^and\((.*)\)$/s);
  if (and) { const ps = splitTop(and[1]).map(orTerm); return (r) => ps.every((p) => p(r)); }
  const [col, op, ...rest] = term.split(".");
  const val = rest.join(".");
  if (op === "ilike") { const needle = val.replace(/%/g, "").toLowerCase(); return (r) => String(r[col] ?? "").toLowerCase().includes(needle); }
  if (op === "is") return (r) => (r[col] ?? null) === null;
  if (op === "eq") return (r) => String(r[col]) === val;
  if (op === "gte") return (r) => r[col] != null && String(r[col]) >= val;
  throw new Error(`fake: unsupported or() op ${op}`);
}

function fakeDb(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, select: null, filters: [], op: "select", payload: null };
      calls.push(call);
      const preds = [];
      let single = null, limit = Infinity, returning = false;
      const pred = (desc, c, fn) => { call.filters.push(`${desc} ${c}`); preds.push((r) => fn(getPath(r, c))); return chain; };
      const chain = {
        select(cols) { if (call.op === "select") call.select = cols; else returning = true; return chain; },
        eq: (c, v) => pred("eq", c, (x) => x === v),
        neq: (c, v) => pred("neq", c, (x) => x !== v),
        is: (c, v) => pred("is", c, (x) => (x ?? null) === v),
        in: (c, vals) => pred("in", c, (x) => vals.includes(x)),
        not: (c, op, v) => pred("not", c, (x) => (x ?? null) !== v),
        gte: (c, v) => pred("gte", c, (x) => x != null && String(x) >= String(v)),
        contains: (c, vals) => pred("contains", c, (x) => Array.isArray(x) && vals.every((v) => x.includes(v))),
        or(expr) { call.filters.push(`or ${expr}`); const ps = splitTop(expr).map(orTerm); preds.push((r) => ps.some((p) => p(r))); return chain; },
        order() { return chain; },
        range() { return chain; },
        limit(n) { limit = n; return chain; },
        insert(payload) { call.op = "insert"; call.payload = payload; return chain; },
        update(payload) { call.op = "update"; call.payload = payload; return chain; },
        maybeSingle() { single = "maybe"; return chain; },
        single() { single = "one"; return chain; },
        then(resolve) {
          const rows = tables[table] ?? [];
          if (call.op === "insert") {
            const p = call.payload;
            const col = ["target_location_id", "target_business_id", "target_event_id"].find((c) => p[c]);
            if (table === "business_targets" && rows.some((r) => r.business_id === p.business_id && r[col] === p[col])) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            const created = { id: u(99), status: "target", ...p };
            (tables[table] ??= []).push(created);
            return resolve({ data: { ...created }, error: null });
          }
          const fields = parseSelect(call.select ?? "*");
          const shaped = rows.map((r) => shape(tables, r, fields));
          const matched = shaped.filter((r) => fields.filter((f) => f.embed && f.inner).every((f) => r[f.alias] != null) && preds.every((p) => p(r)));
          if (call.op === "update") {
            for (const r of rows.filter((r) => matched.some((m) => m.id === r.id))) Object.assign(r, call.payload);
            return resolve({ data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null });
          }
          const data = matched.slice(0, limit);
          if (single) return resolve({ data: data[0] ?? null, error: null });
          return resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

const run = async (raw, viewer = B_MOCKTAIL, tables = seed()) => {
  const db = fakeDb(tables);
  const res = await S.getCommercialDiscovery(db, viewer, C.parseCommercialQuery(raw), NOW);
  return { res, db, tables, names: res.items.map((i) => i.name) };
};
const byName = (res, name) => res.items.find((i) => i.name === name);
const writes = (db) => db.calls.filter((c) => c.op !== "select");

// ── Query vocabulary ───────────────────────────────────────────────────────

test("the query is parsed from untrusted URL params; nothing invalid survives", () => {
  const q = C.parseCommercialQuery({ market: "nyc", area: "soho", entity: "organizers", category: `c:${CAT_RETAIL}`, q: "  baby%list, ( ", page: "3" });
  assert.deepEqual(q, { market: "nyc", area: "soho", entity: "organizers", category: `c:${CAT_RETAIL}`, q: "baby list", page: 3 });
  assert.equal(C.parseCommercialQuery({ entity: "people" }).entity, "places", "an unknown entity falls back to Places");
  assert.equal(C.parseCommercialQuery({ area: "soho" }).area, "", "an Area without its Market is dropped");
  assert.equal(C.parseCommercialQuery({ market: "NYC;drop" }).market, "");
  assert.equal(C.parseCommercialQuery({ category: "c:not-a-uuid" }).category, "");
  assert.equal(C.parseCommercialQuery({ page: "-4" }).page, 1);
  assert.deepEqual([...C.COMMERCIAL_ENTITIES], ["places", "businesses", "organizers", "operators", "events"]);
  assert.equal(C.COMMERCIAL_ENTITY_LABELS.operators, "Venue Operators");
});

test("nothing is listed until a Market is chosen or a search is typed", async () => {
  const { res, db } = await run({});
  assert.equal(res.state, "prompt");
  assert.equal(res.items.length, 0);
  assert.ok(!db.calls.some((c) => ["locations", "businesses", "events"].includes(c.table)), "no entity read before there is a scope");
  assert.equal((await run({ market: "atlantis" })).res.state, "unknown_geography", "an unknown Market is said, never widened");
});

// ── 1–4. Geography + Places ────────────────────────────────────────────────

test("1/4. Market filter — Places: public, non-archived Locations in the Market, each 'Location Here'", async () => {
  const { res, names } = await run({ market: "nyc" });
  assert.equal(res.state, "results");
  assert.deepEqual(names, ["Babylist Soho", "Draft Brand Shop", "Lavazza Flagship", "Mocktail Mart Shop"]);
  assert.ok(!names.includes("Unlisted Shop") && !names.includes("Gone Store"), "unlisted and archived places never appear");
  assert.ok(!names.includes("3 Acres Jersey City"), "another Market's place never appears");
  assert.deepEqual(byName(res, "Babylist Soho").reasons, ["Location Here"]);
  assert.equal(byName(res, "Babylist Soho").context, "SoHo · NYC");
  assert.equal(byName(res, "Babylist Soho").role, "Place");
  assert.equal(byName(res, "Babylist Soho").category, "Retail Store");
  assert.equal(byName(res, "Babylist Soho").href, "/location/babylist-soho");
});

test("2/3. Area filter includes child Areas; a child Area excludes its siblings and parent-only places", async () => {
  const manhattan = await run({ market: "nyc", area: "manhattan" });
  assert.deepEqual(manhattan.names, ["Babylist Soho", "Lavazza Flagship", "Mocktail Mart Shop"], "Manhattan includes SoHo (its child)");
  const soho = await run({ market: "nyc", area: "soho" });
  assert.deepEqual(soho.names, ["Babylist Soho", "Mocktail Mart Shop"], "SoHo excludes the rest of Manhattan");
  const jc = await run({ market: "north-jersey", area: "jersey-city" });
  assert.deepEqual(jc.names, ["3 Acres Jersey City", "JC Plaza"]);
  assert.equal((await run({ market: "nyc", area: "jersey-city" })).res.state, "unknown_geography", "an Area from another Market is not accepted");
});

test("the viewer's own Location shows as Your Location, not a Target candidate", async () => {
  const { res } = await run({ market: "nyc", area: "soho" });
  assert.equal(byName(res, "Mocktail Mart Shop").ownLocation, true);
  assert.equal(byName(res, "Babylist Soho").ownLocation, false);
});

// ── 9–14. Categories, search, combined, paging ─────────────────────────────

test("9. Location category filter (Residential) — and options depend on the entity", async () => {
  const { res, names } = await run({ market: "north-jersey", area: "jersey-city", category: `c:${CAT_RESIDENTIAL}` });
  assert.deepEqual(names, ["3 Acres Jersey City"]);
  assert.equal(res.categoryName, "Residential");
  assert.deepEqual(res.options.categories.location.map((c) => c.name), ["Community Space", "Residential", "Retail Store"]);
  assert.deepEqual(res.options.categories.business.map((c) => c.name), ["Agency", "Coffee, Tea & Beverages"]);
  assert.deepEqual(res.options.categories.eventFormat.map((c) => c.name), ["Festival", "Market"]);
  assert.deepEqual(res.options.categories.eventCategory.map((c) => c.name), ["Food & Drink"], "child Event categories fold into their parent");
  assert.ok(!JSON.stringify(res.options).includes("Snacks"), "never product categories");
  // A category from another family is ignored, never silently applied.
  const wrong = await run({ market: "nyc", category: `c:${CAT_BEVERAGE}` });
  assert.equal(wrong.res.query.category, "");
  assert.equal(wrong.names.length, 4);
});

test("10. Business category filter (Coffee, Tea & Beverages)", async () => {
  const { names } = await run({ market: "nyc", entity: "businesses", category: `c:${CAT_BEVERAGE}` });
  assert.deepEqual(names, ["Lavazza", "Free Bean", "Beverage Co"], "Location Here, then Hosting Here, then Based Here");
});

test("11. Event format and Event category (with child categories) filters", async () => {
  assert.deepEqual((await run({ market: "nyc", entity: "events", category: `f:${F_MARKET}` })).names, ["Soho Night Market", "Queens Night Market"]);
  assert.deepEqual((await run({ market: "nyc", entity: "events", category: `f:${F_FESTIVAL}` })).names, ["Brooklyn Beer Fest"]);
  assert.deepEqual((await run({ market: "nyc", entity: "events", category: `c:${CAT_FOOD_EVT}` })).names, ["Brooklyn Beer Fest"], "the parent includes its child (Beer)");
});

test("12/13. Text search runs inside the scope; combined filters narrow together", async () => {
  assert.deepEqual((await run({ market: "nyc", q: "lav" })).names, ["Lavazza Flagship"]);
  assert.deepEqual((await run({ market: "nyc", area: "soho", q: "lav" })).names, [], "search never escapes the Area");
  const text = await run({ q: "babylist" });
  assert.deepEqual(text.names, ["Babylist Soho"], "a search without a Market still searches (public places only)");
  assert.deepEqual(text.res.items[0].reasons, [], "no geography reason without a geography");
  assert.deepEqual((await run({ market: "nyc", area: "manhattan", category: `c:${CAT_RETAIL}`, q: "soho" })).names, ["Babylist Soho"]);
  assert.deepEqual((await run({ market: "nyc", entity: "businesses", category: `c:${CAT_BEVERAGE}`, q: "bean" })).names, ["Free Bean"]);
});

test("14. paging: every match is reachable, 20 per page, never an arbitrary cap", async () => {
  const tables = seed();
  for (let i = 0; i < 45; i++) tables.locations.push({ ...tables.locations[0], id: u(1000 + i), name: `Bulk Place ${String(i).padStart(2, "0")}`, slug: `bulk-${i}` });
  const p1 = await run({ market: "nyc", q: "bulk" }, B_MOCKTAIL, tables);
  assert.equal(p1.res.total, 45);
  assert.equal(p1.res.pages, 3);
  assert.equal(p1.res.items.length, 20);
  const p3 = await run({ market: "nyc", q: "bulk", page: "3" }, B_MOCKTAIL, tables);
  assert.equal(p3.res.page, 3);
  assert.deepEqual(p3.names, ["Bulk Place 40", "Bulk Place 41", "Bulk Place 42", "Bulk Place 43", "Bulk Place 44"]);
  const beyond = await run({ market: "nyc", q: "bulk", page: "9" }, B_MOCKTAIL, tables);
  assert.equal(beyond.res.page, 3, "a page past the end clamps to the last page");
  assert.equal(C.COMMERCIAL_PAGE_SIZE, 20);
});

// ── 5, 15, 17. Businesses and their reasons ────────────────────────────────

test("5/15. Businesses match only through truthful relationships, each with its reason", async () => {
  const { res, names } = await run({ market: "nyc", entity: "businesses" });
  const reasons = Object.fromEntries(res.items.map((i) => [i.name, i.reasons]));
  assert.deepEqual(reasons["Lavazza"], ["Location Here", "Hosting Here"], "operates a Location in NYC + hosts an Event listed there");
  assert.deepEqual(reasons["Babylist"], ["Location Here"]);
  assert.deepEqual(reasons["Free Bean"], ["Hosting Here"]);
  assert.deepEqual(reasons["Appearing Co"], ["Appearing Here"]);
  assert.deepEqual(reasons["Beverage Co"], ["Based Here"]);
  assert.deepEqual(reasons["Organic Serve Co"], ["Serves This Market"]);
  assert.deepEqual(reasons["Growing Co"], ["Growing Here"]);
  assert.ok(!names.includes("Mocktail Mart"), "never the viewer itself");
  assert.ok(!names.includes("Draft Brand"), "never an unpublished Business, even with a Location here");
  assert.ok(!names.includes("Past Appearer"), "past and canceled Appearances don't count");
  assert.equal(byName(res, "Lavazza").role, "Business");
  assert.equal(byName(res, "Lavazza").category, "Coffee, Tea & Beverages");
  assert.equal(byName(res, "Lavazza").href, "/business/lavazza");
});

test("17. paid / promotional Market provenance is never organic geography", async () => {
  const nyc = await run({ market: "nyc", entity: "businesses" });
  assert.ok(!nyc.names.includes("Paid Placement Co"), "a paid NYC slot is not 'Serves This Market'");
  const jc = await run({ market: "north-jersey", area: "jersey-city", entity: "businesses" });
  assert.deepEqual(jc.names, ["JC Area Co"], "an Area served under an organic Market counts; one under a promotional Market doesn't");
  assert.deepEqual(byName(jc.res, "JC Area Co").reasons, ["Serves This Market"]);
  assert.equal(C.isOrganicMarketProvenance(null), true);
  assert.equal(C.isOrganicMarketProvenance("admin"), true);
  assert.equal(C.isOrganicMarketProvenance("self_selected"), true);
  for (const p of ["paid", "promotional", "complimentary"]) assert.equal(C.isOrganicMarketProvenance(p), false, p);
});

// ── 6, 7, 18. Derived roles ────────────────────────────────────────────────

test("6/18. Organizers are Businesses that host Events here — never invented from organizer_name", async () => {
  const { res, names } = await run({ market: "nyc", entity: "organizers" });
  assert.deepEqual(names, ["Lavazza", "Free Bean"], "both host here; Lavazza also has a Location here");
  assert.ok(res.items.every((i) => i.role === "Organizer" && i.kind === "business"));
  assert.ok(!JSON.stringify(res).includes("Ghost Org"), "free-text organizer_name never becomes a result");
  assert.ok(!names.includes("Babylist"), "hosting only an unpublished Event is not organizing");
  assert.ok(!names.includes("Organic Serve Co"), "serving a Market isn't organizing there");
  const jc = await run({ market: "north-jersey", entity: "organizers" });
  assert.equal(jc.res.empty.title, "No Organizers with linked Findmi Business pages were found in North Jersey.");
  // Without a Market, organizers anywhere (still only canonical hosts).
  assert.deepEqual((await run({ entity: "organizers", q: "free" })).names, ["Free Bean"]);
  assert.deepEqual((await run({ entity: "organizers", q: "ghost" })).names, []);
});

test("7. Venue Operators are Businesses operating a Location here", async () => {
  const { res, names } = await run({ market: "nyc", area: "soho", entity: "operators" });
  assert.deepEqual(names, ["Babylist"], "Mocktail (self) and Draft Brand (unpublished, Brooklyn) excluded");
  assert.equal(res.items[0].role, "Venue Operator");
  assert.deepEqual((await run({ market: "nyc", area: "manhattan", entity: "operators" })).names, ["Babylist", "Lavazza"]);
});

test("no declared Business roles, no Organizer or Venue Operator entity", () => {
  const sql = read(MIGRATION);
  assert.doesNotMatch(sql, /roles|organizer|operator/i);
  assert.doesNotMatch(read("src/lib/discovery/commercial-server.ts").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""), /organizer_name/, "never reads organizer_name");
});

// ── 8, 16. Events ──────────────────────────────────────────────────────────

test("8/16. Events use upcoming occurrence geography; Event-level geography only as the fallback", async () => {
  const { res, names } = await run({ market: "nyc", entity: "events" });
  assert.deepEqual(names, ["Brooklyn Beer Fest", "Ghost Organizer Fair", "Soho Night Market", "Queens Night Market", "Listed Only Pop-Up"]);
  const r = Object.fromEntries(res.items.map((i) => [i.name, i]));
  assert.deepEqual(r["Soho Night Market"].reasons, ["Happening Here"]);
  assert.equal(r["Soho Night Market"].date, "2026-11-07", "the next upcoming occurrence, not a past one");
  assert.deepEqual(r["Brooklyn Beer Fest"].reasons, ["Happening Here"], "an occurrence with only a Market");
  assert.deepEqual(r["Queens Night Market"].reasons, ["Listed Here"], "upcoming occurrence without geography → Event-level fallback");
  assert.deepEqual(r["Listed Only Pop-Up"].reasons, ["Listed Here"], "no occurrences → Event-level fallback");
  assert.ok(!names.includes("Past Market"), "nothing past");
  assert.ok(!names.includes("Secret Launch"), "nothing unpublished");
  assert.ok(!names.includes("Philly Market"), "Event-level NYC never overrides an upcoming occurrence elsewhere");
  assert.deepEqual((await run({ market: "nyc", area: "soho", entity: "events" })).names, ["Soho Night Market", "Listed Only Pop-Up"]);
  assert.deepEqual((await run({ market: "north-jersey", area: "jersey-city", entity: "events" })).names, ["JC Makers Market", "Philly Market"]);
  assert.equal(r["Soho Night Market"].role, "Event");
  assert.equal(r["Soho Night Market"].category, "Market");
});

// ── 26. Organic ranking ────────────────────────────────────────────────────

test("26. organic ranking: exact name, then strongest reason, then date, then name — no featured or paid input", async () => {
  const { names } = await run({ market: "nyc", entity: "businesses" });
  assert.deepEqual(names, ["Babylist", "Lavazza", "Free Bean", "Appearing Co", "Beverage Co", "Organic Serve Co", "Growing Co"]);
  // Featuring a Business changes nothing.
  const tables = seed();
  for (const b of tables.businesses) b.is_featured = b.name === "Growing Co";
  assert.deepEqual((await run({ market: "nyc", entity: "businesses" }, B_MOCKTAIL, tables)).names, names);
  assert.deepEqual(C.rankCommercial([{ id: "2", name: "Babylist Soho", reasons: ["growing_here"] }, { id: "1", name: "babylist", reasons: ["growing_here"] }, { id: "3", name: "Zed", reasons: ["location_here"] }], "Babylist").map((x) => x.id), ["1", "3", "2"]);
  for (const f of ["src/lib/discovery/commercial.ts", "src/lib/discovery/commercial-server.ts", `${V2}/DiscoverView.tsx`]) {
    assert.doesNotMatch(read(f).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""), /is_featured|featured|sponsor|promoted|score/i, `${f} has no paid/featured/score input`);
  }
  assert.equal(C.MATCH_REASON_LABELS.serves_here, "Serves This Market");
  assert.deepEqual(C.reasonLabels(["growing_here", "location_here", "location_here"]), ["Location Here", "Growing Here"]);
});

test("the consumer Discovery engine is untouched (its featured weighting stays where it was)", () => {
  assert.doesNotMatch(read("src/lib/discovery/commercial-server.ts"), /from "\.\/engine"|from "\.\/server"/);
  assert.match(read("src/lib/discovery/engine.ts"), /featured/i, "consumer behavior unchanged");
});

// ── 19–22, 25. Targets ─────────────────────────────────────────────────────

test("19. an existing Target is recognized (Mocktail Mart → Babylist Soho) with a way to open it", async () => {
  const { res } = await run({ market: "nyc", category: `c:${CAT_RETAIL}`, q: "babylist" });
  const b = byName(res, "Babylist Soho");
  assert.deepEqual(b.target, { id: T_EXISTING, status: "in_conversation" });
  assert.equal(byName(res, "Babylist Soho").kind, "location");
  // Another Business sees no Target there: Targets are private per Business.
  const other = await run({ market: "nyc", q: "babylist" }, B_LAVAZZA);
  assert.equal(byName(other.res, "Babylist Soho").target, null);
  const view = read(`${V2}/DiscoverView.tsx`);
  assert.match(view, /tab=growth&view=targets&\$\{kind === "location" \? `loc=\$\{r\.id\}` : `tgt=\$\{target\.id\}`\}/, "opens the place workspace (loc) or the Target (tgt)");
  assert.match(view, /Targeted · \{TARGET_STATUS_LABELS\[target\.status\]\} · Open/);
});

test("20/21/22/25. Target from a result uses the live business_targets path: compatible intents, no duplicate, no side effects", async () => {
  const tables = seed();
  const db = fakeDb(tables);
  // B. Lavazza → 3 Acres (Activation)
  const added = await L.addBusinessTarget(db, B_LAVAZZA, { kind: "location", counterpartyId: L_3ACRES, intents: ["activation"], source: "business", userId: null });
  assert.equal(added.ok, true);
  assert.equal(added.existing, false);
  assert.deepEqual(writes(db).map((c) => `${c.op}:${c.table}`), ["insert:business_targets"], "writes ONLY the Target: no Conversation, Inquiry, notification, Opportunity, Find Us Here or Appearance");
  const row = tables.business_targets.find((t) => t.business_id === B_LAVAZZA);
  assert.equal(row.target_location_id, L_3ACRES);
  assert.deepEqual(row.intents, ["activation"]);
  // The next read shows it as Targeted.
  const after = await run({ market: "north-jersey", area: "jersey-city", category: `c:${CAT_RESIDENTIAL}` }, B_LAVAZZA, tables);
  assert.equal(byName(after.res, "3 Acres Jersey City").target.status, "target");
  // 21. Again → the same Target, never a second.
  const again = await L.addBusinessTarget(fakeDb(tables), B_LAVAZZA, { kind: "location", counterpartyId: L_3ACRES, intents: ["activation"], source: "business", userId: null });
  assert.equal(again.existing, true);
  assert.equal(tables.business_targets.filter((t) => t.business_id === B_LAVAZZA).length, 1);
  // 22. Only intents compatible with the kind.
  assert.equal((await L.addBusinessTarget(fakeDb(tables), B_LAVAZZA, { kind: "location", counterpartyId: L_BABYLIST, intents: ["wholesale"], source: "business", userId: null })).ok, false);
  assert.deepEqual([...I.DEFAULT_INTENTS_BY_KIND.location].every((i) => I.INTENTS_BY_KIND.location.includes(i)), true);
  // Own Location / own Business are refused by the same path.
  assert.equal((await L.addBusinessTarget(fakeDb(tables), B_MOCKTAIL, { kind: "location", counterpartyId: L_OURS, intents: ["placement"], source: "business", userId: null })).ok, false);
  const view = read(`${V2}/DiscoverView.tsx`);
  assert.match(view, /addTargetAction\(businessId, kind, r\.id, intents\)/, "the UI calls the existing authorized Target action");
  assert.match(view, /<IntentPicker kind=\{kind\}/, "the canonical compatible-intent picker");
  assert.doesNotMatch(view, /createConversation|sendInquiry|notify|insertAppearance/);
});

test("discovery itself is read-only", async () => {
  for (const raw of [{ market: "nyc" }, { market: "nyc", entity: "businesses" }, { market: "nyc", entity: "organizers" }, { market: "nyc", entity: "operators" }, { market: "nyc", entity: "events" }]) {
    const { db } = await run(raw);
    assert.deepEqual(writes(db), [], JSON.stringify(raw));
  }
});

// ── 23, 24. Opportunities + privacy ────────────────────────────────────────

test("23. Opportunity context: exact place, exact Event, sent-to-you first, same Market — secondary and deterministic", async () => {
  const places = await run({ market: "north-jersey", area: "jersey-city", category: `c:${CAT_RESIDENTIAL}` }, B_LAVAZZA);
  const acres = byName(places.res, "3 Acres Jersey City");
  assert.equal(acres.opportunityCount, 1);
  assert.equal(acres.opportunities[0].title, "3 Acres Lobby Activation");
  assert.equal(acres.opportunities[0].reason, "At This Place");
  assert.equal(acres.opportunities[0].path, `/account/business/${B_LAVAZZA}/opportunities/explore/${O_3ACRES}`);

  const soho = await run({ market: "nyc", area: "soho" });
  const b = byName(soho.res, "Babylist Soho");
  assert.deepEqual(b.opportunities.map((o) => [o.title, o.reason]), [["NYC Holiday Pop-Up", "Sent to You · In NYC"], ["Sampling at Soho Night Market", "At This Place"]], "sent-to-you first, then the most specific");

  const events = await run({ market: "nyc", area: "soho", entity: "events" });
  assert.deepEqual(byName(events.res, "Soho Night Market").opportunities.map((o) => [o.title, o.reason]), [["Sampling at Soho Night Market", "For This Event"]]);
  assert.equal(byName(events.res, "Listed Only Pop-Up").opportunityCount, 0);

  const biz = await run({ market: "nyc", entity: "businesses", q: "lavazza" });
  assert.deepEqual(byName(biz.res, "Lavazza").opportunities.map((o) => [o.title, o.reason]), [["Lavazza Flagship Sampling", "At Their Location"]]);
});

test("24. privacy: never another Business's Opportunity, Target or internal notes", async () => {
  const { res } = await run({ market: "nyc", area: "soho" });
  const json = JSON.stringify(res);
  assert.ok(!json.includes("Someone Else's Private Deal"), "a private Opportunity sent to another Business never appears");
  assert.ok(!json.includes("FINDMI SECRET"), "never internal_notes");
  const babylistView = await run({ market: "nyc", area: "soho" }, B_BABYLIST);
  assert.ok(!JSON.stringify(babylistView.res).includes("NYC Holiday Pop-Up"), "what was sent to Mocktail is not shown to Babylist");
  assert.ok(JSON.stringify(babylistView.res).includes("Someone Else's Private Deal"), "…while its own sent Opportunity is");
  const server = read("src/lib/discovery/commercial-server.ts");
  assert.match(server, /from\("business_targets"\)\.select\("id, status, target_location_id, target_business_id, target_event_id"\)\.eq\("business_id", viewerId\)/, "Target state is read for THIS Business only, never internal_notes");
  assert.doesNotMatch(server.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ""), /internal_notes|next_action/);
  assert.match(read(PAGE), /getCommercialDiscovery\(admin, id,/, "always in the managed Business's own context");
});

// ── Empty states ───────────────────────────────────────────────────────────

test("empty states say what was searched and where, and never broaden geography", async () => {
  const { res } = await run({ market: "nyc", area: "soho", category: `c:${CAT_RESIDENTIAL}` });
  assert.equal(res.items.length, 0);
  assert.equal(res.scopeLabel, "SoHo");
  assert.deepEqual(res.empty, { title: "No Residential Places found in SoHo.", hint: "Try all of Manhattan, or remove the Category." });
  const q = await run({ market: "nyc", q: "zzz" });
  assert.deepEqual(q.res.empty, { title: "No Places found in NYC for “zzz”.", hint: "Clear the search." });
  assert.equal(C.commercialEmptyMessage(C.parseCommercialQuery({ market: "nyc", entity: "operators" }), { scopeLabel: "NYC", categoryName: null, parentLabel: null }).title, "No Venue Operators with linked Findmi Business pages were found in NYC.");
});

// ── Missing categories (migration) ─────────────────────────────────────────

test("the category seed is additive, idempotent, and only the approved rows", () => {
  const sql = read(MIGRATION);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(drop|delete|update|alter|truncate)\b/i, "insert-only (and no DROP, which the Supabase MCP can't run)");
  assert.match(sql, /on conflict \(kind, slug\) do nothing;/);
  const rows = [...sql.matchAll(/\('([^']+)', '([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, [
    ["Residential", "residential", "location"],
    ["Grocery", "grocery", "location"],
    ["Fitness / Gym", "fitness-gym", "location"],
    ["Salon / Spa", "salon-spa", "location"],
    ["Office / Workplace", "office-workplace", "location"],
    ["Campus", "campus", "location"],
    ["Agency", "agency", "business"],
  ]);
  assert.doesNotMatch(sql, /place_type\s*=|show_on_home\s*=|set /i, "place_type stays separate; no consumer surface changes");
});

// ── Surface, identity, performance ─────────────────────────────────────────

test("surface: Growth → Targets → Discover; no new tab or bottom navigation", () => {
  const page = read(PAGE);
  assert.match(page, /const onDiscover = activeTab === "growth" && viewParam === "discover";/);
  assert.match(page, /discoverHref=\{onGrowthTargets \? `\/account\/business\/\$\{id\}\?tab=growth&view=discover` : undefined\}/, "the Discover action lives on Growth → Targets only (not Find Us Here's lens)");
  assert.match(page, /growthView === "discover" && discovery && \(\s*<div className="flex flex-col gap-4">\s*<div className="flex flex-col gap-4 lg:max-w-3xl">\s*<GrowthTargetsHeader/, "inside Growth, under the Targets destination");
  assert.match(read(`${V2}/TargetsView.tsx`), /\{discoverHref && \(/);
  assert.match(page, /canEdit=\{canEditTargets\(membershipRole, isAdminElevated\)\} targetsHref=/, "owners/managers Target; staff browse");
  assert.match(read("src/lib/growth.ts"), /GROWTH_DESTINATION_LABELS: Record<GrowthDestination, string> = \{ goals: "Goals", targets: "Targets", opportunities: "Opportunities", ideas: "Ideas" \};/, "Growth keeps its four destinations");
  assert.doesNotMatch(read(`${V2}/GrowthView.tsx`), /discover/i, "no new Growth tab");
});

test("29. performance: read only on Discover; one page enriched in a fixed number of queries (no N+1)", async () => {
  const page = read(PAGE);
  assert.match(page, /const discoverPromise = whenP\(\s*onDiscover,/, "never read on any other destination");
  const count = async (n) => {
    const tables = seed();
    for (let i = 0; i < n; i++) tables.locations.push({ ...tables.locations[0], id: u(2000 + i), name: `Bulk ${String(i).padStart(3, "0")}`, slug: `b-${i}` });
    const { db } = await run({ market: "nyc", q: "bulk" }, B_MOCKTAIL, tables);
    return db.calls.length;
  };
  assert.equal(await count(5), await count(60), "the number of reads doesn't grow with results");
  const server = read("src/lib/discovery/commercial-server.ts");
  assert.match(server, /\.limit\(LIMIT \+ 1\)/, "candidate reads are bounded");
  assert.match(server, /COMMERCIAL_CANDIDATE_LIMIT/);
});
