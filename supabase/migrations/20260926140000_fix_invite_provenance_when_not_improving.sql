-- Entitlement Consistency Cleanup — stop redeem_pro_invite() from
-- overwriting provenance when its own candidate expiry does not actually
-- improve the business's effective entitlement.
--
-- BUG (found during the no-Stripe torture test audit): the prior fix
-- (20260926130000) correctly protects permanent Pro and pro_seller by
-- skipping the businesses UPDATE entirely for those two cases. It did
-- NOT protect the third case this same class of bug applies to: an
-- existing DATED Pro entitlement (from ANY source — a recurring
-- subscription, an admin grant, a previous complimentary/promotional
-- invite, or a legacy $99 purchase) whose expiry is later than or equal
-- to the invite's own candidate expiry. v_will_touch_plan was TRUE for
-- every plan_tier except pro_seller/permanent-Pro, so the function still
-- executed the UPDATE and overwrote plan_source/plan_payment_reference
-- (and would have re-stamped plan_started_at, guarded only by its own
-- coalesce) to invite-sourced values — even though the invite's own date
-- LOST the comparison and the existing entitlement's date is what
-- actually continued to control access. That misattributes provenance:
-- plan_source no longer describes the entitlement that is actually
-- effective, violating this system's own stated rule (see this
-- migration's own comment and the audit report).
--
-- THE FIX: v_will_touch_plan's third case (a plain, non-permanent,
-- non-pro_seller 'pro' business) is now conditioned on the invite's
-- candidate expiry being STRICTLY LATER than the business's existing
-- plan_expires_at. An EQUAL candidate is deliberately NOT an improvement
-- (per this pass's own explicit instruction) — nothing about the
-- business's effective access changes, so nothing should be rewritten.
-- Free (plan_tier <> 'pro' and <> 'pro_seller') has no existing dated
-- expiry to compare against at all, so the invite unconditionally
-- improves it, exactly as before.
--
-- v_candidate_expiry is now computed BEFORE v_will_touch_plan (previously
-- computed after) purely so the comparison above has a value to read —
-- its own computation (`v_now + make_interval(days => v_invite.
-- duration_days)`) is completely unchanged. v_granted_expiry's own
-- "never shorten" comparison against v_candidate_expiry is likewise
-- completely unchanged — it already correctly produced the greater of
-- the two (or the candidate, for a NULL/permanent existing expiry) in
-- every case, including the newly-protected equal-expiry case, so the
-- ledger's own granted_until value needs no change at all.
--
-- Every other line — signature, SECURITY DEFINER, search_path, real
-- business_members authorization, invite code/active/expiry/redemption-
-- limit/already-redeemed validation, the pro_invite_redemptions insert,
-- the redemption_count increment, the returned jsonb shape, and the
-- function's grants — is byte-for-byte identical to the prior migration.
-- No table is altered, no column is added, no index is added, no RLS
-- changes, and no existing row is rewritten by this migration.
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

  v_candidate_expiry := v_now + make_interval(days => v_invite.duration_days);

  -- Pro Seller is never downgraded; PERMANENT Pro (plan_tier='pro' AND
  -- plan_expires_at IS NULL) is never replaced with a dated expiry; and
  -- an existing DATED Pro entitlement is only replaced when the invite's
  -- own candidate is STRICTLY LATER than what's already there — an equal
  -- or earlier candidate does not actually improve the business's
  -- effective access, so touching plan_source/plan_payment_reference in
  -- that case would misattribute provenance away from the entitlement
  -- that is actually controlling access (Entitlement Consistency Cleanup
  -- pass). Free (plan_tier <> 'pro' and <> 'pro_seller') has no existing
  -- dated expiry to compare against, so the invite unconditionally
  -- improves it.
  v_will_touch_plan := (v_business.plan_tier is distinct from 'pro_seller')
    and not (v_business.plan_tier = 'pro' and v_business.plan_expires_at is null)
    and (
      v_business.plan_tier is distinct from 'pro'
      or v_candidate_expiry > v_business.plan_expires_at
    );

  -- Never shorten an existing later (or equal) expiration — unchanged;
  -- this is the value recorded in the ledger/return regardless of
  -- whether businesses itself ends up touched below.
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

-- Grants unchanged — re-asserted explicitly, same convention as the
-- prior migration.
revoke execute on function public.redeem_pro_invite(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_pro_invite(text, uuid, uuid) to service_role;
