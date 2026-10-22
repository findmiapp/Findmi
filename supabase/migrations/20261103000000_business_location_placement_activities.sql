-- Pass 2 Block A closeout — Placement Activity (business_location_placement_activities).
--
-- An append-only, chronological history for one Placement (Target): dated
-- notes the Business adds, and an automatic entry every time the Placement's
-- status actually changes. It belongs to the Business's PRIVATE placement
-- workflow, so it lives beside business_location_placements with the same
-- privacy posture — NOT in bd.activities, which is Findmi-internal.
--
-- Three deliberately separate things now exist on a Placement:
--   notes           SUMMARY / CONTEXT — mutable, Business-visible (unchanged column).
--   this table      ACTIVITY — append-only, Business-visible history.
--   internal_notes  FINDMI-ONLY — never written here, never mixed in.
--
-- Activity rows:
--   activity_type   'note' | 'status_change' (deliberately small; widen the
--                   check later when a real new type is needed).
--   body            the note text (required for a note, null otherwise).
--   metadata        structured data for system events only:
--                   status_change → {"from": <status>, "to": <status>}.
--   actor           who did it: 'business' (a member, see created_by_user_id)
--                   or 'findmi' (a founder Admin session); null when unknown.
--   created_by_user_id  the member, when there is one.
--
-- STATUS CHANGES ARE RECORDED IN THE DATABASE, not in UI code: the existing
-- BEFORE UPDATE trigger function on business_location_placements (it already
-- maintains status_changed_at) now also inserts the status_change row in the
-- same statement, so EVERY write path that changes status records it exactly
-- once, and a write that leaves status unchanged records nothing. The writer
-- states who it is through two transient columns added here —
-- status_actor / status_actor_user_id — set in the same UPDATE as the status;
-- the trigger copies them into the Activity row and then clears them, so they
-- are always null at rest and can never be stale for a later change.
--
-- Immutability: service_role may only SELECT and INSERT Activity (no UPDATE
-- or DELETE grant). Deleting the Placement itself still removes its Activity
-- (ON DELETE CASCADE).
--
-- Access: RLS enabled with ZERO policies and no anon/authenticated grants —
-- the same server-only posture as business_location_placements. Reads go
-- through server code that first scopes the Placement to THIS Business.
--
-- Additive only: two nullable columns on business_location_placements, one
-- new table, its index, a replaced trigger function body (same name, same
-- trigger) and grants. No existing row is changed and nothing is backfilled.

-- ── 1. Transient actor columns on the Placement ────────────────────────────
alter table public.business_location_placements
  add column if not exists status_actor text
    constraint business_location_placements_status_actor_check check (status_actor is null or status_actor in ('business', 'findmi')),
  add column if not exists status_actor_user_id uuid
    constraint business_location_placements_status_actor_user_id_fkey references auth.users(id) on delete set null;

comment on column public.business_location_placements.status_actor is
  'Transient: who is making this status change (business | findmi). Set in the same UPDATE as status; copied into Activity and cleared by the trigger — always null at rest.';
comment on column public.business_location_placements.status_actor_user_id is
  'Transient: the member making this status change. Copied into Activity and cleared by the trigger — always null at rest.';

-- ── 2. Activity ────────────────────────────────────────────────────────────
create table if not exists public.business_location_placement_activities (
  id                 uuid primary key default gen_random_uuid(),
  placement_id       uuid not null
    constraint business_location_placement_activities_placement_id_fkey references public.business_location_placements(id) on delete cascade,
  activity_type      text not null
    constraint business_location_placement_activities_type_check check (activity_type in ('note', 'status_change')),
  body               text
    constraint business_location_placement_activities_body_check check (body is null or char_length(btrim(body)) between 1 and 2000),
  metadata           jsonb not null default '{}'::jsonb,
  actor              text
    constraint business_location_placement_activities_actor_check check (actor is null or actor in ('business', 'findmi')),
  created_by_user_id uuid
    constraint business_location_placement_activities_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint business_location_placement_activities_shape_check check (
    (activity_type = 'note' and body is not null)
    or (
      activity_type = 'status_change'
      and body is null
      and metadata ->> 'from' in ('target', 'in_conversation', 'placement_pending', 'active', 'passed')
      and metadata ->> 'to' in ('target', 'in_conversation', 'placement_pending', 'active', 'passed')
      and metadata ->> 'from' <> metadata ->> 'to'
    )
  )
);

-- One Placement's timeline, newest first (keyset-paged on created_at, id).
create index if not exists business_location_placement_activities_placement_idx
  on public.business_location_placement_activities (placement_id, created_at desc, id desc);

-- ── 3. Status changes record themselves ────────────────────────────────────
-- Same function the existing trg_business_location_placements_status_changed
-- (BEFORE UPDATE) already calls; only its body grows.
create or replace function public.business_location_placements_status_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    insert into public.business_location_placement_activities (placement_id, activity_type, metadata, actor, created_by_user_id)
    values (new.id, 'status_change', jsonb_build_object('from', old.status, 'to', new.status), new.status_actor, new.status_actor_user_id);
  end if;
  new.status_actor := null;
  new.status_actor_user_id := null;
  return new;
end;
$$;

revoke all on function public.business_location_placements_status_changed() from public, anon, authenticated;

-- ── 4. Access: service role only, append-only ──────────────────────────────
alter table public.business_location_placement_activities enable row level security;

revoke all on public.business_location_placement_activities from public, anon, authenticated, service_role;
grant select, insert on public.business_location_placement_activities to service_role;

comment on table public.business_location_placement_activities is
  'Pass 2 Placement Activity: append-only, Business-visible history of one Placement (notes + automatic status changes). Never internal_notes. Server-only access (RLS on, no client policies or grants); service_role may only select and insert.';
