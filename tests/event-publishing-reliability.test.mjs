// Event publishing / Business Manager / Findmi Here reliability pass — one
// regression per root cause:
//   1. View Event after creation (success states, Hosting rows, Event Manager)
//   2. Admin operating a Business can host / publish (no fabricated ownership)
//   3 + 5. One Event-artwork model: detected / flyer / upload / none, the same
//      upload path for Business and Admin import
//   4. Participating Businesses after creation (Business + Admin)
//   6. Business schedule map: in-context (unlisted) Locations; actionable gaps
//   7. View On Map keeps the Business scope
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier === "react") return { url: "data:text/javascript,export const cache=(f)=>f", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const H = await import("../src/lib/event-hosting.ts");
const P = await import("../src/lib/event-import/persist.ts");
const M = await import("../src/lib/event-import/media.ts");
const SM = await import("../src/lib/schedule-map.ts");

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const BIZ_IMPORT_ACTIONS = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
const BIZ_IMPORTER = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const ADMIN_IMPORT_ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");
const ADMIN_IMPORTER = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const EVENT_ACTIONS = read("src/app/(public)/account/event/actions.ts");
const EVENT_NEW = read("src/app/(public)/account/event/new/page.tsx");
const EVENT_MANAGER = read("src/app/(public)/account/event/[id]/page.tsx");
const BIZ_MANAGER = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const GEO = read("src/lib/geo-results-server.ts");
const CONTEXT_MAP = read("src/components/map/ContextMap.tsx");
const SCHEDULE = read("src/components/AppearanceFindMiHere.tsx");
const PERMISSIONS = read("src/lib/permissions.ts");

const ALPYN = { id: "b-alpyn", name: "Alpyn Beauty" };
/** fakeDb + upsert (provenance / participation writes) as a plain insert. */
const db = (tables, newId) => {
  const base = fakeDb(tables, newId);
  return { ...base, from: (t) => Object.assign(base.from(t), { upsert(payload) { return this.insert(payload); } }) };
};
const elig = (result) => async () => result;

// ------------------------------------------------------------ 2. hosting authority

test("2. hosting authority: real Owner/Manager first; Admin Manage-As only as the fallback; nobody else", async () => {
  const admin = fakeDb({ businesses: [{ ...ALPYN }] });
  const owner = await H.getHostAuthority(admin, "u-owner", ALPYN.id, { eligibility: elig({ ok: true, business: ALPYN }), isAdminSession: async () => true });
  assert.deepEqual(owner, { ok: true, business: ALPYN, viaAdmin: false }, "a genuine owner is never routed through the Admin path");

  const asAdmin = await H.getHostAuthority(admin, "u-founder", ALPYN.id, { eligibility: elig({ ok: false, reason: "not_member", business: ALPYN }), isAdminSession: async () => true });
  assert.deepEqual(asAdmin, { ok: true, business: ALPYN, viaAdmin: true });

  const stranger = await H.getHostAuthority(admin, "u-x", ALPYN.id, { eligibility: elig({ ok: false, reason: "not_member", business: ALPYN }), isAdminSession: async () => false });
  assert.deepEqual(stranger, { ok: false, reason: "not_member", business: ALPYN }, "ordinary users gain nothing");

  const staff = await H.getHostAuthority(admin, "u-staff", ALPYN.id, { eligibility: elig({ ok: false, reason: "role", business: ALPYN }), isAdminSession: async () => false });
  assert.equal(staff.ok, false, "staff still can't host");

  const noUser = await H.getHostAuthority(admin, null, ALPYN.id, { eligibility: elig({ ok: true, business: ALPYN }), isAdminSession: async () => true });
  assert.equal(noUser.ok && noUser.viaAdmin, true, "an Admin-only session (no Findmi account) operates as Admin");
  const missing = await H.getHostAuthority(admin, null, "nope", { eligibility: elig({ ok: true, business: null }), isAdminSession: async () => true });
  assert.equal(missing.ok, false, "never for a Business that doesn't exist");
});

test("2. Admin-managed hosted Event: published, hosted by the Business, NO event_members row, audited", async () => {
  const tables = { businesses: [{ ...ALPYN }], markets: [{ id: "m-nyc", active: true }], events: [], event_members: [], admin_audit_events: [] };
  const admin = fakeDb(tables, "ev-new");
  const out = await H.createHostedEvent(admin, { userId: "u-founder", viaAdmin: true, name: "Alpyn Glow Night", slug: "alpyn-glow-night", startAt: "2026-11-05T22:00:00.000Z", endAt: "2026-11-06T01:00:00.000Z", marketId: "m-nyc", hostBusinessId: ALPYN.id });
  assert.deepEqual(out, { ok: true, id: "ev-new", viaAdmin: true });
  assert.equal(tables.events.length, 1);
  assert.equal(tables.events[0].host_business_id, ALPYN.id);
  assert.equal(tables.events[0].is_demo, false);
  assert.equal(tables.events[0].publication_status, "live");
  assert.equal(tables.event_members.length, 0, "no ownership is fabricated for the Admin");
  assert.equal(tables.admin_audit_events[0].action, "manage_as_host_event_create");
  assert.equal(tables.admin_audit_events[0].actor_kind, "admin");
  assert.equal(tables.admin_audit_events[0].target_id, ALPYN.id);

  const bad = (o) => H.createHostedEvent(fakeDb({ businesses: [{ ...ALPYN }], markets: [] }), { userId: null, viaAdmin: true, name: "X", slug: "x", startAt: "2026-11-05T22:00:00.000Z", endAt: "2026-11-06T01:00:00.000Z", marketId: null, hostBusinessId: ALPYN.id, ...o });
  assert.equal((await bad({ endAt: "2026-11-05T21:00:00.000Z" })).code, "invalid_end", "same validation as create_owned_event");
  assert.equal((await bad({ name: " " })).code, "name_required");
  assert.equal((await bad({ marketId: "m-gone" })).code, "invalid_market");
  assert.equal((await bad({ hostBusinessId: "nope" })).code, "host_not_authorized");
});

test("2. a real Owner/Manager keeps the exact create_owned_event path (it re-checks membership + makes them owner)", async () => {
  const calls = [];
  const admin = { rpc: async (name, args) => (calls.push([name, args]), { data: { id: "ev-own" }, error: null }) };
  const out = await H.createHostedEvent(admin, { userId: "u-owner", viaAdmin: false, name: "N", slug: "n", startAt: "2026-11-05T22:00:00.000Z", endAt: "2026-11-06T01:00:00.000Z", marketId: null, hostBusinessId: ALPYN.id });
  assert.deepEqual(out, { ok: true, id: "ev-own", viaAdmin: false });
  assert.equal(calls[0][0], "create_owned_event");
  assert.equal(calls[0][1].p_user_id, "u-owner");
  assert.equal(calls[0][1].p_host_business_id, ALPYN.id);
  const denied = await H.createHostedEvent({ rpc: async () => ({ data: null, error: { message: "host_not_authorized" } }) }, { userId: "u-x", viaAdmin: false, name: "N", slug: "n", startAt: "a", endAt: "b", marketId: null, hostBusinessId: ALPYN.id });
  assert.deepEqual(denied, { ok: false, code: "host_not_authorized" }, "the database still refuses a non-member");
});

test("2. every hosting entry point uses the shared authority; Manage-As itself is unchanged", () => {
  assert.match(BIZ_IMPORT_ACTIONS, /canHost: async \(\) => \(await getHostAuthority\(admin, user\.id, businessId\)\)\.ok,/);
  assert.match(BIZ_IMPORT_ACTIONS, /createHostedEvent\(admin, \{ \.\.\.e, userId: user\.id, viaAdmin: authority\.viaAdmin, hostBusinessId: businessId \}\)/);
  assert.match(EVENT_ACTIONS, /const eligibility = await getHostAuthority\(admin, user\.id, hostBusinessId\);/);
  assert.match(EVENT_ACTIONS, /createHostedEvent\(admin, \{ userId: user\.id, viaAdmin: hostViaAdmin,/);
  assert.match(EVENT_NEW, /await getHostAuthority\(admin, user\.id, businessIdParam\)/);
  assert.doesNotMatch(BIZ_IMPORT_ACTIONS + EVENT_ACTIONS + EVENT_NEW, /getHostEventEligibility/, "no entry point checks membership alone any more");
  // Manage-As is still: real membership first, then the Admin session, audited.
  assert.match(PERMISSIONS, /if \(await isAdminSession\(\)\) \{\s*\/\/[\s\S]*?await auditManageAsWrite\(table, entityId\);\s*return \{ id: "admin-override", role: "owner", viaAdmin: true \};/);
});

test("2. hosting import through the Admin path: same Event, admin provenance, public link", async () => {
  const tables = { events: [], event_occurrences: [], entity_provenance: [], event_categories: [], event_formats: [] };
  const admin = db(tables, "ev-h");
  const made = [];
  const deps = {
    admin, userId: "u-founder", businessId: ALPYN.id, businessName: ALPYN.name,
    applyToEvent: async () => "approved_now", canHost: async () => true, storeImage: async () => null, geography: async () => null,
    uniqueEventSlug: async () => "alpyn-glow-night", notifyNewEvent: async () => {}, propagateDates: async () => {}, findEventBySourceUrl: async () => null,
    createHostedEvent: async (e) => {
      made.push(e);
      tables.events.push({ id: "ev-h", name: e.name, slug: e.slug, host_business_id: ALPYN.id, is_demo: false, publication_status: "live" });
      return { ok: true, id: "ev-h", viaAdmin: true };
    },
  };
  const input = { intent: "hosting", title: "Alpyn Glow Night", description: null, imageUrl: null, sourceUrl: null, occurrences: [{ date: "2026-11-05", start: "2026-11-05T22:00:00.000Z", end: "2026-11-06T01:00:00.000Z", place: { name: "Sephora", address: null, city: "New York", state: "NY", postalCode: null, locationId: null } }], useEventId: null, asEvent: false, organizer: null, attendance: null, locationVisibility: null, categoryId: null, formatIds: [] };
  const out = await P.persistEventImport(input, deps);
  assert.equal(out.ok, true);
  assert.equal(made.length, 1, "created through the authority-aware path, not create_owned_event directly");
  assert.equal(out.publicHref, "/event/alpyn-glow-night");
  assert.equal(out.eventId, "ev-h");
  assert.equal(out.hosted, true);
  assert.equal(tables.entity_provenance[0]?.source_method, "admin_managed_hosted_import");
});

// ------------------------------------------------------------ 1. View Event

test("1. View Event: importer success, multi-import summary, Hosting rows, Event Manager after Host An Event", () => {
  assert.match(BIZ_IMPORTER, /\{step\.publicHref && \(\s*<Link href=\{step\.publicHref\} className=\{primaryButtonClass\}>\s*View Event/);
  assert.match(BIZ_IMPORTER, /step\.hosted \? "Manage Event"/);
  assert.match(BIZ_IMPORT_ACTIONS, /if \(outcome\.ok && !outcome\.publicHref && normalized\.value\.useEventId\) return \{ \.\.\.outcome, \.\.\.\(await publicLink\(ctx\.admin, normalized\.value\.useEventId\)\) \};/, "joining an existing Event links to it too");
  assert.match(BIZ_IMPORT_ACTIONS, /ev && !ev\.is_demo && !ev\.trashed_at \? \{ publicHref: eventHref\(ev\.slug\)/, "only a live Event gets a public link");
  assert.match(MULTI, /r\.outcome\.ok && r\.outcome\.publicHref \?/);
  assert.match(MULTI, /View Event\s*<\/Link>/);
  assert.match(BIZ_MANAGER, /\{!h\.statusLabel && \(\s*<Link href=\{eventHref\(h\.slug\)\}[^>]*>\s*View Event/, "published hosted Events link to their public page");
  assert.match(EVENT_ACTIONS, /&created=1` : `\/account\/event\/\$\{eventId\}\?created=1`/);
  assert.match(EVENT_MANAGER, /\{justCreated && !error && \(/);
  assert.match(EVENT_MANAGER, /\{publicHref && \(\s*<Link href=\{publicHref\}[^>]*>\s*View Event/);
});

// ------------------------------------------------------------ 3 + 5. artwork

test("3 + 5. one artwork model: detected / flyer / upload / none, never requiring a detected image; Admin uses the same upload path", () => {
  for (const choice of ["Use Detected Image", "Use Your Uploaded Flyer", "Use Your Uploaded Image", "No Image"]) assert.ok(BIZ_IMPORTER.includes(choice), choice);
  assert.match(BIZ_IMPORTER, /<EventCoverUpload\s+upload=\{\(form\) => uploadImportEventCover\(businessId, form\)\}/, "upload is offered whatever the import origin");
  assert.match(BIZ_IMPORTER, /const chosenImageUrl = review\.useEventId \? null : cover === "detected" \? review\.imageUrl : cover === "upload" \? uploadedCover : null;/);
  assert.match(BIZ_IMPORTER, /previewImportEventImage\(businessId, detectedUrl\)/, "the detected image is previewed (verified, server-made)");
  assert.match(ADMIN_IMPORTER, /<EventCoverUpload upload=\{adminUploadEventCover\} hasImage=\{Boolean\(review\.imageUrl\)\} onUploaded=\{\(url\) => set\(\{ imageUrl: url \}\)\} \/>/);
  assert.match(ADMIN_IMPORTER, /Use Detected Image/);
  for (const src of [BIZ_IMPORT_ACTIONS, ADMIN_IMPORT_ACTIONS]) {
    assert.match(src, /storeUploadedEventImage\(\w+(?:\.admin)?, form instanceof FormData \? form\.get\("image"\) : null, EVENT_IMPORT_IMAGE_MAX_BYTES\)/, "the ONE Event image path");
    assert.match(src, /if \(isStoredEventImageUrl\(admin, url\)\) return url;/, "an uploaded cover is never fetched + copied again");
  }
  assert.match(ADMIN_IMPORT_ACTIONS, /export async function adminUploadEventCover[\s\S]{0,200}const admin = await adminClient\(\);\s*if \(!admin\)/, "Admin-session gated");
  assert.match(BIZ_IMPORT_ACTIONS, /export async function uploadImportEventCover[\s\S]{0,200}const ctx = await authorize\(businessId\);\s*if \(!ctx\)/, "Business-access gated");
});

test("3 + 5. stored-image recognition is the exact Findmi public bucket only", () => {
  const admin = { storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `https://abc.supabase.co/storage/v1/object/public/findmi-media/${p}` } }) }) } };
  assert.equal(M.isStoredEventImageUrl(admin, "https://abc.supabase.co/storage/v1/object/public/findmi-media/u/x.webp"), true);
  assert.equal(M.isStoredEventImageUrl(admin, "https://abc.supabase.co/storage/v1/object/public/findmi-media/"), false);
  assert.equal(M.isStoredEventImageUrl(admin, "https://abc.supabase.co/storage/v1/object/public/other/x.webp"), false);
  assert.equal(M.isStoredEventImageUrl(admin, "https://evil.example/storage/v1/object/public/findmi-media/x.webp"), false);
  assert.equal(M.isStoredEventImageUrl(admin, "https://abc.supabase.co/storage/v1/object/public/findmi-media/../x.webp"), false);
  assert.equal(M.isStoredEventImageUrl(admin, "https://abc.supabase.co/storage/v1/object/public/findmi-media/x.webp?y=1"), false);
  assert.match(M.uploadedEventImageError("unsuitable"), /too small or too narrow/);
  assert.match(M.uploadedEventImageError("too_large"), /too large/);
});

// ------------------------------------------------------------ 4. participants

test("4. Participating Businesses: next step after a hosted Event; Admin import search; every participant realizes its dates", async () => {
  assert.match(BIZ_IMPORTER, /participantsHref: hosted && outcome\.eventId \? `\/account\/event\/\$\{outcome\.eventId\}\?tab=participants/, "the Event Manager's existing participant step (invite, dedupe, per-date scope)");
  assert.match(BIZ_IMPORTER, /Add Participating Businesses/);
  assert.match(EVENT_MANAGER, /appendQuery\(`\/account\/event\/\$\{id\}`, \{ tab: "participants"/);
  assert.match(ADMIN_IMPORTER, /<ParticipatingBusinessesSection review=\{review\} set=\{set\} primaryId=\{business\?\.id \?\? null\} \/>/);
  assert.match(ADMIN_IMPORTER, /\[`\$\{PARTICIPANT_CHOICE_PREFIX\}\$\{r\.value\}`\]: \{ id: r\.value, name: r\.label \}/, "stored in the SAME otherBusinessChoices map → same validated event_businesses write");
  assert.match(ADMIN_IMPORTER, /excludeIds=\{taken\}/, "never the same Business twice");

  // Admin import with ONLY searched participants (no primary Business):
  // their per-date participation is realized, like the primary's.
  const tables = { events: [], event_occurrences: [], event_businesses: [], entity_provenance: [], event_categories: [], event_formats: [] };
  const admin = db(tables, "ev-d");
  const propagated = [];
  const input = { intent: "participating", title: "Holiday Market", description: null, imageUrl: null, sourceUrl: null, occurrences: [{ date: "2026-12-05", start: "2026-12-05T18:00:00.000Z", end: "2026-12-05T22:00:00.000Z", place: { name: "St. John", address: null, city: "Staten Island", state: "NY", postalCode: null, locationId: null } }], useEventId: null, asEvent: true, organizer: null, attendance: null, locationVisibility: null, categoryId: null, formatIds: [] };
  const out = await P.persistDiscoveryEvent(input, null, { admin, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "holiday-market", propagateDates: async (...a) => propagated.push(a), findEventBySourceUrl: async () => null }, ["b-native-rose"]);
  assert.equal(out.ok, true);
  assert.deepEqual(tables.event_businesses.map((r) => [r.business_id, r.status, r.participation_scope]), [["b-native-rose", "approved", "all_dates"]]);
  assert.equal(propagated.length, 1, "dates realized for a participant even with no primary Business");
  assert.equal(out.publicHref, "/event/holiday-market");
});

// ------------------------------------------------------------ 6. schedule map

test("6. Native Rose: unlisted (Needs Review) canonical Locations are drawn in context on the Business map — unlinked, never invented", () => {
  assert.match(GEO, /async function locationsById\(ids: string\[\], opts: \{ inContext\?: boolean \} = \{\}\)/);
  assert.match(GEO, /\(opts\.inContext \|\| r\.is_demo !== true\)/, "default (discovery surfaces): listed Locations only");
  assert.match(GEO, /const locs = await locationsById\(mappable\.map\(\(a\) => a\.location_id as string\), \{ inContext: true \}\);/, "only the Business's own schedule uses context");
  assert.equal((GEO.match(/inContext: true/g) ?? []).length, 1, "no other projection widened");
  assert.match(GEO, /if \(!r\.archived_at && !r\.trashed_at && /, "archived / trashed never");
  assert.match(GEO, /placeOf = \(l: Row \| null \| undefined\): GeoPlace \| null => \(l \? geoPlace\(l as Parameters<typeof geoPlace>\[0\], \{ linkable: isLocationDiscoverable/, "an unlisted Location is never a link");
});

test("6. unmappable dates are actionable in Business Manager (same rule as the public map)", () => {
  assert.equal(SM.scheduleMapGap({ location: null }), "no_location");
  assert.equal(SM.scheduleMapGap({ location: { latitude: null, longitude: null } }), "no_coordinates");
  assert.equal(SM.scheduleMapGap({ location: { latitude: 40.61, longitude: -74.13 } }), null);
  assert.equal(SM.scheduleMapGap({ location: null, location_hidden: true }), null, "a deliberately withheld venue isn't a gap");
  assert.match(BIZ_MANAGER, /location:locations\(id, name, city, state, latitude, longitude\)/);
  assert.match(BIZ_MANAGER, /SCHEDULE_MAP_GAP_LABEL\[scheduleMapGap\(a\)!\]/);
});

// ------------------------------------------------------------ 7. View On Map

test("7. View On Map keeps the Business scope: the full map shows that Business's upcoming schedule, framed on it", async () => {
  const C = await import("../src/components/map/ContextMap.tsx").catch(() => null);
  // ContextMap is a client component (JSX) — its href rule is asserted at source level.
  void C;
  assert.match(CONTEXT_MAP, /export function contextMapHref\(bbox: Bbox, singlePlaceHref: string \| null, scope\?: ContextMapScope\): string \{/);
  assert.match(CONTEXT_MAP, /p\.append\("type", "event"\);\s*p\.append\("type", "appearance"\);\s*p\.set\("brand", scope\.brand\);\s*p\.set\("bbox", box\);/);
  assert.match(CONTEXT_MAP, /const mapHref = contextMapHref\(bbox, single \? places\[0\]\.place\.href : null, scope\);/);
  assert.match(SCHEDULE, /scope=\{\{ brand: slug \}\}/, "the Business schedule map passes its Business");
  // Every other context map keeps its existing generic link.
  const callers = ["src/components/event/EventLocationFeature.tsx", "src/components/UpcomingDatesRail.tsx"].map(read).join("\n");
  assert.doesNotMatch(callers, /scope=/);
  // The full map already filters by Brand slug across Events (host + approved
  // participants) and Pop-Ups — the same engine, not a second map.
  const core = read("src/lib/discovery/map-core.ts");
  assert.match(core, /if \(q\.brands\?\.length && !combine\(q\.brandMode, "any", q\.brands, \(s\) => i\.brands\.some\(\(b\) => b\.slug === s\)\)\) return false;/);
});
