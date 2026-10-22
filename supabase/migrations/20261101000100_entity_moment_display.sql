-- Entity-owned Moment display preferences.
--
-- A Moment has ONE author and lives on its own page. The Businesses, Locations
-- and Events it is connected to each decide whether it is shown on THEIR public
-- profile. That decision belongs to the displaying entity, so it is stored per
-- (entity, Moment) — never on the Moment, and never by editing, unpublishing or
-- deleting it: hiding a Moment from Lavazza's profile changes nothing for its
-- author, its Event, its Location or any other Business.
--
-- One generalized table instead of a table per entity type (the earlier
-- business_moment_display(business_id, …, hidden, featured, pinned,
-- sort_order) proposal) because Business, Location and Event need exactly the
-- same control. Rows record only DEVIATIONS from the default — no row means
-- "shown" — so applying this changes nothing that is visible today.
--   hidden   — not shown on that entity's profile
--   featured — accepted by the schema for later; no profile renders it yet
--
-- Pin / manual ordering is deliberately not modelled.
--
-- Additive: one new table, trigger, indexes. Public profile reads need the
-- hidden list, so SELECT is open to anon/authenticated (it holds only ids and a
-- display flag); writes are service role only, after server code authorizes the
-- caller for that entity and verifies the Moment is connected to it.

create table if not exists public.entity_moment_display (
  entity_type        text not null check (entity_type in ('business', 'location', 'event')),
  entity_id          uuid not null,
  journal_entry_id   uuid not null references public.journal_entries(id) on delete cascade,
  display            text not null check (display in ('hidden', 'featured')),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (entity_type, entity_id, journal_entry_id)
);

-- "Which Moments has this entity hidden?" is the public read; "which profiles
-- have hidden this Moment?" is the reverse lookup.
create index if not exists entity_moment_display_entry_idx on public.entity_moment_display (journal_entry_id);

-- The polymorphic entity id has no foreign key, so verify it names a real row.
create or replace function public.entity_moment_display_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found boolean;
begin
  if new.entity_type = 'business' then
    select exists (select 1 from public.businesses where id = new.entity_id) into found;
  elsif new.entity_type = 'location' then
    select exists (select 1 from public.locations where id = new.entity_id) into found;
  else
    select exists (select 1 from public.events where id = new.entity_id) into found;
  end if;
  if not found then
    raise exception 'entity_moment_display: % % does not exist', new.entity_type, new.entity_id using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_entity_moment_display_guard on public.entity_moment_display;
create trigger trg_entity_moment_display_guard
  before insert or update of entity_type, entity_id on public.entity_moment_display
  for each row execute function public.entity_moment_display_guard();

drop trigger if exists trg_entity_moment_display_updated_at on public.entity_moment_display;
create trigger trg_entity_moment_display_updated_at
  before update on public.entity_moment_display
  for each row execute function public.set_updated_at();

alter table public.entity_moment_display enable row level security;

drop policy if exists entity_moment_display_public_read on public.entity_moment_display;
create policy entity_moment_display_public_read
  on public.entity_moment_display
  for select
  to anon, authenticated
  using (true);

revoke all on public.entity_moment_display from anon, authenticated;
grant select on public.entity_moment_display to anon, authenticated;
grant all on public.entity_moment_display to service_role;
