-- ============================================================================
-- User Identity + Follow Foundation
--
-- 1. Extends the existing `profiles` table (Phase 1 account foundation,
--    already live) with a lightweight, opt-in PUBLIC identity: username,
--    bio, coarse location_label. `profiles` has never stored email/phone/
--    auth metadata (see that migration's own comment) — only display_name/
--    avatar_url/created_at/updated_at exist today — so every column on
--    this table is safe to expose once a row opts in by setting a
--    username. A row with no username stays exactly as private as it is
--    today (profiles_select_own, unchanged, still the only way to read
--    it). No existing row's data is touched; the three new columns
--    default to NULL for every existing profile.
--
-- 2. Adds `account_followed_events`, the event-side mirror of the
--    existing `account_followed_businesses` table (Phase 2 account
--    foundation, already live) — same shape, same self-only RLS, same
--    "presence row = following" convention. The legacy, anonymous
--    `event_followers` table (email/phone capture, no account) is
--    untouched and keeps its existing meaning; this is a separate,
--    additive concept for authenticated follows, exactly like
--    account_followed_businesses is to `followers`.
-- ============================================================================

-- ── Public user identity (profiles) ─────────────────────────────────────

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists location_label text;

-- Normalized (lowercase), reasonable-character username — the app layer
-- (account/profile/actions.ts) is responsible for normalizing/validating
-- before writing, but this constraint is the actual hard guarantee: even
-- a direct/future write path can never leave a malformed username in
-- place. 3-20 chars, lowercase a-z/0-9/underscore only.
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

alter table public.profiles
  add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 280);

alter table public.profiles
  add constraint profiles_location_label_length
  check (location_label is null or char_length(location_label) <= 80);

-- Case-insensitive uniqueness as a real DB guarantee (username is already
-- stored lowercase by the app, but this is the actual enforcement point,
-- not just app discipline). Partial (excludes NULL) so any number of
-- profiles can share "no username yet".
create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

create index if not exists profiles_username_lookup_idx
  on public.profiles (username)
  where username is not null;

-- Public identity gate: a profile becomes readable by anyone ONLY once its
-- owner has chosen a username — an incomplete profile (no username set)
-- stays exactly as private as it was before this migration (still only
-- reachable via the existing profiles_select_own policy). Postgres RLS
-- policies for the same command are OR'd together, so this purely adds
-- capability, it never narrows the existing self-read policy. Every
-- column here is already public-safe (see this file's header comment),
-- so a single unrestricted SELECT policy is sufficient — no column-level
-- masking needed.
create policy "profiles_select_public"
  on public.profiles for select
  to anon, authenticated
  using (username is not null);

-- ── Event follow, authenticated-account version ─────────────────────────

create table if not exists public.account_followed_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

alter table public.account_followed_events enable row level security;

-- Strictly self-only, exact mirror of account_followed_businesses — no
-- public/anon policy, no UPDATE policy (a toggle is always insert or
-- delete, never an update).
create policy "account_followed_events_select_own"
  on public.account_followed_events for select
  to authenticated
  using (auth.uid() = user_id);
create policy "account_followed_events_insert_own"
  on public.account_followed_events for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "account_followed_events_delete_own"
  on public.account_followed_events for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists account_followed_events_user_id_idx on public.account_followed_events (user_id);
create index if not exists account_followed_events_event_id_idx on public.account_followed_events (event_id);

grant select, insert, delete on public.account_followed_events to authenticated;
