-- Physical Presence Pass 2 — Location Hierarchy V1 (Place Graph foundation).
--
-- Purely additive: two new NULLABLE columns on `locations`, one partial
-- index, one cycle-protection trigger, and one read-only ancestor RPC. No
-- existing row is rewritten, no existing constraint narrowed, and every
-- existing Location stays valid exactly as-is (parent_location_id NULL,
-- place_type NULL = "no hierarchy", identical to today).
--
-- SEMANTICS (locked):
--   parent_location_id = PHYSICAL containment/context only — "this place
--   is physically inside, part of, or contained by the parent place"
--   (Eataly Chiosco -> Madison Square Park; Vessel -> Public Square &
--   Gardens -> Hudson Yards). It NEVER means owned by, operated by,
--   partnered with, sponsored by, organized by, or participating in —
--   commercial relationships live on businesses/events/event_businesses,
--   never here.
--
--   place_type = the physical node's structural type. NOT a replacement
--   for locations.category_id (a restaurant can be place_type=restaurant
--   AND carry a cuisine/food category). Plain text + CHECK, not a Postgres
--   enum, so the vocabulary can grow with a one-line constraint swap.
--
-- Discovery geography (market_id / market_area_id) is deliberately NOT
-- inherited through this hierarchy — each Location keeps its own explicit
-- Market/Area. Exact-match activity queries (What's Happening Here,
-- Featured Event eligibility) are unchanged; descendant rollups are a
-- separate, opt-in future pass.

alter table public.locations
  add column if not exists parent_location_id uuid references public.locations(id) on delete set null,
  add column if not exists place_type text;

alter table public.locations
  drop constraint if exists locations_place_type_check;
alter table public.locations
  add constraint locations_place_type_check check (
    place_type is null or place_type in (
      'district', 'complex', 'campus', 'mall', 'building', 'park', 'plaza',
      'floor', 'venue', 'store', 'restaurant', 'kiosk', 'activation_space', 'landmark'
    )
  );

create index if not exists locations_parent_location_id_idx
  on public.locations (parent_location_id)
  where parent_location_id is not null;

comment on column public.locations.parent_location_id is
  'Physical containment/context only: this place is physically inside, part of, or contained by the parent Location. Never ownership, operator, partner, sponsor, organizer, or participation. ON DELETE SET NULL.';
comment on column public.locations.place_type is
  'Structural physical type of this place (district, complex, campus, mall, building, park, plaza, floor, venue, store, restaurant, kiosk, activation_space, landmark). Nullable; independent of category_id.';

-- Cycle protection — rejects a self-parent, A -> B -> A, and any longer
-- loop, at the database layer (every write path: admin, owner, import).
-- Walks UP from the proposed parent; if it ever reaches the row being
-- written, the change would close a loop. SECURITY DEFINER so the walk
-- sees every row regardless of the writer's RLS visibility (an archived
-- ancestor must still count). The 64-level cap is purely defensive — real
-- place chains are a handful of levels deep — and exceeding it is treated
-- as an error rather than silently accepted. A transaction-scoped
-- advisory lock serializes concurrent parent changes, so two simultaneous
-- edits (A->B and B->A) can't each pass the check and jointly form a loop.
create or replace function public.enforce_location_hierarchy()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  cursor_id uuid;
  steps integer := 0;
begin
  if new.parent_location_id is null then
    return new;
  end if;
  if new.parent_location_id = new.id then
    raise exception 'a location cannot be its own parent';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.locations.parent_location_id'));

  cursor_id := new.parent_location_id;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'location hierarchy cycle: % cannot be placed inside one of its own descendants', new.id;
    end if;
    steps := steps + 1;
    if steps > 64 then
      raise exception 'location hierarchy is deeper than 64 levels above %', new.id;
    end if;
    select l.parent_location_id into cursor_id from public.locations l where l.id = cursor_id;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_locations_hierarchy on public.locations;
create trigger trg_locations_hierarchy
before insert or update of parent_location_id on public.locations
for each row execute function public.enforce_location_hierarchy();

-- Ancestor chain for public place context (breadcrumb). One round trip,
-- nearest parent first (depth 1, 2, ...). SECURITY INVOKER: runs under the
-- caller's own RLS, so an archived/trashed ancestor simply ends the chain
-- there (the recursion can't see it, so it can't continue past it); demo
-- ancestors end it too. Same defensive depth cap as the trigger.
create or replace function public.get_location_ancestors(p_location_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  place_type text,
  market_id uuid,
  market_area_id uuid,
  depth integer
)
language sql
stable
security invoker
set search_path to ''
as $$
  with recursive chain as (
    select p.id, p.name, p.slug, p.place_type, p.market_id, p.market_area_id, p.parent_location_id, 1 as depth
    from public.locations c
    join public.locations p on p.id = c.parent_location_id
    where c.id = p_location_id and not p.is_demo
    union all
    select p.id, p.name, p.slug, p.place_type, p.market_id, p.market_area_id, p.parent_location_id, chain.depth + 1
    from chain
    join public.locations p on p.id = chain.parent_location_id
    where chain.depth < 64 and not p.is_demo
  )
  select id, name, slug, place_type, market_id, market_area_id, depth
  from chain
  order by depth;
$$;

grant execute on function public.get_location_ancestors(uuid) to anon, authenticated;
