-- Canonical Entity Geography — completes Discovery Intelligence V1's
-- canonical U.S. geography (20261024000000_discovery_intelligence_v1.sql,
-- already manually applied to Production — this migration never touches
-- it) by letting real entities carry a canonical Census key directly.
--
-- LOCKED PRODUCT MODEL: canonical Census geography is the nationwide
-- factual layer; Findmi Markets/Areas remain curated product/editorial
-- geography on top of it. An entity needs NEITHER a Market nor an Area to
-- exist geographically — a canonical key alone is enough to be
-- searchable/filterable. Never auto-create a Market from a Census Place.
--
-- Additive and idempotent. No existing row is rewritten; city/state/
-- postal_code/market_id/market_area_id are untouched everywhere. Every new
-- column is nullable. Re-running this file is safe.
--
--   1. geo_place_key / geo_zcta_key / geo_state_key — nullable FKs to
--      census_geographies(geo_key), ON DELETE RESTRICT (a canonical row a
--      live entity points to can never be silently deleted out from under
--      it — retirement, not deletion, is how census_geographies itself
--      already keeps an older vintage's rows around). A CHECK on each
--      column enforces its kind prefix, so geo_place_key can never
--      accidentally hold a zcta:/state:/county: key or vice versa.
--   2. geo_resolution — how the key got there: 'selected' (an explicit
--      picker choice), 'derived' (computed from other fields at save
--      time, e.g. resolved ZIP/city+state), 'backfill' (the Admin-only
--      backfill runner — see src/lib/geo/entity-geo-backfill.ts), or
--      'import' (an ingestion pipeline resolved it deterministically).
--   3. County membership is deliberately NEVER stored on an entity — a
--      Census Place can span counties, so county scope is always derived
--      through census_geography_links at read time (see
--      src/lib/geo/resolve.ts's geoScopeFor), never cached here.
--   4. brand_audit_markets.geo_key / market_requests.geo_key — a single
--      optional canonical key (any kind), alongside each table's existing
--      free-text place_key/requested_text, which stay exactly as they are.
--
-- Mirrors the CHECKs in src/lib/geo/entity-geo-core.ts — change both
-- together.

-- ---------------------------------------------------------------- 1. entity geography columns

do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_occurrences', 'locations', 'businesses'] loop
    execute format('alter table public.%I add column if not exists geo_place_key text', t);
    execute format('alter table public.%I add column if not exists geo_zcta_key text', t);
    execute format('alter table public.%I add column if not exists geo_state_key text', t);
    execute format('alter table public.%I add column if not exists geo_resolution text', t);
  end loop;

  -- Appearances get place/state only — no ZCTA column (per the approved
  -- plan: an Appearance's own venue is already covered by Place/State;
  -- its parent Location, when linked, is the authoritative physical
  -- place and carries the ZCTA instead — see entity-geo-core.ts's
  -- effective-geography precedence).
  alter table public.appearances add column if not exists geo_place_key text;
  alter table public.appearances add column if not exists geo_state_key text;
  alter table public.appearances add column if not exists geo_resolution text;
end $$;

-- FKs + kind-prefix CHECKs — added in a second pass (and individually
-- guarded) so re-running this file never fails on an already-added
-- constraint.
do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_occurrences', 'locations', 'businesses', 'appearances'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_geo_place_key_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (geo_place_key) references public.census_geographies(geo_key) on delete restrict', t, t || '_geo_place_key_fkey');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_geo_place_key_kind_check') then
      execute format('alter table public.%I add constraint %I check (geo_place_key is null or geo_place_key like ''place:%%'')', t, t || '_geo_place_key_kind_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_geo_state_key_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (geo_state_key) references public.census_geographies(geo_key) on delete restrict', t, t || '_geo_state_key_fkey');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_geo_state_key_kind_check') then
      execute format('alter table public.%I add constraint %I check (geo_state_key is null or geo_state_key like ''state:%%'')', t, t || '_geo_state_key_kind_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_geo_resolution_check') then
      execute format('alter table public.%I add constraint %I check (geo_resolution is null or geo_resolution in (''selected'', ''derived'', ''backfill'', ''import''))', t, t || '_geo_resolution_check');
    end if;
  end loop;

  -- ZCTA: events, event_occurrences, locations, businesses only.
  foreach t in array array['events', 'event_occurrences', 'locations', 'businesses'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_geo_zcta_key_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (geo_zcta_key) references public.census_geographies(geo_key) on delete restrict', t, t || '_geo_zcta_key_fkey');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_geo_zcta_key_kind_check') then
      execute format('alter table public.%I add constraint %I check (geo_zcta_key is null or geo_zcta_key like ''zcta:%%'')', t, t || '_geo_zcta_key_kind_check');
    end if;
  end loop;
end $$;

-- Partial indexes — only real, resolved rows are ever indexed; a nationwide
-- table with mostly-null geo_* columns stays cheap to index and to filter.
do $$
declare
  t text;
begin
  foreach t in array array['events', 'event_occurrences', 'locations', 'businesses', 'appearances'] loop
    execute format('create index if not exists %I on public.%I (geo_place_key) where geo_place_key is not null', t || '_geo_place_key_idx', t);
    execute format('create index if not exists %I on public.%I (geo_state_key) where geo_state_key is not null', t || '_geo_state_key_idx', t);
  end loop;
  foreach t in array array['events', 'event_occurrences', 'locations', 'businesses'] loop
    execute format('create index if not exists %I on public.%I (geo_zcta_key) where geo_zcta_key is not null', t || '_geo_zcta_key_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. brand_audit_markets.geo_key / market_requests.geo_key

alter table public.brand_audit_markets add column if not exists geo_key text;
alter table public.market_requests add column if not exists geo_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brand_audit_markets_geo_key_fkey') then
    alter table public.brand_audit_markets add constraint brand_audit_markets_geo_key_fkey foreign key (geo_key) references public.census_geographies(geo_key) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_audit_markets_geo_key_kind_check') then
    alter table public.brand_audit_markets add constraint brand_audit_markets_geo_key_kind_check check (geo_key is null or geo_key like 'place:%' or geo_key like 'county:%' or geo_key like 'state:%' or geo_key like 'zcta:%');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_requests_geo_key_fkey') then
    alter table public.market_requests add constraint market_requests_geo_key_fkey foreign key (geo_key) references public.census_geographies(geo_key) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_requests_geo_key_kind_check') then
    alter table public.market_requests add constraint market_requests_geo_key_kind_check check (geo_key is null or geo_key like 'place:%' or geo_key like 'county:%' or geo_key like 'state:%' or geo_key like 'zcta:%');
  end if;
end $$;

create index if not exists brand_audit_markets_geo_key_idx on public.brand_audit_markets (geo_key) where geo_key is not null;
create index if not exists market_requests_geo_key_idx on public.market_requests (geo_key) where geo_key is not null;
