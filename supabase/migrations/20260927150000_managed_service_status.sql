-- Recurring Billing V1 — Managed Pro operational status.
--
-- Purely additive: one new nullable-with-default column on `businesses`,
-- no existing row rewritten, no existing constraint narrowed.
--
-- Managed Pro is explicitly NOT a plan_tier value (see
-- businesses_plan_tier_check, unchanged by this migration — it still only
-- accepts 'free' | 'pro' | 'pro_seller'). Managed Pro is a Pro entitlement
-- (mirrored the same way any other Pro subscription is, via
-- sync_subscription_from_stripe()) PLUS a separate operational fact: is
-- FindMi actively doing the hands-on maintenance work for this business
-- right now. That fact lives here, independent of entitlement state, so
-- entitlement logic never needs to know Managed Pro exists and this
-- column never needs to know about plan_tier/plan_expires_at.
--
-- Values:
--   'none'   — default. Never a Managed Pro subscriber, or the human
--              service relationship has fully ended.
--   'active' — FindMi is currently doing Managed Pro upkeep work for this
--              business (subscription in a granting Stripe status).
--   'paused' — was Managed Pro, subscription is currently not in a
--              granting Stripe status (past_due grace aside — past_due is
--              still granting), service work is on hold. Deliberately not
--              'none' — this preserves the fact that the relationship
--              existed and may resume, rather than discarding it.
--
-- Written by src/lib/commerce/subscriptionSync.ts, as a plain UPDATE
-- alongside (never inside) the sync_subscription_from_stripe() RPC's own
-- entitlement mirror — kept deliberately simple/non-transactional-with-
-- entitlement since this is operational state, not something that needs
-- the same forward-only-mirror guarantees as plan_tier.
alter table public.businesses
  add column if not exists managed_service_status text not null default 'none';

alter table public.businesses
  add constraint businesses_managed_service_status_check
    check (managed_service_status in ('none', 'active', 'paused'));

comment on column public.businesses.managed_service_status is
  'Operational state for Managed Pro human-maintenance service — separate from plan_tier/entitlement. none | active | paused. Written by subscriptionSync.ts, not by sync_subscription_from_stripe(). Never used as, or checked in place of, a plan_tier value.';
