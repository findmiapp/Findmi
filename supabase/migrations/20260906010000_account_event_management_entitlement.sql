-- ============================================================================
-- Multi-Entity Self-Service V1, Stage 2B — Account-level Event Management
-- entitlement + Pro Invite grant purpose.
--
-- PROBLEM (Event Entitlement Edge-Case audit): Stage 2's
-- canCurrentUserManageEvents() only ever checks business_members ->
-- businesses.plan_tier, so a signed-in user with NO business at all
-- cannot receive complimentary Event-management access without first
-- creating a placeholder Business purely to redeem a Pro Invite onto it —
-- unwanted friction for a pure event organizer.
--
-- FIX, kept strictly additive and non-destructive to the existing
-- Business Pro path:
--
--   1. pro_invites.grant_purpose — lets the founder mark an invite as
--      either 'business_pro' (existing behavior, exactly unchanged) or
--      'event_management' (new: grants an ACCOUNT-level entitlement,
--      never touches any business row at all). Defaults to
--      'business_pro' so every existing invite (including the one real
--      row already in production) keeps behaving exactly as it does
--      today with zero migration-time data change beyond the new
--      column's own default fill-in.
--
--   2. account_entitlements — the new, deliberately small account-level
--      grant table. NOT a billing system: one row per (user, entitlement
--      key, source), extended (never shortened) on repeat redemption of
--      the same source, same "never shorten an existing later
--      expiration" discipline redeem_pro_invite() already uses for
--      Business Pro. entitlement_key is constrained to exactly
--      'event_management' for this pass — same "single-value CHECK now,
--      widen later" convention pro_invites.plan_tier already established
--      for its own single-value V1 CHECK.
--
--   3. redeem_event_management_invite() — a NEW, separate RPC. Business
--      Pro's own redeem_pro_invite() is completely untouched by this
--      migration (zero risk to its proven behavior) — this is a sibling
--      function for the 'event_management' purpose only, never writes to
--      businesses/business_members/pro_invite_redemptions, and refuses to
--      run against a 'business_pro'-purpose invite (defense-in-depth:
--      the calling Server Action already branches on the invite's own
--      stored grant_purpose before ever choosing which RPC to call, but
--      this function independently re-checks too, never trusting the
--      caller's prior branch alone — same discipline redeem_pro_invite()
--      itself already documents for its own business_members re-check).
-- ============================================================================

alter table public.pro_invites
  add column if not exists grant_purpose text not null default 'business_pro'
    check (grant_purpose in ('business_pro', 'event_management'));

create table if not exists public.account_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- V1 scope only, same "single-value CHECK, widen later" convention as
  -- pro_invites.plan_tier. Widening this later is a one-line CHECK
  -- change, not a redesign.
  entitlement_key text not null check (entitlement_key = 'event_management'),
  -- Free-text provenance, e.g. "invite:LAUNCH2026" — mirrors
  -- businesses.plan_payment_reference's own "invite:<code>" convention
  -- from redeem_pro_invite(). Never a foreign key to pro_invites: an
  -- entitlement must survive an invite being later edited/deleted.
  source text not null,
  granted_at timestamptz not null default now(),
  -- Null would mean "never expires" (not used by the invite-redemption
  -- path today, which always has a finite pro_invites.duration_days, but
  -- left nullable for a future non-invite grant source without a schema
  -- change).
  expires_at timestamptz,
  -- One row per (user, entitlement, source): re-redeeming the SAME
  -- invite code is an idempotent extension (see the RPC below), never a
  -- duplicate row; redeeming a DIFFERENT invite/source for the same
  -- entitlement_key is a separate, legitimately distinct grant.
  unique (user_id, entitlement_key, source)
);

create index if not exists account_entitlements_user_id_idx on public.account_entitlements (user_id);

alter table public.account_entitlements enable row level security;
-- Same deliberate "RLS enabled, zero policies, service-role only" default
-- as pro_invites/pro_invite_redemptions — this is internal entitlement
-- state, never read/written directly by a client. Explicit revoke/grant
-- (not just relying on RLS) matches the more conservative precedent set
-- by business_members/event_members/claim_requests in the claim
-- foundation migration.
revoke all on public.account_entitlements from anon;
revoke all on public.account_entitlements from authenticated;
grant select, insert, update, delete on public.account_entitlements to service_role;

-- ── redeem_event_management_invite() ────────────────────────────────────
--
-- SECURITY DEFINER, service_role-only execute — same grant pattern as
-- redeem_pro_invite()/create_owned_business(). p_user_id is expected to
-- already be the CALLING Server Action's own session-derived identity
-- (never a client-submitted value) — see (public)/redeem/actions.ts.
--
-- Concurrency safety: the invite row is locked with `for update` before
-- its counters/limits are read, same reasoning as redeem_pro_invite().
--
-- Never shortens an existing later expiration on repeat redemption of the
-- same source (same non-destructive rule redeem_pro_invite() uses for
-- Business Pro) — implemented via ON CONFLICT ... DO UPDATE with an
-- explicit GREATEST-style comparison rather than blindly overwriting.
create or replace function public.redeem_event_management_invite(
  p_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.pro_invites;
  v_now timestamptz := now();
  v_candidate_expiry timestamptz;
  v_source text;
  v_existing_expires_at timestamptz;
  v_granted_expiry timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;

  select * into v_invite
  from public.pro_invites
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_invite.id is null then
    raise exception 'invalid_code';
  end if;
  -- Defense-in-depth — the calling action already branches on
  -- grant_purpose before choosing this RPC, but this function never
  -- trusts that alone: a 'business_pro' invite can never grant an
  -- account-level entitlement through this path, no matter how it's
  -- called.
  if v_invite.grant_purpose <> 'event_management' then
    raise exception 'wrong_invite_purpose';
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

  v_candidate_expiry := v_now + make_interval(days => v_invite.duration_days);
  v_source := 'invite:' || v_invite.code;

  select expires_at into v_existing_expires_at
  from public.account_entitlements
  where user_id = p_user_id and entitlement_key = 'event_management' and source = v_source
  for update;

  if v_existing_expires_at is not null and v_existing_expires_at > v_candidate_expiry then
    v_granted_expiry := v_existing_expires_at;
  else
    v_granted_expiry := v_candidate_expiry;
  end if;

  insert into public.account_entitlements (user_id, entitlement_key, source, granted_at, expires_at)
  values (p_user_id, 'event_management', v_source, v_now, v_granted_expiry)
  on conflict (user_id, entitlement_key, source)
  do update set expires_at = v_granted_expiry;

  -- Shared redemption_count with the Business Pro path — one counter per
  -- invite regardless of purpose, so max_redemptions means the same thing
  -- either way. Never touches businesses, business_members, or
  -- pro_invite_redemptions.
  update public.pro_invites
  set redemption_count = redemption_count + 1
  where id = v_invite.id;

  return jsonb_build_object('granted_until', v_granted_expiry);
end;
$$;

revoke execute on function public.redeem_event_management_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_event_management_invite(text, uuid) to service_role;
