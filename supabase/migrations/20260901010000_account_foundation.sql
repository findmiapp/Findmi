-- ============================================================================
-- Phase 1: authenticated account foundation
-- Adds ONE new table (profiles). Touches nothing else. Fully additive.
--
-- NOT APPLIED YET. This file was created as part of the bounded Phase 1
-- implementation pass; apply_migration must not be run against it until
-- explicit separate approval is given.
-- ============================================================================

-- profiles: the private FindMi account record — one row per auth.users
-- row. Distinct from `people` (optional public editorial profile) by
-- design: auth.users = authentication identity, profiles = private
-- account profile, people = optional public person profile. No
-- email/password is duplicated here — auth.users.email is already the
-- source of truth and is reachable via auth.uid()/the session.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Strictly self-only. No public read policy — a profile is private
-- account data, not a discovery surface (unlike `people`).
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No INSERT/DELETE policy is granted to `authenticated`. Rows are
-- created only by the trigger below (SECURITY DEFINER, runs as the row
-- owner), so a client can never insert an arbitrary profiles row for
-- someone else's id. Deletion is out of Phase 1 scope; a row is removed
-- only via `on delete cascade` if an auth.users row is ever deleted
-- through the Auth admin API.

-- Auto-create the profile the instant a new auth.users row appears, so
-- profiles.id/auth.users.id are always 1:1 without trusting the client
-- to ever call an insert itself, and without a race between signup and
-- first profile read. Seeds display_name from the signup form's
-- raw_user_meta_data when present, trimmed, with a blank/whitespace-only
-- value stored as NULL rather than "" (matches how blank-vs-null is
-- already treated elsewhere in this schema, e.g.
-- lib/admin/form-helpers.ts's str()).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_display_name text;
begin
  meta_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  insert into public.profiles (id, display_name) values (new.id, meta_display_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Reuses the existing, already-in-production set_updated_at() trigger
-- function (currently used on businesses.updated_at) — no new function
-- needed for this.
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
