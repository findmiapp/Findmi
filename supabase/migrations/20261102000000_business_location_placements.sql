-- Pass 2 Block A — Placement Core: business_location_placements.
--
-- A business_location_placements row means "this Business is privately
-- PURSUING a commercial relationship with this canonical Findmi Location"
-- (getting stocked, served, featured …). It is intent and process, never a
-- fact: it is NOT business_location_availability (Find Us Here — the public,
-- moderated statement that the Business IS available there), NOT
-- business_locations (Our Locations — the Business operates the place) and
-- NOT an Event / Appearance / Opportunity. Nothing infers one from another,
-- and nothing here is ever public.
--
-- One row per Business + Location (unique): re-opening a Passed target moves
-- the same row back to 'target' — never a duplicate. Geography is derived
-- from the canonical Location (locations.market_id / market_area_id); no
-- place data is copied here.
--
-- Fields:
--   status             target → in_conversation → placement_pending → active,
--                      or passed. Any status may move to any other (a small,
--                      hand-corrected pipeline). `placement_pending` (never a
--                      bare `pending`) so it can't be confused with Find Us
--                      Here's moderation status.
--   status_changed_at  maintained by the trigger below whenever status changes.
--   notes              the Business's own private team notes (Business + Findmi).
--   internal_notes     FINDMI-ONLY (managed service). Never selected by any
--                      Business read; written only through the admin path.
--   next_action /
--   next_action_at     the immediate next step and its date (same naming as
--                      bd.projects; a date, not a task system).
--   source             who created the row: 'business' | 'admin' (the same
--                      vocabulary as business_location_availability.source).
--
-- Access: RLS enabled with ZERO policies and no anon/authenticated grants —
-- the established private-table posture (business_opportunity_goals,
-- business_product_sets …). Every read/write goes through server code using
-- the service-role key after the caller is authorized as a member of THIS
-- Business (owner/manager write, staff read) or as Findmi Admin. Location
-- members/operators get nothing from managing the Location.
--
-- Additive only: one new table, its indexes, two triggers (one new trigger
-- function) and grants. No existing table, row or relationship is touched,
-- and nothing is backfilled.

create table if not exists public.business_location_placements (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null
    constraint business_location_placements_business_id_fkey references public.businesses(id) on delete cascade,
  location_id        uuid not null
    constraint business_location_placements_location_id_fkey references public.locations(id) on delete cascade,
  status             text not null default 'target'
    constraint business_location_placements_status_check
      check (status in ('target', 'in_conversation', 'placement_pending', 'active', 'passed')),
  status_changed_at  timestamptz not null default now(),
  notes              text
    constraint business_location_placements_notes_check check (notes is null or char_length(notes) <= 2000),
  internal_notes     text
    constraint business_location_placements_internal_notes_check check (internal_notes is null or char_length(internal_notes) <= 2000),
  next_action        text
    constraint business_location_placements_next_action_check check (next_action is null or char_length(btrim(next_action)) between 1 and 500),
  next_action_at     date,
  source             text not null default 'business'
    constraint business_location_placements_source_check check (source in ('business', 'admin')),
  created_by_user_id uuid
    constraint business_location_placements_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint business_location_placements_business_location_key unique (business_id, location_id)
);

-- The unique constraint above provides the business_id-leading index.
-- "Businesses targeting this Location" (Admin, later Blocks).
create index if not exists business_location_placements_location_id_idx
  on public.business_location_placements (location_id);
-- The Business's Targets list, filtered by status.
create index if not exists business_location_placements_business_status_idx
  on public.business_location_placements (business_id, status);

-- status_changed_at follows status, whichever path wrote it.
create or replace function public.business_location_placements_status_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_location_placements_status_changed on public.business_location_placements;
create trigger trg_business_location_placements_status_changed
  before update on public.business_location_placements
  for each row execute function public.business_location_placements_status_changed();

drop trigger if exists trg_business_location_placements_updated_at on public.business_location_placements;
create trigger trg_business_location_placements_updated_at
  before update on public.business_location_placements
  for each row execute function public.set_updated_at();

-- ── Access: service role only ──────────────────────────────────────────────
alter table public.business_location_placements enable row level security;

revoke all on public.business_location_placements from public, anon, authenticated;
grant select, insert, update, delete on public.business_location_placements to service_role;

revoke all on function public.business_location_placements_status_changed() from public, anon, authenticated;

comment on table public.business_location_placements is
  'Pass 2 Placement Core: a Business''s PRIVATE pursuit of a commercial relationship with a canonical Location (target / in_conversation / placement_pending / active / passed). Never public and never Find Us Here. Server-only access (RLS on, no client policies or grants); Business members read only through server code that never selects internal_notes.';
comment on column public.business_location_placements.internal_notes is
  'Findmi-only (managed service). Never selected for, or returned to, a Business member.';
comment on column public.business_location_placements.notes is
  'The Business''s own private team notes — visible to that Business''s members and Findmi only.';
