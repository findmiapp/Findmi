-- Discovery Engine + Map V1 — canonical Location geography and the
-- smallest structured Event attributes the universal Discovery Query
-- filters on. Additive and idempotent: every new column is nullable or has
-- a constant default; no existing row's existing values change; no policy
-- changes (new columns inherit each table's existing RLS). Re-running this
-- file is safe.
--
--   1. locations — the ONE canonical owner of a physical coordinate.
--      latitude/longitude ALREADY exist (nullable, unused until now) and are
--      kept as-is. New: timezone, geocode_status/source/at/attempts/error,
--      geocode_address (the normalized address the coordinate came from).
--      Events, Occurrences and Appearances resolve geography THROUGH their
--      location_id — nothing is copied onto them. The legacy
--      events/appearances latitude/longitude columns are left untouched and
--      are never read by discovery.
--   2. locations_geocode_guard — a BEFORE trigger so EVERY write path
--      (Admin form, owner edits, imports, the batch geocoder) gets the same
--      safe behavior: a changed address clears a now-stale coordinate and
--      re-queues the Location; coordinates written by hand are recorded as
--      'manual'; an explicit status write (the geocoder's own) is
--      authoritative. Mirrors src/lib/geo/geocode-core.ts.
--   3. A coordinate index for viewport (bounding-box) queries and a queue
--      index for the controlled batch geocoder. No PostGIS: a btree on
--      (latitude, longitude) answers Findmi's bounding-box reads at V1
--      scale without a new extension.
--   4. event_occurrences(location_id) index — Occurrence → Location is the
--      canonical geographic join and had no index.
--   5. events.benefits / audience / min_age / max_age / entry_modes —
--      structured, explicitly-set attributes (never inferred from prose).
--      "Free Admission" and "Free Food" are distinct values. Mirrors
--      EVENT_BENEFITS / EVENT_AUDIENCES / ENTRY_MODES in
--      src/lib/discovery/attributes.ts — change both together.

-- ---------------------------------------------------------------- 1. locations geography

alter table public.locations add column if not exists timezone text;
alter table public.locations add column if not exists geocode_status text not null default 'pending';
alter table public.locations add column if not exists geocode_source text;
alter table public.locations add column if not exists geocoded_at timestamptz;
alter table public.locations add column if not exists geocode_attempts smallint not null default 0;
alter table public.locations add column if not exists geocode_error text;
alter table public.locations add column if not exists geocode_address text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_latitude_range_check') then
    alter table public.locations add constraint locations_latitude_range_check check (latitude is null or (latitude between -90 and 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_longitude_range_check') then
    alter table public.locations add constraint locations_longitude_range_check check (longitude is null or (longitude between -180 and 180));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_coordinate_pair_check') then
    alter table public.locations add constraint locations_coordinate_pair_check check ((latitude is null) = (longitude is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_timezone_check') then
    alter table public.locations add constraint locations_timezone_check check (timezone is null or timezone ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_geocode_status_check') then
    alter table public.locations add constraint locations_geocode_status_check check (geocode_status in ('pending', 'resolved', 'manual', 'incomplete', 'ambiguous', 'failed'));
  end if;
  -- A Location is only ever "located" with a real coordinate.
  if not exists (select 1 from pg_constraint where conname = 'locations_geocode_located_check') then
    alter table public.locations add constraint locations_geocode_located_check check (geocode_status not in ('resolved', 'manual') or latitude is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_geocode_source_check') then
    alter table public.locations add constraint locations_geocode_source_check check (geocode_source is null or geocode_source in ('geocodio', 'census', 'manual', 'import'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_geocode_error_length_check') then
    alter table public.locations add constraint locations_geocode_error_length_check check (geocode_error is null or char_length(geocode_error) <= 300);
  end if;
end $$;

-- ---------------------------------------------------------------- 2. change-safety trigger

create or replace function public.location_geocode_address(p_address text, p_city text, p_state text, p_postal text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(lower(regexp_replace(trim(concat_ws(', ', nullif(trim(p_address), ''), nullif(trim(p_city), ''), nullif(trim(p_state), ''), nullif(trim(p_postal), ''))), '\s+', ' ', 'g')), '');
$$;

create or replace function public.locations_geocode_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  addr_changed boolean;
  coords_changed boolean;
begin
  if tg_op = 'INSERT' then
    -- A new Location created WITH a coordinate (an import that carried
    -- one, or an Admin who typed one) is located from the start.
    if new.latitude is not null and new.longitude is not null and new.geocode_status = 'pending' then
      new.geocode_status := 'resolved';
      new.geocode_source := coalesce(new.geocode_source, 'import');
      new.geocoded_at := coalesce(new.geocoded_at, now());
      new.geocode_address := coalesce(new.geocode_address, public.location_geocode_address(new.address, new.city, new.state, new.postal_code));
    end if;
    return new;
  end if;

  -- An explicit status write (the batch geocoder, an Admin correction) is
  -- authoritative for that update.
  if new.geocode_status is distinct from old.geocode_status then
    return new;
  end if;

  addr_changed := public.location_geocode_address(new.address, new.city, new.state, new.postal_code)
    is distinct from public.location_geocode_address(old.address, old.city, old.state, old.postal_code);
  coords_changed := new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude;

  if coords_changed then
    if new.latitude is null or new.longitude is null then
      new.geocode_status := 'pending';
      new.geocode_source := null;
      new.geocoded_at := null;
      new.geocode_attempts := 0;
    else
      -- Typed by hand (Admin Location form): a manual correction.
      new.geocode_status := 'manual';
      new.geocode_source := 'manual';
      new.geocoded_at := now();
      new.geocode_error := null;
      new.geocode_address := public.location_geocode_address(new.address, new.city, new.state, new.postal_code);
    end if;
  elsif addr_changed then
    -- The address moved; the old pin would now be wrong. Clear it and
    -- re-queue (a manual pin was for the OLD address too).
    new.latitude := null;
    new.longitude := null;
    new.geocode_status := 'pending';
    new.geocode_source := null;
    new.geocoded_at := null;
    new.geocode_attempts := 0;
    new.geocode_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists locations_geocode_guard on public.locations;
create trigger locations_geocode_guard
  before insert or update of address, city, state, postal_code, latitude, longitude, geocode_status
  on public.locations
  for each row execute function public.locations_geocode_guard();

-- ---------------------------------------------------------------- 3. indexes

create index if not exists locations_coordinates_idx on public.locations (latitude, longitude) where latitude is not null;
create index if not exists locations_geocode_queue_idx on public.locations (geocode_status, geocode_attempts) where geocode_status in ('pending', 'failed');

-- ---------------------------------------------------------------- 4. occurrence → location

create index if not exists event_occurrences_location_id_idx on public.event_occurrences (location_id) where location_id is not null;
create index if not exists appearances_location_start_idx on public.appearances (location_id, start_at) where location_id is not null;

-- ---------------------------------------------------------------- 5. structured Event attributes

alter table public.events add column if not exists benefits text[] not null default '{}';
alter table public.events add column if not exists audience text[] not null default '{}';
alter table public.events add column if not exists min_age smallint;
alter table public.events add column if not exists max_age smallint;
alter table public.events add column if not exists entry_modes text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_benefits_check') then
    alter table public.events add constraint events_benefits_check check (benefits <@ array['free_admission', 'free_food', 'free_drinks', 'free_samples', 'free_products', 'giveaways', 'swag', 'discounts', 'prizes']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_audience_check') then
    alter table public.events add constraint events_audience_check check (audience <@ array['all_ages', 'family', 'kids', 'adults', '21_plus', 'professional']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_age_range_check') then
    alter table public.events add constraint events_age_range_check check ((min_age is null or min_age between 0 and 99) and (max_age is null or max_age between 0 and 99) and (min_age is null or max_age is null or min_age <= max_age));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_entry_modes_check') then
    alter table public.events add constraint events_entry_modes_check check (entry_modes <@ array['walk_in', 'rsvp', 'ticket', 'reservation', 'invite']::text[]);
  end if;
end $$;
