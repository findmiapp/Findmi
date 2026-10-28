// Findmi Consolidation pass — Batch C: creation flows.
//   Business onboarding: ONE canonical search-first flow with website import.
//   Location: search Findmi first → Connect / Request To Manage / Create;
//     quick create with Address Line 2 + cover + gallery; "Location
//     submitted" next step (Edit Location Further / Add Another Location).
//   Event quick create: description, cover/flyer, gallery, participating
//     Businesses (existing only), links, schedule, name duplicate
//     suggestions; pending review; post-submit choice.
//   Product Marketplace submission explains checkout readiness.
// Source guards and pure logic only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const BRAND = read("src/app/(public)/join/brand/page.tsx");
const NEW_BIZ = read("src/app/(public)/account/business/new/page.tsx");
const LOC_PAGE = read("src/app/(public)/account/location/new/page.tsx");
const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");
const SEARCH_FIRST = read("src/components/location/LocationSearchFirst.tsx");
const EVENT_PAGE = read("src/app/(public)/account/event/new/page.tsx");
const EVENT_ACTIONS = read("src/app/(public)/account/event/actions.ts");
const createLoc = LOC_ACTIONS.slice(LOC_ACTIONS.indexOf("export async function createMemberLocation"), LOC_ACTIONS.indexOf("// ── INLINE EVENT LOCATION CREATION"));
const createEvent = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf("export async function createMemberEvent"), EVENT_ACTIONS.indexOf("// ── EVENT DETAILS"));

// ── Business onboarding ──────────────────────────────────────────────────
test("ONE canonical Add Business flow: every entry point opens the search-first front door", () => {
  for (const f of ["src/components/QuickCreateMenu.tsx", "src/components/account/AccountContextSwitcher.tsx", "src/components/public-actions/EntityActionBar.tsx", "src/components/MessageButton.tsx", "src/app/(public)/page.tsx"]) {
    assert.match(read(f), /href="\/join\/brand"/, f);
    assert.doesNotMatch(read(f), /href="\/account\/business\/new"/, f);
  }
  // A bare visit to the form (no carried values) is sent to search first;
  // links INTO the form from the canonical flow carry their values.
  assert.match(NEW_BIZ, /if \(carried\.every\(\(v\) => !v\)\) redirect\("\/join\/brand"\);/);
});

test("website-assisted copy and the two actions; website import leads straight to Review Your Business", () => {
  assert.match(BRAND, /Want Findmi to build a starting profile for you\? Enter your website and we'll try to import your business details\./);
  assert.ok((BRAND.match(/label="Enter Details Manually"/g) ?? []).length >= 2, "manual entry on both no-match states");
  assert.match(read("src/app/(public)/join/brand/BuildProfileButton.tsx"), /"Import From Website"/);
  assert.match(BRAND, /<input type="hidden" name=\{BRAND_BUILD_RESUME_PARAM\} value="1" \/>/, "no second press after the website lookup");
  assert.match(NEW_BIZ, /"Review Your Business"/);
  // Existing match → Claim (request management), never a duplicate.
  assert.match(BRAND, /Claim This Brand/);
  // Created pending (create_owned_business) — unchanged and verified in consolidation-domain N.
});

// ── Location search-first + quick create ────────────────────────────────
test("Add Location searches Findmi FIRST with a prominent 'Search for a location or address' box", () => {
  assert.match(SEARCH_FIRST, /placeholder="Search for a location or address"/);
  assert.match(SEARCH_FIRST, /LOCATION_SEARCH_DEBOUNCE_MS = 300/, "debounced");
  assert.match(SEARCH_FIRST, /q\.length < LOCATION_SEARCH_MIN_CHARS/, "never on a 1-character prefix");
  assert.match(SEARCH_FIRST, /\/api\/account\/search\?entity=locations\$\{scope\}&q=/, "the one bounded, trigram-indexed search");
  assert.match(LOC_PAGE, /<LocationSearchFirst[\s\S]*?connectAction=\{business \? connectBusinessLocation\.bind\(null, business\.id\) : null\}/);
});

test("matches offer Connect (managed) or Request To Manage (claim); pending ones show as already submitted", () => {
  assert.match(SEARCH_FIRST, /r\.managed && connectAction \? \(/);
  assert.match(SEARCH_FIRST, /Request To Manage/);
  assert.match(SEARCH_FIRST, /`\/location\/\$\{r\.slug\}\?claim=1`/, "the existing claim flow");
  assert.match(SEARCH_FIRST, /Already submitted · Pending review/);
  assert.match(SEARCH_FIRST, /Create New Location/);
  const route = read("src/app/api/account/search/route.ts");
  assert.match(route, /managed: managed\.has\(l\.id\)/);
  assert.match(route, /\.in\("location_id", ids\)/, "one bounded read for the managed flag (no N+1)");
});

test("quick create supports name, address line 1 + 2, city/state/ZIP, cover image and gallery", () => {
  for (const name of ["name", "address", "address_line2"]) assert.match(LOC_PAGE, new RegExp(`name="${name}"`), name);
  assert.match(LOC_PAGE, /<LocationGeographyFields /, "city / state / ZIP");
  assert.match(LOC_PAGE, /<MemberLocationImageField locationId=\{null\} label="Cover image" name="cover_image_url"/);
  assert.match(LOC_PAGE, /<MemberLocationGalleryField locationId=\{null\} name="gallery_image_url"/);
  assert.match(createLoc, /address_line2: clean\(addressLine2\),/);
  assert.match(createLoc, /isRenderableImageUrl\(coverImageUrl\) \? \{ cover_image_url: coverImageUrl \}/, "only Findmi-stored images");
  assert.match(createLoc, /\.from\("location_images"\)\.insert\(galleryUrls\.map/);
  assert.match(LOC_ACTIONS, /export async function uploadNewLocationImage\(formData: FormData\)/);
  // Geocoding still queued for every new Location.
  assert.match(createLoc, /queueLocationGeocode\(\[locationId\]\);/);
});

test("after submit: 'Location submitted' with Edit Location Further and Add Another Location — never a huge edit form", () => {
  assert.match(LOC_PAGE, /Location Submitted/);
  assert.match(LOC_PAGE, /Edit Location Further/);
  assert.match(LOC_PAGE, /Add hours, contact information, amenities and more\./);
  assert.match(LOC_PAGE, /href=\{`\/account\/location\/\$\{submitted\}`\}/, "the existing full Location Manager");
  assert.match(LOC_PAGE, /Add Another Location/);
  assert.match(createLoc, /const next = new URLSearchParams\(\{ submitted: locationId, business_id: businessId \}\);/);
  assert.doesNotMatch(createLoc, /tab=findmi-here&view=locations&\$\{query\}/, "no longer dropped straight back into the manager view");
});

// ── Event quick create ──────────────────────────────────────────────────
test("Host An Event quick create has the useful fields (and reuses the one schedule model)", () => {
  assert.match(EVENT_PAGE, /<EventNameWithSuggestions /, "the name is not a blind text field");
  assert.match(EVENT_PAGE, /name="description"/);
  assert.match(EVENT_PAGE, /<MemberEventImageField eventId=\{null\} label="Cover \/ Flyer" name="cover_image_url"/);
  assert.match(EVENT_PAGE, /<MemberEventGalleryField eventId=\{null\} name="gallery_image_url"/);
  assert.match(EVENT_PAGE, /<ParticipatingBusinessesPicker /);
  assert.match(EVENT_PAGE, /<EventGeographyFields/, "Location: search existing first / quick create / manual");
  assert.match(EVENT_PAGE, /<CategorySubcategoryField /);
  assert.match(EVENT_PAGE, /<EventFormatField /);
  for (const n of ["external_url", "rsvp_url", "rsvp_cta", "tickets_url"]) assert.match(EVENT_PAGE, new RegExp(`name="${n}"`), n);
  assert.match(EVENT_PAGE, /<EventScheduleFields/, "Single Date / Date Range / Multiple Dates");
  assert.doesNotMatch(EVENT_PAGE, /public on Findmi right away/, "Business submissions are pending review now");
});

test("quick-create details are validated before creation and written to the EXISTING Event columns / tables", () => {
  assert.match(createEvent, /const quick = readQuickCreateDetails\(formData\);\s*if \(quick\.error\) fail\(quick\.error\);/);
  assert.match(EVENT_ACTIONS, /if \(rsvpRaw && !rsvp\) return \{ \.\.\.out, error: "RSVP \/ registration link: use a full https:\/\/ link\." \};/);
  assert.match(EVENT_ACTIONS, /Object\.assign\(out\.columns, attendanceEventColumns\(rsvp, tickets\)\);/);
  assert.match(createEvent, /\.from\("event_images"\)\.insert\(quick\.galleryUrls\.map\(\(url, i\) => \(\{ event_id: eventId, kind: "event" as const/);
  assert.match(EVENT_ACTIONS, /export async function uploadNewEventImage\(formData: FormData\)/);
});

test("participating Businesses: existing Findmi Businesses only, invited through the ONE participant write", () => {
  const picker = read("src/components/event/ParticipatingBusinessesPicker.tsx");
  assert.match(picker, /useAccountSearch\("businesses"/);
  assert.doesNotMatch(picker, /createMemberBusiness|insert\(/, "never creates a Business");
  assert.match(createEvent, /for \(const b of \(\(real \?\? \[\]\) as \{ id: string \}\[\]\)\.filter\(\(b\) => b\.id !== hostBusinessId\)\) \{\s*await inviteBusinessToEvent\(admin, \{ eventId, businessId: b\.id, userId: user\.id \}\);/);
  // Event Manager's own invite uses the same core.
  assert.match(EVENT_ACTIONS, /export async function inviteParticipatingBusiness[\s\S]*?await inviteBusinessToEvent\(admin, \{ eventId, businessId,/);
  assert.match(EVENT_ACTIONS, /\{ event_id: eventId, business_id: businessId, status: "invited", participation_scope: effectiveScope \}/, "never auto-approved");
});

test("Event name duplicate suggestions are bounded and debounced (no unbounded global search per keystroke)", () => {
  const fn = EVENT_ACTIONS.slice(EVENT_ACTIONS.indexOf("export async function suggestExistingEvents"));
  assert.match(fn, /const term = eventNameSearchTerm\(/);
  assert.match(fn, /if \(!term\) return \[\];/);
  assert.match(fn, /\.ilike\("name", term\)/, "trigram-indexed name filter");
  assert.match(fn, /\.limit\(20\)/);
  assert.match(fn, /\.in\("event_id", visible\.map\(\(e\) => e\.id\)\)/, "one batched Location read, never per row");
  assert.match(fn, /\(!e\.is_demo && e\.publication_status === "live"\) \|\| \(businessId && e\.host_business_id === businessId\)/, "never reveals someone else's unpublished Event");
  assert.match(read("src/components/event/EventNameWithSuggestions.tsx"), /EVENT_NAME_DEBOUNCE_MS = 400/);
});

test("Event submitted → pending review, with the post-submit choice into the full Event Manager", () => {
  assert.match(EVENT_PAGE, /Event Submitted/);
  assert.match(EVENT_PAGE, /Edit Event Further/);
  assert.match(EVENT_PAGE, /Add Another Event/);
  assert.match(EVENT_PAGE, /\{live === "1" \? "Live" : "Pending Review"\}/);
});

test("manual venue details are never silently disconnected: matching runs and the outcome is stated", () => {
  const field = read("src/components/account/EventLocationField.tsx");
  assert.match(field, /These venue details stay on this Event only — they don&rsquo;t create a Findmi Location\./);
  assert.match(field, /<ManualVenueMatches query=/);
  assert.match(field, /Use This Location/);
  assert.match(read("src/components/places/PlaceFindOrCreate.tsx"), /fd\.set\("address_line2", form\.address_line2\.trim\(\)\)/, "inline Location create supports Address Line 2");
});

// ── Products ─────────────────────────────────────────────────────────────
test("Product Marketplace submission states checkout readiness instead of silently not listing", () => {
  // Product + Marketplace + Want pass: readiness is the canonical rule's
  // answer (both gates + exact blockers), never a page-local formula.
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /loadMarketplaceReadiness\(admin, productRows \?\? \[\], \(\) => businessCommerce\)/);
  assert.match(page, /<MarketplaceReadinessPanel readiness=\{p\.readiness\} demand=\{p\.demand\} audience="owner" \/>/);
  assert.match(page, /if \(p\.marketplaceStatus === "approved"\) return \{ label: "Approved · Checkout not ready", tone: "attention" \};/);
  assert.doesNotMatch(page, /checkoutReady/);
});
