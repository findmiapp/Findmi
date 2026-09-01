-- Taxonomy foundation: splits the single shared `categories` table into
-- three explicit domains (business / event / product) via a `kind`
-- column, adds first-class product categories (product_categories), and
-- adds a one-level nullable parent/child relationship for future
-- subcategories. Written to be safely re-runnable (IF NOT EXISTS /
-- ON CONFLICT DO NOTHING throughout).
--
-- ----------------------------------------------------------------------
-- Existing production categories, classified by ACTUAL usage
-- (business_categories / event_categories row counts, inspected live
-- immediately before writing this migration — nothing here is guessed):
--
--   Coffee            (coffee)          — business only (3 businesses, 0 events)
--   Flowers           (flowers)         — business only (2 businesses, 0 events)
--   Food & Drink      (food-drink)      — business only (6 businesses, 0 events)
--   Food Truck        (food-truck)      — business only (3 businesses, 0 events)
--   Makers & Goods    (makers-goods)    — business only (5 businesses, 0 events)
--   Packaged Goods    (packaged-goods)  — business only (1 business, 0 events)
--   Markets & Pop-Ups (markets-pop-ups) — BOTH: 1 business (Wildflower
--     Market Co.) AND 2 events. This is the one category genuinely used
--     across domains, so it is split below: the original row keeps its id
--     and becomes kind='business' (business_categories is untouched — same
--     id, same relationship, zero rows changed), and a new kind='event'
--     row is created with the same name/slug (uniqueness becomes scoped
--     per-kind, not global — see step 5) to take over the two existing
--     event_categories rows, which are repointed onto it in step 6.
--
-- No category had zero usage in either domain, so nothing here was
-- classified by guesswork — every row's kind is a direct, verified
-- consequence of its real business_categories/event_categories rows.
-- ----------------------------------------------------------------------

-- 1. Add `kind`, nullable for now so existing rows can be backfilled
--    deliberately (step 3) before it's enforced NOT NULL (step 4).
alter table public.categories add column if not exists kind text;

-- 2. One-level, same-kind parent/child relationship for future
--    subcategories — see the trigger in step 8 for the "same kind" and
--    "one level only" rules, which a plain CHECK constraint can't express
--    (it would need to read another row). Not exposed in any admin UI in
--    this pass — structural prep only.
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;

-- 3. Backfill every existing category as kind='business'. Per the
--    classification above, every current row (including the one dual-use
--    row) is correct as kind='business' — the dual-use row's event-side
--    usage is moved to a brand new row in step 6, not this one.
update public.categories set kind = 'business' where kind is null;

-- 4. Now that every row has a kind, enforce it.
alter table public.categories alter column kind set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_kind_check'
  ) then
    alter table public.categories add constraint categories_kind_check check (kind in ('business', 'event', 'product'));
  end if;
end $$;

-- 5. Slugs were globally unique; they're now unique per kind instead, so
--    e.g. "markets-pop-ups" can exist once for business and once for
--    event without colliding.
alter table public.categories drop constraint if exists categories_slug_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_slug_kind_key'
  ) then
    alter table public.categories add constraint categories_slug_kind_key unique (kind, slug);
  end if;
end $$;

create index if not exists idx_categories_kind on public.categories (kind);
create index if not exists idx_categories_parent_id on public.categories (parent_id) where parent_id is not null;

-- 6. Split "Markets & Pop-Ups": create its event-kind twin, then repoint
--    the two existing event_categories rows onto it. The original row
--    (id 22222222-2222-4222-8222-222222222204) stays kind='business' and
--    business_categories is left completely untouched.
insert into public.categories (name, slug, kind, show_on_home, home_sort_order)
select name, slug, 'event', false, null
from public.categories
where id = '22222222-2222-4222-8222-222222222204'
on conflict (kind, slug) do nothing;

update public.event_categories
set category_id = (select id from public.categories where slug = 'markets-pop-ups' and kind = 'event')
where category_id = '22222222-2222-4222-8222-222222222204';

-- 7. First-class product categories — a real join table (a product can
--    have multiple categories), separate from and additional to the
--    business/event joins above, which are not replaced.
create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (product_id, category_id)
);
create index if not exists idx_product_categories_category_id on public.product_categories (category_id);

alter table public.product_categories enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'product_categories' and policyname = 'Public read product_categories'
  ) then
    create policy "Public read product_categories" on public.product_categories for select to public using (true);
  end if;
end $$;

-- 8. Enforce the parent/child rules a CHECK constraint can't express:
--    same kind as parent, and only one level of nesting.
create or replace function public.enforce_category_hierarchy()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  parent_kind text;
  parent_parent_id uuid;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a category cannot be its own parent';
    end if;
    select kind, parent_id into parent_kind, parent_parent_id
    from public.categories where id = new.parent_id;
    if parent_kind is null then
      raise exception 'parent_id % does not reference an existing category', new.parent_id;
    end if;
    if parent_kind <> new.kind then
      raise exception 'a category (kind=%) cannot have a parent of a different kind (%)', new.kind, parent_kind;
    end if;
    if parent_parent_id is not null then
      raise exception 'category hierarchy is limited to one level — % is already a subcategory', new.parent_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_categories_hierarchy on public.categories;
create trigger trg_categories_hierarchy
before insert or update of parent_id, kind on public.categories
for each row execute function public.enforce_category_hierarchy();

-- 9. Small, sensible initial set of product-kind categories — structural
--    foundation plus just enough real rows to test admin creation,
--    assignment, and label display. Deliberately generic and small, not
--    an exhaustive taxonomy (see task scope).
insert into public.categories (name, slug, kind, show_on_home, home_sort_order)
values
  ('Food & Beverage', 'food-beverage', 'product', false, null),
  ('Apparel & Accessories', 'apparel-accessories', 'product', false, null),
  ('Home & Living', 'home-living', 'product', false, null)
on conflict (kind, slug) do nothing;
