-- Findmi Consolidation pass — canonical publication rules enforced below
-- the UI, Location review state, Address Line 2, and index-backed
-- typeahead matching. Additive and backward-compatible:
--
--   * No row's public visibility changes. Every Event the public can see
--     today is publication_status='live' (verified before this migration:
--     the only pending_review / rejected Events are already is_demo=true;
--     every event_occurrences row has an existing parent Event).
--   * locations.review_status is NEW, nullable, and the CANONICAL Location
--     moderation state ('pending_review' | 'approved' | 'rejected').
--     NULL = never entered review. It is deliberately NOT derived from
--     is_demo: is_demo stays the separate "publicly listed" flag, and the
--     existing unlisted Locations have no provenance proving they are
--     review submissions, so NO existing row is backfilled. Only new
--     user/Business submissions are written as 'pending_review' (app code).
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

-- Child rows (dates) follow their Event, with ALLOW semantics: a date is
-- visible only when its parent Event exists AND the viewer may see that
-- Event (live, or the viewer manages it). An Event that can't be resolved
-- fails closed. SECURITY DEFINER for the same reason as is_event_retired
-- (the parent's own RLS must not hide the row this check reads).
-- service_role bypasses RLS, so Admin / server-side reads are unchanged.
create or replace function public.can_view_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (
        e.publication_status = 'live'
        or exists (
          select 1 from public.event_members m
          where m.event_id = e.id and m.user_id = auth.uid()
        )
        or (
          e.host_business_id is not null
          and exists (
            select 1 from public.business_members bm
            where bm.business_id = e.host_business_id and bm.user_id = auth.uid()
          )
        )
      )
  );
$$;
revoke all on function public.can_view_event(uuid) from public;
grant execute on function public.can_view_event(uuid) to anon, authenticated, service_role;

drop policy if exists "Occurrences follow their Event's visibility" on public.event_occurrences;
create policy "Occurrences follow their Event's visibility"
  on public.event_occurrences
  as restrictive
  for select
  to public
  using (public.can_view_event(event_id));

-- 2. Locations: explicit review state + Address Line 2.
alter table public.locations
  add column if not exists review_status text,
  add column if not exists address_line2 text;

alter table public.locations drop constraint if exists locations_review_status_check;
alter table public.locations
  add constraint locations_review_status_check
  check (review_status is null or review_status in ('pending_review', 'approved', 'rejected'));

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
