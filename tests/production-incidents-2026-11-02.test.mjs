// 2026-11-02 production incident regressions (Magnolia Bakery / Tamagotchi).
//  1. Duplicate schedule entries — three identical Events from one Create
//     Event form submitted three times (data duplication, not a JOIN).
//  2. Public Business page wider than the phone viewport.
//  3. Public Business page white-screen ("Application error").
//  4. Featured Business cards ignored hosted Events.
//  5. Featured Business cards padded with blank space on phones.
// Pure rules on production-shaped fixtures + source checks. No network, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const D = await import("../src/lib/data.ts");
const ROLES = await import("../src/lib/event-roles.ts");
const KEYS = await import("../src/lib/form-submission-keys.ts");
const MEDIA = await import("../src/lib/media-url.ts");
const IMG = await import("../src/lib/appearance-image.ts");

const read = (p) => readFileSync(p, "utf8");
const H = 3600000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// Production-shaped: Magnolia Bakery hosts "Staten Island Grand Opening",
// one dated occurrence at its New Dorp Lane Location, no Appearance rows.
const BIZ = "d44c64b8-d605-49fb-ae37-3c8ce9d595f9";
const START = iso(NOW + 22 * H);
const END = iso(NOW + 34 * H);
function event(id, over = {}) {
  return {
    id,
    slug: `magnolia-bakery-staten-island-grand-opening${over.suffix ?? ""}`,
    name: "Magnolia Bakery Staten Island Grand Opening",
    cover_image_url: null,
    start_at: over.start ?? START,
    end_at: over.end ?? END,
    venue_name: "Magnolia Bakery - New Dorp Lane",
    address: "430 New Dorp Lane",
    city: "Staten Island",
    state: "NY",
  };
}
function occurrence(id, eventId, start, end) {
  return { id, event_id: eventId, start_at: start, end_at: end, status: "scheduled", location: { id: "loc-ndl", name: "Magnolia Bakery - New Dorp Lane", slug: "ndl" }, venue_name: null, address: null, city: null, state: null };
}
const upcoming = (rows) => rows.filter((r) => new Date(r.end_at ?? r.start_at).getTime() > NOW);

// ── 1. Schedule: one row per real date ────────────────────────────────────

test("1. a single hosted Event date connected to one Business renders exactly once", () => {
  const E = "8e537230-fa43-4e46-b8b0-da161e76c003";
  const rows = D.reconcileBusinessActivity({ businessId: BIZ, rows: [], eventLinkIds: [E], occurrences: [], events: new Map([[E, event(E)]]) });
  assert.equal(upcoming(rows).length, 1);
  assert.equal(rows[0].event_id, E);
  assert.equal(rows[0].start_at, START);
});

test("2. multiple legitimate dates — including two sessions on the SAME day — each render individually", () => {
  const E = "evt-multi";
  const morning = occurrence("occ-am", E, iso(NOW + 20 * H), iso(NOW + 23 * H));
  const evening = occurrence("occ-pm", E, iso(NOW + 26 * H), iso(NOW + 29 * H));
  const nextDay = occurrence("occ-d2", E, iso(NOW + 44 * H), iso(NOW + 47 * H));
  const rows = D.reconcileBusinessActivity({
    businessId: BIZ,
    rows: [],
    eventLinkIds: [],
    occurrences: [morning, evening, nextDay],
    events: new Map([[E, event(E, { start: morning.start_at, end: nextDay.end_at })]]),
  });
  assert.deepEqual(upcoming(rows).map((r) => r.event_occurrence_id).sort(), ["occ-am", "occ-d2", "occ-pm"]);
});

test("3. duplicate relationship rows can't multiply one date (host + participant, repeated occurrence link)", () => {
  const E = "evt-one";
  const occ = occurrence("occ-1", E, START, END);
  // Hosted AND an approved participant of the same Event, and the same
  // occurrence link delivered twice (a JOIN fan-out).
  const eventLinkIds = ROLES.connectedEventIds([E, E], [E]);
  assert.deepEqual(eventLinkIds, [E]);
  const rows = D.reconcileBusinessActivity({ businessId: BIZ, rows: [], eventLinkIds, occurrences: [occ, { ...occ }], events: new Map([[E, event(E)]]) });
  assert.equal(upcoming(rows).length, 1, "one real date → one schedule row");
});

test("3b. the Business page and the Featured Business cards read hosted Events through ONE shared reader", () => {
  const src = read("src/lib/data.ts");
  const page = src.slice(src.indexOf("export async function getBusinessFindmiHereActivity"), src.indexOf("export const SHOWCASE_BUSINESS_SLUG"));
  const bulk = src.slice(src.indexOf("async function getUpcomingBusinessActivity"), src.indexOf("export async function getUpcomingAppearanceSummaries"));
  assert.match(page, /fetchHostedPublicEventIds\(supabase, \[businessId\]\)/);
  assert.match(bulk, /fetchHostedPublicEventIds\(supabase, ids\)/);
  assert.match(bulk, /connectedEventIds\(\s*hostedByBusiness\.get\(businessId\)/);
  const reader = src.slice(src.indexOf("export async function fetchHostedPublicEventIds"), src.indexOf("export async function getBusinessFindmiHereActivity"));
  for (const rule of ['.eq("publication_status", "live")', '.eq("is_demo", false)', '.is("archived_at", null)', '.is("trashed_at", null)']) {
    assert.ok(reader.includes(rule), `hosted reader keeps the public rule ${rule}`);
  }
});

// ── 4. Idempotent Create Event ────────────────────────────────────────────

test("4. a repeated submission of the same form never creates a second Event", () => {
  const user = "user-1";
  assert.deepEqual(KEYS.decideSubmissionClaim(null, null, user), { status: "claimed" });
  // Second and third submission of the same rendered form (the incident):
  assert.deepEqual(KEYS.decideSubmissionClaim({ code: "23505" }, { entity_id: "evt-first", user_id: user }, user), { status: "duplicate", entityId: "evt-first" });
  assert.deepEqual(KEYS.decideSubmissionClaim({ code: "23505" }, { entity_id: null, user_id: user }, user), { status: "in_progress" });
  // Another user's key is never leaked and never blocks.
  assert.deepEqual(KEYS.decideSubmissionClaim({ code: "23505" }, { entity_id: "evt-x", user_id: "someone-else" }, user), { status: "unprotected" });
  // Infrastructure trouble fails open (a legitimate creation is never blocked).
  assert.deepEqual(KEYS.decideSubmissionClaim({ code: "42P01" }, null, user), { status: "unprotected" });
});

test("4b. submission keys: only well-formed UUIDs are accepted from the form", () => {
  const fd = new FormData();
  fd.set("submission_key", "6F1C2B8E-3C4D-4E5F-8A9B-0C1D2E3F4A5B");
  assert.equal(KEYS.readSubmissionKey(fd), "6f1c2b8e-3c4d-4e5f-8a9b-0c1d2e3f4a5b");
  fd.set("submission_key", "'; drop table events; --");
  assert.equal(KEYS.readSubmissionKey(fd), null);
  assert.equal(KEYS.readSubmissionKey(new FormData()), null);
});

test("4c. Create Event claims its key after validation and before any write; the form locks while pending", () => {
  const actions = read("src/app/(public)/account/event/actions.ts");
  const fn = actions.slice(actions.indexOf("export async function createMemberEvent"), actions.indexOf("export async function updateMemberEventDetails"));
  const claim = fn.indexOf("claimSubmissionKey(");
  assert.ok(claim > fn.indexOf('fail("End date/time must be after the start date/time.")'), "claimed only after validation");
  assert.ok(claim < fn.indexOf("createHostedEvent("), "claimed before the Event is created");
  assert.match(fn, /claim\.status === "duplicate"[\s\S]*redirect\(/, "a duplicate lands on the first Event");
  assert.match(fn, /completeSubmissionKey\(admin, submissionKey, eventId\)/);
  assert.match(fn, /releaseSubmissionKey\(admin, submissionKey\)/, "a failed creation frees the key");

  const page = read("src/app/(public)/account/event/new/page.tsx");
  assert.match(page, /name=\{SUBMISSION_KEY_FIELD\} value=\{randomUUID\(\)\}/);
  assert.match(page, /export const dynamic = "force-dynamic"/, "a fresh key per render");
  assert.match(page, /<PendingSubmitButton[^>]*>Submit Event<\/PendingSubmitButton>/);
  assert.doesNotMatch(page, /<button type="submit"[^>]*>\s*Submit Event/);
  const button = read("src/components/PendingSubmitButton.tsx");
  assert.match(button, /useFormStatus\(\)/);
  assert.match(button, /disabled=\{pending\}/);

  const migration = read("supabase/migrations/20261126000000_form_submission_keys.sql");
  assert.match(migration, /key uuid primary key/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.form_submission_keys from anon, authenticated/);
});

// ── 5. Media can't white-screen the page ──────────────────────────────────

const STORAGE = "https://drcbrzwchlirfspjgtik.supabase.co";
const good = `${STORAGE}/storage/v1/object/public/findmi-media/8aab6320-f25e-4602-815d-b854bf89adfd.fv1.jpg`;
const goodWebp = `${STORAGE}/storage/v1/object/public/findmi-media/57284d58-925f-42e5-9527-c33e192a93e4.fv1.webp`;

test("5. malformed gallery records are skipped by the public reader; valid ones survive", () => {
  const stored = [good, null, "", "   ", "not a url", `${good} `, "javascript:alert(1)", 42, { url: good }, goodWebp];
  // Whitespace-padded values are normalized, never handed on raw.
  assert.deepEqual(MEDIA.renderableImageUrls(stored), [good, good, goodWebp]);
  // The image picker never indexes into an invalid entry either.
  const pick = IMG.resolveAppearanceDisplayImage({ appearanceId: "participation-8e537230", specificImageUrl: null, galleryImages: ["", null, good], businessCoverUrl: null });
  assert.equal(pick, good);
});

test("5b. gallery saves store only Findmi Storage URLs, de-duplicated, order kept", () => {
  const submitted = [goodWebp, "https://evil.example.com/x.jpg", good, goodWebp, `${STORAGE}/storage/v1/object/sign/findmi-media/x.jpg?token=1`, "", "garbage"];
  assert.deepEqual(MEDIA.cleanGalleryUrls(submitted, STORAGE), [goodWebp, good]);
  for (const p of [
    "src/app/(public)/account/business/actions.ts",
    "src/app/(public)/account/event/actions.ts",
    "src/app/(public)/account/location/actions.ts",
    "src/app/admin/(protected)/businesses/actions.ts",
    "src/app/admin/(protected)/events/actions.ts",
  ]) {
    const src = read(p);
    assert.doesNotMatch(src, /getAll\("gallery_image_url"\)\.map\(String\)\.filter\(Boolean\)/, `${p} validates gallery URLs`);
  }
});

test("5c. a failing section is contained — the Business page wraps its client sections and the public group has an error boundary", () => {
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  for (const name of ["Gallery", "Findmi Here", "Where To Find Us map", "cover zoom", "Featured Appearance"]) {
    assert.ok(view.includes(`<SectionErrorBoundary name="${name}">`), `${name} is wrapped`);
  }
  assert.match(view, /<SectionErrorBoundary name="Gallery">\s*<ImageGalleryStrip/);
  const boundary = read("src/components/SectionErrorBoundary.tsx");
  assert.match(boundary, /static getDerivedStateFromError/);
  assert.match(boundary, /componentDidCatch/);
  assert.ok(existsSync("src/app/(public)/error.tsx"), "public route-group error boundary exists");
});

test("5d. single-image uploaders can't throw out of their async transition", () => {
  for (const p of ["src/app/(public)/account/location/[id]/MemberLocationImageField.tsx", "src/app/(public)/account/event/[id]/MemberEventImageField.tsx"]) {
    const src = read(p);
    assert.match(src, /uploadGalleryFiles\(\[file\]/, `${p} uses the guarded upload path`);
  }
  for (const [p, names] of [
    ["src/app/(public)/account/location/actions.ts", ["uploadMemberLocationImage", "uploadNewLocationImage"]],
    ["src/app/(public)/account/event/actions.ts", ["uploadMemberEventImage", "uploadNewEventImage"]],
  ]) {
    const src = read(p);
    for (const n of names) assert.match(src, new RegExp(`export async function ${n}\\([^]*?try \\{\\s*return await _${n}Unguarded`), `${n} never rejects`);
  }
});

// ── 6. Mobile overflow ────────────────────────────────────────────────────

test("6. location card grids and the identity action row can't widen the document on phones", () => {
  // Root cause: `grid` with no column template sizes its implicit track to
  // the card's min-content (nowrap name/address), ~408px at 390px.
  for (const p of ["src/components/OurLocations.tsx", "src/components/FindUsAt.tsx"]) {
    const src = read(p);
    assert.match(src, /grid grid-cols-1 gap-3/, `${p}: minmax(0,1fr) track`);
    assert.match(src, /<li key=\{l\.locationId\} className="min-w-0">/, `${p}: grid item may shrink`);
  }
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(view, /ml-auto flex min-w-0 flex-wrap items-center justify-end/, "Follow/Save/Share wrap instead of overflowing");
  assert.doesNotMatch(view, /ml-auto flex flex-wrap shrink-0/);
  // Never solved by hiding overflow globally.
  const css = read("src/app/globals.css");
  assert.doesNotMatch(css, /(html|body)[^{]*\{[^}]*overflow-x:\s*hidden/);
});

// ── 7. Featured Business occurrence selection ─────────────────────────────

test("7. a Business whose only upcoming activity is a hosted Event gets a Featured card hint", async () => {
  const E = "a2059d49-3da2-4586-8efb-ea315002c4b9"; // Tamagotchi Times Square Spectacular
  const TAMA = "340fad27-3684-4d96-a2c8-973d704808fb";
  const ev = { ...event(E), slug: "tamagotchi-times-square-spectacular", name: "Tamagotchi Times Square Spectacular" };
  const withoutHosting = D.reconcileBusinessActivity({ businessId: TAMA, rows: [], eventLinkIds: [], occurrences: [], events: new Map([[E, ev]]) });
  assert.equal(withoutHosting.length, 0, "the pre-fix homepage input: nothing");
  const reconciled = upcoming(D.reconcileBusinessActivity({ businessId: TAMA, rows: [], eventLinkIds: ROLES.connectedEventIds([E], []), occurrences: [], events: new Map([[E, ev]]) }));
  const rows = reconciled.map((r) => ({ ...r, event: { slug: ev.slug, is_demo: false, name: ev.name, cover_image_url: null } }));
  const hints = await D.resolveUpcomingAppearanceHints([TAMA], 4, async () => rows);
  assert.equal(hints.get(TAMA)?.length, 1);
  assert.equal(hints.get(TAMA)[0].venue, "Tamagotchi Times Square Spectacular");
  assert.equal(hints.get(TAMA)[0].href, "/event/tamagotchi-times-square-spectacular");
});

// ── 8. Featured cards stay compact on phones ──────────────────────────────

test("8. Featured Business cards size to their own content on phones (no stretch-to-tallest)", () => {
  const src = read("src/components/HomepageBusinessRow.tsx");
  assert.match(src, /className="flex items-start gap-3 overflow-x-auto px-4 pb-2 sm:items-stretch/);
});

// ── Map / geo hygiene found during the trace ──────────────────────────────

test("map logo images are swapped, not updateImage()'d at a different size; brand presence selects real columns", () => {
  const canvas = read("src/components/map/DiscoveryMapCanvas.tsx");
  assert.doesNotMatch(canvas, /map\.updateImage\(id, data\)/);
  assert.match(canvas, /map\.removeImage\(id\);\s*map\.addImage\(id, data/);
  const geo = read("src/lib/geo-results-server.ts");
  assert.doesNotMatch(geo, /from\("appearances"\)\.select\("[^"]*timezone/, "appearances has no timezone column (PostgREST 400)");
});
