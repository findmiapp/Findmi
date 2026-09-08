-- Pro Member Badge (public cards) — the smallest safe way to let a public
-- business card ("Featured Vendors", Event rosters, Brands We Love, etc.)
-- know whether to show a "PRO MEMBER" badge, WITHOUT widening public
-- access to businesses.plan_tier itself.
--
-- businesses.plan_tier is deliberately NOT public-readable (see
-- 20260902060000_business_plan_tier.sql's own "No public-read grant"
-- note) — anon/authenticated has no SELECT grant on it at all, by
-- explicit prior decision. This migration does not change that: plan_tier
-- stays exactly as inaccessible to anon/authenticated as before.
--
-- Instead, a STORED GENERATED boolean column derives only the one public-
-- safe fact a card actually needs ("is this business Pro, in either tier")
-- from plan_tier, and ONLY that derived column gets an anon/authenticated
-- SELECT grant — the same additive, single-column grant pattern
-- 20260905241000_business_market_area_id_public_grant.sql already
-- established for market_area_id. No entitlement/billing/Stripe/fee
-- column is exposed by this migration; plan_source/plan_started_at/
-- plan_expires_at/plan_payment_reference/marketplace_fee_percent/
-- processing_fee_payer/payout_method/stripe_account_id/
-- stripe_connect_status remain exactly as ungranted as before.
--
-- true for BOTH 'pro' and 'pro_seller' — same "Pro Seller inherits every
-- Pro entitlement" rule lib/entitlements.ts's isBusinessPro()/
-- isPlanTierPro() already codify; this column is the public-read
-- counterpart of that same rule, never a second, divergent definition of
-- what counts as Pro.
alter table public.businesses
  add column is_pro_member boolean generated always as (plan_tier in ('pro', 'pro_seller')) stored;

grant select (is_pro_member) on public.businesses to anon, authenticated;
