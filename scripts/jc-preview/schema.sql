-- JC local preview — database schema.
--
-- GENERATED, READ-ONLY SNAPSHOT of the Production `public` schema (tables,
-- column defaults, primary/unique/foreign keys, views and the one public
-- read RPC), taken from the Postgres catalog. It exists only so Findmi's
-- real pages can render locally against a throwaway database
-- (scripts/jc-preview/start.sh). It is never applied to any Supabase
-- project. RLS policies, triggers and CHECK constraints are intentionally
-- omitted: this database only ever holds preview content.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- Minimal Supabase stand-ins.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'preview'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.access_events (
  id uuid default gen_random_uuid() not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  subject_user_id uuid,
  actor_kind text not null,
  actor_user_id uuid,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_entitlements (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  entitlement_key text not null,
  source text not null,
  granted_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone
);
create table public.account_followed_businesses (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  business_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_followed_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  event_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_followed_locations (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_saved_businesses (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  business_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_saved_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  event_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_saved_locations (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.account_saved_products (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  product_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.activation_inventory (
  id uuid default gen_random_uuid() not null,
  activation_id uuid not null,
  venue_id uuid,
  kind text not null,
  name text not null,
  description text,
  image_url text,
  capacity integer,
  price_type text default 'fixed'::text not null,
  price_amount numeric,
  price_label text,
  internal_estimated_value numeric,
  price_visibility text,
  relevant_category_ids uuid[],
  requirements text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.activation_options (
  id uuid default gen_random_uuid() not null,
  activation_id uuid not null,
  kind text not null,
  label text not null,
  description text,
  icon_or_image_url text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.activation_venues (
  id uuid default gen_random_uuid() not null,
  activation_id uuid not null,
  location_id uuid,
  name text,
  city text,
  region text,
  country_code text,
  timezone text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  is_primary boolean default false not null,
  sort_order integer default 0 not null,
  status text default 'planned'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.activations (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  internal_name text not null,
  public_name text not null,
  concept_label text,
  short_description text,
  description text,
  cover_image_url text,
  phase text default 'draft'::text not null,
  is_published boolean default false not null,
  publish_at timestamp with time zone,
  city text,
  region text,
  country_code text,
  default_timezone text default 'America/New_York'::text not null,
  market_id uuid,
  market_area_id uuid,
  currency_code text default 'USD'::text not null,
  default_price_visibility text default 'visible'::text not null,
  target_revenue numeric,
  minimum_committed_threshold numeric,
  target_brand_count integer,
  anchor_partner_target integer,
  venue_budget_ceiling numeric,
  production_budget_ceiling numeric,
  decision_deadline date,
  operator_type text default 'findmi'::text not null,
  operator_business_id uuid,
  meta_title text,
  meta_description text,
  og_image_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.admin_intelligence_reviews (
  signal_type text not null,
  signal_id uuid not null,
  reviewed_at timestamp with time zone default now() not null
);
create table public.analytics_events (
  id uuid default gen_random_uuid() not null,
  event_name text not null,
  subject_type text,
  subject_id uuid,
  business_id uuid,
  event_id uuid,
  event_occurrence_id uuid,
  appearance_id uuid,
  location_id uuid,
  product_id uuid,
  discovery_page_id uuid,
  discovery_section_id uuid,
  page_type text,
  page_path text,
  placement text,
  session_id uuid not null,
  user_id uuid,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  metadata jsonb default '{}'::jsonb not null,
  occurred_at timestamp with time zone default now() not null,
  qr_campaign_id uuid,
  acquisition_source text,
  acquisition_qr_campaign_id uuid,
  discovery_topic_id uuid,
  market_area_id uuid
);
create table public.appearances (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  event_id uuid,
  title text not null,
  description text,
  start_at timestamp with time zone not null,
  end_at timestamp with time zone,
  venue_name text,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  status text default 'confirmed'::text not null,
  is_featured boolean default false not null,
  created_at timestamp with time zone default now() not null,
  bulletin_text text,
  show_on_home boolean default false not null,
  home_sort_order integer,
  external_url text,
  flyer_image_url text,
  event_occurrence_id uuid,
  source text default 'manual'::text not null,
  admin_reviewed_at timestamp with time zone,
  market_id uuid,
  market_area_id uuid,
  location_id uuid,
  geo_place_key text,
  geo_state_key text,
  geo_resolution text
);
create table public.billing_sync_anomalies (
  id uuid default gen_random_uuid() not null,
  anomaly_type text not null,
  stripe_event_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  business_id uuid,
  payer_user_id uuid,
  livemode boolean not null,
  details jsonb default '{}'::jsonb not null,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
create table public.brand_audit_answers (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  kind text not null,
  option_key text not null,
  detail text,
  updated_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  source text default 'declared'::text not null
);
create table public.brand_audit_markets (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  intent text not null,
  level text not null,
  market_id uuid,
  market_area_id uuid,
  place_key text not null,
  label text not null,
  source text default 'declared'::text not null,
  updated_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  geo_key text
);
create table public.brand_audits (
  business_id uuid not null,
  status text default 'in_progress'::text not null,
  completed_at timestamp with time zone,
  updated_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.brand_import_batches (
  id uuid default gen_random_uuid() not null,
  submitted_count smallint not null,
  created_at timestamp with time zone default now() not null
);
create table public.brand_import_candidates (
  id uuid default gen_random_uuid() not null,
  batch_id uuid not null,
  "position" smallint not null,
  submitted_input text not null,
  normalized_host text,
  status text default 'queued'::text not null,
  failure_code text,
  attempt_count smallint default 0 not null,
  processing_started_at timestamp with time zone,
  proposal jsonb,
  matched_business_id uuid,
  created_business_id uuid,
  ai_status text,
  ai_model text,
  ai_input_tokens integer,
  ai_output_tokens integer,
  ai_cache_creation_input_tokens integer,
  ai_cache_read_input_tokens integer,
  ai_estimated_cost_usd numeric(10,6),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.business_categories (
  business_id uuid not null,
  category_id uuid not null
);
create table public.business_claim_requests (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  business_id uuid not null,
  status text default 'pending'::text not null,
  message text,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  payment_status text default 'unpaid'::text not null,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);
create table public.business_images (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  url text not null,
  display_order integer,
  created_at timestamp with time zone default now() not null
);
create table public.business_intelligence_notes (
  business_id uuid not null,
  note text default ''::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.business_location_availability (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  location_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.business_locations (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  location_id uuid not null,
  is_primary boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table public.business_market_areas (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  market_id uuid not null,
  market_area_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.business_markets (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  market_id uuid not null,
  relationship text not null,
  provenance text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);
create table public.business_members (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  business_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);
create table public.business_opportunity_goals (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  title text not null,
  status text default 'active'::text not null,
  objectives text[] default '{}'::text[] not null,
  opportunity_interests text[] default '{}'::text[] not null,
  audience_text text,
  market_ids uuid[] default '{}'::uuid[] not null,
  markets_text text,
  budget_band text default 'not_sure'::text not null,
  budget_min_cents integer,
  budget_max_cents integer,
  timing text default 'flexible'::text not null,
  starts_on date,
  ends_on date,
  notes text,
  created_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.business_people (
  business_id uuid not null,
  person_id uuid not null,
  role text,
  display_order integer,
  featured boolean default false not null,
  show_on_business boolean default true not null
);
create table public.business_pro_access_requests (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  requested_by_user_id uuid not null,
  status text default 'pending'::text not null,
  message text,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  admin_note text
);
create table public.business_subscriptions (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  payer_user_id uuid not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_price_id text not null,
  commercial_plan text not null,
  billing_interval text not null,
  status text not null,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false not null,
  canceled_at timestamp with time zone,
  latest_invoice_status text,
  livemode boolean not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_stripe_event_id text,
  last_stripe_event_created timestamp with time zone
);
create table public.businesses (
  id uuid default gen_random_uuid() not null,
  slug text not null,
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
  country text default 'US'::text,
  service_radius_miles integer,
  verified boolean default false not null,
  founding_member boolean default false not null,
  membership_status text default 'lead'::text not null,
  lead_status text default 'new'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_demo boolean default false not null,
  commerce_enabled boolean default false not null,
  marketplace_fee_percent numeric(5,2) default 5.00 not null,
  processing_fee_payer text default 'vendor'::text not null,
  payout_method text default 'manual'::text not null,
  stripe_account_id text,
  stripe_connect_status text,
  publication_status text default 'live'::text not null,
  is_featured boolean default false not null,
  inquiry_cta_label text,
  inquiry_cta_url text,
  cta_1_label text,
  cta_1_url text,
  cta_1_enabled boolean default false not null,
  cta_2_label text,
  cta_2_url text,
  cta_2_enabled boolean default false not null,
  cta_3_label text,
  cta_3_url text,
  cta_3_enabled boolean default false not null,
  bulletin_enabled boolean default false not null,
  bulletin_heading text,
  bulletin_body text,
  bulletin_label text,
  bulletin_url text,
  plan_tier text default 'free'::text not null,
  plan_source text,
  plan_started_at timestamp with time zone,
  plan_expires_at timestamp with time zone,
  plan_payment_reference text,
  native_inquiries_enabled boolean default false not null,
  market_area_id uuid,
  is_pro_member boolean,
  postal_code text,
  accepts_inquiries boolean default false not null,
  inquiry_topics text[] default '{}'::text[] not null,
  archived_at timestamp with time zone,
  trashed_at timestamp with time zone,
  managed_service_status text default 'none'::text not null,
  featured_event_id uuid,
  featured_appearance_id uuid,
  geo_place_key text,
  geo_zcta_key text,
  geo_state_key text,
  geo_resolution text
);
create table public.categories (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  show_on_home boolean default false not null,
  home_sort_order integer,
  kind text not null,
  parent_id uuid
);
create table public.census_geographies (
  geo_key text not null,
  kind text not null,
  geoid text not null,
  name text not null,
  display_name text not null,
  search_names text[] default '{}'::text[] not null,
  lsad text,
  funcstat text,
  state_fips text,
  state_usps text,
  intpt_lat double precision,
  intpt_lng double precision,
  aland_m2 bigint,
  vintage text not null,
  retired_vintage text,
  updated_at timestamp with time zone default now() not null
);
create table public.census_geography_links (
  child_key text not null,
  parent_key text not null,
  relation text not null,
  land_share double precision,
  vintage text not null
);
create table public.census_imports (
  id uuid default gen_random_uuid() not null,
  vintage text not null,
  dataset text not null,
  source_url text not null,
  source_vintage text,
  sha256 text,
  status text default 'pending'::text not null,
  cursor integer default 0 not null,
  rows_read integer default 0 not null,
  rows_upserted integer default 0 not null,
  rows_retired integer default 0 not null,
  error text,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone
);
create table public.conversation_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  sender_participant_id uuid,
  kind text default 'note'::text not null,
  body text not null,
  created_at timestamp with time zone default now() not null
);
create table public.conversation_participants (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  user_id uuid not null,
  entity_type text not null,
  entity_id uuid,
  created_at timestamp with time zone default now() not null
);
create table public.conversations (
  id uuid default gen_random_uuid() not null,
  subject_type text not null,
  subject_id uuid not null,
  created_at timestamp with time zone default now() not null,
  guest_name text,
  guest_email text,
  guest_phone text
);
create table public.discovery_lanes (
  id uuid default gen_random_uuid() not null,
  page_id uuid not null,
  title text not null,
  subtitle text,
  kind text not null,
  topic_ids uuid[] default '{}'::uuid[] not null,
  topic_id uuid,
  market_id uuid,
  item_limit integer default 12 not null,
  sort_order integer default 100 not null,
  is_visible boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  placement text default 'explore_more'::text not null
);
create table public.discovery_pages (
  id uuid default gen_random_uuid() not null,
  internal_name text not null,
  title text not null,
  slug text not null,
  description text,
  is_published boolean default false not null,
  is_system boolean default false not null,
  category_slug text,
  market_slug text,
  area_slug text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  market_id uuid,
  market_area_id uuid
);
create table public.discovery_topics (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  description text,
  image_url text,
  aliases text[] default '{}'::text[] not null,
  query jsonb default '{}'::jsonb not null,
  is_active boolean default true not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.event_businesses (
  event_id uuid not null,
  business_id uuid not null,
  status text default 'approved'::text not null,
  featured boolean default false not null,
  offering_text text,
  display_order integer,
  participation_scope text
);
create table public.event_categories (
  event_id uuid not null,
  category_id uuid not null
);
create table public.event_claim_requests (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  event_id uuid not null,
  status text default 'pending'::text not null,
  message text,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  payment_status text default 'unpaid'::text not null,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);
create table public.event_followers (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  email text not null,
  phone text,
  created_at timestamp with time zone default now() not null
);
create table public.event_formats (
  event_id uuid not null,
  category_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.event_images (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  kind text default 'event'::text not null,
  url text not null,
  display_order integer,
  created_at timestamp with time zone default now() not null
);
create table public.event_members (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  event_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);
create table public.event_occurrence_businesses (
  id uuid default gen_random_uuid() not null,
  occurrence_id uuid not null,
  business_id uuid not null,
  status text default 'approved'::text not null,
  featured boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.event_occurrences (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  location_id uuid,
  featured boolean default false not null,
  status text default 'scheduled'::text not null,
  ticket_url_override text,
  vendor_apply_url_override text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  rsvp_url_override text,
  timezone text default 'America/New_York'::text not null,
  market_id uuid,
  venue_name text,
  address text,
  city text,
  state text,
  postal_code text,
  details text,
  occurrence_date date not null,
  geo_place_key text,
  geo_zcta_key text,
  geo_state_key text,
  geo_resolution text
);
create table public.event_products (
  event_id uuid not null,
  product_id uuid not null,
  display_order integer,
  created_at timestamp with time zone default now() not null
);
create table public.events (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  description text,
  cover_image_url text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  venue_name text,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  organizer_name text,
  external_url text,
  is_featured boolean default false not null,
  created_at timestamp with time zone default now() not null,
  is_demo boolean default false not null,
  follow_enabled boolean default false not null,
  rsvp_enabled boolean default false not null,
  rsvp_url text,
  tickets_enabled boolean default false not null,
  tickets_url text,
  vendor_applications_enabled boolean default false not null,
  vendor_application_url text,
  vendor_application_deadline timestamp with time zone,
  contact_enabled boolean default false not null,
  organizer_email text,
  contact_url text,
  directions_enabled boolean default true not null,
  featured_sort_order integer,
  featured_products_heading text,
  bulletin_enabled boolean default false not null,
  bulletin_heading text,
  bulletin_body text,
  market_id uuid,
  market_area_id uuid,
  publication_status text default 'live'::text not null,
  postal_code text,
  archived_at timestamp with time zone,
  trashed_at timestamp with time zone,
  show_on_homepage boolean default false not null,
  host_business_id uuid,
  rsvp_cta text,
  location_visibility text,
  start_date date not null,
  end_date date,
  is_free boolean,
  family_friendly boolean,
  geo_place_key text,
  geo_zcta_key text,
  geo_state_key text,
  geo_resolution text
);
create table public.followers (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  email text not null,
  phone text,
  created_at timestamp with time zone default now() not null
);
create table public.form_assignments (
  id uuid default gen_random_uuid() not null,
  form_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  purpose text not null,
  created_at timestamp with time zone default now() not null
);
create table public.forms (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  purpose text not null,
  provider text default 'tally'::text not null,
  form_url text not null,
  display_mode text default 'external'::text not null,
  is_active boolean default true not null,
  is_default boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.handles (
  id uuid default gen_random_uuid() not null,
  handle text not null,
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.homepage_bulletins (
  id uuid default gen_random_uuid() not null,
  eyebrow text,
  headline text not null,
  supporting_text text,
  meta_text text,
  thumbnail_url text,
  cta_text text,
  destination_type text,
  destination_id uuid,
  destination_url text,
  is_published boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  display_order integer default 0 not null
);
create table public.homepage_rows (
  id uuid default gen_random_uuid() not null,
  title text not null,
  subtitle text,
  content_type text,
  mode text default 'dynamic'::text not null,
  category_slug text,
  featured_only boolean default false not null,
  time_window text,
  item_limit integer default 8 not null,
  curated_ids uuid[] default '{}'::uuid[] not null,
  is_visible boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  page_id uuid not null,
  parent_id uuid,
  pinned_ids uuid[] default '{}'::uuid[] not null,
  section_type text default 'feed'::text not null,
  market_slug text,
  area_slug text
);
create table public.inquiries (
  id uuid default gen_random_uuid() not null,
  business_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  event_date date,
  event_type text,
  event_location text,
  guest_count integer,
  budget_range text,
  message text,
  allow_findmi_matching boolean default false not null,
  status text default 'new'::text not null,
  source text default 'findmi_profile'::text,
  created_at timestamp with time zone default now() not null,
  user_id uuid,
  product_id uuid,
  customer_last_read_at timestamp with time zone,
  business_last_read_at timestamp with time zone
);
create table public.inquiry_messages (
  id uuid default gen_random_uuid() not null,
  inquiry_id uuid not null,
  sender_type text not null,
  sender_user_id uuid,
  body text not null,
  created_at timestamp with time zone default now() not null
);
create table public.journal_entries (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  entry_date date not null,
  entry_time time without time zone,
  notes text,
  location_id uuid,
  visibility text default 'private'::text not null,
  status text default 'draft'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  manual_location_name text,
  manual_location_address text,
  manual_location_city text,
  manual_location_state text,
  manual_location_zip text,
  manual_location_suggested boolean default false not null,
  author_label text,
  author_business_id uuid
);
create table public.journal_entry_connections (
  id uuid default gen_random_uuid() not null,
  journal_entry_id uuid not null,
  business_id uuid,
  product_id uuid,
  event_id uuid,
  created_at timestamp with time zone default now() not null,
  event_occurrence_id uuid
);
create table public.journal_entry_media (
  id uuid default gen_random_uuid() not null,
  journal_entry_id uuid not null,
  storage_path text not null,
  display_order integer default 0 not null,
  is_cover boolean default false not null,
  caption text,
  created_at timestamp with time zone default now() not null,
  section_id uuid
);
create table public.journal_entry_sections (
  id uuid default gen_random_uuid() not null,
  journal_entry_id uuid not null,
  section_type text not null,
  title text,
  notes text,
  display_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.location_claim_requests (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  location_id uuid not null,
  status text default 'pending'::text not null,
  message text,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  payment_status text default 'unpaid'::text not null,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);
create table public.location_followers (
  id uuid default gen_random_uuid() not null,
  location_id uuid not null,
  email text not null,
  phone text,
  created_at timestamp with time zone default now() not null
);
create table public.location_images (
  id uuid default gen_random_uuid() not null,
  location_id uuid not null,
  url text not null,
  display_order integer,
  created_at timestamp with time zone default now() not null
);
create table public.location_members (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  location_id uuid not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);
create table public.locations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  is_demo boolean default false not null,
  market_id uuid,
  description text,
  website_url text,
  email text,
  phone text,
  cover_image_url text,
  market_area_id uuid,
  postal_code text,
  logo_url text,
  hours jsonb,
  category_id uuid,
  archived_at timestamp with time zone,
  trashed_at timestamp with time zone,
  featured_event_id uuid,
  parent_location_id uuid,
  place_type text,
  geo_place_key text,
  geo_zcta_key text,
  geo_state_key text,
  geo_resolution text
);
create table public.market_areas (
  id uuid default gen_random_uuid() not null,
  market_id uuid not null,
  name text not null,
  slug text not null,
  display_name text,
  aliases text[],
  active boolean default true not null,
  consumer_visible boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  parent_area_id uuid,
  level text default 'area'::text not null,
  image_url text
);
create table public.market_request_interests (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  user_id uuid,
  email text,
  created_at timestamp with time zone default now() not null
);
create table public.market_requests (
  id uuid default gen_random_uuid() not null,
  requested_text text not null,
  city text,
  state text,
  country text default 'US'::text,
  normalized_key text not null,
  requester_user_id uuid,
  requester_email text,
  source text not null,
  source_business_id uuid,
  source_event_id uuid,
  status text default 'pending'::text not null,
  mapped_market_id uuid,
  admin_note text,
  created_at timestamp with time zone default now() not null,
  reviewed_at timestamp with time zone,
  canonical_text text,
  effective_normalized_key text not null,
  mapped_area_id uuid,
  resolution_type text,
  source_location_id uuid,
  geo_key text
);
create table public.markets (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  display_name text,
  description text,
  areas_included text[],
  consumer_visible boolean default true not null
);
create table public.media_variants (
  bucket text not null,
  original_path text not null,
  variants jsonb not null,
  role text,
  generated_at timestamp with time zone default now() not null
);
create table public.membership_markets (
  membership_id uuid not null,
  market_id uuid not null
);
create table public.membership_plans (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  annual_price numeric(10,2) not null,
  active boolean default true not null,
  publicly_available boolean default true not null,
  market_limit integer,
  description text,
  sort_order integer default 0 not null,
  featured_placement_eligible boolean default false not null,
  enhanced_profile boolean default false not null,
  campaign_eligible boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table public.memberships (
  id uuid default gen_random_uuid() not null,
  business_id uuid,
  plan_id uuid,
  billing_status text default 'pending_payment'::text not null,
  onboarding_status text default 'not_started'::text not null,
  publication_status text default 'draft'::text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  intended_business_name text,
  existing_business_id uuid,
  started_at timestamp with time zone,
  renews_at timestamp with time zone,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  founding_price_locked boolean default false not null,
  admin_notes text,
  invite_token text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.nav_items (
  id uuid default gen_random_uuid() not null,
  label text not null,
  destination_type text default 'route'::text not null,
  route_key text,
  custom_href text,
  group_label text,
  icon_key text,
  is_visible boolean default true not null,
  is_highlight boolean default false not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  parent_id uuid,
  audience text default 'everyone'::text not null
);
create table public.opportunities (
  id uuid default gen_random_uuid() not null,
  type text not null,
  event_id uuid not null,
  event_occurrence_id uuid,
  business_id uuid not null,
  initiator_user_id uuid not null,
  initiator_entity_type text not null,
  initiator_entity_id uuid not null,
  status text default 'pending'::text not null,
  conversation_id uuid,
  created_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);
create table public.opportunity_idea_businesses (
  idea_id uuid not null,
  business_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.opportunity_idea_responses (
  id uuid default gen_random_uuid() not null,
  idea_id uuid not null,
  business_id uuid not null,
  response text not null,
  note text,
  responded_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.opportunity_ideas (
  id uuid default gen_random_uuid() not null,
  title text not null,
  summary text not null,
  details text,
  idea_type text default 'other'::text not null,
  status text default 'draft'::text not null,
  display_order integer default 100 not null,
  audience text default 'all_brands'::text not null,
  seed_key text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.opportunity_listings (
  id uuid default gen_random_uuid() not null,
  status text default 'draft'::text not null,
  opportunity_type text not null,
  title text not null,
  summary text,
  description text,
  image_url text,
  location_id uuid,
  place_text text,
  host_name text,
  event_id uuid,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  timing_note text,
  response_deadline timestamp with time zone,
  pricing_mode text not null,
  price_cents integer,
  currency text default 'USD'::text not null,
  credits_eligible boolean default false not null,
  whats_included text,
  requirements text,
  internal_notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  visibility text default 'private'::text not null
);
create table public.opportunity_option_components (
  id uuid default gen_random_uuid() not null,
  option_id uuid not null,
  component_type text not null,
  amount_mode text,
  amount_min_cents integer,
  amount_max_cents integer,
  currency text,
  in_kind_category text,
  in_kind_description text,
  in_kind_provider text,
  in_kind_required boolean default true not null,
  estimated_value_cents integer,
  display_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  quantity numeric(10,2),
  unit text,
  custom_unit_label text,
  unit_value_cents integer
);
create table public.opportunity_options (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  name text,
  description text,
  commercial_mode text default 'structured'::text not null,
  custom_terms_note text,
  display_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.opportunity_recipients (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  business_id uuid not null,
  status text default 'offered'::text not null,
  fit_note text,
  response_note text,
  internal_notes text,
  offered_at timestamp with time zone default now() not null,
  responded_at timestamp with time zone,
  responded_by_user_id uuid,
  status_changed_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product_id uuid not null,
  business_id uuid not null,
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null,
  line_merchandise_total numeric(10,2) not null,
  fulfillment_method text not null,
  fulfillment_amount numeric(10,2) default 0 not null,
  appearance_id uuid,
  event_id uuid,
  marketplace_fee_percent numeric(5,2) not null,
  marketplace_fee_amount numeric(10,2) not null,
  applied_fee_source text default 'marketplace_default'::text not null,
  processing_fee_payer text not null,
  allocated_processing_fee_amount numeric(10,2) default 0 not null,
  vendor_gross numeric(10,2) not null,
  vendor_net numeric(10,2) not null,
  source_channel text,
  fulfillment_status text default 'new'::text not null,
  refunded_amount numeric(10,2) default 0 not null,
  created_at timestamp with time zone default now() not null,
  internal_note text
);
create table public.orders (
  id uuid default gen_random_uuid() not null,
  order_number text not null,
  customer_email text not null,
  customer_name text,
  customer_phone text,
  currency text default 'usd'::text not null,
  merchandise_subtotal numeric(10,2) default 0 not null,
  fulfillment_total numeric(10,2) default 0 not null,
  customer_processing_fee_total numeric(10,2) default 0 not null,
  total_charged numeric(10,2) default 0 not null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_processing_fee_amount numeric(10,2),
  payment_status text default 'pending'::text not null,
  refund_status text default 'none'::text not null,
  source_event_id uuid,
  source_appearance_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  user_id uuid
);
create table public.people (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  image_url text,
  short_bio text,
  location text,
  instagram_url text,
  website_url text,
  is_public boolean default true not null,
  is_featured boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.plan_market_limits (
  plan_tier text not null,
  market_limit integer,
  updated_at timestamp with time zone default now() not null
);
create table public.pro_invite_redemptions (
  id uuid default gen_random_uuid() not null,
  invite_id uuid not null,
  business_id uuid not null,
  redeemed_by uuid not null,
  redeemed_at timestamp with time zone default now() not null,
  previous_plan_tier text,
  granted_plan_tier text not null,
  granted_until timestamp with time zone not null
);
create table public.pro_invites (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text,
  plan_tier text default 'pro'::text not null,
  duration_days integer default 365 not null,
  max_redemptions integer,
  redemption_count integer default 0 not null,
  expires_at timestamp with time zone,
  is_active boolean default true not null,
  created_by_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  grant_purpose text default 'business_pro'::text not null
);
create table public.product_categories (
  product_id uuid not null,
  category_id uuid not null
);
create table public.product_fulfillment_options (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  method text not null,
  price numeric(10,2) default 0 not null,
  enabled boolean default true not null,
  appearance_id uuid,
  created_at timestamp with time zone default now() not null
);
create table public.product_geographies (
  id uuid default gen_random_uuid() not null,
  market_id uuid not null,
  market_area_id uuid,
  geo_key text not null,
  role text not null,
  created_at timestamp with time zone default now() not null
);
create table public.products (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  image_url text,
  price numeric(10,2),
  price_label text,
  product_type text default 'product'::text not null,
  external_purchase_url text,
  is_featured boolean default false not null,
  is_active boolean default true not null,
  purchasable boolean default false not null,
  inventory_status text,
  marketplace_fee_override_percent numeric(5,2),
  processing_fee_payer_override text,
  home_sort_order integer,
  profile_sort_order integer,
  moderation_status text default 'live'::text not null,
  pending_changes jsonb,
  marketplace_status text default 'catalog_only'::text not null,
  marketplace_submitted_at timestamp with time zone,
  marketplace_approved_at timestamp with time zone,
  archived_at timestamp with time zone,
  trashed_at timestamp with time zone
);
create table public.profiles (
  id uuid not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  username text,
  bio text,
  location_label text,
  email_verified_at timestamp with time zone,
  phone text
);
create table public.qr_campaigns (
  id uuid default gen_random_uuid() not null,
  name text not null,
  code text not null,
  business_id uuid,
  event_id uuid,
  event_occurrence_id uuid,
  appearance_id uuid,
  location_id uuid,
  product_id uuid,
  destination_path text not null,
  placement text,
  campaign_label text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  status text default 'active'::text not null,
  destination_type text,
  destination_id uuid,
  destination_url text
);
create table public.referral_attributions (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  referral_partner_id uuid not null,
  referral_code_id uuid not null,
  referred_at timestamp with time zone default now() not null,
  initial_plan_selected text,
  status text default 'unqualified'::text not null,
  converted_to_pro_at timestamp with time zone,
  qualifying_payment_reference text,
  gross_amount_cents integer,
  discount_amount_cents integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.referral_codes (
  id uuid default gen_random_uuid() not null,
  referral_partner_id uuid not null,
  code text not null,
  is_active boolean default true not null,
  discount_type text default 'percentage'::text not null,
  discount_percent numeric(5,2) not null,
  expires_at timestamp with time zone,
  max_uses integer,
  use_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.referral_earnings (
  id uuid default gen_random_uuid() not null,
  referral_partner_id uuid not null,
  business_id uuid not null,
  attribution_id uuid not null,
  qualifying_payment_reference text not null,
  gross_amount_cents integer not null,
  discount_amount_cents integer default 0 not null,
  commission_amount_cents integer not null,
  status text default 'pending'::text not null,
  earned_at timestamp with time zone default now() not null,
  payout_request_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.referral_partners (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  label text,
  is_active boolean default true not null,
  default_commission_cents integer default 2000 not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.referral_payout_requests (
  id uuid default gen_random_uuid() not null,
  referral_partner_id uuid not null,
  requested_amount_cents integer not null,
  status text default 'requested'::text not null,
  created_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  admin_note text,
  payment_reference text,
  updated_at timestamp with time zone default now() not null
);
create table public.refunds (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  order_item_id uuid not null,
  amount numeric(10,2) not null,
  reason text,
  stripe_refund_id text,
  vendor_recoverable boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table public.sales_inquiries (
  id uuid default gen_random_uuid() not null,
  contact_name text not null,
  business_name text not null,
  email text not null,
  phone text,
  website_or_instagram text,
  city_market_count integer not null,
  regions text not null,
  goals text not null,
  source text default 'join_multi_region'::text not null,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now() not null,
  conversation_id uuid
);
create table public.settlement_payment_allocations (
  id uuid default gen_random_uuid() not null,
  settlement_payment_id uuid not null,
  vendor_order_allocation_id uuid not null,
  amount_applied numeric(10,2) not null,
  created_at timestamp with time zone default now() not null
);
create table public.settlement_payments (
  id uuid default gen_random_uuid() not null,
  business_id uuid not null,
  amount numeric(10,2) not null,
  payment_date date default CURRENT_DATE not null,
  method text not null,
  reference text,
  note text,
  created_at timestamp with time zone default now() not null
);
create table public.site_sections (
  id uuid default gen_random_uuid() not null,
  page_key text not null,
  section_key text not null,
  eyebrow text,
  heading text,
  body text,
  cta_label text,
  cta_url text,
  is_visible boolean default true not null,
  sort_order integer default 0 not null,
  config_json jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.stripe_customers (
  user_id uuid not null,
  livemode boolean not null,
  stripe_customer_id text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.user_entity_relationships (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  relation text not null,
  created_at timestamp with time zone default now() not null
);
create table public.vendor_order_allocations (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  business_id uuid not null,
  merchandise_gross numeric(10,2) default 0 not null,
  fulfillment_revenue numeric(10,2) default 0 not null,
  marketplace_fee_amount numeric(10,2) default 0 not null,
  processing_fee_amount numeric(10,2) default 0 not null,
  refund_adjustment numeric(10,2) default 0 not null,
  vendor_net numeric(10,2) default 0 not null,
  amount_paid numeric(10,2) default 0 not null,
  amount_outstanding numeric(10,2) default 0 not null,
  status text default 'held'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.access_events add constraint access_events_pkey PRIMARY KEY (id);
alter table public.account_entitlements add constraint account_entitlements_pkey PRIMARY KEY (id);
alter table public.account_followed_businesses add constraint account_followed_businesses_pkey PRIMARY KEY (id);
alter table public.account_followed_events add constraint account_followed_events_pkey PRIMARY KEY (id);
alter table public.account_followed_locations add constraint account_followed_locations_pkey PRIMARY KEY (id);
alter table public.account_saved_businesses add constraint account_saved_businesses_pkey PRIMARY KEY (id);
alter table public.account_saved_events add constraint account_saved_events_pkey PRIMARY KEY (id);
alter table public.account_saved_locations add constraint account_saved_locations_pkey PRIMARY KEY (id);
alter table public.account_saved_products add constraint account_saved_products_pkey PRIMARY KEY (id);
alter table public.activation_inventory add constraint activation_inventory_pkey PRIMARY KEY (id);
alter table public.activation_options add constraint activation_options_pkey PRIMARY KEY (id);
alter table public.activation_venues add constraint activation_venues_pkey PRIMARY KEY (id);
alter table public.activations add constraint activations_pkey PRIMARY KEY (id);
alter table public.admin_intelligence_reviews add constraint admin_intelligence_reviews_pkey PRIMARY KEY (signal_type, signal_id);
alter table public.analytics_events add constraint analytics_events_pkey PRIMARY KEY (id);
alter table public.appearances add constraint appearances_pkey PRIMARY KEY (id);
alter table public.billing_sync_anomalies add constraint billing_sync_anomalies_pkey PRIMARY KEY (id);
alter table public.brand_audit_answers add constraint brand_audit_answers_pkey PRIMARY KEY (id);
alter table public.brand_audit_markets add constraint brand_audit_markets_pkey PRIMARY KEY (id);
alter table public.brand_audits add constraint brand_audits_pkey PRIMARY KEY (business_id);
alter table public.brand_import_batches add constraint brand_import_batches_pkey PRIMARY KEY (id);
alter table public.brand_import_candidates add constraint brand_import_candidates_pkey PRIMARY KEY (id);
alter table public.business_categories add constraint business_categories_pkey PRIMARY KEY (business_id, category_id);
alter table public.business_claim_requests add constraint business_claim_requests_pkey PRIMARY KEY (id);
alter table public.business_images add constraint business_images_pkey PRIMARY KEY (id);
alter table public.business_intelligence_notes add constraint business_intelligence_notes_pkey PRIMARY KEY (business_id);
alter table public.business_location_availability add constraint business_location_availability_pkey PRIMARY KEY (id);
alter table public.business_locations add constraint business_locations_pkey PRIMARY KEY (id);
alter table public.business_market_areas add constraint business_market_areas_pkey PRIMARY KEY (id);
alter table public.business_markets add constraint business_markets_pkey PRIMARY KEY (id);
alter table public.business_members add constraint business_members_pkey PRIMARY KEY (id);
alter table public.business_opportunity_goals add constraint business_opportunity_goals_pkey PRIMARY KEY (id);
alter table public.business_people add constraint business_people_pkey PRIMARY KEY (business_id, person_id);
alter table public.business_pro_access_requests add constraint business_pro_access_requests_pkey PRIMARY KEY (id);
alter table public.business_subscriptions add constraint business_subscriptions_pkey PRIMARY KEY (id);
alter table public.businesses add constraint businesses_pkey PRIMARY KEY (id);
alter table public.categories add constraint categories_pkey PRIMARY KEY (id);
alter table public.census_geographies add constraint census_geographies_pkey PRIMARY KEY (geo_key);
alter table public.census_geography_links add constraint census_geography_links_pkey PRIMARY KEY (child_key, parent_key, relation);
alter table public.census_imports add constraint census_imports_pkey PRIMARY KEY (id);
alter table public.conversation_messages add constraint conversation_messages_pkey PRIMARY KEY (id);
alter table public.conversation_participants add constraint conversation_participants_pkey PRIMARY KEY (id);
alter table public.conversations add constraint conversations_pkey PRIMARY KEY (id);
alter table public.discovery_lanes add constraint discovery_lanes_pkey PRIMARY KEY (id);
alter table public.discovery_pages add constraint discovery_pages_pkey PRIMARY KEY (id);
alter table public.discovery_topics add constraint discovery_topics_pkey PRIMARY KEY (id);
alter table public.event_businesses add constraint event_businesses_pkey PRIMARY KEY (event_id, business_id);
alter table public.event_categories add constraint event_categories_pkey PRIMARY KEY (event_id, category_id);
alter table public.event_claim_requests add constraint event_claim_requests_pkey PRIMARY KEY (id);
alter table public.event_followers add constraint event_followers_pkey PRIMARY KEY (id);
alter table public.event_formats add constraint event_formats_pkey PRIMARY KEY (event_id, category_id);
alter table public.event_images add constraint event_images_pkey PRIMARY KEY (id);
alter table public.event_members add constraint event_members_pkey PRIMARY KEY (id);
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_pkey PRIMARY KEY (id);
alter table public.event_occurrences add constraint event_occurrences_pkey PRIMARY KEY (id);
alter table public.event_products add constraint event_products_pkey PRIMARY KEY (event_id, product_id);
alter table public.events add constraint events_pkey PRIMARY KEY (id);
alter table public.followers add constraint followers_pkey PRIMARY KEY (id);
alter table public.form_assignments add constraint form_assignments_pkey PRIMARY KEY (id);
alter table public.forms add constraint forms_pkey PRIMARY KEY (id);
alter table public.handles add constraint handles_pkey PRIMARY KEY (id);
alter table public.homepage_bulletins add constraint homepage_bulletins_pkey PRIMARY KEY (id);
alter table public.homepage_rows add constraint homepage_rows_pkey PRIMARY KEY (id);
alter table public.inquiries add constraint inquiries_pkey PRIMARY KEY (id);
alter table public.inquiry_messages add constraint inquiry_messages_pkey PRIMARY KEY (id);
alter table public.journal_entries add constraint journal_entries_pkey PRIMARY KEY (id);
alter table public.journal_entry_connections add constraint journal_entry_connections_pkey PRIMARY KEY (id);
alter table public.journal_entry_media add constraint journal_entry_media_pkey PRIMARY KEY (id);
alter table public.journal_entry_sections add constraint journal_entry_sections_pkey PRIMARY KEY (id);
alter table public.location_claim_requests add constraint location_claim_requests_pkey PRIMARY KEY (id);
alter table public.location_followers add constraint location_followers_pkey PRIMARY KEY (id);
alter table public.location_images add constraint location_images_pkey PRIMARY KEY (id);
alter table public.location_members add constraint location_members_pkey PRIMARY KEY (id);
alter table public.locations add constraint locations_pkey PRIMARY KEY (id);
alter table public.market_areas add constraint market_areas_pkey PRIMARY KEY (id);
alter table public.market_request_interests add constraint market_request_interests_pkey PRIMARY KEY (id);
alter table public.market_requests add constraint market_requests_pkey PRIMARY KEY (id);
alter table public.markets add constraint markets_pkey PRIMARY KEY (id);
alter table public.media_variants add constraint media_variants_pkey PRIMARY KEY (bucket, original_path);
alter table public.membership_markets add constraint membership_markets_pkey PRIMARY KEY (membership_id, market_id);
alter table public.membership_plans add constraint membership_plans_pkey PRIMARY KEY (id);
alter table public.memberships add constraint memberships_pkey PRIMARY KEY (id);
alter table public.nav_items add constraint nav_items_pkey PRIMARY KEY (id);
alter table public.opportunities add constraint opportunities_pkey PRIMARY KEY (id);
alter table public.opportunity_idea_businesses add constraint opportunity_idea_businesses_pkey PRIMARY KEY (idea_id, business_id);
alter table public.opportunity_idea_responses add constraint opportunity_idea_responses_pkey PRIMARY KEY (id);
alter table public.opportunity_ideas add constraint opportunity_ideas_pkey PRIMARY KEY (id);
alter table public.opportunity_listings add constraint opportunity_listings_pkey PRIMARY KEY (id);
alter table public.opportunity_option_components add constraint opportunity_option_components_pkey PRIMARY KEY (id);
alter table public.opportunity_options add constraint opportunity_options_pkey PRIMARY KEY (id);
alter table public.opportunity_recipients add constraint opportunity_recipients_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.people add constraint people_pkey PRIMARY KEY (id);
alter table public.plan_market_limits add constraint plan_market_limits_pkey PRIMARY KEY (plan_tier);
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_pkey PRIMARY KEY (id);
alter table public.pro_invites add constraint pro_invites_pkey PRIMARY KEY (id);
alter table public.product_categories add constraint product_categories_pkey PRIMARY KEY (product_id, category_id);
alter table public.product_fulfillment_options add constraint product_fulfillment_options_pkey PRIMARY KEY (id);
alter table public.product_geographies add constraint product_geographies_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.qr_campaigns add constraint qr_campaigns_pkey PRIMARY KEY (id);
alter table public.referral_attributions add constraint referral_attributions_pkey PRIMARY KEY (id);
alter table public.referral_codes add constraint referral_codes_pkey PRIMARY KEY (id);
alter table public.referral_earnings add constraint referral_earnings_pkey PRIMARY KEY (id);
alter table public.referral_partners add constraint referral_partners_pkey PRIMARY KEY (id);
alter table public.referral_payout_requests add constraint referral_payout_requests_pkey PRIMARY KEY (id);
alter table public.refunds add constraint refunds_pkey PRIMARY KEY (id);
alter table public.sales_inquiries add constraint sales_inquiries_pkey PRIMARY KEY (id);
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_pkey PRIMARY KEY (id);
alter table public.settlement_payments add constraint settlement_payments_pkey PRIMARY KEY (id);
alter table public.site_sections add constraint site_sections_pkey PRIMARY KEY (id);
alter table public.stripe_customers add constraint stripe_customers_pkey PRIMARY KEY (user_id, livemode);
alter table public.user_entity_relationships add constraint user_entity_relationships_pkey PRIMARY KEY (id);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_pkey PRIMARY KEY (id);
alter table public.account_entitlements add constraint account_entitlements_user_id_entitlement_key_source_key UNIQUE (user_id, entitlement_key, source);
alter table public.account_followed_businesses add constraint account_followed_businesses_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.account_followed_events add constraint account_followed_events_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.account_followed_locations add constraint account_followed_locations_user_id_location_id_key UNIQUE (user_id, location_id);
alter table public.account_saved_businesses add constraint account_saved_businesses_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.account_saved_events add constraint account_saved_events_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.account_saved_locations add constraint account_saved_locations_user_id_location_id_key UNIQUE (user_id, location_id);
alter table public.account_saved_products add constraint account_saved_products_user_id_product_id_key UNIQUE (user_id, product_id);
alter table public.activations add constraint activations_slug_key UNIQUE (slug);
alter table public.brand_audit_answers add constraint brand_audit_answers_unique UNIQUE (business_id, kind, option_key, source);
alter table public.brand_audit_markets add constraint brand_audit_markets_unique UNIQUE (business_id, intent, level, place_key, source);
alter table public.brand_import_candidates add constraint brand_import_candidates_batch_position_key UNIQUE (batch_id, "position");
alter table public.brand_import_candidates add constraint brand_import_candidates_batch_host_key UNIQUE (batch_id, normalized_host);
alter table public.brand_import_candidates add constraint brand_import_candidates_created_business_key UNIQUE (created_business_id);
alter table public.business_location_availability add constraint business_location_availability_business_location_key UNIQUE (business_id, location_id);
alter table public.business_locations add constraint business_locations_business_location_key UNIQUE (business_id, location_id);
alter table public.business_market_areas add constraint business_market_areas_business_id_market_id_market_area_id_key UNIQUE (business_id, market_id, market_area_id);
alter table public.business_members add constraint business_members_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.business_subscriptions add constraint business_subscriptions_stripe_subscription_id_livemode_key UNIQUE (stripe_subscription_id, livemode);
alter table public.businesses add constraint businesses_slug_key UNIQUE (slug);
alter table public.categories add constraint categories_slug_kind_key UNIQUE (kind, slug);
alter table public.census_imports add constraint census_imports_unique UNIQUE (vintage, dataset);
alter table public.conversation_participants add constraint conversation_participants_conversation_id_user_id_entity_ty_key UNIQUE NULLS NOT DISTINCT (conversation_id, user_id, entity_type, entity_id);
alter table public.discovery_pages add constraint discovery_pages_slug_key UNIQUE (slug);
alter table public.discovery_topics add constraint discovery_topics_slug_key UNIQUE (slug);
alter table public.event_followers add constraint event_followers_event_id_email_key UNIQUE (event_id, email);
alter table public.event_members add constraint event_members_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_occurrence_id_business_id_key UNIQUE (occurrence_id, business_id);
alter table public.events add constraint events_slug_key UNIQUE (slug);
alter table public.followers add constraint followers_business_id_email_key UNIQUE (business_id, email);
alter table public.form_assignments add constraint form_assignments_entity_type_entity_id_purpose_key UNIQUE (entity_type, entity_id, purpose);
alter table public.forms add constraint forms_slug_key UNIQUE (slug);
alter table public.journal_entry_sections add constraint journal_entry_sections_id_entry_key UNIQUE (id, journal_entry_id);
alter table public.location_followers add constraint location_followers_location_id_email_key UNIQUE (location_id, email);
alter table public.location_members add constraint location_members_user_id_location_id_key UNIQUE (user_id, location_id);
alter table public.locations add constraint locations_slug_key UNIQUE (slug);
alter table public.market_areas add constraint market_areas_market_id_slug_key UNIQUE (market_id, slug);
alter table public.markets add constraint markets_slug_key UNIQUE (slug);
alter table public.membership_plans add constraint membership_plans_slug_key UNIQUE (slug);
alter table public.memberships add constraint memberships_invite_token_key UNIQUE (invite_token);
alter table public.opportunity_idea_responses add constraint opportunity_idea_responses_unique UNIQUE (idea_id, business_id);
alter table public.opportunity_ideas add constraint opportunity_ideas_seed_key_key UNIQUE (seed_key);
alter table public.opportunity_recipients add constraint opportunity_recipients_listing_business_key UNIQUE (listing_id, business_id);
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.people add constraint people_slug_key UNIQUE (slug);
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_invite_id_business_id_key UNIQUE (invite_id, business_id);
alter table public.products add constraint products_business_id_slug_key UNIQUE (business_id, slug);
alter table public.qr_campaigns add constraint qr_campaigns_code_key UNIQUE (code);
alter table public.referral_attributions add constraint referral_attributions_business_id_key UNIQUE (business_id);
alter table public.referral_earnings add constraint referral_earnings_qualifying_payment_reference_key UNIQUE (qualifying_payment_reference);
alter table public.referral_partners add constraint referral_partners_business_id_key UNIQUE (business_id);
alter table public.site_sections add constraint site_sections_page_key_section_key_key UNIQUE (page_key, section_key);
alter table public.stripe_customers add constraint stripe_customers_user_id_stripe_customer_id_livemode_key UNIQUE (user_id, stripe_customer_id, livemode);
alter table public.stripe_customers add constraint stripe_customers_stripe_customer_id_livemode_key UNIQUE (stripe_customer_id, livemode);
alter table public.user_entity_relationships add constraint user_entity_relationships_unique UNIQUE (user_id, entity_type, entity_id, relation);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_order_id_business_id_key UNIQUE (order_id, business_id);
alter table public.account_entitlements add constraint account_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_businesses add constraint account_followed_businesses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_businesses add constraint account_followed_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.account_followed_events add constraint account_followed_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.account_followed_events add constraint account_followed_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_locations add constraint account_followed_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_locations add constraint account_followed_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.account_saved_businesses add constraint account_saved_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.account_saved_businesses add constraint account_saved_businesses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_events add constraint account_saved_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_events add constraint account_saved_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.account_saved_locations add constraint account_saved_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_locations add constraint account_saved_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.account_saved_products add constraint account_saved_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.account_saved_products add constraint account_saved_products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.activation_inventory add constraint activation_inventory_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES activation_venues(id) ON DELETE SET NULL;
alter table public.activation_inventory add constraint activation_inventory_activation_id_fkey FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE CASCADE;
alter table public.activation_options add constraint activation_options_activation_id_fkey FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE CASCADE;
alter table public.activation_venues add constraint activation_venues_activation_id_fkey FOREIGN KEY (activation_id) REFERENCES activations(id) ON DELETE CASCADE;
alter table public.activation_venues add constraint activation_venues_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.activations add constraint activations_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.activations add constraint activations_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.activations add constraint activations_operator_business_id_fkey FOREIGN KEY (operator_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.analytics_events add constraint analytics_events_discovery_topic_id_fkey FOREIGN KEY (discovery_topic_id) REFERENCES discovery_topics(id) ON DELETE SET NULL;
alter table public.analytics_events add constraint analytics_events_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_geo_place_key_fkey FOREIGN KEY (geo_place_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.appearances add constraint appearances_geo_state_key_fkey FOREIGN KEY (geo_state_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.appearances add constraint appearances_event_occurrence_id_fkey FOREIGN KEY (event_occurrence_id) REFERENCES event_occurrences(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.appearances add constraint appearances_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id);
alter table public.appearances add constraint appearances_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id);
alter table public.brand_audit_answers add constraint brand_audit_answers_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.brand_audit_answers add constraint brand_audit_answers_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.brand_audit_markets add constraint brand_audit_markets_geo_key_fkey FOREIGN KEY (geo_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.brand_audit_markets add constraint brand_audit_markets_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.brand_audit_markets add constraint brand_audit_markets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.brand_audit_markets add constraint brand_audit_markets_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.brand_audit_markets add constraint brand_audit_markets_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.brand_audits add constraint brand_audits_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.brand_audits add constraint brand_audits_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.brand_import_candidates add constraint brand_import_candidates_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES brand_import_batches(id) ON DELETE CASCADE;
alter table public.brand_import_candidates add constraint brand_import_candidates_created_business_id_fkey FOREIGN KEY (created_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.brand_import_candidates add constraint brand_import_candidates_matched_business_id_fkey FOREIGN KEY (matched_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.business_categories add constraint business_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.business_categories add constraint business_categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_claim_requests add constraint business_claim_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_claim_requests add constraint business_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.business_images add constraint business_images_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_intelligence_notes add constraint business_intelligence_notes_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_location_availability add constraint business_location_availability_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_location_availability add constraint business_location_availability_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.business_locations add constraint business_locations_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_locations add constraint business_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT;
alter table public.business_markets add constraint business_markets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT;
alter table public.business_markets add constraint business_markets_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_members add constraint business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_members add constraint business_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.business_opportunity_goals add constraint business_opportunity_goals_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_opportunity_goals add constraint business_opportunity_goals_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.business_people add constraint business_people_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_people add constraint business_people_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
alter table public.business_pro_access_requests add constraint business_pro_access_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.business_pro_access_requests add constraint business_pro_access_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_subscriptions add constraint business_subscriptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_subscriptions add constraint business_subscriptions_payer_user_id_fkey FOREIGN KEY (payer_user_id) REFERENCES auth.users(id);
alter table public.business_subscriptions add constraint business_subscriptions_payer_customer_fkey FOREIGN KEY (payer_user_id, stripe_customer_id, livemode) REFERENCES stripe_customers(user_id, stripe_customer_id, livemode);
alter table public.businesses add constraint businesses_featured_appearance_id_fkey FOREIGN KEY (featured_appearance_id) REFERENCES appearances(id) ON DELETE SET NULL;
alter table public.businesses add constraint businesses_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.businesses add constraint businesses_geo_zcta_key_fkey FOREIGN KEY (geo_zcta_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.businesses add constraint businesses_geo_state_key_fkey FOREIGN KEY (geo_state_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.businesses add constraint businesses_geo_place_key_fkey FOREIGN KEY (geo_place_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.businesses add constraint businesses_featured_event_id_fkey FOREIGN KEY (featured_event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.categories add constraint categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.census_geography_links add constraint census_geography_links_parent_key_fkey FOREIGN KEY (parent_key) REFERENCES census_geographies(geo_key) ON DELETE CASCADE;
alter table public.census_geography_links add constraint census_geography_links_child_key_fkey FOREIGN KEY (child_key) REFERENCES census_geographies(geo_key) ON DELETE CASCADE;
alter table public.conversation_messages add constraint conversation_messages_sender_participant_id_fkey FOREIGN KEY (sender_participant_id) REFERENCES conversation_participants(id) ON DELETE SET NULL;
alter table public.conversation_messages add constraint conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.conversation_participants add constraint conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.discovery_lanes add constraint discovery_lanes_page_id_fkey FOREIGN KEY (page_id) REFERENCES discovery_pages(id) ON DELETE CASCADE;
alter table public.discovery_lanes add constraint discovery_lanes_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.discovery_lanes add constraint discovery_lanes_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES discovery_topics(id) ON DELETE SET NULL;
alter table public.discovery_pages add constraint discovery_pages_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.discovery_pages add constraint discovery_pages_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.event_businesses add constraint event_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.event_businesses add constraint event_businesses_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_categories add constraint event_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.event_categories add constraint event_categories_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_claim_requests add constraint event_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.event_claim_requests add constraint event_claim_requests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_followers add constraint event_followers_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_formats add constraint event_formats_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.event_formats add constraint event_formats_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_images add constraint event_images_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_members add constraint event_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.event_members add constraint event_members_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES event_occurrences(id) ON DELETE CASCADE;
alter table public.event_occurrences add constraint event_occurrences_geo_place_key_fkey FOREIGN KEY (geo_place_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.event_occurrences add constraint event_occurrences_geo_state_key_fkey FOREIGN KEY (geo_state_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.event_occurrences add constraint event_occurrences_geo_zcta_key_fkey FOREIGN KEY (geo_zcta_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.event_occurrences add constraint event_occurrences_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.event_occurrences add constraint event_occurrences_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.event_occurrences add constraint event_occurrences_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_products add constraint event_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.event_products add constraint event_products_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.events add constraint events_geo_place_key_fkey FOREIGN KEY (geo_place_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.events add constraint events_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.events add constraint events_host_business_id_fkey FOREIGN KEY (host_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.events add constraint events_geo_zcta_key_fkey FOREIGN KEY (geo_zcta_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.events add constraint events_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.events add constraint events_geo_state_key_fkey FOREIGN KEY (geo_state_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.followers add constraint followers_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.form_assignments add constraint form_assignments_form_id_fkey FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;
alter table public.handles add constraint handles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.homepage_rows add constraint homepage_rows_page_id_fkey FOREIGN KEY (page_id) REFERENCES discovery_pages(id);
alter table public.homepage_rows add constraint homepage_rows_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES homepage_rows(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.inquiry_messages add constraint inquiry_messages_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE;
alter table public.inquiry_messages add constraint inquiry_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.journal_entries add constraint journal_entries_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.journal_entries add constraint journal_entries_author_business_id_fkey FOREIGN KEY (author_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.journal_entries add constraint journal_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.journal_entry_connections add constraint journal_entry_connections_event_occurrence_id_fkey FOREIGN KEY (event_occurrence_id) REFERENCES event_occurrences(id) ON DELETE CASCADE;
alter table public.journal_entry_connections add constraint journal_entry_connections_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.journal_entry_connections add constraint journal_entry_connections_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
alter table public.journal_entry_connections add constraint journal_entry_connections_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.journal_entry_connections add constraint journal_entry_connections_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.journal_entry_media add constraint journal_entry_media_section_fk FOREIGN KEY (section_id, journal_entry_id) REFERENCES journal_entry_sections(id, journal_entry_id) ON DELETE SET NULL (section_id);
alter table public.journal_entry_media add constraint journal_entry_media_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
alter table public.journal_entry_sections add constraint journal_entry_sections_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE;
alter table public.location_claim_requests add constraint location_claim_requests_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_claim_requests add constraint location_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.location_followers add constraint location_followers_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_images add constraint location_images_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_members add constraint location_members_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_members add constraint location_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.locations add constraint locations_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_geo_place_key_fkey FOREIGN KEY (geo_place_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.locations add constraint locations_geo_zcta_key_fkey FOREIGN KEY (geo_zcta_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.locations add constraint locations_parent_location_id_fkey FOREIGN KEY (parent_location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_featured_event_id_fkey FOREIGN KEY (featured_event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_geo_state_key_fkey FOREIGN KEY (geo_state_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.market_areas add constraint market_areas_parent_area_id_fkey FOREIGN KEY (parent_area_id) REFERENCES market_areas(id) ON DELETE RESTRICT;
alter table public.market_areas add constraint market_areas_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.market_request_interests add constraint market_request_interests_request_id_fkey FOREIGN KEY (request_id) REFERENCES market_requests(id) ON DELETE CASCADE;
alter table public.market_request_interests add constraint market_request_interests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_geo_key_fkey FOREIGN KEY (geo_key) REFERENCES census_geographies(geo_key) ON DELETE RESTRICT;
alter table public.market_requests add constraint market_requests_mapped_area_id_fkey FOREIGN KEY (mapped_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_mapped_market_id_fkey FOREIGN KEY (mapped_market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_business_id_fkey FOREIGN KEY (source_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.membership_markets add constraint membership_markets_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE;
alter table public.membership_markets add constraint membership_markets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.memberships add constraint memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id);
alter table public.memberships add constraint memberships_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.memberships add constraint memberships_existing_business_id_fkey FOREIGN KEY (existing_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.nav_items add constraint nav_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES nav_items(id) ON DELETE CASCADE;
alter table public.opportunities add constraint opportunities_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.opportunities add constraint opportunities_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.opportunities add constraint opportunities_event_occurrence_id_fkey FOREIGN KEY (event_occurrence_id) REFERENCES event_occurrences(id) ON DELETE CASCADE;
alter table public.opportunities add constraint opportunities_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
alter table public.opportunity_idea_businesses add constraint opportunity_idea_businesses_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES opportunity_ideas(id) ON DELETE CASCADE;
alter table public.opportunity_idea_businesses add constraint opportunity_idea_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.opportunity_idea_responses add constraint opportunity_idea_responses_responded_by_user_id_fkey FOREIGN KEY (responded_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.opportunity_idea_responses add constraint opportunity_idea_responses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.opportunity_idea_responses add constraint opportunity_idea_responses_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES opportunity_ideas(id) ON DELETE CASCADE;
alter table public.opportunity_listings add constraint opportunity_listings_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.opportunity_listings add constraint opportunity_listings_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.opportunity_option_components add constraint opportunity_option_components_option_id_fkey FOREIGN KEY (option_id) REFERENCES opportunity_options(id) ON DELETE CASCADE;
alter table public.opportunity_options add constraint opportunity_options_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES opportunity_listings(id) ON DELETE CASCADE;
alter table public.opportunity_recipients add constraint opportunity_recipients_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.opportunity_recipients add constraint opportunity_recipients_responded_by_user_id_fkey FOREIGN KEY (responded_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.opportunity_recipients add constraint opportunity_recipients_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES opportunity_listings(id) ON DELETE RESTRICT;
alter table public.order_items add constraint order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
alter table public.order_items add constraint order_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public.order_items add constraint order_items_appearance_id_fkey FOREIGN KEY (appearance_id) REFERENCES appearances(id);
alter table public.orders add constraint orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_source_appearance_id_fkey FOREIGN KEY (source_appearance_id) REFERENCES appearances(id);
alter table public.orders add constraint orders_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES events(id);
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES pro_invites(id) ON DELETE CASCADE;
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.product_categories add constraint product_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.product_categories add constraint product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_fulfillment_options add constraint product_fulfillment_options_appearance_id_fkey FOREIGN KEY (appearance_id) REFERENCES appearances(id) ON DELETE CASCADE;
alter table public.product_fulfillment_options add constraint product_fulfillment_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_geographies add constraint product_geographies_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.product_geographies add constraint product_geographies_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE CASCADE;
alter table public.products add constraint products_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.qr_campaigns add constraint qr_campaigns_event_occurrence_id_fkey FOREIGN KEY (event_occurrence_id) REFERENCES event_occurrences(id) ON DELETE SET NULL;
alter table public.qr_campaigns add constraint qr_campaigns_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.qr_campaigns add constraint qr_campaigns_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.qr_campaigns add constraint qr_campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.qr_campaigns add constraint qr_campaigns_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.qr_campaigns add constraint qr_campaigns_appearance_id_fkey FOREIGN KEY (appearance_id) REFERENCES appearances(id) ON DELETE SET NULL;
alter table public.referral_attributions add constraint referral_attributions_referral_code_id_fkey FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id);
alter table public.referral_attributions add constraint referral_attributions_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.referral_attributions add constraint referral_attributions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_codes add constraint referral_codes_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_payout_request_id_fkey FOREIGN KEY (payout_request_id) REFERENCES referral_payout_requests(id);
alter table public.referral_earnings add constraint referral_earnings_attribution_id_fkey FOREIGN KEY (attribution_id) REFERENCES referral_attributions(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.referral_partners add constraint referral_partners_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_payout_requests add constraint referral_payout_requests_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.refunds add constraint refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.refunds add constraint refunds_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE;
alter table public.sales_inquiries add constraint sales_inquiries_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_vendor_order_allocation_id_fkey FOREIGN KEY (vendor_order_allocation_id) REFERENCES vendor_order_allocations(id);
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_settlement_payment_id_fkey FOREIGN KEY (settlement_payment_id) REFERENCES settlement_payments(id) ON DELETE CASCADE;
alter table public.settlement_payments add constraint settlement_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public.stripe_customers add constraint stripe_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.user_entity_relationships add constraint user_entity_relationships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.vendor_order_allocations add constraint vendor_order_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.vendor_order_allocations add constraint vendor_order_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
create view public.public_profiles as  SELECT username,
    display_name,
    avatar_url,
    bio,
    location_label
   FROM profiles
  WHERE (username IS NOT NULL);
create view public.public_handles as  SELECT handle,
    entity_type,
    entity_id
   FROM handles;
CREATE OR REPLACE FUNCTION public.get_location_ancestors(p_location_id uuid)
 RETURNS TABLE(id uuid, name text, slug text, place_type text, market_id uuid, market_area_id uuid, depth integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with recursive chain as (
    select
      p.id,
      p.name,
      p.slug,
      p.place_type,
      p.market_id,
      p.market_area_id,
      p.parent_location_id,
      1 as depth
    from public.locations c
    join public.locations p
      on p.id = c.parent_location_id
    where c.id = p_location_id
      and not p.is_demo

    union all

    select
      p.id,
      p.name,
      p.slug,
      p.place_type,
      p.market_id,
      p.market_area_id,
      p.parent_location_id,
      chain.depth + 1
    from chain
    join public.locations p
      on p.id = chain.parent_location_id
    where chain.depth < 64
      and not p.is_demo
  )

  select
    id,
    name,
    slug,
    place_type,
    market_id,
    market_area_id,
    depth
  from chain
  order by depth;
$function$
;
-- Read-only API surface for the preview (PostgREST runs as anon).
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
