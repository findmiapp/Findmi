// Event Formats V1 — HOW an Event is experienced (zero-to-many), separate
// from Category/Subcategory. Migration, persistence (forms + import),
// the shared filter contract and the shared query, against in-memory
// doubles. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier === "./supabase" && context.parentURL?.endsWith("/src/lib/data.ts")) {
      return { url: "data:text/javascript,export const getSupabase=()=>globalThis.__fakeSupabase??null;", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const EF = await import("../src/lib/event-formats.ts");
const EFS = await import("../src/lib/event-formats-server.ts");
const F = await import("../src/lib/event-filter.ts");
const P = await import("../src/lib/event-import/persist.ts");
const D = await import("../src/lib/data.ts");
const { orPredicate, withDates } = await import("./helpers/postgrest-or.mjs");
const read = (p) => readFileSync(p, "utf8");

const MIGRATION = "supabase/migrations/20261017000000_event_formats_v1.sql";
const sql = read(MIGRATION);
const body = sql.replace(/--.*$/gm, "");

const APPROVED = [
  "Brand Activation", "Pop-Up", "Sampling", "Product Launch", "Retail Experience", "Sample Sale", "Market", "Festival",
  "Networking", "Talk & Panel", "Workshop", "Conference", "Exhibition", "Immersive Experience", "Performance", "Party & Social",
];

// ── MIGRATION ─────────────────────────────────────────────────────────────

test("migration: 'event_format' added to the category kinds, keeping every existing kind", () => {
  assert.match(body, /alter table public\.categories drop constraint if exists categories_kind_check;/);
  assert.match(body, /check \(kind in \('business', 'event', 'product', 'location', 'event_format'\)\)/);
});

test("migration: seeds exactly the 16 approved Formats with deterministic slugs, and assigns none", () => {
  const seeded = [...body.matchAll(/\('([^']+)', '([a-z0-9-]+)', 'event_format'\)/g)].map((m) => ({ name: m[1], slug: m[2] }));
  assert.deepEqual(seeded.map((s) => s.name), APPROVED);
  assert.deepEqual(seeded, EF.EVENT_FORMAT_V1.map((f) => ({ name: f.name, slug: f.slug })));
  for (const { name, slug } of seeded) {
    assert.equal(slug, name.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name);
  }
  assert.equal(new Set(seeded.map((s) => s.slug)).size, 16);
  assert.match(body, /on conflict \(kind, slug\) do nothing;/, "re-runnable");
  assert.doesNotMatch(body, /insert into public\.event_formats/i, "no Event is assigned a Format");
  assert.doesNotMatch(body, /event_categories/i, "Formats never touch event_categories");
  assert.doesNotMatch(body, /\b(delete from|drop table|truncate)\b/i);
});

test("migration: separate event_formats relationship — PK, filter index, FKs, public read, trusted writes", () => {
  assert.match(body, /create table if not exists public\.event_formats \(\s*event_id\s+uuid not null references public\.events \(id\) on delete cascade,\s*category_id uuid not null references public\.categories \(id\) on delete cascade,[\s\S]*?primary key \(event_id, category_id\)\s*\);/);
  assert.match(body, /create index if not exists event_formats_category_id_idx on public\.event_formats \(category_id\);/);
  assert.match(body, /alter table public\.event_formats enable row level security;/);
  assert.match(body, /revoke all on public\.event_formats from anon, authenticated;\s*grant select on public\.event_formats to anon, authenticated;\s*grant all on public\.event_formats to service_role;/);
  assert.match(body, /create policy "Public read event formats" on public\.event_formats for select using \(true\);/);
});

test("migration: integrity — only kind='event_format' can be linked; Formats are flat; an in-use Format can't change kind", () => {
  assert.match(body, /if not exists \(select 1 from public\.categories c where c\.id = new\.category_id and c\.kind = 'event_format'\) then\s*raise exception/);
  assert.match(body, /create trigger trg_event_formats_kind\s+before insert or update on public\.event_formats/);
  assert.match(body, /if new\.kind = 'event_format' and new\.parent_id is not null then\s*raise exception/);
  assert.match(body, /old\.kind = 'event_format' and new\.kind <> 'event_format'\s+and exists \(select 1 from public\.event_formats f where f\.category_id = old\.id\)/);
  assert.match(body, /create trigger trg_categories_event_format\s+before insert or update on public\.categories/);
  // The existing hierarchy trigger already refuses a child whose kind differs
  // from its parent's, so no Format can be a parent either (a child would
  // have to be an event_format, which can't have a parent).
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "20261112000000_opportunity_service_model.sql" /* later passes (… Event date/time precision, Identity & Authorship V1, Brand Audit V1, Brand Intelligence V1.1, Brand Intelligence V1.2, Discovery Intelligence V1, Canonical Entity Geography) */);
});

// ── PERSISTENCE ───────────────────────────────────────────────────────────

const FMT = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POP = FMT(1), SAMPLING = FMT(2), BRAND = FMT(3);
const EVENT_CAT = "bbbbbbbb-0000-4000-8000-000000000001";
const fd = (entries) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

test("form decision: only a form with the Format picker edits Formats; selection is exact, de-duplicated", () => {
  assert.deepEqual(EF.decideEventFormatWrite(fd([["name", "x"]])), { kind: "keep" }, "no picker → links untouched");
  assert.deepEqual(EF.decideEventFormatWrite(fd([["format_ids_present", "1"]])), { kind: "set", ids: [] }, "picker with nothing checked → clear");
  assert.deepEqual(EF.decideEventFormatWrite(fd([["format_ids_present", "1"], ["format_ids", POP], ["format_ids", SAMPLING], ["format_ids", POP], ["format_ids", "junk"]])), { kind: "set", ids: [POP, SAMPLING] });
  assert.deepEqual(EF.diffEventFormats([POP, BRAND], [POP, SAMPLING]), { add: [SAMPLING], remove: [BRAND] });
  assert.deepEqual(EF.diffEventFormats([POP], [POP]), { add: [], remove: [] });
});

/** A client double for event_formats / categories writes. */
function linkClient({ links = [], formats = [POP, SAMPLING, BRAND] } = {}) {
  const ops = [];
  const state = { links: links.map((l) => ({ ...l })) };
  const from = (table) => {
    const filters = [];
    const api = {
      select: () => api,
      eq: (k, v) => (filters.push(["eq", k, v]), api),
      in: (k, v) => (filters.push(["in", k, v]), api),
      then: (resolve) => {
        if (table === "categories") {
          const ids = filters.find((f) => f[0] === "in")?.[2] ?? [];
          const kind = filters.find((f) => f[0] === "eq" && f[1] === "kind")?.[2];
          return resolve({ data: kind === "event_format" ? ids.filter((id) => formats.includes(id)).map((id) => ({ id })) : [], error: null });
        }
        const eventId = filters.find((f) => f[0] === "eq" && f[1] === "event_id")?.[2];
        return resolve({ data: state.links.filter((l) => l.event_id === eventId).map((l) => ({ category_id: l.category_id })), error: null });
      },
      delete: () => {
        const del = [];
        const chain = {
          eq: (k, v) => (del.push(["eq", k, v]), chain),
          in: (k, v) => {
            del.push(["in", k, v]);
            ops.push({ op: "delete", table, del: [...del] });
            const eventId = del.find((d) => d[1] === "event_id")[2];
            state.links = state.links.filter((l) => !(l.event_id === eventId && v.includes(l.category_id)));
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
      upsert: (rows, opts) => {
        ops.push({ op: "upsert", table, rows, opts });
        for (const r of rows) if (!state.links.some((l) => l.event_id === r.event_id && l.category_id === r.category_id)) state.links.push(r);
        return Promise.resolve({ error: null });
      },
      insert: (rows) => (ops.push({ op: "insert", table, rows }), { select: () => ({ single: async () => ({ data: { id: "new-event" }, error: null }), then: (r) => r({ data: [{ id: "occ-1" }] }) }), then: (r) => r({ error: null }) }),
    };
    return api;
  };
  return { ops, state, client: { from } };
}

test("syncEventFormats: multiple Formats, explicit add/remove, no duplicates, only real Formats, never event_categories", async () => {
  const c = linkClient({ links: [{ event_id: "e1", category_id: BRAND }] });
  assert.deepEqual(await EFS.syncEventFormats(c.client, "e1", [POP, SAMPLING, POP, EVENT_CAT]), {});
  assert.deepEqual(c.state.links.map((l) => l.category_id).sort(), [POP, SAMPLING].sort(), "BRAND removed, POP + SAMPLING added once, the Event category refused");
  assert.ok(c.ops.every((o) => o.table === "event_formats"), "writes only ever go to event_formats");
  assert.equal(c.ops.find((o) => o.op === "upsert").opts.ignoreDuplicates, true);
  // Re-saving the same selection changes nothing.
  c.ops.length = 0;
  await EFS.syncEventFormats(c.client, "e1", [SAMPLING, POP]);
  assert.deepEqual(c.ops, []);
  // Clearing removes them all.
  await EFS.syncEventFormats(c.client, "e1", []);
  assert.deepEqual(c.state.links, []);
});

test("forms: admin create/edit, member edit and member Add An Event all carry the Format picker; saves use the shared sync", () => {
  const field = read("src/components/admin/EventFormatField.tsx");
  assert.match(field, /<input type="hidden" name=\{EVENT_FORMATS_PRESENT_FIELD\} value="1" \/>/);
  assert.match(field, /name=\{EVENT_FORMAT_IDS_FIELD\}/);
  assert.doesNotMatch(field, /\srequired(\s|\/|>|=)/, "never a required input");
  for (const p of ["src/app/admin/(protected)/events/EventForm.tsx", "src/app/(public)/account/event/[id]/page.tsx", "src/app/(public)/account/event/new/page.tsx"]) {
    assert.match(read(p), /<EventFormatField/, p);
    assert.match(read(p), /<CategorySubcategoryField/, `${p}: Category stays its own single field`);
  }
  for (const p of ["src/app/admin/(protected)/events/[id]/page.tsx", "src/app/admin/(protected)/events/new/page.tsx", "src/app/(public)/account/event/new/page.tsx"]) {
    assert.match(read(p), /getAllCategories\("event_format"\)/, p);
  }
  const admin = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(admin, /const formatWrite = decideEventFormatWrite\(formData\);\n\s+if \(formatWrite\.kind === "set"\) \{\n\s+const \{ error: formatError \} = await syncEventFormats\(supabase, eventId as string, formatWrite\.ids\);/);
  const member = read("src/app/(public)/account/event/actions.ts");
  assert.match(member, /const \{ error: formatError \} = await syncEventFormats\(admin, eventId, formatWrite\.ids\);/);
  assert.match(member, /if \(createFormats\.kind === "set" && createFormats\.ids\.length > 0\) await syncEventFormats\(admin, eventId, createFormats\.ids\);/);
  // Category and Format writes stay in their own tables.
  for (const src of [admin, member]) assert.doesNotMatch(src, /from\("event_categories"\)[^;]*format/i);
});

test("admin: an Event Formats screen on the shared category machinery; delete guard counts Format use", () => {
  const actions = read("src/app/admin/(protected)/categories/formats/actions.ts");
  for (const fn of ["createCategoryRow", "saveCategoryRows", "deleteCategoryRow"]) assert.match(actions, new RegExp(`${fn}\\(supabase, "event_format"`));
  assert.match(read("src/app/admin/(protected)/categories/formats/page.tsx"), /<CategoryList\s+kind="event_format"/);
  assert.match(read("src/app/admin/(protected)/categories/page.tsx"), /href="\/admin\/categories\/formats"/);
  assert.match(read("src/lib/admin/categoryForm.ts"), /supabase\.from\("event_formats"\)\.select\("category_id", \{ count: "exact", head: true \}\)\.eq\("category_id", id\)/);
  assert.match(read("src/lib/types.ts"), /export type CategoryKind = "business" \| "event" \| "product" \| "location" \| "event_format";/);
});

// ── IMPORT ────────────────────────────────────────────────────────────────

function importAdmin() {
  const ops = [];
  const formats = [POP, SAMPLING, BRAND];
  let n = 0;
  const from = (table) => {
    const filters = [];
    const api = {
      select: () => api, neq: () => api, is: () => api, limit: () => api, order: () => api,
      eq: (k, v) => (filters.push(["eq", k, v]), api),
      in: (k, v) => (filters.push(["in", k, v]), api),
      maybeSingle: async () => ({ data: null }),
      then: (resolve) => {
        if (table === "categories") {
          const ids = filters.find((f) => f[0] === "in")?.[2] ?? [];
          const kind = filters.find((f) => f[0] === "eq" && f[1] === "kind")?.[2];
          const pool = kind === "event_format" ? formats : kind === "event" ? [EVENT_CAT] : [];
          return resolve({ data: ids.filter((id) => pool.includes(id)).map((id) => ({ id })), error: null });
        }
        return resolve({ data: [] });
      },
      insert: (input) => {
        const rows = Array.isArray(input) ? input : [input];
        ops.push({ op: "insert", table, rows });
        const ids = rows.map(() => `${table}-${++n}`);
        return { select: () => ({ single: async () => ({ data: { id: ids[0] }, error: null }), then: (r) => r({ data: ids.map((id) => ({ id })) }) }), then: (r) => r({ error: null }) };
      },
      upsert: (rows, opts) => (ops.push({ op: "upsert", table, rows: Array.isArray(rows) ? rows : [rows], opts }), Promise.resolve({ error: null })),
      update: (patch) => {
        ops.push({ op: "update", table, patch });
        const chain = { eq: () => chain, is: () => chain, select: () => chain, maybeSingle: async () => ({ data: { id: "x" }, error: null }), then: (r) => r({ error: null }) };
        return chain;
      },
      delete: () => (ops.push({ op: "delete", table }), api),
    };
    return api;
  };
  return { ops, client: { from, rpc: async () => ({ data: { id: "hosted-event" }, error: null }) } };
}
const deps = (admin, over = {}) => ({
  admin, userId: "u", businessId: "biz", businessName: "Biz",
  applyToEvent: async () => "approved_now", canHost: async () => true, storeImage: async () => null, geography: async () => null,
  uniqueEventSlug: async (t) => t.toLowerCase().replace(/\W+/g, "-"), notifyNewEvent: async () => {}, propagateDates: async () => {}, findEventBySourceUrl: async () => null,
  ...over,
});
const review = (over = {}) => ({
  intent: "participating", title: "Burt's Bees Pop-Up", description: null, imageUrl: null, sourceUrl: "https://example.com/bees",
  occurrences: [{ id: "d1", date: "2026-11-07", startTime: "11:00", endTime: "17:00", place: { venueName: null, address: null, city: null, state: null, postalCode: null, useLocationId: null } }],
  sharedPlace: true, place: { venueName: "SoHo", address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null },
  organizer: null, useEventId: null, asEvent: true, ...over,
});
const formatWrites = (ops) => ops.filter((o) => o.table === "event_formats");

test("import: a NEW imported Event saves the Formats chosen in Review (several), alongside its separate Category", async () => {
  for (const intent of ["participating", "hosting"]) {
    const r = P.normalizeReview(review({ intent, categoryId: EVENT_CAT, formatIds: [BRAND, POP, SAMPLING, POP, "junk"] }));
    assert.deepEqual(r.value.formatIds, [BRAND, POP, SAMPLING]);
    const a = importAdmin();
    assert.equal((await P.persistEventImport(r.value, deps(a.client))).ok, true);
    const ups = formatWrites(a.ops).filter((o) => o.op === "upsert");
    assert.equal(ups.length, 1, intent);
    assert.deepEqual(ups[0].rows.map((x) => x.category_id).sort(), [BRAND, POP, SAMPLING].sort());
    const cat = a.ops.filter((o) => o.table === "event_categories");
    assert.deepEqual(cat.flatMap((o) => o.rows.map((x) => x.category_id)), [EVENT_CAT], "category separate; no Format id in event_categories");
  }
  // None chosen → nothing written (nothing is inferred).
  const none = importAdmin();
  await P.persistEventImport(P.normalizeReview(review()).value, deps(none.client));
  assert.equal(formatWrites(none.ops).length, 0);
});

test("import: an EXISTING matched Event never has its Formats written", async () => {
  const withFormats = { formatIds: [POP, SAMPLING] };
  const a = importAdmin();
  await P.persistEventImport(P.normalizeReview(review(withFormats)).value, deps(a.client, { findEventBySourceUrl: async () => ({ id: "existing" }) }));
  assert.equal(formatWrites(a.ops).length, 0, "matched by source link");
  const b = importAdmin();
  await P.persistEventImport(P.normalizeReview(review({ ...withFormats, useEventId: "cccccccc-0000-4000-8000-000000000001" })).value, deps(b.client));
  assert.equal(formatWrites(b.ops).length, 0, "'Yes, it's this Event'");
  const c = importAdmin();
  await P.persistEventImport(P.normalizeReview(review({ ...withFormats, intent: "hosting", useEventId: "cccccccc-0000-4000-8000-000000000001" })).value, deps(c.client));
  assert.equal(formatWrites(c.ops).length, 0, "hosting an Event already on Findmi");
  // The Review shows the picker only where a NEW Event is created.
  assert.match(read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx"), /\{\(intent === "hosting" \|\| review\.asEvent\) && <EventFormatEditor key=\{`f\$\{reviewVersion\}`\} formats=\{formats\} review=\{review\} set=\{set\} \/>\}/);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx"), /\{\(!joining \|\| operator\) && \(review\.intent === "hosting" \|\| review\.asEvent\) && <EventFormatEditor formats=\{formats\} review=\{review\} set=\{set\} \/>\}/);
});

// ── FILTER CONTRACT ───────────────────────────────────────────────────────

test("URL: format repeated and/or comma-separated, normalized, de-duplicated, malformed dropped; round-trips", () => {
  assert.deepEqual(F.parseEventFilter(new URLSearchParams("format=sampling&format=Pop-Up,brand-activation&format=pop-up")).formats, ["brand-activation", "pop-up", "sampling"]);
  assert.equal(F.parseEventFilter(new URLSearchParams("format=Pop%20Up!&format=")).formats, undefined);
  assert.deepEqual(F.parseEventFilter({ format: ["talk-panel", "conference"] }).formats, ["conference", "talk-panel"]);
  const p = F.eventFilterToSearchParams({ category: "beauty-wellness", formats: ["sampling", "pop-up", "sampling"], access: ["rsvp"], when: "weekend" });
  assert.equal(p.toString(), "when=weekend&category=beauty-wellness&format=pop-up&format=sampling&access=rsvp");
  assert.deepEqual(F.parseEventFilter(p), { when: "weekend", category: "beauty-wellness", formats: ["pop-up", "sampling"], access: ["rsvp"] });
  assert.deepEqual(F.eventDiscoveryParams({ formats: ["sampling", "pop-up"] }).formatSlugs, ["pop-up", "sampling"]);
  assert.equal(F.eventDiscoveryParams({}).formatSlugs, undefined);
});

// In-memory Supabase for getEventsDiscovery.
function fakeSupabase(tables) {
  const from = (table) => {
    const filters = [];
    const api = {
      select: () => api,
      eq: (k, v) => (filters.push(["eq", k, v]), api),
      in: (k, v) => (filters.push(["in", k, v]), api),
      lt: (k, v) => (filters.push(["lt", k, v]), api),
      gt: (k, v) => (filters.push(["gt", k, v]), api),
      // `.or(...)` windows evaluated like PostgREST (helpers/postgrest-or).
      or: (expr) => (filters.push(["or", expr]), api), ilike: () => api, neq: () => api, is: () => api, not: () => api, limit: () => api,
      order: () => api,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve) => resolve({ data: run(), error: null }),
    };
    const run = () =>
      (tables[table] ?? []).map(withDates).filter((r) =>
        filters.every(([op, k, v]) => (op === "eq" ? r[k] === v : op === "in" ? v.includes(r[k]) : op === "lt" ? r[k] < v : op === "gt" ? r[k] > v : op === "or" ? orPredicate(k)(r) : true))
      );
    return api;
  };
  return { from };
}
const H = 3_600_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ev = (id, over = {}) => ({ id, slug: id, name: id, is_demo: false, start_at: iso(NOW + 2 * 24 * H), end_at: iso(NOW + 2 * 24 * H + H), location_visibility: null, rsvp_enabled: false, rsvp_url: null, tickets_enabled: false, tickets_url: null, market_id: null, market_area_id: null, city: "New York", state: "NY", ...over });
function world() {
  return {
    events: [
      ev("bees", { rsvp_enabled: true, rsvp_url: "https://x.example/r" }),
      ev("sample-sale-fashion"),
      ev("ai-conf"),
      ev("no-formats"),
      ev("past-popup", { start_at: iso(NOW - 3 * 24 * H), end_at: iso(NOW - 3 * 24 * H + H) }),
    ],
    event_occurrences: [],
    categories: [
      { id: "c-beauty", slug: "beauty-wellness", kind: "event", parent_id: null },
      { id: "c-skin", slug: "skincare", kind: "event", parent_id: "c-beauty" },
      { id: "c-fashion", slug: "fashion-style", kind: "event", parent_id: null },
      { id: "c-ai", slug: "ai", kind: "event", parent_id: "c-biz" },
      { id: "c-biz", slug: "business-tech", kind: "event", parent_id: null },
      { id: "f-pop", slug: "pop-up", kind: "event_format", parent_id: null },
      { id: "f-sampling", slug: "sampling", kind: "event_format", parent_id: null },
      { id: "f-brand", slug: "brand-activation", kind: "event_format", parent_id: null },
      { id: "f-sale", slug: "sample-sale", kind: "event_format", parent_id: null },
      { id: "f-conf", slug: "conference", kind: "event_format", parent_id: null },
      // An Event category sharing a Format's slug must never satisfy a Format filter.
      { id: "c-market", slug: "market", kind: "event", parent_id: null },
    ],
    event_categories: [
      { event_id: "bees", category_id: "c-skin" },
      { event_id: "sample-sale-fashion", category_id: "c-fashion" },
      { event_id: "ai-conf", category_id: "c-ai" },
      { event_id: "no-formats", category_id: "c-market" },
    ],
    event_formats: [
      { event_id: "bees", category_id: "f-brand" },
      { event_id: "bees", category_id: "f-pop" },
      { event_id: "bees", category_id: "f-sampling" },
      { event_id: "sample-sale-fashion", category_id: "f-sale" },
      { event_id: "sample-sale-fashion", category_id: "f-pop" },
      { event_id: "ai-conf", category_id: "f-conf" },
      { event_id: "past-popup", category_id: "f-pop" },
    ],
  };
}
async function discover(filter) {
  globalThis.__fakeSupabase = fakeSupabase(world());
  return (await D.getEventsDiscovery(F.eventDiscoveryParams(filter))).map((e) => e.id).sort();
}

test("query: OR within Formats; unknown Formats fail safely; an Event category slug is never a Format", async () => {
  assert.deepEqual(await discover({ formats: ["pop-up"] }), ["bees", "sample-sale-fashion"], "past Events excluded as usual");
  assert.deepEqual(await discover({ formats: ["sampling", "conference"] }), ["ai-conf", "bees"]);
  assert.deepEqual(await discover({ formats: ["pop-up", "not-a-format"] }), ["bees", "sample-sale-fashion"], "unknown ignored when others match");
  assert.deepEqual(await discover({ formats: ["not-a-format"] }), [], "only unknown → nothing, never everything");
  assert.deepEqual(await discover({ formats: ["market"] }), [], "'market' is an Event category here, not a Format");
});

test("query: AND between Category and Format (parent includes children), and with access/geography/search", async () => {
  assert.deepEqual(await discover({ category: "beauty-wellness", formats: ["pop-up"] }), ["bees"]);
  assert.deepEqual(await discover({ category: "fashion-style", formats: ["sampling"] }), []);
  assert.deepEqual(await discover({ category: "business-tech", formats: ["conference"] }), ["ai-conf"]);
  assert.deepEqual(await discover({ formats: ["pop-up"], access: ["rsvp"] }), ["bees"]);
  assert.deepEqual(await discover({ formats: ["pop-up"], when: "week" }).then((r) => r.every((id) => ["bees", "sample-sale-fashion"].includes(id))), true);
  assert.deepEqual(await discover({ formats: ["pop-up"], location: "New York", q: "bees" }).then((r) => r.length <= 2), true);
});

test("existing behavior: Events without Formats are found normally; Category filtering unchanged", async () => {
  const all = await discover({});
  assert.deepEqual(all, ["ai-conf", "bees", "no-formats", "sample-sale-fashion"]);
  assert.deepEqual(await discover({ category: "beauty-wellness" }), ["bees"]);
  assert.deepEqual(await discover({ category: "skincare" }), ["bees"]);
  assert.deepEqual(await discover({ category: "market" }), ["no-formats"]);
});

test("/events: Format lives in the existing filter sheet (not top-level tabs), restores from the URL, and shows chips", () => {
  const page = read("src/app/(public)/events/page.tsx");
  assert.match(page, /getEventFormatOptions\(\)/);
  assert.match(page, /const formatChoices = formatOptions\.formats\.filter\(\(f\) => formatOptions\.usedIds\.includes\(f\.id\) \|\| selectedFormats\.includes\(f\.slug\)\);/);
  assert.match(page, /formats=\{formatChoices\}\n\s+defaultFormats=\{selectedFormats\}/);
  assert.doesNotMatch(page, /EVENT_FORMAT_V1/, "no hard-coded Format tabs");
  const filters = read("src/components/discover/EventFilters.tsx");
  assert.match(filters, /<input type="checkbox" name="format" value=\{f\.slug\} defaultChecked=\{defaultFormats\.includes\(f\.slug\)\}/);
  // getEventFormatOptions only offers Formats on a discoverable (non-demo, not-ended) Event.
  // Event date/time precision: "not ended" also keeps an Event with no
  // published end through its calendar end date (eventUpcomingOr).
  assert.match(read("src/lib/data.ts"), /supabase\.from\("events"\)\.select\("id"\)\.eq\("is_demo", false\)\.or\(eventUpcomingOr\(new Date\(\)\.toISOString\(\), todayIn\(APP_TIMEZONE\)\)\)/);
});
