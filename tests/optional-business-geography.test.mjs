// VCL A2b — Optional Business geography. A Business does not require City,
// State or a Market ("No geography is better than false geography"). Brand
// onboarding's Review Your Brand shows NO geography and the server ignores
// any submitted for source=brand, so a Brand is created with no city/state,
// no business_markets row and no market_requests row. The ordinary creation
// form keeps its required City/State → Market / Market Request behavior.
// Source guards on the form, server action and the one forward-only
// migration (no rendering harness, no database here — the migration itself
// was exercised against a disposable Postgres).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sql = (src) => src.replace(/--.*$/gm, "");

const FILE = "20261014000000_optional_business_geography.sql";
const MIGRATION = sql(read(`supabase/migrations/${FILE}`));
const PREVIOUS = sql(read("supabase/migrations/20260905230000_area_picker_and_market_requests.sql"));
const FIELDS = code(read("src/components/BusinessGeographyFields.tsx"));
const NEW_PAGE = code(read("src/app/(public)/account/business/new/page.tsx"));
const CREATE = read("src/app/(public)/account/business/actions.ts");
const MANAGER = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
const fnBody = (src) => {
  const start = src.search(/create or replace function public\.create_owned_business\(/i);
  return src.slice(start, src.indexOf("$function$;", start) + 11);
};

// ── Review Your Brand ────────────────────────────────────────────────────
test("Brand review renders no geography section: no Location, City, State, Market or Market request UI", () => {
  // The only geography render is gated to the ordinary (non-Brand) form.
  assert.match(NEW_PAGE, /\{!brandOnboarding && geography\}/);
  assert.equal((NEW_PAGE.match(/\bgeography\}/g) ?? []).length, 1, "rendered in exactly one, non-Brand place");
  assert.doesNotMatch(NEW_PAGE, /(?<!!)brandOnboarding && geography/);
  assert.doesNotMatch(NEW_PAGE, /optional=\{brandOnboarding\}/);
  // The page itself carries no geography inputs of its own.
  assert.doesNotMatch(NEW_PAGE, /name="(city|state|market_id|requested_market_text|postal_code|zip|address|country)"/);
  assert.doesNotMatch(NEW_PAGE, />\s*Location\b/);
});

test("extracted city/state can't become submitted Brand geography: the server ignores it for source=brand", () => {
  assert.match(CREATE, /const brandOnboarding = parseBrandSource\(str\(formData, "source"\)\);[\s\S]*?const city = brandOnboarding \? null : str\(formData, "city"\);\s*const state = brandOnboarding \? null : str\(formData, "state"\);/);
  assert.match(CREATE, /const marketId = brandOnboarding \? null : str\(formData, "market_id"\);/);
  assert.match(CREATE, /const requestedMarketText = brandOnboarding \? null : str\(formData, "requested_market_text"\);/);
  // No later code reads geography from the form or the brand draft.
  const body = CREATE.slice(CREATE.indexOf("export async function createMemberBusiness"));
  const fn = body.slice(0, body.indexOf("\nexport async function", 10));
  assert.equal((fn.match(/str\(formData, "(city|state|market_id|requested_market_text)"\)/g) ?? []).length, 4);
  assert.doesNotMatch(fn, /draft\??\.(city|state)/);
});

test("Brand creation needs no geography; ordinary creation keeps City/State required (Market/Area now optional)", () => {
  assert.match(CREATE, /if \(!brandOnboarding && \(!city \|\| !state\)\) fail\("City and state are required\."\);/);
  // Canonical Entity Geography pass — a Market/Area is no longer a hard
  // requirement at creation (city/state alone resolve to canonical
  // geography); the old "choose a Market or request one" fail() is gone.
  assert.doesNotMatch(CREATE, /fail\("Choose a Primary Market, or request one below\."\);/);
  assert.match(CREATE, /if \(marketId && requestedMarketText\) \{\s*fail\("Choose an existing Market OR request one, not both\."\);/);
  // The shared geography component's City/State themselves are unchanged
  // for the ordinary form — still required, never labeled optional.
  // Business Creation UX Cleanup pass — the "Set an exact place (optional)"
  // disclosure is gone entirely (see tests/canonical-entity-geography-
  // completion.test.mjs test 2), so "optional" is asserted absent from
  // the whole file now, not just above some marker.
  assert.equal((FIELDS.match(/^\s*required\s*$/gm) ?? []).length, 2, "city and state required");
  assert.doesNotMatch(FIELDS, /optional/i);
  // Genuinely unmatched geography no longer forwards to
  // p_requested_market_text at all (no automatic market_requests row) —
  // the RPC call itself is unchanged, but what feeds its
  // p_requested_market_text argument now only ever carries null.
  const rpc = CREATE.slice(CREATE.indexOf('admin.rpc("create_owned_business"'), CREATE.indexOf("});", CREATE.indexOf('admin.rpc("create_owned_business"')));
  assert.match(rpc, /p_city: city,\s*p_state: state,/);
  assert.match(rpc, /p_market_id: effectiveMarketId,\s*p_requested_market_text: effectiveRequestedMarketText,/);
  assert.match(CREATE, /const effectiveRequestedMarketText: string \| null = null;/, "never forwards free text to the RPC — see Canonical Entity Geography pass");
  assert.match(CREATE, /if \(requestedMarketText\) \{\s*const match = await findExistingGeographyMatch/, "matching only runs on real requested text");
});

test("Canonical Entity Geography — unmatched business geography is normal: no automatic Market Request", () => {
  const fn = CREATE.slice(CREATE.indexOf("export async function createMemberBusiness"));
  const body = fn.slice(0, fn.indexOf("\nexport async function", 10));
  // The matched-area follow-up still exists; nothing creates a
  // market_requests row for the unmatched case any more.
  assert.doesNotMatch(body, /createLinkedMarketRequest/);
  assert.match(body, /if \(!brandOnboarding && city && state\) \{/, "best-effort canonical geo resolution runs after creation");
  assert.match(body, /geo_resolution: explicitGeoKey \? "selected" : "derived"/);
});

test("no National/Online Market, ZIP, address, country or HQ inference added", () => {
  for (const src of [FIELDS, NEW_PAGE, CREATE, MIGRATION]) {
    assert.doesNotMatch(src, /National|Online Market|"Online"|headquarters/i);
  }
});

test("creation authorization, duplicate protection and the A2 redirect remain", () => {
  // Guest-First Creation pass — identity is now established at submit via
  // a draft-preserving resume redirect (see createMemberBusiness's own
  // doc comment), not an unconditional top-of-function redirect.
  assert.match(CREATE, /if \(!user\) \{\s*const params = new URLSearchParams\(\);/);
  assert.match(CREATE, /if \(!authorized\) \{\s*fail\("Please confirm you're authorized to create and manage this business\."\);/);
  assert.match(CREATE, /const matches = await findBusinessMatches\(admin, \{/);
  assert.match(CREATE, /redirect\(`\/account\?created=\$\{businessId\}`\);/);
});

// ── The one migration ────────────────────────────────────────────────────
test("one forward-only migration, after the BD foundation, replacing only create_owned_business", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  // Its own position: right after the BD foundation (a later pass — Event
  // attendance — adds its own migration after it).
  assert.equal(files[files.indexOf(FILE) - 1], "20261013000000_bd_foundation.sql");
  assert.deepEqual(files.slice(files.indexOf(FILE) + 1), ["20261014010000_event_attendance_cta_and_location_visibility.sql", "20261015000000_business_location_availability.sql", "20261016000000_event_taxonomy_v1.sql" /* a later pass (Event Taxonomy V1) */, "20261017000000_event_formats_v1.sql" /* a later pass (Event Formats V1) */, "20261018000000_event_occurrence_details.sql" /* a later pass (Event Occurrence details) */, "20261018220515_discovery_lanes_add_placement.sql" /* a later pass (Discovery Lanes Placement) */, "20261018223910_discovery_lanes_set_primary_lane_rpc.sql" /* a later pass (atomic Make Primary RPC) */, "20261018224010_discovery_lanes_set_primary_lane_rpc_restrict_grants.sql" /* a later pass (atomic Make Primary RPC) */, "20261018233210_market_areas_add_image_url.sql" /* a later pass (Discovery Tile Visual System, Part B) */, "20261019000000_event_date_time_precision.sql" /* Event date/time precision pass */, "20261020000000_moment_authorship_and_access_history.sql" /* Identity & Authorship V1 pass */, "20261021000000_brand_audit_and_opportunity_ideas.sql" /* Brand Audit + Opportunity Ideas V1 pass */, "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */, "20261025000000_canonical_entity_geography.sql" /* Canonical Entity Geography pass */, "20261026000000_business_availability_details.sql" /* Business Manager redesign: Where To Find Us details */, "20261101000000_findmi_here_relationships_sets_import.sql" /* Missing-functionality pass */, "20261101000100_entity_moment_display.sql" /* Missing-functionality pass */, "20261102000000_business_location_placements.sql" /* Pass 2 Block A */, "20261102010000_growth_goal_increase_distribution.sql" /* Pass 2 Block A */, "20261103000000_business_location_placement_activities.sql" /* Pass 2 Block A closeout */, "20261104000000_opportunity_listings_geography.sql" /* Pass 2 Block B */, "20261105000000_opportunity_relationship_thread.sql" /* Opportunity Relationship Thread */, "20261106000000_business_targets.sql" /* Cross-Entity Target Foundation */, "20261107000000_commercial_discovery_categories.sql" /* Commercial Discovery Foundation */, "20261108000000_commercial_inquiries.sql" /* Commercial Inquiry v1 */, "20261109000000_entity_public_actions.sql" /* Public Actions */, "20261110000000_location_import_target.sql" /* Location import target */, "20261111000000_trust_privacy_foundation.sql" /* Trust & Privacy Phase 2A */, "20261112000000_opportunity_service_model.sql" /* Trust & Privacy Phase 2A */, "20261113000000_revoke_legacy_follow_rpcs.sql" /* Trust & Privacy Phase 2A */, "20261114000000_discovery_engine_map_v1.sql" /* Discovery Engine + Map V1 */, "20261115000000_location_geocode_automation.sql" /* Automatic Location geocoding */, "20261116000000_taxonomy_v2_foundation.sql" /* Taxonomy V2 Pass 1 */, "20261117000000_taxonomy_v2_staged_categories.sql" /* Taxonomy V2 Pass 2 */, "20261118000000_taxonomy_v2_admin_curation.sql" /* Taxonomy V2 Pass 4A */, "20261119000000_discovery_pages_guides_v1a.sql" /* Pages + Sections V1A */]);
  const statements = MIGRATION.split(/\$function\$;/)[1].trim();
  assert.equal(statements, "", "nothing but the function replacement");
  assert.equal((MIGRATION.match(/create or replace function/gi) ?? []).length, 1);
  assert.doesNotMatch(MIGRATION, /\b(alter|drop|create table|insert into public\.markets|update public\.|delete from|grant|revoke|truncate)\b/i);
});

test("function: market_required removed; request row only for non-blank requested text; everything else identical", () => {
  const next = fnBody(MIGRATION);
  const prev = fnBody(PREVIOUS);
  assert.doesNotMatch(next, /market_required/);
  assert.match(prev, /market_required/);
  assert.match(next, /if p_market_id is not null then\s*insert into public\.business_markets[\s\S]*?'primary', 'self_selected', true\);\s*elsif p_requested_market_text is not null and btrim\(p_requested_market_text\) <> '' then\s*insert into public\.market_requests/);
  for (const kept of [
    "raise exception 'user_required'",
    "raise exception 'name_required'",
    "raise exception 'slug_required'",
    "raise exception 'invalid_category'",
    "raise exception 'market_choice_ambiguous'",
    "raise exception 'invalid_market'",
    "'free', 'pending_review', false",
    "perform public.set_business_category(v_business.id, p_category_id);",
    "insert into public.business_members (user_id, business_id, role) values (p_user_id, v_business.id, 'owner');",
    "'business_creation', v_business.id",
  ]) {
    assert.ok(next.includes(kept), kept);
  }
  assert.match(next, /SECURITY DEFINER\s*SET search_path TO ''/);
  assert.match(next, /p_market_id uuid, p_requested_market_text text DEFAULT NULL::text\)/, "same signature — grants carry over");
  assert.doesNotMatch(next, /insert into public\.markets/i, "never a fake Market");
});

// ── Downstream ───────────────────────────────────────────────────────────
test("Complete Profile no longer requires City/State; other signals unchanged", () => {
  assert.match(MANAGER, /const profileIncomplete = !business\.logo_url \|\| !\(business\.short_description \|\| business\.description\) \|\| !currentCategoryId;/);
});

test("null geography renders as nothing / 'Not set' — never 'undefined' or dangling punctuation", () => {
  assert.match(MANAGER, /\{\[business\.city, business\.state\]\.filter\(Boolean\)\.join\(", "\) \|\| "Not set"\}/);
  assert.match(read("src/app/admin/(protected)/businesses/[id]/page.tsx"), /\[business\.city, business\.state\]\.filter\(Boolean\)\.join\(", "\) \|\| "Not set"/);
  assert.match(read("src/lib/format.ts"), /export function cityState\(city\?: string \| null, state\?: string \| null\): string \{\s*return \[city, state\]\.filter\(Boolean\)\.join\(", "\);/);
  const pub = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(pub, /const location = cityStateZip\(business\.city, business\.state, business\.postal_code\);/);
  assert.match(pub, /\.\.\.\(business\.city \|\| business\.state \|\| business\.postal_code/, "no empty structured address");
});

test("unscoped discovery does not require a Market (Market filters only narrow)", () => {
  const data = read("src/lib/data.ts");
  // Market ids are only resolved when a market slug is chosen; otherwise
  // the list stays null (unfiltered) and Market-less Businesses are included.
  assert.match(data, /let marketBusinessIds: string\[\] \| null = null;\s*if \(params\.areaSlug && params\.marketSlug\) \{[\s\S]*?\} else if \(params\.marketSlug\) \{\s*marketBusinessIds = await getBusinessIdsInMarket\(params\.marketSlug\);/);
});
