-- ============================================================================
-- Referral Partner + Discount + Manual Payout Foundation — V1
--
-- A COMPLETELY SEPARATE system from Pro Invites (pro_invites/
-- pro_invite_redemptions/redeem_pro_invite — none of those tables/
-- functions are touched by this migration). Pro Invite = complimentary
-- Pro for one business, no payment. Referral = attribution + an optional
-- percentage discount on the EXISTING one-time $99 Pro checkout + a
-- commission earned only on an actual qualifying paid conversion. A
-- business can have both independently: complimentary Pro via an invite,
-- AND its own separate referral-partner relationship.
--
-- Five new tables, all admin-only (RLS enabled, zero policies — same
-- deliberately-defensive "inaccessible to anon/authenticated even under
-- an accidental future grant" pattern pro_invites already established):
--   referral_partners        — one row per partner, tied to a business.
--   referral_codes           — one or more codes per partner.
--   referral_attributions    — ONE immutable row per REFERRED business
--                              (unique on business_id — a business can
--                              never be attributed twice).
--   referral_payout_requests — a partner's request to be paid out.
--   referral_earnings        — the durable ledger. unique on
--                              qualifying_payment_reference is the ACTUAL
--                              idempotency guard against a Stripe webhook
--                              retry ever creating a duplicate commission.
--
-- Three SECURITY DEFINER RPCs, service_role-only (same grant convention
-- as create_owned_business/set_business_category/redeem_pro_invite):
--   attribute_referral()      — records attribution at business-creation
--                                time only (see that RPC's own comment
--                                for why "attribute an existing business
--                                later" is deliberately NOT supported).
--   qualify_referral_earning() — called ONLY from the signature-verified
--                                Stripe webhook after a real paid Pro
--                                charge; creates the one earning row for
--                                that payment, idempotently.
--   request_referral_payout()  — atomically bundles a partner's entire
--                                CURRENT available balance into one new
--                                payout request (see its own comment for
--                                why V1 doesn't accept a client-chosen
--                                partial amount).
-- ============================================================================

-- ── referral_partners ───────────────────────────────────────────────────
create table if not exists public.referral_partners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- V1: one primary referral-partner record per partner business (this
  -- pass's own explicit scope) — enforced here, not just assumed.
  unique (business_id),
  -- Optional display label override (e.g. "Stereotype Studio Partners")
  -- shown in admin only — falls back to the business's own name when
  -- blank, never required.
  label text,
  is_active boolean not null default true,
  -- Default commission for a qualifying paid Pro conversion — the
  -- initial use case's $20. Stored in integer cents throughout this
  -- entire feature, same convention lib/commerce/fees.ts already uses.
  default_commission_cents integer not null default 2000 check (default_commission_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_referral_partners_updated_at
  before update on public.referral_partners
  for each row execute function public.set_updated_at();

alter table public.referral_partners enable row level security;
-- No policies: RLS enabled + zero policies makes this admin/service-role
-- only, same deliberate default as pro_invites.

-- ── referral_codes ──────────────────────────────────────────────────────
create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id) on delete cascade,
  code text not null,
  is_active boolean not null default true,
  -- V1 scope only, per this pass's own instruction — a one-line CHECK
  -- change (plus admin UI) if a flat-amount discount is ever requested.
  discount_type text not null default 'percentage' check (discount_type = 'percentage'),
  -- Admin-chosen, never hard-coded (this pass's own instruction) — the
  -- intended STEREOTYPE20 example is just data, not a constant anywhere
  -- in code.
  discount_percent numeric(5, 2) not null check (discount_percent >= 0 and discount_percent <= 100),
  expires_at timestamptz,
  -- null = unlimited attributions.
  max_uses integer check (max_uses is null or max_uses > 0),
  -- Counts ATTRIBUTIONS (businesses referred with this code), incremented
  -- inside attribute_referral() — not checkout attempts and not paid
  -- conversions. A discount already promised to an attributed business
  -- at signup keeps applying at checkout even if this code is later
  -- deactivated/expired/exhausted (see createBusinessProCheckoutSession's
  -- own comment) — max_uses only gates NEW attributions.
  use_count integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists referral_codes_code_ci_key on public.referral_codes (upper(code));
create index if not exists referral_codes_partner_idx on public.referral_codes (referral_partner_id);

create trigger trg_referral_codes_updated_at
  before update on public.referral_codes
  for each row execute function public.set_updated_at();

alter table public.referral_codes enable row level security;

-- ── referral_attributions ───────────────────────────────────────────────
-- One immutable row per REFERRED BUSINESS — never per account, per this
-- pass's own instruction. unique(business_id) is what structurally
-- guarantees "never create duplicate referral attribution for the same
-- business" and "preserve original attribution through a later Free ->
-- paid Pro conversion" — there is simply no second row to create.
create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  referral_partner_id uuid not null references public.referral_partners(id),
  referral_code_id uuid not null references public.referral_codes(id),
  referred_at timestamptz not null default now(),
  -- What the referred business chose at signup — informational/funnel
  -- context only, never itself a source of entitlement.
  initial_plan_selected text check (initial_plan_selected in ('free', 'pro')),
  -- Qualification state for commission purposes. 'unqualified' until a
  -- REAL paid Pro charge for this exact business clears the webhook
  -- (qualify_referral_earning()) — a Pro Invite's $0 complimentary
  -- activation never touches this table at all (see that RPC's own
  -- comment), so it can never flip this to 'qualified' on its own.
  status text not null default 'unqualified' check (status in ('unqualified', 'qualified')),
  converted_to_pro_at timestamptz,
  qualifying_payment_reference text,
  gross_amount_cents integer,
  discount_amount_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_attributions_partner_idx on public.referral_attributions (referral_partner_id);

create trigger trg_referral_attributions_updated_at
  before update on public.referral_attributions
  for each row execute function public.set_updated_at();

alter table public.referral_attributions enable row level security;

-- ── referral_payout_requests ────────────────────────────────────────────
create table if not exists public.referral_payout_requests (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  requested_amount_cents integer not null check (requested_amount_cents > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  admin_note text,
  -- Manual reference once actually paid outside FindMi (e.g. a Venmo
  -- transaction id, a check number) — no funds movement happens here,
  -- this is purely a record of what the founder did manually.
  payment_reference text,
  updated_at timestamptz not null default now()
);

create index if not exists referral_payout_requests_partner_idx on public.referral_payout_requests (referral_partner_id);

create trigger trg_referral_payout_requests_updated_at
  before update on public.referral_payout_requests
  for each row execute function public.set_updated_at();

alter table public.referral_payout_requests enable row level security;

-- ── referral_earnings — the durable ledger ──────────────────────────────
-- Every amount here is a HISTORICAL SNAPSHOT taken at the moment the
-- earning was created — never recomputed later from current
-- referral_codes.discount_percent or referral_partners.
-- default_commission_cents (this pass's own explicit instruction).
-- Changing a partner's commission or a code's discount tomorrow has zero
-- effect on any row already written here.
create table if not exists public.referral_earnings (
  id uuid primary key default gen_random_uuid(),
  referral_partner_id uuid not null references public.referral_partners(id),
  business_id uuid not null references public.businesses(id) on delete cascade,
  attribution_id uuid not null references public.referral_attributions(id) on delete cascade,
  -- The Stripe Checkout Session id for the qualifying payment. THE actual
  -- idempotency guard against a webhook retry creating a duplicate
  -- earning — a second delivery of the same event simply violates this
  -- unique constraint (caught and treated as already-qualified, never
  -- raised as a hard error — see qualify_referral_earning()).
  qualifying_payment_reference text not null unique,
  gross_amount_cents integer not null,
  discount_amount_cents integer not null default 0,
  commission_amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'available', 'included_in_payout', 'paid', 'voided')),
  earned_at timestamptz not null default now(),
  -- Set only once this earning is bundled into a payout request (see
  -- request_referral_payout()) — a null here alongside status='available'
  -- is exactly "not yet requested." Because this is a single nullable FK
  -- column (not a join table), an earning can structurally belong to AT
  -- MOST ONE payout request at a time — the actual mechanism behind "no
  -- earnings included in multiple payout requests."
  payout_request_id uuid references public.referral_payout_requests(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_earnings_partner_idx on public.referral_earnings (referral_partner_id);
create index if not exists referral_earnings_payout_request_idx on public.referral_earnings (payout_request_id);

create trigger trg_referral_earnings_updated_at
  before update on public.referral_earnings
  for each row execute function public.set_updated_at();

alter table public.referral_earnings enable row level security;

-- ── attribute_referral() — records attribution, business-creation only ──
--
-- Called exactly once, from createMemberBusiness (account/business/
-- actions.ts) right after a brand-new business is created — never
-- reachable for an ALREADY-EXISTING business. This is a deliberate V1
-- scope boundary (not merely an oversight): allowing an existing business
-- to be attributed to a referral code after the fact would let anyone
-- claim credit for a business that already exists, which this pass
-- explicitly does not build. "A Free business that upgrades to paid Pro
-- later keeps its original referrer" works simply because attribution
-- happens once, up front, and qualify_referral_earning() later reads
-- that same row back — there's nothing to "keep" only because nothing
-- else can overwrite it.
--
-- SECURITY DEFINER so it can read/write these otherwise policy-less
-- tables, reachable only via a server-side Server Action (service_role
-- grant only, matching create_owned_business/redeem_pro_invite).
-- p_user_id is accepted only for a future audit trail; it is not
-- currently persisted since referral_attributions has no "created_by"
-- column in this V1 (business_id + referred_at is the record).
create or replace function public.attribute_referral(
  p_business_id uuid,
  p_code text,
  p_initial_plan text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.referral_codes;
  v_now timestamptz := now();
begin
  if p_business_id is null then
    raise exception 'business_required';
  end if;
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;
  if p_initial_plan is not null and p_initial_plan not in ('free', 'pro') then
    raise exception 'invalid_plan';
  end if;

  -- A business can never be attributed twice — checked explicitly for a
  -- friendly error, on top of the unique(business_id) constraint that
  -- structurally guarantees it regardless.
  if exists (select 1 from public.referral_attributions where business_id = p_business_id) then
    raise exception 'already_attributed';
  end if;

  -- Row lock FIRST, before reading use_count/max_uses — same
  -- concurrency-safe pattern redeem_pro_invite() already uses for
  -- pro_invites, preventing two simultaneous signups from both
  -- succeeding past a code's last remaining use.
  select * into v_code
  from public.referral_codes
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_code.id is null then
    raise exception 'invalid_code';
  end if;
  if not v_code.is_active then
    raise exception 'code_inactive';
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= v_now then
    raise exception 'code_expired';
  end if;
  if v_code.max_uses is not null and v_code.use_count >= v_code.max_uses then
    raise exception 'code_limit_reached';
  end if;

  insert into public.referral_attributions (
    business_id, referral_partner_id, referral_code_id, referred_at, initial_plan_selected
  ) values (
    p_business_id, v_code.referral_partner_id, v_code.id, v_now, p_initial_plan
  );

  update public.referral_codes set use_count = use_count + 1 where id = v_code.id;

  return jsonb_build_object(
    'referral_partner_id', v_code.referral_partner_id,
    'referral_code_id', v_code.id,
    'discount_percent', v_code.discount_percent
  );
end;
$$;

revoke execute on function public.attribute_referral(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.attribute_referral(uuid, text, text, uuid) to service_role;

-- ── qualify_referral_earning() — the ONE place a commission is created ──
--
-- Called ONLY from the signature-verified Stripe webhook
-- (/api/webhooks/stripe), after activateBusinessPro() has already
-- confirmed a real "checkout.session.completed" event for the native
-- $99 Pro checkout. Never reachable from client-submitted data — the
-- webhook's own Stripe signature check is the trust boundary, exactly
-- the same shape activateBusinessPro() itself already relies on.
--
-- Idempotency: the UNIQUE constraint on
-- referral_earnings.qualifying_payment_reference is the real guard — a
-- second delivery of the same Stripe event hits that constraint and is
-- caught here (SQLSTATE 23505) rather than raised, so a webhook retry is
-- always safe to re-run. The attribution row's own
-- status/converted_to_pro_at update is separately guarded by
-- `where status = 'unqualified'`, so it's never re-stamped either.
--
-- No-op (returns qualified:false) when the business was never referred
-- at all — a Pro Invite's complimentary activation never calls this
-- function in the first place (see the webhook route), so it can never
-- create a payable commission from a $0 activation.
create or replace function public.qualify_referral_earning(
  p_business_id uuid,
  p_stripe_session_id text,
  p_gross_amount_cents integer,
  p_discount_amount_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attribution public.referral_attributions;
  v_partner public.referral_partners;
  v_commission_cents integer;
  v_earning_id uuid;
begin
  if p_business_id is null or p_stripe_session_id is null then
    raise exception 'invalid_arguments';
  end if;

  select * into v_attribution from public.referral_attributions where business_id = p_business_id;
  if v_attribution.id is null then
    return jsonb_build_object('qualified', false, 'reason', 'not_referred');
  end if;

  select * into v_partner from public.referral_partners where id = v_attribution.referral_partner_id;
  if v_partner.id is null then
    return jsonb_build_object('qualified', false, 'reason', 'partner_not_found');
  end if;

  -- Commission amount is read from the partner's CURRENT
  -- default_commission_cents at qualification time (same "read current
  -- settings at the moment of the real transaction" convention
  -- redeem_pro_invite() uses for duration_days) — but once written into
  -- this earning row below, it is a permanent historical snapshot never
  -- recomputed again.
  v_commission_cents := v_partner.default_commission_cents;

  begin
    insert into public.referral_earnings (
      referral_partner_id, business_id, attribution_id, qualifying_payment_reference,
      gross_amount_cents, discount_amount_cents, commission_amount_cents, status
    ) values (
      v_attribution.referral_partner_id, p_business_id, v_attribution.id, p_stripe_session_id,
      p_gross_amount_cents, p_discount_amount_cents, v_commission_cents, 'available'
    )
    returning id into v_earning_id;
  exception when unique_violation then
    -- Webhook redelivery of the same Stripe session — already qualified,
    -- not an error.
    return jsonb_build_object('qualified', false, 'reason', 'already_qualified');
  end;

  -- Only stamp the attribution's own conversion fields the FIRST time —
  -- a redelivered event that (somehow) reached this far without hitting
  -- the unique_violation above still can't re-stamp a business that's
  -- already qualified.
  update public.referral_attributions
  set
    status = 'qualified',
    converted_to_pro_at = now(),
    qualifying_payment_reference = p_stripe_session_id,
    gross_amount_cents = p_gross_amount_cents,
    discount_amount_cents = p_discount_amount_cents
  where id = v_attribution.id and status = 'unqualified';

  return jsonb_build_object(
    'qualified', true,
    'earning_id', v_earning_id,
    'referral_partner_id', v_attribution.referral_partner_id,
    'commission_amount_cents', v_commission_cents
  );
end;
$$;

revoke execute on function public.qualify_referral_earning(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.qualify_referral_earning(uuid, text, integer, integer) to service_role;

-- ── request_referral_payout() — bundles the CURRENT available balance ───
--
-- V1 deliberately does NOT accept a client-chosen partial amount: it
-- always requests the partner's entire current available balance in one
-- atomic call. This isn't a missing feature — it's the simplest design
-- that still satisfies every stated requirement (can never request more
-- than available, since there is no "how much" input to tamper with; can
-- never double-include an earning, since every included row is
-- immediately flipped out of 'available' inside the same transaction).
-- A future partial-request UI could still be layered on later without
-- touching this table shape.
--
-- Row-locks every 'available' earning for this partner BEFORE summing,
-- so two concurrent requests can never both claim the same money — the
-- second call simply sees zero still-available rows once the first
-- commits.
create or replace function public.request_referral_payout(
  p_referral_partner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_cents integer;
  v_request_id uuid;
begin
  if p_referral_partner_id is null then
    raise exception 'partner_required';
  end if;

  if not exists (select 1 from public.referral_partners where id = p_referral_partner_id) then
    raise exception 'partner_not_found';
  end if;

  -- Lock candidate rows first — the actual concurrency guard.
  perform 1
  from public.referral_earnings
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null
  for update;

  select coalesce(sum(commission_amount_cents), 0) into v_total_cents
  from public.referral_earnings
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null;

  if v_total_cents <= 0 then
    raise exception 'no_available_balance';
  end if;

  insert into public.referral_payout_requests (referral_partner_id, requested_amount_cents, status)
  values (p_referral_partner_id, v_total_cents, 'requested')
  returning id into v_request_id;

  update public.referral_earnings
  set status = 'included_in_payout', payout_request_id = v_request_id
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null;

  return jsonb_build_object('payout_request_id', v_request_id, 'requested_amount_cents', v_total_cents);
end;
$$;

revoke execute on function public.request_referral_payout(uuid) from public, anon, authenticated;
grant execute on function public.request_referral_payout(uuid) to service_role;
