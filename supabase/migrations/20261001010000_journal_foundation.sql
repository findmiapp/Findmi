-- ============================================================================
-- Journal V1 foundation — three new tables + one new private Storage bucket.
-- Touches nothing else. Fully additive.
--
-- Canonical owner: public.profiles.id === auth.users.id (see
-- 20260901010000_account_foundation.sql) — a Journal Entry is owned by
-- user_id referencing auth.users(id) directly, the same identifier every
-- account_saved_*/account_followed_* table already uses (see
-- 20260901020000_account_saved_and_followed.sql), never a second user
-- identity concept.
--
-- PRIVATE MEDIA CHECKPOINT — audited before writing this migration: the
-- only Storage bucket in production use (`findmi-media`, see
-- lib/admin/upload.ts / account/business/actions.ts / account/location/
-- actions.ts / account/event/actions.ts) is fully public — getPublicUrl()
-- only, zero createSignedUrl()/signed-URL usage anywhere in this codebase.
-- A Journal Entry marked PRIVATE needs photos that are genuinely not
-- reachable by a predictable public URL, so this migration creates a
-- SEPARATE, non-public bucket (`journal-media`) rather than reusing
-- `findmi-media` or faking privacy by hiding the page while the images
-- stay public. No storage.objects RLS policy is added for either role:
-- every write goes through the service-role client (getAdminSupabase(),
-- same convention as findmi-media's own uploads), which bypasses Storage
-- RLS entirely, and every READ is issued server-side via a short-lived
-- signed URL (storage.createSignedUrl / createSignedUrls) generated only
-- AFTER the caller's access to the owning journal_entries row has already
-- been confirmed via the table-level RLS below — so there is no path for
-- an anon or authenticated client to reach a private object directly, with
-- or without a storage policy. This two-layer design (table RLS gates
-- which rows/paths are ever visible to a given caller; the bucket's own
-- non-public flag means knowing a path alone is never enough) also means a
-- PRIVATE <-> PUBLIC visibility change needs no migration of files between
-- buckets — only journal_entries.visibility changes, and every future
-- signed-URL request re-evaluates it live.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. journal_entries
-- ----------------------------------------------------------------------------
-- entry_date + entry_time (a single optional time-of-day), not a start_at/
-- end_at pair — matches the actual Create flow's Step 1 fields (date,
-- optional time) exactly; Journal V1 has no "end time" concept anywhere in
-- its UI, so no end_at column is added merely because it might be useful
-- later. location_id is a direct nullable FK (Step 2 only ever lets a
-- visitor pick ONE Location) rather than a connections-table row — Business/
-- Product/Event (Step 3, multi-select) are the ones that need the
-- connections table below. No primary_event_occurrence_id/
-- primary_appearance_id column: V1's Create flow never captures either (no
-- occurrence/appearance picker is exposed to a consumer — see Step 3's own
-- "a normal consumer should not have to understand Event vs occurrence vs
-- Appearance" instruction), so neither field would ever be set; both can be
-- added additively later without breaking this schema.
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  entry_date date not null,
  entry_time time,
  notes text,
  location_id uuid references public.locations(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

-- Owner: full read of own rows regardless of visibility/status (drafts
-- included — a draft is never visible to anyone else, published or not).
create policy "journal_entries_select_own"
  on public.journal_entries for select
  to authenticated
  using (auth.uid() = user_id);

-- Everyone else (including anonymous, including another signed-in user):
-- only a published, public entry. A draft is never readable by anyone but
-- its owner, public or not.
create policy "journal_entries_select_public"
  on public.journal_entries for select
  to anon, authenticated
  using (visibility = 'public' and status = 'published');

create policy "journal_entries_insert_own"
  on public.journal_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "journal_entries_update_own"
  on public.journal_entries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "journal_entries_delete_own"
  on public.journal_entries for delete
  to authenticated
  using (auth.uid() = user_id);

create trigger trg_journal_entries_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- Supports the Journal Index ("my own entries", entry_date desc) and the
-- Index's optional Places/Brands/Events/Products filter pills.
create index if not exists journal_entries_user_id_idx on public.journal_entries (user_id, entry_date desc);
create index if not exists journal_entries_visibility_status_idx on public.journal_entries (visibility, status, entry_date desc);
create index if not exists journal_entries_location_id_idx on public.journal_entries (location_id) where location_id is not null;

-- ----------------------------------------------------------------------------
-- 2. journal_entry_media
-- ----------------------------------------------------------------------------
-- IMAGE ONLY for V1 (no video infrastructure). storage_path is a path
-- inside the private `journal-media` bucket, never a full URL — a signed
-- URL is generated on read, never stored. No per-photo `category` column:
-- audited against Step 1's own upload UI (no per-photo categorization
-- control) and the Detail page's "Photo Story" concept — adding one would
-- mean building a selector in Create AND four conditionally-rendered
-- gallery groups in Detail for a V1 that ships with one strong editorial
-- gallery instead; the column can be added later without migrating
-- existing rows (a null category simply groups with "everything else").
create table if not exists public.journal_entry_media (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  storage_path text not null,
  display_order integer not null default 0,
  is_cover boolean not null default false,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.journal_entry_media enable row level security;

create policy "journal_entry_media_select_own"
  on public.journal_entry_media for select
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create policy "journal_entry_media_select_public"
  on public.journal_entry_media for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.journal_entries je
      where je.id = journal_entry_id and je.visibility = 'public' and je.status = 'published'
    )
  );

-- Mutation requires ownership of the PARENT entry, never a client-supplied
-- journal_entry_id trusted at face value — every insert/update/delete this
-- app performs is additionally re-validated server-side in the owning
-- Server Action (see lib/journal.ts), this is the defense-in-depth layer.
create policy "journal_entry_media_insert_own"
  on public.journal_entry_media for insert
  to authenticated
  with check (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create policy "journal_entry_media_update_own"
  on public.journal_entry_media for update
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()))
  with check (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create policy "journal_entry_media_delete_own"
  on public.journal_entry_media for delete
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

-- At most one cover photo per entry.
create unique index if not exists journal_entry_media_one_cover_idx on public.journal_entry_media (journal_entry_id) where is_cover;
create index if not exists journal_entry_media_entry_order_idx on public.journal_entry_media (journal_entry_id, display_order);

-- ----------------------------------------------------------------------------
-- 3. journal_entry_connections
-- ----------------------------------------------------------------------------
-- A constrained unified connection table (one row = one real Findmi object
-- connected to one Journal Entry), not a polymorphic object_type+object_id
-- pair — each column is a genuine FK to its own table, so referential
-- integrity is enforced by Postgres itself rather than trusted application
-- logic, and a deleted Business/Product/Event cleanly removes just that
-- connection row (never the Journal Entry itself). location_id is NOT
-- included here — that's journal_entries.location_id directly (see above),
-- since Step 2 only ever supports one Location per entry. No event_
-- occurrence_id/appearance_id columns in V1 for the same reason given on
-- journal_entries above.
create table if not exists public.journal_entry_connections (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint journal_entry_connections_exactly_one_object check (
    (case when business_id is not null then 1 else 0 end) +
    (case when product_id is not null then 1 else 0 end) +
    (case when event_id is not null then 1 else 0 end) = 1
  )
);

alter table public.journal_entry_connections enable row level security;

create policy "journal_entry_connections_select_own"
  on public.journal_entry_connections for select
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create policy "journal_entry_connections_select_public"
  on public.journal_entry_connections for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.journal_entries je
      where je.id = journal_entry_id and je.visibility = 'public' and je.status = 'published'
    )
  );

-- A user may connect THEIR OWN Journal Entry to any legitimate, existing
-- Findmi object — they never need to own that Business/Product/Event.
-- Ownership of the referenced object is never checked (nor should it be);
-- only ownership of the Journal Entry itself gates the mutation, and the
-- object id's mere existence is enforced by the FK columns above (an
-- invalid/nonexistent id is rejected by Postgres before RLS is even
-- relevant).
create policy "journal_entry_connections_insert_own"
  on public.journal_entry_connections for insert
  to authenticated
  with check (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create policy "journal_entry_connections_delete_own"
  on public.journal_entry_connections for delete
  to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_entry_id and je.user_id = auth.uid()));

create index if not exists journal_entry_connections_entry_idx on public.journal_entry_connections (journal_entry_id);
create unique index if not exists journal_entry_connections_business_uidx on public.journal_entry_connections (journal_entry_id, business_id) where business_id is not null;
create unique index if not exists journal_entry_connections_product_uidx on public.journal_entry_connections (journal_entry_id, product_id) where product_id is not null;
create unique index if not exists journal_entry_connections_event_uidx on public.journal_entry_connections (journal_entry_id, event_id) where event_id is not null;
-- Supports the future "public Journal Entries connected to Business/
-- Product/Event X" surfacing queries this pass must architect for but not
-- render yet.
create index if not exists journal_entry_connections_business_lookup_idx on public.journal_entry_connections (business_id) where business_id is not null;
create index if not exists journal_entry_connections_product_lookup_idx on public.journal_entry_connections (product_id) where product_id is not null;
create index if not exists journal_entry_connections_event_lookup_idx on public.journal_entry_connections (event_id) where event_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Storage — private journal-media bucket
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('journal-media', 'journal-media', false)
on conflict (id) do nothing;
