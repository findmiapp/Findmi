// Identity, Authorship & Entity Access V1. Pure rules are exercised
// directly (src/lib/moment-author.ts, src/lib/access-history.ts); server
// actions, RLS migration, readers and Admin controls are pinned with
// source-level guards, following this repo's convention. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const A = await import("../src/lib/moment-author.ts");
const H = await import("../src/lib/access-history.ts");
const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const MIGRATION_FILE = "20261020000000_moment_authorship_and_access_history.sql";
const MIGRATION = read(`supabase/migrations/${MIGRATION_FILE}`);
const ACTIONS = code(read("src/app/(public)/my-world/journal/actions.ts"));
const AUTHORSHIP = code(read("src/lib/moment-authorship.ts"));
const JOURNAL = code(read("src/lib/journal.ts"));
const DISTRIBUTION = code(read("src/lib/journal-distribution.ts"));
const DISCOVERY = code(read("src/lib/moment-discovery.ts"));
const AUTHOR_LIB = code(read("src/lib/journal-author.ts"));
const MOMENT_PAGE = code(read("src/app/(public)/journal/[id]/page.tsx"));
const COMPOSER = code(read("src/components/journal/MomentComposer.tsx"));
const NEW_PAGE = code(read("src/app/(public)/my-world/journal/new/page.tsx"));
const EDIT_PAGE = code(read("src/app/(public)/my-world/journal/[id]/edit/page.tsx"));
const ADMIN_EDIT = code(read("src/app/admin/(protected)/journal/[id]/page.tsx"));
const ACCESS_ACTIONS = code(read("src/app/admin/(protected)/businesses/access-actions.ts"));
const BIZ_ACTIONS = code(read("src/app/admin/(protected)/businesses/actions.ts"));
const BIZ_PAGE = code(read("src/app/admin/(protected)/businesses/[id]/page.tsx"));
const CLAIM_ACTIONS = code(read("src/app/admin/(protected)/claims/actions.ts"));
const CLAIM_PAGE = code(read("src/app/admin/(protected)/claims/page.tsx"));
const CLAIM_ROUTE = code(read("src/app/api/account/claim/route.ts"));

const ME = "user-me";
const OTHER = "user-other";
const B = "biz-fuji";
const C = "biz-other";
const roles = (entries) => new Map(entries);
const user = (userId, r = []) => ({ kind: "user", userId, roles: roles(r) });
const ADMIN = { kind: "admin" };
const personal = { user_id: ME, author_business_id: null };
const business = { user_id: ME, author_business_id: B };

// ── Authorship rules ─────────────────────────────────────────────────────
test("1. Personal authorship stays compatible with existing Moments (no author_business_id)", () => {
  assert.equal(A.canManageMoment({ user_id: ME }, user(ME)), true, "pre-migration row with no column");
  assert.equal(A.canManageMoment(personal, user(OTHER)), false);
  const author = A.momentAuthorFrom({ user_id: ME }, { display_name: "Jonathan", avatar_url: "https://img/a.jpg" }, null, "/journal?author=e1");
  assert.deepEqual(author, { kind: "person", name: "Jonathan", imageUrl: "https://img/a.jpg", href: "/journal?author=e1" });
  assert.match(MIGRATION, /add column if not exists author_business_id uuid references public\.businesses\(id\) on delete set null;/);
  assert.doesNotMatch(MIGRATION, /update public\.journal_entries|author_type|author_id\b/, "no backfill, no redundant author fields");
  // Deploy-order safety: every reader probes the column before selecting it.
  assert.match(AUTHORSHIP, /select\("author_business_id"\)\.limit\(1\)/);
  for (const src of [DISTRIBUTION, DISCOVERY, AUTHOR_LIB]) assert.match(src, /await authorColumn\(\)/);
});

test("2-5. owner and manager may post as the Business; staff and unrelated users may not", () => {
  assert.equal(A.canPostAsBusinessRole("owner"), true);
  assert.equal(A.canPostAsBusinessRole("manager"), true);
  assert.equal(A.canPostAsBusinessRole("staff"), false);
  assert.equal(A.canPostAsBusinessRole(undefined), false);
  assert.deepEqual(A.authorizeAuthorChoice(personal, user(ME, [[B, "owner"]]), B), { ok: true });
  assert.deepEqual(A.authorizeAuthorChoice(personal, user(ME, [[B, "manager"]]), B), { ok: true });
  assert.ok("error" in A.authorizeAuthorChoice(personal, user(ME, [[B, "staff"]]), B));
  assert.ok("error" in A.authorizeAuthorChoice(personal, user(ME), B));
  const opts = A.postedByOptions({ viewerUserId: ME, entryUserId: null, personalLabel: "Jonathan", managed: [{ id: B, name: "FUJIFILM", logoUrl: null }, { id: C, name: "Staffed", logoUrl: null }], roles: roles([[B, "manager"], [C, "staff"]]) });
  assert.deepEqual(opts.map((o) => o.value), [null, B], "staff Businesses never offered");
  // Server: real business_members role, never the Admin fallback.
  assert.match(AUTHORSHIP, /managed: contexts\.filter\(\(c\) => canPostAsBusinessRole\(c\.role\)\)/);
  assert.match(MIGRATION, /m\.role in \('owner', 'manager'\)/);
});

test("6. a forged authorBusinessId is rejected server-side (create and edit)", () => {
  assert.ok("error" in A.authorizeAuthorChoice(personal, user(ME, [[C, "owner"]]), B), "managing C doesn't grant B");
  const start = ACTIONS.slice(ACTIONS.indexOf("export async function startJournalDraft"), ACTIONS.indexOf("export async function setJournalAuthor"));
  assert.match(start, /const \{ roles \} = await getViewerAuthorContext\(await getServerSupabase\(\), user\.id\);\s*if \(!canPostAsBusinessRole\(roles\.get\(authorBusinessId\)\)\) return \{ error:/);
  assert.doesNotMatch(start, /isAdminSession|viaAdmin/, "create never uses Admin authority as membership");
  const set = ACTIONS.slice(ACTIONS.indexOf("export async function setJournalAuthor"), ACTIONS.indexOf("export async function saveJournalBasics"));
  assert.match(set, /const allowed = authorizeAuthorChoice\(ctx\.entry, actor, requested\);\s*if \("error" in allowed\) return allowed;/);
  assert.match(set, /roles: \(await getViewerAuthorContext\(await getServerSupabase\(\), actor\.userId\)\)\.roles/);
  // RLS second layer: insert/update can only land on a Business you manage.
  assert.match(MIGRATION, /with check \(\s*auth\.uid\(\) = user_id\s*and \(author_business_id is null or public\.can_author_as_business\(author_business_id\)\)\s*\)/);
});

test("7-8. author rendering: Business → name/logo/link; Person → name/avatar/journal", () => {
  const live = { name: "FUJIFILM", slug: "fujifilm", logo_url: "https://cdn/logo.png", publication_status: "live", archived_at: null, trashed_at: null };
  assert.deepEqual(A.momentAuthorFrom(business, { display_name: "Jonathan", avatar_url: null }, live, "/journal?author=x"), {
    kind: "business",
    name: "FUJIFILM",
    imageUrl: "https://cdn/logo.png",
    href: "/business/fujifilm",
  });
  assert.equal(A.momentAuthorFrom(business, null, { ...live, publication_status: "paused" }, null).href, null, "non-live Business: name only");
  assert.equal(A.momentAuthorFrom(business, { display_name: "Jonathan", avatar_url: null }, null, "/x"), null, "never falls back to the creating Person");
  assert.equal(A.momentAuthorFrom({ user_id: ME }, { display_name: "a@b.com", avatar_url: null }, null, null), null, "emails never shown");
  // One shared resolver across every Moment surface.
  for (const src of [DISTRIBUTION, DISCOVERY, MOMENT_PAGE]) assert.match(src, /resolveMomentAuthors\(/);
  assert.doesNotMatch(DISCOVERY, /from\("profiles"\)/, "no private author lookup left in the feed");
  assert.match(MOMENT_PAGE, /author\.kind === "business" \? "rounded bg-white object-contain" : "rounded-full object-cover"/);
});

test("9. changing Posted By never changes journal_entries.user_id", () => {
  const set = ACTIONS.slice(ACTIONS.indexOf("export async function setJournalAuthor"), ACTIONS.indexOf("export async function saveJournalBasics"));
  assert.match(set, /\.update\(\{ author_business_id: requested \}\)\.eq\("id", entryId\)/);
  assert.doesNotMatch(set, /user_id:/);
  assert.match(MIGRATION, /if new\.user_id is distinct from old\.user_id then\s*raise exception/);
  assert.match(MIGRATION, /before update of user_id on public\.journal_entries/);
  // Authorship changes nothing about media/order/sections/visibility/cover.
  assert.doesNotMatch(set, /journal_entry_media|display_order|section_id|visibility|is_cover/);
});

test("10. a Person's public journal excludes Business-authored Moments", () => {
  assert.match(DISTRIBUTION, /query = query\.eq\("user_id", subjectId\);\s*if \(await hasMomentAuthorship\(\)\) query = query\.is\("author_business_id", null\);/);
  assert.match(AUTHOR_LIB, /if \(!data\?\.user_id \|\| data\.author_business_id\) return null;/);
  assert.match(JOURNAL, /and\(user_id\.eq\.\$\{userId\},author_business_id\.is\.null\),author_business_id\.in\./, "My Moments: personal + currently managed Business Moments");
});

test("11. a removed manager immediately loses Business Moment management", () => {
  assert.equal(A.canManageMoment(business, user(ME, [[B, "manager"]])), true);
  assert.equal(A.canManageMoment(business, user(ME)), false, "creator keeps nothing from user_id alone");
  assert.equal(A.canManageMoment(business, user(ME, [[B, "staff"]])), false);
  assert.equal(A.canManageMoment(business, user(OTHER, [[B, "owner"]])), true, "another current manager");
  // Server reads CURRENT memberships on every action; RLS derives the same.
  assert.match(ACTIONS, /if \(!entry \|\| !canManageMoment\(entry, actor\)\) throw new Error/);
  assert.match(JOURNAL, /\.from\("business_members"\)\s*\.select\("id"\)\s*\.eq\("user_id", userId\)\s*\.eq\("business_id", entry\.author_business_id\)\s*\.in\("role", \["owner", "manager"\]\)/);
  assert.match(MIGRATION, /\(je\.author_business_id is null and je\.user_id = auth\.uid\(\)\)\s*or \(je\.author_business_id is not null and public\.can_author_as_business\(je\.author_business_id\)\)/);
});

test("another manager can't turn someone else's Moment into their own personal one", () => {
  assert.ok("error" in A.authorizeAuthorChoice(business, user(OTHER, [[B, "manager"]]), null));
  assert.deepEqual(A.authorizeAuthorChoice(business, user(ME, [[B, "manager"]]), null), { ok: true }, "the creator can");
  const opts = A.postedByOptions({ viewerUserId: OTHER, entryUserId: ME, personalLabel: "X", managed: [{ id: B, name: "FUJIFILM", logoUrl: null }], roles: roles([[B, "manager"]]) });
  assert.deepEqual(opts.map((o) => o.value), [B]);
  assert.match(MIGRATION, /for update\s*to authenticated\s*using \([\s\S]*?\)\s*with check \(\s*\(author_business_id is null and auth\.uid\(\) = user_id\)/);
});

test("12. Admin can assign any Business author without membership — via the Admin path only", () => {
  assert.deepEqual(A.authorizeAuthorChoice(personal, ADMIN, B), { ok: true });
  assert.deepEqual(A.authorizeAuthorChoice(business, ADMIN, null), { ok: true });
  assert.match(ACTIONS, /if \(await isAdminSession\(\)\) \{[\s\S]*?actor: \{ kind: "admin" \} \};/);
  assert.match(ACTIONS, /if \(requested\) \{\s*const \{ data: business \} = await ctx\.admin\.from\("businesses"\)\.select\("id"\)\.eq\("id", requested\)\.maybeSingle\(\);/);
  assert.match(ADMIN_EDIT, /initial\.postedBy = await buildAdminPostedBy\(entry\.entry\);/);
  assert.match(AUTHORSHIP, /return \{ value: currentId, options, adminSearch: true \};/);
  assert.match(AUTHORSHIP, /return \{ value, options, adminSearch: false \};/, "normal users never get Admin search");
});

test("Posted By defaults: Personal, or the Business manager it was opened from", () => {
  assert.equal(A.defaultAuthorBusinessId(B, roles([[B, "owner"]])), B);
  assert.equal(A.defaultAuthorBusinessId(B, roles([[B, "staff"]])), null);
  assert.equal(A.defaultAuthorBusinessId(B, roles()), null);
  assert.equal(A.defaultAuthorBusinessId(null, roles([[B, "owner"]])), null);
  assert.match(NEW_PAGE, /buildPostedBy\(supabase, user\.id, \{ fromBusinessId: params\.postAs \?\? null \}\)/);
  assert.match(EDIT_PAGE, /initial\.postedBy = await buildPostedBy\(supabase, user\.id, \{ entry: result\.entry \}\);/);
  assert.match(COMPOSER, /startJournalDraft\(\{ authorBusinessId: authorRef\.current \}\)/);
  assert.match(COMPOSER, /initial\.postedBy \? setJournalAuthor\(id, authorBusinessId\)/);
});

// ── Business management state ────────────────────────────────────────────
test("13-16. one management state: Admin never counts; pending; Verified independent", () => {
  assert.equal(A.businessManagementState({ memberCount: 0, pendingClaimCount: 0 }), "unclaimed");
  assert.equal(A.businessManagementState({ memberCount: 0, pendingClaimCount: 2 }), "claim_pending");
  assert.equal(A.businessManagementState({ memberCount: 1, pendingClaimCount: 1 }), "managed");
  assert.equal(A.businessManagementState.length, 1);
  assert.doesNotMatch(read("src/lib/moment-author.ts").slice(read("src/lib/moment-author.ts").indexOf("export function businessManagementState")), /verified|viaAdmin|admin/i);
  // Admin page + public claim route both use it, counting REAL rows only.
  assert.match(BIZ_PAGE, /businessManagementState\(\{ memberCount: members\.length, pendingClaimCount: accessOverview\.pendingClaimCount \}\)/);
  assert.doesNotMatch(BIZ_PAGE, /members\.some\(\(m\) => m\.role === "owner"\)/, "the old owner-only definition is gone");
  assert.match(CLAIM_ROUTE, /businessState = businessManagementState\(\{ memberCount: memberCount \?\? 0, pendingClaimCount: pendingClaimCount \?\? 0 \}\);/);
  assert.doesNotMatch(ACCESS_ACTIONS, /verified/, "access changes never touch Verified");
});

test("19. Claim Business is offered again once a Business is genuinely Unclaimed", () => {
  assert.match(CLAIM_ROUTE, /if \(businessState === "managed"\) return NextResponse\.json\(\{ state: "member" \}\);/);
  assert.match(CLAIM_ROUTE, /if \(type === "business" && businessState === "claim_pending"\) return NextResponse\.json\(\{ state: "member" \}\);/);
  assert.match(CLAIM_ROUTE, /return NextResponse\.json\(\{ state: "none", accountEmail: user\?\.email \?\? null \}\);\s*\}\s*$/m);
});

// ── Admin access controls ────────────────────────────────────────────────
test("17. remove one manager (scoped to the Business, never the owner)", () => {
  assert.match(BIZ_ACTIONS, /\.delete\(\)\s*\.eq\("id", memberId\)\s*\.eq\("business_id", businessId\)\s*\.neq\("role", "owner"\)/);
  assert.match(BIZ_PAGE, /removeBusinessMember\.bind\(null, id, m\.id\)/);
  assert.match(BIZ_PAGE, /removeBusinessOwnerAccess\.bind\(null, id\)/);
  assert.match(ACCESS_ACTIONS, /supabase\.rpc\("remove_business_owner", \{ p_business_id: businessId \}\)/);
  assert.match(ACCESS_ACTIONS, /\.eq\("id", memberId\)\.eq\("business_id", businessId\)\.maybeSingle\(\);[\s\S]*?supabase\.rpc\("transfer_business_ownership"/, "Make Owner verifies the member belongs here first");
});

test("18. remove all managers deletes ONLY this Business's member rows", () => {
  const fn = ACCESS_ACTIONS.slice(ACCESS_ACTIONS.indexOf("export async function removeAllBusinessManagers"));
  assert.match(fn, /\.toUpperCase\(\) !== "REMOVE"/);
  assert.match(fn, /supabase\.from\("business_members"\)\.delete\(\)\.eq\("business_id", businessId\)/);
  assert.equal((ACCESS_ACTIONS.match(/\.delete\(\)/g) ?? []).length, 1, "one delete, on business_members");
  assert.doesNotMatch(ACCESS_ACTIONS, /from\("(businesses|events|locations|appearances|products|business_claim_requests|journal_entries)"\)\.(delete|update)/);
  assert.doesNotMatch(ACCESS_ACTIONS, /\.insert\(/, "Admin never creates membership rows for itself");
});

test("20. an approved claim still creates management through the existing RPC", () => {
  assert.match(CLAIM_ACTIONS, /const \{ error \} = await supabase\.rpc\(APPROVE_RPC\[entityType\], \{ p_claim_id: claimId \}\);/);
  assert.match(CLAIM_ACTIONS, /business: "approve_business_claim"/);
  assert.doesNotMatch(CLAIM_ACTIONS, /payment_status ===|payment_status !==/, "claims stay uncoupled from payment/Pro");
});

test("21. /admin/claims member mutations are scoped by member id AND entity id", () => {
  assert.match(CLAIM_ACTIONS, /export async function updateMemberRole\(entityType: ClaimEntityType, entityId: string, memberId: string, role: string\)/);
  assert.match(CLAIM_ACTIONS, /export async function removeMember\(entityType: ClaimEntityType, entityId: string, memberId: string\)/);
  assert.equal((CLAIM_ACTIONS.match(/\.eq\("id", memberId\)\s*\.eq\(MEMBER_ENTITY_COLUMN\[entityType\], entityId\)/g) ?? []).length, 2);
  assert.match(CLAIM_PAGE, /removeMember\.bind\(null, c\.entityType, entityId, m\.id\)/);
  assert.match(CLAIM_PAGE, /c\.entityType,\s*entityId,\s*m\.id,/);
});

// ── Access history ───────────────────────────────────────────────────────
test("22. the required access-history events are recorded (narrow, admin actor_kind)", () => {
  assert.deepEqual(H.accessEventRow({ entityType: "business", entityId: B, action: "manager_removed", actor: { kind: "admin" }, subjectUserId: ME }), {
    entity_type: "business",
    entity_id: B,
    action: "manager_removed",
    subject_user_id: ME,
    actor_kind: "admin",
    actor_user_id: null,
    detail: {},
  });
  assert.equal(H.accessEventRow({ entityType: "moment", entityId: "m", action: "author_changed", actor: { kind: "user", userId: ME } }).actor_user_id, ME);
  const recorded = (src, action) => assert.match(src, new RegExp(`action: "${action}"`), action);
  recorded(CLAIM_ACTIONS, "claim_approved");
  recorded(BIZ_ACTIONS, "manager_added");
  recorded(BIZ_ACTIONS, "manager_removed");
  recorded(CLAIM_ACTIONS, "manager_removed");
  recorded(ACCESS_ACTIONS, "all_managers_removed");
  recorded(ACCESS_ACTIONS, "ownership_transferred");
  recorded(ACCESS_ACTIONS, "owner_removed");
  recorded(ACTIONS, "author_changed");
  for (const a of H.ACCESS_EVENT_ACTIONS) assert.match(MIGRATION, new RegExp(`'${a}'`), a);
  assert.match(MIGRATION, /alter table public\.access_events enable row level security;\s*revoke all on table public\.access_events from anon, authenticated;\s*grant all on table public\.access_events to service_role;/);
  assert.match(MIGRATION, /check \(actor_kind = 'admin' or actor_user_id is not null\)/);
  assert.match(BIZ_PAGE, /"Unknown \/ Before Access History"/);
});

// ── RLS / migration ──────────────────────────────────────────────────────
test("RLS: SECURITY DEFINER functions with a safe search_path; all four Moment tables; public reads untouched", () => {
  for (const fn of ["can_author_as_business", "can_manage_journal_entry"]) {
    assert.match(MIGRATION, new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)\\s*returns boolean\\s*language sql\\s*stable\\s*security definer\\s*set search_path = ''`), fn);
    assert.match(MIGRATION, new RegExp(`revoke all on function public\\.${fn}\\(uuid\\) from public;`), fn);
  }
  for (const t of ["journal_entry_media", "journal_entry_sections", "journal_entry_connections"]) {
    assert.match(MIGRATION, new RegExp(`drop policy if exists "${t}_select_own" on public\\.${t};\\s*create policy "${t}_select_own"[\\s\\S]*?using \\(public\\.can_manage_journal_entry\\(journal_entry_id\\)\\);`), t);
  }
  assert.doesNotMatch(MIGRATION, /_select_public/, "public-read policies are not touched");
  assert.doesNotMatch(MIGRATION, /\b(delete from|truncate|drop table|drop column)\b/i);
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  // Later passes add their own migrations after this one (Brand Audit V1).
  assert.deepEqual(files.slice(files.indexOf(MIGRATION_FILE)), [MIGRATION_FILE, "20261021000000_brand_audit_and_opportunity_ideas.sql", "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */, "20261025000000_canonical_entity_geography.sql" /* Canonical Entity Geography pass */, "20261026000000_business_availability_details.sql" /* Business Manager redesign: Where To Find Us details */, "20261101000000_findmi_here_relationships_sets_import.sql" /* Missing-functionality pass */, "20261101000100_entity_moment_display.sql" /* Missing-functionality pass */, "20261102000000_business_location_placements.sql" /* Pass 2 Block A */, "20261102010000_growth_goal_increase_distribution.sql" /* Pass 2 Block A */, "20261103000000_business_location_placement_activities.sql" /* Pass 2 Block A closeout */, "20261104000000_opportunity_listings_geography.sql" /* Pass 2 Block B */, "20261105000000_opportunity_relationship_thread.sql" /* Opportunity Relationship Thread */, "20261106000000_business_targets.sql" /* Cross-Entity Target Foundation */, "20261107000000_commercial_discovery_categories.sql" /* Commercial Discovery Foundation */, "20261108000000_commercial_inquiries.sql" /* Commercial Inquiry v1 */, "20261109000000_entity_public_actions.sql" /* Public Actions */, "20261110000000_location_import_target.sql" /* Location import target */, "20261111000000_trust_privacy_foundation.sql" /* Trust & Privacy Phase 2A */, "20261112000000_opportunity_service_model.sql" /* Trust & Privacy Phase 2A */, "20261113000000_revoke_legacy_follow_rpcs.sql" /* Trust & Privacy Phase 2A */, "20261114000000_discovery_engine_map_v1.sql" /* Discovery Engine + Map V1 */, "20261115000000_location_geocode_automation.sql" /* Automatic Location geocoding */, "20261116000000_taxonomy_v2_foundation.sql" /* Taxonomy V2 Pass 1 */, "20261117000000_taxonomy_v2_staged_categories.sql" /* Taxonomy V2 Pass 2 */, "20261118000000_taxonomy_v2_admin_curation.sql" /* Taxonomy V2 Pass 4A */, "20261119000000_discovery_pages_guides_v1a.sql" /* Pages + Sections V1A */, "20261120000000_pages_sections_v1b.sql" /* Pages + Sections V1B */, "20261121000000_consolidation_publication_rules.sql" /* Findmi Consolidation pass */, "20261121010000_hotfix_event_visibility_policy_grants.sql" /* Consolidation pass: Event visibility policy hotfix */, "20261122000000_profile_public_visibility.sql" /* Consolidation pass: profile visibility */, "20261123000000_hotfix_products_moderation_status_grant.sql" /* Product + Marketplace + Want pass: moderation_status grant hotfix */, "20261124000000_product_wants.sql" /* Product + Marketplace + Want pass */]);
});
