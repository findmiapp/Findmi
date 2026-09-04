-- ============================================================================
-- Pro Invite / Complimentary Access Codes — V1
--
-- Lets founder admin create a code/link that grants complimentary FindMi
-- Pro to ONE specific business, no Stripe involved. Fully additive: no
-- existing table/column is altered, no existing row is touched.
--
-- LOCKED RULE (unchanged elsewhere in this pass): Pro entitlement and
-- publication are completely independent. Nothing in this migration's RPC
-- ever reads or writes businesses.publication_status/is_demo, and it never
-- touches product moderation or Marketplace distribution either — it only
-- ever writes businesses.plan_tier/plan_source/plan_started_at/
-- plan_expires_at/plan_payment_reference (the exact same columns
-- businessProActivation.ts's Stripe-driven activateBusinessPro() already
-- writes) plus its own two new tables below.
--
-- pro_invites — one row per invite/campaign code. Admin-only; never
-- granted to anon/authenticated (same "internal entitlement state, admin-
-- managed" precedent as businesses.plan_tier itself — see
-- restrict_internal_commerce_columns and business_plan_tier_pro_seller_
-- provenance). Reachable only via getAdminSupabase() (admin UI) and via
-- the SECURITY DEFINER redeem_pro_invite() RPC below (service_role only,
-- same grant pattern as create_owned_business/set_business_category — see
-- the RPC's own comment for why the RPC's service_role-only grant is
-- reused here rather than an authenticated-callable function).
--
-- plan_tier is constrained to 'pro' only for this V1 pass — Pro Seller
-- invitations are explicitly out of scope (see this pass's own "DO NOT
-- BUILD" list). Widening this later is a one-line CHECK change, not a
-- redesign.
--
-- code uniqueness is case-insensitive by a unique index on upper(code),
-- not by forcing the stored value to uppercase — an admin can enter
-- "Minthorne2026" and it displays exactly that way, while "MINTHORNE2026"
-- and "minthorne2026" both still collide with it.
-- ============================================================================

create table if not exists public.pro_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- Optional campaign/internal label, shown in admin only — never public.
  name text,
  -- V1 scope only. Widen the check (and admin UI) later if Pro Seller
  -- invites are ever explicitly requested — not built here.
  plan_tier text not null default 'pro' check (plan_tier = 'pro'),
  duration_days integer not null default 365 check (duration_days > 0),
  -- null = unlimited redemptions.
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  -- Free-text admin note, NOT a foreign key: the founder admin system
  -- (src/lib/admin/auth.ts) is a single shared ADMIN_PASSWORD with no
  -- per-admin accounts/identities (see CLAUDE.md — "no accounts/roles"),
  -- so there is no real auth.users row to reference as "created by." This
  -- is the smallest schema-consistent way to still capture optional
  -- provenance the admin types themselves (e.g. "Sarah — launch
  -- partners"), without inventing a fake identity reference.
  created_by_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pro_invites_code_ci_key on public.pro_invites (upper(code));

create trigger trg_pro_invites_updated_at
  before update on public.pro_invites
  for each row execute function public.set_updated_at();

alter table public.pro_invites enable row level security;
-- No policies created: with RLS enabled and zero policies, this table is
-- inaccessible to anon/authenticated (and to PostgREST's `authenticated`/
-- `anon` roles) even if a future grant were accidentally added — the
-- deliberately-defensive default for admin-only entitlement data.
-- service_role bypasses RLS entirely, same as every other admin-only
-- table in this schema.

-- pro_invite_redemptions — the ledger. One row per successful redemption;
-- the unique constraint on (invite_id, business_id) is the actual
-- duplicate-redemption guard (DB-enforced, never trusted to the UI/app
-- layer alone), matching this pass's own "use constraints/indexes rather
-- than trusting UI alone" instruction.
create table if not exists public.pro_invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.pro_invites(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The redeeming user's real Supabase Auth identity — unlike pro_invites'
  -- created_by_note above, this one DOES have a real auth.users row to
  -- reference, since redemption always happens through a signed-in
  -- vendor's own session.
  redeemed_by uuid not null references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  previous_plan_tier text,
  granted_plan_tier text not null,
  granted_until timestamptz not null,
  unique (invite_id, business_id)
);

alter table public.pro_invite_redemptions enable row level security;
-- Same deliberate no-policy default as pro_invites above — admin-only
-- read (getAdminSupabase()), written only by the SECURITY DEFINER RPC
-- below (service_role, bypasses RLS).

-- ── redeem_pro_invite() — the one atomic, secure redemption path ──────────
--
-- SECURITY DEFINER so it can read pro_invites/pro_invite_redemptions
-- (both otherwise policy-less/inaccessible) and update businesses, while
-- staying reachable ONLY via a server-side Server Action — same
-- service_role-only grant pattern already established by
-- create_owned_business()/set_business_category() in this codebase
-- (never granted to anon/authenticated directly). p_user_id is expected
-- to already be the CALLING Server Action's own session-derived identity
-- (getServerSupabase().auth.getUser(), read and verified BEFORE this RPC
-- is invoked via the service-role client) — exactly create_owned_
-- business()'s own p_user_id convention, never a client-submitted value.
-- The calling action additionally re-verifies real business_members
-- access via requireBusinessMember() before ever reaching this RPC (see
-- (public)/redeem/actions.ts) — this function independently re-checks
-- business_members membership too, as the actual enforcement boundary
-- (never trusts the caller's own prior check alone).
--
-- Concurrency safety: the invite row is locked with `for update` before
-- any of its counters/limits are read, so two simultaneous redemptions
-- of a single-use (or last-remaining-use) code can never both succeed —
-- the second transaction blocks until the first commits (consuming the
-- slot) or rolls back, then re-reads the now-current redemption_count.
--
-- Non-destructive entitlement rule: never shortens an existing later
-- expiration, never downgrades pro_seller to pro, never touches
-- publication_status/is_demo, never rewrites plan_started_at once
-- already set.
create or replace function public.redeem_pro_invite(
  p_code text,
  p_business_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.pro_invites;
  v_business public.businesses;
  v_now timestamptz := now();
  v_candidate_expiry timestamptz;
  v_granted_expiry timestamptz;
  v_will_touch_plan boolean;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_business_id is null then
    raise exception 'business_required';
  end if;

  -- Real, current membership — never trusts that the caller already
  -- checked this; this is the actual enforcement boundary. Any role
  -- (owner/manager/staff) counts, same definition requireBusinessMember()
  -- already uses everywhere else in the app.
  if not exists (
    select 1 from public.business_members
    where business_id = p_business_id and user_id = p_user_id
  ) then
    raise exception 'not_authorized_for_business';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;

  -- Row lock FIRST, before any validation reads redemption_count/limits —
  -- the actual concurrency guard described above.
  select * into v_invite
  from public.pro_invites
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_invite.id is null then
    raise exception 'invalid_code';
  end if;
  if not v_invite.is_active then
    raise exception 'invite_inactive';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= v_now then
    raise exception 'invite_expired';
  end if;
  if v_invite.max_redemptions is not null and v_invite.redemption_count >= v_invite.max_redemptions then
    raise exception 'invite_redemption_limit_reached';
  end if;
  if exists (
    select 1 from public.pro_invite_redemptions
    where invite_id = v_invite.id and business_id = p_business_id
  ) then
    raise exception 'already_redeemed_by_business';
  end if;

  select * into v_business from public.businesses where id = p_business_id for update;
  if v_business.id is null then
    raise exception 'business_not_found';
  end if;

  -- Pro Seller must never be downgraded to plain Pro — and this pass
  -- defines no extension behavior for that dormant, not-yet-billed tier,
  -- so the safest non-destructive choice is to record the redemption
  -- (so it isn't silently lost) without touching businesses at all when
  -- the business is already pro_seller.
  v_will_touch_plan := v_business.plan_tier is distinct from 'pro_seller';

  v_candidate_expiry := v_now + make_interval(days => v_invite.duration_days);
  -- Never shorten an existing later expiration (paid or otherwise).
  if v_business.plan_expires_at is not null and v_business.plan_expires_at > v_candidate_expiry then
    v_granted_expiry := v_business.plan_expires_at;
  else
    v_granted_expiry := v_candidate_expiry;
  end if;

  if v_will_touch_plan then
    update public.businesses
    set
      plan_tier = 'pro',
      plan_source = 'complimentary',
      -- Only stamp plan_started_at the first time this business becomes
      -- Pro-ish (i.e. it didn't already have one) — an extension of an
      -- already-Pro business's expiration doesn't reset when its Pro
      -- access originally started.
      plan_started_at = coalesce(plan_started_at, v_now),
      plan_expires_at = v_granted_expiry,
      plan_payment_reference = 'invite:' || v_invite.code
      -- publication_status, is_demo: intentionally never referenced.
    where id = p_business_id;
  end if;

  insert into public.pro_invite_redemptions (
    invite_id, business_id, redeemed_by, previous_plan_tier, granted_plan_tier, granted_until
  ) values (
    v_invite.id, p_business_id, p_user_id, v_business.plan_tier, 'pro', v_granted_expiry
  );

  update public.pro_invites
  set redemption_count = redemption_count + 1
  where id = v_invite.id;

  return jsonb_build_object(
    'business_id', p_business_id,
    'business_name', v_business.name,
    'plan_tier_changed', v_will_touch_plan,
    'granted_until', v_granted_expiry
  );
end;
$$;

revoke execute on function public.redeem_pro_invite(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_pro_invite(text, uuid, uuid) to service_role;
