// Admin Event Import — the founder/operator entry to the ONE Event Import
// engine (/admin/events/import). No initiating Business: every Event is
// reviewed in the existing several-Events Review with its OWN Business (or
// none) and saved as a host-less source Event. Fakes only — no network, no
// database, no AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};", shortCircuit: true };
    // The Admin session check: a test sets globalThis.__ADMIN to the client
    // a verified session would return; unset = no Admin session (throws,
    // exactly like the real requireAdminSupabase).
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const E = await import("../src/lib/event-import/engine.ts");
const O = await import("../src/lib/event-import/operator.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const IP = await import("../src/lib/places/inline-place.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");
const DIR = "src/app/admin/(protected)/events/import";
const PAGE = read(`${DIR}/page.tsx`);
const CLIENT = read(`${DIR}/AdminEventImporter.tsx`);
const ACTIONS = read(`${DIR}/actions.ts`);
const BIZ_ACTIONS = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
const BIZ_PAGE = read("src/app/(public)/account/business/[id]/import-event/page.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");
const MIDDLEWARE = read("src/middleware.ts");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const BIZ = {
  "Good American": "11111111-1111-4111-8111-111111111111",
  Knix: "22222222-2222-4222-8222-222222222222",
  "MGA Entertainment": "33333333-3333-4333-8333-333333333333",
};
function deps(over = {}) {
  const calls = { rate: 0, organizers: [] };
  return {
    calls,
    fetchPage: async () => {
      throw new Error("never fetched");
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async (v) => (v.name === "LAVAN Chelsea" ? [{ id: "loc-lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001" }] : []),
    // The existing organizer matcher: a confident match only for a real Business name.
    matchOrganizer: async (name) => (calls.organizers.push(name), BIZ[name] ? { id: BIZ[name], name } : null),
    matchExistingAppearance: async () => {
      throw new Error("no initiating Business — never looked up");
    },
    findScheduledBySourceUrl: async () => {
      throw new Error("no initiating Business — never looked up");
    },
    findEventBySourceUrl: async () => null,
    isRateLimited: () => ((calls.rate += 1), false),
    now: () => NOW,
    ...over,
  };
}

const EV = {
  goodAmerican: `Good American NYC Pop-Up\nHosted by Good American\n\nOctober 15, 2026\n11 AM–7 PM\n\nThe Glasshouse\n660 12th Avenue\nNew York, NY`,
  knix: `Knix x ACOTAR Pop-Up\nHosted by Knix\n\nOctober 17, 2026\n12 PM–8 PM\n\nLAVAN Chelsea\n541 W 25th St\nNew York, NY`,
  miniverse: `Miniverse: Take a Mini Break\nPresented by MGA Entertainment\n\nOctober 20, 2026\n10 AM–6 PM\n\nPier 57\n25 11th Ave\nNew York, NY`,
};
const paste = (...bodies) => bodies.map((b, i) => `EVENT ${i + 1}\n\n${b}\n\n=== END EVENT ${i + 1} ===`).join("\n\n");
const PASTED = { url: "", name: "Pasted Details", platform: null };
const analyzeAsAdmin = async (text, d = deps()) => O.asOperatorAnalysis(await E.analyzeEventText({ text, businessId: null, rateKey: "admin:event-import" }, d), PASTED);

/** A recording Supabase fake: every write is logged; inserts hand back ids. */
function fakeClient({ businesses = Object.values(BIZ) } = {}) {
  const ops = [];
  const client = {
    ops,
    rpc: async (name) => (ops.push({ table: `rpc:${name}`, kind: "rpc" }), { data: null, error: { message: "not used" } }),
    from(table) {
      let filterId = null;
      const done = (data) => ({ data, error: null });
      const chain = {
        select: () => chain,
        eq: (col, v) => ((col === "id" ? (filterId = v) : null), chain),
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        or: () => chain,
        ilike: () => chain,
        limit: () => chain,
        order: () => chain,
        maybeSingle: async () => done(table === "businesses" && businesses.includes(filterId) ? { id: filterId } : null),
        then: (res) => res(done([])),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          const n = ops.filter((o) => o.table === table && o.kind === "insert").length;
          return {
            select: () => ({
              single: async () => done({ id: `${table}-${n}`, ...rows[0] }),
              then: (cb) => cb(done(rows.map((_, i) => ({ id: `${table}-${n}-${i}` })))),
            }),
            then: (cb) => cb({ error: null }),
          };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: Array.isArray(row) ? row : [row] }), Promise.resolve({ error: null })),
        update: (patch) => {
          ops.push({ table, kind: "update", rows: [patch] });
          const c = { eq: () => c, select: () => c, maybeSingle: async () => done(null), then: (cb) => cb({ error: null }) };
          return c;
        },
        delete: () => {
          ops.push({ table, kind: "delete" });
          return chain;
        },
      };
      return chain;
    },
  };
  return client;
}
const reviewsOf = (analysis) => analysis.events.map((e) => ({ key: e.key, review: O.operatorReviewDefaults(e.candidate, e.matches), business: O.suggestedEventBusiness(e.matches) }));

// ── ROUTE + AUTHORIZATION ─────────────────────────────────────────────────

test("A. /admin/events/import exists under the protected Admin shell, reachable from Admin → Events", () => {
  assert.ok(existsSync(`${DIR}/page.tsx`), "route: src/app/admin/(protected)/events/import");
  assert.match(PAGE, /if \(!\(await isAdminSession\(\)\)\) redirect\("\/admin\/login"\);/, "an Admin session renders the importer");
  assert.match(PAGE, /<AdminEventImporter categories=\{categories\} formats=\{formats\} businessCategories=\{businessCategories\} locationCategories=\{locationCategories\} \/>/);
  assert.match(PAGE, /export const maxDuration = 60;/);
  assert.match(read("src/app/admin/(protected)/events/page.tsx"), /href="\/admin\/events\/import"[\s\S]{0,200}Import Events/, "entry on the Admin Events list");
});

test("B. without an Admin session: the page redirects, middleware guards /admin, and every action refuses before reading or writing", async () => {
  globalThis.__ADMIN = undefined;
  assert.match(MIDDLEWARE, /matcher: \["\/admin\/:path\*"/);
  assert.match(MIDDLEWARE, /if \(pathname\.startsWith\("\/admin"\)\)/);
  const d = deps();
  assert.deepEqual(await A.adminAnalyzeEventText(paste(EV.goodAmerican, EV.knix)), { ok: false, code: "server" });
  assert.deepEqual(await A.adminAnalyzeEventUrl("https://example.com/e"), { ok: false, code: "server" });
  const form = new FormData();
  form.set("name", "The Glasshouse");
  assert.equal((await A.adminCreateImportLocation(form)).status, "error");
  const commit = await A.adminCommitEventImportBatch([{ review: { title: "x" }, businessId: null }]);
  assert.equal(commit.ok, false);
  assert.equal(d.calls.rate, 0);
  // Every action goes through the one Admin session primitive, never Business membership.
  assert.equal((ACTIONS.match(/await requireAdminSupabase\(\)/g) ?? []).length, 1, "one shared gate (adminClient)");
  for (const fn of ["adminAnalyzeEventText", "adminAnalyzeEventUrl", "adminCreateImportLocation", "adminCommitEventImportBatch"]) {
    const body = ACTIONS.slice(ACTIONS.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 400), /const admin = await adminClient\(\);\n\s+if \(!admin\) return/, `${fn} checks the Admin session first`);
  }
  assert.doesNotMatch(ACTIONS, /requireBusinessMember|@\/lib\/permissions/);
});

test("C. Business Event Import authorization is unchanged (membership re-derived per call)", () => {
  assert.match(BIZ_ACTIONS, /async function authorize\(businessId: string\) \{\n\s+try \{\n\s+await requireBusinessMember\(businessId\);/);
  for (const fn of ["analyzeEventImport", "analyzeEventImportText", "analyzeEventImportImage", "commitEventImport", "commitEventImportBatch"]) {
    const body = BIZ_ACTIONS.slice(BIZ_ACTIONS.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 300), /const ctx = await authorize\(businessId\);/, `${fn} still authorizes the Business`);
  }
  assert.match(BIZ_PAGE, /await requireBusinessMember\(id\);/);
  // The member Quick Create still requires a signed-in member of something.
  const fn = LOC_ACTIONS.slice(LOC_ACTIONS.indexOf("export async function createInlinePlace"));
  assert.match(fn, /if \(!user\) return \{ status: "error", error: "You need to be signed in to add a place\." \};/);
  assert.match(fn, /if \(!businessCount && !eventCount && !locationCount\) \{/);
});

// ── ANALYSIS ──────────────────────────────────────────────────────────────

test("D. Admin can paste ONE Event → a one-row Review list (no Business lookups)", async () => {
  const d = deps();
  const r = await analyzeAsAdmin(EV.goodAmerican, d);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "multi");
  assert.deepEqual(r.source, PASTED);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].candidate.title, "Good American NYC Pop-Up");
  assert.equal(r.events[0].alreadyOnSchedule, null);
  assert.equal(d.calls.rate, 1);
  // Failures pass through untouched (same copy as every importer).
  assert.deepEqual(O.asOperatorAnalysis({ ok: false, code: "text_no_event" }, PASTED), { ok: false, code: "text_no_event" });
  assert.match(ACTIONS, /analyzeEventText\(\{ text: typeof text === "string" \? text : "", businessId: null, rateKey: ADMIN_RATE_KEY, structured: true \}/);
  assert.match(ACTIONS, /analyzeEventUrl\(\{ url: link, businessId: null, rateKey: ADMIN_RATE_KEY \}/);
});

test("E. Admin pastes 3 explicitly separated Events → 3 Review candidates (multi-paste reused)", async () => {
  const d = deps();
  const r = await analyzeAsAdmin(paste(EV.goodAmerican, EV.knix, EV.miniverse), d);
  assert.equal(r.kind, "multi");
  assert.deepEqual(r.events.map((e) => e.candidate.title), ["Good American NYC Pop-Up", "Knix x ACOTAR Pop-Up", "Miniverse: Take a Mini Break"]);
  assert.equal(d.calls.rate, 1);
  assert.match(CLIENT, /maxLength=\{PASTE_MAX\}/);
  assert.match(CLIENT, /const PASTE_MAX = 60000;/);
  // Malformed marking keeps its failure code + detail (passed through untouched).
  const bad = await analyzeAsAdmin(`EVENT 1\n\n${EV.knix}\n\nEVENT 2\n\n${EV.miniverse}\n\n=== END EVENT 2 ===`);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "paste_malformed");
  assert.match(bad.detail, /EVENT 1/);
});

test("F. three Events, three different Businesses — each matched on its own, no batch-wide Business", async () => {
  const d = deps();
  const r = await analyzeAsAdmin(paste(EV.goodAmerican, EV.knix, EV.miniverse), d);
  assert.deepEqual(d.calls.organizers, ["Good American", "Knix", "MGA Entertainment"]);
  const rows = reviewsOf(r);
  assert.deepEqual(rows.map((x) => x.business?.name), ["Good American", "Knix", "MGA Entertainment"]);
  // Unmatched organizer → unresolved (null), never a guess.
  const unknown = await analyzeAsAdmin(EV.goodAmerican.replace("Hosted by Good American", "Hosted by Someone Unknown"));
  assert.equal(O.suggestedEventBusiness(unknown.events[0].matches), null);
  assert.equal(unknown.events[0].candidate.organizer, "Someone Unknown", "kept as organizer text only");

  globalThis.__ADMIN = fakeClient();
  const res = await A.adminCommitEventImportBatch(rows.map((x) => ({ review: x.review, businessId: x.business?.id ?? null })));
  assert.equal(res.ok, true);
  assert.ok(res.results.every((x) => x.outcome.ok && x.outcome.kind === "scheduled" && x.outcome.newEvent));
  const ops = globalThis.__ADMIN.ops;
  const events = ops.filter((o) => o.table === "events" && o.kind === "insert").map((o) => o.rows[0]);
  const roster = ops.filter((o) => o.table === "event_businesses" && o.kind === "upsert").map((o) => o.rows[0]);
  assert.equal(events.length, 3);
  assert.deepEqual(roster.map((x) => [x.event_id, x.business_id]), [
    ["events-1", BIZ["Good American"]],
    ["events-2", BIZ.Knix],
    ["events-3", BIZ["MGA Entertainment"]],
  ]);
  assert.ok(roster.every((x) => x.status === "approved" && x.participation_scope === "all_dates"), "the existing participation relationship");
  globalThis.__ADMIN = undefined;
});

test("G. Admin import never makes Findmi, the Admin, or an arbitrary Business the host or owner", async () => {
  const r = await analyzeAsAdmin(paste(EV.goodAmerican, EV.miniverse.replace("Presented by MGA Entertainment", "Presented by Nobody We Know")));
  const rows = reviewsOf(r);
  globalThis.__ADMIN = fakeClient();
  const res = await A.adminCommitEventImportBatch([
    { review: { ...rows[0].review, intent: "hosting" }, businessId: rows[0].business.id },
    { review: rows[1].review, businessId: null },
  ]);
  assert.equal(res.ok, true);
  const ops = globalThis.__ADMIN.ops;
  const events = ops.filter((o) => o.table === "events" && o.kind === "insert").map((o) => o.rows[0]);
  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.equal(ev.host_business_id, null);
    assert.equal(ev.is_demo, false);
    assert.equal(ev.publication_status, "live");
    assert.doesNotMatch(String(ev.organizer_name ?? ""), /findmi|admin/i);
  }
  assert.equal(events[0].organizer_name, "Good American", "the source's organizer, as text");
  assert.ok(!ops.some((o) => o.table.startsWith("rpc:")), "never create_owned_event (owner membership)");
  assert.ok(!ops.some((o) => /members$/.test(o.table)), "no membership of any kind");
  const roster = ops.filter((o) => o.table === "event_businesses");
  assert.equal(roster.length, 1, "the unmatched Event is saved unassociated");
  assert.equal(roster[0].rows[0].event_id, "events-1");
  // An unknown / malformed Business id is refused, never attached.
  globalThis.__ADMIN = fakeClient();
  const bad = await A.adminCommitEventImportBatch([
    { review: rows[0].review, businessId: "44444444-4444-4444-8444-444444444444" },
    { review: rows[0].review, businessId: "not-a-uuid" },
  ]);
  assert.deepEqual(bad.results.map((x) => x.outcome.ok), [false, false]);
  assert.equal(globalThis.__ADMIN.ops.length, 0, "nothing written");
  globalThis.__ADMIN = undefined;
});

test("G2. an Event already on Findmi (confirmed match or same source link) is never duplicated or re-assigned", async () => {
  const client = fakeClient();
  const deps = { admin: client, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "e", propagateDates: async () => {}, findEventBySourceUrl: async () => ({ id: "ev-existing" }) };
  const base = { intent: "participating", title: "T", description: null, imageUrl: null, sourceUrl: "https://example.com/e", occurrences: [{ start: "2026-10-15T15:00:00.000Z", end: "2026-10-15T23:00:00.000Z", place: { name: null, address: null, city: null, state: null, postalCode: null, locationId: null } }], useEventId: null, asEvent: true, organizer: null, attendance: null, locationVisibility: null, categoryId: null, formatIds: [] };
  assert.deepEqual(await P.persistDiscoveryEvent(base, BIZ.Knix, deps), { ok: true, kind: "already", title: "T", viewHref: "/admin/events/ev-existing" });
  const confirmed = await P.persistDiscoveryEvent({ ...base, sourceUrl: null, useEventId: "aaaaaaaa-0000-4000-8000-000000000001" }, BIZ.Knix, deps);
  assert.equal(confirmed.kind, "already");
  assert.equal(client.ops.length, 0);
});

// ── REVIEW: LOCATIONS, QUICK CREATE, CATEGORY / FORMAT ────────────────────

test("H. existing Location matching still works per Event in the Admin flow", async () => {
  const r = await analyzeAsAdmin(paste(EV.goodAmerican, EV.knix));
  assert.deepEqual(r.events[0].matches.locations, []);
  assert.equal(r.events[1].matches.locations[0].id, "loc-lavan");
  const review = O.operatorReviewDefaults(r.events[1].candidate, r.events[1].matches);
  assert.equal(review.place.useLocationId, "loc-lavan", "strong match pre-selected, exactly as for a Business");
  globalThis.__ADMIN = fakeClient();
  await A.adminCommitEventImportBatch([{ review, businessId: null }]);
  const occ = globalThis.__ADMIN.ops.find((o) => o.table === "event_occurrences").rows[0];
  assert.equal(occ.event_id, "events-1");
  globalThis.__ADMIN = undefined;
});

test("I. Quick Create works through the Admin flow — same rules, Admin-session gate, Business auth not weakened", async () => {
  // Wiring: the Admin Review passes its own create action into the existing Quick Create.
  assert.match(MULTI, /quickCreate=\{\{ online: Boolean\(e\.candidate\.online\), onCreated: onLocationCreated, createAction: operator\?\.createLocation, render: operator\?\.renderLocationCreate \}\}/);
  assert.match(CLIENT, /createLocation: async \(form\) => \{\n\s+const result = await adminCreateImportLocation\(form\);/);
  // Location Import V1: Admin creation goes through lib/location-import,
  // which inserts through the SAME unlisted core as member Quick Create.
  assert.match(ACTIONS, /return createImportedLocation\(/);
  assert.match(read("src/lib/location-import/server.ts"), /await insertUnlistedPlace\(admin, \{ name, address, city, state, postalCode, force: opts\.force === true, profile: profileOf\(input, categoryIds\) \}\);/);
  assert.match(LOC_ACTIONS, /return insertInlinePlace\(admin, formData\);/, "member path shares the same core");
  // Same rules: address required; likely duplicate offered (nothing inserted); unlisted on create.
  globalThis.__ADMIN = fakeClient();
  const thin = new FormData();
  thin.set("name", "The Glasshouse");
  assert.equal((await A.adminCreateImportLocation(thin)).status, "error");
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: "The Glasshouse", address: "660 12th Avenue", city: "New York", state: "NY" })) form.set(k, v);
  const created = await A.adminCreateImportLocation(form);
  assert.equal(created.status, "created");
  const ins = globalThis.__ADMIN.ops.find((o) => o.table === "locations" && o.kind === "insert").rows[0];
  assert.equal(ins.is_demo, true, "unlisted, exactly like member Quick Create");
  assert.ok(!globalThis.__ADMIN.ops.some((o) => /members$|business_locations/.test(o.table)), "no membership, no Business link");
  globalThis.__ADMIN = undefined;
  assert.equal(typeof IP.insertInlinePlace, "function");
});

test("J. Category and Format Review stay available (every Admin Event is a genuine Event)", async () => {
  const r = await analyzeAsAdmin(EV.goodAmerican);
  const review = O.operatorReviewDefaults(r.events[0].candidate, r.events[0].matches);
  assert.equal(review.asEvent, true);
  assert.equal(review.intent, "participating");
  assert.match(MULTI, /\{\(!joining \|\| operator\) && \(review\.intent === "hosting" \|\| review\.asEvent\) && <EventCategoryEditor categories=\{categories\} review=\{review\} set=\{set\} \/>\}/);
  assert.match(MULTI, /\{\(!joining \|\| operator\) && \(review\.intent === "hosting" \|\| review\.asEvent\) && <EventFormatEditor formats=\{formats\} review=\{review\} set=\{set\} \/>\}/);
  // The reviewed category goes through the same new-Event save path (writeEventCategory).
  const cat = "cccccccc-0000-4000-8000-000000000001";
  globalThis.__ADMIN = fakeClient();
  await A.adminCommitEventImportBatch([{ review: { ...review, categoryId: cat }, businessId: null }]);
  assert.ok(globalThis.__ADMIN.ops.some((o) => o.table === "events" && o.kind === "insert"));
  globalThis.__ADMIN = undefined;
  assert.match(CLIENT, /categories=\{categories\}\n\s+formats=\{formats\}\n\s+operator=\{operator\}/);
});

test("Review shows each Event's Business before saving; the Business picker is per Event", () => {
  assert.match(MULTI, /\{joining \? "Already on Findmi" : businessFor\[e\.key\] \? `Business: \$\{businessFor\[e\.key\]!\.name\}` : "No Business Linked"\}/);
  assert.match(MULTI, /businessId: businessFor\[e\.key\]\?\.id \?\? null/);
  assert.match(CLIENT, /<RelationField[\s\S]{0,200}entity="businesses"/);
  // The Business importer still never shows the picker (operator-only).
  assert.match(MULTI, /\{operator \? \(\n\s+\(\n\s+<div>\n\s+\{operator\.renderBusinessPicker\(/);
});

test("Business importer persistence is unchanged by the shared createSourceEvent refactor", async () => {
  const client = fakeClient();
  const calls = [];
  const deps = {
    admin: client, userId: "u", businessId: BIZ.Knix, businessName: "Knix",
    applyToEvent: async () => "approved_now", canHost: async () => true, storeImage: async () => null, geography: async () => null,
    uniqueEventSlug: async () => "knix", notifyNewEvent: async (...a) => calls.push(["notify", ...a]), propagateDates: async (...a) => calls.push(["propagate", ...a]), findEventBySourceUrl: async () => null,
  };
  const input = { intent: "participating", title: "Knix", description: null, imageUrl: null, sourceUrl: null, occurrences: [{ start: "2026-10-17T16:00:00.000Z", end: "2026-10-18T00:00:00.000Z", place: { name: "LAVAN", address: null, city: "New York", state: "NY", postalCode: null, locationId: null } }], useEventId: null, asEvent: true, organizer: null, attendance: null, locationVisibility: null, categoryId: null, formatIds: [] };
  const out = await P.persistEventImport(input, deps);
  assert.deepEqual(out, { ok: true, kind: "scheduled", title: "Knix", viewHref: `/account/business/${BIZ.Knix}?tab=findmi-here`, newEvent: true });
  assert.equal(client.ops.find((o) => o.table === "event_businesses").rows[0].business_id, BIZ.Knix);
  assert.deepEqual(calls.map((c) => c[0]), ["propagate", "notify"]);
});
