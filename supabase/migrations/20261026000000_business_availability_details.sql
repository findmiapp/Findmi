-- Findmi Here — Where To Find Us: real-world availability details.
--
-- business_location_availability already answers WHERE ("this Business is
-- normally available at this third-party Location"). This adds the rest of
-- what an owner needs to say truthfully, without a new distribution system:
--
--   RELATIONSHIP  stocked | sold | served | featured | sampled
--   WHAT          which of the Business's own Products (join table; none =
--                 the Brand generally)
--   WHEN          starts_on / ends_on (both null = ongoing; ends_on only =
--                 "until"; both = a date range)
--   STATUS        pending (owner-submitted or owner-edited, awaiting Findmi
--                 review) | live | declined — ONLY live rows are ever public
--   SOURCE        admin (founder-entered) | business (owner-authored)
--
-- One row per (business, location) pair — the existing unique constraint is
-- kept on purpose: a Business has ONE relationship with a given place,
-- changed by editing it, never duplicated.
--
-- Additive: new defaulted columns, one new join table, triggers, indexes.
-- The one deliberate change to an existing object is the public-read policy,
-- TIGHTENED from `using (true)` to `status = 'live'`: without it the new
-- pending/declined rows would be readable by anyone holding the anon key.
-- Every existing row takes the default status 'live', so what is publicly
-- visible today does not change.
--
-- Writes remain service-role only (server actions, after the caller is
-- authorized as an owner/manager of the Business or as an Admin); anon and
-- authenticated get SELECT only, through the policies below.

-- ── Columns ────────────────────────────────────────────────────────────────
alter table public.business_location_availability
  add column if not exists relationship text not null default 'stocked',
  add column if not exists status text not null default 'live',
  add column if not exists source text not null default 'admin',
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists note text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_relationship_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_relationship_check
      check (relationship in ('stocked', 'sold', 'served', 'featured', 'sampled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_status_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_status_check
      check (status in ('pending', 'live', 'declined'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_source_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_source_check
      check (source in ('admin', 'business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_dates_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_dates_check
      check (starts_on is null or ends_on is null or ends_on >= starts_on);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_location_availability_note_check') then
    alter table public.business_location_availability
      add constraint business_location_availability_note_check
      check (note is null or char_length(note) <= 200);
  end if;
end $$;

-- ── Indexes (only what real queries use) ───────────────────────────────────
-- Already present: unique (business_id, location_id) — Business → places and
-- duplicate prevention; (location_id) — Location → brands available here.
-- New: the admin review queue ("every pending entry, oldest first"). Public
-- reads filter status = 'live' on top of those two existing indexes, so a
-- standalone status index would not help them.
create index if not exists business_location_availability_pending_idx
  on public.business_location_availability (created_at)
  where status = 'pending';

-- ── Integrity triggers ─────────────────────────────────────────────────────
-- 1. A row's identity never moves: re-pointing it at another Business or
--    Location would silently transfer a reviewed relationship.
-- 2. A Business never lists a place it operates ("Our Locations",
--    business_locations) as somewhere to find it — enforced here as well as in
--    the application, so no write path can create the pair.
create or replace function public.business_location_availability_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.business_id <> old.business_id or new.location_id <> old.location_id) then
    raise exception 'business_location_availability: business_id and location_id cannot be changed'
      using errcode = '23514';
  end if;
  -- Checked on every INSERT and whenever a row is (or becomes) live, so a pair
  -- that later turned into an Our Location can still be declined or edited down.
  if (tg_op = 'INSERT' or new.status = 'live') and exists (
    select 1 from public.business_locations bl
    where bl.business_id = new.business_id and bl.location_id = new.location_id
  ) then
    raise exception 'business_location_availability: this Business operates that Location (Our Locations)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_location_availability_guard on public.business_location_availability;
create trigger trg_business_location_availability_guard
  before insert or update on public.business_location_availability
  for each row execute function public.business_location_availability_guard();

-- Same already-in-production updated_at function other tables use.
drop trigger if exists trg_business_location_availability_updated_at on public.business_location_availability;
create trigger trg_business_location_availability_updated_at
  before update on public.business_location_availability
  for each row execute function public.set_updated_at();

-- ── Public read: LIVE rows only ────────────────────────────────────────────
drop policy if exists business_location_availability_public_read
  on public.business_location_availability;

create policy business_location_availability_public_read
  on public.business_location_availability
  for select
  to anon, authenticated
  using (status = 'live');

-- ── WHAT: which Products a row covers ──────────────────────────────────────
-- Cascades both ways on delete: removing an availability row or a Product
-- removes only the link. Empty = the Brand generally.
create table if not exists public.business_location_availability_products (
  availability_id uuid not null references public.business_location_availability(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (availability_id, product_id)
);

create index if not exists business_location_availability_products_product_idx
  on public.business_location_availability_products (product_id);

-- A linked Product must belong to the SAME Business as the availability row.
create or replace function public.business_location_availability_products_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.business_location_availability a
    join public.products p on p.business_id = a.business_id
    where a.id = new.availability_id and p.id = new.product_id
  ) then
    raise exception 'business_location_availability_products: the product must belong to the same Business'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_location_availability_products_guard on public.business_location_availability_products;
create trigger trg_business_location_availability_products_guard
  before insert or update on public.business_location_availability_products
  for each row execute function public.business_location_availability_products_guard();

alter table public.business_location_availability_products enable row level security;

drop policy if exists business_location_availability_products_public_read
  on public.business_location_availability_products;

-- Visible only while the parent row is live (the subquery runs under the
-- caller's own RLS, which already limits the parent to live rows; the explicit
-- predicate states the intent).
create policy business_location_availability_products_public_read
  on public.business_location_availability_products
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.business_location_availability a
      where a.id = availability_id and a.status = 'live'
    )
  );

revoke all on public.business_location_availability_products from anon, authenticated;
grant select on public.business_location_availability_products to anon, authenticated;
grant all on public.business_location_availability_products to service_role;
