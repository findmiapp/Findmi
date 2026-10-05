-- ============================================================================
-- Moments V2, Pass 1 — optional photo sections (foundation only)
--
-- Purely additive. No existing row is updated, no section is created for
-- any existing Moment, and there is no default/implicit "Photos" section:
--
--   journal_entry_sections        one optional, owner-authored group of
--                                 photos within a Moment (type, optional
--                                 title, optional note, order).
--   journal_entry_media.section_id NULL = unsectioned. Every existing photo
--                                 stays NULL, so every existing Moment
--                                 remains exactly the flat gallery it is.
--
-- section_type is deliberately plain `text not null` with NO enumerating
-- CHECK constraint — the V1 taxonomy is defined and validated in the app
-- (src/lib/journal-sections.ts) while it's still being validated, so it
-- can grow without a migration.
--
-- A photo can only reference a section of its OWN Moment: the composite FK
-- (section_id, journal_entry_id) -> journal_entry_sections(id,
-- journal_entry_id) enforces that in Postgres itself. Deleting a section
-- never deletes photos — ON DELETE SET NULL (section_id) clears ONLY
-- section_id (column-list form, Postgres 15+; production is 17.x), never
-- journal_entry_id.
--
-- Cover stays one explicit is_cover per Moment (journal_entry_media_one_
-- cover_idx, unchanged). Photo order stays one global display_order per
-- Moment, flattened as: section 1's photos, section 2's, …, then
-- unsectioned photos (maintained by the app's layout action).
-- ============================================================================

create table if not exists public.journal_entry_sections (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  section_type text not null,
  title text null,
  notes text null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_entry_sections_title_length check (title is null or char_length(title) <= 80),
  constraint journal_entry_sections_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint journal_entry_sections_id_entry_key unique (id, journal_entry_id)
);

create index if not exists journal_entry_sections_entry_order_idx
  on public.journal_entry_sections (journal_entry_id, display_order);

drop trigger if exists trg_journal_entry_sections_updated_at on public.journal_entry_sections;
create trigger trg_journal_entry_sections_updated_at
  before update on public.journal_entry_sections
  for each row execute function public.set_updated_at();

alter table public.journal_entry_sections enable row level security;

-- Same ownership / public-read model as journal_entry_media.
drop policy if exists "journal_entry_sections_select_own" on public.journal_entry_sections;
create policy "journal_entry_sections_select_own"
  on public.journal_entry_sections for select
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

drop policy if exists "journal_entry_sections_select_public" on public.journal_entry_sections;
create policy "journal_entry_sections_select_public"
  on public.journal_entry_sections for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.journal_entries je
      where je.id = journal_entry_id and je.visibility = 'public' and je.status = 'published'
    )
  );

drop policy if exists "journal_entry_sections_insert_own" on public.journal_entry_sections;
create policy "journal_entry_sections_insert_own"
  on public.journal_entry_sections for insert
  to authenticated
  with check (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

drop policy if exists "journal_entry_sections_update_own" on public.journal_entry_sections;
create policy "journal_entry_sections_update_own"
  on public.journal_entry_sections for update
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()))
  with check (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

drop policy if exists "journal_entry_sections_delete_own" on public.journal_entry_sections;
create policy "journal_entry_sections_delete_own"
  on public.journal_entry_sections for delete
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

-- Photo section membership — nullable, no backfill.
alter table public.journal_entry_media
  add column if not exists section_id uuid null;

alter table public.journal_entry_media drop constraint if exists journal_entry_media_section_fk;
alter table public.journal_entry_media
  add constraint journal_entry_media_section_fk
  foreign key (section_id, journal_entry_id)
  references public.journal_entry_sections (id, journal_entry_id)
  on delete set null (section_id);

create index if not exists journal_entry_media_section_idx
  on public.journal_entry_media (section_id)
  where section_id is not null;

-- Caption guard (the app caps captions at 280; this is only a backstop).
-- No production caption is populated today, so this validates trivially.
alter table public.journal_entry_media drop constraint if exists journal_entry_media_caption_length;
alter table public.journal_entry_media
  add constraint journal_entry_media_caption_length
  check (caption is null or char_length(caption) <= 500);
