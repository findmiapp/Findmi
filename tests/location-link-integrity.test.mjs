// Location integrity + Admin visibility for ingestion.
//   - A public page never links an unlisted Location (no public page → 404):
//     it shows the name / address only, and links again once Admin lists it.
//   - Admin Home counts every active, unlisted Location (incl. Quick Created
//     ones from Admin Event Import) and links to Admin Locations → Needs Review.
//   - Import Complete counts only what was actually created / updated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const L = await import("../src/lib/location-links.ts");
const O = await import("../src/lib/event-import/operator.ts");
const read = (p) => readFileSync(p, "utf8");
const VIEW = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
const DATA = read("src/lib/data.ts");
const DASH = read("src/lib/admin/dashboard-queries.ts");
const HOME = read("src/app/admin/(protected)/page.tsx");
const QUERIES = read("src/lib/admin/queries.ts");
const LOC_PAGE = read("src/app/admin/(protected)/locations/page.tsx");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");

// ── PUBLIC LINKS ──────────────────────────────────────────────────────────

test("1 + 2 + 7. a listed Location is linked; an unlisted one is never linked — and links again once listed", () => {
  const IMG = { logo_url: "https://cdn.example/logo.png", cover_image_url: "https://cdn.example/cover.png" };
  assert.equal(L.publicLocationHref({ slug: "the-canvas", is_demo: false, ...IMG }), "/location/the-canvas");
  assert.equal(L.publicLocationHref({ slug: "the-canvas", is_demo: true, ...IMG }), null, "unlisted → no public page → no link");
  assert.equal(L.publicLocationHref({ slug: "the-canvas", ...IMG }), "/location/the-canvas", "rows read without is_demo keep the previous behavior");
  assert.equal(L.publicLocationHref({ slug: "the-canvas", is_demo: false, logo_url: null, cover_image_url: IMG.cover_image_url }), null, "no Logo → not a consumer Location");
  assert.equal(L.publicLocationHref(null), null);
  assert.equal(L.publicLocationHref({ slug: "", ...IMG }), null);
  // The public Location page resolves only listed Locations — the rule the helper mirrors.
  assert.match(DATA, /export async function getLocationBySlug[\s\S]{0,300}\.eq\("is_demo", false\)/);
  // Listing it is the existing Admin "Published" switch (is_demo = false).
  assert.match(read("src/app/admin/(protected)/locations/LocationForm.tsx"), /name="published"\n\s+defaultChecked=\{location \? !location\.is_demo : true\}/);
});

test("2. every Event-page Location link goes through publicLocationHref (no raw /location/${slug} left)", () => {
  const files = [
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
    "src/components/event/EventLocationFeature.tsx",
    "src/components/EventScheduleSummary.tsx",
    "src/components/EventOccurrenceQuickView.tsx",
    "src/components/EventLocationCard.tsx",
    "src/components/AppearanceCard.tsx",
    "src/components/AppearanceQuickView.tsx",
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /`\/location\/\$\{/, `${f} builds no raw Location link`);
    assert.match(src, /publicLocationHref\(/, f);
  }
  // The unlisted case still shows the place: name / address render without a link.
  assert.match(read("src/components/EventLocationCard.tsx"), /<div className="flex items-center gap-3 rounded-xl border border-black\/10 bg-white p-2\.5">\{inner\}<\/div>/);
  assert.match(VIEW, /\(publicLocationHref\(canonicalLocation\) \? \(\n\s+<Link href=\{publicLocationHref\(canonicalLocation\)!\}[\s\S]{0,400}<p className="mt-0\.5 text-metadata text-muted">\{placeName\}<\/p>/);
  assert.match(read("src/components/event/EventLocationFeature.tsx"), /\{publicLocationHref\(location\) && \(\n\s+<Link/, "View Location only when there is a page");
});

test("2. Location rows reaching Event pages carry is_demo (select * or the embed adds it)", () => {
  assert.equal((DATA.match(/location:locations\(id, name, slug\)/g) ?? []).length, 0);
  // Canonical Entity Geography completion pass — one of these five embeds
  // (getFindMiHereFeed's) additionally selects geo_place_key/geo_zcta_key/
  // geo_state_key for the Appearance effective-geography join; is_demo is
  // still carried by every one of them.
  // Each also carries logo_url + cover_image_url: the link helper needs both to decide discoverability.
  assert.equal((DATA.match(/location:locations\(id, name, slug, is_demo, logo_url, cover_image_url(?:, geo_place_key, geo_zcta_key, geo_state_key)?\)/g) ?? []).length, 5);
  assert.match(DATA, /const \{ data: locs \} = await supabase\.from\("locations"\)\.select\("\*"\)\.in\("id", locationIds\);/);
  assert.match(read("src/lib/types.ts"), /export interface FindmiLocation \{[\s\S]*?is_demo\?: boolean;/);
});

test("3. hidden-location Events still never show a place or a Location link", () => {
  assert.match(VIEW, /const canonicalLocation = locationHidden \? null : /);
  assert.match(VIEW, /where: locationHidden\n\s+\? \{ name: HIDDEN_LOCATION_COPY, href: null,/);
  assert.match(VIEW, /locationHidden \? \(\n\s+<WhereFact name=\{HIDDEN_LOCATION_COPY\} lines=\{\[location\]\} \/>/);
});

// ── ADMIN HOME + ADMIN LOCATIONS ──────────────────────────────────────────

test("4 + 5. Admin Home counts active, unlisted Locations (Quick Created ones included) and links to Needs Review", () => {
  const fn = DASH.slice(DASH.indexOf("export async function getLocationsAwaitingReview"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /\.select\("id, name", \{ count: "exact" \}\)/);
  assert.doesNotMatch(body, /location_members/, "Quick Create grants no membership — it must still be counted");
  assert.match(body, /\.eq\("is_demo", true\)\n\s+\.is\("archived_at", null\)\n\s+\.is\("trashed_at", null\)/);
  assert.match(HOME, /\{ label: "Location awaiting review", pluralLabel: "Locations awaiting review", count: locationsAwaiting\?\.total \?\? 0, href: "\/admin\/locations\?review=1" \}/);
  // Zero-count queues stay hidden, as for every other row.
  assert.match(HOME, /const activeAttentionItems = attentionQueue\.filter\(\(item\) => item\.count > 0\);/);
});

test("6. Admin Locations → Needs Review lists exactly that set, with address and a Draft badge", () => {
  assert.match(QUERIES, /if \(needsReview\) query = query\.eq\("is_demo", true\);/);
  assert.match(LOC_PAGE, /const needsReview = review === "1" && lifecycleTab === "active";/);
  assert.match(LOC_PAGE, /getAdminLocationList\(\{ q, lifecycle: lifecycleTab, needsReview, publishedOnly, sort, page \}\)/);
  assert.match(LOC_PAGE, />\n\s+Needs Review\n\s+<\/Link>/);
  const list = read("src/app/admin/(protected)/locations/LocationBulkListClient.tsx");
  // Lifecycle pass: the active unlisted state reads DRAFT (lib/admin/location-lifecycle.ts).
  assert.match(list, /\{LOCATION_LIFECYCLE_LABEL\[locationLifecycleState\(l\)\]\}/);
  assert.match(list, /\[l\.address, cityState\(l\.city, l\.state\)\]/);
});

test("9. the Business awaiting-review queue is unchanged", () => {
  assert.match(HOME, /\{ label: "Business awaiting review", pluralLabel: "Businesses awaiting review", count: needsAttention\.pendingBusinessReviews, href: "\/admin\/businesses\?published=pending_review" \}/);
});

// ── IMPORT COMPLETE ───────────────────────────────────────────────────────

test("8. Import Complete counts only real outcomes", () => {
  const results = [
    { outcome: { ok: true, kind: "scheduled", newEvent: true } },
    { outcome: { ok: true, kind: "scheduled", newEvent: true } },
    { outcome: { ok: true, kind: "already" } },
    { outcome: { ok: false, error: "Add a date." } },
  ];
  assert.deepEqual(O.operatorImportSummary(results, 1, { businessesCreated: 1, locationsCreated: 2, existingEventsUpdated: 1 }), {
    newEvents: 2,
    existingEvents: 2,
    existingEventsUpdated: 1,
    businessesCreated: 1,
    locationsCreated: 2,
    failed: 1,
  });
  assert.equal(O.operatorImportSummary([{ outcome: { ok: true, kind: "scheduled" } }], 0, { businessesCreated: 0, locationsCreated: 0, existingEventsUpdated: 0 }).newEvents, 0, "a save that didn't create an Event isn't a New Event");
  // Creations are recorded only where they succeeded — never for a picked existing record.
  assert.match(CLIENT, /if \(result\.status === "created"\) record\("location", result\.location\.id\);/);
  assert.match(CLIENT, /record\("business", result\.business\.id\);\n\s+onCreated\(result\.business\);/);
  assert.match(CLIENT, /if \(!result\.existing\) record\("business", result\.business\.id\);/);
  assert.match(CLIENT, /if \(result\.applied\.length > 0 \|\| \(result\.participants\?\.length \?\? 0\) > 0\) record\("event", eventId\);/);
  // Location Import V1's step reports only a Location it actually created.
  assert.match(CLIENT, /onCreated=\{\(id\) => record\("location", id\)\}/);
  assert.match(read("src/components/admin/location-import/EventLocationCreate.tsx"), /if \(r\.status === "created"\) \{\n\s+onCreated\(r\.location\.id\);/);
  assert.equal((CLIENT.match(/record\("/g) ?? []).length, 5, "no other place counts a creation");
  assert.match(MULTI, /<p className="text-card-title font-semibold text-findmi-700">Import Complete<\/p>/);
  for (const label of ["New Events", "Existing Events Reviewed / Skipped", "Existing Events Updated", "Businesses Created · Awaiting Review", "Locations Created · Awaiting Review"]) assert.ok(MULTI.includes(`"${label}"`), label);
  assert.match(MULTI, /href="\/admin\/locations\?review=1" className=\{secondaryButtonClass\}>\n\s+Review Locations/);
  assert.match(MULTI, /href="\/admin\/businesses\?published=pending_review" className=\{secondaryButtonClass\}>\n\s+Review Businesses/);
});
