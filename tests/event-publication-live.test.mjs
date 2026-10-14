// Event Publication — LIVE BY DEFAULT + Admin oversight. Every legitimate
// creation path publishes the new Event immediately; Findmi Admin sees it
// under New Events and can Hide / Publish / Shut Down / Restore it.
// Fake clients and source guards only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const data = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return data("export{}");
    if (specifier === "next/headers") return data("export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();");
    if (specifier === "next/navigation") return data("export function redirect(url){throw Object.assign(new Error('NEXT_REDIRECT'),{url})}export function notFound(){throw new Error('NOT_FOUND')}");
    if (specifier === "next/cache") return data("export function revalidatePath(...a){(globalThis.__revalidated ??= []).push(a)}");
    if (specifier === "@/lib/admin/requireAdminSupabase") return data("export async function requireAdminSupabase(){return globalThis.__admin}");
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const PUB = await import("../src/lib/event-publication.ts");
const P = await import("../src/lib/event-import/persist.ts");
const C = await import("../src/lib/appearance-conversion.ts");
const E = await import("../src/lib/event-import/engine.ts");
const L = await import("../src/app/admin/(protected)/events/lifecycle-actions.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI_NYC = "660d3744-dc88-4e91-856c-c0a296c9e776";
const LIVE = { is_demo: false, publication_status: "live" };

/** Records every write; update chains support eq/is/not/select/maybeSingle. */
function fakeAdmin({ appearance = null, updateHits = true } = {}) {
  const ops = [];
  let n = 0;
  const builder = (table) => {
    const filters = [];
    const api = {
      select: () => api, neq: () => api, is: () => api, in: () => api, limit: () => api, order: () => api,
      eq: (k, v) => (filters.push([k, v]), api),
      maybeSingle: async () => ({
        data:
          table === "appearances"
            ? appearance
            : table === "locations"
              ? { id: CORGI_NYC, name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", postal_code: "10016", latitude: null, longitude: null }
              : table === "events"
                ? { slug: "qsbs" }
                : null,
      }),
      then: (resolve) => resolve({ data: [] }),
      insert: (input) => {
        const rows = Array.isArray(input) ? input : [input];
        ops.push({ op: "insert", table, rows });
        const ids = rows.map(() => `${table}-${++n}`);
        return { select: () => ({ single: async () => ({ data: { id: ids[0] }, error: null }), then: (r) => r({ data: ids.map((id) => ({ id })) }) }), then: (r) => r({ error: null }) };
      },
      upsert: (row) => (ops.push({ op: "upsert", table, row }), Promise.resolve({ error: null })),
      update: (patch) => {
        const rec = { op: "update", table, patch, where: [] };
        ops.push(rec);
        const chain = {
          eq: (k, v) => (rec.where.push(["eq", k, v]), chain),
          is: (k, v) => (rec.where.push(["is", k, v]), chain),
          not: (k, o, v) => (rec.where.push(["not", k, v]), chain),
          select: () => chain,
          maybeSingle: async () => ({ data: updateHits ? { id: "ev" } : null, error: null }),
          then: (r) => r({ error: null }),
        };
        return chain;
      },
      delete: () => (ops.push({ op: "delete", table }), api),
    };
    return api;
  };
  return { ops, client: { from: builder, rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: { id: "hosted-event", start_at: args.p_start_at }, error: null }) } };
}
function persistDeps(admin, over = {}) {
  const calls = { notify: [], propagate: [] };
  return {
    calls,
    deps: {
      admin, userId: "u", businessId: "corgi", businessName: "Corgi",
      applyToEvent: async () => "applied", canHost: async () => true, storeImage: async (u) => `stored:${u}`, geography: async () => null,
      uniqueEventSlug: async (t) => t.toLowerCase().replace(/\W+/g, "-"),
      notifyNewEvent: async (id) => calls.notify.push(id),
      propagateDates: async (id, ids) => calls.propagate.push([id, ids]),
      findEventBySourceUrl: async () => over.existing ?? null,
    },
  };
}
const place = (venueName, extra = {}) => ({ venueName, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, matchKey: null, matchDecision: null, ...extra });
const review = (over = {}) => ({
  intent: "participating", title: "QSBS Workshop", description: "Founder tax planning.", imageUrl: null, sourceUrl: "https://luma.com/corginyc-mjk0",
  sharedPlace: true, place: place("Corgi Cafe", { useLocationId: CORGI_NYC, matchDecision: "use" }),
  occurrences: [{ id: "a", date: "2026-10-15", startTime: "10:00", endTime: "12:00", place: place("Corgi Cafe", { useLocationId: CORGI_NYC, matchDecision: "use" }) }],
  organizer: "Corgi NYC", useEventId: null, asEvent: true, ...over,
});
const norm = (r) => {
  const n = P.normalizeReview(r);
  assert.equal(n.ok, true, JSON.stringify(n));
  return n.value;
};
const eventInsert = (ops) => ops.find((o) => o.op === "insert" && o.table === "events")?.rows[0];

// ── 1–5, 15: every creation path publishes immediately ───────────────────
test("the one publication definition: is_demo false + publication_status live", () => {
  assert.deepEqual({ ...PUB.NEW_EVENT_PUBLICATION }, LIVE);
});

test("1: Host an Event / hosted import — create_owned_event, then published at once (guarded to the RPC's state)", async () => {
  const { client, ops } = fakeAdmin();
  const { deps } = persistDeps(client);
  const out = await P.persistEventImport(norm(review({ intent: "hosting", asEvent: false })), deps);
  assert.equal(out.ok, true);
  const rpcAt = ops.findIndex((o) => o.op === "rpc" && o.name === "create_owned_event");
  const publish = ops.findIndex((o) => o.op === "update" && o.table === "events" && o.patch.publication_status === "live");
  assert.ok(rpcAt >= 0 && publish === rpcAt + 1, "published right after creation");
  assert.deepEqual(ops[publish].patch, LIVE);
  assert.deepEqual(ops[publish].where, [["eq", "id", "hosted-event"], ["eq", "publication_status", "pending_review"]], "never re-publishes an Event Admin hid");
  assert.equal(ops.find((o) => o.op === "rpc").args.p_host_business_id, "corgi", "a hosted Event keeps its host");
  // Host an Event's own form action does the same right after the RPC.
  const member = read("src/app/(public)/account/event/actions.ts");
  assert.match(member, /const eventId = \(created as \{ id: string \}\)\.id;\n[\s\S]{0,200}const published = await publishCreatedEvent\(admin, eventId\);/);
});

test("1: publishCreatedEvent reports failure (the Event then simply stays non-public)", async () => {
  const miss = fakeAdmin({ updateHits: false });
  assert.equal(await PUB.publishCreatedEvent(miss.client, "x"), false);
  const hit = fakeAdmin();
  assert.equal(await PUB.publishCreatedEvent(hit.client, "x"), true);
});

test("2 + 5: Where I'll Be rich import → a public Event; the Business participates, never hosts", async () => {
  const { client, ops } = fakeAdmin();
  const { deps, calls } = persistDeps(client);
  const out = await P.persistEventImport(norm(review()), deps);
  assert.deepEqual([out.ok, out.newEvent], [true, true]);
  const row = eventInsert(ops);
  assert.deepEqual([row.is_demo, row.publication_status, row.host_business_id], [false, "live", null]);
  assert.equal(ops.filter((o) => o.op === "rpc").length, 0, "no owner membership for the importer");
  assert.equal(ops.find((o) => o.table === "event_businesses").row.status, "approved");
  assert.equal(calls.notify.length, 1, "Admin is told");
});

test("3: a calendar import's Events each go live through the same path", async () => {
  const { client, ops } = fakeAdmin();
  const { deps } = persistDeps(client);
  for (const [title, url] of [["Mixer A", "https://luma.com/a"], ["Mixer B", "https://luma.com/b"]]) {
    assert.equal((await P.persistEventImport(norm(review({ title, sourceUrl: url })), deps)).ok, true);
  }
  const rows = ops.filter((o) => o.op === "insert" && o.table === "events").map((o) => o.rows[0]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.is_demo === false && r.publication_status === "live" && r.host_business_id === null));
  // commitEventImportBatch saves each reviewed Event through commitOne → persistEventImport.
  const actions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(actions, /export async function commitEventImportBatch[\s\S]*?await commitOne\(ctx, businessId, review, emailVerified\)/);
});

test("4: legacy Appearance → Event conversion creates a public Event", async () => {
  const item = {
    id: "qsbs-item", business_id: "corgi", title: "QSBS Workshop", description: null, start_at: "2026-10-15T14:00:00Z", end_at: "2026-10-15T16:00:00Z",
    status: "confirmed", event_id: null, location_id: CORGI_NYC, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY",
    latitude: null, longitude: null, external_url: "https://luma.com/corginyc-mjk0", flyer_image_url: null, market_id: "m1", market_area_id: null,
  };
  const { client, ops } = fakeAdmin({ appearance: item });
  const out = await C.convertAppearanceToEvent(client, item.id, { uniqueEventSlug: async () => "qsbs" });
  assert.equal(out.status, "converted");
  const row = eventInsert(ops);
  assert.deepEqual([row.is_demo, row.publication_status, row.host_business_id], [false, "live", null]);
});

test("15: no creation path writes the review state any more; no approval step in Admin", () => {
  for (const f of ["src/lib/event-import/persist.ts", "src/lib/appearance-conversion.ts"]) {
    assert.doesNotMatch(read(f), /publication_status: "pending_review"|is_demo: true/, f);
  }
  const member = read("src/app/(public)/account/event/actions.ts");
  const create = member.slice(member.indexOf("export async function createMemberEvent"), member.indexOf("// ── EVENT DETAILS"));
  assert.doesNotMatch(create, /pending_review"\s*[,}]|is_demo: true/);
  assert.doesNotMatch(create, /awaiting review/i);
  const page = read("src/app/admin/(protected)/events/[id]/page.tsx");
  assert.doesNotMatch(page, /PendingReviewPanel|approveEventListing|rejectEventListing/, "no Approve/Reject gate on the Event page");
  assert.doesNotMatch(read("src/app/admin/(protected)/events/page.tsx"), /Needs review/, "no 'Needs review' filter implying permission");
  assert.doesNotMatch(read("src/app/(public)/account/event/new/page.tsx"), /review it before it appears publicly|reviews it before it appears publicly/);
  assert.doesNotMatch(read("src/lib/event-import/review.ts"), /reviews new Events before/);
});

// ── 6–8: public behavior of a live Event ─────────────────────────────────
test("6: the public Event route needs only is_demo = false (archive/trash are enforced by RLS)", () => {
  const dataSrc = read("src/lib/data.ts");
  assert.match(dataSrc, /export async function getEventBySlug\(slug: string\)[\s\S]{0,260}\.eq\("slug", slug\)\s*\.eq\("is_demo", false\)\s*\.maybeSingle\(\)/);
  assert.equal(PUB.NEW_EVENT_PUBLICATION.is_demo, false, "so a new Event resolves at once");
});

test("7 + 8: a live Event's Occurrence shows on its Location once; Event-linked items aren't repeated", () => {
  const dataSrc = read("src/lib/data.ts");
  const fn = dataSrc.slice(dataSrc.indexOf("async function queryUpcomingHappenings("), dataSrc.indexOf("export async function getLocationDescendants("));
  assert.match(fn, /\.from\("event_occurrences"\)[\s\S]*?\.in\("location_id", locationIds\)/);
  assert.match(fn, /if \(!e \|\| e\.is_demo \|\| !keptOccurrenceRows\.has\(row\)\) continue;/, "hidden Events' dates are skipped");
  assert.match(fn, /\.in\("location_id", locationIds\)\s*\.is\("event_id", null\)/, "only standalone schedule items alongside");
});

test("C: a participant's schedule item links to the Event only while it is public", () => {
  const dataSrc = read("src/lib/data.ts");
  assert.match(dataSrc, /href: event && !event\.is_demo \? `\/event\/\$\{event\.slug\}` : null/);
});

// ── 9: Admin oversight ───────────────────────────────────────────────────
test("9: New Events = created in the last 7 days (not Trash), newest first; on Admin Home too", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(PUB.newEventsSinceIso(now), "2026-10-07T12:00:00.000Z");
  const q = read("src/lib/admin/queries.ts");
  assert.match(q, /if \(filters\.newEvents\) \{\s*let query = supabase\.from\("events"\)\.select\("\*"\)\.gte\("created_at", newEventsSinceIso\(\)\)\.is\("trashed_at", null\);/);
  assert.match(q, /\.order\("created_at", \{ ascending: false \}\)/);
  const list = read("src/app/admin/(protected)/events/page.tsx");
  assert.match(list, /href=\{`\/admin\/events\?new=1/);
  assert.match(list, />\s*New Events\s*</);
  assert.match(list, /newEvents: newEventsOnly/);
  const home = read("src/app/admin/(protected)/page.tsx");
  assert.match(home, /count: needsAttention\.newEvents, href: "\/admin\/events\?new=1"/);
  assert.match(read("src/lib/admin/dashboard-queries.ts"), /from\("events"\)\.select\("id", \{ count: "exact", head: true \}\)\.gte\("created_at", newEventsSinceIso\(\)\)\.is\("trashed_at", null\)/);
});

test("9: each New Event row offers View / Edit / Hide or Publish / Shut Down; the Event page has the same controls", () => {
  const rows = read("src/app/admin/(protected)/events/EventBulkListClient.tsx");
  for (const a of ["hideEvent.bind(null, e.id, NEW_EVENTS_LIST)", "publishEvent.bind(null, e.id, NEW_EVENTS_LIST)", "shutDownEvent.bind(null, e.id, NEW_EVENTS_LIST)"]) assert.ok(rows.includes(a), a);
  assert.match(rows, /href=\{`\/event\/\$\{e\.slug\}`\}/);
  const page = read("src/app/admin/(protected)/events/[id]/page.tsx");
  for (const a of ["publishEvent.bind(null, id, null)", "hideEvent.bind(null, id, null)", "shutDownEvent.bind(null, id, null)", "restoreEvent.bind(null, id, null)"]) assert.ok(page.includes(a), a);
});

test("visibility wording", () => {
  assert.equal(PUB.eventVisibility({ is_demo: false }), "live");
  assert.equal(PUB.eventVisibility({ is_demo: true }), "hidden");
  assert.equal(PUB.eventVisibility({ is_demo: false, archived_at: "2026-10-14" }), "archived");
  assert.equal(PUB.eventVisibility({ is_demo: false, archived_at: "x", trashed_at: "y" }), "trashed");
  assert.equal(PUB.EVENT_VISIBILITY_LABEL.archived, "Shut Down");
});

// ── 10–13: Admin authority; nothing deleted ──────────────────────────────
async function runAction(fn, ...args) {
  const { client, ops } = fakeAdmin();
  globalThis.__admin = client;
  globalThis.__revalidated = [];
  try {
    await fn(...args);
  } catch (err) {
    if (err.message !== "NEXT_REDIRECT") throw err;
    return { ops, url: err.url, revalidated: globalThis.__revalidated };
  }
  assert.fail("the action must redirect");
}

test("10 + 11: Hide → is_demo true (Event page, listings, Location dates stop showing it); site-wide revalidation", async () => {
  const r = await runAction(L.hideEvent, "ev-1", "/admin/events?new=1");
  const upd = r.ops.find((o) => o.op === "update");
  assert.deepEqual(upd.patch, { is_demo: true });
  assert.deepEqual(upd.where, [["eq", "id", "ev-1"]]);
  assert.ok(r.revalidated.some((a) => a[0] === "/" && a[1] === "layout"), "every public page re-reads it");
  assert.ok(r.revalidated.some((a) => a[0] === "/event/qsbs"));
  assert.match(r.url, /^\/admin\/events\?new=1&result=Event%20hidden/);
});

test("10 + 11: Shut Down → archived (restrictive RLS hides the Event, its dates and linked schedule items); Restore undoes it", async () => {
  const down = await runAction(L.shutDownEvent, "ev-1", null);
  const upd = down.ops.find((o) => o.op === "update");
  assert.deepEqual(Object.keys(upd.patch), ["archived_at"]);
  assert.deepEqual(upd.where, [["eq", "id", "ev-1"], ["is", "archived_at", null], ["is", "trashed_at", null]]);
  assert.match(down.url, /^\/admin\/events\/ev-1\?result=/);
  const up = await runAction(L.restoreEvent, "ev-1", null);
  assert.deepEqual(up.ops.find((o) => o.op === "update").patch, { archived_at: null });
});

test("Publish → live again (also publishes an older pending/rejected Event), never out of Trash", async () => {
  const r = await runAction(L.publishEvent, "ev-1", null);
  const upd = r.ops.find((o) => o.op === "update");
  assert.deepEqual(upd.patch, LIVE);
  assert.deepEqual(upd.where, [["eq", "id", "ev-1"], ["is", "trashed_at", null]]);
});

test("12: no oversight action deletes anything; the return path can't leave Admin Events", async () => {
  for (const fn of [L.hideEvent, L.publishEvent, L.shutDownEvent, L.restoreEvent]) {
    const r = await runAction(fn, "ev-1", "https://evil.example/");
    assert.equal(r.ops.filter((o) => o.op === "delete").length, 0);
    assert.ok(r.url.startsWith("/admin/events/ev-1?result="), r.url);
  }
  const src = read("src/app/admin/(protected)/events/lifecycle-actions.ts");
  const oversight = src.slice(src.indexOf("// ── Event Publication"));
  assert.doesNotMatch(oversight, /\.delete\(/);
  assert.equal((oversight.match(/await requireAdminSupabase\(\)/g) ?? []).length, 4, "each action is Admin-only");
});

test("13: rejected / archived / trashed stay non-public; joining a hidden Event stays unavailable", () => {
  // Restrictive RLS (Hide archived or trashed events / occurrences / appearances) is unchanged;
  // the publish guard only ever moves the RPC's fresh state, never a hidden or rejected Event.
  assert.match(read("src/lib/event-publication.ts"), /\.eq\("publication_status", "pending_review"\)/);
  assert.match(read("src/lib/event-participation.ts"), /if \(!ev \|\| \(ev\.is_demo && ev\.publication_status !== "pending_review"\)\) return "unavailable";/);
  assert.equal(PUB.eventVisibility({ is_demo: true, publication_status: "rejected" }), "hidden");
});

// ── 14: validation unchanged ─────────────────────────────────────────────
test("14: invalid sources are still refused before anything is published", async () => {
  const deps = { fetchPage: async () => assert.fail("never fetched"), isRateLimited: () => false, now: () => Date.now() };
  for (const url of ["not a url", "https://127.0.0.1/e", "javascript:alert(1)", "https://user:pw@luma.com/x"]) {
    const r = await E.analyzeEventUrl({ url, businessId: "b", rateKey: "u" }, deps);
    assert.equal(r.ok, false, url);
  }
  const r = await E.analyzeEventUrl({ url: "https://luma.com/x", businessId: "b", rateKey: "u" }, { ...deps, fetchPage: async () => ({ ok: false, code: "blocked_by_site", redirects: 0, status: 403, host: "luma.com" }) });
  assert.deepEqual([r.ok, r.code], [false, "blocked_by_site"]);
});
