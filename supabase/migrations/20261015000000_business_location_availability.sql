-- Find Us At — Business Location Availability.
--
-- A business_location_availability row means "this Business/Brand is
-- normally available at this THIRD-PARTY canonical Findmi Location"
-- (stocked, sold, served, carried). It is NOT business_locations (Our
-- Locations — the Business operates the place) and NOT Event / Occurrence /
-- Appearance presence (Findmi Here — dated). Nothing infers one from another.
--
-- Canonical Location only: no place data (address, coordinates, hours,
-- imagery, area) is copied here. Many-to-many; Brand-level (a future
-- product-level model would be a separate table).
--
-- Writes are server-side only (service role, Admin in V1); anon/authenticated
-- get read-only access. The "already an Our Location" collision is enforced
-- in the write path and filtered out of public reads — no cross-table
-- constraint.
--
-- Additive only: new table, index and policy. No existing table, row or
-- relationship is touched, and nothing is backfilled.

create table if not exists public.business_location_availability (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint business_location_availability_business_location_key
    unique (business_id, location_id)
);

-- "Brands Available Here" (Location -> Businesses). The unique constraint
-- above already provides the business_id-leading index.
create index if not exists business_location_availability_location_id_idx
  on public.business_location_availability (location_id);

alter table public.business_location_availability enable row level security;

drop policy if exists business_location_availability_public_read
  on public.business_location_availability;

create policy business_location_availability_public_read
  on public.business_location_availability
  for select
  to anon, authenticated
  using (true);

revoke all on public.business_location_availability from anon, authenticated;
grant select on public.business_location_availability to anon, authenticated;
grant all on public.business_location_availability to service_role;
