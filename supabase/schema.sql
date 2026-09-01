-- ============================================================================
-- Findmi database schema
-- Run this in the Supabase SQL editor (or `supabase db push`) on a fresh
-- project. Safe to re-run: objects are created with IF NOT EXISTS / OR
-- REPLACE where practical.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- businesses
-- ----------------------------------------------------------------------------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  short_description text,
  description text,
  logo_url text,
  cover_image_url text,
  website_url text,
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  email text,
  phone text,
  city text,
  state text,
  country text default 'US',
  service_radius_miles integer,
  verified boolean not null default false,
  founding_member boolean not null default false,
  membership_status text not null default 'lead'
    check (membership_status in ('lead', 'active', 'past_due', 'canceled')),
  lead_status text not null default 'new'
    check (lead_status in ('new', 'contacted', 'onboarding', 'qualified', 'not_a_fit')),
  -- true for development/demo seed rows only — every public query filters
  -- these out. Real businesses default to false and need no extra step.
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null
);

-- ----------------------------------------------------------------------------
-- business_categories (join table)
-- ----------------------------------------------------------------------------
create table if not exists business_categories (
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (business_id, category_id)
);

-- ----------------------------------------------------------------------------
-- products (products / services offered by a business)
-- ----------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  image_url text,
  price numeric(10, 2),
  price_label text,
  product_type text not null default 'product'
    check (product_type in ('product', 'service')),
  external_purchase_url text,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  unique (business_id, slug)
);

-- ----------------------------------------------------------------------------
-- events (markets, pop-ups, festivals, etc. that group multiple businesses)
-- ----------------------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  cover_image_url text,
  start_at timestamptz not null,
  end_at timestamptz,
  venue_name text,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  organizer_name text,
  external_url text,
  is_featured boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- appearances ("Findmi Next" — where a business will physically be)
-- Can optionally be tied to a parent event, or stand alone (e.g. a food
-- truck's own solo stop that isn't part of a larger market).
-- ----------------------------------------------------------------------------
create table if not exists appearances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  event_id uuid references events(id) on delete set null,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  venue_name text,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'tentative', 'canceled')),
  is_featured boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- event_businesses (join table — "Who You'll Find There")
-- ----------------------------------------------------------------------------
create table if not exists event_businesses (
  event_id uuid not null references events(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  primary key (event_id, business_id)
);

-- ----------------------------------------------------------------------------
-- inquiries (consumer -> business booking / inquiry requests)
-- ----------------------------------------------------------------------------
create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  event_date date,
  event_type text,
  event_location text,
  guest_count integer,
  budget_range text,
  message text,
  allow_findmi_matching boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'booked', 'closed')),
  source text default 'findmi_profile',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- followers (consumer email/phone capture for "Where they'll be next")
-- ----------------------------------------------------------------------------
create table if not exists followers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

-- ----------------------------------------------------------------------------
-- locations (reusable named places — malls, parks, venues)
-- ----------------------------------------------------------------------------
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  is_demo boolean not null default false
);

-- ----------------------------------------------------------------------------
-- indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_products_business_id on products(business_id);
create index if not exists idx_appearances_business_id on appearances(business_id);
create index if not exists idx_appearances_event_id on appearances(event_id);
create index if not exists idx_appearances_start_at on appearances(start_at);
create index if not exists idx_events_start_at on events(start_at);
create index if not exists idx_event_businesses_event_id on event_businesses(event_id);
create index if not exists idx_event_businesses_business_id on event_businesses(business_id);
create index if not exists idx_inquiries_business_id on inquiries(business_id);
create index if not exists idx_followers_business_id on followers(business_id);
create index if not exists idx_businesses_city on businesses(city);

-- ----------------------------------------------------------------------------
-- updated_at trigger for businesses
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_businesses_updated_at on businesses;
create trigger trg_businesses_updated_at
  before update on businesses
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- V1 has no consumer/business auth yet, so we expose safe public read access
-- to discovery data and allow public inserts only on the two consumer-facing
-- capture tables (inquiries, followers). All other writes are expected to
-- happen via the Supabase dashboard or the service role key.
-- ----------------------------------------------------------------------------
alter table businesses enable row level security;
alter table categories enable row level security;
alter table business_categories enable row level security;
alter table products enable row level security;
alter table events enable row level security;
alter table appearances enable row level security;
alter table event_businesses enable row level security;
alter table inquiries enable row level security;
alter table followers enable row level security;
alter table locations enable row level security;

drop policy if exists "Public read businesses" on businesses;
create policy "Public read businesses" on businesses for select using (true);

drop policy if exists "Public read categories" on categories;
create policy "Public read categories" on categories for select using (true);

drop policy if exists "Public read business_categories" on business_categories;
create policy "Public read business_categories" on business_categories for select using (true);

drop policy if exists "Public read active products" on products;
create policy "Public read active products" on products for select using (is_active = true);

drop policy if exists "Public read events" on events;
create policy "Public read events" on events for select using (true);

drop policy if exists "Public read appearances" on appearances;
create policy "Public read appearances" on appearances for select using (status <> 'canceled');

drop policy if exists "Public read event_businesses" on event_businesses;
create policy "Public read event_businesses" on event_businesses for select using (true);

drop policy if exists "Public read locations" on locations;
create policy "Public read locations" on locations for select using (true);

-- Inquiries & followers: public can insert (consumer forms), but not read
-- back other people's submissions.
drop policy if exists "Public insert inquiries" on inquiries;
create policy "Public insert inquiries" on inquiries for insert with check (true);

drop policy if exists "Public insert followers" on followers;
create policy "Public insert followers" on followers for insert with check (true);

-- Note: inquiries/followers have no public select policy, so anon reads
-- return zero rows. Use the service role key (server-side only) or the
-- Supabase dashboard to review submissions.

-- ----------------------------------------------------------------------------
-- Security Pass 1 — restrict internal-only commerce columns from anon/
-- authenticated (see migrations/20260831000000_restrict_internal_commerce_columns.sql
-- for the full rationale). RLS above still governs row-level visibility;
-- this layer additionally restricts which COLUMNS anon/authenticated can
-- read on businesses/products, since RLS alone does not.
-- ----------------------------------------------------------------------------
revoke select on businesses from anon, authenticated;
grant select (
  id, slug, name, short_description, description, logo_url, cover_image_url,
  website_url, instagram_url, facebook_url, tiktok_url, email, phone, city,
  state, country, service_radius_miles, verified, founding_member,
  membership_status, created_at, updated_at, is_demo, commerce_enabled,
  publication_status, is_featured, inquiry_cta_label, inquiry_cta_url,
  cta_1_label, cta_1_url, cta_1_enabled, cta_2_label, cta_2_url,
  cta_2_enabled, cta_3_label, cta_3_url, cta_3_enabled, bulletin_enabled,
  bulletin_heading, bulletin_body, bulletin_label, bulletin_url
) on businesses to anon, authenticated;
-- Internal-only, not granted: lead_status, marketplace_fee_percent,
-- processing_fee_payer, payout_method, stripe_account_id, stripe_connect_status

revoke select on products from anon, authenticated;
grant select (
  id, business_id, name, slug, description, image_url, price, price_label,
  product_type, external_purchase_url, is_featured, is_active, purchasable,
  inventory_status, home_sort_order, profile_sort_order
) on products to anon, authenticated;
-- Internal-only, not granted: marketplace_fee_override_percent,
-- processing_fee_payer_override
