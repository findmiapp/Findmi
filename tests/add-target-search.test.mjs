// Commercial Discovery / Add Target UX correction: Add Target's one search box
// (All by default, or Places / Businesses / Events; the query kept across
// switches), each result's identity (image, kind, Category, geography, an
// Event's next UPCOMING date), existing-Target and own-Location state, bounded
// reads; Growth → Targets' two entry points (Add Target / Discover); Discover's
// Where / What / Narrow presentation; the compact Targets Status selector.
// No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

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

const S = await import("../src/lib/target-search.ts");
const D = await import("../src/lib/business-targets-domain.ts");
const read = (p) => readFileSync(p, "utf8");
const V2 = "src/app/(public)/account/business/[id]/v2";
const ACTIONS = "src/app/(public)/account/business/[id]/target-actions.ts";
const NOW = new Date("2026-10-23T16:00:00.000Z");

const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const MOCKTAIL = u(1), TENDY = u(2), DRAFT = u(3), LAVAZZA = u(4);
const L_3ACRES = u(10), L_BABYLIST = u(11), L_OURS = u(12), L_UNLISTED = u(13), L_GONE = u(14), L_ACRES_CAFE = u(15);
const E_UPCOMING = u(20), E_PAST = u(21), E_NO_OCC = u(22), E_DRAFT = u(23), E_TENDY = u(24);
const C_COMMUNITY = u(30), C_RETAIL = u(31), C_TECH = u(32), F_MARKET = u(33), C_FOOD = u(34), C_BEER = u(35);
const A_JC = u(40), A_BERGEN = u(41), A_SOHO = u(42);
const T_BABYLIST = u(50), T_OTHER = u(51);

function seed() {
  const loc = (id, name, extra = {}) => ({ id, name, city: "Jersey City", state: "NJ", address: "1 Main St", cover_image_url: null, logo_url: null, is_demo: false, archived_at: null, trashed_at: null, category_id: null, market_area_id: null, ...extra });
  const biz = (id, name, extra = {}) => ({ id, name, city: "New York", state: "NY", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  const evt = (id, name, extra = {}) => ({ id, name, city: "New York", venue_name: null, cover_image_url: null, start_date: null, end_date: null, start_at: null, end_at: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  return {
    categories: [
      { id: C_COMMUNITY, name: "Community Space", parent_id: null },
      { id: C_RETAIL, name: "Retail Store", parent_id: null },
      { id: C_TECH, name: "Technology", parent_id: null },
      { id: F_MARKET, name: "Market", parent_id: null },
      { id: C_FOOD, name: "Food & Drink", parent_id: null },
      { id: C_BEER, name: "Beer", parent_id: C_FOOD },
    ],
    market_areas: [
      { id: A_JC, name: "Jersey City", display_name: null },
      { id: A_BERGEN, name: "Bergen-Lafayette", display_name: null },
      { id: A_SOHO, name: "SoHo", display_name: null },
    ],
    locations: [
      loc(L_3ACRES, "3 Acres Jersey City", { category_id: C_COMMUNITY, market_area_id: A_BERGEN, cover_image_url: "https://x.supabase.co/3acres.jpg" }),
      loc(L_BABYLIST, "Babylist Soho", { city: "New York", state: "NY", category_id: C_RETAIL, market_area_id: A_SOHO }),
      loc(L_OURS, "Tendy Flagship", { city: "New York", state: "NY", category_id: C_RETAIL }),
      loc(L_UNLISTED, "Tendy Popup Corner", { is_demo: true }),
      loc(L_GONE, "Tendy Old Store", { archived_at: "2026-01-01" }),
      loc(L_ACRES_CAFE, "Acres Cafe", { market_area_id: A_JC }),
    ],
    businesses: [
      biz(MOCKTAIL, "Mocktail Mart"),
      biz(TENDY, "Tendy", { logo_url: "https://x.supabase.co/tendy.png" }),
      biz(DRAFT, "Tendy Draft Co", { publication_status: "draft" }),
      biz(LAVAZZA, "Lavazza"),
    ],
    business_categories: [{ business_id: TENDY, category_id: C_TECH }],
    business_locations: [{ id: "bl1", business_id: MOCKTAIL, location_id: L_OURS }],
    events: [
      evt(E_UPCOMING, "Soho Night Market", { start_date: "2026-10-01", cover_image_url: "https://x.supabase.co/m.jpg", venue_name: "Babylist Soho" }),
      evt(E_PAST, "Summer Night Market", { start_date: "2026-07-01" }),
      evt(E_NO_OCC, "Night Market Preview", { start_date: "2026-11-20" }),
      evt(E_DRAFT, "Secret Night Market", { publication_status: "pending_review" }),
      evt(E_TENDY, "Tendy Launch Party", { start_date: "2026-11-05" }),
    ],
    event_occurrences: [
      { event_id: E_UPCOMING, occurrence_date: "2026-10-01", start_at: "2026-10-01T22:00:00Z", end_at: null },
      { event_id: E_UPCOMING, occurrence_date: "2026-11-07", start_at: "2026-11-07T22:00:00Z", end_at: null },
      { event_id: E_PAST, occurrence_date: "2026-07-01", start_at: "2026-07-01T22:00:00Z", end_at: null },
      { event_id: E_TENDY, occurrence_date: "2026-11-05", start_at: "2026-11-05T22:00:00Z", end_at: null },
    ],
    event_formats: [{ event_id: E_UPCOMING, category_id: F_MARKET }],
    event_categories: [{ event_id: E_UPCOMING, category_id: C_BEER }, { event_id: E_UPCOMING, category_id: C_FOOD }],
    business_targets: [
      { id: T_BABYLIST, business_id: MOCKTAIL, target_location_id: L_BABYLIST, target_business_id: null, target_event_id: null, status: "in_conversation", intents: ["placement"], internal_notes: "FINDMI SECRET" },
      { id: T_OTHER, business_id: LAVAZZA, target_location_id: null, target_business_id: TENDY, target_event_id: null, status: "agreed", intents: ["collaboration"], internal_notes: "FINDMI SECRET" },
    ],
  };
}

const search = async (scope, q, viewer = MOCKTAIL, tables = seed()) => {
  const db = fakeDb(tables);
  const res = await S.searchTargetCandidates(db, viewer, scope, q, NOW);
  return { res, db, names: res.map((r) => r.name) };
};

// ── All-search ─────────────────────────────────────────────────────────────

test("scopes: All (default), Places, Businesses, Events — no Organizer, no People", () => {
  assert.deepEqual([...D.ADD_TARGET_SCOPES], ["all", "location", "business", "event"]);
  assert.deepEqual(Object.values(D.ADD_TARGET_SCOPE_LABELS), ["All", "Places", "Businesses", "Events"]);
  assert.equal(D.isAddTargetScope("organizer"), false);
  assert.equal(D.isAddTargetScope("people"), false);
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /useState<AddTargetScope>\(placesOnly \? "location" : "all"\)/, "All by default (Find Us Here's lens stays Places-only)");
});

test("A. 'tendy' under All finds Tendy without knowing it's a Business, each result labeled by kind", async () => {
  const { res, names } = await search("all", "tendy");
  assert.deepEqual(names, ["Tendy", "Tendy Flagship", "Tendy Popup Corner", "Tendy Launch Party"], "exact name first, then Place → Business → Event");
  const tendy = res[0];
  assert.equal(tendy.kind, "business");
  assert.equal(tendy.imageUrl, "https://x.supabase.co/tendy.png", "Business → logo");
  assert.equal(tendy.category, "Technology");
  assert.equal(tendy.place, "New York, NY");
  assert.deepEqual(tendy.target, null, "another Business's Target on Tendy is never shown");
  assert.ok(!names.includes("Tendy Draft Co"), "never an unpublished Business");
  assert.ok(!names.includes("Tendy Old Store"), "never an archived place");
  assert.equal(res.find((r) => r.name === "Tendy Popup Corner").notPublic, true, "an unlisted place is linkable and marked Not Public");
  assert.equal(res.find((r) => r.name === "Tendy Flagship").ownLocation, true, "the viewer's own Location is marked, not offered");
});

test("narrowing keeps the same query and re-runs against the new kind", async () => {
  assert.deepEqual((await search("location", "tendy")).names, ["Tendy Flagship", "Tendy Popup Corner"]);
  assert.deepEqual((await search("business", "tendy")).names, ["Tendy"]);
  assert.deepEqual((await search("event", "tendy")).names, ["Tendy Launch Party"]);
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /const \[query, setQuery\] = useState\(""\);/, "the query lives in Add Target, above the scope");
  assert.match(view, /query=\{query\}\s*onQueryChange=\{setQuery\}/, "the picker's query is controlled — switching scope never clears it");
  assert.match(view, /onClick=\{\(\) => setScope\(k\)\}/, "switching scope changes only the scope");
  assert.match(view, /useDebounced<TargetCandidate>\(query, \(q\) => searchTargetCandidatesAction\(businessId, scope, q\), scope\)/, "results re-run when the scope changes");
  const picker = read("src/components/find-or-create/FindOrCreatePicker.tsx");
  assert.match(picker, /const open = focused \|\| \(controlled && query\.trim\(\)\.length > 0\);/, "re-run results stay visible after tapping a scope chip");
  assert.match(picker, /if \(!controlled\) setQuery\(""\);/, "uncontrolled pickers elsewhere behave exactly as before");
});

test("B. '3 acres' → Place · Community Space · Jersey City, NJ · Bergen-Lafayette, with its image", async () => {
  const { res } = await search("all", "3 acres");
  assert.equal(res.length, 1);
  assert.deepEqual(
    { kind: res[0].kind, name: res[0].name, category: res[0].category, place: res[0].place, area: res[0].area, imageUrl: res[0].imageUrl },
    { kind: "location", name: "3 Acres Jersey City", category: "Community Space", place: "Jersey City, NJ", area: "Bergen-Lafayette", imageUrl: "https://x.supabase.co/3acres.jpg" }
  );
  // An Area that only repeats the city adds nothing.
  assert.equal((await search("location", "acres cafe")).res[0].area, null);
});

test("C. Events show their format/category and NEXT UPCOMING date — never a past one as current", async () => {
  const { res } = await search("event", "night market");
  const by = Object.fromEntries(res.map((r) => [r.name, r]));
  assert.ok(!by["Secret Night Market"], "never an unpublished Event");
  assert.equal(by["Soho Night Market"].nextDate, "2026-11-07", "the past Oct 1 occurrence is skipped");
  assert.equal(by["Soho Night Market"].category, "Market, Food & Drink", "format first, then top-level category");
  assert.equal(by["Soho Night Market"].place, "Babylist Soho");
  assert.equal(by["Soho Night Market"].imageUrl, "https://x.supabase.co/m.jpg");
  assert.equal(by["Summer Night Market"].nextDate, null);
  assert.equal(by["Summer Night Market"].noUpcoming, true, "an ended Event says so instead of showing its old date");
  assert.equal(by["Night Market Preview"].nextDate, "2026-11-20", "no occurrence rows: its own upcoming date");
  assert.match(read(`${V2}/TargetsView.tsx`), /c\.nextDate \? formatTargetDate\(c\.nextDate\) : "No Upcoming Dates"/);
});

test("E. an existing Target is recognized (this Business only) and opens instead of duplicating", async () => {
  const { res } = await search("all", "babylist");
  assert.deepEqual(res[0].target, { id: T_BABYLIST, status: "in_conversation" });
  assert.equal((await search("all", "babylist", LAVAZZA)).res[0].target, null, "another Business never sees Mocktail's Target");
  assert.deepEqual((await search("all", "tendy", LAVAZZA)).res.find((r) => r.name === "Tendy").target, { id: T_OTHER, status: "agreed" });
  assert.ok(!JSON.stringify(res).includes("FINDMI SECRET"));
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /if \(c\.target\) return open\(c\.kind, c\.target\.id, c\.kind === "location" \? c\.id : null\);/, "picking a Targeted result opens it");
  assert.match(view, /<Chip tone=\{TARGET_STATUS_TONE\[c\.target\.status\]\}>Targeted<\/Chip>/);
  assert.match(view, /renderItem=\{\(c\) => <CandidateRow c=\{c\} \/>\}/);
});

test("min characters, dedupe, and read-only", async () => {
  assert.deepEqual((await search("all", "t")).res, []);
  const { db, res } = await search("all", "tendy");
  assert.equal(new Set(res.map((r) => `${r.kind}:${r.id}`)).size, res.length);
  assert.deepEqual(db.calls.filter((c) => c.op !== "select"), []);
});

// ── Performance ────────────────────────────────────────────────────────────

test("bounded: at most three capped entity reads, then a fixed set of batch reads — never per result", async () => {
  const count = async (n) => {
    const t = seed();
    for (let i = 0; i < n; i++) t.businesses.push({ ...t.businesses[1], id: u(1000 + i), name: `Tendy Clone ${i}` });
    const { db } = await search("all", "tendy", MOCKTAIL, t);
    return db.calls;
  };
  const few = await count(1);
  const many = await count(30);
  assert.equal(few.length, many.length, "the number of reads doesn't grow with matches");
  assert.equal(many.filter((c) => ["locations", "businesses", "events"].includes(c.table)).length, 3);
  assert.equal(D.ADD_TARGET_PER_KIND_ALL, 6);
  assert.equal(D.ADD_TARGET_PER_KIND_ONE, 20);
  const src = read("src/lib/target-search.ts");
  assert.match(src, /\.limit\(per\)/g);
  assert.match(read(ACTIONS), /export async function searchTargetCandidatesAction\(businessId: string, scope: string, query: string\)[\s\S]*?authorizeWrite\(businessId\)[\s\S]*?isAddTargetScope\(scope\)/, "authorized and validated server-side");
});

// ── Add Target stays lightweight ───────────────────────────────────────────

test("Add Target has no Market / Area / Category filters — that's Discover", () => {
  const view = read(`${V2}/TargetsView.tsx`);
  const add = view.slice(view.indexOf("function AddTarget("));
  assert.doesNotMatch(add, /Market|Area|Category/);
  assert.match(add, /renderCreate=\{\s*scope === "all" \|\| scope === "location"/, "a place not on Findmi can still be added inline");
});

// ── Entry points, Discover presentation, Targets list ──────────────────────

test("D. Growth → Targets: Add Target and Discover are two obvious primary actions", () => {
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /<span className="text-button font-bold">Add Target<\/span>\s*<span[^>]*>I know who I want<\/span>/);
  assert.match(view, /<span className="text-button font-bold">Discover<\/span>\s*<span[^>]*>Help me find who to pursue<\/span>/);
  assert.match(read("src/app/(public)/account/business/[id]/(manager)/page.tsx"), /discoverHref=\{onGrowthTargets \? `\/account\/business\/\$\{id\}\?tab=growth&view=discover` : undefined\}/, "the existing Discover route, Growth door only");
});

test("Discover: Where / What / Narrow It Down are visible, using the existing filters", () => {
  const view = read(`${V2}/DiscoverView.tsx`);
  const order = ["Find Places, Businesses, Organizers and Events worth pursuing", ">Where<", ">Market<", ">Area<", ">What<", ">Narrow It Down<", ">Category<", ">Search<"].map((s) => view.indexOf(s));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the Geography → What → Category → Search order");
});

test("Targets list: Status is one compact selector; kind chips stay", () => {
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /<span className="text-metadata font-semibold text-muted">Status<\/span>\s*<select/);
  assert.doesNotMatch(view, /aria-label="Status"/, "no second chip rail");
  assert.match(view, /TARGET_KIND_FILTERS\.map/);
});
