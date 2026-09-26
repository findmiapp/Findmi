-- Entitlement Safety Fix — protect permanent Pro during Pro Invite
-- redemption.
--
-- BUG (found during the Recurring Billing Pass 2B audit): the original
-- redeem_pro_invite() (20260904210000_pro_invites.sql) correctly protects
-- pro_seller and an existing dated Pro expiration later than the invite's
-- own candidate expiration, but NOT permanent Pro
-- (plan_tier='pro' AND plan_expires_at IS NULL). Its "never shorten an
-- existing later expiration" check only fires when plan_expires_at IS NOT
-- NULL:
--
--   if v_business.plan_expires_at is not null and v_business.plan_expires_at > v_candidate_expiry then
--     v_granted_expiry := v_business.plan_expires_at;
--   else
--     v_granted_expiry := v_candidate_expiry;
--   end if;
--
-- For a permanent-Pro business, plan_expires_at IS NULL, so this falls
-- into the ELSE branch and produces a DATED v_granted_expiry — which then
-- gets written to businesses.plan_expires_at (since v_will_touch_plan was
-- only ever false for pro_seller), silently converting permanent Pro into
-- dated Pro. That is the bug this migration fixes.
--
-- THE FIX is a single-line change to v_will_touch_plan: it must also be
-- false when the business already has permanent Pro
-- (plan_tier='pro' AND plan_expires_at IS NULL) — the exact same
-- "record the redemption, but don't touch businesses" path pro_seller
-- already takes. Deliberately NOT a generic "plan_expires_at IS NULL ->
-- preserve" condition, which would incorrectly also protect a Free
-- business (plan_tier='free' AND plan_expires_at IS NULL is NOT
-- permanent — it is simply Free, and a valid invite must still be able to
-- grant it Pro). Permanent protection requires BOTH plan_tier='pro' AND
-- plan_expires_at IS NULL together.
--
-- Every other line of the function is byte-for-byte identical to the
-- original: same signature, same SECURITY DEFINER, same
-- `set search_path = ''`, same membership/invite/business validation,
-- same v_candidate_expiry/v_granted_expiry computation (unchanged — the
-- pro_seller precedent already records a "hypothetical" granted_until in
-- the ledger/return even though businesses isn't touched; the newly-
-- protected permanent-Pro case now follows that exact same existing
-- convention rather than inventing a new one), same
-- pro_invite_redemptions insert, same redemption_count increment, same
-- returned jsonb shape, same grants (service_role only). No table is
-- altered, no column is added, no index is added, no RLS changes, and no
-- existing row is rewritten by this migration.
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

  -- Pro Seller must never be downgraded to plain Pro, and PERMANENT Pro
  -- (plan_tier='pro' AND plan_expires_at IS NULL) must never be replaced
  -- with a dated expiry — this pass's own entitlement-safety fix. Neither
  -- case defines an extension behavior, so the safest non-destructive
  -- choice for both is identical: record the redemption (so it isn't
  -- silently lost) without touching businesses at all. A Free business
  -- with plan_expires_at IS NULL is NOT permanent (it simply has no Pro
  -- entitlement yet) and must still be eligible to receive Pro here — the
  -- second clause below only ever matches when plan_tier is ALREADY
  -- 'pro', never 'free'.
  v_will_touch_plan := v_business.plan_tier is distinct from 'pro_seller'
    and not (v_business.plan_tier = 'pro' and v_business.plan_expires_at is null);

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

-- Grants unchanged — CREATE OR REPLACE preserves existing grants in
-- Postgres, but re-asserting them here is cheap, explicit, and matches
-- this repo's own established convention of always restating grants
-- alongside a function definition rather than relying on them silently
-- carrying over.
revoke execute on function public.redeem_pro_invite(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_pro_invite(text, uuid, uuid) to service_role;
