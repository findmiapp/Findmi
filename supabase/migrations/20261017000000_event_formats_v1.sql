-- Findmi Event Formats V1 — HOW an Event is experienced (zero-to-many),
-- separate from Event Category/Subcategory (WHAT it is about).
--
--   * Vocabulary: rows in the shared public.categories table with the new
--     kind 'event_format' — flat (never a parent or a child).
--   * Relationship: its OWN join table public.event_formats — Formats are
--     never stored in event_categories, and event_formats only ever links
--     kind='event_format' rows (enforced below).
--   * Seeds the 16 approved Formats. No Event is assigned a Format here.
--
-- Additive: one CHECK widened (existing values kept), one table, two
-- integrity triggers, one read policy, 16 vocabulary rows. Re-runnable.
-- ============================================================================

-- ── 1. Allow the new kind ───────────────────────────────────────────────
alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories add constraint categories_kind_check
  check (kind in ('business', 'event', 'product', 'location', 'event_format'));

-- ── 2. Formats are flat, and an in-use Format can't change kind ─────────
create or replace function public.enforce_event_format_category()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.kind = 'event_format' and new.parent_id is not null then
    raise exception 'an Event Format cannot have a parent category';
  end if;
  if tg_op = 'UPDATE' and old.kind = 'event_format' and new.kind <> 'event_format'
     and exists (select 1 from public.event_formats f where f.category_id = old.id) then
    raise exception 'Event Format % is in use and cannot change kind', old.id;
  end if;
  return new;
end;
$$;

-- ── 3. Event ↔ Format ───────────────────────────────────────────────────
create table if not exists public.event_formats (
  event_id    uuid not null references public.events (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, category_id)
);

-- Filtering by Format (category_id → event_id); the primary key already
-- serves lookups by Event.
create index if not exists event_formats_category_id_idx on public.event_formats (category_id);

-- Only kind='event_format' rows can be linked.
create or replace function public.enforce_event_format_link()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.kind = 'event_format') then
    raise exception 'category % is not an Event Format', new.category_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_formats_kind on public.event_formats;
create trigger trg_event_formats_kind
  before insert or update on public.event_formats
  for each row execute function public.enforce_event_format_link();

-- Created after event_formats exists (the function body references it).
drop trigger if exists trg_categories_event_format on public.categories;
create trigger trg_categories_event_format
  before insert or update on public.categories
  for each row execute function public.enforce_event_format_category();

-- Public read, like event_categories; writes only through the server's
-- trusted (service-role) Event edit/import paths.
alter table public.event_formats enable row level security;
revoke all on public.event_formats from anon, authenticated;
grant select on public.event_formats to anon, authenticated;
grant all on public.event_formats to service_role;
drop policy if exists "Public read event formats" on public.event_formats;
create policy "Public read event formats" on public.event_formats for select using (true);

-- ── 4. The 16 approved Formats ──────────────────────────────────────────
insert into public.categories (name, slug, kind) values
  ('Brand Activation', 'brand-activation', 'event_format'),
  ('Pop-Up', 'pop-up', 'event_format'),
  ('Sampling', 'sampling', 'event_format'),
  ('Product Launch', 'product-launch', 'event_format'),
  ('Retail Experience', 'retail-experience', 'event_format'),
  ('Sample Sale', 'sample-sale', 'event_format'),
  ('Market', 'market', 'event_format'),
  ('Festival', 'festival', 'event_format'),
  ('Networking', 'networking', 'event_format'),
  ('Talk & Panel', 'talk-panel', 'event_format'),
  ('Workshop', 'workshop', 'event_format'),
  ('Conference', 'conference', 'event_format'),
  ('Exhibition', 'exhibition', 'event_format'),
  ('Immersive Experience', 'immersive-experience', 'event_format'),
  ('Performance', 'performance', 'event_format'),
  ('Party & Social', 'party-social', 'event_format')
on conflict (kind, slug) do nothing;
