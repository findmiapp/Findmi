// Location Creation + Icon Consistency pass — Add A Location now resolves
// publishing context FIRST (same principle as Create Event's own Page
// chooser), the redundant "Your Connection To This Location" question
// moved out of the factual form, the user-facing form is reduced to
// Location Name / Address / City / State / ZIP Code (no Findmi Market,
// no Specific Area, no Exact Place picker — all investigated and
// confirmed schema-safe, no migration), and the old radar/target Moments
// icon usage (there wasn't any left) is independently re-confirmed.
// Source checks only for Server Component wiring this environment can't
// render (no jsdom). No network, no Production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const LOC_NEW = read("src/app/(public)/account/location/new/page.tsx");
const LOC_GEO = read("src/components/LocationGeographyFields.tsx");
const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");
const MENU = read("src/components/QuickCreateMenu.tsx");
const PRESENCE = read("src/app/(public)/account/business/[id]/v2/PresenceViews.tsx");
const LOC_DETAIL = read("src/app/(public)/account/location/[id]/page.tsx");
const NAV_ICON = read("src/components/NavIcon.tsx");
const MORE_MENU = read("src/app/(public)/account/business/[id]/v2/MoreMenu.tsx");
const BIZ_SHELL = read("src/app/(public)/account/business/[id]/v2/BusinessAppShell.tsx");
const PERSONAL_SHELL = read("src/app/(public)/account/PersonalAppShell.tsx");

const START = LOC_ACTIONS.indexOf("export async function createMemberLocation");
const createLoc = LOC_ACTIONS.slice(START, LOC_ACTIONS.indexOf("\n}\n", START));

// ── Entry point: global Create → Add A Location enters context-first ───

test("the global Create menu's Add A Location still enters the generic (unknown-context) route", () => {
  assert.match(MENU, /href="\/account\/location\/new"/);
  // No business_id/parent_location_id here — this is exactly the
  // "unknown context" case the chooser below exists for.
  assert.doesNotMatch(MENU, /account\/location\/new\?(business_id|parent_location_id)/);
});

test("unknown context (no business_id, no parent_location_id, no ?context=generic) renders the chooser for a signed-in visitor, never the factual form directly", () => {
  assert.match(LOC_NEW, /const hasKnownContext = Boolean\(business\) \|\| Boolean\(parent\) \|\| contextParam === "generic" \|\| !user;/);
  assert.match(LOC_NEW, /if \(!hasKnownContext\) return <ChooseLocationContext userId=\{user!\.id\} \/>;/);
});

test("Guest-First Creation pass — a signed-out visitor always skips the chooser (it lists Businesses only a signed-in person could manage) straight to the plain generic form", () => {
  assert.match(LOC_NEW, /\|\| !user;/);
});

test("'I'm Just Adding It To Findmi' is the first/default choice, truthfully copied, and grants no management", () => {
  const chooser = LOC_NEW.slice(LOC_NEW.indexOf("async function ChooseLocationContext"));
  const justAdding = chooser.indexOf("I&rsquo;m Just Adding It To Findmi");
  const addAsBusiness = chooser.indexOf("Add As A Business");
  assert.ok(justAdding > 0, "the generic choice exists");
  assert.ok(addAsBusiness === -1 || justAdding < addAsBusiness, "generic choice comes first, before any Business list");
  assert.match(chooser, /This place is missing from Findmi\./);
  assert.match(chooser, /href="\/account\/location\/new\?context=generic"/);
});

test("eligible Businesses (Owner/Manager) appear as contexts with real logo/fallback identity treatment, never lifeless text rows", () => {
  const chooser = LOC_NEW.slice(LOC_NEW.indexOf("async function ChooseLocationContext"));
  assert.match(chooser, /\.from\("business_members"\)\s*\n\s*\.select\("role, business:businesses\(id, name, logo_url\)"\)\s*\n\s*\.eq\("user_id", userId\)\s*\n\s*\.in\("role", \["owner", "manager"\]\);/);
  // Same rounded-square + initial-letter fallback language as the Event
  // Page chooser / AccountContextSwitcher — no second image system.
  assert.match(chooser, /rounded-xl border border-black\/\[0\.06\] bg-white object-contain p-1/);
  assert.match(chooser, /\{b\.name\.charAt\(0\)\.toUpperCase\(\)\}/);
  assert.match(chooser, /href=\{`\/account\/location\/new\?business_id=\$\{b\.id\}`\}/);
});

test("known Business context (?business_id=, e.g. from the Business workspace) bypasses the chooser entirely", () => {
  assert.match(PRESENCE, /const createHref = `\/account\/location\/new\?business_id=\$\{encodeURIComponent\(businessId\)\}`;/);
  // resolveBusinessContext resolving truthy is itself what sets
  // hasKnownContext — no separate "skip the chooser" flag needed.
  assert.match(LOC_NEW, /const \[business, parent\] = await Promise\.all\(\[resolveBusinessContext\(businessIdParam\), resolveParentContext\(parentIdParam\)\]\);/);
});

test("parent-Location context (?parent_location_id=, from a managed Location's own 'Add A Location Inside') remains intact", () => {
  assert.match(LOC_DETAIL, /href=\{`\/account\/location\/new\?parent_location_id=\$\{id\}`\}/);
  assert.match(LOC_NEW, /async function resolveParentContext\(locationId: string \| undefined\)/);
  assert.match(LOC_NEW, /isPageManagerRole\(\(await requireLocationMember\(locationId\)\)\.role\)/);
});

test("child-Location creation is NOT added to the generic chooser — investigated and intentionally left out (no clear 'from the global entry point' semantics)", () => {
  const chooser = LOC_NEW.slice(LOC_NEW.indexOf("async function ChooseLocationContext"), LOC_NEW.indexOf("async function resolveBusinessContext"));
  assert.doesNotMatch(chooser, /location_members|parent_location_id/);
});

// ── Business context != Location ownership ──────────────────────────────

test("selecting a Business as context never implies Location management — only the existing business_locations relationship", () => {
  assert.match(createLoc, /const linked = await linkBusinessLocation\(admin, businessId, locationId\);/);
  assert.doesNotMatch(createLoc, /business_members"\)\.insert/, "no new relationship table/management grant invented");
  // The hidden intent is hardcoded to "adding" for every submission from
  // this flow — a Business context never silently escalates to "manage".
  assert.match(LOC_NEW, /<input type="hidden" name="intent" value="adding" \/>/);
});

test("'Your Connection To This Location' is gone from the second-step form — resolved in Step 1, never re-asked", () => {
  assert.doesNotMatch(LOC_NEW, /Your Connection To This Location/);
  assert.doesNotMatch(LOC_NEW, /type="radio" name="intent"/);
  assert.doesNotMatch(LOC_NEW, /I Manage This Location/);
});

test("generic 'Just Adding' submission creates the Location only — no claim request — while the claim/manage infrastructure itself stays available", () => {
  // intent is always "adding" from this UI now, so the existing
  // intent==="manage" branch (location_claim_requests insert) is never
  // reached from here — but it is NOT deleted.
  assert.match(createLoc, /if \(intent === "manage"\) \{/);
  assert.match(createLoc, /\.from\("location_claim_requests"\)\.insert\(\{/);
  // The cleanest existing place to request management of an existing
  // Location stays ClaimButton (type="location") on its own page/profile
  // — untouched, not folded into this basic creation form.
  const claimButton = read("src/components/ClaimButton.tsx");
  assert.match(claimButton, /"business" \| "event" \| "location"/);
});

// ── Factual form fields ──────────────────────────────────────────────────

test("the factual form contains Location Name, Address line 1 / line 2, City, State, ZIP Code (+ optional photos)", () => {
  assert.match(LOC_NEW, /Location name/);
  assert.match(LOC_NEW, /<span className="mb-1\.5 block text-body font-medium text-primary">Address line 1<\/span>/);
  assert.match(LOC_NEW, /Address line 2 <span className="font-normal text-subtle">\(optional\)<\/span>/);
  assert.match(LOC_NEW, /name="address_line2"/);
  assert.match(LOC_GEO, /<span className="mb-1\.5 block text-sm font-medium text-ink">City<\/span>/);
  assert.match(LOC_GEO, /<span className="mb-1\.5 block text-sm font-medium text-ink">State<\/span>/);
  assert.match(LOC_GEO, /<span className="mb-1\.5 block text-sm font-medium text-ink">ZIP Code<\/span>/);
  assert.match(LOC_GEO, /name="postal_code"/);
});

test("the user-facing form has no Findmi Market, Specific Area or Exact Place control", () => {
  assert.doesNotMatch(LOC_GEO, /Findmi area|Specific area|MarketAreaFields/);
  assert.doesNotMatch(LOC_GEO, /CanonicalGeographyPicker|Set an exact place/);
  assert.doesNotMatch(LOC_NEW, /getActiveMarketsWithAreaOptions/);
});

test("ZIP persists to the existing canonical schema field (locations.postal_code) — same column Admin's own LocationForm already writes, no duplicate field, no migration", () => {
  assert.match(createLoc, /const postalCode = str\(formData, "postal_code"\);/);
  assert.match(createLoc, /postal_code: clean\(postalCode\),/);
  const adminForm = read("src/app/admin/(protected)/locations/LocationForm.tsx");
  assert.match(adminForm, /name="postal_code"/);
  // Strengthens the EXISTING duplicate-detection using its own already-
  // supported optional param — not a new mechanism.
  assert.match(createLoc, /findLikelyDuplicateLocations\(admin, \{ name: name!, address, city, state, postal_code: postalCode \}\)/);
});

test("an errored generic submission round-trips back to the factual form, not back to the chooser", () => {
  assert.match(createLoc, /context: businessId \|\| parentLocationId \? null : "generic",/);
});

// ── Signed-out: visible, no dead explanatory branch behind middleware ──

test("signed-out: Add A Location stays visible from the global Create menu; the real form is now reachable directly (Guest-First Creation pass), with identity only required at actual submit", () => {
  assert.doesNotMatch(MENU, /if \(!authenticated\)[\s\S]{0,50}return null/);
  // Guest-First Creation pass — the page itself no longer redirects a
  // signed-out visitor away; middleware's own carve-out for this exact
  // path (below) is what makes that reachable at all. Submission still
  // goes through the real server action, which establishes identity (see
  // createMemberLocation's own guest/resume redirect) — never an
  // anonymous write.
  assert.doesNotMatch(LOC_NEW, /if \(!user\) redirect\(`\/login\?next=\$\{encodeURIComponent\(selfPath\)\}`\);/);
  assert.match(LOC_NEW, /GuestCreateSubmit/);
  assert.doesNotMatch(LOC_NEW, /Events on Findmi are published/, "no Event-style explanatory card copied in here");
  const middleware = read("src/middleware.ts");
  assert.match(middleware, /GUEST_ACCESSIBLE_PATHS = new Set\(\["\/account\/business\/new", "\/account\/location\/new", "\/account\/event\/new"\]\);/);
  assert.match(middleware, /if \(!user && GUEST_ACCESSIBLE_PATHS\.has\(pathname\)\) return response;/);
  assert.match(middleware, /matcher: \["\/admin\/:path\*", "\/account\/:path\*", "\/my-world\/journal\/:path\*"\]/);
});

// ── Site-wide Moments icon audit ────────────────────────────────────────

test("the canonical Moments icon is the dedicated photo/image glyph, distinct from the radar/target icon", () => {
  assert.match(NAV_ICON, /case "moments":/);
  assert.match(NAV_ICON, /Moments — a photo \(Moments are captured experiences\)\. Distinct\s*\n\s*\/\/ from "target", which also means Performance \/ Analytics\./);
});

test("'My Journal' (Personal bottom nav) uses the canonical photo icon, not target/radar", () => {
  assert.match(PERSONAL_SHELL, /key: "myworld", label: "My Journal", href: "\/journal", icon: <NavIcon name="moments"/);
  assert.doesNotMatch(PERSONAL_SHELL, /label: "My Journal"[^}]*NavIcon name="target"/);
});

test("the two remaining NavIcon target/radar usages are legitimately Performance/Analytics, not Moments — correctly left alone", () => {
  // Business Manager redesign: Performance is a primary bottom-nav slot, so
  // the More menu no longer repeats it.
  assert.doesNotMatch(MORE_MENU, /label: T\.performance\.label/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/business-nav.ts"), /performance: \{ label: navLabel\("performance"\)/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/business-nav.ts"), /label: "Performance", tab: "performance"/);
  assert.match(BIZ_SHELL, /performance: <InsightsGlyph/);
  assert.doesNotMatch(MORE_MENU, /label: "Moments?"[^}]*NavIcon name="target"/);
});

test("no duplicated radar/target-shaped SVG exists outside NavIcon.tsx (nothing to migrate — the old Moments usage was already gone)", () => {
  // The target icon's own distinctive 4-tick-mark crosshair path is
  // unique to its one definition; a duplicate elsewhere would be a
  // second near-identical icon this pass's "ONE canonical icon" rule
  // forbids.
  const TICKS = 'd="M12 2v3M12 19v3M2 12h3M19 12h3"';
  const quickCreate = read("src/components/QuickCreateMenu.tsx");
  const opportunityGlyphs = read("src/components/opportunities/OpportunityGlyphs.tsx");
  for (const src of [quickCreate, opportunityGlyphs, PERSONAL_SHELL]) assert.doesNotMatch(src, new RegExp(TICKS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
