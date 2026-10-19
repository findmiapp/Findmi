// Personal/Account UX Correction pass — restoring Create Event as a
// universal entry point (never a Personal publishing path), removing
// Findmi Market/Area from the user-facing Add A Location form, the
// Account Home discovery reorder, From Brands You Follow's truthful
// multi-type filtering, the intent-based rail, Brand card logo
// treatment, and Saved-preview removal. Pure functions where they exist;
// source checks only for Server Component wiring this environment can't
// render (no jsdom). No network, no Production data.
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

const read = (p) => readFileSync(p, "utf8");
const H = await import("../src/lib/account-home.ts");

const MENU = read("src/components/QuickCreateMenu.tsx");
const EVENT_NEW = read("src/app/(public)/account/event/new/page.tsx");
const LOC_NEW = read("src/app/(public)/account/location/new/page.tsx");
const LOC_GEO = read("src/components/LocationGeographyFields.tsx");
const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");
const HOME = read("src/app/(public)/account/page.tsx");
const DISCOVERY_TILE = read("src/components/discovery/DiscoveryTile.tsx");
const DISCOVERY_SERVER = read("src/lib/discovery/server.ts");
const PERSONAL_SHELL = read("src/app/(public)/account/PersonalAppShell.tsx");

// ── 1. Create Event — universal entry point ─────────────────────────────

test("Create Event is restored to the global Create menu, as a plain Link like every other entry", () => {
  assert.match(MENU, /href="\/account\/event\/new"/);
  assert.match(MENU, /label="Create Event"/);
  assert.doesNotMatch(MENU, /Deliberately NOT here:[^.]*Events/, "the old 'deliberately not here' note about Events must be gone");
});

test("signed-in, eligible Pages: the chooser lists them with real logo/cover media and a rounded-square fallback, never a Personal form", () => {
  assert.match(EVENT_NEW, /if \(!businessContext && !managedLocation\) return <ChooseEventPage userId=\{user\.id\} \/>;/);
  assert.match(EVENT_NEW, /\.from\("business_members"\)\s*\n\s*\.select\("role, business:businesses\(id, name, logo_url\)"\)/);
  assert.match(EVENT_NEW, /\.from\("location_members"\)\s*\n\s*\.select\("role, location:locations\(id, name, logo_url, cover_image_url\)"\)/);
  // Same rounded-square identity + initial-letter fallback language as
  // AccountContextSwitcher — no second image system invented.
  assert.match(EVENT_NEW, /rounded-xl border border-black\/\[0\.06\] bg-white/);
  assert.match(EVENT_NEW, /\{p\.name\.charAt\(0\)\.toUpperCase\(\)\}/);
  assert.match(EVENT_NEW, /Choose who is publishing this Event\./);
  assert.doesNotMatch(EVENT_NEW, /name="business_id"[\s\S]{0,50}ChooseEventPage/);
});

test("no eligible Page: guidance (Add A Business / Add A Location / find-and-claim), never a dead end", () => {
  const chooser = EVENT_NEW.slice(EVENT_NEW.indexOf("async function ChooseEventPage"));
  assert.match(chooser, /Events on Findmi are published by a Page you manage\./);
  assert.match(chooser, /href="\/account\/business\/new"/);
  assert.match(chooser, /href="\/account\/location\/new"/);
  assert.match(chooser, /find one you represent and claim it/);
});

test("signed-out: Create Event stays visible and explains itself + offers Log In / Create Account, never a bare redirect or anonymous publication", () => {
  assert.match(EVENT_NEW, /if \(!user\) \{/);
  assert.match(EVENT_NEW, /Events on Findmi are published through a Business or Location Page\./);
  assert.match(EVENT_NEW, /href=\{`\/login\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  assert.match(EVENT_NEW, /href=\{`\/signup\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  assert.doesNotMatch(EVENT_NEW, /redirect\(`\/login\?next=\$\{encodeURIComponent\(next\)\}`\)/, "no longer a bare unconditional redirect");
});

test("server-side authorization for Event creation is unweakened: eventCreationContext still gates createMemberEvent", () => {
  const actions = read("src/app/(public)/account/event/actions.ts");
  assert.match(actions, /const creationContext = eventCreationContext\(\{/);
  assert.match(actions, /if \(!creationContext\.ok\) \{\s*\n\s*fail\(/);
});

// ── 2. Location creation — no Findmi Market/Area for ordinary users ─────

test("Add A Location's user-facing form has no Findmi Market/Area picker — factual geography only", () => {
  assert.doesNotMatch(LOC_GEO, /MarketAreaFields/);
  assert.doesNotMatch(LOC_GEO, /Findmi area|Specific area|Suggested Findmi area/);
  assert.doesNotMatch(LOC_GEO, /useGeographySuggestion/);
  assert.match(LOC_GEO, /name="city"/);
  assert.match(LOC_GEO, /name="state"/);
  assert.doesNotMatch(LOC_NEW, /getActiveMarketsWithAreaOptions|markets=\{/);
  // Location Creation + Icon Consistency pass — the "Exact place"
  // picker is ALSO gone now (redundant immediately after City/State/ZIP
  // on a basic form); see tests/location-creation-context.test.mjs for
  // the full coverage of that pass. The underlying geocoding stays.
  assert.doesNotMatch(LOC_GEO, /CanonicalGeographyPicker|Set an exact place/);
});

test("createMemberLocation never required a Market — no schema/validation change needed, no migration", () => {
  const start = LOC_ACTIONS.indexOf("export async function createMemberLocation");
  const body = LOC_ACTIONS.slice(start, LOC_ACTIONS.indexOf("\n}\n", start));
  // The only Market-related check is mutual exclusivity (market_id AND a
  // text request can't both be set) — never a required-Market check —
  // and the insert always allows a null market_id.
  assert.doesNotMatch(body, /fail\("(Choose|Select) a (Market|Findmi Area)/);
  assert.match(body, /market_id: effectiveMarketId \|\| null,/);
  // Admin's own geography tools / canonical geography / existing Location
  // data are completely untouched by this pass.
  assert.match(body, /if \(effectiveMarketId\) \{/);
});

// ── 3. Location connection intent — required, no default, both layers ──

test("Location Creation + Icon Consistency pass: the connection question moved BEFORE the factual form and is no longer re-asked there", () => {
  // The old visible "Your Connection To This Location" radios are gone —
  // context (generic vs a specific Business) is resolved in Step 1 now;
  // see tests/location-creation-context.test.mjs for the full coverage.
  assert.doesNotMatch(LOC_NEW, /Your Connection To This Location/);
  assert.doesNotMatch(LOC_NEW, /type="radio" name="intent"/);
  assert.match(LOC_NEW, /<input type="hidden" name="intent" value="adding" \/>/);
});

test("a missing/invalid Location connection intent is independently rejected server-side, not just by HTML `required`", async () => {
  const start = LOC_ACTIONS.indexOf("export async function createMemberLocation");
  const body = LOC_ACTIONS.slice(start, LOC_ACTIONS.indexOf("\n}\n", start));
  assert.match(body, /const intent = parseLocationIntent\(formData\.get\("intent"\)\);/);
  assert.match(body, /if \(!intent\) fail\(/);
  // parseLocationIntent itself only ever accepts the two real values.
  const C = await import("../src/lib/capabilities.ts");
  assert.equal(C.parseLocationIntent("manage"), "manage");
  assert.equal(C.parseLocationIntent("adding"), "adding");
  assert.equal(C.parseLocationIntent(""), null);
  assert.equal(C.parseLocationIntent(undefined), null);
  assert.equal(C.parseLocationIntent("owner"), null);
});

// ── 4–6, 8. Account Home reorder, From Brands filtering, Saved removal ──

test("Account Home: Events You Might Like is the first discovery rail after the greeting", () => {
  const greeting = HOME.indexOf("<Greeting />");
  const firstRail = HOME.indexOf('id="events-you-might-like"');
  const anyOtherRail = Math.min(
    ...["from-brands", "upcoming-events", "places-you-might-like", "products-you-might-like", "brands-you-might-like", "your-moments", "pages-i-manage"].map((id) =>
      HOME.indexOf(`id="${id}"`)
    )
  );
  assert.ok(greeting > 0 && greeting < firstRail, "Events You Might Like comes after the greeting");
  assert.ok(firstRail > 0 && firstRail < anyOtherRail, "Events You Might Like is the FIRST discovery rail");
});

test("fromBrandsTiles includes Events and Places only when the caller actually has them — never fabricated", () => {
  const products = [{ id: "p1", slug: "mug", name: "Mug", image_url: null, business_id: "b1", businessName: "Acme" }];
  const moments = [];
  const events = [{ id: "e1", title: "Pop-Up", href: "/event/e1", imageUrl: null, date: "2026-10-20" }];
  const locations = [{ id: "l1", slug: "store", name: "Acme Store", imageUrl: null }];
  const withAll = H.fromBrandsTiles(products, moments, events, locations);
  assert.deepEqual(new Set(withAll.map((t) => t.kind)), new Set(["product", "event", "location"]));
  // Omitting events/locations (the default) never invents them.
  const withoutExtra = H.fromBrandsTiles(products, moments);
  assert.deepEqual(new Set(withoutExtra.map((t) => t.kind)), new Set(["product"]));
});

test("FromBrandsSection filters the already-fetched tiles client-side by real kind only — no new query", () => {
  const fb = read("src/app/(public)/account/FromBrandsSection.tsx");
  assert.match(fb, /"use client";/);
  assert.match(fb, /const \[tab, setTab\] = useState/);
  assert.doesNotMatch(fb, /fetch\(|supabase|await /, "purely client-side filtering of props already fetched server-side");
  for (const label of ["Moments", "Events", "Products", "Places"]) assert.ok(fb.includes("`${WORLD_KIND_LABEL[k]}s`") || fb.includes(label), label);
});

test("Upcoming Events 'See All' never points at the generic /account/following directory", () => {
  const section = HOME.slice(HOME.indexOf('id="upcoming-events"'), HOME.indexOf('id="places-you-might-like"'));
  assert.doesNotMatch(section, /\/account\/following/);
});

test("Brand recommendation cards show the real Brand logo as its own identity mark, cover stays separate", () => {
  assert.match(DISCOVERY_SERVER, /logo: b\.logo_url \?\? null,/);
  assert.match(DISCOVERY_TILE, /item\.kind === "business" && item\.logo/);
  // The cover's own precedence (cover first, logo only as a fallback for
  // `image`) is unchanged — the logo badge is additive, never a
  // replacement for every other kind's existing image.
  assert.match(DISCOVERY_SERVER, /image: b\.cover_image_url \?\? b\.logo_url \?\? null,/);
});

test("Saved preview rail is gone from Account Home; Saved functionality itself is completely untouched", () => {
  assert.doesNotMatch(HOME, /id="saved"/);
  assert.doesNotMatch(HOME, /SAVED_COLLECTIONS|collectionCounts/, "no longer imported/computed on this page");
  // /account/saved, Save buttons, intent relationships and
  // save-organization.ts itself are never referenced here for deletion —
  // this test only proves the PREVIEW RAIL is gone from account/page.tsx.
  assert.doesNotMatch(HOME, /savedChips\.map|savedTiles\.map/);
});

// ── 7. Intent-based recommendation rail — real signal or nothing ───────

test("pickIntentSeed prefers Want, then Must Do, then Have/Been, and returns null with no qualifying signal", () => {
  assert.equal(H.pickIntentSeed([]), null);
  // A product-only relation has nothing this mechanism can seed from.
  assert.equal(H.pickIntentSeed([{ entity_type: "product", entity_id: "p1", relation: "want" }]), null);
  const want = H.pickIntentSeed([
    { entity_type: "event", entity_id: "e1", relation: "want" },
    { entity_type: "location", entity_id: "l1", relation: "must_do" },
  ]);
  assert.equal(want.relation, "want");
  assert.deepEqual([...want.seedIds], ["e1"]);
  const mustDo = H.pickIntentSeed([{ entity_type: "location", entity_id: "l1", relation: "must_do" }]);
  assert.equal(mustDo.relation, "must_do");
  const haveBeen = H.pickIntentSeed([
    { entity_type: "event", entity_id: "e2", relation: "have" },
    { entity_type: "event", entity_id: "e3", relation: "been" },
  ]);
  assert.equal(haveBeen.relation, "have_been");
  assert.deepEqual(new Set([...haveBeen.seedIds]), new Set(["e2", "e3"]));
});

test("the intent rail's consumer-readable titles are not database terms", () => {
  for (const title of Object.values(H.INTENT_SECTION_TITLE)) {
    assert.doesNotMatch(title, /must_do|have_been|relation|entity_type/i);
  }
});

test("Account Home omits the intent rail entirely when there's no qualifying signal — no fake content", () => {
  assert.match(HOME, /const intentSeed = pickIntentSeed\(\(relationRows \?\? \[\]\) as RelationRow\[\]\);/);
  assert.match(HOME, /const intentItems = intentCandidates\.length >= MIGHT_LIKE_MIN \? intentCandidates : \[\];/);
  assert.match(HOME, /\{intentItems\.length > 0 && intentTitle && \(/);
});

// ── 11. Preserved: Personal bottom nav stays Home / My Moments / Inbox / More ──

test("Personal bottom nav is unchanged: Home, My Moments, Inbox, More — no Schedule", () => {
  assert.doesNotMatch(PERSONAL_SHELL, /key: "schedule"/);
  assert.match(PERSONAL_SHELL, /key: "home".*primary: true/);
  assert.match(PERSONAL_SHELL, /key: "myworld".*primary: true/);
  assert.match(PERSONAL_SHELL, /key: "inbox".*primary: true/);
  assert.match(PERSONAL_SHELL, /grid max-w-lg grid-cols-4/);
});
