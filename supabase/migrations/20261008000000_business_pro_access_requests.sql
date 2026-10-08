-- ============================================================================
-- Pro Access Request Workflow — V1
--
-- Lets an existing business member REQUEST Findmi Pro for their business —
-- no payment, no Stripe, no checkout session. Admin reviews the request and
-- either approves it (granting Pro through the exact same non-payment grant
-- semantics redeem_pro_invite() already established) or declines it. Fully
-- additive: no existing table/column is altered, no existing row is touched,
-- no existing entitlement/checkout code path is modified.
--
-- Scope is deliberately narrow — ONE request type (Pro access), not a
-- generalized "access request"/CRM table. See this pass's own report for
-- why `request_type` was NOT added: there is no second request type today,
-- and one would be speculative.
--
-- Design note, following business_claim_requests' own established
-- precedent exactly (see claim_and_membership_foundation.sql): no
-- `reviewed_by` column. Founder/admin still authenticates via a single
-- shared ADMIN_PASSWORD session cookie (src/lib/admin/auth.ts), not
-- individual auth.users identities — a `reviewed_by uuid references
-- auth.users(id)` column would have nothing real to point at. `reviewed_at`
-- + a free-text `admin_note` are recorded instead.
-- ============================================================================

create table if not exists public.business_pro_access_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The real, authenticated member who submitted the request — any current
  -- business_members row (owner/manager/staff), same "any real member,
  -- never an admin-elevated Manage-As session" authorization already used
  -- by startBusinessProCheckout/startSubscriptionCheckout for the
  -- equivalent "start a Pro-related commercial action" decision.
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  -- Optional free-text context from the requester ("what do you want to
  -- use Pro for"). Never required.
  message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Admin-only annotation, never exposed to the requester/business — see
  -- this pass's own notification code, which never reads this column.
  admin_note text
);

-- A business should never have more than one simultaneously-pending Pro
-- request — same partial-unique-index pattern as
-- business_claim_requests_one_pending, scoped to BUSINESS rather than to
-- (user, business): unlike a claim (which is personal to the claimant —
-- becoming a member), a Pro request is submitted on behalf of the whole
-- business's entitlement, so the "one active request" rule is business-
-- wide, not per-submitter. A declined request doesn't permanently block a
-- future one — the index is partial (status = 'pending' only), exactly
-- like the claim table's own index.
create unique index if not exists business_pro_access_requests_one_pending
  on public.business_pro_access_requests (business_id) where status = 'pending';

create index if not exists business_pro_access_requests_business_id_idx on public.business_pro_access_requests (business_id);
create index if not exists business_pro_access_requests_requested_by_idx on public.business_pro_access_requests (requested_by_user_id);
create index if not exists business_pro_access_requests_status_idx on public.business_pro_access_requests (status);

alter table public.business_pro_access_requests enable row level security;

-- SELECT — any CURRENT member of the business (not only the original
-- submitter) can see its request state, so "the business must have a
-- persistent way to see that the request is pending" (this pass's own
-- product rule) holds for whichever member happens to check, same as
-- Plan & Status already being visible to any member regardless of who
-- upgraded. This is a deliberate, narrow divergence from
-- business_claim_requests_select_own (which scopes to the claimant alone,
-- because a claim's subject is "me becoming a member" — there is no
-- membership yet to check against). A Pro request's subject is the
-- business's own entitlement, and every reader here already has a real
-- business_members row.
create policy "business_pro_access_requests_select_member"
  on public.business_pro_access_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.business_members
      where business_members.business_id = business_pro_access_requests.business_id
        and business_members.user_id = auth.uid()
    )
  );

-- INSERT — the submitting row's own user_id must be the caller, status
-- must default to 'pending' (closes the same self-approval-via-crafted-
-- payload escalation path business_claim_requests_insert_own_pending
-- already closes), AND — stronger than the claim table's own insert check,
-- because this concept presupposes existing membership rather than
-- requesting it — the caller must already be a real current OWNER or
-- MANAGER of the target business (never staff — a review correction:
-- initiating a request that changes the business's commercial/service
-- relationship with Findmi is an owner/manager-level decision, same
-- "isManagingRole" bar src/lib/business-locations.ts already draws for
-- the equivalent class of decision on Locations). A client cannot submit
-- a Pro request for a business it doesn't belong to, or as a staff
-- member, even with a crafted direct PostgREST call.
create policy "business_pro_access_requests_insert_own_pending"
  on public.business_pro_access_requests for insert
  to authenticated
  with check (
    auth.uid() = requested_by_user_id
    and status = 'pending'
    and exists (
      select 1 from public.business_members
      where business_members.business_id = business_pro_access_requests.business_id
        and business_members.user_id = auth.uid()
        and business_members.role in ('owner', 'manager')
    )
  );

-- No UPDATE/DELETE policy for authenticated — status can only change via
-- the service-role paths below (the approve RPC, or a plain service-role
-- UPDATE for decline — see admin/pro-requests/actions.ts), never by the
-- client. No anon policy anywhere in this file.

revoke all on public.business_pro_access_requests from anon;
revoke all on public.business_pro_access_requests from authenticated;
grant select, insert on public.business_pro_access_requests to authenticated;
grant select, insert, update, delete on public.business_pro_access_requests to service_role;

-- ── approve_pro_access_request() — the one atomic, secure approval path ───
--
-- Mirrors redeem_pro_invite()'s own non-destructive entitlement-grant
-- intent (never downgrades pro_seller, never rewrites plan_started_at
-- once already set, never touches publication_status/is_demo) — this is
-- a deliberate, small, scoped duplication rather than refactoring
-- redeem_pro_invite() itself (explicitly out of scope for this pass —
-- "Do NOT touch Pro Invite redemption"). Writes the exact same four
-- businesses.plan_* columns activateBusinessPro()/redeem_pro_invite()
-- already write — this never defines a second notion of what "Pro"
-- means; isBusinessPro() in src/lib/entitlements.ts is untouched and
-- keeps being the one resolver every FEATURE GATE calls.
--
-- Adversarial-review correction (Pro Access Request Pass 2) — the
-- expiry-protection math is INTENTIONALLY not a byte-for-byte copy of
-- redeem_pro_invite()'s own version: that function only protects an
-- existing NON-NULL later expiration, so a currently-permanent (null)
-- Pro business redeeming a term-limited invite would, under that logic,
-- have its permanent grant silently converted into an expiring one — a
-- latent asymmetry in that already-shipped function, explicitly left
-- untouched here (out of scope). This RPC closes that gap for ITSELF:
-- v_currently_active_pro (see below) distinguishes "nothing currently
-- active to protect" (a never-Pro Free business, or a lapsed/expired one)
-- from "an active permanent grant that must never be weakened," so a
-- first-time Free business always receives exactly what the admin chose
-- (including a deliberately finite term), while an existing permanent
-- grant can never be downgraded to one.
--
-- plan_source = 'complimentary' — the existing, already-valid, non-payment
-- source value (businesses_plan_source_check) that already means exactly
-- this: Pro granted without Stripe, via a legitimate non-payment path. No
-- new plan_source value is introduced. plan_payment_reference records
-- 'pro_request:<request id>' (same "<kind>:<id>" shape as
-- redeem_pro_invite()'s own 'invite:<code>', already-established generic
-- provenance this column tolerates — audited: no reader anywhere parses
-- or assumes a Stripe/payment-specific format for this column) so the
-- grant's provenance traces back to this exact request row.
--
-- p_plan_expires_at is OPTIONAL and admin-chosen — null means a permanent
-- grant (same existing admin semantics as the Plan & Status/BusinessForm
-- "leave blank for a permanent grant" convention). This pass invents no
-- new commercial term (no hardcoded 30/90/365-day default) — whatever the
-- admin chooses (or leaves blank) is exactly what's granted, subject only
-- to the non-destructive protection described above.
--
-- SECURITY DEFINER + search_path = '' + service_role-only EXECUTE, same
-- convention as approve_business_claim()/redeem_pro_invite() — reachable
-- only via requireAdminSupabase() -> getAdminSupabase(), never from a
-- client.
create or replace function public.approve_pro_access_request(
  p_request_id uuid,
  p_plan_expires_at timestamptz default null,
  p_admin_note text default null
)
returns public.business_pro_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.business_pro_access_requests;
  v_business public.businesses;
  v_now timestamptz := now();
  v_granted_expiry timestamptz;
  v_will_touch_plan boolean;
  -- Adversarial-review correction: whether the business holds a CURRENTLY
  -- ACTIVE Pro-ish entitlement right now — the exact two conditions
  -- isBusinessPro() in src/lib/entitlements.ts checks (plan_tier is pro/
  -- pro_seller, AND not expired), re-expressed here ONLY to decide whether
  -- there is an existing live grant worth protecting. This is intrinsic,
  -- private math for this one RPC's own non-destructive-grant invariant —
  -- never exported, never reused for feature gating anywhere else, and
  -- isBusinessPro() itself remains the one resolver every Pro-gated
  -- feature calls. Without this, a FREE business (plan_tier='free',
  -- plan_expires_at null because it has never been Pro) would wrongly hit
  -- the same "existing null = permanent, protect it" branch a genuinely
  -- permanent Pro business hits, forcing every first-time grant to
  -- permanent regardless of what the admin actually chose.
  v_currently_active_pro boolean;
begin
  select * into v_request from public.business_pro_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  select * into v_business from public.businesses where id = v_request.business_id for update;
  if v_business.id is null then
    raise exception 'business_not_found';
  end if;

  -- Pro Seller must never be downgraded to plain Pro (same rule
  -- redeem_pro_invite() already applies) — record the approval without
  -- touching businesses at all when the business is already pro_seller.
  v_will_touch_plan := v_business.plan_tier is distinct from 'pro_seller';

  v_currently_active_pro := v_business.plan_tier in ('pro', 'pro_seller')
    and (v_business.plan_expires_at is null or v_business.plan_expires_at > v_now);

  -- Never shorten or convert an existing, CURRENTLY ACTIVE entitlement —
  -- a permanent (null) active grant is the strongest possible state and
  -- is never converted into an expiring one; between two non-null dates,
  -- the later one wins. A business with NOTHING currently active to
  -- protect (never-Pro Free, or a lapsed/expired Pro row) simply receives
  -- exactly what the admin chose, including a blank (permanent) choice —
  -- there is no existing grant to preserve, so nothing overrides the
  -- admin's own selection.
  if v_currently_active_pro and v_business.plan_expires_at is null then
    v_granted_expiry := null;
  elsif v_currently_active_pro and p_plan_expires_at is null then
    v_granted_expiry := null;
  elsif v_currently_active_pro and v_business.plan_expires_at > p_plan_expires_at then
    v_granted_expiry := v_business.plan_expires_at;
  else
    v_granted_expiry := p_plan_expires_at;
  end if;

  if v_will_touch_plan then
    update public.businesses
    set
      plan_tier = 'pro',
      plan_source = 'complimentary',
      plan_started_at = coalesce(plan_started_at, v_now),
      plan_expires_at = v_granted_expiry,
      plan_payment_reference = 'pro_request:' || p_request_id
      -- publication_status, is_demo: intentionally never referenced.
    where id = v_business.id;
  end if;

  update public.business_pro_access_requests
  set status = 'approved', reviewed_at = v_now, admin_note = coalesce(p_admin_note, admin_note)
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function public.approve_pro_access_request(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.approve_pro_access_request(uuid, timestamptz, text) to service_role;

-- Decline never touches businesses, so (like rejectClaim) it's already
-- atomic as a single guarded UPDATE issued directly from the admin Server
-- Action via the service-role client — no function needed for it.
