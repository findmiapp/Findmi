// Pro Access Request Workflow V1 — the minimum viable "Request Pro
// Access" owner surface + admin review workflow, built so a LATER,
// separate pass can safely repoint existing self-serve Upgrade/checkout
// CTAs at it. This pass never touches Stripe, never creates a second
// definition of Pro (isBusinessPro stays the one resolver), and reuses
// the exact non-payment grant semantics redeem_pro_invite() already
// established (plan_source='complimentary', never-shorten-existing-
// expiry, never-downgrade-pro_seller).
//
// This suite follows this repo's own established convention for this
// kind of pass (see journal-section-carousel.test.mjs,
// account-billing-copy-truth.test.mjs, business-overview-hierarchy.test.mjs):
// no JSX rendering harness and no live Postgres exist in this plain
// node:test suite, so behavior is proven via source-level static guards
// against the actual migration SQL and the actual Server Action/page
// source — not component mounting, not a real database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync("supabase/migrations/20261008000000_business_pro_access_requests.sql", "utf8");
const SUBMIT_ACTION = readFileSync("src/app/(public)/account/business/pro-access-actions.ts", "utf8");
const OWNER_PAGE = readFileSync("src/app/(public)/account/business/[id]/pro-request/page.tsx", "utf8");
const ADMIN_ACTIONS = readFileSync("src/app/admin/(protected)/pro-requests/actions.ts", "utf8");
const ADMIN_PAGE = readFileSync("src/app/admin/(protected)/pro-requests/page.tsx", "utf8");
const LIB = readFileSync("src/lib/pro-access-requests.ts", "utf8");
const ENTITLEMENTS = readFileSync("src/lib/entitlements.ts", "utf8");

// Several guards below need to check actual SQL/code, not this file's own
// (or the source files') explanatory prose, which legitimately names
// things like "Stripe"/"expired"/"publication_status" when explaining why
// this pass deliberately does NOT touch them. Same false-positive class
// already fixed earlier this session (e.g. the carousel pass's own
// "aspect-square" doc-comment match) -- strip comments before asserting.
const sqlNoComments = (src) => src.replace(/--.*$/gm, "");
const tsNoComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const MIGRATION_SQL = sqlNoComments(MIGRATION);

// ── Schema shape: minimal, no speculative states ──────────────────────────
test("the table uses exactly the minimal status set and no speculative request_type/columns", () => {
  assert.match(MIGRATION, /status text not null default 'pending' check \(status in \('pending', 'approved', 'declined'\)\)/);
  for (const forbidden of ["reviewing", "deferred", "cancelled", "payment_pending", "request_type"]) {
    assert.doesNotMatch(MIGRATION_SQL, new RegExp(`\\b${forbidden}\\b`), `must not introduce speculative state/column "${forbidden}"`);
  }
  // Preferred conceptual fields are present.
  for (const col of ["business_id", "requested_by_user_id", "status", "message", "created_at", "reviewed_at", "admin_note"]) {
    assert.match(MIGRATION, new RegExp(col));
  }
});

test("no reviewed_by column -- follows business_claim_requests' own established precedent (single shared ADMIN_PASSWORD, no per-admin identities)", () => {
  // Scoped to the actual CREATE TABLE statement, not this migration's own
  // explanatory comment (which legitimately names "reviewed_by" when
  // explaining why it was deliberately NOT added).
  const createTableMatch = MIGRATION.match(/create table if not exists public\.business_pro_access_requests \(([\s\S]*?)\);/);
  assert.ok(createTableMatch, "expected the CREATE TABLE statement");
  assert.doesNotMatch(createTableMatch[1], /reviewed_by/);
});

// ── 3. Duplicate pending request blocked ──────────────────────────────────
test("a business can never have two simultaneously-pending requests (DB-enforced)", () => {
  assert.match(
    MIGRATION,
    /create unique index if not exists business_pro_access_requests_one_pending\s*\n\s*on public\.business_pro_access_requests \(business_id\) where status = 'pending';/
  );
});

test("the submit action proactively checks for an existing pending request before inserting, and gives a friendly message", () => {
  const insertIndex = SUBMIT_ACTION.indexOf(".insert({ business_id: businessId");
  const checkIndex = SUBMIT_ACTION.indexOf("existingPending");
  assert.ok(checkIndex !== -1 && insertIndex !== -1 && checkIndex < insertIndex, "must check for an existing pending request before inserting a new one");
  assert.match(SUBMIT_ACTION, /already pending review/);
});

// ── 1/2. Authorization: real member can request; others cannot ───────────
test("owner can request; manager can request; staff cannot; unrelated user cannot; admin Manage-As cannot bypass", () => {
  assert.match(SUBMIT_ACTION, /requireBusinessMember\(businessId\)/);
  // Unrelated user: requireBusinessMember() itself throws for a caller
  // with no business_members row at all (existing, unmodified behavior
  // in lib/permissions.ts) -- the catch block here redirects before
  // anything else runs.
  assert.match(SUBMIT_ACTION, /catch \(err\) \{\s*\n\s*redirect\(errorRedirectUrl\("\/account"/);
  // Admin Manage-As: refused outright regardless of its synthesized role
  // (requireMembership() gives it role "owner" -- see lib/permissions.ts
  // -- so this check must come from viaAdmin specifically, not from role).
  assert.match(SUBMIT_ACTION, /membership\.viaAdmin/);
  assert.match(SUBMIT_ACTION, /Exit Admin Mode to request Pro access/);
  // Owner/manager vs. staff: isManagingRole(role) is TRUE for "owner" and
  // "manager" and FALSE for "staff" (src/lib/business-locations.ts) --
  // reused here, not reimplemented.
  assert.match(SUBMIT_ACTION, /import \{ isManagingRole \} from "@\/lib\/business-locations";/);
  assert.match(SUBMIT_ACTION, /if \(!isManagingRole\(membership\.role\)\) \{/);
  assert.match(SUBMIT_ACTION, /Only owners and managers can request Pro access/);
  // Ordering: viaAdmin, then isManagingRole, then the insert -- an
  // unauthorized caller of any kind never reaches the database write.
  const authIndex = SUBMIT_ACTION.indexOf("requireBusinessMember(businessId)");
  const viaAdminIndex = SUBMIT_ACTION.indexOf("membership.viaAdmin");
  const roleIndex = SUBMIT_ACTION.indexOf("!isManagingRole(membership.role)");
  const insertIndex = SUBMIT_ACTION.indexOf(".insert({ business_id: businessId");
  assert.ok(authIndex < viaAdminIndex && viaAdminIndex < roleIndex && roleIndex < insertIndex);
});

test("RLS independently re-verifies OWNER/MANAGER role on INSERT (never staff) -- a crafted direct request can never bypass the Server Action's own check", () => {
  const insertPolicyMatch = MIGRATION.match(/create policy "business_pro_access_requests_insert_own_pending"[\s\S]*?with check \(([\s\S]*?)\);/);
  assert.ok(insertPolicyMatch, "expected the insert policy");
  const check = insertPolicyMatch[1];
  assert.match(check, /auth\.uid\(\) = requested_by_user_id/);
  assert.match(check, /status = 'pending'/);
  assert.match(check, /business_members/, "must independently re-verify real membership, not just row ownership");
  assert.match(check, /role in \('owner', 'manager'\)/, "must reject staff at the database layer too, not just hide the UI from them");
});

test("ordinary users cannot read another business's Pro access requests", () => {
  const selectPolicyMatch = MIGRATION.match(/create policy "business_pro_access_requests_select_member"[\s\S]*?using \(([\s\S]*?)\);/);
  assert.ok(selectPolicyMatch);
  assert.match(selectPolicyMatch[1], /business_members/);
  assert.match(selectPolicyMatch[1], /auth\.uid\(\)/);
  // No anon access at all, and no broad "select all" grant to authenticated.
  assert.match(MIGRATION, /revoke all on public\.business_pro_access_requests from anon;/);
  assert.match(MIGRATION, /revoke all on public\.business_pro_access_requests from authenticated;/);
  assert.doesNotMatch(MIGRATION, /grant select, insert, update, delete on public\.business_pro_access_requests to authenticated/);
});

// ── 4. Request persists and pending state can be retrieved ───────────────
test("the owner page shows a persistent pending state sourced from the real latest request row", () => {
  assert.match(LIB, /order\("created_at", \{ ascending: false \}\)\s*\n\s*\.limit\(1\)/);
  assert.match(OWNER_PAGE, /hasPendingRequest/);
  assert.match(OWNER_PAGE, /Request received\./);
  // Scoped to code (JSX/logic), not this page's own top doc comment,
  // which legitimately explains the pass's own "never shows a price"
  // design rule in prose.
  assert.doesNotMatch(tsNoComments(OWNER_PAGE), /\$\d|price|checkout|Stripe/i, "the request surface itself must never show a price or mention checkout/Stripe");
});

// ── 5/6. Active Pro blocks a new request; expired Pro does not ───────────
test("an already-ACTIVE Pro business is blocked from submitting a redundant request, using the existing isBusinessPro resolver (never a second definition)", () => {
  assert.match(SUBMIT_ACTION, /import \{ isBusinessPro \} from "@\/lib\/entitlements";/);
  assert.match(SUBMIT_ACTION, /if \(isBusinessPro\(business\)\) \{/);
  assert.match(SUBMIT_ACTION, /already has Findmi Pro active/);
  // The gate happens before the insert.
  const gateIndex = SUBMIT_ACTION.indexOf("if (isBusinessPro(business))");
  const insertIndex = SUBMIT_ACTION.indexOf(".insert({ business_id: businessId");
  assert.ok(gateIndex !== -1 && insertIndex !== -1 && gateIndex < insertIndex);
  // No second/parallel entitlement check re-implementing plan_tier/
  // plan_expires_at comparison logic in the action itself -- isBusinessPro
  // is the only resolver consulted.
  assert.doesNotMatch(SUBMIT_ACTION, /plan_expires_at\s*[<>]/, "must not re-implement expiration comparison -- isBusinessPro already does this");
});

test("isBusinessPro itself is unmodified by this pass (expired-Pro correctly returns false, so an expired business is allowed to request again with no special-casing)", () => {
  assert.match(
    ENTITLEMENTS,
    /export function isBusinessPro\(business: Pick<Business, "plan_tier" \| "plan_expires_at">\): boolean \{\s*\n\s*return isPlanTierPro\(business\.plan_tier\) && isPlanExpirationActive\(business\.plan_expires_at\);/
  );
  // The submit action never special-cases an expired business with its
  // own variable/branch -- it only ever calls the one resolver above,
  // which already returns false for an expired plan_tier='pro' row, so
  // the normal "not pro -> allowed to request" path is taken with zero
  // extra code. (Scoped to code, not this file's own explanatory comment,
  // which legitimately uses the word "expired" in prose.)
  assert.doesNotMatch(tsNoComments(SUBMIT_ACTION), /isExpiredPro/);
});

// ── 7/8. Admin can view; non-admin cannot review ──────────────────────────
test("the admin page lists requests and distinguishes pending vs resolved via a status filter, same pattern as /admin/claims", () => {
  assert.match(ADMIN_PAGE, /getAdminProAccessRequests/);
  assert.match(ADMIN_PAGE, /STATUS_VIEWS/);
  assert.match(ADMIN_PAGE, /"pending"/);
  assert.match(ADMIN_PAGE, /"approved"/);
  assert.match(ADMIN_PAGE, /"declined"/);
});

test("only an authenticated admin session can approve or decline -- the RPC and the table are both unreachable by an ordinary authenticated user", () => {
  assert.match(ADMIN_ACTIONS, /await requireAdminSupabase\(\);/g);
  // Both exported actions call it as their first real operation.
  const approveBody = ADMIN_ACTIONS.slice(ADMIN_ACTIONS.indexOf("export async function approveProAccessRequest"));
  const declineBody = ADMIN_ACTIONS.slice(ADMIN_ACTIONS.indexOf("export async function declineProAccessRequest"));
  assert.match(approveBody.slice(0, 200), /requireAdminSupabase\(\)/);
  assert.match(declineBody.slice(0, 200), /requireAdminSupabase\(\)/);
  // DB-level backstop: the RPC is revoked from public/anon/authenticated,
  // granted only to service_role -- a crafted client-side RPC call can
  // never approve a request even if the Server Action were somehow bypassed.
  assert.match(
    MIGRATION,
    /revoke execute on function public\.approve_pro_access_request\(uuid, timestamptz, text\) from public, anon, authenticated;/
  );
  assert.match(MIGRATION, /grant execute on function public\.approve_pro_access_request\(uuid, timestamptz, text\) to service_role;/);
  // Decline is a plain service-role-only UPDATE -- no UPDATE policy exists
  // for authenticated at all (checked above), so the same backstop applies.
});

// ── 9. Approval grants Pro using existing semantics ───────────────────────
test("approval writes the exact same businesses.plan_* columns as the existing Pro Invite / Stripe activation paths -- no second Pro definition", () => {
  for (const col of ["plan_tier = 'pro'", "plan_source = 'complimentary'", "plan_started_at = coalesce(plan_started_at, v_now)", "plan_expires_at = v_granted_expiry", "plan_payment_reference = 'pro_request:' || p_request_id"]) {
    assert.ok(MIGRATION.includes(col), `expected the RPC to write: ${col}`);
  }
  // publication_status/is_demo are never referenced by this migration's
  // actual SQL -- Pro entitlement and publication stay independent, same
  // locked rule pro_invites.sql itself documents. (Scoped past comments,
  // which legitimately name both columns when stating this rule in prose.)
  assert.doesNotMatch(MIGRATION_SQL, /publication_status|is_demo/);
});

// ── plan_source is an EXISTING, already-valid value -- never invented ────
test("plan_source='complimentary' is used, not a new invented value, and the businesses_plan_source_check constraint is never touched", () => {
  const planSourceMigrations = readFileSync("supabase/migrations/20260904000000_business_plan_tier_pro_seller_provenance.sql", "utf8");
  assert.match(planSourceMigrations, /check \(plan_source is null or plan_source in \('paid', 'complimentary', 'promotional', 'admin'\)\)/);
  assert.doesNotMatch(MIGRATION, /alter table public\.businesses/, "this migration must never alter the businesses table's own constraints");
  assert.doesNotMatch(MIGRATION, /plan_source = '(?!complimentary)[a-z_]+'/, "must only ever write the existing 'complimentary' value, never a new one");
});

// ── 10. Approval never invokes Stripe ──────────────────────────────────────
test("no file's actual code in this workflow references Stripe in any way", () => {
  // Scoped past comments throughout -- several files legitimately explain
  // in prose that this workflow never touches Stripe; the guard is that
  // no executable line does.
  for (const [name, src, strip] of [
    ["migration", MIGRATION, sqlNoComments],
    ["submit action", SUBMIT_ACTION, tsNoComments],
    ["owner page", OWNER_PAGE, tsNoComments],
    ["admin actions", ADMIN_ACTIONS, tsNoComments],
    ["admin page", ADMIN_PAGE, tsNoComments],
    ["lib", LIB, tsNoComments],
  ]) {
    assert.doesNotMatch(strip(src), /stripe/i, `${name} must never reference Stripe in actual code -- this workflow is a pure non-payment grant`);
  }
});

// ── 11. Approval preserves a stronger existing entitlement ────────────────
test("the approval RPC structurally distinguishes a CURRENTLY ACTIVE entitlement from nothing-to-protect, and never downgrades pro_seller", () => {
  assert.match(MIGRATION, /v_will_touch_plan := v_business\.plan_tier is distinct from 'pro_seller';/);
  assert.match(
    MIGRATION,
    /v_currently_active_pro := v_business\.plan_tier in \('pro', 'pro_seller'\)\s*\n\s*and \(v_business\.plan_expires_at is null or v_business\.plan_expires_at > v_now\);/
  );
  assert.match(MIGRATION, /if v_currently_active_pro and v_business\.plan_expires_at is null then\s*\n\s*v_granted_expiry := null;/);
  assert.match(MIGRATION, /elsif v_currently_active_pro and p_plan_expires_at is null then\s*\n\s*v_granted_expiry := null;/);
  assert.match(MIGRATION, /elsif v_currently_active_pro and v_business\.plan_expires_at > p_plan_expires_at then\s*\n\s*v_granted_expiry := v_business\.plan_expires_at;/);
  assert.match(MIGRATION, /else\s*\n\s*v_granted_expiry := p_plan_expires_at;\s*\n\s*end if;/);
  assert.match(MIGRATION, /if v_will_touch_plan then/, "a pro_seller business's row must not be touched at all");
});

// ── Adversarial safety review, cases A-K -- executable scenarios ─────────
// A pure-JS mirror of the RPC's own expiry-protection branching above,
// hand-kept in exact structural alignment with it (the structural test
// above catches drift between the two) -- this gives real, computed
// assertions for each required scenario rather than regex matching alone,
// which this plain node:test suite can otherwise only prove structurally
// (no live Postgres exists here to execute the real SQL against).
function mirrorGrantedExpiry({ planTier, planExpiresAt, now, adminChoice }) {
  const currentlyActive = (planTier === "pro" || planTier === "pro_seller") && (planExpiresAt === null || planExpiresAt > now);
  if (currentlyActive && planExpiresAt === null) return null;
  if (currentlyActive && adminChoice === null) return null;
  if (currentlyActive && planExpiresAt > adminChoice) return planExpiresAt;
  return adminChoice;
}
const NOW = 1000;

test("case F: business currently Free -> admin's own choice always applies, including a deliberately finite term (the bug this review found and fixed)", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "free", planExpiresAt: null, now: NOW, adminChoice: 2000 }), 2000);
  assert.equal(mirrorGrantedExpiry({ planTier: "free", planExpiresAt: null, now: NOW, adminChoice: null }), null);
});

test("case G: business active Pro with an EARLIER existing expiration -> admin's later choice extends it", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: 1500, now: NOW, adminChoice: 3000 }), 3000);
});

test("case H: business active Pro with a LATER existing expiration -> never shortened", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: 5000, now: NOW, adminChoice: 2000 }), 5000);
});

test("case I: business currently PERMANENT Pro -> stays permanent even if the admin tries to set a finite date (required invariant)", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: null, now: NOW, adminChoice: 2000 }), null);
});

test("case K: business has stored Pro but is EXPIRED -> treated as nothing-to-protect; admin's fresh choice (including permanent) applies", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: 500, now: NOW, adminChoice: 2000 }), 2000);
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: 500, now: NOW, adminChoice: null }), null);
});

test("an active, finite-term business can be explicitly upgraded to permanent by the admin", () => {
  assert.equal(mirrorGrantedExpiry({ planTier: "pro", planExpiresAt: 5000, now: NOW, adminChoice: null }), null);
});

test("case J: pro_seller is never touched at all (not even its expiry) -- verified via v_will_touch_plan, not the expiry function", () => {
  assert.match(MIGRATION, /v_will_touch_plan := v_business\.plan_tier is distinct from 'pro_seller';/);
  assert.match(MIGRATION, /if v_will_touch_plan then\s*\n\s*update public\.businesses/);
});

test("no hardcoded commercial duration is invented -- expiration is admin-chosen, defaulting to permanent, exactly like the existing Plan & Status convention", () => {
  assert.match(MIGRATION, /p_plan_expires_at timestamptz default null/);
  assert.doesNotMatch(MIGRATION, /make_interval\(days =>\s*(?!.*p_plan_expires_at)\d+\)/, "must not hardcode a new duration the way redeem_pro_invite does for its own invite-defined duration_days");
  assert.match(ADMIN_PAGE, /blank = permanent/i);
});

// ── 16. Repeated approval submission is safe (idempotent) ────────────────
test("case A: approving a request that does not exist fails cleanly, no mutation", () => {
  assert.match(MIGRATION, /select \* into v_request from public\.business_pro_access_requests where id = p_request_id for update;\s*\n\s*if not found then\s*\n\s*raise exception 'request_not_found';/);
  assert.match(ADMIN_ACTIONS, /request_not_found: "That request no longer exists\."/);
});

test("case C/D + E: approving an already-approved/declined request, or a replayed/concurrent approval, fails cleanly without double-granting or crashing", () => {
  assert.match(MIGRATION, /if v_request\.status <> 'pending' then\s*\n\s*raise exception 'request_not_pending';/);
  assert.match(ADMIN_ACTIONS, /request_not_pending: "That request has already been reviewed\."/);
  // Transactional safety for concurrent/replayed approval attempts on the
  // SAME request: both the request row and the business row are locked
  // with FOR UPDATE before any check reads their current values, so two
  // simultaneous approval calls are serialized by Postgres itself -- the
  // second transaction blocks until the first commits, then re-reads the
  // now-'approved' status and is rejected by the check above. This is the
  // same row-lock-then-validate pattern redeem_pro_invite() and
  // approve_business_claim() already use.
  assert.match(MIGRATION, /where id = p_request_id for update;/);
  assert.match(MIGRATION, /where id = v_request\.business_id for update;/);
});

// ── 12. Decline does not grant/change Pro ─────────────────────────────────
test("decline is a pure status update -- it never touches businesses/plan_tier and never calls the approval RPC", () => {
  const declineBody = ADMIN_ACTIONS.slice(
    ADMIN_ACTIONS.indexOf("export async function declineProAccessRequest"),
    ADMIN_ACTIONS.indexOf("export async function declineProAccessRequest") + 900
  );
  assert.match(declineBody, /\.from\("business_pro_access_requests"\)/);
  assert.match(declineBody, /status: "declined"/);
  assert.doesNotMatch(declineBody, /\.from\("businesses"\)/, "decline must never write to the businesses table");
  assert.doesNotMatch(declineBody, /approve_pro_access_request/, "decline must never invoke the approval RPC");
  assert.doesNotMatch(declineBody, /plan_tier|plan_expires_at|plan_source/);
});

// ── 13/15. Requester notification + admin notification ───────────────────
test("the requester is notified on both approval and decline, with neutral (never guaranteeing) decline language", () => {
  assert.match(ADMIN_ACTIONS, /type: "pro_access_request_approved"/);
  assert.match(ADMIN_ACTIONS, /type: "pro_access_request_declined"/);
  assert.match(ADMIN_ACTIONS, /wasn't approved this time/);
  assert.match(ADMIN_ACTIONS, /welcome to submit a new request later/);
  assert.match(ADMIN_ACTIONS, /sendProductNotification/);
});

test("admin is notified when a new request is submitted, reusing the existing notifyAdmin infrastructure", () => {
  assert.match(SUBMIT_ACTION, /import \{ notifyAdmin \} from "@\/lib\/notifications\/adminNotify";/);
  assert.match(SUBMIT_ACTION, /notifyAdmin\(\{/);
  assert.match(SUBMIT_ACTION, /actionUrl: "\/admin\/pro-requests\?status=pending"/);
});

// ── 14. Admin note is never exposed to the requester/business ────────────
test("admin_note is admin-only -- the owner-facing page never reads or renders it", () => {
  assert.doesNotMatch(OWNER_PAGE, /adminNote|admin_note/);
});

test("the requester-decision notification never includes the admin's internal note", () => {
  const notifyBody = ADMIN_ACTIONS.slice(ADMIN_ACTIONS.indexOf("async function notifyRequester"), ADMIN_ACTIONS.indexOf("// Matches the short exception"));
  assert.doesNotMatch(notifyBody, /admin_note|adminNote/, "the notification function must not select or forward admin_note to the requester");
});

// ── Scope guard: this pass does not repoint existing Upgrade CTAs ────────
test("static guard: no existing Upgrade/Checkout surface was touched by this pass", () => {
  const upgradePage = readFileSync("src/app/(public)/upgrade/pro/page.tsx", "utf8");
  assert.doesNotMatch(upgradePage, /pro-request|pro_access_request|requestProAccess/i, "the existing /upgrade/pro page must not yet reference the new request workflow");
  const businessPage = readFileSync("src/app/(public)/account/business/[id]/page.tsx", "utf8");
  assert.doesNotMatch(businessPage, /pro-request|requestProAccess/i, "the existing Business Manager (UpgradeLockedTab/Plan & Status) must not yet link to the new workflow -- that's a later, separate pass");
});
