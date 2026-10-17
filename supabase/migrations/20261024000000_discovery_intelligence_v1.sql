-- Discovery Intelligence V1 + canonical U.S. geography foundation.
--
-- NOT YET APPLIED TO PRODUCTION. Additive and idempotent. Existing rows are
-- never rewritten or deleted; existing IDs, slugs, FKs and public behavior
-- are unchanged. Re-running this file is safe.
--
--   1. Canonical U.S. geography (Census reference data, loaded by the
--      Admin import — NOT by this migration):
--        census_geographies       states, counties, places, ZCTAs
--        census_geography_links   many-to-many overlaps (never a forced
--                                 hierarchy: a place can span counties, a
--                                 ZCTA is never the parent of a city)
--        census_imports           per-vintage, per-dataset import ledger
--   2. product_geographies — the ONLY bridge between Findmi product
--      geography (markets / market_areas) and canonical Census geography.
--      geo_key is text (not an FK) so mappings can exist before the import;
--      the Admin import reports any mapping whose geo_key is missing.
--   3. market_areas hierarchy: parent_area_id + level ('area' |
--      'neighborhood'); the ~20 Brand Intelligence NYC neighborhood slugs
--      are seeded as consumer-hidden children of their boroughs.
--   4. Discovery: discovery_topics (validated structured queries — never
--      SQL) and discovery_lanes (Admin-ordered groupings on a discovery
--      page — the homepage or an Area page). Lanes are their own table so
--      the currently deployed homepage code (which treats unknown
--      homepage_rows content types as products) never sees them.
--   5. events.is_free / events.family_friendly — nullable, set only by
--      Admin / Event editors / Import; NULL means unknown, never "no".
--   6. user_entity_relationships — explicit Personal actions (Must Do,
--      Want, Been, …); a person can only ever read/write their own rows.
--   7. analytics_events.discovery_topic_id / market_area_id — the raw
--      interaction ledger gains Topic/Area context (no second analytics
--      system; derived preferences are computed on read, never stored).
--
-- Value lists mirror src/lib/geo/census-format.ts and
-- src/lib/discovery/query.ts — change both together.

-- ---------------------------------------------------------------- 1. canonical geography

create table if not exists public.census_geographies (
  geo_key          text primary key,
  kind             text not null,
  geoid            text not null,
  name             text not null,
  display_name     text not null,
  search_names     text[] not null default '{}',
  lsad             text,
  funcstat         text,
  state_fips       text,
  state_usps       text,
  intpt_lat        double precision,
  intpt_lng        double precision,
  aland_m2         bigint,
  vintage          text not null,
  retired_vintage  text,
  updated_at       timestamptz not null default now(),
  constraint census_geographies_kind_check check (kind in ('state', 'county', 'place', 'zcta')),
  constraint census_geographies_key_check check (geo_key = kind || ':' || geoid)
);

create index if not exists census_geographies_search_idx on public.census_geographies using gin (search_names);
create index if not exists census_geographies_kind_state_idx on public.census_geographies (kind, state_usps);
create index if not exists census_geographies_display_prefix_idx on public.census_geographies (lower(display_name) text_pattern_ops);

create table if not exists public.census_geography_links (
  child_key   text not null references public.census_geographies (geo_key) on delete cascade,
  parent_key  text not null references public.census_geographies (geo_key) on delete cascade,
  relation    text not null,
  land_share  double precision,
  vintage     text not null,
  primary key (child_key, parent_key, relation),
  constraint census_geography_links_relation_check check (relation in ('county_in_state', 'place_in_state', 'place_in_county', 'zcta_in_county', 'zcta_in_state'))
);

create index if not exists census_geography_links_parent_idx on public.census_geography_links (parent_key, relation);

create table if not exists public.census_imports (
  id             uuid primary key default gen_random_uuid(),
  vintage        text not null,
  dataset        text not null,
  source_url     text not null,
  source_vintage text,
  sha256         text,
  status         text not null default 'pending',
  cursor         integer not null default 0,
  rows_read      integer not null default 0,
  rows_upserted  integer not null default 0,
  rows_retired   integer not null default 0,
  error          text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  constraint census_imports_status_check check (status in ('pending', 'running', 'complete', 'failed')),
  constraint census_imports_dataset_check check (dataset in ('states', 'counties', 'places', 'zctas', 'place_county', 'zcta_county')),
  constraint census_imports_unique unique (vintage, dataset)
);

-- Public reference data: readable by anyone, writable only by the service
-- role (the Admin import). The import ledger is Admin-only.
alter table public.census_geographies enable row level security;
alter table public.census_geography_links enable row level security;
alter table public.census_imports enable row level security;
revoke all on public.census_geographies, public.census_geography_links, public.census_imports from anon, authenticated;
grant select on public.census_geographies, public.census_geography_links to anon, authenticated;
grant all on public.census_geographies, public.census_geography_links, public.census_imports to service_role;
drop policy if exists "Public read census geographies" on public.census_geographies;
create policy "Public read census geographies" on public.census_geographies for select to anon, authenticated using (true);
drop policy if exists "Public read census geography links" on public.census_geography_links;
create policy "Public read census geography links" on public.census_geography_links for select to anon, authenticated using (true);

comment on table public.census_geographies is
  'Canonical U.S. geography reference (U.S. Census Gazetteer). geo_key = kind:GEOID. Loaded by the Admin Census import, idempotent by geo_key; records missing from a newer vintage get retired_vintage, never deleted.';

-- ---------------------------------------------------------------- 2. product ↔ canonical mapping

create table if not exists public.product_geographies (
  id              uuid primary key default gen_random_uuid(),
  market_id       uuid not null references public.markets (id) on delete cascade,
  market_area_id  uuid references public.market_areas (id) on delete cascade,
  geo_key         text not null,
  role            text not null,
  created_at      timestamptz not null default now(),
  constraint product_geographies_role_check check (role in ('primary', 'includes', 'within')),
  constraint product_geographies_key_check check (geo_key ~ '^(state|county|place|zcta):[0-9]+$')
);

create unique index if not exists product_geographies_unique_idx
  on public.product_geographies (market_id, coalesce(market_area_id, '00000000-0000-0000-0000-000000000000'::uuid), geo_key);
create index if not exists product_geographies_geo_idx on public.product_geographies (geo_key);

alter table public.product_geographies enable row level security;
revoke all on public.product_geographies from anon, authenticated;
grant select on public.product_geographies to anon, authenticated;
grant all on public.product_geographies to service_role;
drop policy if exists "Public read product geographies" on public.product_geographies;
create policy "Public read product geographies" on public.product_geographies for select to anon, authenticated using (true);

comment on table public.product_geographies is
  'The only bridge between Findmi Markets/Areas and canonical Census geography. role: primary (equivalent), includes (the product geography contains it), within (the product geography lies inside it).';

-- Existing Markets/Areas → canonical geography (by slug, so IDs are never
-- assumed). North Jersey / South Jersey and the Hamptons are deliberately
-- left unmapped (no single canonical unit; Admin can add mappings later).
insert into public.product_geographies (market_id, market_area_id, geo_key, role)
select m.id, a.id, v.geo_key, v.role
from (values
  ('nyc', null, 'place:3651000', 'primary'),
  ('nyc', null, 'county:36061', 'includes'),
  ('nyc', null, 'county:36047', 'includes'),
  ('nyc', null, 'county:36081', 'includes'),
  ('nyc', null, 'county:36005', 'includes'),
  ('nyc', null, 'county:36085', 'includes'),
  ('nyc', 'manhattan', 'county:36061', 'primary'),
  ('nyc', 'brooklyn', 'county:36047', 'primary'),
  ('nyc', 'queens', 'county:36081', 'primary'),
  ('nyc', 'bronx', 'county:36005', 'primary'),
  ('nyc', 'staten-island', 'county:36085', 'primary'),
  ('philadelphia', null, 'place:4260000', 'primary'),
  ('philadelphia', null, 'county:42101', 'primary'),
  ('boston', null, 'place:2507000', 'primary'),
  ('miami', null, 'place:1245000', 'primary'),
  ('long-island', null, 'county:36059', 'includes'),
  ('long-island', null, 'county:36103', 'includes'),
  ('north-jersey', 'jersey-city', 'place:3436000', 'primary'),
  ('north-jersey', 'hoboken', 'place:3432250', 'primary')
) as v(market_slug, area_slug, geo_key, role)
join public.markets m on m.slug = v.market_slug
left join public.market_areas a on a.market_id = m.id and a.slug = v.area_slug
where v.area_slug is null or a.id is not null
on conflict do nothing;

-- ---------------------------------------------------------------- 3. market_areas hierarchy

alter table public.market_areas add column if not exists parent_area_id uuid references public.market_areas (id) on delete restrict;
alter table public.market_areas add column if not exists level text not null default 'area';
alter table public.market_areas drop constraint if exists market_areas_level_check;
alter table public.market_areas add constraint market_areas_level_check check (level in ('area', 'neighborhood'));
alter table public.market_areas drop constraint if exists market_areas_parent_check;
alter table public.market_areas add constraint market_areas_parent_check check ((level = 'neighborhood') = (parent_area_id is not null) and parent_area_id is distinct from id);
create index if not exists market_areas_parent_idx on public.market_areas (parent_area_id) where parent_area_id is not null;

-- The Brand Intelligence V1.2 NYC neighborhood slugs (identical keys, so
-- brand_audit_markets.place_key and Findmi Areas converge), as
-- consumer-hidden children of their boroughs. No ZIP mappings are
-- invented; each neighborhood lies 'within' its borough's county.
insert into public.market_areas (market_id, name, slug, display_name, active, consumer_visible, sort_order, level, parent_area_id)
select m.id, v.name, v.slug, v.name, true, false, 100 + v.ord, 'neighborhood', p.id
from (values
  ('manhattan', 'soho', 'SoHo', 1),
  ('manhattan', 'tribeca', 'Tribeca', 2),
  ('manhattan', 'nolita', 'Nolita', 3),
  ('manhattan', 'lower-east-side', 'Lower East Side', 4),
  ('manhattan', 'east-village', 'East Village', 5),
  ('manhattan', 'west-village', 'West Village', 6),
  ('manhattan', 'chelsea', 'Chelsea', 7),
  ('manhattan', 'flatiron', 'Flatiron', 8),
  ('manhattan', 'midtown', 'Midtown', 9),
  ('manhattan', 'financial-district', 'Financial District', 10),
  ('manhattan', 'upper-east-side', 'Upper East Side', 11),
  ('manhattan', 'upper-west-side', 'Upper West Side', 12),
  ('manhattan', 'harlem', 'Harlem', 13),
  ('brooklyn', 'williamsburg', 'Williamsburg', 14),
  ('brooklyn', 'greenpoint', 'Greenpoint', 15),
  ('brooklyn', 'bushwick', 'Bushwick', 16),
  ('brooklyn', 'dumbo', 'DUMBO', 17),
  ('brooklyn', 'park-slope', 'Park Slope', 18),
  ('queens', 'long-island-city', 'Long Island City', 19),
  ('queens', 'astoria', 'Astoria', 20)
) as v(parent_slug, slug, name, ord)
join public.markets m on m.slug = 'nyc'
join public.market_areas p on p.market_id = m.id and p.slug = v.parent_slug
on conflict (market_id, slug) do nothing;

insert into public.product_geographies (market_id, market_area_id, geo_key, role)
select a.market_id, a.id, pg.geo_key, 'within'
from public.market_areas a
join public.product_geographies pg on pg.market_area_id = a.parent_area_id and pg.role = 'primary'
where a.level = 'neighborhood'
on conflict do nothing;

-- ---------------------------------------------------------------- 4. discovery topics + lanes

create table if not exists public.discovery_topics (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  description       text,
  image_url         text,
  aliases           text[] not null default '{}',
  query             jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  sort_order        integer not null default 100,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint discovery_topics_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint discovery_topics_name_check check (char_length(btrim(name)) between 1 and 60),
  constraint discovery_topics_query_check check (jsonb_typeof(query) = 'object')
);

drop trigger if exists trg_discovery_topics_updated_at on public.discovery_topics;
create trigger trg_discovery_topics_updated_at before update on public.discovery_topics for each row execute function public.set_updated_at();

create table if not exists public.discovery_lanes (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.discovery_pages (id) on delete cascade,
  title       text not null,
  subtitle    text,
  kind        text not null,
  topic_ids   uuid[] not null default '{}',
  topic_id    uuid references public.discovery_topics (id) on delete set null,
  market_id   uuid references public.markets (id) on delete cascade,
  item_limit  integer not null default 12,
  sort_order  integer not null default 100,
  is_visible  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint discovery_lanes_kind_check check (kind in ('topics', 'topic_results', 'areas')),
  constraint discovery_lanes_title_check check (char_length(btrim(title)) between 1 and 60),
  constraint discovery_lanes_limit_check check (item_limit between 1 and 24),
  constraint discovery_lanes_shape_check check (
    (kind = 'topics' and cardinality(topic_ids) > 0)
    or (kind = 'topic_results' and topic_id is not null)
    or (kind = 'areas' and market_id is not null)
  )
);

create index if not exists discovery_lanes_page_idx on public.discovery_lanes (page_id, sort_order);
drop trigger if exists trg_discovery_lanes_updated_at on public.discovery_lanes;
create trigger trg_discovery_lanes_updated_at before update on public.discovery_lanes for each row execute function public.set_updated_at();

alter table public.discovery_pages add column if not exists market_id uuid references public.markets (id) on delete set null;
alter table public.discovery_pages add column if not exists market_area_id uuid references public.market_areas (id) on delete set null;

alter table public.discovery_topics enable row level security;
alter table public.discovery_lanes enable row level security;
revoke all on public.discovery_topics, public.discovery_lanes from anon, authenticated;
grant select on public.discovery_topics, public.discovery_lanes to anon, authenticated;
grant all on public.discovery_topics, public.discovery_lanes to service_role;
drop policy if exists "Public read active discovery topics" on public.discovery_topics;
create policy "Public read active discovery topics" on public.discovery_topics for select to anon, authenticated using (is_active);
drop policy if exists "Public read visible discovery lanes" on public.discovery_lanes;
create policy "Public read visible discovery lanes" on public.discovery_lanes for select to anon, authenticated
  using (is_visible and exists (select 1 from public.discovery_pages dp where dp.id = discovery_lanes.page_id and dp.is_published));

-- Starter Topics: only what current Findmi data can answer truthfully
-- (time windows, real Event Formats / Categories, the new Free flag).
insert into public.discovery_topics (slug, name, description, aliases, query, sort_order) values
  ('happening-now', 'Happening Now', 'Going on right now.', '{"now","right now","live"}', '{"when":"now"}', 10),
  ('today', 'Today', 'Happening today.', '{"today"}', '{"when":"today"}', 20),
  ('tonight', 'Tonight', 'This evening.', '{"tonight","this evening"}', '{"when":"tonight"}', 30),
  ('this-weekend', 'This Weekend', 'Saturday and Sunday.', '{"this weekend","weekend"}', '{"when":"weekend"}', 40),
  ('ending-soon', 'Ending Soon', 'Last chance — wrapping up within two days.', '{"ending soon","last chance"}', '{"endingSoonHours":48}', 50),
  ('just-announced', 'Just Announced', 'Added to Findmi this week.', '{"just announced","new"}', '{"justAnnouncedDays":7}', 60),
  ('pop-ups', 'Pop-Ups', 'Temporary shops and brand pop-ups.', '{"pop up","pop ups","popup","popups","pop-up","pop-ups"}', '{"formats":["pop-up"],"categories":["markets-pop-ups"]}', 110),
  ('sample-sales', 'Sample Sales', 'Designer and brand sample sales.', '{"sample sale","sample sales"}', '{"formats":["sample-sale"],"categories":["sample-sales"]}', 120),
  ('product-launches', 'Product Launches', 'New products, first.', '{"product launch","product launches","launch","drops","product drops"}', '{"formats":["product-launch"]}', 130),
  ('brand-activations', 'Brand Activations', 'Brands bringing it to life.', '{"brand activation","brand activations","activation","activations"}', '{"formats":["brand-activation"]}', 140),
  ('sampling-tastings', 'Sampling & Tastings', 'Try it before anyone else.', '{"sampling","samples","tasting","tastings","free samples"}', '{"formats":["sampling"],"categories":["tastings-drinks"]}', 150),
  ('immersive', 'Immersive Experiences', 'Step inside something.', '{"immersive","immersive experience","immersive experiences"}', '{"formats":["immersive-experience"],"categories":["immersive-experiences"]}', 160),
  ('exhibitions', 'Exhibitions', 'Art, design and culture on view.', '{"exhibition","exhibitions","exhibit","gallery"}', '{"formats":["exhibition"],"categories":["art-exhibitions"]}', 170),
  ('workshops', 'Workshops', 'Hands-on classes.', '{"workshop","workshops","class","classes","hands on","hands-on"}', '{"formats":["workshop"],"categories":["workshops-classes"]}', 180),
  ('markets-fairs', 'Markets & Fairs', 'Makers, vendors and street fairs.', '{"market","markets","fair","fairs","street fair"}', '{"formats":["market"],"categories":["local-festivals-street-fairs"]}', 190),
  ('food-drink', 'Food + Drink', 'Eat and drink your way around.', '{"food","drink","food and drink","coffee","restaurant"}', '{"categories":["food-drink"]}', 210),
  ('food-festivals', 'Food Festivals', 'Festivals built around food.', '{"food festival","food festivals"}', '{"categories":["food-festival"]}', 220),
  ('beauty', 'Beauty', 'Beauty, skincare and wellness.', '{"beauty","skincare","makeup"}', '{"categories":["beauty-wellness"]}', 310),
  ('fashion', 'Fashion', 'Style, streetwear and accessories.', '{"fashion","style","streetwear"}', '{"categories":["fashion-style"]}', 320),
  ('family-friendly', 'Family Friendly', 'Good with kids.', '{"family","kids","with kids","family friendly","for kids"}', '{"family":true}', 330),
  ('free', 'Free', 'No cost to attend.', '{"free","freebies","no cost"}', '{"free":true}', 340)
on conflict (slug) do nothing;

-- Starter homepage Lanes (on the system homepage).
insert into public.discovery_lanes (page_id, title, subtitle, kind, topic_ids, topic_id, market_id, item_limit, sort_order)
select dp.id, v.title, v.subtitle, v.kind,
  coalesce((select array_agg(t.id order by array_position(v.topic_slugs, t.slug)) from public.discovery_topics t where t.slug = any (v.topic_slugs)), '{}'),
  (select t.id from public.discovery_topics t where t.slug = v.topic_slug),
  (select m.id from public.markets m where m.slug = v.market_slug),
  12, v.ord
from (values
  ('Right Now', 'What''s happening and what''s next.', 'topics', array['happening-now','today','tonight','this-weekend','ending-soon','just-announced'], null, null, 10),
  ('This Weekend', null, 'topic_results', '{}'::text[], 'this-weekend', null, 20),
  ('Experience Something', null, 'topics', array['pop-ups','immersive','exhibitions','workshops','product-launches','brand-activations','sample-sales'], null, null, 30),
  ('Food + Drink', null, 'topics', array['food-drink','food-festivals','sampling-tastings','markets-fairs'], null, null, 40),
  ('Culture + Interests', null, 'topics', array['beauty','fashion','family-friendly','free'], null, null, 50),
  ('Explore NYC', null, 'areas', '{}'::text[], null, 'nyc', 60)
) as v(title, subtitle, kind, topic_slugs, topic_slug, market_slug, ord)
join public.discovery_pages dp on dp.is_system
where not exists (select 1 from public.discovery_lanes l where l.page_id = dp.id and l.title = v.title)
  and (v.kind <> 'areas' or exists (select 1 from public.markets m where m.slug = v.market_slug));

-- ---------------------------------------------------------------- 5. event attributes

alter table public.events add column if not exists is_free boolean;
alter table public.events add column if not exists family_friendly boolean;
comment on column public.events.is_free is 'Discovery V1: true only when the Event is explicitly free to attend; NULL = unknown (never treated as free).';
comment on column public.events.family_friendly is 'Discovery V1: true only when explicitly family friendly; NULL = unknown.';

-- ---------------------------------------------------------------- 6. personal relationships

create table if not exists public.user_entity_relationships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  entity_type  text not null,
  entity_id    uuid not null,
  relation     text not null,
  created_at   timestamptz not null default now(),
  constraint user_entity_relationships_unique unique (user_id, entity_type, entity_id, relation),
  constraint user_entity_relationships_type_check check (entity_type in ('event', 'business', 'location', 'product', 'topic', 'area')),
  constraint user_entity_relationships_relation_check check (relation in ('want', 'must_do', 'like', 'dislike', 'been', 'have'))
);

create index if not exists user_entity_relationships_user_idx on public.user_entity_relationships (user_id, relation);

alter table public.user_entity_relationships enable row level security;
revoke all on public.user_entity_relationships from anon, authenticated;
grant select, insert, delete on public.user_entity_relationships to authenticated;
grant all on public.user_entity_relationships to service_role;
drop policy if exists "Own relationships read" on public.user_entity_relationships;
create policy "Own relationships read" on public.user_entity_relationships for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own relationships insert" on public.user_entity_relationships;
create policy "Own relationships insert" on public.user_entity_relationships for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Own relationships delete" on public.user_entity_relationships;
create policy "Own relationships delete" on public.user_entity_relationships for delete to authenticated using (auth.uid() = user_id);

comment on table public.user_entity_relationships is
  'Discovery V1: explicit Personal actions only (never inferred). Saves/Follows stay in their existing account_* tables.';

-- ---------------------------------------------------------------- 7. raw interaction context

alter table public.analytics_events add column if not exists discovery_topic_id uuid references public.discovery_topics (id) on delete set null;
alter table public.analytics_events add column if not exists market_area_id uuid references public.market_areas (id) on delete set null;
create index if not exists analytics_events_topic_idx on public.analytics_events (discovery_topic_id) where discovery_topic_id is not null;
create index if not exists analytics_events_area_idx on public.analytics_events (market_area_id) where market_area_id is not null;
create index if not exists analytics_events_user_idx on public.analytics_events (user_id, occurred_at desc) where user_id is not null;
