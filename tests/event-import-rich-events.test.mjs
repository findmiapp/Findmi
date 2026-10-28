// Event Import — Rich Event Persistence. A genuine imported Event entered
// through Where I'll Be becomes Event → Occurrence(s) → the Business's
// participation (never its host); thin whereabouts stay schedule items;
// the same source Event is never created twice; and an existing standalone
// schedule item can be converted in place. Fake clients only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
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
const X = await import("../src/lib/event-import/extract.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const C = await import("../src/lib/appearance-conversion.ts");
const F = await import("./fixtures/event-sources.mjs");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-13T20:00:00Z");
const CORGI_NYC = "660d3744-dc88-4e91-856c-c0a296c9e776";

function deps(html, over = {}) {
  return {
    fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
    ai: null, matchEvent: async () => null, getEvent: async (id) => ({ slug: `s-${id}`, host_business_id: null }), matchLocations: async () => [],
    matchPossibleLocations: async () => [], matchOrganizer: async () => null, matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null, findEventBySourceUrl: async () => null, isRateLimited: () => false, now: () => NOW, ...over,
  };
}

// A minimal admin double recording every write.
function fakeAdmin({ appearance = null, eventsByUrl = [] } = {}) {
  const ops = [];
  let n = 0;
  const builder = (table) => {
    const filters = [];
    const api = {
      select: () => api, neq: () => api, is: () => api, in: () => api, limit: () => api, order: () => api,
      eq: (k, v) => (filters.push([k, v]), api),
      maybeSingle: async () => ({
        data: table === "appearances" ? appearance : table === "locations" && filters.some(([k, v]) => k === "id" && v === CORGI_NYC) ? { id: CORGI_NYC, name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", postal_code: "10016", latitude: null, longitude: null } : null,
      }),
      then: (resolve) => resolve({ data: table === "events" && filters.some(([k]) => k === "external_url") ? eventsByUrl : [] }),
      insert: (input) => {
        const rows = Array.isArray(input) ? input : [input];
        ops.push({ op: "insert", table, rows });
        const ids = rows.map(() => `${table}-${++n}`);
        return { select: () => ({ single: async () => ({ data: { id: ids[0] }, error: null }), then: (r) => r({ data: ids.map((id) => ({ id })) }) }), then: (r) => r({ error: null }) };
      },
      upsert: (row, opts) => (ops.push({ op: "upsert", table, row, opts }), Promise.resolve({ error: null })),
      update: (patch) => {
        const rec = { op: "update", table, patch, where: [] };
        ops.push(rec);
        const chain = { eq: (k, v) => (rec.where.push([k, v]), chain), is: (k, v) => (rec.where.push([k, v]), chain), select: () => chain, maybeSingle: async () => ({ data: { id: "published" }, error: null }), then: (r) => r({ error: null }) };
        return chain;
      },
    };
    return api;
  };
  return { ops, client: { from: builder, rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: { id: "hosted-event" }, error: null }) } };
}
function persistDeps(admin, over = {}) {
  const calls = { apply: [], propagate: [], notify: [] };
  return {
    calls,
    deps: {
      admin, userId: "u", businessId: "corgi", businessName: "Corgi",
      applyToEvent: async (id) => (calls.apply.push(id), over.applyResult ?? "applied"),
      canHost: async () => true, storeImage: async (u) => `stored:${u}`, geography: async () => null,
      uniqueEventSlug: async (t) => t.toLowerCase().replace(/\W+/g, "-"),
      notifyNewEvent: async (id) => calls.notify.push(id),
      propagateDates: async (id, ids) => calls.propagate.push([id, ids]),
      findEventBySourceUrl: async () => over.existing ?? null,
    },
  };
}
const place = (venueName, extra = {}) => ({ venueName, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, matchKey: null, matchDecision: null, ...extra });
const richReview = (over = {}) => ({
  intent: "participating", title: "Founder GTM Mixer", description: "Meet founders shipping GTM.", imageUrl: "https://images.lumacdn.com/event-covers/nyc-gtm-mixer.jpg",
  sourceUrl: "https://luma.com/nyc-gtm-mixer", sharedPlace: true, place: place("Corgi Cafe", { useLocationId: CORGI_NYC, matchDecision: "use" }),
  occurrences: [{ id: "a", date: "2026-10-16", startTime: "18:00", endTime: "21:00", place: place("Corgi Cafe", { useLocationId: CORGI_NYC, matchDecision: "use" }) }],
  organizer: "Corgi NYC", useEventId: null, asEvent: true, ...over,
});
const norm = (r) => {
  const n = P.normalizeReview(r);
  assert.equal(n.ok, true, JSON.stringify(n));
  return n.value;
};

// ── classification ────────────────────────────────────────────────────
test("classification: calendar Events and structured Event pages are Events; thin or AI-only sources stay schedule items", async () => {
  const cal = await E.analyzeEventUrl({ url: "https://luma.com/usecorginyc", businessId: "corgi", rateKey: "u" }, deps(F.lumaCalendar()));
  assert.ok(cal.events.every((e) => e.candidate.persistAs === "event"), "H: each calendar Event is its own Event");
  const single = await E.analyzeEventUrl({ url: "https://market.example.com/fall", businessId: "corgi", rateKey: "u" }, deps(F.singleEventPage()));
  assert.equal(single.candidate.persistAs, "event");
  // J: one tour page with many dates → ONE Event (title + its own page + details).
  const tour = await E.analyzeEventUrl({ url: "https://www.nycforfree.co/events/tour", businessId: "corgi", rateKey: "u" }, deps(F.tourWithMapLinks().replace("<title>", '<meta name="description" content="Free samples at stops around NYC."><title>')));
  assert.equal(tour.kind, "single");
  assert.equal(tour.candidate.persistAs, "event");
  assert.equal(tour.candidate.occurrences.length, 3);
  // M/N: whereabouts without Event evidence, or dates only the AI step read.
  const base = { title: "Starbucks Sampling", description: null, imageUrl: null, sourceUrl: "https://instagram.example.com/p/1", platform: null, online: false, organizer: null, occurrences: [{ start: "2026-10-14T16:00:00Z", end: "2026-10-14T19:00:00Z", hasTime: true, venue: { name: "Grand Central", address: null, city: null, state: null, postalCode: null }, evidence: "x" }] };
  assert.equal(E.classifyPersistence({ ...base, sources: { title: "page", dates: "page" } }, { ownPage: true }), "schedule_item", "no details → whereabouts");
  assert.equal(E.classifyPersistence({ ...base, description: "Free drinks", sources: { title: "page", dates: "ai" } }, { ownPage: true }), "schedule_item", "AI-only dates → never a fabricated Event");
  assert.equal(E.classifyPersistence({ ...base, occurrences: [], sources: { title: "structured" } }, { ownPage: true }), "schedule_item", "no date → no Event");
});

test("review: Event vs schedule item is explained in Business words; the server re-checks", () => {
  assert.equal(R.persistNote(richReview(), "Corgi").line, "Findmi will add this Event and put Corgi on its schedule.");
  assert.equal(R.persistNote(richReview({ asEvent: false }), "Corgi").label, "Schedule Item");
  assert.equal(R.persistNote(richReview({ useEventId: "11111111-2222-4333-8444-555555555555" }), "Corgi").label, "On Findmi");
  for (const r of [richReview(), richReview({ asEvent: false }), richReview({ intent: "hosting" })]) assert.doesNotMatch(JSON.stringify(R.persistNote(r, "Corgi")), /appearance|occurrence/i);
  assert.equal(norm(richReview({ sourceUrl: null })).asEvent, true, "a source link is provenance, not a prerequisite (Unified Import)");
  assert.equal(norm(richReview({ asEvent: false })).asEvent, false, "Analyze's evidence decision still governs");
  assert.equal(norm(richReview({ intent: "hosting" })).asEvent, false, "hosting keeps its own path");
  assert.equal(R.successMessage("scheduled", "Founder GTM Mixer", "Corgi", "participating", true), "Founder GTM Mixer is live on Findmi and on Corgi's schedule.");
});

// ── persistence ───────────────────────────────────────────────────────
test("A/B/C/E: Where I'll Be + rich Event → ONE Event (participant, not host) + its Occurrence at the confirmed Location + participation", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d, calls } = persistDeps(client);
  const out = await P.persistEventImport(norm(richReview()), d);
  assert.deepEqual([out.ok, out.kind, out.newEvent], [true, "scheduled", true]);
  const ev = ops.filter((o) => o.table === "events" && o.op === "insert");
  assert.equal(ev.length, 1);
  const row = ev[0].rows[0];
  assert.deepEqual([row.name, row.host_business_id, row.is_demo, row.publication_status], ["Founder GTM Mixer", null, true, "pending_review"], "participant only; a Business submission starts pending Admin review");
  assert.equal(row.cover_image_url, "stored:https://images.lumacdn.com/event-covers/nyc-gtm-mixer.jpg", "C: the Event's own image");
  assert.deepEqual([row.external_url, row.description, row.organizer_name], ["https://luma.com/nyc-gtm-mixer", "Meet founders shipping GTM.", "Corgi NYC"]);
  assert.equal(ops.filter((o) => o.op === "rpc").length, 0, "no create_owned_event → no owner membership for the importer");
  const roster = ops.find((o) => o.table === "event_businesses");
  assert.deepEqual(roster.row, { event_id: "events-1", business_id: "corgi", status: "approved", participation_scope: "all_dates" });
  const occ = ops.find((o) => o.table === "event_occurrences").rows;
  assert.deepEqual(occ.map((r) => [r.location_id, r.event_id]), [[CORGI_NYC, "events-1"]], "E: the confirmed Location on the Occurrence");
  assert.deepEqual(calls.propagate, [["events-1", ["event_occurrences-2"]]], "the shared sync creates the Event-linked schedule item per date");
  assert.equal(ops.filter((o) => o.table === "appearances").length, 0, "no standalone schedule item");
  assert.deepEqual(calls.notify, ["events-1"], "Findmi is asked to review the new Event");
});

test("J: one Event with many dates and places → ONE Event, one Occurrence per date", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d } = persistDeps(client);
  const review = richReview({
    title: "Refreshers Sampling Tour", sharedPlace: false,
    occurrences: [
      { id: "a", date: "2026-10-16", startTime: "13:00", endTime: "19:00", place: place("Grand Central") },
      { id: "b", date: "2026-10-17", startTime: "12:00", endTime: "18:00", place: place("Astoria Park") },
      { id: "c", date: "2026-10-18", startTime: "18:00", endTime: "00:00", place: place("Corgi Cafe", { useLocationId: CORGI_NYC, matchDecision: "use" }) },
    ],
  });
  await P.persistEventImport(norm(review), d);
  assert.equal(ops.filter((o) => o.table === "events" && o.op === "insert").length, 1);
  assert.deepEqual(ops.find((o) => o.table === "event_occurrences").rows.map((r) => [r.venue_name, r.location_id]), [["Grand Central", null], ["Astoria Park", null], ["Corgi Cafe NYC", CORGI_NYC]]);
});

test("K/L: the same source Event already on Findmi (any Business imported it) is joined — never a second Event", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d, calls } = persistDeps(client, { existing: { id: "ev-1" } });
  const out = await P.persistEventImport(norm(richReview()), d);
  assert.deepEqual(calls.apply, ["ev-1"]);
  assert.equal(out.kind, "requested", "the shared join path: participation confirmed with the Event");
  assert.equal(ops.filter((o) => o.op === "insert").length, 0);
  const joined = persistDeps(fakeAdmin().client, { existing: { id: "ev-1" }, applyResult: "already_approved" });
  assert.equal((await P.persistEventImport(norm(richReview()), joined.deps)).kind, "already", "retry-safe");
  // A just-imported Event awaiting review can be joined (the request is decided with it); rejected/trashed can't.
  const helper = read("src/lib/event-participation.ts");
  assert.match(helper, /if \(!ev \|\| \(ev\.is_demo && ev\.publication_status !== "pending_review"\)\) return "unavailable";/);
  assert.match(helper, /\.is\("trashed_at", null\)\s*\.is\("archived_at", null\)/);
});

test("M: lightweight whereabouts still save as the Business's own schedule item", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d } = persistDeps(client);
  await P.persistEventImport(norm(richReview({ asEvent: false })), d);
  assert.equal(ops.filter((o) => o.table === "events").length, 0);
  assert.equal(ops.find((o) => o.table === "appearances").rows[0].source, "manual");
});

test("hosting is unchanged: the hosting path still creates the hosted Event, with no participant schedule item", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d } = persistDeps(client);
  await P.persistEventImport(norm(richReview({ intent: "hosting" })), d);
  assert.equal(ops.find((o) => o.op === "rpc").args.p_host_business_id, "corgi");
  assert.equal(ops.filter((o) => o.table === "event_businesses").length, 0);
});

// ── display ───────────────────────────────────────────────────────────
test("D/F/G: cards fall back to the Event's image; the Location page shows the Occurrence once (Event-linked items aren't repeated)", () => {
  for (const f of ["src/components/AppearanceCarousel.tsx", "src/app/(public)/business/[slug]/BusinessPublicView.tsx"]) {
    assert.match(read(f), /flyer_image_url \?\? (featuredAppearance\.|)?(appearance\.)?event\?\.cover_image_url \?\? null/, f);
  }
  const data = read("src/lib/data.ts");
  assert.match(data, /\.select\("\*, event:events\(slug, name, cover_image_url\), location:locations\(id, name, slug, is_demo, logo_url, cover_image_url\)"\)/, "Business schedule loads the Event cover");
  const fn = data.slice(data.indexOf("async function queryUpcomingHappenings("), data.indexOf("export async function getLocationDescendants("));
  assert.match(fn, /\.from\("event_occurrences"\)[\s\S]*?\.in\("location_id", locationIds\)/);
  assert.match(fn, /\.in\("location_id", locationIds\)\s*\.is\("event_id", null\)/);
  assert.match(fn, /specificImageUrl: e\.cover_image_url/, "the Occurrence card uses the Event's own image");
});

// ── conversion ────────────────────────────────────────────────────────
const STANDALONE = {
  id: "d6c7cdd0-c72d-4151-b2fd-ecb3522b8f7e", business_id: "corgi", title: "Founder GTM Mixer", description: "Meet founders", start_at: "2026-10-13T21:30:00Z", end_at: "2026-10-14T00:00:00Z",
  status: "confirmed", event_id: null, location_id: CORGI_NYC, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: null, longitude: null,
  external_url: "https://luma.com/nyc-gtm-mixer", flyer_image_url: "https://store/x.webp", market_id: "m1", market_area_id: null,
};

test("O/P/Q: conversion keeps the same schedule item and links it to a new Event + Occurrence with its Location, link and image", async () => {
  const { client, ops } = fakeAdmin({ appearance: STANDALONE });
  const out = await C.convertAppearanceToEvent(client, STANDALONE.id, { uniqueEventSlug: async () => "founder-gtm-mixer" });
  assert.equal(out.status, "converted");
  assert.equal(out.appearanceId, STANDALONE.id, "O: same identity");
  const ev = ops.find((o) => o.table === "events" && o.op === "insert").rows[0];
  assert.deepEqual([ev.external_url, ev.cover_image_url, ev.host_business_id, ev.is_demo, ev.publication_status], [STANDALONE.external_url, STANDALONE.flyer_image_url, null, false, "live"]);
  const occ = ops.find((o) => o.table === "event_occurrences").rows[0];
  assert.deepEqual([occ.start_at, occ.end_at, occ.location_id], [STANDALONE.start_at, STANDALONE.end_at, CORGI_NYC]);
  assert.deepEqual(ops.filter((o) => o.op === "upsert").map((o) => o.table), ["event_businesses", "event_occurrence_businesses"]);
  const link = ops.find((o) => o.op === "update" && o.table === "appearances");
  assert.deepEqual(link.patch, { event_id: out.eventId, event_occurrence_id: out.occurrenceId, source: "official_participation" }, "Q: nothing else on the row changes");
  assert.deepEqual(link.where, [["id", STANDALONE.id], ["event_id", null]]);
  assert.equal(ops.filter((o) => o.op === "insert" && o.table === "appearances").length, 0, "never recreated");
});

test("conversion never duplicates: already linked, canceled, or a source Event already on Findmi are left untouched", async () => {
  for (const [row, reason] of [[{ ...STANDALONE, event_id: "ev" }, "already_linked"], [{ ...STANDALONE, status: "canceled" }, "canceled"]]) {
    const { client, ops } = fakeAdmin({ appearance: row });
    assert.equal((await C.convertAppearanceToEvent(client, row.id, { uniqueEventSlug: async () => "s" })).reason, reason);
    assert.equal(ops.length, 0);
  }
  const { client, ops } = fakeAdmin({ appearance: STANDALONE, eventsByUrl: [{ id: "existing" }] });
  assert.deepEqual(await C.convertAppearanceToEvent(client, STANDALONE.id, { uniqueEventSlug: async () => "s" }), { status: "skipped", reason: "source_event_exists", eventId: "existing" });
  assert.equal(ops.length, 0);
});
