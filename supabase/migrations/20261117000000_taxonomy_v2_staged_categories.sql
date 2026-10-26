-- Taxonomy V2 — Pass 2: staged Category trees, legacy → V2 mapping,
-- deterministic backfill.
--
-- Mirrors src/lib/taxonomy/v2.ts (trees) and src/lib/taxonomy/v2-legacy.ts
-- (mappings) — the generated section below comes from
-- scripts/taxonomy-v2-pass2-sql.mjs.
--
-- WHAT THIS DOES
--   1. Stages the V2 Category trees. New V2 rows go into public.categories
--      with status 'staged'; live V1 rows with the same meaning are REUSED
--      unchanged. Tree structure lives in public.category_tree_v2 (never in
--      parent_id), so a V1 row can join the V2 tree under a new parent
--      without any V1 change.
--   2. Keeps staged rows invisible to every V1 reader:
--        * the public read policy on categories hides staged rows from
--          anon / authenticated (all public + owner reads, including
--          embedded joins);
--        * service-role V1 readers exclude them in code;
--        * a guard makes it impossible for any V1 reference (the V1
--          joins, locations.category_id) to point at a staged row.
--   3. Records every V1 category / Event Format → V2 mapping with a
--      per-target confidence (taxonomy_legacy_mappings, still 'draft':
--      nothing redirects or rewrites URLs).
--   4. Backfills ONLY deterministic facts into V2-only tables (source
--      'migration'); everything plausible-but-unproven becomes a
--      classification_suggestions row, which never powers discovery.
--
-- WHAT THIS DOES NOT DO
--   No V1 row, V1 join, V1 column or URL changes. No deletion of
--   pre-existing data. events.audience / benefits / entry_modes are read by
--   the live V1 Map, so even deterministic entry modes are staged as
--   suggestions here. locations.hours stays the live hours source.
--
-- The ONE existing-object change: the "Public read categories" policy
-- gains `status <> 'staged'` (every current row is 'active', so V1 reads
-- are identical). Idempotent: re-running is a no-op.

begin;

-- ================================================================ 1. staged rows are invisible to V1

alter policy "Public read categories" on public.categories using (status <> 'staged');

-- No V1 reference may ever point at a staged row. TG_ARGV[0] = column.
-- SECURITY DEFINER: the owner/anon writer cannot see staged rows itself.
create or replace function public.categories_v1_reference_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if v_id is not null and exists (select 1 from public.categories c where c.id = v_id and c.status = 'staged') then
    raise exception 'staged Taxonomy V2 categories cannot be used by V1 classifications' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.categories_v1_reference_guard() from public, anon, authenticated;

drop trigger if exists business_categories_v1_guard on public.business_categories;
create trigger business_categories_v1_guard before insert or update on public.business_categories for each row execute function public.categories_v1_reference_guard('category_id');
drop trigger if exists event_categories_v1_guard on public.event_categories;
create trigger event_categories_v1_guard before insert or update on public.event_categories for each row execute function public.categories_v1_reference_guard('category_id');
drop trigger if exists event_formats_v1_guard on public.event_formats;
create trigger event_formats_v1_guard before insert or update on public.event_formats for each row execute function public.categories_v1_reference_guard('category_id');
drop trigger if exists product_categories_v1_guard on public.product_categories;
create trigger product_categories_v1_guard before insert or update on public.product_categories for each row execute function public.categories_v1_reference_guard('category_id');
drop trigger if exists locations_category_v1_guard on public.locations;
create trigger locations_category_v1_guard before insert or update of category_id on public.locations for each row execute function public.categories_v1_reference_guard('category_id');

-- ================================================================ 2. the V2 tree (structure separate from V1 parent_id)

create table if not exists public.category_tree_v2 (
  category_id uuid primary key references public.categories (id) on delete restrict,
  kind text not null check (kind in ('business', 'location', 'event', 'product')),
  parent_category_id uuid references public.category_tree_v2 (category_id) on delete restrict,
  depth smallint not null default 1 check (depth between 1 and 3),
  -- The V2 label where it differs from the row's V1 name (applied at the
  -- read switch; NULL = the row's own name).
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists category_tree_v2_parent_idx on public.category_tree_v2 (parent_category_id);
create index if not exists category_tree_v2_kind_idx on public.category_tree_v2 (kind);

-- Same kind as the row and its parent; depth within the kind's limit
-- (Event Domains are one level); no cycles.
create or replace function public.category_tree_v2_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_kind text;
  v_parent public.category_tree_v2%rowtype;
  v_max smallint;
begin
  select c.kind into v_kind from public.categories c where c.id = new.category_id;
  if v_kind is distinct from new.kind then
    raise exception 'category_tree_v2.kind must match the category' using errcode = '23514';
  end if;
  v_max := case new.kind when 'event' then 1 when 'business' then 2 else 3 end;
  if new.parent_category_id is null then
    new.depth := 1;
  else
    select * into v_parent from public.category_tree_v2 t where t.category_id = new.parent_category_id;
    if v_parent.kind is distinct from new.kind then
      raise exception 'a V2 parent must be the same kind' using errcode = '23514';
    end if;
    if new.parent_category_id = new.category_id or exists (
      with recursive up(id, n) as (
        select v_parent.parent_category_id, 1
        union all
        select t.parent_category_id, up.n + 1 from public.category_tree_v2 t join up on t.category_id = up.id where up.n < 8
      )
      select 1 from up where up.id = new.category_id
    ) then
      raise exception 'V2 category tree cycle' using errcode = '23514';
    end if;
    new.depth := v_parent.depth + 1;
  end if;
  if new.depth > v_max then
    raise exception '% categories are at most % level(s) deep', new.kind, v_max using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists category_tree_v2_guard on public.category_tree_v2;
create trigger category_tree_v2_guard before insert or update on public.category_tree_v2 for each row execute function public.category_tree_v2_guard();

-- ================================================================ 3. V2 category assignments (V2-only tables)
-- V1 joins stay V1: V1 readers embed them, so a V2 (possibly staged)
-- category written there would leak. Locations already have the V2-only
-- public.location_categories (Pass 1).

create table if not exists public.business_category_assignments (
  business_id uuid not null references public.businesses (id) on delete cascade,
  category_id uuid not null,
  category_kind text not null default 'business' check (category_kind = 'business'),
  is_primary boolean not null default false,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (business_id, category_id),
  foreign key (category_id, category_kind) references public.categories (id, kind) on delete cascade
);
create table if not exists public.event_category_assignments (
  event_id uuid not null references public.events (id) on delete cascade,
  category_id uuid not null,
  category_kind text not null default 'event' check (category_kind = 'event'),
  is_primary boolean not null default false,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (event_id, category_id),
  foreign key (category_id, category_kind) references public.categories (id, kind) on delete cascade
);
create table if not exists public.product_category_assignments (
  product_id uuid not null references public.products (id) on delete cascade,
  category_id uuid not null,
  category_kind text not null default 'product' check (category_kind = 'product'),
  is_primary boolean not null default false,
  source text not null check (source in ('migration', 'importer', 'admin', 'owner', 'suggestion')),
  created_at timestamptz not null default now(),
  primary key (product_id, category_id),
  foreign key (category_id, category_kind) references public.categories (id, kind) on delete cascade
);
create unique index if not exists business_category_assignments_one_primary_idx on public.business_category_assignments (business_id) where is_primary;
create unique index if not exists event_category_assignments_one_primary_idx on public.event_category_assignments (event_id) where is_primary;
create unique index if not exists product_category_assignments_one_primary_idx on public.product_category_assignments (product_id) where is_primary;
create index if not exists business_category_assignments_category_idx on public.business_category_assignments (category_id);
create index if not exists event_category_assignments_category_idx on public.event_category_assignments (category_id);
create index if not exists product_category_assignments_category_idx on public.product_category_assignments (category_id);

-- A V2 assignment may only use a member of the V2 tree.
create or replace function public.category_v2_member_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.category_tree_v2 t where t.category_id = new.category_id) then
    raise exception 'category is not part of the Taxonomy V2 tree' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.category_v2_member_guard() from public, anon, authenticated;
revoke all on function public.category_tree_v2_guard() from public, anon, authenticated;
drop trigger if exists business_category_assignments_guard on public.business_category_assignments;
create trigger business_category_assignments_guard before insert or update on public.business_category_assignments for each row execute function public.category_v2_member_guard();
drop trigger if exists event_category_assignments_guard on public.event_category_assignments;
create trigger event_category_assignments_guard before insert or update on public.event_category_assignments for each row execute function public.category_v2_member_guard();
drop trigger if exists product_category_assignments_guard on public.product_category_assignments;
create trigger product_category_assignments_guard before insert or update on public.product_category_assignments for each row execute function public.category_v2_member_guard();
drop trigger if exists location_categories_v2_guard on public.location_categories;
create trigger location_categories_v2_guard before insert or update on public.location_categories for each row execute function public.category_v2_member_guard();

-- ================================================================ 4. mapping confidence

alter table public.taxonomy_legacy_mappings add column if not exists mapping_confidence text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'taxonomy_legacy_mappings_confidence_check') then
    alter table public.taxonomy_legacy_mappings add constraint taxonomy_legacy_mappings_confidence_check check (mapping_confidence is null or mapping_confidence in ('deterministic', 'review_required', 'intentionally_unmapped'));
  end if;
end $$;
-- An intentionally unmapped row has no targets (Pass 1 required >= 1).
alter table public.taxonomy_legacy_mappings drop constraint if exists taxonomy_legacy_mappings_targets_check;
alter table public.taxonomy_legacy_mappings add constraint taxonomy_legacy_mappings_targets_check check (
  jsonb_typeof(targets) = 'array' and (jsonb_array_length(targets) > 0 or mapping_confidence = 'intentionally_unmapped')
);

-- ================================================================ 5. access: new tables are server-only

do $$
declare
  t text;
begin
  foreach t in array array['category_tree_v2', 'business_category_assignments', 'event_category_assignments', 'product_category_assignments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

comment on table public.category_tree_v2 is 'Taxonomy V2: the V2 entity Category trees (structure separate from V1 parent_id). Members are staged V2 rows or reused live V1 rows. Not read by V1.';

-- ================================================================ 6. staged trees + mappings (generated by scripts/taxonomy-v2-pass2-sql.mjs)

insert into public.categories (name, slug, kind, status, show_on_home) values
  ('Shopping & Style', 'shopping-style', 'event', 'staged', false),
  ('Outdoors & Nature', 'outdoors-nature', 'event', 'staged', false),
  ('Community & Causes', 'community-causes', 'event', 'staged', false),
  ('Food & Beverage', 'food-beverage', 'business', 'staged', false),
  ('Coffee & Tea', 'coffee-tea', 'business', 'staged', false),
  ('Bakery & Desserts', 'bakery-desserts', 'business', 'staged', false),
  ('Restaurants & Food Service', 'restaurants-food-service', 'business', 'staged', false),
  ('Packaged Food', 'packaged-food', 'business', 'staged', false),
  ('Beverages', 'beverages', 'business', 'staged', false),
  ('Alcoholic Beverages', 'alcoholic-beverages', 'business', 'staged', false),
  ('Non-Alcoholic Beverages', 'non-alcoholic-beverages', 'business', 'staged', false),
  ('Apparel', 'apparel', 'business', 'staged', false),
  ('Footwear', 'footwear', 'business', 'staged', false),
  ('Accessories', 'accessories', 'business', 'staged', false),
  ('Jewelry', 'jewelry', 'business', 'staged', false),
  ('Beauty & Personal Care', 'beauty-personal-care', 'business', 'staged', false),
  ('Skincare', 'skincare', 'business', 'staged', false),
  ('Haircare', 'haircare', 'business', 'staged', false),
  ('Cosmetics', 'cosmetics', 'business', 'staged', false),
  ('Fragrance', 'fragrance', 'business', 'staged', false),
  ('Personal Care', 'personal-care', 'business', 'staged', false),
  ('Health & Wellness', 'health-wellness', 'business', 'staged', false),
  ('Fitness', 'fitness', 'business', 'staged', false),
  ('Wellness', 'wellness', 'business', 'staged', false),
  ('Health Services', 'health-services', 'business', 'staged', false),
  ('Home & Living', 'home-living', 'business', 'staged', false),
  ('Home Goods', 'home-goods', 'business', 'staged', false),
  ('Furniture & Decor', 'furniture-decor', 'business', 'staged', false),
  ('Plants & Garden', 'plants-garden', 'business', 'staged', false),
  ('Arts & Makers', 'arts-makers', 'business', 'staged', false),
  ('Art', 'art', 'business', 'staged', false),
  ('Crafts', 'crafts', 'business', 'staged', false),
  ('Makers', 'makers', 'business', 'staged', false),
  ('Kids & Baby', 'kids-baby', 'business', 'staged', false),
  ('Baby', 'baby', 'business', 'staged', false),
  ('Kids', 'kids', 'business', 'staged', false),
  ('Toys & Play', 'toys-play', 'business', 'staged', false),
  ('Media & Entertainment', 'media-entertainment', 'business', 'staged', false),
  ('Music', 'music', 'business', 'staged', false),
  ('Film & Video', 'film-video', 'business', 'staged', false),
  ('Publishing & Books', 'publishing-books', 'business', 'staged', false),
  ('Entertainment', 'entertainment', 'business', 'staged', false),
  ('Events & Hospitality', 'events-hospitality', 'business', 'staged', false),
  ('Event Production', 'event-production', 'business', 'staged', false),
  ('Hospitality', 'hospitality', 'business', 'staged', false),
  ('Venues', 'venues', 'business', 'staged', false),
  ('Services', 'services', 'business', 'staged', false),
  ('Food & Drink', 'food-drink', 'location', 'staged', false),
  ('Bakery', 'bakery', 'location', 'staged', false),
  ('Food Hall', 'food-hall', 'location', 'staged', false),
  ('Specialty Food Shop', 'specialty-food-shop', 'location', 'staged', false),
  ('Shopping', 'shopping', 'location', 'staged', false),
  ('Boutique', 'boutique', 'location', 'staged', false),
  ('Shopping Center', 'shopping-center', 'location', 'staged', false),
  ('Market Hall', 'market-hall', 'location', 'staged', false),
  ('Arts & Culture', 'arts-culture', 'location', 'staged', false),
  ('Museum', 'museum', 'location', 'staged', false),
  ('Theater', 'theater', 'location', 'staged', false),
  ('Cinema', 'cinema', 'location', 'staged', false),
  ('Event & Community Spaces', 'event-community-spaces', 'location', 'staged', false),
  ('Convention / Exhibition Space', 'convention-exhibition-space', 'location', 'staged', false),
  ('Outdoors', 'outdoors', 'location', 'staged', false),
  ('Park', 'park', 'location', 'staged', false),
  ('Plaza', 'plaza', 'location', 'staged', false),
  ('Waterfront', 'waterfront', 'location', 'staged', false),
  ('Recreation Area', 'recreation-area', 'location', 'staged', false),
  ('Health & Wellness', 'health-wellness', 'location', 'staged', false),
  ('Wellness Studio', 'wellness-studio', 'location', 'staged', false),
  ('Hospitality', 'hospitality', 'location', 'staged', false),
  ('Work & Education', 'work-education', 'location', 'staged', false),
  ('School / Campus', 'school-campus', 'location', 'staged', false),
  ('Library', 'library', 'location', 'staged', false),
  ('Landmarks', 'landmarks', 'location', 'staged', false),
  ('Landmark / Attraction', 'landmark-attraction', 'location', 'staged', false),
  ('Food & Snacks', 'food-snacks', 'product', 'staged', false),
  ('Beverages', 'beverages', 'product', 'staged', false),
  ('Beauty & Personal Care', 'beauty-personal-care', 'product', 'staged', false),
  ('Apparel', 'apparel', 'product', 'staged', false),
  ('Accessories & Jewelry', 'accessories-jewelry', 'product', 'staged', false),
  ('Wellness', 'wellness', 'product', 'staged', false)
on conflict (kind, slug) do nothing;

do $$
begin
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'food-drink' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'food-drink'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'arts-culture' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'arts-culture'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'music-nightlife' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'music-nightlife'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'entertainment' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'entertainment'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'shopping-style' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'event', 'shopping-style'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'beauty-wellness' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'beauty-wellness'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'sports-fitness' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'sports-fitness'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'outdoors-nature' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'event', 'outdoors-nature'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'business-tech' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'business-tech'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'community-causes' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'event', 'community-causes'; end if;
  if not exists (select 1 from public.categories where kind = 'event' and slug = 'home-lifestyle' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'event', 'home-lifestyle'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'food-beverage' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'food-beverage'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'coffee-tea' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'coffee-tea'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'bakery-desserts' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'bakery-desserts'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'restaurants-food-service' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'restaurants-food-service'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'packaged-food' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'packaged-food'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'beverages' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'beverages'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'alcoholic-beverages' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'alcoholic-beverages'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'non-alcoholic-beverages' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'non-alcoholic-beverages'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'fashion-apparel' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'business', 'fashion-apparel'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'apparel' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'apparel'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'footwear' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'footwear'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'accessories' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'jewelry' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'vintage-resale' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'business', 'vintage-resale'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'beauty-personal-care' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'beauty-personal-care'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'skincare' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'skincare'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'haircare' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'haircare'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'cosmetics' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'cosmetics'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'fragrance' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'fragrance'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'personal-care' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'personal-care'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'health-wellness' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'health-wellness'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'fitness' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'fitness'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'wellness' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'wellness'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'health-services' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'health-services'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'home-living' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'home-living'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'home-goods' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'home-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'furniture-decor' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'furniture-decor'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'plants-garden' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'plants-garden'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'arts-makers' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'arts-makers'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'art' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'art'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'crafts' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'crafts'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'makers' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'makers'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'kids-baby' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'kids-baby'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'baby' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'baby'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'kids' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'kids'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'toys-play' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'toys-play'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'pets' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'business', 'pets'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'media-entertainment' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'media-entertainment'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'music' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'music'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'film-video' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'film-video'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'publishing-books' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'publishing-books'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'entertainment' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'entertainment'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'events-hospitality' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'events-hospitality'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'event-production' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'event-production'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'hospitality' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'hospitality'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'venues' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'venues'; end if;
  if not exists (select 1 from public.categories where kind = 'business' and slug = 'services' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'business', 'services'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'food-drink' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'food-drink'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'cafe-coffee-shop' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'cafe-coffee-shop'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'bakery' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'bakery'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'restaurant' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'restaurant'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'bar-lounge' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'bar-lounge'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'food-hall' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'food-hall'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'specialty-food-shop' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'specialty-food-shop'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'shopping' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'shopping'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'retail-store' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'retail-store'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'boutique' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'boutique'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'shopping-center' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'shopping-center'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'market-hall' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'market-hall'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'arts-culture' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'arts-culture'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'gallery' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'gallery'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'museum' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'museum'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'theater' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'theater'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'cinema' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'cinema'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'event-community-spaces' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'event-community-spaces'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'event-venue' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'event-venue'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'community-space' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'community-space'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'convention-exhibition-space' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'convention-exhibition-space'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'outdoors' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'outdoors'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'park' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'park'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'plaza' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'plaza'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'waterfront' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'waterfront'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'recreation-area' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'recreation-area'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'health-wellness' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'health-wellness'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'fitness-gym' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'fitness-gym'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'wellness-studio' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'wellness-studio'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'salon-spa' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'salon-spa'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'hospitality' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'hospitality'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'hotel' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'hotel'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'work-education' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'work-education'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'coworking-space' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'location', 'coworking-space'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'school-campus' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'school-campus'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'library' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'library'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'landmarks' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'landmarks'; end if;
  if not exists (select 1 from public.categories where kind = 'location' and slug = 'landmark-attraction' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'location', 'landmark-attraction'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'food-snacks' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'food-snacks'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bread-baked-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bread-baked-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'cakes-desserts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'cakes-desserts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'candy-chocolate' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'candy-chocolate'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'cookies-pastries' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'cookies-pastries'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'jams-spreads' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'jams-spreads'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pantry-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pantry-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'prepared-foods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'prepared-foods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'sauces-condiments' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'sauces-condiments'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'snacks' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'snacks'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'specialty-foods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'specialty-foods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'spices-seasonings' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'spices-seasonings'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'beverages' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'beverages'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'coffee' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'coffee'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'tea-matcha' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'tea-matcha'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'non-alcoholic-drinks' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'non-alcoholic-drinks'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'beauty-personal-care' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'beauty-personal-care'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bath-body' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bath-body'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'cosmetics' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'cosmetics'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'fragrance' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'fragrance'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'grooming' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'grooming'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'hair-care' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'hair-care'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'nail-care' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'nail-care'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'skincare' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'skincare'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'soap' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'soap'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'apparel' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'apparel'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'activewear' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'activewear'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'baby-clothing' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'baby-clothing'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'dresses' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'dresses'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'intimates-sleepwear' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'intimates-sleepwear'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'kids-clothing' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'kids-clothing'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-clothing' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-clothing'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'outerwear' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'outerwear'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pants-shorts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pants-shorts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'skirts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'skirts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'sweatshirts-hoodies' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'sweatshirts-hoodies'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'swimwear' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'swimwear'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 't-shirts-tops' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 't-shirts-tops'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'vintage-clothing' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'vintage-clothing'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'accessories-jewelry' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'accessories-jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'jewelry' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'anklets' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'anklets'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'body-jewelry' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'body-jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bracelets' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bracelets'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'brooches-pins' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'brooches-pins'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'charms-pendants' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'charms-pendants'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'earrings' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'earrings'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'fine-jewelry' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'fine-jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'necklaces' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'necklaces'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-jewelry' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-jewelry'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'rings' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'rings'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'watches' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'watches'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bags-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bags-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'backpacks' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'backpacks'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'belts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'belts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'hair-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'hair-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'handbags-purses' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'handbags-purses'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'hats-caps' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'hats-caps'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'keychains' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'keychains'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'scarves-wraps' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'scarves-wraps'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'sunglasses-eyewear' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'sunglasses-eyewear'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'tote-bags' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'tote-bags'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'travel-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'travel-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'wallets-card-holders' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'wallets-card-holders'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'home-living' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'home-living'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bath-home' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bath-home'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bedding' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bedding'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'candles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'candles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'drinkware' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'drinkware'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'furniture' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'furniture'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'garden-outdoor' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'garden-outdoor'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'home-decor' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'home-decor'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'home-fragrance' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'home-fragrance'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'kitchen-dining' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'kitchen-dining'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-home-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-home-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pillows-textiles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pillows-textiles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'plants-planters' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'plants-planters'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'storage-organization' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'storage-organization'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'wall-decor' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'wall-decor'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'art-collectibles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'art-collectibles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'collectibles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'collectibles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'digital-art' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'digital-art'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'figurines-miniatures' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'figurines-miniatures'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'illustration' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'illustration'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'memorabilia' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'memorabilia'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'mixed-media' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'mixed-media'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-art' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-art'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'paintings' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'paintings'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'photography' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'photography'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'posters' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'posters'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'prints' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'prints'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'sculpture' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'sculpture'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'craft-maker-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'craft-maker-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'ceramics-pottery' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'ceramics-pottery'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'craft-supplies' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'craft-supplies'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'crochet-knit' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'crochet-knit'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'fiber-arts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'fiber-arts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'glasswork' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'glasswork'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'handmade-soap-candles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'handmade-soap-candles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'leather-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'leather-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'metalwork' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'metalwork'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-maker-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-maker-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'patterns-kits' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'patterns-kits'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'resin-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'resin-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'woodwork' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'woodwork'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'books-media' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'books-media'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'books' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'books'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'comics' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'comics'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'digital-downloads' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'digital-downloads'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'magazines' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'magazines'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'music' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'music'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-books-media' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-books-media'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'vinyl-physical-media' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'vinyl-physical-media'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'zines' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'zines'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'stationery-paper' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'stationery-paper'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'art-prints' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'art-prints'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'calendars' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'calendars'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'gift-wrap' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'gift-wrap'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'greeting-cards' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'greeting-cards'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'invitations' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'invitations'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'journals-notebooks' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'journals-notebooks'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-paper-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-paper-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'party-paper-goods' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'party-paper-goods'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'planners' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'planners'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'stationery' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'stationery'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'stickers' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'stickers'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'kids-baby' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'kids-baby'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'baby-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'baby-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'baby-essentials' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'baby-essentials'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'baby-gifts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'baby-gifts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'educational-products' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'educational-products'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'kids-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'kids-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'kids-decor' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'kids-decor'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'nursery' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'nursery'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-kids-baby' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-kids-baby'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'toys-games' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'toys-games'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'collectible-toys' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'collectible-toys'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'dolls-figures' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'dolls-figures'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'games' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'games'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-toys-games' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-toys-games'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'outdoor-toys' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'outdoor-toys'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'plush-stuffed-animals' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'plush-stuffed-animals'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'puzzles' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'puzzles'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'sensory-toys' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'sensory-toys'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'toys' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'toys'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pets' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pets'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'bowls-feeding' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'bowls-feeding'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'collars-leashes' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'collars-leashes'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'other-pet-products' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'other-pet-products'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-accessories' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-accessories'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-beds' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-beds'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-clothing' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-clothing'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-gifts' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-gifts'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-toys' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-toys'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'pet-treats' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'pet-treats'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'wellness' and status = 'staged') then raise exception 'Taxonomy V2: expected % row %/%', 'staged', 'product', 'wellness'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'aromatherapy' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'aromatherapy'; end if;
  if not exists (select 1 from public.categories where kind = 'product' and slug = 'wellness-products' and status = 'active') then raise exception 'Taxonomy V2: expected % row %/%', 'active', 'product', 'wellness-products'; end if;
end $$;

insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Food & Drink', c.name), 10 from public.categories c where c.kind = 'event' and c.slug = 'food-drink' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Arts & Culture', c.name), 20 from public.categories c where c.kind = 'event' and c.slug = 'arts-culture' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Music & Nightlife', c.name), 30 from public.categories c where c.kind = 'event' and c.slug = 'music-nightlife' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Entertainment', c.name), 40 from public.categories c where c.kind = 'event' and c.slug = 'entertainment' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Shopping & Style', c.name), 50 from public.categories c where c.kind = 'event' and c.slug = 'shopping-style' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Beauty & Wellness', c.name), 60 from public.categories c where c.kind = 'event' and c.slug = 'beauty-wellness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Sports & Fitness', c.name), 70 from public.categories c where c.kind = 'event' and c.slug = 'sports-fitness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Outdoors & Nature', c.name), 80 from public.categories c where c.kind = 'event' and c.slug = 'outdoors-nature' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Business & Tech', c.name), 90 from public.categories c where c.kind = 'event' and c.slug = 'business-tech' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Community & Causes', c.name), 100 from public.categories c where c.kind = 'event' and c.slug = 'community-causes' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'event', null, nullif('Home & Lifestyle', c.name), 110 from public.categories c where c.kind = 'event' and c.slug = 'home-lifestyle' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Food & Beverage', c.name), 10 from public.categories c where c.kind = 'business' and c.slug = 'food-beverage' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Coffee & Tea', c.name), 20 from public.categories c where c.kind = 'business' and c.slug = 'coffee-tea' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Bakery & Desserts', c.name), 30 from public.categories c where c.kind = 'business' and c.slug = 'bakery-desserts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Restaurants & Food Service', c.name), 40 from public.categories c where c.kind = 'business' and c.slug = 'restaurants-food-service' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Packaged Food', c.name), 50 from public.categories c where c.kind = 'business' and c.slug = 'packaged-food' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Beverages', c.name), 60 from public.categories c where c.kind = 'business' and c.slug = 'beverages' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Alcoholic Beverages', c.name), 70 from public.categories c where c.kind = 'business' and c.slug = 'alcoholic-beverages' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'food-beverage'), nullif('Non-Alcoholic Beverages', c.name), 80 from public.categories c where c.kind = 'business' and c.slug = 'non-alcoholic-beverages' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Fashion & Apparel', c.name), 90 from public.categories c where c.kind = 'business' and c.slug = 'fashion-apparel' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'fashion-apparel'), nullif('Apparel', c.name), 100 from public.categories c where c.kind = 'business' and c.slug = 'apparel' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'fashion-apparel'), nullif('Footwear', c.name), 110 from public.categories c where c.kind = 'business' and c.slug = 'footwear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'fashion-apparel'), nullif('Accessories', c.name), 120 from public.categories c where c.kind = 'business' and c.slug = 'accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'fashion-apparel'), nullif('Jewelry', c.name), 130 from public.categories c where c.kind = 'business' and c.slug = 'jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'fashion-apparel'), nullif('Vintage & Resale', c.name), 140 from public.categories c where c.kind = 'business' and c.slug = 'vintage-resale' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Beauty & Personal Care', c.name), 150 from public.categories c where c.kind = 'business' and c.slug = 'beauty-personal-care' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'beauty-personal-care'), nullif('Skincare', c.name), 160 from public.categories c where c.kind = 'business' and c.slug = 'skincare' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'beauty-personal-care'), nullif('Haircare', c.name), 170 from public.categories c where c.kind = 'business' and c.slug = 'haircare' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'beauty-personal-care'), nullif('Cosmetics', c.name), 180 from public.categories c where c.kind = 'business' and c.slug = 'cosmetics' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'beauty-personal-care'), nullif('Fragrance', c.name), 190 from public.categories c where c.kind = 'business' and c.slug = 'fragrance' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'beauty-personal-care'), nullif('Personal Care', c.name), 200 from public.categories c where c.kind = 'business' and c.slug = 'personal-care' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Health & Wellness', c.name), 210 from public.categories c where c.kind = 'business' and c.slug = 'health-wellness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'health-wellness'), nullif('Fitness', c.name), 220 from public.categories c where c.kind = 'business' and c.slug = 'fitness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'health-wellness'), nullif('Wellness', c.name), 230 from public.categories c where c.kind = 'business' and c.slug = 'wellness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'health-wellness'), nullif('Health Services', c.name), 240 from public.categories c where c.kind = 'business' and c.slug = 'health-services' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Home & Living', c.name), 250 from public.categories c where c.kind = 'business' and c.slug = 'home-living' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'home-living'), nullif('Home Goods', c.name), 260 from public.categories c where c.kind = 'business' and c.slug = 'home-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'home-living'), nullif('Furniture & Decor', c.name), 270 from public.categories c where c.kind = 'business' and c.slug = 'furniture-decor' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'home-living'), nullif('Plants & Garden', c.name), 280 from public.categories c where c.kind = 'business' and c.slug = 'plants-garden' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Arts & Makers', c.name), 290 from public.categories c where c.kind = 'business' and c.slug = 'arts-makers' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'arts-makers'), nullif('Art', c.name), 300 from public.categories c where c.kind = 'business' and c.slug = 'art' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'arts-makers'), nullif('Crafts', c.name), 310 from public.categories c where c.kind = 'business' and c.slug = 'crafts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'arts-makers'), nullif('Makers', c.name), 320 from public.categories c where c.kind = 'business' and c.slug = 'makers' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Kids & Baby', c.name), 330 from public.categories c where c.kind = 'business' and c.slug = 'kids-baby' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'kids-baby'), nullif('Baby', c.name), 340 from public.categories c where c.kind = 'business' and c.slug = 'baby' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'kids-baby'), nullif('Kids', c.name), 350 from public.categories c where c.kind = 'business' and c.slug = 'kids' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'kids-baby'), nullif('Toys & Play', c.name), 360 from public.categories c where c.kind = 'business' and c.slug = 'toys-play' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Pets', c.name), 370 from public.categories c where c.kind = 'business' and c.slug = 'pets' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Media & Entertainment', c.name), 380 from public.categories c where c.kind = 'business' and c.slug = 'media-entertainment' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'media-entertainment'), nullif('Music', c.name), 390 from public.categories c where c.kind = 'business' and c.slug = 'music' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'media-entertainment'), nullif('Film & Video', c.name), 400 from public.categories c where c.kind = 'business' and c.slug = 'film-video' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'media-entertainment'), nullif('Publishing & Books', c.name), 410 from public.categories c where c.kind = 'business' and c.slug = 'publishing-books' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'media-entertainment'), nullif('Entertainment', c.name), 420 from public.categories c where c.kind = 'business' and c.slug = 'entertainment' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Events & Hospitality', c.name), 430 from public.categories c where c.kind = 'business' and c.slug = 'events-hospitality' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'events-hospitality'), nullif('Event Production', c.name), 440 from public.categories c where c.kind = 'business' and c.slug = 'event-production' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'events-hospitality'), nullif('Hospitality', c.name), 450 from public.categories c where c.kind = 'business' and c.slug = 'hospitality' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', (select c2.id from public.categories c2 where c2.kind = 'business' and c2.slug = 'events-hospitality'), nullif('Venues', c.name), 460 from public.categories c where c.kind = 'business' and c.slug = 'venues' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'business', null, nullif('Services', c.name), 470 from public.categories c where c.kind = 'business' and c.slug = 'services' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Food & Drink', c.name), 10 from public.categories c where c.kind = 'location' and c.slug = 'food-drink' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Café & Coffee Shop', c.name), 20 from public.categories c where c.kind = 'location' and c.slug = 'cafe-coffee-shop' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Bakery', c.name), 30 from public.categories c where c.kind = 'location' and c.slug = 'bakery' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Restaurant', c.name), 40 from public.categories c where c.kind = 'location' and c.slug = 'restaurant' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Bar', c.name), 50 from public.categories c where c.kind = 'location' and c.slug = 'bar-lounge' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Food Hall', c.name), 60 from public.categories c where c.kind = 'location' and c.slug = 'food-hall' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'food-drink'), nullif('Specialty Food Shop', c.name), 70 from public.categories c where c.kind = 'location' and c.slug = 'specialty-food-shop' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Shopping', c.name), 80 from public.categories c where c.kind = 'location' and c.slug = 'shopping' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'shopping'), nullif('Store', c.name), 90 from public.categories c where c.kind = 'location' and c.slug = 'retail-store' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'shopping'), nullif('Boutique', c.name), 100 from public.categories c where c.kind = 'location' and c.slug = 'boutique' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'shopping'), nullif('Shopping Center', c.name), 110 from public.categories c where c.kind = 'location' and c.slug = 'shopping-center' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'shopping'), nullif('Market Hall', c.name), 120 from public.categories c where c.kind = 'location' and c.slug = 'market-hall' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Arts & Culture', c.name), 130 from public.categories c where c.kind = 'location' and c.slug = 'arts-culture' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'arts-culture'), nullif('Gallery', c.name), 140 from public.categories c where c.kind = 'location' and c.slug = 'gallery' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'arts-culture'), nullif('Museum', c.name), 150 from public.categories c where c.kind = 'location' and c.slug = 'museum' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'arts-culture'), nullif('Theater', c.name), 160 from public.categories c where c.kind = 'location' and c.slug = 'theater' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'arts-culture'), nullif('Cinema', c.name), 170 from public.categories c where c.kind = 'location' and c.slug = 'cinema' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Event & Community Spaces', c.name), 180 from public.categories c where c.kind = 'location' and c.slug = 'event-community-spaces' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'event-community-spaces'), nullif('Event Venue', c.name), 190 from public.categories c where c.kind = 'location' and c.slug = 'event-venue' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'event-community-spaces'), nullif('Community Space', c.name), 200 from public.categories c where c.kind = 'location' and c.slug = 'community-space' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'event-community-spaces'), nullif('Convention / Exhibition Space', c.name), 210 from public.categories c where c.kind = 'location' and c.slug = 'convention-exhibition-space' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Outdoors', c.name), 220 from public.categories c where c.kind = 'location' and c.slug = 'outdoors' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'outdoors'), nullif('Park', c.name), 230 from public.categories c where c.kind = 'location' and c.slug = 'park' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'outdoors'), nullif('Plaza', c.name), 240 from public.categories c where c.kind = 'location' and c.slug = 'plaza' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'outdoors'), nullif('Waterfront', c.name), 250 from public.categories c where c.kind = 'location' and c.slug = 'waterfront' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'outdoors'), nullif('Recreation Area', c.name), 260 from public.categories c where c.kind = 'location' and c.slug = 'recreation-area' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Health & Wellness', c.name), 270 from public.categories c where c.kind = 'location' and c.slug = 'health-wellness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'health-wellness'), nullif('Gym & Fitness Studio', c.name), 280 from public.categories c where c.kind = 'location' and c.slug = 'fitness-gym' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'health-wellness'), nullif('Wellness Studio', c.name), 290 from public.categories c where c.kind = 'location' and c.slug = 'wellness-studio' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'health-wellness'), nullif('Salon & Spa', c.name), 300 from public.categories c where c.kind = 'location' and c.slug = 'salon-spa' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Hospitality', c.name), 310 from public.categories c where c.kind = 'location' and c.slug = 'hospitality' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'hospitality'), nullif('Hotel', c.name), 320 from public.categories c where c.kind = 'location' and c.slug = 'hotel' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Work & Education', c.name), 330 from public.categories c where c.kind = 'location' and c.slug = 'work-education' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'work-education'), nullif('Coworking Space', c.name), 340 from public.categories c where c.kind = 'location' and c.slug = 'coworking-space' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'work-education'), nullif('School / Campus', c.name), 350 from public.categories c where c.kind = 'location' and c.slug = 'school-campus' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'work-education'), nullif('Library', c.name), 360 from public.categories c where c.kind = 'location' and c.slug = 'library' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', null, nullif('Landmarks', c.name), 370 from public.categories c where c.kind = 'location' and c.slug = 'landmarks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'location', (select c2.id from public.categories c2 where c2.kind = 'location' and c2.slug = 'landmarks'), nullif('Landmark / Attraction', c.name), 380 from public.categories c where c.kind = 'location' and c.slug = 'landmark-attraction' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Food & Snacks', c.name), 10 from public.categories c where c.kind = 'product' and c.slug = 'food-snacks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 20 from public.categories c where c.kind = 'product' and c.slug = 'bread-baked-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 30 from public.categories c where c.kind = 'product' and c.slug = 'cakes-desserts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 40 from public.categories c where c.kind = 'product' and c.slug = 'candy-chocolate' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 50 from public.categories c where c.kind = 'product' and c.slug = 'cookies-pastries' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 60 from public.categories c where c.kind = 'product' and c.slug = 'jams-spreads' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 70 from public.categories c where c.kind = 'product' and c.slug = 'pantry-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 80 from public.categories c where c.kind = 'product' and c.slug = 'prepared-foods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 90 from public.categories c where c.kind = 'product' and c.slug = 'sauces-condiments' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 100 from public.categories c where c.kind = 'product' and c.slug = 'snacks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 110 from public.categories c where c.kind = 'product' and c.slug = 'specialty-foods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'food-snacks'), null, 120 from public.categories c where c.kind = 'product' and c.slug = 'spices-seasonings' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Beverages', c.name), 130 from public.categories c where c.kind = 'product' and c.slug = 'beverages' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beverages'), null, 140 from public.categories c where c.kind = 'product' and c.slug = 'coffee' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beverages'), null, 150 from public.categories c where c.kind = 'product' and c.slug = 'tea-matcha' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beverages'), null, 160 from public.categories c where c.kind = 'product' and c.slug = 'non-alcoholic-drinks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Beauty & Personal Care', c.name), 170 from public.categories c where c.kind = 'product' and c.slug = 'beauty-personal-care' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 180 from public.categories c where c.kind = 'product' and c.slug = 'bath-body' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 190 from public.categories c where c.kind = 'product' and c.slug = 'cosmetics' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 200 from public.categories c where c.kind = 'product' and c.slug = 'fragrance' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 210 from public.categories c where c.kind = 'product' and c.slug = 'grooming' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 220 from public.categories c where c.kind = 'product' and c.slug = 'hair-care' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 230 from public.categories c where c.kind = 'product' and c.slug = 'nail-care' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 240 from public.categories c where c.kind = 'product' and c.slug = 'skincare' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'beauty-personal-care'), null, 250 from public.categories c where c.kind = 'product' and c.slug = 'soap' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Apparel', c.name), 260 from public.categories c where c.kind = 'product' and c.slug = 'apparel' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 270 from public.categories c where c.kind = 'product' and c.slug = 'activewear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 280 from public.categories c where c.kind = 'product' and c.slug = 'baby-clothing' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 290 from public.categories c where c.kind = 'product' and c.slug = 'dresses' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 300 from public.categories c where c.kind = 'product' and c.slug = 'intimates-sleepwear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 310 from public.categories c where c.kind = 'product' and c.slug = 'kids-clothing' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 320 from public.categories c where c.kind = 'product' and c.slug = 'other-clothing' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 330 from public.categories c where c.kind = 'product' and c.slug = 'outerwear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 340 from public.categories c where c.kind = 'product' and c.slug = 'pants-shorts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 350 from public.categories c where c.kind = 'product' and c.slug = 'skirts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 360 from public.categories c where c.kind = 'product' and c.slug = 'sweatshirts-hoodies' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 370 from public.categories c where c.kind = 'product' and c.slug = 'swimwear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 380 from public.categories c where c.kind = 'product' and c.slug = 't-shirts-tops' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'apparel'), null, 390 from public.categories c where c.kind = 'product' and c.slug = 'vintage-clothing' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Accessories & Jewelry', c.name), 400 from public.categories c where c.kind = 'product' and c.slug = 'accessories-jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'accessories-jewelry'), nullif('Jewelry', c.name), 410 from public.categories c where c.kind = 'product' and c.slug = 'jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 420 from public.categories c where c.kind = 'product' and c.slug = 'anklets' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 430 from public.categories c where c.kind = 'product' and c.slug = 'body-jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 440 from public.categories c where c.kind = 'product' and c.slug = 'bracelets' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 450 from public.categories c where c.kind = 'product' and c.slug = 'brooches-pins' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 460 from public.categories c where c.kind = 'product' and c.slug = 'charms-pendants' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 470 from public.categories c where c.kind = 'product' and c.slug = 'earrings' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 480 from public.categories c where c.kind = 'product' and c.slug = 'fine-jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 490 from public.categories c where c.kind = 'product' and c.slug = 'necklaces' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 500 from public.categories c where c.kind = 'product' and c.slug = 'other-jewelry' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 510 from public.categories c where c.kind = 'product' and c.slug = 'rings' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'jewelry'), null, 520 from public.categories c where c.kind = 'product' and c.slug = 'watches' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'accessories-jewelry'), nullif('Bags & Accessories', c.name), 530 from public.categories c where c.kind = 'product' and c.slug = 'bags-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 540 from public.categories c where c.kind = 'product' and c.slug = 'backpacks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 550 from public.categories c where c.kind = 'product' and c.slug = 'belts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 560 from public.categories c where c.kind = 'product' and c.slug = 'hair-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 570 from public.categories c where c.kind = 'product' and c.slug = 'handbags-purses' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 580 from public.categories c where c.kind = 'product' and c.slug = 'hats-caps' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 590 from public.categories c where c.kind = 'product' and c.slug = 'keychains' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 600 from public.categories c where c.kind = 'product' and c.slug = 'other-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 610 from public.categories c where c.kind = 'product' and c.slug = 'scarves-wraps' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 620 from public.categories c where c.kind = 'product' and c.slug = 'sunglasses-eyewear' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 630 from public.categories c where c.kind = 'product' and c.slug = 'tote-bags' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 640 from public.categories c where c.kind = 'product' and c.slug = 'travel-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'bags-accessories'), null, 650 from public.categories c where c.kind = 'product' and c.slug = 'wallets-card-holders' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Home & Living', c.name), 660 from public.categories c where c.kind = 'product' and c.slug = 'home-living' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 670 from public.categories c where c.kind = 'product' and c.slug = 'bath-home' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 680 from public.categories c where c.kind = 'product' and c.slug = 'bedding' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 690 from public.categories c where c.kind = 'product' and c.slug = 'candles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 700 from public.categories c where c.kind = 'product' and c.slug = 'drinkware' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 710 from public.categories c where c.kind = 'product' and c.slug = 'furniture' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 720 from public.categories c where c.kind = 'product' and c.slug = 'garden-outdoor' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 730 from public.categories c where c.kind = 'product' and c.slug = 'home-decor' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 740 from public.categories c where c.kind = 'product' and c.slug = 'home-fragrance' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 750 from public.categories c where c.kind = 'product' and c.slug = 'kitchen-dining' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 760 from public.categories c where c.kind = 'product' and c.slug = 'other-home-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 770 from public.categories c where c.kind = 'product' and c.slug = 'pillows-textiles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 780 from public.categories c where c.kind = 'product' and c.slug = 'plants-planters' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 790 from public.categories c where c.kind = 'product' and c.slug = 'storage-organization' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'home-living'), null, 800 from public.categories c where c.kind = 'product' and c.slug = 'wall-decor' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Art & Collectibles', c.name), 810 from public.categories c where c.kind = 'product' and c.slug = 'art-collectibles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 820 from public.categories c where c.kind = 'product' and c.slug = 'collectibles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 830 from public.categories c where c.kind = 'product' and c.slug = 'digital-art' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 840 from public.categories c where c.kind = 'product' and c.slug = 'figurines-miniatures' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 850 from public.categories c where c.kind = 'product' and c.slug = 'illustration' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 860 from public.categories c where c.kind = 'product' and c.slug = 'memorabilia' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 870 from public.categories c where c.kind = 'product' and c.slug = 'mixed-media' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 880 from public.categories c where c.kind = 'product' and c.slug = 'other-art' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 890 from public.categories c where c.kind = 'product' and c.slug = 'paintings' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 900 from public.categories c where c.kind = 'product' and c.slug = 'photography' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 910 from public.categories c where c.kind = 'product' and c.slug = 'posters' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 920 from public.categories c where c.kind = 'product' and c.slug = 'prints' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'art-collectibles'), null, 930 from public.categories c where c.kind = 'product' and c.slug = 'sculpture' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Craft & Maker Goods', c.name), 940 from public.categories c where c.kind = 'product' and c.slug = 'craft-maker-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 950 from public.categories c where c.kind = 'product' and c.slug = 'ceramics-pottery' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 960 from public.categories c where c.kind = 'product' and c.slug = 'craft-supplies' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 970 from public.categories c where c.kind = 'product' and c.slug = 'crochet-knit' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 980 from public.categories c where c.kind = 'product' and c.slug = 'fiber-arts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 990 from public.categories c where c.kind = 'product' and c.slug = 'glasswork' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1000 from public.categories c where c.kind = 'product' and c.slug = 'handmade-soap-candles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1010 from public.categories c where c.kind = 'product' and c.slug = 'leather-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1020 from public.categories c where c.kind = 'product' and c.slug = 'metalwork' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1030 from public.categories c where c.kind = 'product' and c.slug = 'other-maker-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1040 from public.categories c where c.kind = 'product' and c.slug = 'patterns-kits' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1050 from public.categories c where c.kind = 'product' and c.slug = 'resin-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'craft-maker-goods'), null, 1060 from public.categories c where c.kind = 'product' and c.slug = 'woodwork' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Books & Media', c.name), 1070 from public.categories c where c.kind = 'product' and c.slug = 'books-media' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1080 from public.categories c where c.kind = 'product' and c.slug = 'books' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1090 from public.categories c where c.kind = 'product' and c.slug = 'comics' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1100 from public.categories c where c.kind = 'product' and c.slug = 'digital-downloads' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1110 from public.categories c where c.kind = 'product' and c.slug = 'magazines' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1120 from public.categories c where c.kind = 'product' and c.slug = 'music' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1130 from public.categories c where c.kind = 'product' and c.slug = 'other-books-media' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1140 from public.categories c where c.kind = 'product' and c.slug = 'vinyl-physical-media' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'books-media'), null, 1150 from public.categories c where c.kind = 'product' and c.slug = 'zines' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Stationery & Paper', c.name), 1160 from public.categories c where c.kind = 'product' and c.slug = 'stationery-paper' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1170 from public.categories c where c.kind = 'product' and c.slug = 'art-prints' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1180 from public.categories c where c.kind = 'product' and c.slug = 'calendars' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1190 from public.categories c where c.kind = 'product' and c.slug = 'gift-wrap' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1200 from public.categories c where c.kind = 'product' and c.slug = 'greeting-cards' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1210 from public.categories c where c.kind = 'product' and c.slug = 'invitations' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1220 from public.categories c where c.kind = 'product' and c.slug = 'journals-notebooks' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1230 from public.categories c where c.kind = 'product' and c.slug = 'other-paper-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1240 from public.categories c where c.kind = 'product' and c.slug = 'party-paper-goods' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1250 from public.categories c where c.kind = 'product' and c.slug = 'planners' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1260 from public.categories c where c.kind = 'product' and c.slug = 'stationery' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'stationery-paper'), null, 1270 from public.categories c where c.kind = 'product' and c.slug = 'stickers' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Kids & Baby', c.name), 1280 from public.categories c where c.kind = 'product' and c.slug = 'kids-baby' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1290 from public.categories c where c.kind = 'product' and c.slug = 'baby-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1300 from public.categories c where c.kind = 'product' and c.slug = 'baby-essentials' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1310 from public.categories c where c.kind = 'product' and c.slug = 'baby-gifts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1320 from public.categories c where c.kind = 'product' and c.slug = 'educational-products' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1330 from public.categories c where c.kind = 'product' and c.slug = 'kids-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1340 from public.categories c where c.kind = 'product' and c.slug = 'kids-decor' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1350 from public.categories c where c.kind = 'product' and c.slug = 'nursery' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), null, 1360 from public.categories c where c.kind = 'product' and c.slug = 'other-kids-baby' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'kids-baby'), nullif('Toys & Games', c.name), 1370 from public.categories c where c.kind = 'product' and c.slug = 'toys-games' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1380 from public.categories c where c.kind = 'product' and c.slug = 'collectible-toys' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1390 from public.categories c where c.kind = 'product' and c.slug = 'dolls-figures' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1400 from public.categories c where c.kind = 'product' and c.slug = 'games' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1410 from public.categories c where c.kind = 'product' and c.slug = 'other-toys-games' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1420 from public.categories c where c.kind = 'product' and c.slug = 'outdoor-toys' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1430 from public.categories c where c.kind = 'product' and c.slug = 'plush-stuffed-animals' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1440 from public.categories c where c.kind = 'product' and c.slug = 'puzzles' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1450 from public.categories c where c.kind = 'product' and c.slug = 'sensory-toys' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'toys-games'), null, 1460 from public.categories c where c.kind = 'product' and c.slug = 'toys' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Pets', c.name), 1470 from public.categories c where c.kind = 'product' and c.slug = 'pets' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1480 from public.categories c where c.kind = 'product' and c.slug = 'bowls-feeding' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1490 from public.categories c where c.kind = 'product' and c.slug = 'collars-leashes' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1500 from public.categories c where c.kind = 'product' and c.slug = 'other-pet-products' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1510 from public.categories c where c.kind = 'product' and c.slug = 'pet-accessories' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1520 from public.categories c where c.kind = 'product' and c.slug = 'pet-beds' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1530 from public.categories c where c.kind = 'product' and c.slug = 'pet-clothing' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1540 from public.categories c where c.kind = 'product' and c.slug = 'pet-gifts' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1550 from public.categories c where c.kind = 'product' and c.slug = 'pet-toys' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'pets'), null, 1560 from public.categories c where c.kind = 'product' and c.slug = 'pet-treats' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', null, nullif('Wellness', c.name), 1570 from public.categories c where c.kind = 'product' and c.slug = 'wellness' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'wellness'), null, 1580 from public.categories c where c.kind = 'product' and c.slug = 'aromatherapy' on conflict (category_id) do nothing;
insert into public.category_tree_v2 (category_id, kind, parent_category_id, display_name, sort_order) select c.id, 'product', (select c2.id from public.categories c2 where c2.kind = 'product' and c2.slug = 'wellness'), null, 1590 from public.categories c where c.kind = 'product' and c.slug = 'wellness-products' on conflict (category_id) do nothing;

insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'location' and c.slug = 'cafe-coffee-shop' and tp.slug = 'coffee' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'location' and c.slug = 'bakery' and tp.slug = 'bakery-pastry' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'location' and c.slug = 'gallery' and tp.slug = 'art' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'location' and c.slug = 'theater' and tp.slug = 'theater' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'location' and c.slug = 'cinema' and tp.slug = 'film' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'vintage-resale' and tp.slug = 'vintage' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'jewelry' and tp.slug = 'jewelry' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'skincare' and tp.slug = 'skincare' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'fragrance' and tp.slug = 'fragrance' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'cosmetics' and tp.slug = 'beauty' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'fitness' and tp.slug = 'fitness' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'plants-garden' and tp.slug = 'plants' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'art' and tp.slug = 'art' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'publishing-books' and tp.slug = 'books' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'business' and c.slug = 'pets' and tp.slug = 'pets' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'coffee' and tp.slug = 'coffee' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'tea-matcha' and tp.slug = 'tea' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'candy-chocolate' and tp.slug = 'chocolate-sweets' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'bread-baked-goods' and tp.slug = 'bakery-pastry' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'cookies-pastries' and tp.slug = 'bakery-pastry' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'skincare' and tp.slug = 'skincare' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'fragrance' and tp.slug = 'fragrance' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'jewelry' and tp.slug = 'jewelry' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'books' and tp.slug = 'books' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'plants-planters' and tp.slug = 'plants' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'vintage-clothing' and tp.slug = 'vintage' on conflict do nothing;
insert into public.category_topics (category_id, topic_id) select c.id, tp.id from public.categories c join public.category_tree_v2 v on v.category_id = c.id, public.topics tp where c.kind = 'product' and c.slug = 'pets' and tp.slug = 'pets' on conflict do nothing;

insert into public.taxonomy_legacy_mappings (legacy_source, legacy_kind, legacy_slug, targets, mapping_confidence, status, note) values
  ('category', 'event', 'food-drink', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'arts-culture', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'music-nightlife', '[{"dimension":"category","value":"music-nightlife","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'entertainment', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'beauty-wellness', '[{"dimension":"category","value":"beauty-wellness","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'sports-fitness', '[{"dimension":"category","value":"sports-fitness","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'business-tech', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'home-lifestyle', '[{"dimension":"category","value":"home-lifestyle","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'art-exhibitions', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"},{"dimension":"topic","value":"art","confidence":"deterministic"},{"dimension":"event_type","value":"exhibition","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Art events are not all exhibitions.'),
  ('category', 'event', 'books-talks', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"},{"dimension":"topic","value":"books","confidence":"deterministic"},{"dimension":"event_type","value":"talk-panel","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'design', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"},{"dimension":"topic","value":"design","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'film-screenings', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"},{"dimension":"topic","value":"film","confidence":"deterministic"},{"dimension":"event_type","value":"screening","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Could be a film festival.'),
  ('category', 'event', 'beauty-makeup', '[{"dimension":"category","value":"beauty-wellness","confidence":"deterministic"},{"dimension":"topic","value":"beauty","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'fragrance', '[{"dimension":"category","value":"beauty-wellness","confidence":"deterministic"},{"dimension":"topic","value":"fragrance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'skincare', '[{"dimension":"category","value":"beauty-wellness","confidence":"deterministic"},{"dimension":"topic","value":"skincare","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'wellness-self-care', '[{"dimension":"category","value":"beauty-wellness","confidence":"deterministic"},{"dimension":"topic","value":"wellness","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'ai', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"},{"dimension":"topic","value":"ai","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'careers-networking', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"},{"dimension":"topic","value":"careers","confidence":"deterministic"},{"dimension":"event_type","value":"networking","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'developers-engineering', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"},{"dimension":"topic","value":"tech","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'finance-investing', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'founders-startups', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"},{"dimension":"topic","value":"startups","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'community-social', '[{"dimension":"category","value":"community-causes","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'V1 ''Community & Social'' is wider than causes.'),
  ('category', 'event', 'causes-volunteering', '[{"dimension":"category","value":"community-causes","confidence":"deterministic"},{"dimension":"event_type","value":"volunteer-event","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'local-festivals-street-fairs', '[{"dimension":"category","value":"community-causes","confidence":"review_required"},{"dimension":"event_type","value":"festival","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'meetups-socials', '[{"dimension":"category","value":"community-causes","confidence":"review_required"},{"dimension":"event_type","value":"meetup-social","confidence":"deterministic"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'comedy', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"},{"dimension":"topic","value":"comedy","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'games-trivia', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'immersive-experiences', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"},{"dimension":"event_type","value":"immersive-experience","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'theater-performance', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"},{"dimension":"topic","value":"theater","confidence":"deterministic"},{"dimension":"event_type","value":"performance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'family-kids', '[{"dimension":"audience","value":"family","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Audience, not a Category; kids vs family not provable.'),
  ('category', 'event', 'family-experiences', '[{"dimension":"audience","value":"family","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'kids-activities', '[{"dimension":"audience","value":"kids","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'parenting', '[{"dimension":"topic","value":"parenting","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'fashion-style', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"topic","value":"fashion","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'fashion', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"topic","value":"fashion","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'jewelry-accessories', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"topic","value":"jewelry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'streetwear-sneakers', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"topic","value":"streetwear","confidence":"deterministic"},{"dimension":"topic","value":"sneakers","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'baking-sweets', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"topic","value":"bakery-pastry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'coffee-tea', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"topic","value":"coffee","confidence":"review_required"},{"dimension":"topic","value":"tea","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Coffee OR tea — either Topic alone is unproven.'),
  ('category', 'event', 'dining-experiences', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"event_type","value":"dining-experience","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'food-festival', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"event_type","value":"festival","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'tastings-drinks', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"event_type","value":"tasting","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'djs-dance', '[{"dimension":"category","value":"music-nightlife","confidence":"deterministic"},{"dimension":"topic","value":"djs-dance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'live-music', '[{"dimension":"category","value":"music-nightlife","confidence":"deterministic"},{"dimension":"topic","value":"live-music","confidence":"deterministic"},{"dimension":"event_type","value":"performance","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'A festival can feature live music.'),
  ('category', 'event', 'parties-nightlife', '[{"dimension":"category","value":"music-nightlife","confidence":"deterministic"},{"dimension":"event_type","value":"party","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'pets-animals', '[{"dimension":"topic","value":"pets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'adoption-rescue', '[{"dimension":"category","value":"community-causes","confidence":"deterministic"},{"dimension":"topic","value":"pets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'pet-events', '[{"dimension":"topic","value":"pets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'pet-friendly-experiences', '[{"dimension":"topic","value":"pets","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Pet-friendly is not ''about pets''.'),
  ('category', 'event', 'seasonal-holiday', '[]'::jsonb, 'intentionally_unmapped', 'draft', 'A season is a Topic, not a Category.'),
  ('category', 'event', 'cultural-celebrations', '[{"dimension":"category","value":"community-causes","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'halloween-fall', '[{"dimension":"topic","value":"halloween","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', '''Halloween & Fall'' — a fall event is not a Halloween event.'),
  ('category', 'event', 'holiday-winter', '[{"dimension":"topic","value":"winter-holidays","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'spring-summer', '[{"dimension":"topic","value":"summer","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'shopping-retail', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'markets-pop-ups', '[{"dimension":"category","value":"shopping-style","confidence":"review_required"},{"dimension":"event_type","value":"market","confidence":"review_required"},{"dimension":"experience_mechanic","value":"pop-up","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'V1 ''Markets & Fairs'' (slug markets-pop-ups) is a catch-all: it holds immersive, pet and brand events.'),
  ('category', 'event', 'retail-experiences', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"experience_mechanic","value":"retail-experience","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'sample-sales', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"event_type","value":"shopping-event","confidence":"deterministic"},{"dimension":"experience_mechanic","value":"sample-sale","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'vintage-resale', '[{"dimension":"category","value":"shopping-style","confidence":"deterministic"},{"dimension":"topic","value":"vintage","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'fitness-classes', '[{"dimension":"category","value":"sports-fitness","confidence":"deterministic"},{"dimension":"topic","value":"fitness","confidence":"deterministic"},{"dimension":"event_type","value":"fitness-session","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'outdoor-recreation', '[{"dimension":"category","value":"outdoors-nature","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'running', '[{"dimension":"category","value":"sports-fitness","confidence":"deterministic"},{"dimension":"topic","value":"running","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'sports-watch-parties', '[{"dimension":"category","value":"sports-fitness","confidence":"deterministic"},{"dimension":"event_type","value":"watch-party","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'workshops-classes', '[{"dimension":"event_type","value":"class","confidence":"review_required"},{"dimension":"event_type","value":"workshop","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Class vs workshop, and no domain.'),
  ('category', 'event', 'art-craft-classes', '[{"dimension":"category","value":"arts-culture","confidence":"deterministic"},{"dimension":"topic","value":"crafts-diy","confidence":"deterministic"},{"dimension":"event_type","value":"class","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event', 'cooking-classes', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"event_type","value":"class","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event', 'professional-skill-building', '[{"dimension":"category","value":"business-tech","confidence":"deterministic"},{"dimension":"topic","value":"careers","confidence":"review_required"},{"dimension":"event_type","value":"class","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'event_format', 'brand-activation', '[{"dimension":"experience_mechanic","value":"brand-activation","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'pop-up', '[{"dimension":"experience_mechanic","value":"pop-up","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'sampling', '[{"dimension":"experience_mechanic","value":"sampling","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'product-launch', '[{"dimension":"experience_mechanic","value":"product-launch","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'retail-experience', '[{"dimension":"experience_mechanic","value":"retail-experience","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'sample-sale', '[{"dimension":"experience_mechanic","value":"sample-sale","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'market', '[{"dimension":"event_type","value":"market","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'festival', '[{"dimension":"event_type","value":"festival","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'networking', '[{"dimension":"event_type","value":"networking","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'talk-panel', '[{"dimension":"event_type","value":"talk-panel","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'workshop', '[{"dimension":"event_type","value":"workshop","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'conference', '[{"dimension":"event_type","value":"conference","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'exhibition', '[{"dimension":"event_type","value":"exhibition","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'immersive-experience', '[{"dimension":"event_type","value":"immersive-experience","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'performance', '[{"dimension":"event_type","value":"performance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'event_format', 'party-social', '[{"dimension":"event_type","value":"party","confidence":"review_required"},{"dimension":"event_type","value":"meetup-social","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Party vs Meetup & Social.'),
  ('category', 'business', 'fashion-apparel', '[{"dimension":"category","value":"fashion-apparel","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'vintage-resale', '[{"dimension":"category","value":"vintage-resale","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'pets', '[{"dimension":"category","value":"pets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'agency', '[{"dimension":"category","value":"services","confidence":"deterministic"},{"dimension":"business_model","value":"agency","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'art-illustration', '[{"dimension":"category","value":"art","confidence":"deterministic"},{"dimension":"business_model","value":"maker_artist","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'business', 'author', '[{"dimension":"category","value":"publishing-books","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'bakery-sweets', '[{"dimension":"category","value":"bakery-desserts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'beauty-self-care', '[{"dimension":"category","value":"beauty-personal-care","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'classes-workshops', '[{"dimension":"category","value":"services","confidence":"review_required"},{"dimension":"business_model","value":"service_provider","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Industry unknown (cooking? art? fitness?).'),
  ('category', 'business', 'coffee', '[{"dimension":"category","value":"food-beverage","confidence":"deterministic"},{"dimension":"category","value":"coffee-tea","confidence":"review_required"},{"dimension":"topic","value":"coffee","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'V1 ''Coffee, Tea & Beverages'' also holds tea and other drink brands.'),
  ('category', 'business', 'events-event-services', '[{"dimension":"category","value":"events-hospitality","confidence":"deterministic"},{"dimension":"business_model","value":"organizer","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Event services may be vendors, not organizers.'),
  ('category', 'business', 'experiences-entertainment', '[{"dimension":"category","value":"entertainment","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'flowers', '[{"dimension":"category","value":"plants-garden","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'food-drink', '[{"dimension":"category","value":"food-beverage","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'food-truck', '[{"dimension":"category","value":"restaurants-food-service","confidence":"deterministic"},{"dimension":"business_model","value":"food_service","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'gifts-specialty-goods', '[{"dimension":"category","value":"home-goods","confidence":"review_required"},{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'business', 'health-fitness-wellness', '[{"dimension":"category","value":"health-wellness","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'home-decor', '[{"dimension":"category","value":"home-living","confidence":"deterministic"},{"dimension":"category","value":"furniture-decor","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'business', 'home-local-services', '[{"dimension":"category","value":"services","confidence":"deterministic"},{"dimension":"business_model","value":"service_provider","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'jewelry-accessories', '[{"dimension":"category","value":"fashion-apparel","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'Jewelry AND accessories → their shared parent.'),
  ('category', 'business', 'kids-family', '[{"dimension":"category","value":"kids-baby","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Kids products vs kids activities vs family.'),
  ('category', 'business', 'makers-goods', '[{"dimension":"category","value":"makers","confidence":"deterministic"},{"dimension":"business_model","value":"maker_artist","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'markets-pop-ups', '[{"dimension":"category","value":"event-production","confidence":"review_required"},{"dimension":"business_model","value":"organizer","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Market organizer vs a brand that pops up.'),
  ('category', 'business', 'music-performers', '[{"dimension":"category","value":"music","confidence":"deterministic"},{"dimension":"business_model","value":"maker_artist","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'business', 'other', '[]'::jsonb, 'intentionally_unmapped', 'draft', 'No meaning to carry.'),
  ('category', 'business', 'packaged-goods', '[{"dimension":"category","value":"packaged-food","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'May be non-food consumer goods.'),
  ('category', 'business', 'photography-creative', '[{"dimension":"category","value":"art","confidence":"review_required"},{"dimension":"category","value":"film-video","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'business', 'professional-services', '[{"dimension":"category","value":"services","confidence":"deterministic"},{"dimension":"business_model","value":"service_provider","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'business', 'retail', '[{"dimension":"business_model","value":"retailer","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'A business model, not an industry: no V2 Category.'),
  ('category', 'location', 'cafe-coffee-shop', '[{"dimension":"category","value":"cafe-coffee-shop","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'restaurant', '[{"dimension":"category","value":"restaurant","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'bar-lounge', '[{"dimension":"category","value":"bar-lounge","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'retail-store', '[{"dimension":"category","value":"retail-store","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'gallery', '[{"dimension":"category","value":"gallery","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'event-venue', '[{"dimension":"category","value":"event-venue","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'community-space', '[{"dimension":"category","value":"community-space","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'fitness-gym', '[{"dimension":"category","value":"fitness-gym","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'salon-spa', '[{"dimension":"category","value":"salon-spa","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'hotel', '[{"dimension":"category","value":"hotel","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'coworking-space', '[{"dimension":"category","value":"coworking-space","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'brewery-taproom', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"category","value":"bar-lounge","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'location', 'campus', '[{"dimension":"category","value":"work-education","confidence":"deterministic"},{"dimension":"category","value":"school-campus","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'A corporate campus is not a school.'),
  ('category', 'location', 'grocery', '[{"dimension":"category","value":"food-drink","confidence":"deterministic"},{"dimension":"category","value":"specialty-food-shop","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'location', 'market', '[{"dimension":"category","value":"market-hall","confidence":"review_required"},{"dimension":"category","value":"shopping","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Market hall vs open-air market.'),
  ('category', 'location', 'office-workplace', '[{"dimension":"category","value":"work-education","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'location', 'other', '[]'::jsonb, 'intentionally_unmapped', 'draft', null),
  ('category', 'location', 'park-outdoor-space', '[{"dimension":"category","value":"outdoors","confidence":"deterministic"},{"dimension":"category","value":"park","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', '''Park / Outdoor Space'' also covers plazas and piers.'),
  ('category', 'location', 'residential', '[]'::jsonb, 'intentionally_unmapped', 'draft', 'Never public.'),
  ('category', 'location', 'studio', '[{"dimension":"category","value":"wellness-studio","confidence":"review_required"},{"dimension":"category","value":"arts-culture","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Fitness, art, photo or rental studio.'),
  ('category', 'product', 'bread-baked-goods', '[{"dimension":"category","value":"bread-baked-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'cakes-desserts', '[{"dimension":"category","value":"cakes-desserts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'candy-chocolate', '[{"dimension":"category","value":"candy-chocolate","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'cookies-pastries', '[{"dimension":"category","value":"cookies-pastries","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'jams-spreads', '[{"dimension":"category","value":"jams-spreads","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pantry-goods', '[{"dimension":"category","value":"pantry-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'prepared-foods', '[{"dimension":"category","value":"prepared-foods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'sauces-condiments', '[{"dimension":"category","value":"sauces-condiments","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'snacks', '[{"dimension":"category","value":"snacks","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'specialty-foods', '[{"dimension":"category","value":"specialty-foods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'spices-seasonings', '[{"dimension":"category","value":"spices-seasonings","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'coffee', '[{"dimension":"category","value":"coffee","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'tea-matcha', '[{"dimension":"category","value":"tea-matcha","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'non-alcoholic-drinks', '[{"dimension":"category","value":"non-alcoholic-drinks","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bath-body', '[{"dimension":"category","value":"bath-body","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'cosmetics', '[{"dimension":"category","value":"cosmetics","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'fragrance', '[{"dimension":"category","value":"fragrance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'grooming', '[{"dimension":"category","value":"grooming","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'hair-care', '[{"dimension":"category","value":"hair-care","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'nail-care', '[{"dimension":"category","value":"nail-care","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'skincare', '[{"dimension":"category","value":"skincare","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'soap', '[{"dimension":"category","value":"soap","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'activewear', '[{"dimension":"category","value":"activewear","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'baby-clothing', '[{"dimension":"category","value":"baby-clothing","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'dresses', '[{"dimension":"category","value":"dresses","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'intimates-sleepwear', '[{"dimension":"category","value":"intimates-sleepwear","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'kids-clothing', '[{"dimension":"category","value":"kids-clothing","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-clothing', '[{"dimension":"category","value":"other-clothing","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'outerwear', '[{"dimension":"category","value":"outerwear","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pants-shorts', '[{"dimension":"category","value":"pants-shorts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'skirts', '[{"dimension":"category","value":"skirts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'sweatshirts-hoodies', '[{"dimension":"category","value":"sweatshirts-hoodies","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'swimwear', '[{"dimension":"category","value":"swimwear","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 't-shirts-tops', '[{"dimension":"category","value":"t-shirts-tops","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'vintage-clothing', '[{"dimension":"category","value":"vintage-clothing","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'jewelry', '[{"dimension":"category","value":"jewelry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'anklets', '[{"dimension":"category","value":"anklets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'body-jewelry', '[{"dimension":"category","value":"body-jewelry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bracelets', '[{"dimension":"category","value":"bracelets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'brooches-pins', '[{"dimension":"category","value":"brooches-pins","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'charms-pendants', '[{"dimension":"category","value":"charms-pendants","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'earrings', '[{"dimension":"category","value":"earrings","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'fine-jewelry', '[{"dimension":"category","value":"fine-jewelry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'necklaces', '[{"dimension":"category","value":"necklaces","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-jewelry', '[{"dimension":"category","value":"other-jewelry","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'rings', '[{"dimension":"category","value":"rings","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'watches', '[{"dimension":"category","value":"watches","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bags-accessories', '[{"dimension":"category","value":"bags-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'backpacks', '[{"dimension":"category","value":"backpacks","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'belts', '[{"dimension":"category","value":"belts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'hair-accessories', '[{"dimension":"category","value":"hair-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'handbags-purses', '[{"dimension":"category","value":"handbags-purses","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'hats-caps', '[{"dimension":"category","value":"hats-caps","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'keychains', '[{"dimension":"category","value":"keychains","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-accessories', '[{"dimension":"category","value":"other-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'scarves-wraps', '[{"dimension":"category","value":"scarves-wraps","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'sunglasses-eyewear', '[{"dimension":"category","value":"sunglasses-eyewear","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'tote-bags', '[{"dimension":"category","value":"tote-bags","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'travel-accessories', '[{"dimension":"category","value":"travel-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'wallets-card-holders', '[{"dimension":"category","value":"wallets-card-holders","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'home-living', '[{"dimension":"category","value":"home-living","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bath-home', '[{"dimension":"category","value":"bath-home","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bedding', '[{"dimension":"category","value":"bedding","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'candles', '[{"dimension":"category","value":"candles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'drinkware', '[{"dimension":"category","value":"drinkware","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'furniture', '[{"dimension":"category","value":"furniture","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'garden-outdoor', '[{"dimension":"category","value":"garden-outdoor","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'home-decor', '[{"dimension":"category","value":"home-decor","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'home-fragrance', '[{"dimension":"category","value":"home-fragrance","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'kitchen-dining', '[{"dimension":"category","value":"kitchen-dining","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-home-goods', '[{"dimension":"category","value":"other-home-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pillows-textiles', '[{"dimension":"category","value":"pillows-textiles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'plants-planters', '[{"dimension":"category","value":"plants-planters","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'storage-organization', '[{"dimension":"category","value":"storage-organization","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'wall-decor', '[{"dimension":"category","value":"wall-decor","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'art-collectibles', '[{"dimension":"category","value":"art-collectibles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'collectibles', '[{"dimension":"category","value":"collectibles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'digital-art', '[{"dimension":"category","value":"digital-art","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'figurines-miniatures', '[{"dimension":"category","value":"figurines-miniatures","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'illustration', '[{"dimension":"category","value":"illustration","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'memorabilia', '[{"dimension":"category","value":"memorabilia","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'mixed-media', '[{"dimension":"category","value":"mixed-media","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-art', '[{"dimension":"category","value":"other-art","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'paintings', '[{"dimension":"category","value":"paintings","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'photography', '[{"dimension":"category","value":"photography","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'posters', '[{"dimension":"category","value":"posters","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'prints', '[{"dimension":"category","value":"prints","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'sculpture', '[{"dimension":"category","value":"sculpture","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'craft-maker-goods', '[{"dimension":"category","value":"craft-maker-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'ceramics-pottery', '[{"dimension":"category","value":"ceramics-pottery","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'craft-supplies', '[{"dimension":"category","value":"craft-supplies","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'crochet-knit', '[{"dimension":"category","value":"crochet-knit","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'fiber-arts', '[{"dimension":"category","value":"fiber-arts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'glasswork', '[{"dimension":"category","value":"glasswork","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'handmade-soap-candles', '[{"dimension":"category","value":"handmade-soap-candles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'leather-goods', '[{"dimension":"category","value":"leather-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'metalwork', '[{"dimension":"category","value":"metalwork","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-maker-goods', '[{"dimension":"category","value":"other-maker-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'patterns-kits', '[{"dimension":"category","value":"patterns-kits","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'resin-goods', '[{"dimension":"category","value":"resin-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'woodwork', '[{"dimension":"category","value":"woodwork","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'books-media', '[{"dimension":"category","value":"books-media","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'books', '[{"dimension":"category","value":"books","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'comics', '[{"dimension":"category","value":"comics","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'digital-downloads', '[{"dimension":"category","value":"digital-downloads","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'magazines', '[{"dimension":"category","value":"magazines","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'music', '[{"dimension":"category","value":"music","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-books-media', '[{"dimension":"category","value":"other-books-media","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'vinyl-physical-media', '[{"dimension":"category","value":"vinyl-physical-media","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'zines', '[{"dimension":"category","value":"zines","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'stationery-paper', '[{"dimension":"category","value":"stationery-paper","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'art-prints', '[{"dimension":"category","value":"art-prints","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'calendars', '[{"dimension":"category","value":"calendars","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'gift-wrap', '[{"dimension":"category","value":"gift-wrap","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'greeting-cards', '[{"dimension":"category","value":"greeting-cards","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'invitations', '[{"dimension":"category","value":"invitations","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'journals-notebooks', '[{"dimension":"category","value":"journals-notebooks","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-paper-goods', '[{"dimension":"category","value":"other-paper-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'party-paper-goods', '[{"dimension":"category","value":"party-paper-goods","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'planners', '[{"dimension":"category","value":"planners","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'stationery', '[{"dimension":"category","value":"stationery","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'stickers', '[{"dimension":"category","value":"stickers","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'kids-baby', '[{"dimension":"category","value":"kids-baby","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'baby-accessories', '[{"dimension":"category","value":"baby-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'baby-essentials', '[{"dimension":"category","value":"baby-essentials","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'baby-gifts', '[{"dimension":"category","value":"baby-gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'educational-products', '[{"dimension":"category","value":"educational-products","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'kids-accessories', '[{"dimension":"category","value":"kids-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'kids-decor', '[{"dimension":"category","value":"kids-decor","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'nursery', '[{"dimension":"category","value":"nursery","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-kids-baby', '[{"dimension":"category","value":"other-kids-baby","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'toys-games', '[{"dimension":"category","value":"toys-games","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'collectible-toys', '[{"dimension":"category","value":"collectible-toys","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'dolls-figures', '[{"dimension":"category","value":"dolls-figures","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'games', '[{"dimension":"category","value":"games","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-toys-games', '[{"dimension":"category","value":"other-toys-games","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'outdoor-toys', '[{"dimension":"category","value":"outdoor-toys","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'plush-stuffed-animals', '[{"dimension":"category","value":"plush-stuffed-animals","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'puzzles', '[{"dimension":"category","value":"puzzles","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'sensory-toys', '[{"dimension":"category","value":"sensory-toys","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'toys', '[{"dimension":"category","value":"toys","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pets', '[{"dimension":"category","value":"pets","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'bowls-feeding', '[{"dimension":"category","value":"bowls-feeding","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'collars-leashes', '[{"dimension":"category","value":"collars-leashes","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'other-pet-products', '[{"dimension":"category","value":"other-pet-products","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-accessories', '[{"dimension":"category","value":"pet-accessories","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-beds', '[{"dimension":"category","value":"pet-beds","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-clothing', '[{"dimension":"category","value":"pet-clothing","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-gifts', '[{"dimension":"category","value":"pet-gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-toys', '[{"dimension":"category","value":"pet-toys","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'pet-treats', '[{"dimension":"category","value":"pet-treats","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'aromatherapy', '[{"dimension":"category","value":"aromatherapy","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'wellness-products', '[{"dimension":"category","value":"wellness-products","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'apparel-accessories', '[{"dimension":"category","value":"apparel","confidence":"review_required"},{"dimension":"category","value":"accessories-jewelry","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', 'Legacy combined top-level.'),
  ('category', 'product', 'beauty-wellness', '[{"dimension":"category","value":"beauty-personal-care","confidence":"review_required"},{"dimension":"category","value":"wellness","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'product', 'books-2', '[{"dimension":"category","value":"books","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'Duplicate orphan of Books & Media › Books.'),
  ('category', 'product', 'clothing', '[{"dimension":"category","value":"apparel","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', null),
  ('category', 'product', 'food-drink', '[{"dimension":"category","value":"food-snacks","confidence":"review_required"},{"dimension":"category","value":"beverages","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'product', 'other-beauty-wellness', '[{"dimension":"category","value":"beauty-personal-care","confidence":"review_required"},{"dimension":"category","value":"wellness","confidence":"review_required"}]'::jsonb, 'review_required', 'draft', null),
  ('category', 'product', 'gifts-occasions', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'baby-shower', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'birthday', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'corporate-gifts', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'gift-boxes-sets', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'holiday-seasonal', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'housewarming', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'other-gifts', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'party-favors', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'personalized-gifts', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.'),
  ('category', 'product', 'wedding', '[{"dimension":"topic","value":"gifts","confidence":"deterministic"}]'::jsonb, 'deterministic', 'draft', 'An occasion/use, not a product Category.')
on conflict (legacy_source, legacy_kind, legacy_slug) do update
  set targets = excluded.targets, mapping_confidence = excluded.mapping_confidence, note = excluded.note, updated_at = now()
  where public.taxonomy_legacy_mappings.status = 'draft';

-- ================================================================ 7. deterministic backfill (data-driven by taxonomy_legacy_mappings)
-- Every write below is idempotent (on conflict do nothing / guarded
-- updates) and goes ONLY to V2 tables or V2-only columns. Deterministic
-- targets become confirmed assignments (source 'migration'); review targets
-- become suggestions. Nothing is inferred from names, prose or absence.

drop table if exists pg_temp.tmp_v2_legacy_links;
create temporary table tmp_v2_legacy_links as
  -- (entity type, entity id, legacy kind, legacy slug) for every V1 classification in use.
  select 'business'::text as entity_type, bc.business_id as entity_id, c.kind as legacy_kind, c.slug as legacy_slug
    from public.business_categories bc join public.categories c on c.id = bc.category_id
  union all
  select 'event', ec.event_id, c.kind, c.slug from public.event_categories ec join public.categories c on c.id = ec.category_id
  union all
  select 'event', ef.event_id, c.kind, c.slug from public.event_formats ef join public.categories c on c.id = ef.category_id
  union all
  select 'product', pc.product_id, c.kind, c.slug from public.product_categories pc join public.categories c on c.id = pc.category_id
  union all
  select 'location', l.id, c.kind, c.slug from public.locations l join public.categories c on c.id = l.category_id;

drop table if exists pg_temp.tmp_v2_targets;
create temporary table tmp_v2_targets as
  select k.entity_type, k.entity_id, k.legacy_kind, k.legacy_slug,
         t ->> 'dimension' as dimension, t ->> 'value' as value, t ->> 'confidence' as confidence,
         case when k.legacy_kind = 'event_format' then 'event' else k.legacy_kind end as category_kind
    from tmp_v2_legacy_links k
    join public.taxonomy_legacy_mappings m on m.legacy_source = 'category' and m.legacy_kind = k.legacy_kind and m.legacy_slug = k.legacy_slug
    cross join lateral jsonb_array_elements(m.targets) t;

-- 7a. V2 Categories
insert into public.business_category_assignments (business_id, category_id, source)
select distinct x.entity_id, c.id, 'migration'
  from tmp_v2_targets x
  join public.categories c on c.kind = x.category_kind and c.slug = x.value
  join public.category_tree_v2 t on t.category_id = c.id
 where x.entity_type = 'business' and x.dimension = 'category' and x.confidence = 'deterministic'
on conflict do nothing;
insert into public.event_category_assignments (event_id, category_id, source)
select distinct x.entity_id, c.id, 'migration'
  from tmp_v2_targets x
  join public.categories c on c.kind = x.category_kind and c.slug = x.value
  join public.category_tree_v2 t on t.category_id = c.id
 where x.entity_type = 'event' and x.dimension = 'category' and x.confidence = 'deterministic'
on conflict do nothing;
insert into public.product_category_assignments (product_id, category_id, source)
select distinct x.entity_id, c.id, 'migration'
  from tmp_v2_targets x
  join public.categories c on c.kind = x.category_kind and c.slug = x.value
  join public.category_tree_v2 t on t.category_id = c.id
 where x.entity_type = 'product' and x.dimension = 'category' and x.confidence = 'deterministic'
on conflict do nothing;
insert into public.location_categories (location_id, category_id, source)
select distinct x.entity_id, c.id, 'migration'
  from tmp_v2_targets x
  join public.categories c on c.kind = x.category_kind and c.slug = x.value
  join public.category_tree_v2 t on t.category_id = c.id
 where x.entity_type = 'location' and x.dimension = 'category' and x.confidence = 'deterministic'
on conflict do nothing;

-- A migrated ancestor is redundant when a migrated descendant of it is on
-- the same entity (the tree already implies it). Only this pass's own
-- 'migration' rows are touched.
delete from public.business_category_assignments a
 where a.source = 'migration' and exists (
   select 1 from public.business_category_assignments b join public.category_tree_v2 t on t.category_id = b.category_id
    where b.business_id = a.business_id and b.source = 'migration' and t.parent_category_id = a.category_id);
delete from public.product_category_assignments a
 where a.source = 'migration' and exists (
   select 1 from public.product_category_assignments b join public.category_tree_v2 t on t.category_id = b.category_id
    left join public.category_tree_v2 t2 on t2.category_id = t.parent_category_id
    where b.product_id = a.product_id and b.source = 'migration' and (t.parent_category_id = a.category_id or t2.parent_category_id = a.category_id));
delete from public.location_categories a
 where a.source = 'migration' and exists (
   select 1 from public.location_categories b join public.category_tree_v2 t on t.category_id = b.category_id
    left join public.category_tree_v2 t2 on t2.category_id = t.parent_category_id
    where b.location_id = a.location_id and b.source = 'migration' and (t.parent_category_id = a.category_id or t2.parent_category_id = a.category_id));

-- Primary = the entity's only V2 Category (never chosen between several).
update public.business_category_assignments a set is_primary = true
 where not a.is_primary and (select count(*) from public.business_category_assignments b where b.business_id = a.business_id) = 1;
update public.event_category_assignments a set is_primary = true
 where not a.is_primary and (select count(*) from public.event_category_assignments b where b.event_id = a.event_id) = 1;
update public.product_category_assignments a set is_primary = true
 where not a.is_primary and (select count(*) from public.product_category_assignments b where b.product_id = a.product_id) = 1;
update public.location_categories a set is_primary = true
 where not a.is_primary and (select count(*) from public.location_categories b where b.location_id = a.location_id) = 1;

-- 7b. Event Types and Experience Mechanics (separate dimensions)
insert into public.event_type_assignments (event_id, term_id, source)
select distinct x.entity_id, tt.id, 'migration'
  from tmp_v2_targets x join public.taxonomy_terms tt on tt.vocabulary = 'event_type' and tt.slug = x.value
 where x.entity_type = 'event' and x.dimension = 'event_type' and x.confidence = 'deterministic'
on conflict do nothing;
update public.event_type_assignments a set is_primary = true
 where not a.is_primary and (select count(*) from public.event_type_assignments b where b.event_id = a.event_id) = 1;
insert into public.event_mechanic_assignments (event_id, term_id, source)
select distinct x.entity_id, tt.id, 'migration'
  from tmp_v2_targets x join public.taxonomy_terms tt on tt.vocabulary = 'experience_mechanic' and tt.slug = x.value
 where x.entity_type = 'event' and x.dimension = 'experience_mechanic' and x.confidence = 'deterministic'
on conflict do nothing;
-- (A Mechanic never writes a Benefit.)

-- 7c. Topics
insert into public.business_topics (business_id, topic_id, source)
select distinct x.entity_id, tp.id, 'migration' from tmp_v2_targets x join public.topics tp on tp.slug = x.value
 where x.entity_type = 'business' and x.dimension = 'topic' and x.confidence = 'deterministic' on conflict do nothing;
insert into public.event_topics (event_id, topic_id, source)
select distinct x.entity_id, tp.id, 'migration' from tmp_v2_targets x join public.topics tp on tp.slug = x.value
 where x.entity_type = 'event' and x.dimension = 'topic' and x.confidence = 'deterministic' on conflict do nothing;
insert into public.product_topics (product_id, topic_id, source)
select distinct x.entity_id, tp.id, 'migration' from tmp_v2_targets x join public.topics tp on tp.slug = x.value
 where x.entity_type = 'product' and x.dimension = 'topic' and x.confidence = 'deterministic' on conflict do nothing;
insert into public.location_topics (location_id, topic_id, source)
select distinct x.entity_id, tp.id, 'migration' from tmp_v2_targets x join public.topics tp on tp.slug = x.value
 where x.entity_type = 'location' and x.dimension = 'topic' and x.confidence = 'deterministic' on conflict do nothing;

-- 7d. Business Models (V2-only column)
with derived as (
  select x.entity_id, array_agg(distinct x.value order by x.value) as models
    from tmp_v2_targets x
   where x.entity_type = 'business' and x.dimension = 'business_model' and x.confidence = 'deterministic'
   group by x.entity_id
), changed as (
  update public.businesses b
     set business_models = array(select distinct v from unnest(b.business_models || d.models) v order by v)
    from derived d
   where b.id = d.entity_id and not (d.models <@ b.business_models)
  returning b.id
)
insert into public.classification_field_sources (entity_type, entity_id, field, source)
select 'business', id, 'business_models', 'migration' from changed
on conflict do nothing;

-- 7e. Review-required targets → suggestions (never discovery)
insert into public.classification_suggestions (entity_type, entity_id, dimension, value, source, evidence)
select distinct x.entity_type, x.entity_id, x.dimension, to_jsonb(x.value), 'migration',
       format('Legacy %s category "%s" maps to %s "%s" only with review.', replace(x.legacy_kind, '_', ' '), x.legacy_slug, replace(x.dimension, '_', ' '), x.value)
  from tmp_v2_targets x
 where x.confidence = 'review_required'
   and not exists (select 1 from tmp_v2_targets y where y.entity_type = x.entity_type and y.entity_id = x.entity_id and y.dimension = x.dimension and y.value = x.value and y.confidence = 'deterministic')
on conflict (entity_type, entity_id, dimension, md5(value::text)) where status = 'suggested' do nothing;

-- 7f. Entry modes — deterministic from the Event's own attendance actions,
-- but events.entry_modes is read by the live V1 Map filter, so they are
-- staged as full-confidence suggestions until the read switch.
insert into public.classification_suggestions (entity_type, entity_id, dimension, value, source, confidence, evidence)
select 'event', e.id, 'entry_mode', to_jsonb(v.mode), 'migration', 1.000, v.evidence
  from public.events e
  cross join lateral (values
    (case when e.tickets_enabled and nullif(btrim(coalesce(e.tickets_url, '')), '') is not null then 'ticket' end, 'Get Tickets action (tickets_enabled + tickets_url). Staged: events.entry_modes is read by the live V1 Map.'),
    (case when e.rsvp_enabled and nullif(btrim(coalesce(e.rsvp_url, '')), '') is not null and e.rsvp_cta = 'register' then 'registration' end, 'Register action (rsvp_enabled + rsvp_url, rsvp_cta register). Staged: events.entry_modes is read by the live V1 Map.'),
    (case when e.rsvp_enabled and nullif(btrim(coalesce(e.rsvp_url, '')), '') is not null and coalesce(e.rsvp_cta, 'rsvp') = 'rsvp' then 'rsvp' end, 'RSVP action (rsvp_enabled + rsvp_url). Staged: events.entry_modes is read by the live V1 Map.')
  ) v(mode, evidence)
 where v.mode is not null and not (v.mode = any (e.entry_modes))
on conflict (entity_type, entity_id, dimension, md5(value::text)) where status = 'suggested' do nothing;

-- 7g. Appearance Type — never inherited; a SUGGESTION only when the linked
-- Event has exactly one of these Formats.
insert into public.classification_suggestions (entity_type, entity_id, dimension, value, source, confidence, evidence)
select 'appearance', a.id, 'appearance_type', to_jsonb(s.appearance_type), 'migration', 0.500,
       format('Linked Event''s only activation Format is "%s".', s.legacy_format)
  from public.appearances a
  join lateral (
    select min(c.slug) as legacy_format, count(*) as n
      from public.event_formats ef join public.categories c on c.id = ef.category_id
     where ef.event_id = a.event_id and c.slug in ('sampling', 'pop-up', 'brand-activation', 'market')
  ) f on f.n = 1
  join (values ('sampling', 'sampling-demo'), ('pop-up', 'pop-up'), ('brand-activation', 'activation'), ('market', 'vendor-booth')) s(legacy_format, appearance_type) on s.legacy_format = f.legacy_format
 where a.appearance_type_id is null
on conflict (entity_type, entity_id, dimension, md5(value::text)) where status = 'suggested' do nothing;

-- 7h. Location hours — legacy locations.hours → V2 periods ONLY when every
-- day is well-formed: closed=true (no periods), allDay=true (0 → 1440) or
-- HH:MM open < close. Never invents a day, an overnight period or a
-- timezone. A week with no open day is ambiguous (closed vs "no regular
-- hours") → suggestion. locations.hours stays the live source.
do $$
declare
  loc record;
  d record;
  ok boolean;
  open_days int;
  wd text[] := array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  i int;
  day jsonb;
  hhmm text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  for loc in
    select l.id, l.hours from public.locations l
     where l.hours is not null and jsonb_typeof(l.hours) = 'object' and l.hours_status is null
       and not exists (select 1 from public.location_hours h where h.location_id = l.id)
  loop
    ok := true;
    open_days := 0;
    for i in 1..7 loop
      day := loc.hours -> wd[i];
      if day is null or jsonb_typeof(day) <> 'object' or jsonb_typeof(day -> 'closed') <> 'boolean' then
        ok := false;
      elsif (day ->> 'closed')::boolean then
        null;
      elsif jsonb_typeof(day -> 'allDay') = 'boolean' and (day ->> 'allDay')::boolean then
        open_days := open_days + 1;
      elsif coalesce(day ->> 'open', '') ~ hhmm and coalesce(day ->> 'close', '') ~ hhmm and (day ->> 'open') < (day ->> 'close') then
        open_days := open_days + 1;
      else
        ok := false;
      end if;
    end loop;
    if not ok then
      continue;
    end if;
    if open_days = 0 then
      insert into public.classification_suggestions (entity_type, entity_id, dimension, value, source, evidence)
      values ('location', loc.id, 'hours', '{"hours_status": "event_only"}'::jsonb, 'migration', 'Legacy hours mark every day closed — closed vs "no regular hours" (e.g. an event-only venue) needs review.')
      on conflict (entity_type, entity_id, dimension, md5(value::text)) where status = 'suggested' do nothing;
      continue;
    end if;
    for i in 1..7 loop
      day := loc.hours -> wd[i];
      if (day ->> 'closed')::boolean then
        continue;
      elsif jsonb_typeof(day -> 'allDay') = 'boolean' and (day ->> 'allDay')::boolean then
        insert into public.location_hours (location_id, weekday, open_minute, close_minute, source) values (loc.id, i, 0, 1440, 'migration');
      else
        insert into public.location_hours (location_id, weekday, open_minute, close_minute, source)
        values (loc.id, i,
          split_part(day ->> 'open', ':', 1)::int * 60 + split_part(day ->> 'open', ':', 2)::int,
          split_part(day ->> 'close', ':', 1)::int * 60 + split_part(day ->> 'close', ':', 2)::int,
          'migration');
      end if;
    end loop;
    update public.locations set hours_status = 'regular' where id = loc.id;
    insert into public.classification_field_sources (entity_type, entity_id, field, source) values ('location', loc.id, 'hours', 'migration'), ('location', loc.id, 'hours_status', 'migration')
    on conflict do nothing;
  end loop;
end $$;

-- 7i. Opportunity Category — each existing opportunity_type has exactly one
-- category ('other' has none). opportunity_category_id is V2-only.
with mapped as (
  update public.opportunity_listings o
     set opportunity_category_id = tt.id
    from (values ('activation', 'activation-sampling'), ('sampling_demo', 'activation-sampling'), ('vending', 'retail-vending'), ('sponsorship', 'sponsorship'), ('content', 'content-media'), ('partnership', 'partnerships')) v(opportunity_type, category_slug)
    join public.taxonomy_terms tt on tt.vocabulary = 'opportunity_category' and tt.slug = v.category_slug
   where o.opportunity_type = v.opportunity_type and o.opportunity_category_id is null
  returning o.id
)
insert into public.classification_field_sources (entity_type, entity_id, field, source)
select 'opportunity_listing', id, 'opportunity_category', 'migration' from mapped
on conflict do nothing;

drop table if exists pg_temp.tmp_v2_targets;
drop table if exists pg_temp.tmp_v2_legacy_links;

commit;
