-- ============================================================================
-- Personal Library — Collections: optional, user-created organizational
-- buckets ("Christmas Gifts", "Apartment Art", "NYC Marathon Weekend").
--
-- Three independent concepts, three owners:
--   Relationship  what it means to me — product_wants (Product Want, the ONE
--                 canonical Product Want) and user_entity_relationships
--                 (Have / Been / Must Do / Event & Place Want …)
--   Save          a plain bookmark — account_saved_* (unchanged)
--   Collection    how I organize it — THIS migration
-- A Collection never reads or writes relationship or Save state: adding an
-- item to "Christmas Gifts" doesn't Want or Save it, and un-Wanting or
-- un-Saving never removes it from a Collection.
--
-- Items are polymorphic (product / event / location / business), keyed by
-- (collection, entity_type, entity_id) so an item appears once per
-- Collection. No FK to the entity tables (same pattern as
-- user_entity_relationships); readers resolve through each entity's own
-- public read rules, so a retired entity simply stops rendering.
--
-- Privacy: Collections are private to their owner. RLS: own rows only;
-- items are reachable only through a Collection the caller owns.
--
-- Additive only: two new tables, indexes, policies. No existing row is
-- read, copied or modified.
-- ============================================================================

create table if not exists public.user_collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_collections_name_len check (length(btrim(name)) between 1 and 60)
);

-- One Collection per name per person (case-insensitive).
create unique index if not exists user_collections_user_name_unique on public.user_collections (user_id, lower(btrim(name)));

create table if not exists public.user_collection_items (
  collection_id  uuid not null references public.user_collections (id) on delete cascade,
  entity_type    text not null,
  entity_id      uuid not null,
  created_at     timestamptz not null default now(),
  primary key (collection_id, entity_type, entity_id),
  constraint user_collection_items_type_check check (entity_type in ('product', 'event', 'location', 'business'))
);

create index if not exists user_collection_items_entity_idx on public.user_collection_items (entity_type, entity_id);

alter table public.user_collections enable row level security;
alter table public.user_collection_items enable row level security;
revoke all on public.user_collections from anon, authenticated;
revoke all on public.user_collection_items from anon, authenticated;
grant select, insert, update, delete on public.user_collections to authenticated;
grant select, insert, delete on public.user_collection_items to authenticated;
grant all on public.user_collections to service_role;
grant all on public.user_collection_items to service_role;

drop policy if exists "Own collections" on public.user_collections;
create policy "Own collections" on public.user_collections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Own collection items read" on public.user_collection_items;
create policy "Own collection items read" on public.user_collection_items
  for select to authenticated
  using (exists (select 1 from public.user_collections c where c.id = collection_id and c.user_id = auth.uid()));
drop policy if exists "Own collection items insert" on public.user_collection_items;
create policy "Own collection items insert" on public.user_collection_items
  for insert to authenticated
  with check (exists (select 1 from public.user_collections c where c.id = collection_id and c.user_id = auth.uid()));
drop policy if exists "Own collection items delete" on public.user_collection_items;
create policy "Own collection items delete" on public.user_collection_items
  for delete to authenticated
  using (exists (select 1 from public.user_collections c where c.id = collection_id and c.user_id = auth.uid()));

comment on table public.user_collections is
  'Personal Library Collections — private, user-created organization. Independent of relationships (product_wants, user_entity_relationships) and Saves (account_saved_*).';
