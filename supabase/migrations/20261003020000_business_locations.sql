-- /account V2 Pass 2 — Business Locations.
--
-- A business_locations row means "this Business has an ongoing physical
-- presence at this Location". Many-to-many: a Business can have many
-- Locations, a Location can be operated by many Businesses. Locations
-- never gain a business_id column.
--
-- is_primary is per Business (zero or one primary per Business). It is
-- a display preference only — it never affects the Location hierarchy
-- (parent_location_id), permissions, or availability.
--
-- The relationship never grants management permission over either side.
-- Self-service linking requires BOTH business_members AND location_members
-- membership; that rule is enforced in the server actions, which write
-- through the service role. authenticated/anon get read-only access.
--
-- Additive only: new table, indexes, policies and functions. No existing
-- table, row or relationship is touched, and nothing is backfilled.

create table if not exists public.business_locations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint business_locations_business_location_key unique (business_id, location_id)
);

-- Zero or one primary Location per Business.
create unique index if not exists business_locations_one_primary_per_business
  on public.business_locations (business_id)
  where is_primary;

-- "Operated by" lookups (Location -> Businesses). The unique constraint
-- above already provides the business_id-leading index.
create index if not exists business_locations_location_id_idx
  on public.business_locations (location_id);

alter table public.business_locations enable row level security;

drop policy if exists business_locations_public_read on public.business_locations;
create policy business_locations_public_read
  on public.business_locations
  for select
  to anon, authenticated
  using (true);

revoke all on public.business_locations from anon, authenticated;
grant select on public.business_locations to anon, authenticated;
grant all on public.business_locations to service_role;

-- Link a Business to a Location. Idempotent (an existing link is left
-- as-is). The link becomes primary only when the Business has no primary
-- yet — so a Business's first Location is its primary automatically.
create or replace function public.link_business_location(p_business_id uuid, p_location_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.business_locations (business_id, location_id, is_primary)
  values (
    p_business_id,
    p_location_id,
    not exists (
      select 1 from public.business_locations
      where business_id = p_business_id and is_primary
    )
  )
  on conflict (business_id, location_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.business_locations
    where business_id = p_business_id and location_id = p_location_id;
  end if;

  return v_id;
exception
  -- A concurrent first link won the primary slot; keep this link as a
  -- non-primary one instead of failing.
  when unique_violation then
    insert into public.business_locations (business_id, location_id, is_primary)
    values (p_business_id, p_location_id, false)
    on conflict (business_id, location_id) do nothing;
    select id into v_id from public.business_locations
    where business_id = p_business_id and location_id = p_location_id;
    return v_id;
end;
$$;

-- Make one linked Location the Business's primary, clearing the previous
-- primary in the same transaction. Returns false when the Location isn't
-- linked to the Business (nothing changes).
create or replace function public.set_primary_business_location(p_business_id uuid, p_location_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.business_locations
    where business_id = p_business_id and location_id = p_location_id
  ) then
    return false;
  end if;

  update public.business_locations
  set is_primary = false
  where business_id = p_business_id and is_primary and location_id <> p_location_id;

  update public.business_locations
  set is_primary = true
  where business_id = p_business_id and location_id = p_location_id;

  return true;
end;
$$;

-- Remove the relationship row only — the Location itself, its members,
-- appearances and everything else stay untouched. If exactly one Location
-- remains linked afterwards and it isn't primary, it becomes primary (a
-- single-Location Business always reads as cohesive). With two or more
-- remaining, removing the primary leaves the Business with no primary.
create or replace function public.unlink_business_location(p_business_id uuid, p_location_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_deleted_primary boolean;
begin
  delete from public.business_locations
  where business_id = p_business_id and location_id = p_location_id
  returning is_primary into v_deleted_primary;

  if v_deleted_primary is null then
    return false;
  end if;

  if (
    select count(*) from public.business_locations where business_id = p_business_id
  ) = 1 then
    update public.business_locations
    set is_primary = true
    where business_id = p_business_id;
  end if;

  return true;
end;
$$;

revoke all on function public.link_business_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_primary_business_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unlink_business_location(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_business_location(uuid, uuid) to service_role;
grant execute on function public.set_primary_business_location(uuid, uuid) to service_role;
grant execute on function public.unlink_business_location(uuid, uuid) to service_role;
