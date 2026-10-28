-- Findmi Consolidation pass — canonical publication rules enforced below
-- the UI, Location review state, Address Line 2, and index-backed
-- typeahead matching. Additive and backward-compatible:
--
--   * No row's public visibility changes. Every Event the public can see
--     today is publication_status='live' (verified before this migration:
--     the only pending_review / rejected Events are already is_demo=true).
--   * locations.review_status is NEW and nullable; NULL = never went
--     through review (every Admin-created / already-listed Location).
--     Only currently-unlisted, active Locations are marked pending_review
--     so Admin sees them in the new Pending Locations queue — they were
--     already hidden from discovery, nothing becomes hidden.
--   * locations.address_line2 — suite / unit / floor, kept separate from
--     the geocoded street address.

-- 1. Events: pending / rejected Events are invisible to everyone except
--    their own managers (event_members, or members of the hosting
--    Business). Service-role reads (Admin, server-side manager pages)
--    bypass RLS as before. The check uses the row's own columns plus
--    member tables (never a self-query of events), so it can't hit the
--    self-reference bug fixed in 20260927024406.
drop policy if exists "Hide unpublished events" on public.events;
create policy "Hide unpublished events"
  on public.events
  as restrictive
  for select
  to public
  using (
    publication_status = 'live'
    or exists (
      select 1 from public.event_members m
      where m.event_id = events.id and m.user_id = (select auth.uid())
    )
    or (
      host_business_id is not null
      and exists (
        select 1 from public.business_members bm
        where bm.business_id = events.host_business_id and bm.user_id = (select auth.uid())
      )
    )
  );

-- Child rows (dates) follow their Event — SECURITY DEFINER for the same
-- reason as is_event_retired (the parent's own RLS must not hide the row
-- the check needs to read).
create or replace function public.is_event_unpublished_for_viewer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.publication_status <> 'live'
      and not exists (
        select 1 from public.event_members m
        where m.event_id = e.id and m.user_id = auth.uid()
      )
      and not (
        e.host_business_id is not null
        and exists (
          select 1 from public.business_members bm
          where bm.business_id = e.host_business_id and bm.user_id = auth.uid()
        )
      )
  );
$$;
revoke all on function public.is_event_unpublished_for_viewer(uuid) from public;
grant execute on function public.is_event_unpublished_for_viewer(uuid) to anon, authenticated, service_role;

drop policy if exists "Hide occurrences of unpublished events" on public.event_occurrences;
create policy "Hide occurrences of unpublished events"
  on public.event_occurrences
  as restrictive
  for select
  to public
  using (not public.is_event_unpublished_for_viewer(event_id));

-- 2. Locations: explicit review state + Address Line 2.
alter table public.locations
  add column if not exists review_status text,
  add column if not exists address_line2 text;

alter table public.locations drop constraint if exists locations_review_status_check;
alter table public.locations
  add constraint locations_review_status_check
  check (review_status is null or review_status in ('pending_review', 'approved', 'rejected'));

update public.locations
set review_status = 'pending_review'
where is_demo = true
  and archived_at is null
  and trashed_at is null
  and review_status is null;

create index if not exists locations_review_status_pending_idx
  on public.locations (review_status)
  where review_status = 'pending_review';

-- 3. Index-backed typeahead (search-before-create): trigram GIN indexes so
--    debounced `ilike '%term%'` matching on names / street addresses
--    stays cheap as tables grow.
create extension if not exists pg_trgm with schema extensions;

create index if not exists locations_name_trgm_idx on public.locations using gin (name extensions.gin_trgm_ops);
create index if not exists locations_address_trgm_idx on public.locations using gin (address extensions.gin_trgm_ops);
create index if not exists events_name_trgm_idx on public.events using gin (name extensions.gin_trgm_ops);
create index if not exists businesses_name_trgm_idx on public.businesses using gin (name extensions.gin_trgm_ops);
