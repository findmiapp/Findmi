// Findmi Consolidation — Good Organics regression. The ORIGINAL production
// state, reproduced in memory (production is never touched):
//   Business A hosts published Event X via events.host_business_id only —
//   NO event_businesses row for A, NO Appearance for A / X.
// Hosting alone must connect A to X everywhere; the host is never a
// participant of its own Event; Business B participates normally.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return js("export{}");
    if (specifier === "./supabase" && context.parentURL?.endsWith("/src/lib/data.ts")) return js("export function getSupabase(){return globalThis.__DB}");
    // Side-effect writers the participation helper calls — recorded, never real.
    if (specifier === "./opportunities" && context.parentURL?.endsWith("/event-participation.ts")) return js("export async function createOpportunity(){ (globalThis.__SIDE ??= []).push('opportunity') }");
    if (specifier === "./appearance-event-sync" && context.parentURL?.endsWith("/event-participation.ts")) return js("export async function ensureEventAppearance(){ (globalThis.__SIDE ??= []).push('appearance') }");
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
const R = await import("../src/lib/event-roles.ts");
const EP = await import("../src/lib/event-participation.ts");
const read = (f) => readFileSync(f, "utf8");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const X = "eeeeeeee-0000-4000-8000-000000000010";
const Y = "eeeeeeee-0000-4000-8000-000000000011";
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString();

function originalState() {
  const event = (id, name, publication_status, is_demo) => ({
    id, slug: name.toLowerCase().replace(/\s+/g, "-"), name, host_business_id: A, publication_status, is_demo,
    start_at: inDays(3), end_at: inDays(3.1), venue_name: "Pop Up Grocer", address: "205 Bleecker St", city: "New York", state: "NY",
    cover_image_url: null, is_featured: false, archived_at: null, trashed_at: null, location_visibility: "public",
  });
  return {
    businesses: [
      { id: A, name: "Good Organics", slug: "good-organics", is_demo: false, publication_status: "live" },
      { id: B, name: "Partner Brand", slug: "partner-brand", is_demo: false, publication_status: "live" },
    ],
    events: [event(X, "Good Organics Sampling", "live", false), event(Y, "Pending Tasting", "pending_review", true)],
    event_businesses: [],
    event_occurrence_businesses: [],
    event_occurrences: [],
    appearances: [],
  };
}
const noHostRows = (t) => {
  assert.equal(t.event_businesses.filter((r) => r.business_id === A).length, 0, "no participant row manufactured for the host");
  assert.equal(t.appearances.filter((r) => r.business_id === A).length, 0, "no Appearance manufactured for the host");
};

test("fixture: the original state really is host-only", () => {
  const t = originalState();
  assert.ok(t.events.every((e) => e.host_business_id === A));
  noHostRows(t);
});

test("1 + 9. Business Manager schedule reads hosted Events from host_business_id with the service role — pending ones too (private)", () => {
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  const q = page.slice(page.indexOf('.select("id, name, slug, start_at, end_at, start_date, end_date, venue_name, city, state, is_demo, publication_status, cover_image_url")'));
  assert.match(q, /^\.select\([^)]*\)\n\s+\.eq\("host_business_id", id\)\n\s+\.is\("trashed_at", null\)/, "no participation / publication filter: every hosted Event, privately");
});

test("2. public profile / Findmi Here: hosted, published Event X shows solely because A hosts it; pending Y never does", async () => {
  const tables = originalState();
  globalThis.__DB = fakeDb(tables);
  const activity = await D.getBusinessFindmiHereActivity(A);
  const ids = activity.upcoming.map((r) => r.event_id);
  assert.deepEqual(ids, [X], "Event X — and not the pending Event");
  assert.equal(activity.upcoming[0].derived, true, "derived from hosting, no Appearance row");
  assert.equal(activity.upcoming[0].event.slug, "good-organics-sampling");
  noHostRows(tables);
  // The Business-scoped shared Event filter has always counted hosting.
  assert.match(read("src/lib/data.ts"), /supabase\.from\("events"\)\.select\("id"\)\.eq\("host_business_id", options\.businessId\)/);
});

test("3 + 4. Event Manager → Businesses: A is HOST / already connected, out of the roster and out of invite candidates", () => {
  assert.equal(R.businessEventRole({ hostBusinessId: A, businessId: A, participantStatus: null }), "host");
  assert.equal(R.businessEventRole({ hostBusinessId: A, businessId: A, participantStatus: "approved" }), "host", "host wins over a (hand-made) participant row");
  assert.deepEqual(R.participantsExcludingHost([{ business_id: A }, { business_id: B }], A), [{ business_id: B }]);
  assert.deepEqual(R.inviteExclusionIds(A, [B]), [A, B]);
  assert.deepEqual(R.inviteExclusionIds(null, [B]), [B]);
  const page = read("src/app/(public)/account/event/[id]/page.tsx");
  assert.match(page, /const participants = participantsExcludingHost\(result\.participants, hostBusinessId\);/);
  assert.match(page, /excludeIds=\{inviteExclusionIds\(hostBusinessId, result\.participants\.map\(\(p\) => p\.business_id\)\)\}/);
  assert.match(page, /Hosting this Event · already connected/);
  assert.match(page, /\{EVENT_ROLE_LABELS\.host\}/);
});

test("5. A can't invite itself: the ONE invite write refuses the host before any write", () => {
  const a = read("src/app/(public)/account/event/actions.ts");
  const core = a.slice(a.indexOf("async function inviteBusinessToEvent("));
  const guard = core.indexOf("if (isEventHost(");
  assert.ok(guard > 0 && guard < core.indexOf('.from("event_businesses")'), "guard precedes the participant write");
  assert.match(core, /return HOST_ALREADY_CONNECTED;/);
  // Admin roster + per-date vendor adds follow the same rule.
  const admin = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(admin, /\.filter\(\(businessId\) => !isEventHost\(eventHostId, businessId\)\)/);
  assert.match(admin, /redirect\(errorRedirectUrl\(`\/admin\/events\/\$\{eventId\}`, HOST_ALREADY_CONNECTED\)\)/);
});

test("6 + 7. A can't apply to its own Event — nothing is written, nothing manufactured", async () => {
  const tables = originalState();
  globalThis.__SIDE = [];
  const db = fakeDb(tables);
  assert.equal(await EP.applyBusinessToEvent(db, { eventId: X, businessId: A, userId: "u1" }), "is_host");
  noHostRows(tables);
  assert.deepEqual(globalThis.__SIDE, [], "no Opportunity, no Appearance");
  // Every other join path refuses the host too.
  assert.match(read("src/app/(public)/connect/actions.ts"), /if \(isEventHost\(\(event as \{ host_business_id: string \| null \}\)\.host_business_id, actingBusinessId\)\) return \{ error: HOST_ALREADY_CONNECTED \};/);
  const biz = read("src/app/(public)/account/business/actions.ts");
  assert.match(biz, /if \(result === "is_host"\) redirect\(appendQuery\(redirectPath, \{ error: HOST_ALREADY_CONNECTED \}\)\);/);
  assert.match(biz, /if \(isEventHost\(occHost, businessId\)\) redirect/);
  assert.match(read("src/lib/event-import/persist.ts"), /result === "already_approved" \|\| result === "is_host"/, "importing your own hosted Event = already on your schedule");
});

test("8. Business B participates normally; HOST and PARTICIPANT stay distinct on the public Event page", async () => {
  const tables = originalState();
  globalThis.__SIDE = [];
  const db = fakeDb(tables);
  assert.equal(await EP.applyBusinessToEvent(db, { eventId: X, businessId: B, userId: "u2" }), "applied");
  assert.equal(tables.event_businesses.find((r) => r.business_id === B)?.status, "applied");
  // Organizer approves B; a hand-made approved row for A (the old
  // workaround) also exists — the public roster lists B only.
  tables.event_businesses.find((r) => r.business_id === B).status = "approved";
  tables.event_businesses.push({ event_id: X, business_id: A, status: "approved", featured: false, display_order: null });
  globalThis.__DB = fakeDb(tables);
  const roster = await D.getBusinessesForEvent(X);
  assert.deepEqual(roster.map((b) => b.id), [B]);
  assert.equal(R.businessEventRole({ hostBusinessId: A, businessId: B, participantStatus: "approved" }), "participant");
  // B's own profile shows X through participation.
  const activityB = await D.getBusinessFindmiHereActivity(B);
  assert.deepEqual(activityB.upcoming.map((r) => r.event_id), [X]);
});

test("9. pending_review Event: never public for the host (activity filter), visible privately via the manager schedule", async () => {
  const tables = originalState();
  tables.events = tables.events.filter((e) => e.id === Y);
  globalThis.__DB = fakeDb(tables);
  assert.deepEqual((await D.getBusinessFindmiHereActivity(A)).upcoming, []);
  const data = read("src/lib/data.ts");
  assert.match(data, /\.eq\("host_business_id", businessId\)\n\s+\.eq\("publication_status", "live"\)\n\s+\.eq\("is_demo", false\)/);
});
