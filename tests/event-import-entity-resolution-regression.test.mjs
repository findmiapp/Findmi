// Event Import Real-World Regression Repair — a real Luma import (Apps
// Week Cafe / "Appspresso ✨ Apps Week Cafe", similar to
// https://luma.com/6bkjlc0n?tk=j75YJ4) exposed five failures in systems
// previously considered complete:
//   1. a referral-bearing URL (?tk=…) required manual editing to import;
//   2. an extracted venue ("Fellini Coffee Chelsea") was neither resolved
//      to a canonical Location NOR offered Quick Create — and its own
//      name was persisted AS its street address;
//   3. explicit "EHVM & Tangent teams" collaboration evidence never
//      reached Business review;
//   4/5. "Ready" overstated a review with none of the above actually
//      resolved.
// This file proves each root-cause fix directly against the real library
// functions (not just source regex) wherever the function is pure/fake-
// able — no network, no database, no production writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};", shortCircuit: true };
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
const X = await import("../src/lib/event-import/extract.ts");
const SRC = await import("../src/lib/event-import/sources.ts");
const AI = await import("../src/lib/event-import/ai.ts");
const T = await import("../src/lib/event-import/types.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");
const ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");

const NOW = Date.parse("2026-10-20T20:00:00Z");

// ── 1. Referral URL normalization ───────────────────────────────────────

test("1a. a Luma URL carrying the observed ?tk= referral parameter is normalized the same as the clean URL", () => {
  const withToken = E.normalizeImportUrl("https://luma.com/6bkjlc0n?tk=j75YJ4");
  const clean = E.normalizeImportUrl("https://luma.com/6bkjlc0n");
  assert.equal(withToken.ok, true);
  assert.equal(clean.ok, true);
  assert.equal(withToken.url.toString(), clean.url.toString(), "no manual character deletion needed — both normalize identically");
  assert.equal(withToken.url.searchParams.has("tk"), false);
});

test("1b. the tracking-param strip is bounded and generic — not hard-coded to this one token value", () => {
  // A different Luma token value, and a different generic tracking param,
  // both strip the same way (the PARAM NAME is denylisted, never a value).
  assert.equal(E.stripTrackingParams(new URL("https://lu.ma/abc?tk=someOtherTokenEntirely")).search, "");
  assert.equal(E.stripTrackingParams(new URL("https://www.eventbrite.com/e/1?utm_source=newsletter&utm_campaign=fall")).search, "");
  assert.equal(E.stripTrackingParams(new URL("https://www.eventbrite.com/e/1?fbclid=abc123")).search, "");
});

test("1c. meaningful query parameters are never blindly deleted", () => {
  // An unrecognized param (might be load-bearing — e.g. a real search/
  // filter parameter) survives untouched, on any host, including Luma.
  const u = E.stripTrackingParams(new URL("https://luma.com/calendar/abc?period=upcoming"));
  assert.equal(u.searchParams.get("period"), "upcoming");
  // `tk` is only stripped for the Luma platform specifically — the same
  // param name on an unrelated site is left alone (it might mean
  // something else, e.g. a session token).
  const other = E.stripTrackingParams(new URL("https://example.com/page?tk=keepme"));
  assert.equal(other.searchParams.get("tk"), "keepme");
  // Mixed: tracking params stripped, the real one kept, for either host shape.
  const mixed = E.stripTrackingParams(new URL("https://luma.com/6bkjlc0n?tk=j75YJ4&period=upcoming"));
  assert.equal(mixed.searchParams.has("tk"), false);
  assert.equal(mixed.searchParams.get("period"), "upcoming");
});

test("1d. the strip never writes a database call pattern into engine.ts (URLSearchParams.delete, not a DB delete)", () => {
  assert.doesNotMatch(read("src/lib/event-import/engine.ts"), /\.insert\(|\.update\(|\.upsert\(|\.rpc\(/, "engine.ts stays write-free");
});

// ── 2. Venue/address integrity — a place name can never become its own
//    street address, across every path that builds a venue. ───────────

test("2a. realStreetAddress drops an address that is really just the venue's own name repeated", () => {
  assert.equal(T.realStreetAddress("Fellini Coffee Chelsea", "Fellini Coffee Chelsea"), null);
  assert.equal(T.realStreetAddress("Fellini Coffee Chelsea", "fellini coffee chelsea"), null, "case/whitespace-insensitive");
  assert.equal(T.realStreetAddress("Fellini Coffee Chelsea", "123 W 21st St"), "123 W 21st St", "a real address is kept");
  assert.equal(T.realStreetAddress(null, "123 W 21st St"), "123 W 21st St", "no name to compare against — kept");
  assert.equal(T.realStreetAddress("Fellini Coffee Chelsea", null), null);
});

test("2b. JSON-LD location.address as a bare string duplicating the venue name is never persisted as street_address", () => {
  const { venue } = X.venueFrom({ "@type": "Place", name: "Fellini Coffee Chelsea", address: "Fellini Coffee Chelsea" });
  assert.equal(venue.name, "Fellini Coffee Chelsea");
  assert.equal(venue.address, null, "name-duplicate address dropped — never persisted as a real street address");
  // A genuine structured address is untouched.
  const real = X.venueFrom({ "@type": "Place", name: "Fellini Coffee Chelsea", address: { streetAddress: "230 8th Ave", addressLocality: "New York", addressRegion: "NY" } });
  assert.equal(real.venue.address, "230 8th Ave");
});

test("2c. the AI step's own venue/address fields never duplicate the venue name into street_address", () => {
  const text = "Appspresso ✨ Apps Week Cafe\nFellini Coffee Chelsea\nNew York, NY\nOct 24, 6pm";
  const out = AI.sanitizeEventAiOutput(
    {
      title: "Appspresso ✨ Apps Week Cafe",
      schedule: [{ evidence: "Fellini Coffee Chelsea\nNew York, NY\nOct 24, 6pm", date: "2026-10-24", start_time: "18:00", end_time: null, venue_name: "Fellini Coffee Chelsea", street_address: "Fellini Coffee Chelsea" }],
      venue_name: "Fellini Coffee Chelsea",
      street_address: "Fellini Coffee Chelsea",
      city: "New York",
      state: "NY",
      postal_code: null,
      organizer: null,
      organizer_evidence: null,
      other_businesses: [],
    },
    text,
    { now: NOW, yearHint: null }
  );
  assert.equal(out.venue.name, "Fellini Coffee Chelsea");
  assert.equal(out.venue.address, null, "top-level summary venue never gets a name-duplicate address");
  assert.equal(out.occurrences[0].venue.name, "Fellini Coffee Chelsea");
  assert.equal(out.occurrences[0].venue.address, null, "per-occurrence venue (from the schedule entry) never gets one either");
});

// ── 3. Missing Location resolution reaches the existing Quick Create /
//    research step — the Entity Resolution Truthfulness pass's fix for
//    canOfferLocationCreate's (correctly) stricter numbered-street rule
//    silently also gating the RESEARCH step that exists to go find it. ──

const fellini = (over = {}) => ({
  venueName: "Fellini Coffee Chelsea",
  address: null,
  city: "New York",
  state: "NY",
  postalCode: null,
  useLocationId: null,
  // placeFromVenue always sets this to venueKey(v) — real Review state.
  matchKey: T.venueKey({ name: "Fellini Coffee Chelsea", address: null }),
  matchDecision: null,
  ...over,
});

test("3a. an unresolved, name-only venue (no street address) reaches canResearchLocation — the research/Quick Create gate", () => {
  assert.equal(R.canResearchLocation(fellini(), { locationVisibility: "exact", online: false }), true);
  // The historical regression's OTHER half — even if the corrupted
  // name-duplicate address had somehow survived, research is still offered.
  assert.equal(R.canResearchLocation(fellini({ address: "Fellini Coffee Chelsea" }), { locationVisibility: "exact", online: false }), true);
});

test("3b. canOfferLocationCreate correctly stays stricter — it alone decides whether to CREATE directly without research", () => {
  // The regression's actual DB state: no real address yet. Directly
  // creating a Location from this would be fabricating an address — still
  // correctly refused; only the RESEARCH step (3a) should be offered.
  assert.equal(R.canOfferLocationCreate(fellini(), { locationVisibility: "exact", online: false }), false);
});

test("3c. unresolvedLocations flags exactly this place, feeding the truthful review-state fix (see Task 5 below)", () => {
  const review = { intent: "participating", title: "Appspresso ✨ Apps Week Cafe", description: null, imageUrl: null, sourceUrl: "https://luma.com/6bkjlc0n", occurrences: [], sharedPlace: true, place: fellini(), organizer: null, useEventId: null, asEvent: true, locationVisibility: "exact" };
  assert.deepEqual(R.unresolvedLocations(review), [T.venueKey({ name: "Fellini Coffee Chelsea", address: null })]);
  // Once linked (operator resolved it), it's no longer unresolved.
  const linked = { ...review, place: { ...review.place, useLocationId: "loc-1" } };
  assert.deepEqual(R.unresolvedLocations(linked), []);
});

// ── 4. Explicit Business candidate preservation — generic fixture, not
//    hard-coded to EHVM/Tangent specifically (same mechanism works for
//    any "X & Y teams" / "X x Y" collaboration phrase). ─────────────────

test("4a. explicit 'A & B teams' collaboration evidence produces reviewable organization candidates, grounded against the real text", () => {
  const text = "Join us for a pop-up collab.\nHosted by Acme Roasters.\nCurated by the Northside & Rivertown teams.";
  const out = AI.sanitizeEventAiOutput(
    {
      title: "Pop-Up Collab",
      schedule: [],
      venue_name: null,
      street_address: null,
      city: null,
      state: null,
      postal_code: null,
      organizer: "Acme Roasters",
      organizer_evidence: "Hosted by Acme Roasters.",
      other_businesses: [
        { name: "Northside", evidence: "Curated by the Northside & Rivertown teams." },
        { name: "Rivertown", evidence: "Curated by the Northside & Rivertown teams." },
      ],
    },
    text,
    { now: NOW, yearHint: null }
  );
  assert.deepEqual(out.otherBusinesses, ["Northside", "Rivertown"]);
  assert.equal(out.organizer, "Acme Roasters");
});

test("4b. a candidate the model invents (not actually in the page text) is dropped, never surfaced", () => {
  const text = "Just a plain event page with no collaborators named.";
  const out = AI.sanitizeEventAiOutput(
    { title: "Plain Event", schedule: [], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null, other_businesses: [{ name: "Invented Co", evidence: "Invented Co was here" }] },
    text,
    { now: NOW, yearHint: null }
  );
  assert.deepEqual(out.otherBusinesses, []);
});

test("4c. the already-resolved organizer is never duplicated into otherBusinesses", () => {
  const text = "Hosted by Acme Roasters. Featuring Acme Roasters merch.";
  const out = AI.sanitizeEventAiOutput(
    { title: "T", schedule: [], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: "Acme Roasters", organizer_evidence: "Hosted by Acme Roasters.", other_businesses: [{ name: "Acme Roasters", evidence: "Featuring Acme Roasters merch." }] },
    text,
    { now: NOW, yearHint: null }
  );
  assert.deepEqual(out.otherBusinesses, []);
});

test("4d. the real EHVM & Tangent evidence from the actual Apps Week Cafe import is preserved end to end", () => {
  const text = 'Appspresso ✨ Apps Week Cafe\nFellini Coffee Chelsea\nNew York, NY\nJoin us for coffee and demos — hosted by the EHVM & Tangent teams.';
  const out = AI.sanitizeEventAiOutput(
    { title: "Appspresso ✨ Apps Week Cafe", schedule: [], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null, other_businesses: [{ name: "EHVM", evidence: "hosted by the EHVM & Tangent teams." }, { name: "Tangent", evidence: "hosted by the EHVM & Tangent teams." }] },
    text,
    { now: NOW, yearHint: null }
  );
  assert.deepEqual(out.otherBusinesses, ["EHVM", "Tangent"]);
});

test("4e. the informational dead-end is now an actionable Match / Create / Ignore resolver, not a text-only notice", () => {
  const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  assert.match(CLIENT, /function OtherBusinessSection/);
  assert.match(CLIENT, /function OtherBusinessCandidate/);
  assert.doesNotMatch(CLIENT, /Not linked — add them to the Event afterwards if they take part\./, "the old dead-end copy is gone");
  // Reuses the EXISTING match-before-create business infrastructure —
  // never a second/parallel business resolution system.
  assert.match(CLIENT, /adminPrepareBusiness\(\{ name, website: null, websiteReadFailed: false, eventName: null \}\)/);
  assert.match(CLIENT, /<QuickCreateBusiness/);
});

// ── 5/6. Media application — covered functionally in
//    tests/entity-media-completeness.test.mjs (applyEntityMedia's
//    specific-reason skip codes: already_set / verification_failed /
//    storage_failed, and the FILL-ONLY never-overwrite guarantee). Here:
//    the bounded transient retry is real, and only retries a genuine
//    fetch failure — never a second, weaker check. ──────────────────────

test("5a. a transient fetch failure on Apply gets exactly one bounded retry of the SAME verification, never a weaker one", () => {
  assert.match(ACTIONS, /if \(!verified\.ok && verified\.reason === "fetch_failed"\) \{\s*\n\s*await sleep\(MEDIA_APPLY_RETRY_DELAY_MS\);\s*\n\s*verified = await fetchVerifiedBrandImage\(url, role\);\s*\n\s*\}/);
  // Exactly two calls to the real verifier in that branch, not a relaxed one.
  assert.equal((ACTIONS.match(/fetchVerifiedBrandImage\(url, role\)/g) ?? []).length, 2);
});

test("5b. the generic 'couldn't be verified, or it was already set' message is gone from the client", () => {
  const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  assert.doesNotMatch(CLIENT, /Nothing was added — the media couldn.t be verified, or it was already set\./);
  assert.match(CLIENT, /\$\{s\.role === "logo" \? "Logo" : "Cover"\}: \$\{s\.reason\}/);
});

test("5c. each skip reason maps to a specific, truthful, non-generic message", () => {
  assert.match(ACTIONS, /if \(skip\.reason === "already_set"\) return "Already set/);
  assert.match(ACTIONS, /if \(skip\.reason === "storage_failed"\) return "The image was verified but couldn.t be saved/);
  assert.match(ACTIONS, /The image could no longer be verified/);
});

// ── 7. Review-state truthfulness — "Ready" cannot mean the same thing for
//    a fully resolved Event and one with an unresolved, actionable
//    Location — without blocking creation either way. ──────────────────

const occ = (place) => ({ id: "d1", date: "2026-10-24", startTime: "18:00", endTime: "", place });
const NO_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };

test("7a. the Apps Week Cafe reproduction — unresolved Fellini Coffee Chelsea — is 'needs_review', never 'Ready'", () => {
  const review = {
    intent: "participating",
    title: "Appspresso ✨ Apps Week Cafe",
    description: null,
    imageUrl: null,
    sourceUrl: "https://luma.com/6bkjlc0n",
    occurrences: [occ(fellini())],
    sharedPlace: false,
    place: fellini(),
    organizer: null,
    useEventId: null,
    asEvent: true,
    locationVisibility: "exact",
  };
  const status = R.batchItemStatus(review, NO_MATCHES);
  assert.equal(status.kind, "needs_review", "truthfully distinguishes unresolved entity work from a fully resolved Event");
  assert.equal(R.BATCH_STATUS_LABEL[status.kind], "Needs Review");
});

test("7b. once the operator links (or the operator explicitly creates) the Location, the SAME Event becomes genuinely Ready", () => {
  const linkedPlace = fellini({ useLocationId: "loc-1" });
  const review = { intent: "participating", title: "Appspresso ✨ Apps Week Cafe", description: null, imageUrl: null, sourceUrl: "https://luma.com/6bkjlc0n", occurrences: [occ(linkedPlace)], sharedPlace: false, place: linkedPlace, organizer: null, useEventId: null, asEvent: true, locationVisibility: "exact" };
  assert.equal(R.batchItemStatus(review, NO_MATCHES).kind, "ready");
});

test("7c. an unresolved Location never BLOCKS creation — only the label stops overclaiming", () => {
  // MultiEventImport's own "ready to submit" filter only excludes needs_details.
  const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  assert.match(MULTI, /statusOf\(e\.key\)\.kind !== "needs_details"/);
});

test("7d. missing Business media never factors into the Ready/Needs Review distinction (media is informational only)", () => {
  // batchItemStatus takes only review+matches — MediaCompleteness's own
  // state is never consulted, so a missing cover can't move this status.
  assert.doesNotMatch(read("src/lib/event-import/review.ts"), /MediaCompleteness|logo_url|cover_image_url/);
});

// ── 8. Participation integration — resolving an "other" Business reuses
//    the EXISTING event_businesses write, never a duplicate/independent
//    Appearance path. ───────────────────────────────────────────────────

function fakePersistAdmin() {
  const ops = [];
  return {
    ops,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () => ({ data: { id: `${table}-1` }, error: null }),
        then: (cb) => cb({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          return { select: () => ({ single: async () => ({ data: { id: `${table}-1`, ...rows[0] }, error: null }), then: (cb) => cb({ data: rows.map((_, i) => ({ id: `${table}-1-${i}` })), error: null }) } ) };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: Array.isArray(row) ? row : [row] }), Promise.resolve({ error: null })),
        update: () => ({ eq: () => ({ then: (cb) => cb({ error: null }) }) }),
      };
      return chain;
    },
  };
}

function sourceEventDeps(admin) {
  return {
    admin,
    storeImage: async () => null,
    geography: async () => null,
    uniqueEventSlug: async () => "apps-week-cafe",
    propagateDates: async () => {},
    findEventBySourceUrl: async () => null,
  };
}

const NORMALIZED_INPUT = {
  intent: "participating",
  title: "Appspresso ✨ Apps Week Cafe",
  description: null,
  imageUrl: null,
  sourceUrl: "https://luma.com/6bkjlc0n",
  organizer: null,
  attendance: null,
  ticketsUrl: null,
  occurrences: [{ date: "2026-10-24", start: "2026-10-24T22:00:00.000Z", end: null, hasTime: true, place: { name: "Fellini Coffee Chelsea", address: null, city: "New York", state: "NY", postalCode: null, locationId: null } }],
  useEventId: null,
  categoryId: null,
  formatIds: [],
};

test("8a. resolving EHVM and Tangent as participants writes event_businesses — the SAME table/shape as the primary Business, never a second path", async () => {
  const client = fakePersistAdmin();
  const result = await P.persistDiscoveryEvent(NORMALIZED_INPUT, "biz-primary", sourceEventDeps(client), ["biz-ehvm", "biz-tangent"]);
  assert.equal(result.ok, true);
  const roster = client.ops.filter((o) => o.table === "event_businesses" && o.kind === "upsert").map((o) => o.rows[0]);
  assert.deepEqual(roster.map((r) => r.business_id).sort(), ["biz-ehvm", "biz-primary", "biz-tangent"].sort());
  for (const row of roster) assert.deepEqual({ status: row.status, scope: row.participation_scope }, { status: "approved", scope: "all_dates" }, "same approved/all_dates shape for every participant");
  // No event_occurrence_businesses row and no independent appearance write —
  // this stays the event-level participation path, untouched by this pass.
  assert.equal(client.ops.some((o) => o.table === "event_occurrence_businesses"), false);
  assert.equal(client.ops.some((o) => o.table === "appearances"), false);
});

test("8b. the primary Business is never added twice even if it also appears in the resolved 'other' list", async () => {
  const client = fakePersistAdmin();
  await P.persistDiscoveryEvent(NORMALIZED_INPUT, "biz-primary", sourceEventDeps(client), ["biz-primary", "biz-ehvm"]);
  const roster = client.ops.filter((o) => o.table === "event_businesses" && o.kind === "upsert").map((o) => o.rows[0].business_id);
  assert.deepEqual(roster.sort(), ["biz-ehvm", "biz-primary"].sort());
});

test("8c. omitting otherBusinessIds entirely (every existing caller) behaves exactly as before — purely additive", async () => {
  const client = fakePersistAdmin();
  await P.persistDiscoveryEvent(NORMALIZED_INPUT, "biz-primary", sourceEventDeps(client));
  const roster = client.ops.filter((o) => o.table === "event_businesses" && o.kind === "upsert").map((o) => o.rows[0].business_id);
  assert.deepEqual(roster, ["biz-primary"]);
});

test("8d. Admin's commit action validates each resolved 'other' Business id against real rows before ever persisting", () => {
  // resolveOtherBusinessIds re-checks every id against the businesses
  // table — the client's own choice is never trusted outright, same
  // discipline as the primary businessId just above it.
  assert.match(ACTIONS, /async function resolveOtherBusinessIds/);
  assert.match(ACTIONS, /const \{ data \} = await admin\.from\("businesses"\)\.select\("id"\)\.in\("id", ids\);/);
  assert.match(ACTIONS, /const otherBusinessIds = await resolveOtherBusinessIds\(admin, review, business\);/);
  assert.match(ACTIONS, /return await persistDiscoveryEvent\(normalized\.value, business, deps, otherBusinessIds\);/);
});

test("8e. the operator's Match/Create/Ignore choice lives on that Event's OWN review (otherBusinessChoices) — never global cross-Event state", () => {
  assert.match(read("src/lib/event-import/types.ts"), /otherBusinessChoices\?: Record<string, \{ id: string; name: string \} \| "ignored">;/);
});
