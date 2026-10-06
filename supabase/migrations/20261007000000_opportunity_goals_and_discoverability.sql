-- Opportunities V2 — Business Opportunity Goals + listing discoverability.
--
-- NOT YET APPLIED TO PRODUCTION. Additive only:
--   1. opportunity_listings.visibility ('private' | 'discoverable'),
--      default 'private' — every existing listing (including the real Tabli
--      listing) stays private. Only listings explicitly made discoverable
--      AND open appear in the Business "Explore" view. Recipient access to
--      a private listing is unchanged (it flows through
--      opportunity_recipients, never through visibility).
--   2. public.business_opportunity_goals — persistent, structured "what
--      this Business wants to accomplish" records (many per Business).
--
-- Access model is the same as opportunity_listings / opportunity_recipients
-- (Opportunities V1): RLS enabled with NO anon/authenticated policies or
-- grants, so no client key can read or write any row. Every read/write is
-- server-side through the service role AFTER the app's own authorization
-- (requireBusinessMember + business_id scoping for Businesses,
-- requireAdmin for Findmi Admin). Isolation between Businesses and from
-- the public is therefore enforced by the database (deny-all to client
-- roles) and by business_id scoping in every server read.
--
-- Value lists mirror src/lib/opportunity-goals-domain.ts — change both.

-- ---------------------------------------------------------------- 1. discoverability

alter table public.opportunity_listings
  add column if not exists visibility text not null default 'private';

alter table public.opportunity_listings
  drop constraint if exists opportunity_listings_visibility_check;
alter table public.opportunity_listings
  add constraint opportunity_listings_visibility_check check (visibility in ('private', 'discoverable'));

create index if not exists opportunity_listings_discoverable_idx
  on public.opportunity_listings (created_at desc)
  where visibility = 'discoverable' and status = 'open';

comment on column public.opportunity_listings.visibility is
  'Opportunities V2: private (default) = only reachable by its recipients; discoverable = also listed in the Business Explore view while open.';

-- ---------------------------------------------------------------- 2. goals

create table if not exists public.business_opportunity_goals (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  title                  text not null,
  status                 text not null default 'active',
  objectives             text[] not null default '{}',
  opportunity_interests  text[] not null default '{}',
  audience_text          text,
  market_ids             uuid[] not null default '{}',
  markets_text           text,
  budget_band            text not null default 'not_sure',
  budget_min_cents       integer,
  budget_max_cents       integer,
  timing                 text not null default 'flexible',
  starts_on              date,
  ends_on                date,
  notes                  text,
  created_by_user_id     uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint business_opportunity_goals_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint business_opportunity_goals_status_check
    check (status in ('active', 'paused', 'closed')),
  constraint business_opportunity_goals_objectives_check
    check (
      cardinality(objectives) between 1 and 11
      and objectives <@ array['drive_sales','product_sampling','product_launch','build_awareness','reach_new_customers','generate_content','retail_trial','lead_generation','community_engagement','sponsorship','something_else']::text[]
    ),
  constraint business_opportunity_goals_interests_check
    check (
      cardinality(opportunity_interests) between 1 and 13
      and opportunity_interests <@ array['pop_ups','sampling_demos','residential','retail','markets_festivals','corporate_office','hospitality','sponsorships','vending','content_creator','partnerships','experiential','open_to_ideas']::text[]
    ),
  constraint business_opportunity_goals_markets_count_check
    check (cardinality(market_ids) <= 20),
  constraint business_opportunity_goals_budget_band_check
    check (budget_band in ('under_500','500_1k','1k_2_5k','2_5k_5k','5k_10k','10k_plus','flexible','not_sure')),
  constraint business_opportunity_goals_budget_range_check
    check (
      (budget_min_cents is null or budget_min_cents >= 0)
      and (budget_max_cents is null or budget_max_cents >= 0)
      and (budget_min_cents is null or budget_max_cents is null or budget_max_cents >= budget_min_cents)
    ),
  constraint business_opportunity_goals_timing_check
    check (timing in ('asap','next_30_days','next_90_days','specific_dates','ongoing','flexible')),
  constraint business_opportunity_goals_dates_check
    check (
      (timing = 'specific_dates' or (starts_on is null and ends_on is null))
      and (starts_on is null or ends_on is null or ends_on >= starts_on)
    ),
  constraint business_opportunity_goals_audience_check check (audience_text is null or char_length(audience_text) <= 1000),
  constraint business_opportunity_goals_markets_text_check check (markets_text is null or char_length(markets_text) <= 300),
  constraint business_opportunity_goals_notes_check check (notes is null or char_length(notes) <= 2000)
);

create index if not exists business_opportunity_goals_business_idx
  on public.business_opportunity_goals (business_id, status, created_at desc);
create index if not exists business_opportunity_goals_status_idx
  on public.business_opportunity_goals (status, created_at desc);

drop trigger if exists trg_business_opportunity_goals_updated_at on public.business_opportunity_goals;
create trigger trg_business_opportunity_goals_updated_at
  before update on public.business_opportunity_goals
  for each row execute function public.set_updated_at();

alter table public.business_opportunity_goals enable row level security;
revoke all on public.business_opportunity_goals from anon, authenticated;
grant all on public.business_opportunity_goals to service_role;

comment on table public.business_opportunity_goals is
  'Opportunities V2: what a Business wants to accomplish (many per Business). Private to that Business''s members and Findmi Admin; server-only access (no client policies).';
comment on column public.business_opportunity_goals.budget_min_cents is
  'Derived from budget_band by the app (null when open-ended / flexible / not sure) so future matching can compare against listing price_cents.';
