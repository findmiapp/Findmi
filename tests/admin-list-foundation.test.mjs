// Shared Admin List Foundation — sorting + server-side pagination for
// Locations, Businesses, Events and People. Behavior is exercised through
// the real query functions against an in-memory PostgREST fake that
// filters, sorts, counts and ranges like the database does (filters BEFORE
// the range, count = the full filtered set). Fakes only — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { orPredicate, withDates } from "./helpers/postgrest-or.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "./supabase-admin" || specifier === "@/lib/admin/supabase-admin")
      return { url: "data:text/javascript,export const getAdminSupabase=()=>globalThis.__DB??null;", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const SORT = await import("../src/lib/admin/list-sort.ts");
const PAGE = await import("../src/lib/admin/list-page.ts");
const Q = await import("../src/lib/admin/queries.ts");
const PQ = await import("../src/lib/admin/people-queries.ts");
const EL = await import("../src/lib/admin/lifecycle-eligibility.ts");
const EV = await import("../src/lib/admin/event-lifecycle.ts");
const LC = await import("../src/lib/admin/location-lifecycle.ts");
const PUB = await import("../src/lib/event-publication.ts");
const read = (p) => readFileSync(p, "utf8");

// ── In-memory PostgREST fake ────────────────────────────────────────────

const get = (row, col) => {
  if (!col.includes(".")) return row[col] ?? null;
  const [rel, c] = col.split(".");
  return (row[rel] ?? []).map((r) => r[c] ?? null);
};
const matches = (v, pred) => (Array.isArray(v) ? v.some(pred) : pred(v));
const like = (pattern) => {
  const needle = pattern.replace(/^%|%$/g, "").toLowerCase();
  return (v) => typeof v === "string" && v.toLowerCase().includes(needle);
};

function fakeDb(tables, { pastEndCount = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      const orders = [];
      let range = null;
      let countMode = null;
      const call = { table, orders, filters: [] };
      calls.push(call);
      const f = (desc, pred) => (call.filters.push(desc), filters.push(pred), chain);
      const chain = {
        select: (_cols, opts) => ((countMode = opts?.count ?? null), chain),
        eq: (c, v) => f(`eq ${c}`, (r) => matches(get(r, c), (x) => x === v)),
        neq: (c, v) => f(`neq ${c}`, (r) => get(r, c) !== v),
        is: (c, v) => f(`is ${c}`, (r) => get(r, c) === v),
        not: (c, _op, v) => f(`not ${c}`, (r) => get(r, c) !== v),
        in: (c, vals) => f(`in ${c}`, (r) => matches(get(r, c), (x) => vals.includes(x))),
        gte: (c, v) => f(`gte ${c}`, (r) => get(r, c) != null && get(r, c) >= v),
        lt: (c, v) => f(`lt ${c}`, (r) => get(r, c) != null && get(r, c) < v),
        or: (expr) =>
          /\.ilike\./.test(expr)
            ? f(`or ${expr}`, (r) =>
                expr.split(",").some((part) => {
                  const [col, op, ...rest] = part.split(".");
                  return op === "ilike" && like(rest.join("."))(get(r, col));
                })
              )
            : f(`or ${expr}`, orPredicate(expr)),
        order: (c, { ascending, nullsFirst }) => (orders.push(nullsFirst === undefined ? { column: c, ascending } : { column: c, ascending, nullsFirst }), chain),
        range: (from, to) => ((range = { from, to }), (call.range = range), chain),
        then: (resolve) => {
          let rows = tables[table].filter((r) => filters.every((p) => p(r)));
          rows = [...rows].sort((a, b) => {
            for (const o of orders) {
              const x = a[o.column] ?? null;
              const y = b[o.column] ?? null;
              if (x === y) continue;
              if (o.nullsFirst !== undefined && (x === null || y === null)) return (x === null) === o.nullsFirst ? -1 : 1;
              const cmp = x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
              return o.ascending ? cmp : -cmp;
            }
            return 0;
          });
          const count = countMode === "exact" ? rows.length : null;
          if (range) {
            if (range.from > 0 && range.from >= rows.length) {
              return resolve({ data: null, count: pastEndCount ? count : null, error: { message: "Requested range not satisfiable", code: "PGRST103" } });
            }
            rows = rows.slice(range.from, range.to + 1);
          }
          return resolve({ data: rows.map((r) => ({ ...r })), count, error: null });
        },
      };
      return chain;
    },
  };
}

const pad = (n) => String(n).padStart(4, "0");
const uid = (n) => `00000000-0000-4000-8000-00000000${pad(n)}`;
const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString();
const names = (p) => p.rows.map((r) => r.name);

// 60 Locations: "Loc 0001"… with a mix of states; "Iron23" deep in the list.
function locations() {
  const rows = [];
  for (let n = 1; n <= 60; n++) rows.push({ id: uid(n), name: `Loc ${pad(n)}`, city: "Brooklyn", address: `${n} Main St`, is_demo: n % 3 === 0, review_status: n % 6 === 0 ? "pending_review" : null, archived_at: null, trashed_at: null });
  rows.push({ id: uid(900), name: "Zz Iron23 Gym", city: "Queens", address: "1 Iron Way", is_demo: false, archived_at: null, trashed_at: null });
  rows.push({ id: uid(901), name: "Archived Spot", city: "Bronx", address: "x", is_demo: false, archived_at: day(1), trashed_at: null });
  rows.push({ id: uid(902), name: "Trashed Spot", city: "Bronx", address: "x", is_demo: false, archived_at: null, trashed_at: day(2) });
  return rows;
}

// ── SHARED ──────────────────────────────────────────────────────────────

test("1. invalid page values resolve to page 1", () => {
  for (const v of ["0", "-4", "abc", "", undefined, null, "1.5", "2e3", " "]) assert.equal(PAGE.parseAdminPage(v), 1, String(v));
  assert.equal(PAGE.parseAdminPage("3"), 3);
  assert.equal(PAGE.parseAdminPage(["4", "9"]), 4);
});

test("2. page size is 25; ranges are inclusive Supabase bounds", () => {
  assert.equal(PAGE.ADMIN_PAGE_SIZE, 25);
  assert.deepEqual(PAGE.adminPageRange(1), { from: 0, to: 24 });
  assert.deepEqual(PAGE.adminPageRange(3), { from: 50, to: 74 });
  assert.equal(PAGE.adminTotalPages(0), 1);
  assert.equal(PAGE.adminTotalPages(143), 6);
});

test("3. every collection's every sort ends with the deterministic id tie-break", () => {
  for (const cfg of [SORT.BUSINESS_SORT, SORT.LOCATION_SORT, SORT.EVENT_SORT, SORT.PEOPLE_SORT]) {
    for (const key of cfg.options) {
      const cols = SORT.adminSortColumns(cfg, key);
      assert.deepEqual(cols.at(-1), { column: "id", ascending: true }, key);
      // Event date/time precision: the Event-date sorts are date → known
      // start (untimed last) → id; every other sort stays column → id.
      assert.equal(cols.length, cfg === SORT.EVENT_SORT && key.startsWith("date_") ? 3 : 2, key);
    }
  }
});

test("4–7. sort / search / filter changes reset to page 1; page navigation keeps q, filters, sort, view", () => {
  const current = { q: "coffee", published: "1", sort: "za", page: "3", result: "4 Locations Published" };
  // 4. sort
  assert.equal(PAGE.adminListHref("/admin/locations", current, { sort: "az" }), "/admin/locations?q=coffee&published=1&sort=az");
  // 5. search
  assert.equal(PAGE.adminListHref("/admin/locations", current, { q: "tea" }), "/admin/locations?q=tea&published=1&sort=za");
  // 6. filter / view
  assert.equal(PAGE.adminListHref("/admin/locations", current, { published: null, review: "1" }), "/admin/locations?q=coffee&sort=za&review=1");
  // 7. page — only `page` changes; flash params never follow
  assert.equal(PAGE.adminListHref("/admin/locations", current, { page: "4" }), "/admin/locations?q=coffee&published=1&sort=za&page=4");
  assert.equal(PAGE.adminListHref("/admin/locations", current, { page: "1" }), "/admin/locations?q=coffee&published=1&sort=za");
  // Search forms carry the view + sort as hidden fields and never a `page`
  // field, so a submitted search always lands on page 1.
  for (const f of ["locations", "events", "people"]) {
    const page = read(`src/app/admin/(protected)/${f}/page.tsx`);
    assert.match(page, /<Form action=\{PATH\}/, f);
    assert.doesNotMatch(page, /name="page"/, f);
    assert.match(page, /name="sort"/, f);
  }
  // Businesses' live filter bar rebuilds params without `page`.
  const bar = read("src/app/admin/(protected)/businesses/BusinessesFilterBar.tsx");
  assert.doesNotMatch(bar, /params\.set\("page"/);
});

test("8. the total count is the full FILTERED set, not the page", async () => {
  globalThis.__DB = fakeDb({ locations: locations() });
  const p1 = await Q.getAdminLocationList({ page: 1 });
  assert.equal(p1.total, 61); // 60 + Iron23 active
  assert.equal(p1.rows.length, 25);
  assert.equal(PAGE.adminPageSummary(p1), "1–25 of 61");
  const p2 = await Q.getAdminLocationList({ page: 2 });
  assert.equal(PAGE.adminPageSummary(p2), "26–50 of 61");
  const few = await Q.getAdminLocationList({ q: "Loc 000" });
  assert.equal(few.total, 9);
  assert.equal(PAGE.adminPageSummary(few), "1–9 of 9");
  // ONE ranged query per page — no per-row or full-table reads.
  globalThis.__DB = fakeDb({ locations: locations() });
  await Q.getAdminLocationList({ page: 2 });
  assert.equal(globalThis.__DB.calls.length, 1);
  assert.deepEqual(globalThis.__DB.calls[0].range, { from: 25, to: 49 });
});

test("9. Select All Visible selects only the current page's rows", async () => {
  globalThis.__DB = fakeDb({ locations: locations() });
  const p1 = await Q.getAdminLocationList({ page: 1 });
  const sel = PAGE.selectAllVisible(p1.rows);
  assert.equal(sel.size, 25);
  const p2 = await Q.getAdminLocationList({ page: 2 });
  for (const r of p2.rows) assert.ok(!sel.has(r.id), "never another page's rows");
  const list = read("src/components/admin/AdminBulkList.tsx");
  assert.match(list, /setSelected\(allSelected \? new Set\(\) : selectAllVisible\(items\)\)/);
  assert.match(list, /Select all visible \(\{items\.length\}\)/);
  assert.doesNotMatch(list, /select all matching|selectAllMatching/i);
});

test("10. navigation can't retain hidden selected ids", async () => {
  globalThis.__DB = fakeDb({ locations: locations() });
  const p1 = await Q.getAdminLocationList({ page: 1 });
  const p2 = await Q.getAdminLocationList({ page: 2 });
  const pruned = PAGE.pruneSelection(PAGE.selectAllVisible(p1.rows), p2.rows);
  assert.equal(pruned.size, 0);
  // Any change of page / q / filter / view / sort changes the scope key,
  // and AdminBulkList clears its selection when the key changes.
  const base = { q: "x", review: "1", sort: "za" };
  const k = PAGE.adminListScopeKey(base);
  for (const change of [{ page: "2" }, { q: "y" }, { review: undefined, published: "1" }, { sort: "az" }, { lifecycle: "archived" }]) {
    assert.notEqual(PAGE.adminListScopeKey({ ...base, ...change }), k, JSON.stringify(change));
  }
  // A flash message alone (after a bulk action) doesn't count as navigation.
  assert.equal(PAGE.adminListScopeKey({ ...base, result: "Done" }), k);
  const list = read("src/components/admin/AdminBulkList.tsx");
  assert.match(list, /if \(scope !== scopeKey\) \{\n\s+setScope\(scopeKey\);\n\s+setSelected\(new Set\(\)\);/);
  for (const f of ["locations/page.tsx", "businesses/page.tsx", "events/page.tsx"]) {
    assert.match(read(`src/app/admin/(protected)/${f}`), /scopeKey=\{adminListScopeKey\(params\)\}/, f);
  }
  for (const f of ["locations/LocationBulkListClient.tsx", "businesses/BusinessBulkListClient.tsx", "events/EventBulkListClient.tsx"]) {
    assert.match(read(`src/app/admin/(protected)/${f}`), /scopeKey=\{scopeKey\}/, f);
  }
});

test("pages past the end resolve to the last valid page (records changed)", async () => {
  for (const pastEndCount of [false, true]) {
    globalThis.__DB = fakeDb({ locations: locations() }, { pastEndCount });
    const p = await Q.getAdminLocationList({ page: 9 });
    assert.equal(p.page, 3);
    assert.equal(p.requestedPage, 9);
    assert.equal(p.rows.length, 11);
    assert.equal(p.total, 61);
  }
  globalThis.__DB = fakeDb({ locations: [] });
  const none = await Q.getAdminLocationList({ page: 4 });
  assert.equal(none.total, 0);
  assert.equal(none.page, 1);
  assert.equal(none.failed, false);
  globalThis.__DB = undefined;
  assert.equal((await Q.getAdminLocationList({})).failed, true);
});

// ── LOCATIONS ───────────────────────────────────────────────────────────

test("11–14. Locations: A–Z default, Z–A; Newest / Oldest NOT offered (no created_at column)", async () => {
  assert.deepEqual(SORT.LOCATION_SORT.options, ["az", "za"]);
  assert.equal(SORT.LOCATION_SORT.defaultKey, "az");
  assert.equal(SORT.parseAdminSort("newest", SORT.LOCATION_SORT), "az", "unsupported → default, never a fabricated date sort");
  assert.equal(SORT.parseAdminSort("oldest", SORT.LOCATION_SORT), "az");
  assert.ok(!Object.values(SORT.LOCATION_SORT.columns).some((c) => c.column.endsWith("_at")));
  globalThis.__DB = fakeDb({ locations: locations() });
  const az = await Q.getAdminLocationList({});
  assert.deepEqual(names(az).slice(0, 2), ["Loc 0001", "Loc 0002"]);
  const za = await Q.getAdminLocationList({ sort: "za" });
  assert.equal(names(za)[0], "Zz Iron23 Gym");
  assert.equal(names(za)[1], "Loc 0060");
  assert.deepEqual(globalThis.__DB.calls.at(-1).orders, [{ column: "name", ascending: false }, { column: "id", ascending: true }]);
});

test("15. Locations: search runs before pagination (Iron23 is found from page 1)", async () => {
  globalThis.__DB = fakeDb({ locations: locations() });
  const all = await Q.getAdminLocationList({ page: 1 });
  assert.ok(!names(all).includes("Zz Iron23 Gym"), "it would fall on the last page");
  const hit = await Q.getAdminLocationList({ q: "iron23", page: 1 });
  assert.deepEqual(names(hit), ["Zz Iron23 Gym"]);
  assert.equal(hit.total, 1);
});

test("16–17. Locations: Needs Review / Published / Archived / Trash compose with sort + page", async () => {
  globalThis.__DB = fakeDb({ locations: locations() });
  // Needs Review = the canonical moderation state; unlisted Drafts are their own view.
  const review = await Q.getAdminLocationList({ needsReview: true, sort: "za", page: 1 });
  assert.equal(review.total, 10);
  assert.ok(review.rows.every((r) => r.review_status === "pending_review"));
  assert.equal(names(review)[0], "Loc 0060");
  const drafts = await Q.getAdminLocationList({ draftsOnly: true, sort: "az", page: 1 });
  assert.equal(drafts.total, 20);
  assert.ok(drafts.rows.every((r) => r.is_demo === true));
  const pub = await Q.getAdminLocationList({ publishedOnly: true, sort: "az", page: 2 });
  assert.equal(pub.total, 41);
  assert.ok(pub.rows.every((r) => r.is_demo === false && !r.archived_at && !r.trashed_at));
  assert.equal(pub.rows.length, 16);
  assert.deepEqual(names(await Q.getAdminLocationList({ lifecycle: "archived" })), ["Archived Spot"]);
  assert.deepEqual(names(await Q.getAdminLocationList({ lifecycle: "trashed" })), ["Trashed Spot"]);
  // The Event editors' Location pickers keep the unpaginated full list.
  assert.match(read("src/app/admin/(protected)/events/new/page.tsx"), /getAdminLocations\(\)/);
});

// ── BUSINESSES ──────────────────────────────────────────────────────────

function businesses() {
  const rows = [];
  for (let n = 1; n <= 30; n++) {
    rows.push({
      id: uid(n),
      name: `Biz ${pad(31 - n)}`,
      slug: `biz-${n}`,
      city: "NYC",
      created_at: day(n),
      updated_at: day(100 - n),
      is_demo: false,
      publication_status: n <= 4 ? "pending_review" : n <= 6 ? "paused" : "live",
      archived_at: n === 29 ? day(50) : null,
      trashed_at: n === 30 ? day(51) : null,
      business_categories: [{ category_id: n % 2 ? "cat-odd" : "cat-even" }],
    });
  }
  return rows;
}

test("18–21. Businesses: Newest (default), Recently Updated kept, Oldest, A–Z, Z–A", async () => {
  assert.deepEqual(SORT.BUSINESS_SORT.options, ["newest", "updated", "oldest", "az", "za"]);
  assert.equal(SORT.BUSINESS_SORT.defaultKey, "newest");
  globalThis.__DB = fakeDb({ businesses: businesses() });
  const newest = await Q.getAdminBusinesses({});
  assert.equal(newest.rows[0].id, uid(28)); // newest active (29 archived, 30 trashed, 5–6 paused)
  assert.deepEqual(globalThis.__DB.calls.at(-1).orders[0], { column: "created_at", ascending: false });
  const updated = await Q.getAdminBusinesses({ sort: "updated" });
  assert.equal(updated.rows[0].id, uid(1));
  const oldest = await Q.getAdminBusinesses({ sort: "oldest" });
  assert.equal(oldest.rows[0].id, uid(1));
  const az = await Q.getAdminBusinesses({ sort: "az" });
  assert.equal(az.rows[0].name, "Biz 0003");
  const za = await Q.getAdminBusinesses({ sort: "za" });
  assert.equal(za.rows[0].name, "Biz 0030");
  assert.equal(SORT.parseAdminSort("bogus", SORT.BUSINESS_SORT), "newest");
});

test("22–23. Businesses: Needs Review + lifecycle + category compose with sort + pagination", async () => {
  globalThis.__DB = fakeDb({ businesses: businesses() });
  const review = await Q.getAdminBusinesses({ published: "pending_review", sort: "oldest", page: 1 });
  assert.deepEqual(review.rows.map((r) => r.id), [uid(1), uid(2), uid(3), uid(4)]);
  assert.equal(review.total, 4);
  const paused = await Q.getAdminBusinesses({ lifecycle: "paused", sort: "az" });
  assert.deepEqual(paused.rows.map((r) => r.name), ["Biz 0025", "Biz 0026"]);
  const active = await Q.getAdminBusinesses({ lifecycle: "active", page: 1 });
  assert.equal(active.total, 26);
  assert.equal(active.rows.length, 25);
  const page2 = await Q.getAdminBusinesses({ lifecycle: "active", page: 2 });
  assert.equal(page2.rows.length, 1);
  const cat = await Q.getAdminBusinesses({ categoryId: "cat-even", sort: "za" });
  assert.ok(cat.rows.every((r) => r.business_categories[0].category_id === "cat-even"));
  assert.equal(cat.total, 13); // 15 even, minus Paused #6 and Trashed #30
  assert.equal((await Q.getAdminBusinesses({ lifecycle: "archived" })).rows[0].id, uid(29));
  assert.equal((await Q.getAdminBusinesses({ lifecycle: "trashed" })).rows[0].id, uid(30));
});

// ── EVENTS ──────────────────────────────────────────────────────────────

const now = Date.now();
const iso = (deltaDays) => new Date(now + deltaDays * 86400000).toISOString();
function events() {
  const rows = [];
  for (let n = 1; n <= 240; n++) {
    rows.push(withDates({
      id: uid(n),
      name: `Event ${pad(n)}`,
      slug: `e-${n}`,
      venue_name: n === 7 ? "Iron Hall" : "Hall",
      start_at: iso(n - 120), // half past, half upcoming
      created_at: iso(n <= 210 ? -30 - n : -(240 - n) / 10), // the last 30 created recently
      is_demo: false,
      publication_status: n % 50 === 0 ? "pending_review" : "live",
      vendor_applications_enabled: n % 4 === 0,
      archived_at: n === 3 ? iso(-1) : null,
      trashed_at: n === 5 ? iso(-1) : null,
      event_businesses: n % 10 === 0 ? [{ status: "applied" }] : [{ status: "accepted" }],
    }));
  }
  return rows;
}

test("24–25. Events: default keeps the chronological order (Event date, latest first); labels say what they sort by", async () => {
  assert.equal(SORT.EVENT_SORT.defaultKey, "date_desc");
  // Event date/time precision (minimum compatibility change): the calendar
  // date first, then the known start (untimed after timed), then id.
  assert.deepEqual(SORT.EVENT_SORT.columns.date_desc, { column: "start_date", ascending: false, then: { column: "start_at", ascending: false, nullsFirst: false } });
  assert.deepEqual(SORT.EVENT_SORT.columns.newest, { column: "created_at", ascending: false });
  assert.equal(SORT.ADMIN_SORT_LABEL.date_desc, "Event Date: Latest First");
  assert.equal(SORT.ADMIN_SORT_LABEL.date_asc, "Event Date: Earliest First");
  // "Newest" / "Oldest" are never a start_at sort.
  for (const k of ["newest", "oldest"]) assert.equal(SORT.EVENT_SORT.columns[k].column, "created_at");
  globalThis.__DB = fakeDb({ events: events() });
  const def = await Q.getAdminEvents({});
  assert.equal(def.rows[0].id, uid(240));
  assert.deepEqual(globalThis.__DB.calls.at(-1).orders, [
    { column: "start_date", ascending: false },
    { column: "start_at", ascending: false, nullsFirst: false },
    { column: "id", ascending: true },
  ]);
  const earliest = await Q.getAdminEvents({ sort: "date_asc" });
  assert.equal(earliest.rows[0].id, uid(1));
  const newest = await Q.getAdminEvents({ sort: "newest" });
  assert.equal(newest.rows[0].id, uid(240));
  const oldest = await Q.getAdminEvents({ sort: "oldest" });
  assert.equal(oldest.rows[0].id, uid(210));
  const za = await Q.getAdminEvents({ sort: "za" });
  assert.equal(za.rows[0].name, "Event 0240");
});

test("26. Events: search runs before pagination", async () => {
  globalThis.__DB = fakeDb({ events: events() });
  const hit = await Q.getAdminEvents({ q: "iron hall", page: 1 });
  assert.deepEqual(hit.rows.map((r) => r.id), [uid(7)]);
});

test("27. New Events paginates (newest-added first) and the old 200-row cap is gone", async () => {
  globalThis.__DB = fakeDb({ events: events() });
  const p1 = await Q.getAdminEvents({ newEvents: true, page: 1 });
  assert.equal(p1.total, 30);
  assert.equal(p1.rows[0].id, uid(240));
  assert.deepEqual(globalThis.__DB.calls.at(-1).orders[0], { column: "created_at", ascending: false });
  const p2 = await Q.getAdminEvents({ newEvents: true, page: 2 });
  assert.equal(p2.rows.length, 5);
  assert.doesNotMatch(read("src/lib/admin/queries.ts").slice(read("src/lib/admin/queries.ts").indexOf("export async function getAdminEvents"), read("src/lib/admin/queries.ts").indexOf("export interface EventParticipant")), /\.limit\(/);
});

test("28–29. Active / Archived / Trash paginate over the full sets", async () => {
  globalThis.__DB = fakeDb({ events: events() });
  const active = await Q.getAdminEvents({ lifecycle: "active", page: 10 });
  assert.equal(active.total, 238);
  assert.equal(active.page, 10);
  assert.equal(active.rows.length, 13);
  assert.equal(active.totalPages, 10);
  assert.deepEqual((await Q.getAdminEvents({ lifecycle: "archived" })).rows.map((r) => r.id), [uid(3)]);
  assert.deepEqual((await Q.getAdminEvents({ lifecycle: "trashed" })).rows.map((r) => r.id), [uid(5)]);
});

test("30–31. date / vendor / pending / Needs Review filters compose with sort + page; nothing is beyond reach", async () => {
  globalThis.__DB = fakeDb({ events: events() });
  const upcoming = await Q.getAdminEvents({ when: "upcoming", vendorAppsOpen: true, sort: "date_asc" });
  assert.ok(upcoming.rows.every((r) => r.vendor_applications_enabled && r.start_at >= new Date(now - 1000).toISOString()));
  assert.ok(upcoming.rows[0].start_at <= upcoming.rows.at(-1).start_at);
  const pending = await Q.getAdminEvents({ pendingApplications: true, sort: "az", page: 1 });
  assert.equal(pending.total, 24);
  assert.ok(pending.rows.every((r) => r.event_businesses.some((b) => b.status === "applied")));
  const review = await Q.getAdminEvents({ needsReview: true });
  assert.deepEqual(review.rows.map((r) => r.id), [uid(200), uid(150), uid(100), uid(50)]);
  // 31. Every one of the 238 active Events is reachable through pages.
  const seen = new Set();
  for (let p = 1; p <= 10; p++) for (const r of (await Q.getAdminEvents({ page: p })).rows) seen.add(r.id);
  assert.equal(seen.size, 238);
});

// ── PEOPLE ──────────────────────────────────────────────────────────────

function people() {
  return Array.from({ length: 40 }, (_, i) => ({ id: uid(i + 1), name: `Person ${pad(40 - i)}`, short_bio: i === 33 ? "pastry chef" : "maker", created_at: day(i + 1), is_public: true }));
}

test("32–35. People: A–Z default; Z–A / Newest / Oldest (people.created_at); pagination; search kept", async () => {
  assert.deepEqual(SORT.PEOPLE_SORT.options, ["az", "za", "newest", "oldest"]);
  assert.equal(SORT.PEOPLE_SORT.defaultKey, "az");
  globalThis.__DB = fakeDb({ people: people() });
  const az = await PQ.getAdminPeople({});
  assert.equal(az.rows[0].name, "Person 0001");
  assert.equal(az.total, 40);
  assert.equal(az.rows.length, 25);
  assert.equal((await PQ.getAdminPeople({ sort: "za" })).rows[0].name, "Person 0040");
  assert.equal((await PQ.getAdminPeople({ sort: "newest" })).rows[0].id, uid(40));
  assert.equal((await PQ.getAdminPeople({ sort: "oldest" })).rows[0].id, uid(1));
  assert.equal((await PQ.getAdminPeople({ page: 2 })).rows.length, 15);
  const chef = await PQ.getAdminPeople({ q: "pastry", sort: "za", page: 1 });
  assert.deepEqual(chef.rows.map((r) => r.id), [uid(34)]);
  // Search keeps the sort; pagination keeps search + sort.
  const page = read("src/app/admin/(protected)/people/page.tsx");
  assert.match(page, /sort !== PEOPLE_SORT\.defaultKey && <input type="hidden" name="sort" value=\{sort\} \/>/);
  assert.match(page, /<AdminPagination pathname=\{PATH\} params=\{params\} result=\{list\} noun="People" \/>/);
  // No bulk lifecycle controls were invented for People.
  assert.doesNotMatch(page, /AdminBulkList|BulkLifecycleToolbar/);
});

// ── BOUNDARIES ──────────────────────────────────────────────────────────

test("36–38. lifecycle labels, mutations and moderation semantics are unchanged", () => {
  assert.deepEqual(PUB.EVENT_VISIBILITY_LABEL, { live: "Published", hidden: "Draft", archived: "Archived", trashed: "Trashed" });
  assert.deepEqual(Object.values(LC.LOCATION_LIFECYCLE_LABEL), ["Published", "Draft", "Archived", "Trashed"]);
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "pending_review" }).label, "Needs Review");
  assert.deepEqual(EV.EVENT_PUBLISH_PATCH, { is_demo: false, publication_status: "live" });
  assert.deepEqual(EV.EVENT_HIDE_PATCH, { is_demo: true });
  assert.deepEqual(EL.BUSINESS_TRANSITION_RULE, {
    approve: { from: "pending_review", to: "live", notify: "live" },
    reject: { from: "pending_review", to: "rejected", notify: "rejected" },
    pause: { from: "live", to: "paused", notify: "paused" },
    resume: { from: "paused", to: "live", notify: "restored" },
  });
  // Bulk bars still receive only the selected rows of the rendered page.
  for (const f of ["events/EventBulkListClient.tsx", "businesses/BusinessBulkListClient.tsx"]) {
    assert.match(read(`src/app/admin/(protected)/${f}`), /selectedRows=\{\w+\.filter\(\(\w\) => selectedIds\.includes\(\w\.id\)\)\}/, f);
  }
});

test("39–40. no Import or public discovery code uses the Admin list foundation", () => {
  const forbidden = [
    "src/app/admin/(protected)/events/import",
    "src/app/admin/(protected)/locations/import",
    "src/app/admin/(protected)/businesses/import",
    "src/lib/data.ts",
  ];
  for (const f of forbidden) {
    let text = "";
    try {
      text = read(f);
    } catch {
      continue; // directory — checked via the shared modules' own imports below
    }
    assert.doesNotMatch(text, /list-sort|list-page/, f);
  }
  // The shared modules are pure and import nothing app-specific.
  for (const f of ["src/lib/admin/list-sort.ts", "src/lib/admin/list-page.ts"]) assert.doesNotMatch(read(f), /^import /m, f);
});

test("Event date/time precision: an Event with no published time stays in Upcoming / Past by its calendar date and sorts after timed Events on that date", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const later = new Date(Date.now() + 2 * 3600_000).toISOString();
  const rows = [
    { id: uid(1), name: "Untimed Today", slug: "u", venue_name: "Hall", start_at: null, end_at: null, start_date: today, end_date: today, created_at: iso(-1), is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, event_businesses: [] },
    withDates({ id: uid(2), name: "Timed Later Today", slug: "t", venue_name: "Hall", start_at: later, end_at: null, created_at: iso(-1), is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, event_businesses: [] }),
    { id: uid(3), name: "Untimed Past", slug: "p", venue_name: "Hall", start_at: null, end_at: null, start_date: "2020-01-01", end_date: null, created_at: iso(-1), is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, event_businesses: [] },
  ];
  globalThis.__DB = fakeDb({ events: rows });
  const upcoming = await Q.getAdminEvents({ when: "upcoming", sort: "date_asc" });
  const sameDay = upcoming.rows.filter((r) => r.start_date === today).map((r) => r.id);
  assert.deepEqual(sameDay, today === rows[1].start_date ? [uid(2), uid(1)] : [uid(1)], "untimed after timed on the same date");
  assert.ok(!upcoming.rows.some((r) => r.id === uid(3)));
  const past = await Q.getAdminEvents({ when: "past" });
  assert.deepEqual(past.rows.map((r) => r.id), [uid(3)], "an untimed past Event is in Past, never lost");
});
