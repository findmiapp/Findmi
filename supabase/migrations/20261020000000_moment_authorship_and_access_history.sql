-- Identity, Authorship & Entity Access V1.
--
-- 1. journal_entries.author_business_id — the Moment's PUBLIC author.
--      NULL      → the Person journal_entries.user_id
--      not NULL  → that Business
--    journal_entries.user_id stays the immutable authenticated creator /
--    original actor; changing the public author never rewrites it (a
--    trigger below rejects any user_id change). No backfill: every
--    existing Moment keeps NULL, i.e. today's Person authorship.
--
-- 2. Moment management derived from CURRENT state, used by every "own"
--    policy on journal_entries / journal_entry_media / journal_entry_sections
--    / journal_entry_connections:
--      Personal Moment → its user_id
--      Business Moment → a CURRENT owner/manager of that Business (staff
--                        never; the original creator gets no lasting right
--                        from user_id alone)
--    Public-read policies are unchanged. App writes keep going through the
--    service role with server-side checks; these policies are the second
--    layer.
--
-- 3. access_events — a deliberately narrow access history (claim approved,
--    manager added/removed, owner removed/transferred, all managers
--    removed, Moment public author changed). Service role only. Admin has
--    no individual identity, so actor_kind = 'admin' with a NULL
--    actor_user_id. No historical retrofit.
--
-- Additive only. No data is changed or deleted.

-- ── 1. Public author ───────────────────────────────────────────────────

alter table public.journal_entries
  add column if not exists author_business_id uuid references public.businesses(id) on delete set null;

create index if not exists journal_entries_author_business_id_idx
  on public.journal_entries (author_business_id, entry_date desc)
  where author_business_id is not null;

create or replace function public.journal_entries_keep_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'journal_entries.user_id is the original creator and cannot change';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_journal_entries_keep_creator on public.journal_entries;
create trigger trg_journal_entries_keep_creator
  before update of user_id on public.journal_entries
  for each row execute function public.journal_entries_keep_creator();

-- ── 2. Management authority ────────────────────────────────────────────

-- The caller is a CURRENT owner/manager of the Business (staff excluded).
create or replace function public.can_author_as_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_business_id is not null
     and auth.uid() is not null
     and exists (
       select 1 from public.business_members m
        where m.business_id = p_business_id
          and m.user_id = auth.uid()
          and m.role in ('owner', 'manager')
     );
$$;

-- The caller may manage this Moment right now.
create or replace function public.can_manage_journal_entry(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.journal_entries je
     where je.id = p_entry_id
       and auth.uid() is not null
       and (
         (je.author_business_id is null and je.user_id = auth.uid())
         or (je.author_business_id is not null and public.can_author_as_business(je.author_business_id))
       )
  );
$$;

revoke all on function public.can_author_as_business(uuid) from public;
revoke all on function public.can_manage_journal_entry(uuid) from public;
grant execute on function public.can_author_as_business(uuid) to authenticated, service_role;
grant execute on function public.can_manage_journal_entry(uuid) to authenticated, service_role;

-- journal_entries — the row's own columns decide (no self-lookup).
drop policy if exists "journal_entries_select_own" on public.journal_entries;
create policy "journal_entries_select_own"
  on public.journal_entries for select
  to authenticated
  using (
    (author_business_id is null and auth.uid() = user_id)
    or (author_business_id is not null and public.can_author_as_business(author_business_id))
  );

-- Insert: always as yourself; a Business author only when you manage it.
drop policy if exists "journal_entries_insert_own" on public.journal_entries;
create policy "journal_entries_insert_own"
  on public.journal_entries for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (author_business_id is null or public.can_author_as_business(author_business_id))
  );

-- Update: only a current manager of the row, and the result must still be
-- one the caller manages — another manager can't turn someone else's
-- Moment into a personal one, nobody can pick a Business they don't manage.
drop policy if exists "journal_entries_update_own" on public.journal_entries;
create policy "journal_entries_update_own"
  on public.journal_entries for update
  to authenticated
  using (
    (author_business_id is null and auth.uid() = user_id)
    or (author_business_id is not null and public.can_author_as_business(author_business_id))
  )
  with check (
    (author_business_id is null and auth.uid() = user_id)
    or (author_business_id is not null and public.can_author_as_business(author_business_id))
  );

drop policy if exists "journal_entries_delete_own" on public.journal_entries;
create policy "journal_entries_delete_own"
  on public.journal_entries for delete
  to authenticated
  using (
    (author_business_id is null and auth.uid() = user_id)
    or (author_business_id is not null and public.can_author_as_business(author_business_id))
  );

-- journal_entry_media
drop policy if exists "journal_entry_media_select_own" on public.journal_entry_media;
create policy "journal_entry_media_select_own"
  on public.journal_entry_media for select
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_media_insert_own" on public.journal_entry_media;
create policy "journal_entry_media_insert_own"
  on public.journal_entry_media for insert
  to authenticated
  with check (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_media_update_own" on public.journal_entry_media;
create policy "journal_entry_media_update_own"
  on public.journal_entry_media for update
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id))
  with check (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_media_delete_own" on public.journal_entry_media;
create policy "journal_entry_media_delete_own"
  on public.journal_entry_media for delete
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

-- journal_entry_sections
drop policy if exists "journal_entry_sections_select_own" on public.journal_entry_sections;
create policy "journal_entry_sections_select_own"
  on public.journal_entry_sections for select
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_sections_insert_own" on public.journal_entry_sections;
create policy "journal_entry_sections_insert_own"
  on public.journal_entry_sections for insert
  to authenticated
  with check (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_sections_update_own" on public.journal_entry_sections;
create policy "journal_entry_sections_update_own"
  on public.journal_entry_sections for update
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id))
  with check (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_sections_delete_own" on public.journal_entry_sections;
create policy "journal_entry_sections_delete_own"
  on public.journal_entry_sections for delete
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

-- journal_entry_connections (no update policy, unchanged)
drop policy if exists "journal_entry_connections_select_own" on public.journal_entry_connections;
create policy "journal_entry_connections_select_own"
  on public.journal_entry_connections for select
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_connections_insert_own" on public.journal_entry_connections;
create policy "journal_entry_connections_insert_own"
  on public.journal_entry_connections for insert
  to authenticated
  with check (public.can_manage_journal_entry(journal_entry_id));

drop policy if exists "journal_entry_connections_delete_own" on public.journal_entry_connections;
create policy "journal_entry_connections_delete_own"
  on public.journal_entry_connections for delete
  to authenticated
  using (public.can_manage_journal_entry(journal_entry_id));

-- ── 3. Narrow access history ───────────────────────────────────────────

create table if not exists public.access_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('business', 'moment')),
  entity_id uuid not null,
  action text not null check (action in (
    'claim_approved',
    'manager_added',
    'manager_removed',
    'role_changed',
    'owner_removed',
    'ownership_transferred',
    'all_managers_removed',
    'author_changed'
  )),
  -- The person whose access changed (no FK: history outlives the account).
  subject_user_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'user')),
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint access_events_actor_check check (actor_kind = 'admin' or actor_user_id is not null)
);

create index if not exists access_events_entity_idx on public.access_events (entity_type, entity_id, created_at desc);

alter table public.access_events enable row level security;
revoke all on table public.access_events from anon, authenticated;
grant all on table public.access_events to service_role;
