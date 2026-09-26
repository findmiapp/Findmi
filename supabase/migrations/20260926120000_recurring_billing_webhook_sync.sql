-- Recurring Billing Pass 2B — webhook synchronization + atomic forward-only
-- entitlement mirror.
--
-- Purely additive, in line with every prior recurring-billing migration:
-- no existing row is rewritten, no existing table/column is dropped or
-- narrowed. Three changes:
--
-- 1. businesses_plan_source_check widens to also permit
--    'stripe_subscription' — the plan_source value the new sync RPC below
--    writes when a recurring subscription becomes a business's effective
--    Pro source. All four existing legal values (paid/complimentary/
--    promotional/admin) and NULL remain exactly as legal as before.
--
-- 2. business_subscriptions gains two nullable OBSERVABILITY-ONLY columns:
--    last_stripe_event_id / last_stripe_event_created. These record which
--    webhook delivery most recently produced a successful sync, for
--    debugging — they are never read by, and never gate, the sync RPC's
--    own write logic. Ordering/concurrency correctness is handled
--    entirely by the transaction-scoped advisory lock in
--    sync_subscription_from_stripe() below, keyed on
--    (livemode, stripe_subscription_id): every webhook handler retrieves
--    the CANONICAL current Subscription from Stripe before ever calling
--    this RPC, so the row's state always converges to Stripe's own
--    current truth regardless of delivery order — event.created (the
--    time the EVENT was generated, not a version of the Subscription
--    snapshot) is deliberately never compared against a stored value to
--    accept-or-reject a write, since an older event can easily retrieve
--    newer canonical state.
--
-- 3. A new durable anomaly table (billing_sync_anomalies) and a new
--    SECURITY DEFINER RPC (sync_subscription_from_stripe) — see each
--    below for full reasoning.
--
-- No existing table's RLS/policies/grants change. No admin UI, no
-- webhook route, no Checkout wiring is added by this migration — this is
-- schema + one RPC only.

-- ---------------------------------------------------------------------
-- 1. Widen plan_source to permit the recurring-subscription provenance
--    value.
-- ---------------------------------------------------------------------
alter table public.businesses
  drop constraint businesses_plan_source_check;

alter table public.businesses
  add constraint businesses_plan_source_check
    check (plan_source is null or plan_source in ('paid', 'complimentary', 'promotional', 'admin', 'stripe_subscription'));

-- ---------------------------------------------------------------------
-- 2. Observability-only columns on business_subscriptions.
-- ---------------------------------------------------------------------
alter table public.business_subscriptions
  add column if not exists last_stripe_event_id text,
  add column if not exists last_stripe_event_created timestamptz;

comment on column public.business_subscriptions.last_stripe_event_id is
  'Observability only — the Stripe event id that most recently produced a successful sync of this row. Never compared/gated on; canonical Stripe retrieval (always fetched fresh by the caller before invoking sync_subscription_from_stripe) is the sole source of truth for what gets written.';

comment on column public.business_subscriptions.last_stripe_event_created is
  'Observability only — see last_stripe_event_id. NOT a write-order guard: event.created describes when Stripe generated the triggering event, not a version of the separately-retrieved canonical Subscription snapshot, so it must never decide whether a write is accepted.';

-- ---------------------------------------------------------------------
-- billing_sync_anomalies — durable record of a billing synchronization
-- anomaly involving real money that must not be silently swallowed or
-- left in console logs only (missing Customer mapping, Customer/user
-- mismatch, missing/invalid business metadata, an unsupported Subscription
-- item shape, an unresolvable Price ID, or two real Stripe subscriptions
-- racing into one business+mode slot). Deliberately narrow: only safe
-- identifiers plus a bounded `details` blob the application layer
-- controls — never card/payment-method data, never a full Stripe Customer
-- object, never a raw webhook body. Service-role only, same posture as
-- every other billing table in this pass: RLS enabled, zero anon/
-- authenticated policies.
-- ---------------------------------------------------------------------
create table public.billing_sync_anomalies (
  id uuid primary key default gen_random_uuid(),
  anomaly_type text not null,
  stripe_event_id text null,
  stripe_subscription_id text null,
  stripe_customer_id text null,
  business_id uuid null,
  payer_user_id uuid null,
  livemode boolean not null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.billing_sync_anomalies is
  'Durable record of a billing synchronization anomaly that could not be safely auto-resolved. Service-role only: RLS enabled, zero anon/authenticated policies. Never stores card/payment-method details, full Stripe Customer objects, or raw webhook bodies — only safe identifiers plus a bounded diagnostic details blob the application layer itself controls.';

alter table public.billing_sync_anomalies enable row level security;

create index billing_sync_anomalies_stripe_subscription_id_idx
  on public.billing_sync_anomalies (stripe_subscription_id);

create index billing_sync_anomalies_business_id_idx
  on public.billing_sync_anomalies (business_id);

-- Fast "what's still unresolved" lookup for a future admin view.
create index billing_sync_anomalies_unresolved_idx
  on public.billing_sync_anomalies (created_at)
  where resolved_at is null;

-- Idempotent recording: redelivering the SAME Stripe event that already
-- produced the SAME anomaly type must never create unlimited duplicate
-- rows. Partial (stripe_event_id is not every anomaly path's only
-- identifying signal, but every anomaly this pass's webhook produces does
-- carry one).
create unique index billing_sync_anomalies_type_event_key
  on public.billing_sync_anomalies (anomaly_type, stripe_event_id)
  where stripe_event_id is not null;

-- ---------------------------------------------------------------------
-- sync_subscription_from_stripe() — the one atomic, secure synchronization
-- path, following the exact SECURITY DEFINER / "eligibility lives in the
-- WHERE clause" precedent already established by redeem_pro_invite() in
-- this codebase (see 20260904210000_pro_invites.sql).
--
-- Takes ONLY pre-validated scalar values — never raw Stripe JSON. All
-- Stripe-talking, metadata/Customer/Price validation happens in
-- TypeScript (src/lib/commerce/subscriptionSync.ts) before this is ever
-- called; this function trusts its caller completely, the same way every
-- other admin-client RPC in this codebase does (see that function's own
-- comment header for what it independently re-validates — here, nothing
-- beyond the params themselves, since the caller has already resolved
-- Customer/business/Price against real Stripe + Supabase state).
--
-- Concurrency: a transaction-scoped advisory lock keyed on
-- (livemode, stripe_subscription_id) serializes concurrent webhook
-- deliveries for the SAME subscription only (never blocks unrelated
-- subscriptions). Held until this transaction commits or rolls back.
-- hashtextextended() returns bigint directly, matching
-- pg_advisory_xact_lock(bigint)'s single-key overload.
--
-- Duplicate-active-subscription handling: business_subscriptions_
-- one_active_per_business_mode (the Pass 1 partial unique index) is the
-- real, structural backstop against two blocking-status subscriptions
-- coexisting for one business+mode. A NEW stripe_subscription_id that
-- would violate it raises unique_violation from the INSERT/UPDATE that
-- ON CONFLICT (stripe_subscription_id, livemode) does NOT itself resolve
-- (that clause only absorbs a conflict on ITS OWN target — a second,
-- different subscription id colliding with the OTHER partial index still
-- raises). Caught in a nested block so the first, already-synced
-- subscription's row is never touched/replaced and entitlement is never
-- mirrored for the losing/duplicate attempt. The caller receives a
-- structured duplicate_active_subscription:true result and is
-- responsible for durably recording the anomaly (never this function —
-- it has no independent way to safely also insert into
-- billing_sync_anomalies from inside a plpgsql exception handler while
-- keeping the anomaly write's own durability independent of this
-- transaction's outcome; the caller does that as a separate statement).
--
-- Entitlement mirror is forward-only:
--   - pro_seller is never touched (never downgraded, never treated as
--     plain 'pro').
--   - plan_tier='pro' AND plan_expires_at IS NULL is PERMANENT — never
--     replaced with a dated expiry. (Free + NULL expiry is NOT permanent
--     — that branch is only reachable when plan_tier is actually 'pro'.)
--   - An existing dated Pro expiry >= the candidate expiry always wins —
--     never shortened.
--   - Only when none of the above holds does the subscription become the
--     effective source, writing plan_tier/plan_source/plan_started_at
--     (coalesced, never reset)/plan_expires_at/plan_payment_reference
--     together, atomically, under the same row lock.
--   - A non-granting status (anything outside active/trialing/past_due)
--     never touches businesses at all — cancellation/non-payment is
--     never destructive; the previously-mirrored plan_expires_at simply
--     lapses on its own via isBusinessPro()'s existing date check.
--   - A granting status with a NULL candidate expiry (should not happen
--     given the caller's own validation, but never trusted blindly here)
--     is treated as non-actionable rather than ever writing a NULL
--     plan_expires_at — a NULL expiry means PERMANENT, and this function
--     must never manufacture permanent Pro from a missing value.
-- ---------------------------------------------------------------------
create or replace function public.sync_subscription_from_stripe(
  p_business_id uuid,
  p_payer_user_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_price_id text,
  p_commercial_plan text,
  p_billing_interval text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_latest_invoice_status text,
  p_livemode boolean,
  p_event_id text,
  p_event_created timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_key bigint;
  v_business public.businesses;
  v_grants boolean := p_status in ('active', 'trialing', 'past_due');
  v_mirror_outcome text;
  v_duplicate boolean := false;
begin
  if p_business_id is null or p_payer_user_id is null or p_stripe_customer_id is null
     or p_stripe_subscription_id is null or p_stripe_price_id is null
     or p_commercial_plan is null or p_billing_interval is null or p_status is null
     or p_livemode is null then
    raise exception 'missing_required_param';
  end if;

  v_lock_key := hashtextextended(p_livemode::text || ':' || p_stripe_subscription_id, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  begin
    insert into public.business_subscriptions (
      business_id, payer_user_id, stripe_customer_id, stripe_subscription_id,
      stripe_price_id, commercial_plan, billing_interval, status,
      current_period_end, cancel_at_period_end, canceled_at,
      latest_invoice_status, livemode, last_stripe_event_id, last_stripe_event_created
    ) values (
      p_business_id, p_payer_user_id, p_stripe_customer_id, p_stripe_subscription_id,
      p_stripe_price_id, p_commercial_plan, p_billing_interval, p_status,
      p_current_period_end, p_cancel_at_period_end, p_canceled_at,
      p_latest_invoice_status, p_livemode, p_event_id, p_event_created
    )
    on conflict (stripe_subscription_id, livemode) do update set
      business_id = excluded.business_id,
      payer_user_id = excluded.payer_user_id,
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_price_id = excluded.stripe_price_id,
      commercial_plan = excluded.commercial_plan,
      billing_interval = excluded.billing_interval,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      canceled_at = excluded.canceled_at,
      latest_invoice_status = excluded.latest_invoice_status,
      last_stripe_event_id = excluded.last_stripe_event_id,
      last_stripe_event_created = excluded.last_stripe_event_created;
  exception
    when unique_violation then
      -- business_subscriptions_one_active_per_business_mode fired — a
      -- DIFFERENT stripe_subscription_id already holds this business+
      -- mode's one blocking slot. Leave it completely untouched.
      v_duplicate := true;
  end;

  if v_duplicate then
    return jsonb_build_object(
      'applied', false,
      'duplicate_active_subscription', true,
      'mirror_outcome', 'duplicate_blocked'
    );
  end if;

  if not v_grants then
    return jsonb_build_object('applied', true, 'duplicate_active_subscription', false, 'mirror_outcome', 'non_granting');
  end if;

  if p_current_period_end is null then
    -- Defensive: the caller should never reach here with a granting
    -- status and no period end, but a NULL here would otherwise mean
    -- "permanent" below — never manufacture that from a missing value.
    return jsonb_build_object('applied', true, 'duplicate_active_subscription', false, 'mirror_outcome', 'missing_period_end');
  end if;

  select * into v_business from public.businesses where id = p_business_id for update;
  if v_business.id is null then
    return jsonb_build_object('applied', true, 'duplicate_active_subscription', false, 'mirror_outcome', 'business_missing');
  end if;

  if v_business.plan_tier = 'pro_seller' then
    v_mirror_outcome := 'blocked_pro_seller';
  elsif v_business.plan_tier = 'pro' and v_business.plan_expires_at is null then
    v_mirror_outcome := 'blocked_permanent_pro';
  elsif v_business.plan_tier = 'pro' and v_business.plan_expires_at is not null
        and v_business.plan_expires_at >= p_current_period_end then
    v_mirror_outcome := 'blocked_longer_existing';
  else
    update public.businesses set
      plan_tier = 'pro',
      plan_source = 'stripe_subscription',
      plan_started_at = coalesce(plan_started_at, now()),
      plan_expires_at = p_current_period_end,
      plan_payment_reference = 'sub:' || p_stripe_subscription_id
    where id = p_business_id;
    v_mirror_outcome := 'extended';
  end if;

  return jsonb_build_object('applied', true, 'duplicate_active_subscription', false, 'mirror_outcome', v_mirror_outcome);
end;
$$;

revoke execute on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, boolean, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.sync_subscription_from_stripe(
  uuid, uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text, boolean, text, timestamptz
) to service_role;
