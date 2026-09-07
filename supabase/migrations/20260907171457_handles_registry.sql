-- ============================================================================
-- FindMi Global Handle Registry
--
-- One central table so a username/handle is unique across EVERY supported
-- entity type (person/business/location/event), not just within one
-- table. `profiles.username` already had its own case-insensitive unique
-- index (see user_identity_and_event_follow) — that stays as-is (its own
-- read path, public_profiles view, and RLS are untouched and keep
-- working exactly as before), but it is no longer sufficient on its own
-- now that businesses/locations/events also want usernames sharing the
-- SAME namespace. This table is the one authoritative uniqueness
-- guarantee going forward; profiles.username becomes a synced read-cache
-- for the person case only (kept in sync by claim_person_handle() below),
-- written through never around.
--
-- No usernames are auto-generated or backfilled from names/slugs. The one
-- exception: the single existing profiles row that already has a
-- genuinely user-chosen username ("mocktailmart", set through the
-- existing account/profile form before this migration) is registered
-- here so it isn't silently orphaned from the new registry it now needs
-- to participate in — this is preserving an existing explicit choice,
-- not generating a new one.
-- ============================================================================

create table public.handles (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  entity_type text not null check (entity_type in ('person', 'business', 'location', 'event')),
  entity_id uuid not null,
  -- The authenticated user who performed the claim — useful for support/
  -- audit lookups (task's own "owning/claiming user association where
  -- useful"). Never exposed publicly (see public_handles view below) —
  -- same posture profiles.id already has to take.
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handles_format check (handle ~ '^[a-z0-9_]{3,20}$')
);

-- The actual global uniqueness guarantee — one handle can belong to
-- exactly one entity across the whole app, full stop. Handles are always
-- stored already-lowercased by the app layer (lib/username.ts), and the
-- format check above restricts the charset to lowercase a-z/0-9/_ only,
-- so a plain unique index (no lower()) is the complete guarantee here.
create unique index handles_handle_unique_idx on public.handles (handle);

-- One handle per entity at a time (this pass's own "do not build username
-- history" — changing a username updates this same row via ON CONFLICT,
-- it never leaves an old row behind).
create unique index handles_entity_unique_idx on public.handles (entity_type, entity_id);

create index handles_user_id_idx on public.handles (user_id) where user_id is not null;

alter table public.handles enable row level security;

-- Self-visibility only at the RLS level — same "id/ownership stays
-- private, only the claimant can see their own row this way" posture as
-- every other membership table in this codebase. Public resolution
-- (vanity route + live availability checks) goes through the
-- public_handles view below instead, exactly mirroring how
-- public_profiles already keeps `profiles.id` out of any public read.
create policy "handles_select_own"
  on public.handles for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for anon/authenticated — every write
-- goes through claim_person_handle() (person) or the app's own
-- service-role-authorized upsert (business/location/event, after
-- requireBusinessMember/requireLocationMember/requireEventMember has
-- already authorized the caller). Service-role bypasses RLS entirely, so
-- this table simply has no direct client-writable policy at all.

grant select on public.handles to authenticated;

-- Public-safe view — handle/entity_type/entity_id only, exactly the
-- public_profiles precedent (never id/user_id/created_at/updated_at).
-- This is what the root /[username] vanity route and the live
-- availability check both read through; there is no other public path to
-- this table's rows.
create view public.public_handles as
select handle, entity_type, entity_id
from public.handles;

grant select on public.public_handles to anon, authenticated;

-- ── Person handle claim/change — SECURITY DEFINER so one call can
-- atomically upsert the registry row AND keep profiles.username (the
-- existing, already-working public read path) in sync. Re-validates the
-- format server-side regardless of what the caller already checked
-- client-side. A collision — either with another person's or another
-- entity type's handle — surfaces as a normal unique_violation (23505),
-- which the calling Server Action catches and turns into a clean message;
-- this function itself never swallows or reinterprets that error. ──
create or replace function public.claim_person_handle(p_user_id uuid, p_handle text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_handle is null or p_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_handle';
  end if;

  insert into public.handles (handle, entity_type, entity_id, user_id, updated_at)
  values (p_handle, 'person', p_user_id, p_user_id, now())
  on conflict (entity_type, entity_id)
  do update set handle = excluded.handle, user_id = excluded.user_id, updated_at = now();

  update public.profiles set username = p_handle, updated_at = now() where id = p_user_id;
end;
$$;

grant execute on function public.claim_person_handle(uuid, text) to authenticated;

-- ── Preserve the one existing real, user-chosen username ────────────────
insert into public.handles (handle, entity_type, entity_id, user_id)
select username, 'person', id, id
from public.profiles
where username is not null
on conflict do nothing;
