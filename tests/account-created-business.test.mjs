// VCL A2 — Brand onboarding completes on Account Home (/account?created=<id>)
// with a success + Pending Review card for THAT Business (Preview / Manage),
// then the ordinary Account Home. `created` is only a hint: it can select
// one of the signed-in user's own pending Businesses and nothing else.
// The resolver is exercised directly; wiring is pinned with source guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const { resolveCreatedBusiness } = await import("../src/lib/account-created-business.ts");

const read = (p) => readFileSync(p, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const CREATE = read("src/app/(public)/account/business/actions.ts");
const HOME = code(read("src/app/(public)/account/page.tsx"));
const CARD = code(read("src/app/(public)/account/CreatedBusinessCard.tsx"));
const PUBLIC_VIEW = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");

const MINE_PENDING = { id: "a1b2c3d4-1111-4111-8111-111111111111", name: "Little Saints", slug: "little-saints", pendingReview: true };
const MINE_LIVE = { id: "22222222-2222-4222-8222-222222222222", name: "Live Co", slug: "live-co", pendingReview: false };
const SOMEONE_ELSES = "33333333-3333-4333-8333-333333333333";
const own = [MINE_LIVE, MINE_PENDING];

// ── Redirect ─────────────────────────────────────────────────────────────
test("Brand onboarding completes on Account Home, not inside the Profile editor", () => {
  assert.match(CREATE, /redirect\(`\/account\?created=\$\{businessId\}`\);/);
  assert.doesNotMatch(CREATE, /tab=profile&created=1/);
});

test("other creation paths keep their landings: invite → redeem, Pro → upgrade/checkout; default and Brand both land on Account Home (Guest-First Creation pass)", () => {
  const tail = CREATE.slice(CREATE.indexOf("if (inviteRaw) {"), CREATE.indexOf("export async function", CREATE.indexOf("if (inviteRaw) {")));
  const order = [
    "redirect(`/redeem/${encodeURIComponent(inviteRaw)}?business=${businessId}`);",
    "redirect(`/upgrade/pro?business=${businessId}`);",
    "redirect(`/account/business/${businessId}?created=1&error=${encodeURIComponent(checkout.error)}`);",
    "redirect(`/account?created=${businessId}`);",
  ];
  let at = -1;
  for (const step of order) {
    const i = tail.indexOf(step);
    assert.ok(i > at, step);
    at = i;
  }
  // Brand onboarding never takes the Pro path (plan_choice is ignored for it).
  assert.match(CREATE, /const planChoiceRaw = brandOnboarding \? null : str\(formData, "plan_choice"\);/);
});

// ── `created` is validated server-side against the user's own Businesses ─
test("resolver: only the user's OWN Business that is still pending review is confirmed", () => {
  assert.equal(resolveCreatedBusiness(MINE_PENDING.id, own), MINE_PENDING);
  assert.equal(resolveCreatedBusiness(SOMEONE_ELSES, own), null, "another user's Business id reveals nothing");
  assert.equal(resolveCreatedBusiness(MINE_LIVE.id, own), null, "no Pending Review claim once it's live");
  for (const bad of [undefined, null, "", "not-a-uuid", "../../etc", ["x"], 42, MINE_PENDING.id.toUpperCase()]) {
    assert.equal(resolveCreatedBusiness(bad, own), null, String(bad));
  }
  assert.equal(resolveCreatedBusiness(MINE_PENDING.id, []), null, "no memberships → nothing");
});

test("Account Home: own memberships come from the session-scoped client for THIS user; card only for the resolved Business", () => {
  assert.match(HOME, /searchParams: Promise<\{ error\?: string; event_management\?: string; created\?: string; location_submitted\?: string \}>/);
  assert.match(HOME, /supabase\s*\.from\("business_members"\)\s*\.select\("business_id, businesses\(name, slug, publication_status, logo_url, cover_image_url\)"\)\s*\.eq\("user_id", user\.id\)/);
  assert.match(HOME, /pendingReview: business\.publication_status === "pending_review",/);
  assert.match(HOME, /const createdBusiness = resolveCreatedBusiness\(created, myBusinesses\);/);
  assert.doesNotMatch(HOME, /getAdminSupabase\(\)[^;]*created|from\("businesses"\)[^;]*created/, "never a privileged lookup by the URL id");
  assert.match(HOME, /\{createdBusiness && \(\s*<CreatedBusinessCard/);
});

test("Account Home: the card is first under the greeting (top of the page), then everything else continues", () => {
  const header = HOME.indexOf("<Greeting />");
  const card = HOME.indexOf("<CreatedBusinessCard");
  const firstSection = HOME.indexOf('<div className="mt-5 flex flex-col gap-7">');
  assert.ok(header > 0 && header < card && card < HOME.indexOf("<AccountErrorBanner") && card < firstSection);
  // Personalized Account Home: Upcoming Events / Your Moments / Pages I
  // Manage replace Coming Up / My World / Managing. Account Home UX
  // Correction pass — the Saved preview rail (id="saved") is intentionally
  // removed from this page; Saved itself lives on at /account/saved.
  for (const id of ['id="upcoming-events"', 'id="your-moments"', 'id="inbox"', 'id="pages-i-manage"', 'id="pending-claims"']) {
    assert.ok(HOME.includes(id), `${id} still rendered as before`);
  }
  assert.doesNotMatch(HOME, /id="saved"/, "the Saved preview rail is removed from Account Home (Saved stays at /account/saved)");
});

// ── The card ─────────────────────────────────────────────────────────────
test("card: success + Pending Review, truthful copy, no workflow jargon", () => {
  assert.match(CARD, /<Chip tone="amber">Pending Review<\/Chip>/);
  assert.match(CARD, /Your Business has been submitted\./);
  assert.match(CARD, /It&rsquo;s visible to you now and will appear in discovery after Findmi reviews it\./);
  assert.doesNotMatch(CARD, /application|approval process|moderation|verification|Needs Attention|error/i);
  assert.doesNotMatch(CARD, /Coming Up|Performance|Opportunit/, "not a duplicate Business dashboard");
});

test("card actions: Preview = the existing member-only owner preview; Manage = the workspace Overview (never Profile)", () => {
  assert.match(CARD, /href=\{`\/business\/\$\{business\.slug\}`\}/);
  assert.match(CARD, /href=\{`\/account\/business\/\$\{business\.id\}`\}/);
  assert.match(CARD, /Manage \{business\.name\}/);
  assert.doesNotMatch(CARD, /tab=profile|tab=/);
  // The public page still serves a pending Business only to its members, noindexed.
  assert.match(PUBLIC_VIEW, /async function resolveOwnerPreviewBusiness\(slug: string\)/);
  assert.match(PUBLIC_VIEW, /\.from\("business_members"\)/);
  assert.match(PUBLIC_VIEW, /\.\.\.\(ownerPreview \? \{ robots: \{ index: false, follow: false \} \} : \{\}\)/);
  const data = read("src/lib/data.ts");
  assert.match(data, /\.eq\("publication_status", "live"\)/, "public reads stay live-only");
});

test("A2 adds no schema, migration or privileged write", () => {
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(migrations.filter((f) => f > "20261013000000_bd_foundation.sql"), ["20261014000000_optional_business_geography.sql", "20261014010000_event_attendance_cta_and_location_visibility.sql" /* Event attendance pass */, "20261015000000_business_location_availability.sql" /* Find Us At pass */, "20261016000000_event_taxonomy_v1.sql" /* Event Taxonomy V1 pass */, "20261017000000_event_formats_v1.sql" /* Event Formats V1 pass */, "20261018000000_event_occurrence_details.sql" /* Event Occurrence details pass */, "20261018220515_discovery_lanes_add_placement.sql" /* Discovery Lanes Placement & Density Refinement pass */, "20261018223910_discovery_lanes_set_primary_lane_rpc.sql" /* atomic Make Primary RPC */, "20261018224010_discovery_lanes_set_primary_lane_rpc_restrict_grants.sql" /* atomic Make Primary RPC */, "20261018233210_market_areas_add_image_url.sql" /* Discovery Tile Visual System, Part B */, "20261019000000_event_date_time_precision.sql" /* Event date/time precision pass */, "20261020000000_moment_authorship_and_access_history.sql" /* Identity & Authorship V1 pass */, "20261021000000_brand_audit_and_opportunity_ideas.sql" /* Brand Audit + Opportunity Ideas V1 pass */, "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */, "20261025000000_canonical_entity_geography.sql" /* Canonical Entity Geography pass */, "20261026000000_business_availability_details.sql" /* Business Manager redesign: Where To Find Us details */, "20261101000000_findmi_here_relationships_sets_import.sql" /* Missing-functionality pass */, "20261101000100_entity_moment_display.sql" /* Missing-functionality pass */, "20261102000000_business_location_placements.sql" /* Pass 2 Block A */, "20261102010000_growth_goal_increase_distribution.sql" /* Pass 2 Block A */, "20261103000000_business_location_placement_activities.sql" /* Pass 2 Block A closeout */, "20261104000000_opportunity_listings_geography.sql" /* Pass 2 Block B */, "20261105000000_opportunity_relationship_thread.sql" /* Opportunity Relationship Thread */, "20261106000000_business_targets.sql" /* Cross-Entity Target Foundation */, "20261107000000_commercial_discovery_categories.sql" /* Commercial Discovery Foundation */, "20261108000000_commercial_inquiries.sql" /* Commercial Inquiry v1 */, "20261109000000_entity_public_actions.sql" /* Public Actions */, "20261110000000_location_import_target.sql" /* Location import target */, "20261111000000_trust_privacy_foundation.sql" /* Trust & Privacy Phase 2A */, "20261112000000_opportunity_service_model.sql" /* Trust & Privacy Phase 2A */, "20261113000000_revoke_legacy_follow_rpcs.sql" /* Trust & Privacy Phase 2A */], "no new migration (A2b's later one aside)");
  for (const src of [CARD, read("src/lib/account-created-business.ts")]) {
    assert.doesNotMatch(src, /getAdminSupabase|\.insert\(|\.update\(|\.rpc\(|cookies\(/);
  }
});

test("arrival opens at the top: one deterministic scroll reset, only in the completion state", () => {
  const scroll = code(read("src/app/(public)/account/ScrollToTopOnArrival.tsx"));
  assert.match(scroll, /^"use client";/);
  assert.match(scroll, /useEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0, left: 0, behavior: "instant" \}\);\s*\}, \[\]\);/);
  assert.doesNotMatch(scroll, /setTimeout|setInterval|requestAnimationFrame/, "no timers");
  assert.match(CARD, /<ScrollToTopOnArrival \/>/, "rendered with the card — ordinary /account visits keep their scroll");
  assert.doesNotMatch(HOME, /ScrollToTopOnArrival/);
});
