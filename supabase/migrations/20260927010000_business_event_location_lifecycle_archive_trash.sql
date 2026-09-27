-- Admin Content Lifecycle + Bulk Management V2 — Businesses, Events,
-- Locations. Same additive, orthogonal archived_at/trashed_at pattern as
-- V1's products migration (20260927000000_product_lifecycle_archive_trash):
-- never touches publication_status (businesses/events already have a
-- real Pause via publication_status='paused') or is_demo. Locations gets
-- the columns too but has NO existing pause/publication concept — this
-- migration does not invent one; only archived_at/trashed_at are added.

alter table public.businesses
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz;
alter table public.events
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz;
alter table public.locations
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz;

comment on column public.businesses.archived_at is 'Admin Content Lifecycle V1/V2. See products.archived_at for the full model — orthogonal to publication_status (existing Pause).';
comment on column public.businesses.trashed_at is 'Admin Content Lifecycle V1/V2. See products.trashed_at for the full model.';
comment on column public.events.archived_at is 'Admin Content Lifecycle V1/V2. See products.archived_at for the full model — orthogonal to publication_status (existing Pause).';
comment on column public.events.trashed_at is 'Admin Content Lifecycle V1/V2. See products.trashed_at for the full model.';
comment on column public.locations.archived_at is 'Admin Content Lifecycle V1/V2. Locations have no existing Pause/publication concept — this column is NOT one either. See products.archived_at for the general model.';
comment on column public.locations.trashed_at is 'Admin Content Lifecycle V1/V2. See products.trashed_at for the general model.';

-- Businesses/events/locations currently have permissive RLS SELECT
-- policies with `qual = true` (is_demo/publication_status are enforced
-- only in application query code, unlike products — a pre-existing
-- architecture difference this pass does not change). Rather than widen
-- scope by retrofitting is_demo/publication_status into RLS too, each
-- gets a narrowly-scoped RESTRICTIVE policy that ANDs on top of the
-- existing permissive one, so existing behavior for every other
-- condition is completely unchanged and only archived_at/trashed_at
-- become newly, canonically unreachable via anon/public — including
-- through any public query path this pass never touches.
create policy "Hide archived or trashed businesses" on public.businesses
  as restrictive for select to public
  using (archived_at is null and trashed_at is null);

create policy "Hide archived or trashed events" on public.events
  as restrictive for select to public
  using (archived_at is null and trashed_at is null);

create policy "Hide archived or trashed locations" on public.locations
  as restrictive for select to public
  using (archived_at is null and trashed_at is null);

-- Child visibility — archiving/trashing a parent must also stop its
-- otherwise-normal children from surfacing publicly (task's explicit
-- "child visibility" requirement). Same RESTRICTIVE-policy technique:
-- purely additive, does not touch any existing policy's behavior.
create policy "Hide products of archived or trashed businesses" on public.products
  as restrictive for select to public
  using (
    not exists (
      select 1 from public.businesses b
      where b.id = products.business_id and (b.archived_at is not null or b.trashed_at is not null)
    )
  );

create policy "Hide appearances of archived or trashed parents" on public.appearances
  as restrictive for select to public
  using (
    not exists (
      select 1 from public.businesses b
      where b.id = appearances.business_id and (b.archived_at is not null or b.trashed_at is not null)
    )
    and (
      appearances.event_id is null
      or not exists (
        select 1 from public.events e
        where e.id = appearances.event_id and (e.archived_at is not null or e.trashed_at is not null)
      )
    )
  );

create policy "Hide occurrences of archived or trashed events" on public.event_occurrences
  as restrictive for select to public
  using (
    not exists (
      select 1 from public.events e
      where e.id = event_occurrences.event_id and (e.archived_at is not null or e.trashed_at is not null)
    )
  );

create index if not exists businesses_archived_at_idx on public.businesses (archived_at) where archived_at is not null;
create index if not exists businesses_trashed_at_idx on public.businesses (trashed_at) where trashed_at is not null;
create index if not exists events_archived_at_idx on public.events (archived_at) where archived_at is not null;
create index if not exists events_trashed_at_idx on public.events (trashed_at) where trashed_at is not null;
create index if not exists locations_archived_at_idx on public.locations (archived_at) where archived_at is not null;
create index if not exists locations_trashed_at_idx on public.locations (trashed_at) where trashed_at is not null;
