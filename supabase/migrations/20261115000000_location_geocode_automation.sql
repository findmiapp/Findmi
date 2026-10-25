-- Automatic Location geocoding (follow-up to Discovery Engine + Map V1,
-- 20261114000000_discovery_engine_map_v1.sql). Additive and idempotent.
--
--   1. locations.geocode_attempted_at — when the last placement attempt
--      started. The automatic drain (src/lib/geo/geocode.ts) uses it to
--      (a) back off between retries of a transient failure and (b) let
--      Admin see when a Location was last tried. Nullable; no backfill.
--   2. locations_geocode_guard() — unchanged behavior, plus it clears
--      geocode_attempted_at whenever it re-queues a Location (changed
--      address, or coordinates removed), so a re-queued Location is placed
--      immediately rather than waiting out an old backoff.
--
-- No policy, grant or data change. Every existing row keeps its values.

alter table public.locations add column if not exists geocode_attempted_at timestamptz;

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

  -- An explicit status write (the geocoder, an Admin correction) is
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
      new.geocode_attempted_at := null;
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
    new.geocode_attempted_at := null;
  end if;
  return new;
end;
$$;
