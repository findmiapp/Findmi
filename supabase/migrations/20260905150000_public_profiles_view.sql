-- Privacy correction — profiles_select_public (added in
-- user_identity_and_event_follow) was a row-level policy only: it let
-- anon/authenticated SELECT every column of a username-set profiles row,
-- including `id` (the raw auth.users id) and created_at/updated_at.
-- Postgres RLS is row-level, not column-level, so that policy could not
-- itself withhold `id` — and since the anon key is public, anyone could
-- query the `profiles` table directly (not just through this app's own
-- column-limited selects) and read it. `id` is explicitly listed as a
-- field that must never become public in this pass's own spec ("NO
-- public: ... auth ID").
--
-- Fix: drop that row-only policy, and replace the entire public-read path
-- with a view whose SELECT list hard-codes the safe columns AND the
-- username-is-not-null filter, independent of RLS. Migrations run as the
-- `postgres` role, which has BYPASSRLS in Supabase's managed setup, so
-- this view's own SQL — not a base-table policy — is now the complete
-- security boundary for public profile reads: `id`, created_at, and
-- updated_at are never in its column list, so they can never be
-- selected through it, and there is no other public policy left on
-- `profiles` for a direct query to fall back on.
drop policy if exists "profiles_select_public" on public.profiles;

create or replace view public.public_profiles as
select username, display_name, avatar_url, bio, location_label
from public.profiles
where username is not null;

grant select on public.public_profiles to anon, authenticated;
