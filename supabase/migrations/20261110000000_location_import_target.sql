-- Location import target — which Business↔Location relationship an import
-- batch writes. Additive and non-destructive: every existing batch was a
-- Find Us Here (business_location_availability) import, so the default
-- keeps them exactly as they are. 'our_locations' batches link places as
-- Business-operated Locations (business_locations) through the same
-- staging / matching / review / history pipeline; source-id tracking and
-- "Not In This File" stay Find Us Here–only. No new Location model.
alter table public.location_import_batches
  add column if not exists target text not null default 'find_us_here';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'location_import_batches_target_check'
  ) then
    alter table public.location_import_batches
      add constraint location_import_batches_target_check check (target in ('find_us_here', 'our_locations'));
  end if;
end $$;
