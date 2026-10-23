-- Cross-Entity Target Foundation.
--
-- A Target is a Business's PRIVATE commercial pursuit of exactly one
-- counterparty — a Business, a Location or an Event — for one or more
-- canonical commercial intents (lib/commercial-intents.ts). It is never a
-- Follow, Save, Find Us Here, Opportunity, Conversation or public
-- relationship, and the counterparty never learns of it.
--
-- Replaces business_location_placements (Location-only) as the ONE live
-- Target system. Additive:
--   1. business_targets — typed nullable FKs for the three counterparty
--      kinds (never a bare polymorphic id), exactly one set, one Target per
--      owner + counterparty. The proven pursuit lifecycle, with the one
--      Location-specific word normalized: placement_pending → agreed (Find Us Here already uses "pending" for moderation).
--   2. business_target_activities — the same append-only history (notes +
--      automatic status changes written by the trigger).
--   3. Backfill: every existing placement (production: one) becomes a
--      Location Target with intent [placement], keeping its id, status,
--      Context, Next Action, internal notes and timestamps; its Activity is
--      copied with its ids, actors and times.
--   4. The legacy placement tables stay (rollback / history) but become
--      read-only: no further inserts or updates, so they can never drift
--      from the live system unnoticed.
-- RLS on with no client policies; service_role only, as before.

create table if not exists public.business_targets (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null
    constraint business_targets_business_id_fkey references public.businesses(id) on delete cascade,
  target_business_id   uuid
    constraint business_targets_target_business_id_fkey references public.businesses(id) on delete cascade,
  target_location_id   uuid
    constraint business_targets_target_location_id_fkey references public.locations(id) on delete cascade,
  target_event_id      uuid
    constraint business_targets_target_event_id_fkey references public.events(id) on delete cascade,
  intents              text[] not null
    constraint business_targets_intents_check check (
      cardinality(intents) between 1 and 12
      and intents <@ array['placement', 'wholesale', 'distribution', 'collaboration', 'sponsorship', 'sampling', 'activation', 'pop_up', 'event_participation', 'vending', 'content', 'booking']
    ),
  status               text not null default 'target'
    constraint business_targets_status_check check (status in ('target', 'in_conversation', 'agreed', 'active', 'passed')),
  status_changed_at    timestamptz not null default now(),
  context              text
    constraint business_targets_context_check check (context is null or char_length(context) <= 2000),
  internal_notes       text
    constraint business_targets_internal_notes_check check (internal_notes is null or char_length(internal_notes) <= 2000),
  next_action          text
    constraint business_targets_next_action_check check (next_action is null or char_length(btrim(next_action)) between 1 and 500),
  next_action_at       date,
  source               text not null default 'business'
    constraint business_targets_source_check check (source in ('business', 'admin')),
  created_by_user_id   uuid
    constraint business_targets_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Transient: who is making a status change. Set in the same UPDATE as
  -- status; copied into Activity and cleared by the trigger (null at rest).
  status_actor         text
    constraint business_targets_status_actor_check check (status_actor is null or status_actor in ('business', 'findmi')),
  status_actor_user_id uuid
    constraint business_targets_status_actor_user_id_fkey references auth.users(id) on delete set null,
  constraint business_targets_one_counterparty_check
    check (num_nonnulls(target_business_id, target_location_id, target_event_id) = 1),
  constraint business_targets_not_self_check
    check (target_business_id is null or target_business_id <> business_id),
  constraint business_targets_business_target_business_key unique (business_id, target_business_id),
  constraint business_targets_business_target_location_key unique (business_id, target_location_id),
  constraint business_targets_business_target_event_key unique (business_id, target_event_id)
);

create index if not exists business_targets_business_status_idx
  on public.business_targets (business_id, status);
create index if not exists business_targets_target_business_idx
  on public.business_targets (target_business_id) where target_business_id is not null;
create index if not exists business_targets_target_location_idx
  on public.business_targets (target_location_id) where target_location_id is not null;
create index if not exists business_targets_target_event_idx
  on public.business_targets (target_event_id) where target_event_id is not null;

create table if not exists public.business_target_activities (
  id                 uuid primary key default gen_random_uuid(),
  target_id          uuid not null
    constraint business_target_activities_target_id_fkey references public.business_targets(id) on delete cascade,
  activity_type      text not null
    constraint business_target_activities_type_check check (activity_type in ('note', 'status_change')),
  body               text
    constraint business_target_activities_body_check check (body is null or char_length(btrim(body)) between 1 and 2000),
  metadata           jsonb not null default '{}'::jsonb,
  actor              text
    constraint business_target_activities_actor_check check (actor is null or actor in ('business', 'findmi')),
  created_by_user_id uuid
    constraint business_target_activities_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint business_target_activities_shape_check check (
    (activity_type = 'note' and body is not null)
    or (
      activity_type = 'status_change'
      and body is null
      and metadata ->> 'from' in ('target', 'in_conversation', 'agreed', 'active', 'passed')
      and metadata ->> 'to' in ('target', 'in_conversation', 'agreed', 'active', 'passed')
      and metadata ->> 'from' <> metadata ->> 'to'
    )
  )
);

create index if not exists business_target_activities_target_idx
  on public.business_target_activities (target_id, created_at desc, id desc);

-- A status change keeps status_changed_at in step and records its Activity
-- in the same statement, whoever wrote it.
create or replace function public.business_targets_status_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    insert into public.business_target_activities (target_id, activity_type, metadata, actor, created_by_user_id)
    values (new.id, 'status_change', jsonb_build_object('from', old.status, 'to', new.status), new.status_actor, new.status_actor_user_id);
  end if;
  new.status_actor := null;
  new.status_actor_user_id := null;
  return new;
end;
$$;
revoke all on function public.business_targets_status_changed() from public, anon, authenticated;

drop trigger if exists trg_business_targets_status_changed on public.business_targets;
create trigger trg_business_targets_status_changed
  before update on public.business_targets
  for each row execute function public.business_targets_status_changed();

drop trigger if exists trg_business_targets_updated_at on public.business_targets;
create trigger trg_business_targets_updated_at
  before update on public.business_targets
  for each row execute function public.set_updated_at();

alter table public.business_targets enable row level security;
revoke all on public.business_targets from public, anon, authenticated;
grant select, insert, update, delete on public.business_targets to service_role;

alter table public.business_target_activities enable row level security;
revoke all on public.business_target_activities from public, anon, authenticated, service_role;
grant select, insert on public.business_target_activities to service_role;

-- Backfill (insert only — the update triggers don't fire, so no Activity is
-- invented and updated_at is kept). Same ids, so old `pt` links and Activity
-- keep pointing at the same Target. Idempotent.
insert into public.business_targets (
  id, business_id, target_location_id, intents, status, status_changed_at,
  context, internal_notes, next_action, next_action_at, source, created_by_user_id, created_at, updated_at
)
select
  p.id, p.business_id, p.location_id, array['placement'],
  case p.status when 'placement_pending' then 'agreed' else p.status end,
  p.status_changed_at, p.notes, p.internal_notes, p.next_action, p.next_action_at,
  p.source, p.created_by_user_id, p.created_at, p.updated_at
from public.business_location_placements p
on conflict do nothing;

insert into public.business_target_activities (id, target_id, activity_type, body, metadata, actor, created_by_user_id, created_at)
select
  a.id, a.placement_id, a.activity_type, a.body,
  case
    when a.activity_type = 'status_change' then jsonb_build_object(
      'from', case a.metadata ->> 'from' when 'placement_pending' then 'agreed' else a.metadata ->> 'from' end,
      'to', case a.metadata ->> 'to' when 'placement_pending' then 'agreed' else a.metadata ->> 'to' end
    )
    else a.metadata
  end,
  a.actor, a.created_by_user_id, a.created_at
from public.business_location_placement_activities a
join public.business_targets t on t.id = a.placement_id
on conflict do nothing;

-- Legacy: read-only from here on (kept for rollback and history).
revoke insert, update, delete, truncate on public.business_location_placements from service_role;
revoke insert on public.business_location_placement_activities from service_role;

comment on table public.business_targets is
  'Cross-Entity Targets: a Business''s PRIVATE pursuit of exactly one counterparty (Business, Location or Event) for canonical commercial intents. Never public; the counterparty never sees it. Server-only access (RLS on, no client policies or grants); Business members read only through server code that never selects internal_notes.';
comment on column public.business_targets.context is
  'The Business''s own lasting Context about this pursuit — visible to that Business''s members and Findmi only.';
comment on column public.business_targets.internal_notes is
  'Findmi-only (managed service). Never selected for, or returned to, a Business member.';
comment on column public.business_targets.intents is
  'Canonical commercial intent codes (lib/commercial-intents.ts); which ones fit depends on the counterparty kind.';
comment on table public.business_target_activities is
  'Append-only, Business-visible history of one Target (notes + automatic status changes). Never internal_notes. service_role may only select and insert.';
comment on table public.business_location_placements is
  'LEGACY (read-only since Cross-Entity Targets): superseded by business_targets; kept for rollback and history.';
comment on table public.business_location_placement_activities is
  'LEGACY (read-only since Cross-Entity Targets): superseded by business_target_activities; kept for rollback and history.';
