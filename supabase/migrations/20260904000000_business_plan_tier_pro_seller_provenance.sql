-- ============================================================================
-- Business Plan Entitlement — Pro Seller tier + provenance fields
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Native Business Onboarding — Entitlement Foundation, Pass 1. Two purely
-- additive changes, no behavior change for any existing row:
--
-- 1. businesses_plan_tier_check widens from ('free','pro') to
--    ('free','pro','pro_seller'). pro_seller is FUTURE-ONLY per this
--    pass's own instruction — no code path in this pass writes it, no
--    seller checkout/Stripe Connect/commissions/payouts/UI is built here.
--    It's added now purely so the entitlement model and admin control
--    don't need a second schema change when Seller work actually starts.
--    Column default ('free') and every existing 'free'/'pro' row are
--    untouched — this only widens what the CHECK constraint accepts.
--
-- 2. Four new nullable columns record WHY/WHEN/HOW a business's plan_tier
--    became what it is — a gap this pass's own read-only investigation
--    found (no such provenance existed anywhere: memberships.* tracks the
--    separate $99/yr Founding Membership billing concept, not the
--    plan_tier feature-tier introduced by the prior pass):
--      plan_source            — 'paid' | 'complimentary' | 'promotional'
--                                | 'admin', nullable (no CHECK failure for
--                                unset), so this never blocks saving an
--                                existing business that has no known
--                                provenance yet.
--      plan_started_at        — timestamptz, nullable.
--      plan_expires_at        — timestamptz, nullable — a future native
--                                Pro-payment pass can use this for expiry;
--                                nothing in this pass reads or enforces it.
--      plan_payment_reference — text, nullable — an external payment
--                                system's reference (Stripe, Tally, or a
--                                manual admin note), free-form since the
--                                actual native-payment shape doesn't exist
--                                yet.
--    All four default to NULL and get no backfill: this pass was
--    explicitly told not to fabricate provenance for existing rows unless
--    there's a safe, obvious value, and there isn't one (an existing Pro
--    business's plan_tier was set directly by an admin dropdown with no
--    record of paid/comped/promo/admin-granted) — every existing row
--    (17 free, 8 pro, verified live before writing this file) stays
--    fully valid with all four columns simply unset.
--
-- No RLS/grant change: plan_tier itself was deliberately kept off the
-- public anon/authenticated column-level grant (see this column's own
-- foundation migration) — these four new columns are exactly as sensitive
-- (business-internal entitlement state) and follow the same precedent:
-- reachable only via getAdminSupabase() (service role), not public reads.
-- ============================================================================

alter table public.businesses
  drop constraint if exists businesses_plan_tier_check;

alter table public.businesses
  add constraint businesses_plan_tier_check
    check (plan_tier in ('free', 'pro', 'pro_seller'));

alter table public.businesses
  add column if not exists plan_source text,
  add column if not exists plan_started_at timestamptz,
  add column if not exists plan_expires_at timestamptz,
  add column if not exists plan_payment_reference text;

alter table public.businesses
  add constraint businesses_plan_source_check
    check (plan_source is null or plan_source in ('paid', 'complimentary', 'promotional', 'admin'));
