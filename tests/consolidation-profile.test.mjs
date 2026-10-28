// Findmi Consolidation pass — Business Profile editor IA + Admin-controlled
// visibility of outbound profile elements and Profile Buttons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const V = await import("../src/lib/profile-visibility.ts");
const read = (f) => readFileSync(f, "utf8");
const B = "src/app/(public)/account/business";
const PAGE = read(`${B}/[id]/(manager)/page.tsx`);
const ACTIONS = read(`${B}/actions.ts`);
const MIGRATION = read("supabase/migrations/20261122000000_profile_public_visibility.sql");

test("visibility: three states, labels as specified", () => {
  assert.deepEqual(V.VISIBILITY_LABELS, { live: "Live On Profile", pending_review: "Pending Review", hidden: "Not Shown On Profile" });
  assert.equal(V.fieldVisibility({}, "website_url"), "live", "a missing key is live (existing data unaffected)");
  assert.deepEqual(V.readFieldStatusMap({ website_url: "hidden", phone: "bogus", other: "hidden" }), { website_url: "hidden" });
  assert.deepEqual(V.readFieldStatusMap(null), {});
});

test("member edits: new/changed → pending; unchanged keeps state; cleared drops state; admin edits are live", () => {
  const prev = { website_url: "https://a.com", instagram_url: "https://instagram.com/a", email: "x@a.com" };
  const map = { email: "hidden" };
  const next = V.nextFieldStatusMap(map, prev, { website_url: "https://b.com", instagram_url: "https://instagram.com/a", email: "x@a.com", phone: "555" }, "business");
  assert.deepEqual(next, { website_url: "pending_review", email: "hidden", phone: "pending_review" });
  assert.deepEqual(V.nextFieldStatusMap({ website_url: "pending_review" }, prev, { website_url: "" }, "business"), {});
  assert.deepEqual(V.nextFieldStatusMap({ website_url: "hidden" }, prev, { website_url: "https://c.com" }, "admin"), {});
  assert.deepEqual(V.nextFieldStatusMap({ tiktok_url: "pending_review" }, prev, { website_url: "https://a.com" }, "business"), { tiktok_url: "pending_review" }, "fields outside the form are untouched");
});

test("public page: non-live fields are not rendered; stored values untouched", () => {
  const b = { website_url: "https://a.com", instagram_url: "https://i.com", bulletin_enabled: true, bulletin_body: "Hi" };
  const out = V.applyPublicFieldVisibility(b, { website_url: "pending_review", bulletin: "hidden" });
  assert.equal(out.website_url, null);
  assert.equal(out.instagram_url, "https://i.com");
  assert.equal(out.bulletin_enabled, false);
  assert.equal(b.website_url, "https://a.com", "input not mutated");
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(view, /business = applyPublicFieldVisibility\(business, fieldStatus\);/);
  assert.match(view, /const contact = applyPublicFieldVisibility\(await resolveBusinessContact\(business\.id\), fieldStatus\);/);
});

test("Profile Buttons: unchanged keeps its state, new is pending for members, admin is live; public reads are live-only", () => {
  const prev = new Map([[V.publicActionKey({ type: "website", label: null, opportunityListingId: null }), "hidden"]]);
  assert.equal(V.nextActionStatus(prev, { type: "website", label: null, opportunityListingId: null }, "business"), "hidden");
  assert.equal(V.nextActionStatus(prev, { type: "website", label: "Shop", opportunityListingId: null }, "business"), "pending_review");
  assert.equal(V.nextActionStatus(prev, { type: "website", label: "Shop", opportunityListingId: null }, "admin"), "live");
  const lib = read("src/lib/public-actions.ts");
  assert.match(lib, /readPublicActions\(admin, kind, entityId, \{ liveOnly: true \}\)/);
  assert.match(read("src/app/(public)/account/public-actions-actions.ts"), /readPublicActions\(admin, kind, entityId, \{ liveOnly: true \}\)\)\?\.\[slot - 1\]/);
  assert.match(lib, /isMissingColumnError\(error, "admin_status"\)/, "tolerates the migration not applied yet");
});

test("migration: additive, defaults live, not granted to anon", () => {
  assert.match(MIGRATION, /add column if not exists public_field_status jsonb not null default '\{\}'::jsonb/);
  assert.match(MIGRATION, /add column if not exists admin_status text not null default 'live'/);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ""), /\b(drop table|drop column|delete from|update public\.|grant )/i);
});

test("Profile editor IA: Details · Photos · Contact & Links · Announcement · Profile Buttons; each form saves only its own fields", () => {
  const nav = read(`${B}/[id]/v2/ProfileSectionNav.tsx`);
  const keys = [...nav.matchAll(/\{ key: "([a-z-]+)", label: "([^"]+)" \}/g)].map((m) => m[2]);
  assert.deepEqual(keys, ["Details", "Photos", "Contact & Links", "Announcement", "Profile Buttons"]);
  const profile = PAGE.slice(PAGE.indexOf('{activeTab === "profile" && ('), PAGE.indexOf('{activeTab === "gallery" && ('));
  const details = profile.slice(profile.indexOf('<Panel id="details"'), profile.indexOf('<Panel id="photos"'));
  assert.doesNotMatch(details, /name="(logo_url|cover_image_url|website_url|instagram_url)"/, "Details no longer carries photos or links");
  assert.match(profile, /<input type="hidden" name="section" value="links" \/>/);
  assert.match(profile, /<input type="hidden" name="section" value="announcement" \/>/);
  assert.match(profile, /<VisibilityChip status=\{fieldVisibility\(fieldStatus, "website_url"\)\} \/>/);
  const gallery = PAGE.slice(PAGE.indexOf('{activeTab === "gallery" && ('), PAGE.indexOf("── Products ──"));
  assert.match(gallery, /<form action=\{brandImagesAction\}/);
  assert.match(ACTIONS, /allowedColumns\.filter\(\(column\) => formData\.has\(column\)\)/, "absent fields are never nulled");
  assert.match(ACTIONS, /export async function updateBusinessBrandImages/);
});

// ── Admin queues + Event → Location link ───────────────────────────────

test("Admin Locations: Needs Review is review_status; Drafts is is_demo; Reject keeps it unlisted", () => {
  const q = read("src/lib/admin/queries.ts");
  assert.match(q, /if \(filters\.needsReview\) query = query\.eq\("review_status", "pending_review"\);/);
  assert.match(read("src/lib/admin/dashboard-queries.ts"), /\.eq\("review_status", "pending_review"\)/);
  const life = read("src/app/admin/(protected)/locations/lifecycle-actions.ts");
  assert.match(life, /\.update\(locationReviewDecision\("reject"\)\)\n\s+\.in\("id", clean\)\n\s+\.eq\("review_status", "pending_review"\)/);
  assert.match(read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx"), /\{reviewQueue \? \(/);
});

test("Admin Profile Approvals: queue page, Approve / Hide decisions only change visibility, dashboard count, nav", () => {
  const actions = read("src/app/admin/(protected)/profile-reviews/actions.ts");
  assert.match(actions, /const admin = await requireAdminSupabase\(\);/);
  assert.match(actions, /update\(\{ public_field_status: map \}\)/);
  assert.match(actions, /update\(\{ admin_status: decision \}\)/);
  assert.doesNotMatch(actions, /\.delete\(/, "nothing is deleted");
  assert.match(read("src/lib/admin/profile-reviews.ts"), /return \{ ready: false, businesses: \[\], buttons: \[\] \}/, "tolerates the migration not applied yet");
  assert.match(read("src/app/admin/(protected)/page.tsx"), /href: "\/admin\/profile-reviews"/);
  assert.match(read("src/components/admin/adminNavItems.ts"), /href: "\/admin\/profile-reviews", label: "Profile Approvals"/);
});

test("Event page: the Location name links to the Location (listed only), View Location kept", () => {
  const f = read("src/components/event/EventLocationFeature.tsx");
  assert.match(f, /publicLocationHref\(location\) \? \(\n\s+<Link href=\{publicLocationHref\(location\)!\} className="hover:text-findmi-700 hover:underline">\n\s+\{location\.name\}/);
  assert.match(f, /View Location/);
});
