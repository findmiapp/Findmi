-- Brand Intelligence V1.2 — Audience + Markets + Demographics.
--
-- NOT YET APPLIED TO PRODUCTION. Additive and non-destructive:
--   1. brand_audit_answers accepts five more structured answer kinds
--      (audience, age_range, audience_priority, market_scope, environment).
--      The kind/key CHECK constraints are replaced by wider ones; every
--      existing row (goal / challenge) satisfies the new constraints, so
--      no row is touched, rewritten or deleted.
--   2. brand_audit_answers.source — provenance ('declared' | 'observed' |
--      'researched'), default 'declared'. Every existing row is a Brand's
--      own answer, so the default is correct for all of them. The Brand
--      Audit only ever reads/replaces 'declared' rows; future observed /
--      researched intelligence can live alongside without being mixed in.
--   3. brand_audit_markets — WHERE a Brand operates now ('current') and
--      wants to grow ('priority'), one structured row per place:
--        level 'market'        → market_id (public.markets)
--        level 'area'          → market_area_id (public.market_areas)
--        level 'neighborhood'  → a curated neighborhood key (e.g. NYC
--                                'soho', 'williamsburg') within market_id
--        level 'place'         → a Brand-entered market not yet in Findmi
--                                (e.g. 'los-angeles'), slug-keyed
--      place_key is a normalized slug for every level, so "which Brands
--      want Williamsburg" never parses prose. FUTURE AREA SEAM: when
--      canonical Findmi Areas exist, neighborhood/place rows map to them
--      by place_key (add an area id column then) — nothing here competes
--      with that system.
--
-- Access: same server-only model as V1 (RLS on, no anon/authenticated
-- policies or grants; service role after the app's own authorization —
-- src/lib/brand-audit.ts). Value lists mirror src/lib/brand-audit-domain.ts.
-- Re-running this file is safe.

-- ---------------------------------------------------------------- 1. answer kinds

alter table public.brand_audit_answers drop constraint if exists brand_audit_answers_kind_check;
alter table public.brand_audit_answers add constraint brand_audit_answers_kind_check
  check (kind in ('goal', 'challenge', 'audience', 'age_range', 'audience_priority', 'market_scope', 'environment'));

alter table public.brand_audit_answers drop constraint if exists brand_audit_answers_key_check;
alter table public.brand_audit_answers add constraint brand_audit_answers_key_check check (
  (kind = 'goal' and option_key in ('build_awareness','product_sampling','drive_sales','product_launch','foot_traffic','reach_new_customers','community_engagement','lead_generation','generate_content','retail_trial','partnerships','other'))
  or (kind = 'challenge' and option_key in ('finding_opportunities','activation_locations','reaching_audience','product_trial','local_awareness','reliable_partners','staffing_execution','measuring_results','budget_efficiency','content_reach','retail_access','other'))
  or (kind = 'audience' and option_key in ('gen_z','young_professionals','parents_families','college_students','creators','entrepreneurs','office_workers','fitness_wellness','food_drink','beauty','fashion','tech','sports_fans','entertainment_culture','travelers','local_communities','b2b','other'))
  or (kind = 'age_range' and option_key in ('under_18','18_20','21_24','25_34','35_44','45_54','55_64','65_plus','not_primary'))
  or (kind = 'audience_priority' and option_key in ('women','men','lgbtq','multicultural','no_priority','other'))
  or (kind = 'market_scope' and option_key in ('local','regional','national','multi_market'))
  or (kind = 'environment' and option_key in ('retail','residential','workplaces','campuses','fitness_wellness','hospitality','restaurants_cafes','festivals_events','street','community_events','creator_events','conferences','other'))
);

-- ---------------------------------------------------------------- 2. provenance

alter table public.brand_audit_answers add column if not exists source text not null default 'declared';
alter table public.brand_audit_answers drop constraint if exists brand_audit_answers_source_check;
alter table public.brand_audit_answers add constraint brand_audit_answers_source_check check (source in ('declared', 'observed', 'researched'));

-- One answer per Business per kind per option PER SOURCE (a researched
-- value never collides with the Brand's own declared one).
alter table public.brand_audit_answers drop constraint if exists brand_audit_answers_unique;
alter table public.brand_audit_answers add constraint brand_audit_answers_unique unique (business_id, kind, option_key, source);

create index if not exists brand_audit_answers_kind_key_idx on public.brand_audit_answers (kind, option_key) where source = 'declared';

comment on column public.brand_audit_answers.source is
  'Brand Intelligence V1.2 provenance: declared (the Brand''s own Audit answer — the only value the Audit reads/writes), observed (derived from Findmi behavior), researched (external research). Never mixed silently.';

-- ---------------------------------------------------------------- 3. markets / geography

create table if not exists public.brand_audit_markets (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  intent          text not null,
  level           text not null,
  market_id       uuid references public.markets (id) on delete set null,
  market_area_id  uuid references public.market_areas (id) on delete set null,
  place_key       text not null,
  label           text not null,
  source          text not null default 'declared',
  updated_by_user_id uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint brand_audit_markets_intent_check check (intent in ('current', 'priority')),
  constraint brand_audit_markets_level_check check (level in ('market', 'area', 'neighborhood', 'place')),
  constraint brand_audit_markets_source_check check (source in ('declared', 'observed', 'researched')),
  constraint brand_audit_markets_key_check check (place_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(place_key) <= 60),
  constraint brand_audit_markets_label_check check (char_length(btrim(label)) between 1 and 60),
  constraint brand_audit_markets_unique unique (business_id, intent, level, place_key, source)
);

create index if not exists brand_audit_markets_business_idx on public.brand_audit_markets (business_id);
create index if not exists brand_audit_markets_place_idx on public.brand_audit_markets (intent, level, place_key) where source = 'declared';
create index if not exists brand_audit_markets_market_idx on public.brand_audit_markets (market_id) where market_id is not null;

drop trigger if exists trg_brand_audit_markets_updated_at on public.brand_audit_markets;
create trigger trg_brand_audit_markets_updated_at
  before update on public.brand_audit_markets
  for each row execute function public.set_updated_at();

alter table public.brand_audit_markets enable row level security;
revoke all on public.brand_audit_markets from anon, authenticated;
grant all on public.brand_audit_markets to service_role;

comment on table public.brand_audit_markets is
  'Brand Intelligence V1.2: Current and Priority/Growth markets, areas and neighborhoods a Brand declared. Server-only access. place_key is the future mapping seam to canonical Findmi Areas.';
