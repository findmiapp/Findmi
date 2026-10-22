-- Findmi Here — multiple relationships per place, Product Sets, and the
-- foundation for importing existing Locations.
--
-- Three closely related additions to the availability model, in one migration
-- because they share one table and one rollout:
--
--   1. RELATIONSHIPS   One Business + one Location stays ONE availability row.
--                      `relationships` (text[]) holds every way the Business is
--                      there: stocked / sold / served / featured / sampled, in
--                      any combination. The legacy single `relationship`
--                      column is kept and mirrored (= the first relationship),
--                      so the app that is deployed today keeps reading and
--                      writing it unchanged while this migration is applied.
--
--   2. PRODUCT SETS    Named, reusable groups of a Business's own Products
--                      ("Tabli Core Assortment"). A convenience/template layer
--                      only: applying one fills the Products selection and the
--                      entry still saves the real Products
--                      (business_location_availability_products), so no public
--                      query ever reads a Set.
--
--   3. IMPORT          location_import_batches / location_import_rows stage a
--                      locator import (CSV now; any source adapter later) so
--                      nothing is created before it is matched and reviewed;
--                      `external_source` + `external_id` on the availability
--                      row preserve source identity so importing the same
--                      locator again UPDATES instead of duplicating.
--
-- Additive: new defaulted columns, new tables, triggers, indexes. The only data
-- write is the one-time backfill of `relationships` from `relationship`
-- (every existing row keeps exactly its current meaning). Every new table has
-- RLS enabled with NO anon/authenticated policy — they are read and written
-- only through server code with the service-role key, after the caller is
-- authorized as an owner/manager of the Business.

-- ── 1. Relationships ───────────────────────────────────────────────────────
alter table public.business_location_availability
  add column if not exists relationships text[] not null default '{}';

update public.business_location_availability
   set relationships = array[relationship]
 where cardinality(relationships) = 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_relationships_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_relationships_check
      check (
        cardinality(relationships) between 1 and 5
        and relationships <@ array['stocked', 'sold', 'served', 'featured', 'sampled']::text[]
      );
  end if;
end $$;

-- Keeps `relationships` canonical (known values only, de-duplicated, in the
-- fixed order stocked → sold → served → featured → sampled) and the legacy
-- `relationship` column mirrored to its first value. Also lets an older
-- writer that only knows `relationship` keep working: an INSERT that leaves
-- `relationships` empty, or an UPDATE that changes only `relationship`, is
-- translated into the one-element array.
create or replace function public.business_location_availability_relationships_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.relationships is null or cardinality(new.relationships) = 0 then
    new.relationships := array[new.relationship];
  elsif tg_op = 'UPDATE'
        and new.relationship is distinct from old.relationship
        and new.relationships is not distinct from old.relationships then
    new.relationships := array[new.relationship];
  end if;

  new.relationships := coalesce((
    select array_agg(r order by array_position(array['stocked', 'sold', 'served', 'featured', 'sampled']::text[], r))
      from (select distinct unnest(new.relationships) as r) q
     where r = any (array['stocked', 'sold', 'served', 'featured', 'sampled']::text[])
  ), '{}');

  if cardinality(new.relationships) > 0 then
    new.relationship := new.relationships[1];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_location_availability_relationships_sync on public.business_location_availability;
create trigger trg_business_location_availability_relationships_sync
  before insert or update on public.business_location_availability
  for each row execute function public.business_location_availability_relationships_sync();

-- ── 2. Source identity (repeat imports update, never duplicate) ────────────
alter table public.business_location_availability
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists import_batch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_external_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_external_check
      check (
        (external_source is null) = (external_id is null)
        and (external_source is null or external_source ~ '^[a-z0-9_]{2,40}$')
        and (external_id is null or char_length(external_id) between 1 and 200)
      );
  end if;
end $$;

-- One row per (Business, source, source id): the identity a repeat import
-- matches on before it looks at addresses at all.
create unique index if not exists business_location_availability_external_uidx
  on public.business_location_availability (business_id, external_source, external_id)
  where external_id is not null;

-- ── 3. Product Sets ────────────────────────────────────────────────────────
create table if not exists public.business_product_sets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists business_product_sets_name_uidx
  on public.business_product_sets (business_id, lower(btrim(name)));

create table if not exists public.business_product_set_items (
  set_id     uuid not null references public.business_product_sets(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (set_id, product_id)
);

create index if not exists business_product_set_items_product_idx
  on public.business_product_set_items (product_id);

-- A Set only ever holds its own Business's Products.
create or replace function public.business_product_set_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.business_product_sets s
      join public.products p on p.business_id = s.business_id
     where s.id = new.set_id and p.id = new.product_id
  ) then
    raise exception 'business_product_set_items: the product must belong to the same Business as the set'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_product_set_items_guard on public.business_product_set_items;
create trigger trg_business_product_set_items_guard
  before insert or update on public.business_product_set_items
  for each row execute function public.business_product_set_items_guard();

drop trigger if exists trg_business_product_sets_updated_at on public.business_product_sets;
create trigger trg_business_product_sets_updated_at
  before update on public.business_product_sets
  for each row execute function public.set_updated_at();

-- ── 4. Locator import staging ──────────────────────────────────────────────
create table if not exists public.location_import_batches (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  -- The adapter that produced the rows: 'csv' today; 'storepoint', 'json', …
  -- later feed the same pipeline.
  source             text not null default 'csv' check (source ~ '^[a-z0-9_]{2,40}$'),
  source_label       text check (source_label is null or char_length(source_label) <= 200),
  status             text not null default 'staged'
                       check (status in ('staged', 'matched', 'importing', 'completed', 'failed', 'cancelled')),
  mapping            jsonb not null default '{}'::jsonb,
  counts             jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);

create index if not exists location_import_batches_business_idx
  on public.location_import_batches (business_id, created_at desc);

create table if not exists public.location_import_rows (
  id                     uuid primary key default gen_random_uuid(),
  batch_id               uuid not null references public.location_import_batches(id) on delete cascade,
  row_number             integer not null check (row_number >= 1),
  external_id            text check (external_id is null or char_length(external_id) between 1 and 200),
  -- The normalized Findmi fields read from the source row.
  data                   jsonb not null,
  match_status           text not null default 'pending'
                           check (match_status in ('pending', 'existing', 'possible', 'new', 'invalid', 'duplicate')),
  matched_location_id    uuid references public.locations(id) on delete set null,
  candidate_location_ids uuid[] not null default '{}',
  problem                text check (problem is null or char_length(problem) <= 300),
  -- The Business's review decision; null = take the default for the status.
  decision               text check (decision in ('use_match', 'create_new', 'skip')),
  chosen_location_id     uuid references public.locations(id) on delete set null,
  outcome                text check (outcome in ('linked', 'created', 'updated', 'skipped', 'failed')),
  outcome_note           text check (outcome_note is null or char_length(outcome_note) <= 300),
  availability_id        uuid references public.business_location_availability(id) on delete set null,
  unique (batch_id, row_number)
);

create index if not exists location_import_rows_status_idx on public.location_import_rows (batch_id, match_status, row_number);
create index if not exists location_import_rows_external_idx on public.location_import_rows (batch_id, external_id) where external_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_import_batch_fkey') then
    alter table public.business_location_availability
      add constraint business_location_availability_import_batch_fkey
      foreign key (import_batch_id) references public.location_import_batches(id) on delete set null;
  end if;
end $$;

drop trigger if exists trg_location_import_batches_updated_at on public.location_import_batches;
create trigger trg_location_import_batches_updated_at
  before update on public.location_import_batches
  for each row execute function public.set_updated_at();

-- ── Access: service role only ──────────────────────────────────────────────
alter table public.business_product_sets enable row level security;
alter table public.business_product_set_items enable row level security;
alter table public.location_import_batches enable row level security;
alter table public.location_import_rows enable row level security;

revoke all on public.business_product_sets from anon, authenticated;
revoke all on public.business_product_set_items from anon, authenticated;
revoke all on public.location_import_batches from anon, authenticated;
revoke all on public.location_import_rows from anon, authenticated;
grant all on public.business_product_sets to service_role;
grant all on public.business_product_set_items to service_role;
grant all on public.location_import_batches to service_role;
grant all on public.location_import_rows to service_role;
