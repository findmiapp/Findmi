-- ============================================================================
-- Market Management + Plan Market Allowances V1
--
-- Reuses the existing `markets` table exactly as-is for its identity
-- columns (id/slug/active/sort_order/created_at, unchanged) and adds only
-- the columns needed for founder-editable consumer presentation and
-- lightweight "areas included" metadata:
--   - display_name: optional consumer-facing override of `name` (null =
--     fall back to `name`, so every existing row keeps showing exactly
--     what it shows today until a founder explicitly sets one).
--   - description: optional short admin-facing description of the Market.
--   - areas_included: optional text[] of informational sub-area labels
--     (e.g. NYC -> Staten Island/Brooklyn/Manhattan/Queens/Bronx). Purely
--     descriptive metadata — never a join table, never a second taxonomy,
--     never consulted by any discovery/entitlement/matching logic. Adding
--     or editing this list must never create business_markets rows,
--     assign events, or perform any city/state inference.
--
-- No existing row's id/slug/active/sort_order changes. All three new
-- columns are nullable and untouched by this migration's own DDL (no
-- backfill) — a founder opts into them later via /admin/markets.
--
-- plan_market_limits is new: the configurable backing store for
-- getBusinessMarketLimit's per-PlanTier (free/pro/pro_seller) Market
-- allowance, replacing that resolver's previous hardcoded "always 1"
-- switch statement. Seeded with the exact values that switch statement
-- returned today (1/1/1) so this migration changes zero live behavior —
-- a founder can change these afterward via /admin/plans. market_limit
-- NULL = Unlimited (same convention membership_plans.market_limit
-- already established), never a magic sentinel number. plan_tier is the
-- primary key — this is a fixed, tiny (3-row) configuration table for an
-- existing enum-like concept, not a new competing plan/pricing system.
-- ============================================================================

alter table public.markets
  add column if not exists display_name text,
  add column if not exists description text,
  add column if not exists areas_included text[];

create table if not exists public.plan_market_limits (
  plan_tier text primary key check (plan_tier in ('free', 'pro', 'pro_seller')),
  market_limit integer check (market_limit is null or market_limit >= 1),
  updated_at timestamptz not null default now()
);

insert into public.plan_market_limits (plan_tier, market_limit) values
  ('free', 1),
  ('pro', 1),
  ('pro_seller', 1)
on conflict (plan_tier) do nothing;

alter table public.plan_market_limits enable row level security;

-- Same posture as the existing "Public read membership plans" policy on
-- membership_plans — non-sensitive configuration (plain integers/null),
-- read by both the admin Plans screen and the owner-facing Business
-- Manager's Market Allowance display. Writes go through the admin/
-- service-role client only (no insert/update/delete policy is added).
create policy "Public read plan market limits" on public.plan_market_limits
  for select using (true);
