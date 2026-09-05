-- ============================================================================
-- Markets Foundation V1
--
-- Implementation follow-up to the read-only Markets / Geography
-- Architecture Reconciliation pass. Adds the smallest canonical BUSINESS
-- <-> FindMi Market relationship, reusing the existing live `markets`
-- table exactly as-is (id/name/slug/active/sort_order/created_at,
-- originally created by create_markets_and_membership_plans and confirmed
-- live via Supabase MCP before writing this migration — do not trust the
-- "not applied yet" comment headers on some older local migration files
-- over live schema state).
--
-- Deliberately NOT touching membership_markets (membership_id <->
-- market_id) — that table remains exactly what it is today: the Founding
-- Membership billing/checkout funnel's own market selection, scoped to a
-- `membership` row, not a live `business`. business_markets below is the
-- new, separate, canonical source of truth for a BUSINESS's general
-- discovery/distribution Market entitlement. The two tables are never
-- synchronized by this migration or by any code in this pass.
--
-- No discovery query reads this table (out of scope for this pass — see
-- task). No existing business receives an automatic row: every row is
-- created only through a deliberate future admin action.
-- ============================================================================

create table if not exists public.business_markets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete restrict,
  relationship text not null check (relationship in ('primary', 'additional')),
  -- Mirrors businesses.plan_source's existing vocabulary (paid/
  -- complimentary/promotional/admin — see businesses_plan_source_check)
  -- rather than inventing new provenance terms, per this pass's own
  -- instruction to stay consistent with existing plan/provenance patterns.
  provenance text check (provenance is null or provenance in ('paid', 'complimentary', 'promotional', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A business can have at most one row per market at all (active or not) —
-- reassigning/reactivating always updates this same row rather than
-- inserting a second one.
create unique index if not exists business_markets_business_market_unique
  on public.business_markets (business_id, market_id);

-- At most one ACTIVE primary Market per business. A partial unique index
-- (rather than a CHECK, which can't see other rows) is the standard
-- Postgres pattern for "unique among a subset" and is enforced at the
-- database level regardless of which code path writes the row.
create unique index if not exists business_markets_one_active_primary
  on public.business_markets (business_id)
  where relationship = 'primary' and active;

-- business -> markets lookups are already served by the leading column of
-- business_markets_business_market_unique above; markets -> businesses
-- needs its own index.
create index if not exists business_markets_market_id_idx on public.business_markets (market_id);

alter table public.business_markets enable row level security;

-- Safest minimal model: RLS enabled with ZERO policies for anon/
-- authenticated, same posture membership_markets already has today
-- (confirmed live via Supabase MCP: RLS on, no policies) — only the
-- service-role/admin client can read or write. Business-market
-- assignments don't need new public exposure yet (owner-facing Market
-- editing is explicitly out of scope for this pass), so no SELECT policy
-- is added even for the business's own owner/member.
