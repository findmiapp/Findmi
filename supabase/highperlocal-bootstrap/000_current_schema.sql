-- ============================================================================
-- Highperlocal Bootstrap — 000_current_schema.sql
--
-- TARGET: a NEW, EMPTY Supabase project ONLY. Approved target project ID:
-- ewwctvowukrwqzuqfttq (Highperlocal). This file must NEVER be applied to
-- FindMi's production project (drcbrzwchlirfspjgtik) — see this directory's
-- README.md for the full safety statement.
--
-- WHAT THIS IS: a schema-only, current-STATE snapshot of FindMi's live
-- public schema, captured via read-only introspection (pg_catalog /
-- information_schema — pg_get_constraintdef/pg_get_indexdef/
-- pg_get_functiondef/pg_get_triggerdef/pg_get_viewdef for exact fidelity)
-- against project drcbrzwchlirfspjgtik immediately before this file was
-- written. It represents the schema the application currently expects —
-- i.e. the END RESULT of FindMi's 43 historical migrations already merged
-- into one coherent set of CREATE statements — NOT a replay of migration
-- history. Applying both this file AND the 43 historical migrations in
-- supabase/migrations/ to the same project would error (duplicate
-- tables/columns/constraints/policies) or silently double-apply changes;
-- do not do that. See the README for exactly what follows this file.
--
-- WHAT IT DELIBERATELY CONTAINS: enums/custom types (none exist — every
-- status/kind column uses text + CHECK), tables and columns, defaults,
-- primary keys, unique constraints, check constraints, foreign keys
-- (including references to auth.users), indexes, functions (full bodies),
-- triggers (including the one on auth.users), RLS enablement, RLS
-- policies, and the grants that deviate from the Supabase platform
-- default (see Section 11's own header for what that default already
-- covers without any explicit statement here).
--
-- WHAT IT DELIBERATELY EXCLUDES (per this pass's explicit instructions):
--   - Every table row. No INSERT/UPDATE/DELETE/COPY/TRUNCATE statement of
--     any kind appears anywhere in this file — verified by static review
--     before this file was committed (see the pass's own validation step).
--   - auth.users identities, production storage objects/files, secrets,
--     Stripe identifiers or payment records, migration-history rows.
--   - FindMi taxonomy/category seed rows, Market/Area rows, homepage
--     content, nav_items rows, membership_plans rows, referral/invite
--     codes, or any other configuration DATA — the TABLES that hold this
--     configuration are created (structure only); populating them for
--     Highperlocal is a separate, later, deliberate step (see README).
--   - The three Highperlocal-only additive fields from
--     20260908200000_highperlocal_location_classification_and_manual_review.sql
--     (locations.classification, appearances.location_id, and the
--     businesses ownership_verification_*/payment_confirmation_* columns)
--     — confirmed absent from FindMi's live schema at capture time, so
--     they are NOT duplicated here; that migration runs AFTER this file
--     (see README).
--
-- SAFETY: read-only introspection only was used to produce this file — no
-- DDL/DML was executed against drcbrzwchlirfspjgtik or ewwctvowukrwqzuqfttq
-- to create it, and this file itself has NOT been applied to either project
-- by this pass. See the pass's own report for the exact read-only queries
-- run.
-- ============================================================================

-- ============================================================================
-- SECTION 0 — EXTENSIONS
-- Defensive only: every current Supabase project (including a brand-new one)
-- already ships these enabled by default. Listed explicitly so this file has
-- no hidden platform-default dependency.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- SECTION 1 — TABLES (columns only; constraints/indexes added in later sections)
-- ============================================================================

create table public.account_entitlements (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  entitlement_key text not null,
  source text not null,
  granted_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone
);

create table public.account_followed_businesses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  business_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.account_followed_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.account_saved_businesses (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  business_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.account_saved_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.account_saved_products (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  product_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.appearances (
  id uuid not null default gen_random_uuid(),
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
  status text not null default 'confirmed'::text,
  is_featured boolean not null default false,
  created_at timestamp with time zone not null default now(),
  bulletin_text text,
  show_on_home boolean not null default false,
  home_sort_order integer,
  external_url text,
  flyer_image_url text,
  event_occurrence_id uuid,
  source text not null default 'manual'::text,
  admin_reviewed_at timestamp with time zone,
  market_id uuid,
  market_area_id uuid
);

create table public.business_categories (
  business_id uuid not null,
  category_id uuid not null
);

create table public.business_claim_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  business_id uuid not null,
  status text not null default 'pending'::text,
  message text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  payment_status text not null default 'unpaid'::text,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);

create table public.business_images (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  url text not null,
  display_order integer,
  created_at timestamp with time zone not null default now()
);

create table public.business_market_areas (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  market_id uuid not null,
  market_area_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table public.business_markets (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  market_id uuid not null,
  relationship text not null,
  provenance text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create table public.business_members (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  business_id uuid not null,
  role text not null,
  created_at timestamp with time zone not null default now()
);

create table public.business_people (
  business_id uuid not null,
  person_id uuid not null,
  role text,
  display_order integer,
  featured boolean not null default false,
  show_on_business boolean not null default true
);

create table public.businesses (
  id uuid not null default gen_random_uuid(),
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
  verified boolean not null default false,
  founding_member boolean not null default false,
  membership_status text not null default 'lead'::text,
  lead_status text not null default 'new'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  is_demo boolean not null default false,
  commerce_enabled boolean not null default false,
  marketplace_fee_percent numeric(5,2) not null default 5.00,
  processing_fee_payer text not null default 'vendor'::text,
  payout_method text not null default 'manual'::text,
  stripe_account_id text,
  stripe_connect_status text,
  publication_status text not null default 'live'::text,
  is_featured boolean not null default false,
  inquiry_cta_label text,
  inquiry_cta_url text,
  cta_1_label text,
  cta_1_url text,
  cta_1_enabled boolean not null default false,
  cta_2_label text,
  cta_2_url text,
  cta_2_enabled boolean not null default false,
  cta_3_label text,
  cta_3_url text,
  cta_3_enabled boolean not null default false,
  bulletin_enabled boolean not null default false,
  bulletin_heading text,
  bulletin_body text,
  bulletin_label text,
  bulletin_url text,
  plan_tier text not null default 'free'::text,
  plan_source text,
  plan_started_at timestamp with time zone,
  plan_expires_at timestamp with time zone,
  plan_payment_reference text,
  native_inquiries_enabled boolean not null default false,
  market_area_id uuid,
  is_pro_member boolean generated always as (plan_tier = ANY (ARRAY['pro'::text, 'pro_seller'::text])) stored
);

create table public.categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  show_on_home boolean not null default false,
  home_sort_order integer,
  kind text not null,
  parent_id uuid
);

create table public.event_businesses (
  event_id uuid not null,
  business_id uuid not null,
  status text not null default 'approved'::text,
  featured boolean not null default false,
  offering_text text,
  display_order integer
);

create table public.event_categories (
  event_id uuid not null,
  category_id uuid not null
);

create table public.event_claim_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  status text not null default 'pending'::text,
  message text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  payment_status text not null default 'unpaid'::text,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);

create table public.event_followers (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  email text not null,
  phone text,
  created_at timestamp with time zone not null default now()
);

create table public.event_images (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  kind text not null default 'event'::text,
  url text not null,
  display_order integer,
  created_at timestamp with time zone not null default now()
);

create table public.event_members (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  role text not null,
  created_at timestamp with time zone not null default now()
);

create table public.event_occurrence_businesses (
  id uuid not null default gen_random_uuid(),
  occurrence_id uuid not null,
  business_id uuid not null,
  status text not null default 'approved'::text,
  featured boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.event_occurrences (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  start_at timestamp with time zone not null,
  end_at timestamp with time zone not null,
  location_id uuid,
  featured boolean not null default false,
  status text not null default 'scheduled'::text,
  ticket_url_override text,
  vendor_apply_url_override text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  rsvp_url_override text,
  timezone text not null default 'America/New_York'::text,
  market_id uuid
);

create table public.event_products (
  event_id uuid not null,
  product_id uuid not null,
  display_order integer,
  created_at timestamp with time zone not null default now()
);

create table public.events (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  cover_image_url text,
  start_at timestamp with time zone not null,
  end_at timestamp with time zone,
  venue_name text,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  organizer_name text,
  external_url text,
  is_featured boolean not null default false,
  created_at timestamp with time zone not null default now(),
  is_demo boolean not null default false,
  follow_enabled boolean not null default false,
  rsvp_enabled boolean not null default false,
  rsvp_url text,
  tickets_enabled boolean not null default false,
  tickets_url text,
  vendor_applications_enabled boolean not null default false,
  vendor_application_url text,
  vendor_application_deadline timestamp with time zone,
  contact_enabled boolean not null default false,
  organizer_email text,
  contact_url text,
  directions_enabled boolean not null default true,
  featured_sort_order integer,
  featured_products_heading text,
  bulletin_enabled boolean not null default false,
  bulletin_heading text,
  bulletin_body text,
  market_id uuid,
  market_area_id uuid,
  publication_status text not null default 'live'::text
);

create table public.followers (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  email text not null,
  phone text,
  created_at timestamp with time zone not null default now()
);

create table public.form_assignments (
  id uuid not null default gen_random_uuid(),
  form_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  purpose text not null,
  created_at timestamp with time zone not null default now()
);

create table public.forms (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  purpose text not null,
  provider text not null default 'tally'::text,
  form_url text not null,
  display_mode text not null default 'external'::text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.handles (
  id uuid not null default gen_random_uuid(),
  handle text not null,
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.homepage_rows (
  id uuid not null default gen_random_uuid(),
  title text not null,
  subtitle text,
  content_type text not null,
  mode text not null default 'dynamic'::text,
  category_slug text,
  featured_only boolean not null default false,
  time_window text,
  item_limit integer not null default 8,
  curated_ids uuid[] not null default '{}'::uuid[],
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.inquiries (
  id uuid not null default gen_random_uuid(),
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
  allow_findmi_matching boolean not null default false,
  status text not null default 'new'::text,
  source text default 'findmi_profile'::text,
  created_at timestamp with time zone not null default now(),
  user_id uuid,
  product_id uuid,
  customer_last_read_at timestamp with time zone,
  business_last_read_at timestamp with time zone
);

create table public.inquiry_messages (
  id uuid not null default gen_random_uuid(),
  inquiry_id uuid not null,
  sender_type text not null,
  sender_user_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now()
);

create table public.location_claim_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  location_id uuid not null,
  status text not null default 'pending'::text,
  message text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  payment_status text not null default 'unpaid'::text,
  payment_amount integer,
  paid_at timestamp with time zone,
  payment_reference text,
  full_name text,
  email text,
  phone text
);

create table public.location_images (
  id uuid not null default gen_random_uuid(),
  location_id uuid not null,
  url text not null,
  display_order integer,
  created_at timestamp with time zone not null default now()
);

create table public.location_members (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  location_id uuid not null,
  role text not null,
  created_at timestamp with time zone not null default now()
);

create table public.locations (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  address text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  is_demo boolean not null default false,
  market_id uuid,
  description text,
  website_url text,
  email text,
  phone text,
  cover_image_url text,
  market_area_id uuid
);

create table public.market_areas (
  id uuid not null default gen_random_uuid(),
  market_id uuid not null,
  name text not null,
  slug text not null,
  display_name text,
  aliases text[],
  active boolean not null default true,
  consumer_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.market_request_interests (
  id uuid not null default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid,
  email text,
  created_at timestamp with time zone not null default now()
);

create table public.market_requests (
  id uuid not null default gen_random_uuid(),
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
  status text not null default 'pending'::text,
  mapped_market_id uuid,
  admin_note text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  canonical_text text,
  effective_normalized_key text not null,
  mapped_area_id uuid,
  resolution_type text,
  source_location_id uuid
);

create table public.markets (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  display_name text,
  description text,
  areas_included text[],
  consumer_visible boolean not null default true
);

create table public.membership_markets (
  membership_id uuid not null,
  market_id uuid not null
);

create table public.membership_plans (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  annual_price numeric(10,2) not null,
  active boolean not null default true,
  publicly_available boolean not null default true,
  market_limit integer,
  description text,
  sort_order integer not null default 0,
  featured_placement_eligible boolean not null default false,
  enhanced_profile boolean not null default false,
  campaign_eligible boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table public.memberships (
  id uuid not null default gen_random_uuid(),
  business_id uuid,
  plan_id uuid,
  billing_status text not null default 'pending_payment'::text,
  onboarding_status text not null default 'not_started'::text,
  publication_status text not null default 'draft'::text,
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
  founding_price_locked boolean not null default false,
  admin_notes text,
  invite_token text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.nav_items (
  id uuid not null default gen_random_uuid(),
  label text not null,
  destination_type text not null default 'route'::text,
  route_key text,
  custom_href text,
  group_label text,
  icon_key text,
  is_visible boolean not null default true,
  is_highlight boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  parent_id uuid
);

create table public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid not null,
  business_id uuid not null,
  product_name text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null,
  line_merchandise_total numeric(10,2) not null,
  fulfillment_method text not null,
  fulfillment_amount numeric(10,2) not null default 0,
  appearance_id uuid,
  event_id uuid,
  marketplace_fee_percent numeric(5,2) not null,
  marketplace_fee_amount numeric(10,2) not null,
  applied_fee_source text not null default 'marketplace_default'::text,
  processing_fee_payer text not null,
  allocated_processing_fee_amount numeric(10,2) not null default 0,
  vendor_gross numeric(10,2) not null,
  vendor_net numeric(10,2) not null,
  source_channel text,
  fulfillment_status text not null default 'new'::text,
  refunded_amount numeric(10,2) not null default 0,
  created_at timestamp with time zone not null default now(),
  internal_note text
);

create table public.orders (
  id uuid not null default gen_random_uuid(),
  order_number text not null,
  customer_email text not null,
  customer_name text,
  customer_phone text,
  currency text not null default 'usd'::text,
  merchandise_subtotal numeric(10,2) not null default 0,
  fulfillment_total numeric(10,2) not null default 0,
  customer_processing_fee_total numeric(10,2) not null default 0,
  total_charged numeric(10,2) not null default 0,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_processing_fee_amount numeric(10,2),
  payment_status text not null default 'pending'::text,
  refund_status text not null default 'none'::text,
  source_event_id uuid,
  source_appearance_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  user_id uuid
);

create table public.people (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text not null,
  image_url text,
  short_bio text,
  location text,
  instagram_url text,
  website_url text,
  is_public boolean not null default true,
  is_featured boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.plan_market_limits (
  plan_tier text not null,
  market_limit integer,
  updated_at timestamp with time zone not null default now()
);

create table public.pro_invite_redemptions (
  id uuid not null default gen_random_uuid(),
  invite_id uuid not null,
  business_id uuid not null,
  redeemed_by uuid not null,
  redeemed_at timestamp with time zone not null default now(),
  previous_plan_tier text,
  granted_plan_tier text not null,
  granted_until timestamp with time zone not null
);

create table public.pro_invites (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text,
  plan_tier text not null default 'pro'::text,
  duration_days integer not null default 365,
  max_redemptions integer,
  redemption_count integer not null default 0,
  expires_at timestamp with time zone,
  is_active boolean not null default true,
  created_by_note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  grant_purpose text not null default 'business_pro'::text
);

create table public.product_categories (
  product_id uuid not null,
  category_id uuid not null
);

create table public.product_fulfillment_options (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  method text not null,
  price numeric(10,2) not null default 0,
  enabled boolean not null default true,
  appearance_id uuid,
  created_at timestamp with time zone not null default now()
);

create table public.products (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  name text not null,
  slug text not null,
  description text,
  image_url text,
  price numeric(10,2),
  price_label text,
  product_type text not null default 'product'::text,
  external_purchase_url text,
  is_featured boolean not null default false,
  is_active boolean not null default true,
  purchasable boolean not null default false,
  inventory_status text,
  marketplace_fee_override_percent numeric(5,2),
  processing_fee_payer_override text,
  home_sort_order integer,
  profile_sort_order integer,
  moderation_status text not null default 'live'::text,
  pending_changes jsonb,
  marketplace_status text not null default 'catalog_only'::text,
  marketplace_submitted_at timestamp with time zone,
  marketplace_approved_at timestamp with time zone
);

create table public.profiles (
  id uuid not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  username text,
  bio text,
  location_label text,
  email_verified_at timestamp with time zone,
  phone text
);

create table public.referral_attributions (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  referral_partner_id uuid not null,
  referral_code_id uuid not null,
  referred_at timestamp with time zone not null default now(),
  initial_plan_selected text,
  status text not null default 'unqualified'::text,
  converted_to_pro_at timestamp with time zone,
  qualifying_payment_reference text,
  gross_amount_cents integer,
  discount_amount_cents integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.referral_codes (
  id uuid not null default gen_random_uuid(),
  referral_partner_id uuid not null,
  code text not null,
  is_active boolean not null default true,
  discount_type text not null default 'percentage'::text,
  discount_percent numeric(5,2) not null,
  expires_at timestamp with time zone,
  max_uses integer,
  use_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.referral_earnings (
  id uuid not null default gen_random_uuid(),
  referral_partner_id uuid not null,
  business_id uuid not null,
  attribution_id uuid not null,
  qualifying_payment_reference text not null,
  gross_amount_cents integer not null,
  discount_amount_cents integer not null default 0,
  commission_amount_cents integer not null,
  status text not null default 'pending'::text,
  earned_at timestamp with time zone not null default now(),
  payout_request_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.referral_partners (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  label text,
  is_active boolean not null default true,
  default_commission_cents integer not null default 2000,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.referral_payout_requests (
  id uuid not null default gen_random_uuid(),
  referral_partner_id uuid not null,
  requested_amount_cents integer not null,
  status text not null default 'requested'::text,
  created_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone,
  admin_note text,
  payment_reference text,
  updated_at timestamp with time zone not null default now()
);

create table public.refunds (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  order_item_id uuid not null,
  amount numeric(10,2) not null,
  reason text,
  stripe_refund_id text,
  vendor_recoverable boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table public.settlement_payment_allocations (
  id uuid not null default gen_random_uuid(),
  settlement_payment_id uuid not null,
  vendor_order_allocation_id uuid not null,
  amount_applied numeric(10,2) not null,
  created_at timestamp with time zone not null default now()
);

create table public.settlement_payments (
  id uuid not null default gen_random_uuid(),
  business_id uuid not null,
  amount numeric(10,2) not null,
  payment_date date not null default CURRENT_DATE,
  method text not null,
  reference text,
  note text,
  created_at timestamp with time zone not null default now()
);

create table public.site_sections (
  id uuid not null default gen_random_uuid(),
  page_key text not null,
  section_key text not null,
  eyebrow text,
  heading text,
  body text,
  cta_label text,
  cta_url text,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.vendor_order_allocations (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  business_id uuid not null,
  merchandise_gross numeric(10,2) not null default 0,
  fulfillment_revenue numeric(10,2) not null default 0,
  marketplace_fee_amount numeric(10,2) not null default 0,
  processing_fee_amount numeric(10,2) not null default 0,
  refund_adjustment numeric(10,2) not null default 0,
  vendor_net numeric(10,2) not null default 0,
  amount_paid numeric(10,2) not null default 0,
  amount_outstanding numeric(10,2) not null default 0,
  status text not null default 'held'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ============================================================================
-- SECTION 2 — PRIMARY KEY / UNIQUE CONSTRAINTS
-- ============================================================================

alter table public.account_entitlements add constraint account_entitlements_pkey PRIMARY KEY (id);
alter table public.account_followed_businesses add constraint account_followed_businesses_pkey PRIMARY KEY (id);
alter table public.account_followed_events add constraint account_followed_events_pkey PRIMARY KEY (id);
alter table public.account_saved_businesses add constraint account_saved_businesses_pkey PRIMARY KEY (id);
alter table public.account_saved_events add constraint account_saved_events_pkey PRIMARY KEY (id);
alter table public.account_saved_products add constraint account_saved_products_pkey PRIMARY KEY (id);
alter table public.appearances add constraint appearances_pkey PRIMARY KEY (id);
alter table public.business_categories add constraint business_categories_pkey PRIMARY KEY (business_id, category_id);
alter table public.business_claim_requests add constraint business_claim_requests_pkey PRIMARY KEY (id);
alter table public.business_images add constraint business_images_pkey PRIMARY KEY (id);
alter table public.business_market_areas add constraint business_market_areas_pkey PRIMARY KEY (id);
alter table public.business_markets add constraint business_markets_pkey PRIMARY KEY (id);
alter table public.business_members add constraint business_members_pkey PRIMARY KEY (id);
alter table public.business_people add constraint business_people_pkey PRIMARY KEY (business_id, person_id);
alter table public.businesses add constraint businesses_pkey PRIMARY KEY (id);
alter table public.categories add constraint categories_pkey PRIMARY KEY (id);
alter table public.event_businesses add constraint event_businesses_pkey PRIMARY KEY (event_id, business_id);
alter table public.event_categories add constraint event_categories_pkey PRIMARY KEY (event_id, category_id);
alter table public.event_claim_requests add constraint event_claim_requests_pkey PRIMARY KEY (id);
alter table public.event_followers add constraint event_followers_pkey PRIMARY KEY (id);
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
alter table public.homepage_rows add constraint homepage_rows_pkey PRIMARY KEY (id);
alter table public.inquiries add constraint inquiries_pkey PRIMARY KEY (id);
alter table public.inquiry_messages add constraint inquiry_messages_pkey PRIMARY KEY (id);
alter table public.location_claim_requests add constraint location_claim_requests_pkey PRIMARY KEY (id);
alter table public.location_images add constraint location_images_pkey PRIMARY KEY (id);
alter table public.location_members add constraint location_members_pkey PRIMARY KEY (id);
alter table public.locations add constraint locations_pkey PRIMARY KEY (id);
alter table public.market_areas add constraint market_areas_pkey PRIMARY KEY (id);
alter table public.market_request_interests add constraint market_request_interests_pkey PRIMARY KEY (id);
alter table public.market_requests add constraint market_requests_pkey PRIMARY KEY (id);
alter table public.markets add constraint markets_pkey PRIMARY KEY (id);
alter table public.membership_markets add constraint membership_markets_pkey PRIMARY KEY (membership_id, market_id);
alter table public.membership_plans add constraint membership_plans_pkey PRIMARY KEY (id);
alter table public.memberships add constraint memberships_pkey PRIMARY KEY (id);
alter table public.nav_items add constraint nav_items_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.people add constraint people_pkey PRIMARY KEY (id);
alter table public.plan_market_limits add constraint plan_market_limits_pkey PRIMARY KEY (plan_tier);
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_pkey PRIMARY KEY (id);
alter table public.pro_invites add constraint pro_invites_pkey PRIMARY KEY (id);
alter table public.product_categories add constraint product_categories_pkey PRIMARY KEY (product_id, category_id);
alter table public.product_fulfillment_options add constraint product_fulfillment_options_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.referral_attributions add constraint referral_attributions_pkey PRIMARY KEY (id);
alter table public.referral_codes add constraint referral_codes_pkey PRIMARY KEY (id);
alter table public.referral_earnings add constraint referral_earnings_pkey PRIMARY KEY (id);
alter table public.referral_partners add constraint referral_partners_pkey PRIMARY KEY (id);
alter table public.referral_payout_requests add constraint referral_payout_requests_pkey PRIMARY KEY (id);
alter table public.refunds add constraint refunds_pkey PRIMARY KEY (id);
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_pkey PRIMARY KEY (id);
alter table public.settlement_payments add constraint settlement_payments_pkey PRIMARY KEY (id);
alter table public.site_sections add constraint site_sections_pkey PRIMARY KEY (id);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_pkey PRIMARY KEY (id);

alter table public.account_entitlements add constraint account_entitlements_user_id_entitlement_key_source_key UNIQUE (user_id, entitlement_key, source);
alter table public.account_followed_businesses add constraint account_followed_businesses_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.account_followed_events add constraint account_followed_events_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.account_saved_businesses add constraint account_saved_businesses_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.account_saved_events add constraint account_saved_events_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.account_saved_products add constraint account_saved_products_user_id_product_id_key UNIQUE (user_id, product_id);
alter table public.business_market_areas add constraint business_market_areas_business_id_market_id_market_area_id_key UNIQUE (business_id, market_id, market_area_id);
alter table public.business_members add constraint business_members_user_id_business_id_key UNIQUE (user_id, business_id);
alter table public.businesses add constraint businesses_slug_key UNIQUE (slug);
alter table public.categories add constraint categories_slug_kind_key UNIQUE (kind, slug);
alter table public.event_followers add constraint event_followers_event_id_email_key UNIQUE (event_id, email);
alter table public.event_members add constraint event_members_user_id_event_id_key UNIQUE (user_id, event_id);
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_occurrence_id_business_id_key UNIQUE (occurrence_id, business_id);
alter table public.events add constraint events_slug_key UNIQUE (slug);
alter table public.followers add constraint followers_business_id_email_key UNIQUE (business_id, email);
alter table public.form_assignments add constraint form_assignments_entity_type_entity_id_purpose_key UNIQUE (entity_type, entity_id, purpose);
alter table public.forms add constraint forms_slug_key UNIQUE (slug);
alter table public.location_members add constraint location_members_user_id_location_id_key UNIQUE (user_id, location_id);
alter table public.locations add constraint locations_slug_key UNIQUE (slug);
alter table public.market_areas add constraint market_areas_market_id_slug_key UNIQUE (market_id, slug);
alter table public.markets add constraint markets_slug_key UNIQUE (slug);
alter table public.membership_plans add constraint membership_plans_slug_key UNIQUE (slug);
alter table public.memberships add constraint memberships_invite_token_key UNIQUE (invite_token);
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.people add constraint people_slug_key UNIQUE (slug);
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_invite_id_business_id_key UNIQUE (invite_id, business_id);
alter table public.products add constraint products_business_id_slug_key UNIQUE (business_id, slug);
alter table public.referral_attributions add constraint referral_attributions_business_id_key UNIQUE (business_id);
alter table public.referral_earnings add constraint referral_earnings_qualifying_payment_reference_key UNIQUE (qualifying_payment_reference);
alter table public.referral_partners add constraint referral_partners_business_id_key UNIQUE (business_id);
alter table public.site_sections add constraint site_sections_page_key_section_key_key UNIQUE (page_key, section_key);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_order_id_business_id_key UNIQUE (order_id, business_id);

-- ============================================================================
-- SECTION 3 — CHECK CONSTRAINTS
-- ============================================================================

alter table public.account_entitlements add constraint account_entitlements_entitlement_key_check CHECK ((entitlement_key = 'event_management'::text));
alter table public.appearances add constraint appearances_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'event_self_added'::text, 'official_participation'::text])));
alter table public.appearances add constraint appearances_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'tentative'::text, 'canceled'::text])));
alter table public.business_claim_requests add constraint business_claim_requests_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'refunded'::text])));
alter table public.business_claim_requests add constraint business_claim_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.business_markets add constraint business_markets_provenance_check CHECK (((provenance IS NULL) OR (provenance = ANY (ARRAY['paid'::text, 'complimentary'::text, 'promotional'::text, 'admin'::text, 'self_selected'::text]))));
alter table public.business_markets add constraint business_markets_relationship_check CHECK ((relationship = ANY (ARRAY['primary'::text, 'additional'::text])));
alter table public.business_members add constraint business_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
alter table public.businesses add constraint businesses_lead_status_check CHECK ((lead_status = ANY (ARRAY['new'::text, 'contacted'::text, 'onboarding'::text, 'qualified'::text, 'not_a_fit'::text])));
alter table public.businesses add constraint businesses_membership_status_check CHECK ((membership_status = ANY (ARRAY['lead'::text, 'active'::text, 'past_due'::text, 'canceled'::text])));
alter table public.businesses add constraint businesses_payout_method_check CHECK ((payout_method = ANY (ARRAY['manual'::text, 'stripe_connect_future'::text])));
alter table public.businesses add constraint businesses_plan_source_check CHECK (((plan_source IS NULL) OR (plan_source = ANY (ARRAY['paid'::text, 'complimentary'::text, 'promotional'::text, 'admin'::text]))));
alter table public.businesses add constraint businesses_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['free'::text, 'pro'::text, 'pro_seller'::text])));
alter table public.businesses add constraint businesses_processing_fee_payer_check CHECK ((processing_fee_payer = ANY (ARRAY['vendor'::text, 'customer'::text])));
alter table public.businesses add constraint businesses_publication_status_check CHECK ((publication_status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'live'::text, 'paused'::text, 'rejected'::text])));
alter table public.categories add constraint categories_kind_check CHECK ((kind = ANY (ARRAY['business'::text, 'event'::text, 'product'::text])));
alter table public.event_businesses add constraint event_businesses_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'applied'::text, 'pending'::text, 'approved'::text, 'declined'::text])));
alter table public.event_claim_requests add constraint event_claim_requests_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'refunded'::text])));
alter table public.event_claim_requests add constraint event_claim_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.event_images add constraint event_images_kind_check CHECK ((kind = ANY (ARRAY['event'::text, 'venue'::text])));
alter table public.event_members add constraint event_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'applied'::text, 'pending'::text, 'approved'::text, 'declined'::text])));
alter table public.event_occurrences add constraint event_occurrences_end_after_start CHECK ((end_at > start_at));
alter table public.event_occurrences add constraint event_occurrences_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text])));
alter table public.events add constraint events_publication_status_check CHECK ((publication_status = ANY (ARRAY['pending_review'::text, 'live'::text, 'rejected'::text])));
alter table public.form_assignments add constraint form_assignments_entity_type_check CHECK ((entity_type = ANY (ARRAY['business'::text, 'event'::text, 'product'::text])));
alter table public.form_assignments add constraint form_assignments_purpose_check CHECK ((purpose = ANY (ARRAY['vendor_onboarding'::text, 'business_inquiry'::text, 'product_inquiry'::text, 'booking'::text, 'rsvp'::text, 'vendor_application'::text, 'contact_organizer'::text])));
alter table public.forms add constraint forms_display_mode_check CHECK ((display_mode = ANY (ARRAY['embed'::text, 'external'::text])));
alter table public.forms add constraint forms_provider_check CHECK ((provider = 'tally'::text));
alter table public.forms add constraint forms_purpose_check CHECK ((purpose = ANY (ARRAY['vendor_onboarding'::text, 'business_inquiry'::text, 'product_inquiry'::text, 'booking'::text, 'rsvp'::text, 'vendor_application'::text, 'contact_organizer'::text])));
alter table public.handles add constraint handles_entity_type_check CHECK ((entity_type = ANY (ARRAY['business'::text, 'location'::text, 'event'::text])));
alter table public.handles add constraint handles_format CHECK ((handle ~ '^[a-z0-9_]{3,20}$'::text));
alter table public.homepage_rows add constraint homepage_rows_content_type_check CHECK ((content_type = ANY (ARRAY['businesses'::text, 'events'::text, 'products'::text, 'business_showcase'::text])));
alter table public.homepage_rows add constraint homepage_rows_mode_check CHECK ((mode = ANY (ARRAY['dynamic'::text, 'curated'::text])));
alter table public.homepage_rows add constraint homepage_rows_time_window_check CHECK (((time_window = ANY (ARRAY['now'::text, 'weekend'::text, 'anytime'::text])) OR (time_window IS NULL)));
alter table public.inquiries add constraint inquiries_status_check CHECK ((status = ANY (ARRAY['new'::text, 'replied'::text, 'contacted'::text, 'booked'::text, 'closed'::text])));
alter table public.inquiry_messages add constraint inquiry_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));
alter table public.inquiry_messages add constraint inquiry_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['customer'::text, 'business'::text])));
alter table public.location_claim_requests add constraint location_claim_requests_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'refunded'::text])));
alter table public.location_claim_requests add constraint location_claim_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.location_members add constraint location_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text])));
alter table public.market_request_interests add constraint market_request_interests_identity_check CHECK (((user_id IS NOT NULL) OR (email IS NOT NULL)));
alter table public.market_requests add constraint market_requests_resolution_type_check CHECK (((resolution_type IS NULL) OR (resolution_type = ANY (ARRAY['existing_market'::text, 'existing_area'::text, 'new_market'::text, 'new_area'::text]))));
alter table public.market_requests add constraint market_requests_source_check CHECK ((source = ANY (ARRAY['consumer'::text, 'business_creation'::text, 'event_creation'::text, 'location_creation'::text])));
alter table public.market_requests add constraint market_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'mapped'::text, 'rejected'::text])));
alter table public.memberships add constraint memberships_billing_status_check CHECK ((billing_status = ANY (ARRAY['comped'::text, 'pending_payment'::text, 'paid'::text, 'past_due'::text, 'cancelled'::text])));
alter table public.memberships add constraint memberships_onboarding_status_check CHECK ((onboarding_status = ANY (ARRAY['not_started'::text, 'incomplete'::text, 'submitted'::text, 'approved'::text])));
alter table public.memberships add constraint memberships_publication_status_check CHECK ((publication_status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'live'::text, 'paused'::text, 'rejected'::text])));
alter table public.nav_items add constraint nav_items_destination_type_check CHECK ((destination_type = ANY (ARRAY['route'::text, 'custom'::text])));
alter table public.order_items add constraint order_items_applied_fee_source_check CHECK ((applied_fee_source = ANY (ARRAY['marketplace_default'::text, 'business_override'::text, 'product_override'::text, 'campaign_override'::text])));
alter table public.order_items add constraint order_items_fulfillment_method_check CHECK ((fulfillment_method = ANY (ARRAY['shipping'::text, 'local_delivery'::text, 'pickup'::text, 'event_pickup'::text])));
alter table public.order_items add constraint order_items_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['new'::text, 'confirmed'::text, 'ready'::text, 'fulfilled'::text, 'cancelled'::text])));
alter table public.order_items add constraint order_items_internal_note_length CHECK (((internal_note IS NULL) OR (char_length(internal_note) <= 500)));
alter table public.order_items add constraint order_items_processing_fee_payer_check CHECK ((processing_fee_payer = ANY (ARRAY['vendor'::text, 'customer'::text])));
alter table public.order_items add constraint order_items_quantity_check CHECK ((quantity > 0));
alter table public.orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'canceled'::text])));
alter table public.orders add constraint orders_refund_status_check CHECK ((refund_status = ANY (ARRAY['none'::text, 'partial'::text, 'full'::text])));
alter table public.plan_market_limits add constraint plan_market_limits_market_limit_check CHECK (((market_limit IS NULL) OR (market_limit >= 1)));
alter table public.plan_market_limits add constraint plan_market_limits_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['free'::text, 'pro'::text, 'pro_seller'::text])));
alter table public.pro_invites add constraint pro_invites_duration_days_check CHECK ((duration_days > 0));
alter table public.pro_invites add constraint pro_invites_grant_purpose_check CHECK ((grant_purpose = ANY (ARRAY['business_pro'::text, 'event_management'::text])));
alter table public.pro_invites add constraint pro_invites_max_redemptions_check CHECK (((max_redemptions IS NULL) OR (max_redemptions > 0)));
alter table public.pro_invites add constraint pro_invites_plan_tier_check CHECK ((plan_tier = 'pro'::text));
alter table public.pro_invites add constraint pro_invites_redemption_count_check CHECK ((redemption_count >= 0));
alter table public.product_fulfillment_options add constraint product_fulfillment_options_method_check CHECK ((method = ANY (ARRAY['shipping'::text, 'local_delivery'::text, 'pickup'::text, 'event_pickup'::text])));
alter table public.products add constraint products_inventory_status_check CHECK (((inventory_status IS NULL) OR (inventory_status = ANY (ARRAY['in_stock'::text, 'out_of_stock'::text]))));
alter table public.products add constraint products_marketplace_status_check CHECK ((marketplace_status = ANY (ARRAY['catalog_only'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'paused'::text])));
alter table public.products add constraint products_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending_review'::text, 'live'::text, 'rejected'::text])));
alter table public.products add constraint products_processing_fee_payer_override_check CHECK (((processing_fee_payer_override IS NULL) OR (processing_fee_payer_override = ANY (ARRAY['vendor'::text, 'customer'::text]))));
alter table public.products add constraint products_product_type_check CHECK ((product_type = ANY (ARRAY['product'::text, 'service'::text])));
alter table public.profiles add constraint profiles_bio_length CHECK (((bio IS NULL) OR (char_length(bio) <= 280)));
alter table public.profiles add constraint profiles_location_label_length CHECK (((location_label IS NULL) OR (char_length(location_label) <= 80)));
alter table public.profiles add constraint profiles_phone_format CHECK (((phone IS NULL) OR (phone ~ '^\+1[2-9]\d{2}[2-9]\d{6}$'::text)));
alter table public.profiles add constraint profiles_username_format CHECK (((username IS NULL) OR (username ~ '^[a-z0-9_]{3,20}$'::text)));
alter table public.referral_attributions add constraint referral_attributions_initial_plan_selected_check CHECK ((initial_plan_selected = ANY (ARRAY['free'::text, 'pro'::text])));
alter table public.referral_attributions add constraint referral_attributions_status_check CHECK ((status = ANY (ARRAY['unqualified'::text, 'qualified'::text])));
alter table public.referral_codes add constraint referral_codes_discount_percent_check CHECK (((discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric)));
alter table public.referral_codes add constraint referral_codes_discount_type_check CHECK ((discount_type = 'percentage'::text));
alter table public.referral_codes add constraint referral_codes_max_uses_check CHECK (((max_uses IS NULL) OR (max_uses > 0)));
alter table public.referral_codes add constraint referral_codes_use_count_check CHECK ((use_count >= 0));
alter table public.referral_earnings add constraint referral_earnings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'available'::text, 'included_in_payout'::text, 'paid'::text, 'voided'::text])));
alter table public.referral_partners add constraint referral_partners_default_commission_cents_check CHECK ((default_commission_cents >= 0));
alter table public.referral_payout_requests add constraint referral_payout_requests_requested_amount_cents_check CHECK ((requested_amount_cents > 0));
alter table public.referral_payout_requests add constraint referral_payout_requests_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'paid'::text, 'rejected'::text, 'cancelled'::text])));
alter table public.refunds add constraint refunds_amount_check CHECK ((amount > (0)::numeric));
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_amount_applied_check CHECK ((amount_applied > (0)::numeric));
alter table public.settlement_payments add constraint settlement_payments_amount_check CHECK ((amount > (0)::numeric));
alter table public.settlement_payments add constraint settlement_payments_method_check CHECK ((method = ANY (ARRAY['ach'::text, 'zelle'::text, 'check'::text, 'cash'::text, 'other'::text])));
alter table public.vendor_order_allocations add constraint vendor_order_allocations_status_check CHECK ((status = ANY (ARRAY['held'::text, 'partially_paid'::text, 'paid'::text, 'refunded'::text, 'cancelled'::text])));

-- ============================================================================
-- SECTION 4 — FOREIGN KEY CONSTRAINTS (added after every table/PK/UNIQUE exists)
-- ============================================================================

alter table public.account_entitlements add constraint account_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_businesses add constraint account_followed_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.account_followed_businesses add constraint account_followed_businesses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_followed_events add constraint account_followed_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.account_followed_events add constraint account_followed_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_businesses add constraint account_saved_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.account_saved_businesses add constraint account_saved_businesses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_events add constraint account_saved_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.account_saved_events add constraint account_saved_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_saved_products add constraint account_saved_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.account_saved_products add constraint account_saved_products_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.appearances add constraint appearances_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.appearances add constraint appearances_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_event_occurrence_id_fkey FOREIGN KEY (event_occurrence_id) REFERENCES event_occurrences(id) ON DELETE SET NULL;
alter table public.appearances add constraint appearances_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id);
alter table public.appearances add constraint appearances_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id);
alter table public.business_categories add constraint business_categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_categories add constraint business_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.business_claim_requests add constraint business_claim_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_claim_requests add constraint business_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.business_images add constraint business_images_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE CASCADE;
alter table public.business_market_areas add constraint business_market_areas_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT;
alter table public.business_markets add constraint business_markets_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_markets add constraint business_markets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE RESTRICT;
alter table public.business_members add constraint business_members_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_members add constraint business_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.business_people add constraint business_people_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.business_people add constraint business_people_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
alter table public.businesses add constraint businesses_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.categories add constraint categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
alter table public.event_businesses add constraint event_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.event_businesses add constraint event_businesses_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_categories add constraint event_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.event_categories add constraint event_categories_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_claim_requests add constraint event_claim_requests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_claim_requests add constraint event_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.event_followers add constraint event_followers_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_images add constraint event_images_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_members add constraint event_members_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_members add constraint event_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.event_occurrence_businesses add constraint event_occurrence_businesses_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES event_occurrences(id) ON DELETE CASCADE;
alter table public.event_occurrences add constraint event_occurrences_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_occurrences add constraint event_occurrences_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.event_occurrences add constraint event_occurrences_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.event_products add constraint event_products_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_products add constraint event_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.events add constraint events_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.events add constraint events_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.followers add constraint followers_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.form_assignments add constraint form_assignments_form_id_fkey FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;
alter table public.handles add constraint handles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public.inquiries add constraint inquiries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.inquiry_messages add constraint inquiry_messages_inquiry_id_fkey FOREIGN KEY (inquiry_id) REFERENCES inquiries(id) ON DELETE CASCADE;
alter table public.inquiry_messages add constraint inquiry_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.location_claim_requests add constraint location_claim_requests_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_claim_requests add constraint location_claim_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.location_images add constraint location_images_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_members add constraint location_members_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
alter table public.location_members add constraint location_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.locations add constraint locations_market_area_id_fkey FOREIGN KEY (market_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.market_areas add constraint market_areas_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.market_request_interests add constraint market_request_interests_request_id_fkey FOREIGN KEY (request_id) REFERENCES market_requests(id) ON DELETE CASCADE;
alter table public.market_request_interests add constraint market_request_interests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_mapped_area_id_fkey FOREIGN KEY (mapped_area_id) REFERENCES market_areas(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_mapped_market_id_fkey FOREIGN KEY (mapped_market_id) REFERENCES markets(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_business_id_fkey FOREIGN KEY (source_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE SET NULL;
alter table public.market_requests add constraint market_requests_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.membership_markets add constraint membership_markets_market_id_fkey FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;
alter table public.membership_markets add constraint membership_markets_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE;
alter table public.memberships add constraint memberships_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.memberships add constraint memberships_existing_business_id_fkey FOREIGN KEY (existing_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
alter table public.memberships add constraint memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES membership_plans(id);
alter table public.nav_items add constraint nav_items_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES nav_items(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_appearance_id_fkey FOREIGN KEY (appearance_id) REFERENCES appearances(id);
alter table public.order_items add constraint order_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public.order_items add constraint order_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
alter table public.orders add constraint orders_source_appearance_id_fkey FOREIGN KEY (source_appearance_id) REFERENCES appearances(id);
alter table public.orders add constraint orders_source_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES events(id);
alter table public.orders add constraint orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES pro_invites(id) ON DELETE CASCADE;
alter table public.pro_invite_redemptions add constraint pro_invite_redemptions_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.product_categories add constraint product_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
alter table public.product_categories add constraint product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_fulfillment_options add constraint product_fulfillment_options_appearance_id_fkey FOREIGN KEY (appearance_id) REFERENCES appearances(id) ON DELETE CASCADE;
alter table public.product_fulfillment_options add constraint product_fulfillment_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.products add constraint products_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.referral_attributions add constraint referral_attributions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_attributions add constraint referral_attributions_referral_code_id_fkey FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id);
alter table public.referral_attributions add constraint referral_attributions_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.referral_codes add constraint referral_codes_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_attribution_id_fkey FOREIGN KEY (attribution_id) REFERENCES referral_attributions(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_earnings add constraint referral_earnings_payout_request_id_fkey FOREIGN KEY (payout_request_id) REFERENCES referral_payout_requests(id);
alter table public.referral_earnings add constraint referral_earnings_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.referral_partners add constraint referral_partners_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.referral_payout_requests add constraint referral_payout_requests_referral_partner_id_fkey FOREIGN KEY (referral_partner_id) REFERENCES referral_partners(id);
alter table public.refunds add constraint refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.refunds add constraint refunds_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE;
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_settlement_payment_id_fkey FOREIGN KEY (settlement_payment_id) REFERENCES settlement_payments(id) ON DELETE CASCADE;
alter table public.settlement_payment_allocations add constraint settlement_payment_allocations_vendor_order_allocation_id_fkey FOREIGN KEY (vendor_order_allocation_id) REFERENCES vendor_order_allocations(id);
alter table public.settlement_payments add constraint settlement_payments_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public.vendor_order_allocations add constraint vendor_order_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- ============================================================================
-- SECTION 5 — INDEXES (beyond those implied by PK/UNIQUE constraints above)
-- ============================================================================

CREATE INDEX account_entitlements_user_id_idx ON public.account_entitlements USING btree (user_id);
CREATE INDEX account_followed_businesses_user_id_idx ON public.account_followed_businesses USING btree (user_id);
CREATE INDEX account_followed_events_event_id_idx ON public.account_followed_events USING btree (event_id);
CREATE INDEX account_followed_events_user_id_idx ON public.account_followed_events USING btree (user_id);
CREATE INDEX account_saved_businesses_user_id_idx ON public.account_saved_businesses USING btree (user_id);
CREATE INDEX account_saved_events_user_id_idx ON public.account_saved_events USING btree (user_id);
CREATE INDEX account_saved_products_user_id_idx ON public.account_saved_products USING btree (user_id);
CREATE INDEX appearances_market_area_id_idx ON public.appearances USING btree (market_area_id);
CREATE INDEX appearances_market_id_idx ON public.appearances USING btree (market_id);
CREATE UNIQUE INDEX appearances_one_per_business_occurrence ON public.appearances USING btree (business_id, event_occurrence_id) WHERE ((event_occurrence_id IS NOT NULL) AND (status <> 'canceled'::text));
CREATE INDEX idx_appearances_business_id ON public.appearances USING btree (business_id);
CREATE INDEX idx_appearances_event_id ON public.appearances USING btree (event_id);
CREATE INDEX idx_appearances_start_at ON public.appearances USING btree (start_at);
CREATE INDEX business_claim_requests_business_id_idx ON public.business_claim_requests USING btree (business_id);
CREATE UNIQUE INDEX business_claim_requests_one_pending ON public.business_claim_requests USING btree (user_id, business_id) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX business_claim_requests_payment_reference_idx ON public.business_claim_requests USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);
CREATE INDEX business_claim_requests_status_idx ON public.business_claim_requests USING btree (status);
CREATE INDEX business_claim_requests_status_payment_status_idx ON public.business_claim_requests USING btree (status, payment_status);
CREATE INDEX business_claim_requests_user_id_idx ON public.business_claim_requests USING btree (user_id);
CREATE INDEX business_images_business_order_idx ON public.business_images USING btree (business_id, display_order);
CREATE INDEX business_market_areas_business_id_idx ON public.business_market_areas USING btree (business_id);
CREATE INDEX business_market_areas_market_area_id_idx ON public.business_market_areas USING btree (market_area_id);
CREATE INDEX business_market_areas_market_id_idx ON public.business_market_areas USING btree (market_id);
CREATE UNIQUE INDEX business_markets_business_market_unique ON public.business_markets USING btree (business_id, market_id);
CREATE INDEX business_markets_market_id_idx ON public.business_markets USING btree (market_id);
CREATE UNIQUE INDEX business_markets_one_active_primary ON public.business_markets USING btree (business_id) WHERE ((relationship = 'primary'::text) AND active);
CREATE INDEX business_members_business_id_idx ON public.business_members USING btree (business_id);
CREATE UNIQUE INDEX business_members_one_owner_per_business ON public.business_members USING btree (business_id) WHERE (role = 'owner'::text);
CREATE INDEX business_members_user_id_idx ON public.business_members USING btree (user_id);
CREATE INDEX businesses_market_area_id_idx ON public.businesses USING btree (market_area_id);
CREATE INDEX idx_businesses_city ON public.businesses USING btree (city);
CREATE INDEX idx_categories_kind ON public.categories USING btree (kind);
CREATE INDEX idx_categories_parent_id ON public.categories USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE INDEX idx_event_businesses_business_id ON public.event_businesses USING btree (business_id);
CREATE INDEX idx_event_businesses_event_id ON public.event_businesses USING btree (event_id);
CREATE INDEX event_claim_requests_event_id_idx ON public.event_claim_requests USING btree (event_id);
CREATE UNIQUE INDEX event_claim_requests_one_pending ON public.event_claim_requests USING btree (user_id, event_id) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX event_claim_requests_payment_reference_idx ON public.event_claim_requests USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);
CREATE INDEX event_claim_requests_status_idx ON public.event_claim_requests USING btree (status);
CREATE INDEX event_claim_requests_status_payment_status_idx ON public.event_claim_requests USING btree (status, payment_status);
CREATE INDEX event_claim_requests_user_id_idx ON public.event_claim_requests USING btree (user_id);
CREATE INDEX event_images_event_kind_order_idx ON public.event_images USING btree (event_id, kind, display_order);
CREATE INDEX event_members_event_id_idx ON public.event_members USING btree (event_id);
CREATE UNIQUE INDEX event_members_one_owner_per_event ON public.event_members USING btree (event_id) WHERE (role = 'owner'::text);
CREATE INDEX event_members_user_id_idx ON public.event_members USING btree (user_id);
CREATE INDEX event_occurrence_businesses_approved_idx ON public.event_occurrence_businesses USING btree (occurrence_id, featured) WHERE (status = 'approved'::text);
CREATE INDEX event_occurrence_businesses_business_id_idx ON public.event_occurrence_businesses USING btree (business_id);
CREATE INDEX event_occurrence_businesses_occurrence_id_idx ON public.event_occurrence_businesses USING btree (occurrence_id);
CREATE INDEX event_occurrences_event_id_idx ON public.event_occurrences USING btree (event_id);
CREATE INDEX event_occurrences_featured_idx ON public.event_occurrences USING btree (event_id, start_at) WHERE ((featured = true) AND (status = 'scheduled'::text));
CREATE INDEX event_occurrences_market_id_idx ON public.event_occurrences USING btree (market_id);
CREATE INDEX event_occurrences_start_end_idx ON public.event_occurrences USING btree (start_at, end_at);
CREATE INDEX event_occurrences_upcoming_idx ON public.event_occurrences USING btree (event_id, end_at) WHERE (status = 'scheduled'::text);
CREATE INDEX events_market_area_id_idx ON public.events USING btree (market_area_id);
CREATE INDEX events_market_id_idx ON public.events USING btree (market_id);
CREATE INDEX idx_events_start_at ON public.events USING btree (start_at);
CREATE INDEX idx_followers_business_id ON public.followers USING btree (business_id);
CREATE UNIQUE INDEX forms_one_default_per_purpose ON public.forms USING btree (purpose) WHERE (is_default = true);
CREATE UNIQUE INDEX handles_entity_unique_idx ON public.handles USING btree (entity_type, entity_id);
CREATE UNIQUE INDEX handles_handle_unique_idx ON public.handles USING btree (handle);
CREATE INDEX handles_user_id_idx ON public.handles USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_inquiries_business_id ON public.inquiries USING btree (business_id);
CREATE INDEX inquiries_business_id_idx ON public.inquiries USING btree (business_id);
CREATE INDEX inquiries_product_id_idx ON public.inquiries USING btree (product_id);
CREATE INDEX inquiries_user_id_idx ON public.inquiries USING btree (user_id);
CREATE INDEX inquiry_messages_inquiry_id_idx ON public.inquiry_messages USING btree (inquiry_id, created_at);
CREATE INDEX location_claim_requests_location_id_idx ON public.location_claim_requests USING btree (location_id);
CREATE UNIQUE INDEX location_claim_requests_one_pending ON public.location_claim_requests USING btree (user_id, location_id) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX location_claim_requests_payment_reference_idx ON public.location_claim_requests USING btree (payment_reference) WHERE (payment_reference IS NOT NULL);
CREATE INDEX location_claim_requests_status_idx ON public.location_claim_requests USING btree (status);
CREATE INDEX location_claim_requests_user_id_idx ON public.location_claim_requests USING btree (user_id);
CREATE INDEX location_images_location_id_idx ON public.location_images USING btree (location_id);
CREATE INDEX location_members_location_id_idx ON public.location_members USING btree (location_id);
CREATE UNIQUE INDEX location_members_one_owner_per_location ON public.location_members USING btree (location_id) WHERE (role = 'owner'::text);
CREATE INDEX location_members_user_id_idx ON public.location_members USING btree (user_id);
CREATE INDEX locations_market_id_idx ON public.locations USING btree (market_id);
CREATE INDEX market_areas_market_id_idx ON public.market_areas USING btree (market_id);
CREATE UNIQUE INDEX market_request_interests_email_unique ON public.market_request_interests USING btree (request_id, email) WHERE (email IS NOT NULL);
CREATE UNIQUE INDEX market_request_interests_user_unique ON public.market_request_interests USING btree (request_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX market_requests_effective_key_idx ON public.market_requests USING btree (effective_normalized_key);
CREATE INDEX market_requests_mapped_area_id_idx ON public.market_requests USING btree (mapped_area_id);
CREATE INDEX market_requests_normalized_key_idx ON public.market_requests USING btree (normalized_key);
CREATE INDEX market_requests_source_business_id_idx ON public.market_requests USING btree (source_business_id);
CREATE INDEX market_requests_source_event_id_idx ON public.market_requests USING btree (source_event_id);
CREATE INDEX market_requests_source_location_id_idx ON public.market_requests USING btree (source_location_id);
CREATE INDEX market_requests_status_idx ON public.market_requests USING btree (status);
CREATE INDEX memberships_billing_status_idx ON public.memberships USING btree (billing_status);
CREATE INDEX memberships_business_id_idx ON public.memberships USING btree (business_id);
CREATE INDEX memberships_invite_token_idx ON public.memberships USING btree (invite_token);
CREATE INDEX memberships_publication_status_idx ON public.memberships USING btree (publication_status);
CREATE INDEX nav_items_parent_id_idx ON public.nav_items USING btree (parent_id);
CREATE INDEX order_items_business_id_idx ON public.order_items USING btree (business_id);
CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);
CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at DESC);
CREATE INDEX orders_stripe_checkout_session_id_idx ON public.orders USING btree (stripe_checkout_session_id);
CREATE INDEX orders_stripe_payment_intent_id_idx ON public.orders USING btree (stripe_payment_intent_id);
CREATE INDEX orders_user_id_idx ON public.orders USING btree (user_id);
CREATE UNIQUE INDEX pro_invites_code_ci_key ON public.pro_invites USING btree (upper(code));
CREATE INDEX idx_product_categories_category_id ON public.product_categories USING btree (category_id);
CREATE INDEX product_fulfillment_options_appearance_id_idx ON public.product_fulfillment_options USING btree (appearance_id);
CREATE INDEX product_fulfillment_options_product_id_idx ON public.product_fulfillment_options USING btree (product_id);
CREATE INDEX idx_products_business_id ON public.products USING btree (business_id);
CREATE INDEX profiles_username_lookup_idx ON public.profiles USING btree (username) WHERE (username IS NOT NULL);
CREATE UNIQUE INDEX profiles_username_unique_idx ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX referral_attributions_partner_idx ON public.referral_attributions USING btree (referral_partner_id);
CREATE UNIQUE INDEX referral_codes_code_ci_key ON public.referral_codes USING btree (upper(code));
CREATE INDEX referral_codes_partner_idx ON public.referral_codes USING btree (referral_partner_id);
CREATE INDEX referral_earnings_partner_idx ON public.referral_earnings USING btree (referral_partner_id);
CREATE INDEX referral_earnings_payout_request_idx ON public.referral_earnings USING btree (payout_request_id);
CREATE INDEX referral_payout_requests_partner_idx ON public.referral_payout_requests USING btree (referral_partner_id);
CREATE INDEX refunds_order_id_idx ON public.refunds USING btree (order_id);
CREATE INDEX refunds_order_item_id_idx ON public.refunds USING btree (order_item_id);
CREATE INDEX settlement_payment_allocations_allocation_id_idx ON public.settlement_payment_allocations USING btree (vendor_order_allocation_id);
CREATE INDEX settlement_payment_allocations_payment_id_idx ON public.settlement_payment_allocations USING btree (settlement_payment_id);
CREATE INDEX settlement_payments_business_id_idx ON public.settlement_payments USING btree (business_id);
CREATE INDEX vendor_order_allocations_business_id_idx ON public.vendor_order_allocations USING btree (business_id);
CREATE INDEX vendor_order_allocations_status_idx ON public.vendor_order_allocations USING btree (status);

-- ============================================================================
-- SECTION 6 — ROW LEVEL SECURITY: enable on every table (none use FORCE ROW
-- LEVEL SECURITY in the live schema, so none is added here — table owners/
-- service_role continue to bypass RLS exactly as they do today).
-- ============================================================================

alter table public.account_entitlements enable row level security;
alter table public.account_followed_businesses enable row level security;
alter table public.account_followed_events enable row level security;
alter table public.account_saved_businesses enable row level security;
alter table public.account_saved_events enable row level security;
alter table public.account_saved_products enable row level security;
alter table public.appearances enable row level security;
alter table public.business_categories enable row level security;
alter table public.business_claim_requests enable row level security;
alter table public.business_images enable row level security;
alter table public.business_market_areas enable row level security;
alter table public.business_markets enable row level security;
alter table public.business_members enable row level security;
alter table public.business_people enable row level security;
alter table public.businesses enable row level security;
alter table public.categories enable row level security;
alter table public.event_businesses enable row level security;
alter table public.event_categories enable row level security;
alter table public.event_claim_requests enable row level security;
alter table public.event_followers enable row level security;
alter table public.event_images enable row level security;
alter table public.event_members enable row level security;
alter table public.event_occurrence_businesses enable row level security;
alter table public.event_occurrences enable row level security;
alter table public.event_products enable row level security;
alter table public.events enable row level security;
alter table public.followers enable row level security;
alter table public.form_assignments enable row level security;
alter table public.forms enable row level security;
alter table public.handles enable row level security;
alter table public.homepage_rows enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_messages enable row level security;
alter table public.location_claim_requests enable row level security;
alter table public.location_images enable row level security;
alter table public.location_members enable row level security;
alter table public.locations enable row level security;
alter table public.market_areas enable row level security;
alter table public.market_request_interests enable row level security;
alter table public.market_requests enable row level security;
alter table public.markets enable row level security;
alter table public.membership_markets enable row level security;
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.nav_items enable row level security;
alter table public.order_items enable row level security;
alter table public.orders enable row level security;
alter table public.people enable row level security;
alter table public.plan_market_limits enable row level security;
alter table public.pro_invite_redemptions enable row level security;
alter table public.pro_invites enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_fulfillment_options enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_earnings enable row level security;
alter table public.referral_partners enable row level security;
alter table public.referral_payout_requests enable row level security;
alter table public.refunds enable row level security;
alter table public.settlement_payment_allocations enable row level security;
alter table public.settlement_payments enable row level security;
alter table public.site_sections enable row level security;
alter table public.vendor_order_allocations enable row level security;

-- ============================================================================
-- SECTION 7 — RLS POLICIES
-- ============================================================================

create policy "account_followed_businesses_delete_own" on public.account_followed_businesses for DELETE to authenticated
  using ((auth.uid() = user_id));

create policy "account_followed_businesses_insert_own" on public.account_followed_businesses for INSERT to authenticated
  with check ((auth.uid() = user_id));

create policy "account_followed_businesses_select_own" on public.account_followed_businesses for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "account_followed_events_delete_own" on public.account_followed_events for DELETE to authenticated
  using ((auth.uid() = user_id));

create policy "account_followed_events_insert_own" on public.account_followed_events for INSERT to authenticated
  with check ((auth.uid() = user_id));

create policy "account_followed_events_select_own" on public.account_followed_events for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_businesses_delete_own" on public.account_saved_businesses for DELETE to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_businesses_insert_own" on public.account_saved_businesses for INSERT to authenticated
  with check ((auth.uid() = user_id));

create policy "account_saved_businesses_select_own" on public.account_saved_businesses for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_events_delete_own" on public.account_saved_events for DELETE to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_events_insert_own" on public.account_saved_events for INSERT to authenticated
  with check ((auth.uid() = user_id));

create policy "account_saved_events_select_own" on public.account_saved_events for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_products_delete_own" on public.account_saved_products for DELETE to authenticated
  using ((auth.uid() = user_id));

create policy "account_saved_products_insert_own" on public.account_saved_products for INSERT to authenticated
  with check ((auth.uid() = user_id));

create policy "account_saved_products_select_own" on public.account_saved_products for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "Public read appearances" on public.appearances for SELECT to public
  using ((status <> 'canceled'::text));

create policy "Public read business_categories" on public.business_categories for SELECT to public
  using (true);

create policy "business_claim_requests_insert_own_pending" on public.business_claim_requests for INSERT to authenticated
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (payment_status = 'unpaid'::text)));

create policy "business_claim_requests_select_own" on public.business_claim_requests for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "business_images are publicly readable" on public.business_images for SELECT to public
  using (true);

create policy "business_members_select_own" on public.business_members for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "Public read business people" on public.business_people for SELECT to public
  using (true);

create policy "Public read businesses" on public.businesses for SELECT to public
  using (true);

create policy "Public read categories" on public.categories for SELECT to public
  using (true);

create policy "Public read event_businesses" on public.event_businesses for SELECT to public
  using (true);

create policy "Public read event categories" on public.event_categories for SELECT to public
  using (true);

create policy "event_claim_requests_insert_own_pending" on public.event_claim_requests for INSERT to authenticated
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (payment_status = 'unpaid'::text)));

create policy "event_claim_requests_select_own" on public.event_claim_requests for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "Public insert event_followers" on public.event_followers for INSERT to public
  with check (true);

create policy "event_images are publicly readable" on public.event_images for SELECT to public
  using (true);

create policy "event_members_select_own" on public.event_members for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "event_occurrence_businesses approved rows are publicly readable" on public.event_occurrence_businesses for SELECT to public
  using ((status = 'approved'::text));

create policy "event_occurrences are publicly readable" on public.event_occurrences for SELECT to public
  using (true);

create policy "event_products are publicly readable" on public.event_products for SELECT to public
  using (true);

create policy "Public read events" on public.events for SELECT to public
  using (true);

create policy "Public insert followers" on public.followers for INSERT to public
  with check (true);

create policy "Public read form assignments" on public.form_assignments for SELECT to public
  using (true);

create policy "Public read active forms" on public.forms for SELECT to public
  using ((is_active = true));

create policy "handles_select_own" on public.handles for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "Public read visible homepage rows" on public.homepage_rows for SELECT to public
  using ((is_visible = true));

create policy "Public insert inquiries" on public.inquiries for INSERT to public
  with check (true);

create policy "inquiries_insert_customer" on public.inquiries for INSERT to authenticated
  with check ((user_id = auth.uid()));

create policy "inquiries_select_business_member" on public.inquiries for SELECT to authenticated
  using (((business_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM business_members bm
  WHERE ((bm.business_id = inquiries.business_id) AND (bm.user_id = auth.uid()))))));

create policy "inquiries_select_customer" on public.inquiries for SELECT to authenticated
  using ((user_id = auth.uid()));

create policy "inquiry_messages_insert_business_member" on public.inquiry_messages for INSERT to authenticated
  with check (((sender_type = 'business'::text) AND (sender_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (inquiries i
     JOIN business_members bm ON ((bm.business_id = i.business_id)))
  WHERE ((i.id = inquiry_messages.inquiry_id) AND (bm.user_id = auth.uid()))))));

create policy "inquiry_messages_insert_customer" on public.inquiry_messages for INSERT to authenticated
  with check (((sender_type = 'customer'::text) AND (sender_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM inquiries i
  WHERE ((i.id = inquiry_messages.inquiry_id) AND (i.user_id = auth.uid()))))));

create policy "inquiry_messages_select_business_member" on public.inquiry_messages for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM (inquiries i
     JOIN business_members bm ON ((bm.business_id = i.business_id)))
  WHERE ((i.id = inquiry_messages.inquiry_id) AND (bm.user_id = auth.uid())))));

create policy "inquiry_messages_select_customer" on public.inquiry_messages for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM inquiries i
  WHERE ((i.id = inquiry_messages.inquiry_id) AND (i.user_id = auth.uid())))));

create policy "location_claim_requests_insert_own_pending" on public.location_claim_requests for INSERT to authenticated
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (payment_status = 'unpaid'::text)));

create policy "location_claim_requests_select_own" on public.location_claim_requests for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "location_images_public_read" on public.location_images for SELECT to anon, authenticated
  using (true);

create policy "location_members_select_own" on public.location_members for SELECT to authenticated
  using ((auth.uid() = user_id));

create policy "Public read locations" on public.locations for SELECT to public
  using (true);

create policy "Public read market areas" on public.market_areas for SELECT to public
  using (true);

create policy "Public read active markets" on public.markets for SELECT to public
  using (true);

create policy "Public read membership plans" on public.membership_plans for SELECT to public
  using (true);

create policy "Public read visible nav items" on public.nav_items for SELECT to public
  using ((is_visible = true));

create policy "order_items_select_own_customer" on public.order_items for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = auth.uid())))));

create policy "orders_select_own" on public.orders for SELECT to authenticated
  using ((user_id = auth.uid()));

create policy "Public read public people" on public.people for SELECT to public
  using ((is_public = true));

create policy "Public read plan market limits" on public.plan_market_limits for SELECT to public
  using (true);

create policy "Public read product_categories" on public.product_categories for SELECT to public
  using (true);

create policy "Public read enabled fulfillment options" on public.product_fulfillment_options for SELECT to public
  using ((enabled = true));

create policy "Public read active products" on public.products for SELECT to public
  using (((is_active = true) AND (moderation_status = 'live'::text)));

create policy "profiles_select_own" on public.profiles for SELECT to authenticated
  using ((auth.uid() = id));

create policy "profiles_update_own" on public.profiles for UPDATE to authenticated
  using ((auth.uid() = id))
  with check ((auth.uid() = id));

create policy "Public read site sections" on public.site_sections for SELECT to public
  using (true);

-- ============================================================================
-- SECTION 8 — VIEWS
-- ============================================================================

create view public.public_profiles as
 SELECT username,
    display_name,
    avatar_url,
    bio,
    location_label
   FROM profiles
  WHERE username IS NOT NULL;

create view public.public_handles as
 SELECT handle,
    entity_type,
    entity_id
   FROM handles;

grant select on public.public_profiles to anon, authenticated;
grant select on public.public_handles to anon, authenticated;

-- ============================================================================
-- SECTION 9 — FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_business_claim(p_claim_id uuid)
 RETURNS business_claim_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim public.business_claim_requests;
begin
  select * into v_claim from public.business_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.business_members
    where business_id = v_claim.business_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.business_members
    where business_id = v_claim.business_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.business_members (user_id, business_id, role)
    values (v_claim.user_id, v_claim.business_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.business_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_event_claim(p_claim_id uuid)
 RETURNS event_claim_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim public.event_claim_requests;
begin
  select * into v_claim from public.event_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.event_members
    where event_id = v_claim.event_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.event_members
    where event_id = v_claim.event_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.event_members (user_id, event_id, role)
    values (v_claim.user_id, v_claim.event_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.event_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_location_claim(p_claim_id uuid)
 RETURNS location_claim_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim public.location_claim_requests;
begin
  select * into v_claim from public.location_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.location_members
    where location_id = v_claim.location_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.location_members
    where location_id = v_claim.location_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.location_members (user_id, location_id, role)
    values (v_claim.user_id, v_claim.location_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.location_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attribute_referral(p_business_id uuid, p_code text, p_initial_plan text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code public.referral_codes;
  v_now timestamptz := now();
begin
  if p_business_id is null then
    raise exception 'business_required';
  end if;
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;
  if p_initial_plan is not null and p_initial_plan not in ('free', 'pro') then
    raise exception 'invalid_plan';
  end if;

  if exists (select 1 from public.referral_attributions where business_id = p_business_id) then
    raise exception 'already_attributed';
  end if;

  select * into v_code
  from public.referral_codes
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_code.id is null then
    raise exception 'invalid_code';
  end if;
  if not v_code.is_active then
    raise exception 'code_inactive';
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= v_now then
    raise exception 'code_expired';
  end if;
  if v_code.max_uses is not null and v_code.use_count >= v_code.max_uses then
    raise exception 'code_limit_reached';
  end if;

  insert into public.referral_attributions (
    business_id, referral_partner_id, referral_code_id, referred_at, initial_plan_selected
  ) values (
    p_business_id, v_code.referral_partner_id, v_code.id, v_now, p_initial_plan
  );

  update public.referral_codes set use_count = use_count + 1 where id = v_code.id;

  return jsonb_build_object(
    'referral_partner_id', v_code.referral_partner_id,
    'referral_code_id', v_code.id,
    'discount_percent', v_code.discount_percent
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_owned_business(p_user_id uuid, p_name text, p_slug text, p_category_id uuid, p_city text, p_state text, p_website_url text, p_instagram_url text, p_market_id uuid, p_requested_market_text text DEFAULT NULL::text)
 RETURNS businesses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_business public.businesses;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug_required';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id and kind = 'business') then
    raise exception 'invalid_category';
  end if;

  if p_market_id is null and (p_requested_market_text is null or btrim(p_requested_market_text) = '') then
    raise exception 'market_required';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.businesses (
    name, slug, city, state, website_url, instagram_url,
    plan_tier, publication_status, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_website_url, '')), ''),
    nullif(btrim(coalesce(p_instagram_url, '')), ''),
    'free',
    'pending_review',
    false
  )
  returning * into v_business;

  perform public.set_business_category(v_business.id, p_category_id);

  insert into public.business_members (user_id, business_id, role)
  values (p_user_id, v_business.id, 'owner');

  if p_market_id is not null then
    insert into public.business_markets (business_id, market_id, relationship, provenance, active)
    values (v_business.id, p_market_id, 'primary', 'self_selected', true);
  else
    insert into public.market_requests (
      requested_text, city, state, normalized_key, requester_user_id, source, source_business_id
    ) values (
      btrim(p_requested_market_text),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'business_creation',
      v_business.id
    );
  end if;

  return v_business;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_owned_event(p_user_id uuid, p_name text, p_slug text, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_market_id uuid DEFAULT NULL::uuid, p_requested_market_text text DEFAULT NULL::text)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug_required';
  end if;
  if p_start_at is null then
    raise exception 'start_required';
  end if;
  if p_end_at is null or p_end_at <= p_start_at then
    raise exception 'invalid_end';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.events (
    name, slug, start_at, end_at, market_id, is_demo, publication_status
  ) values (
    btrim(p_name),
    btrim(p_slug),
    p_start_at,
    p_end_at,
    p_market_id,
    true,
    'pending_review'
  )
  returning * into v_event;

  insert into public.event_members (user_id, event_id, role)
  values (p_user_id, v_event.id, 'owner');

  if p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    insert into public.market_requests (
      requested_text, normalized_key, effective_normalized_key, requester_user_id, source, source_event_id
    ) values (
      btrim(p_requested_market_text),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'event_creation',
      v_event.id
    );
  end if;

  return v_event;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_owned_location(p_user_id uuid, p_name text, p_slug text, p_address text, p_city text, p_state text, p_market_id uuid DEFAULT NULL::uuid, p_requested_market_text text DEFAULT NULL::text)
 RETURNS locations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location public.locations;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug_required';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.locations (
    name, slug, address, city, state, market_id, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    p_market_id,
    true
  )
  returning * into v_location;

  insert into public.location_members (user_id, location_id, role)
  values (p_user_id, v_location.id, 'owner');

  if p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    insert into public.market_requests (
      requested_text, city, state, normalized_key, effective_normalized_key, requester_user_id, source, source_location_id
    ) values (
      btrim(p_requested_market_text),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'location_creation',
      v_location.id
    );
  end if;

  return v_location;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_category_hierarchy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.follow_business(p_business_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into followers (business_id, email)
  values (p_business_id, p_email)
  on conflict (business_id, email) do update set email = excluded.email;
end;
$function$;

CREATE OR REPLACE FUNCTION public.follow_event(p_event_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into event_followers (event_id, email)
  values (p_event_id, p_email)
  on conflict (event_id, email) do update set email = excluded.email;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  meta_display_name text;
  meta_phone text;
begin
  meta_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  meta_phone := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
  insert into public.profiles (id, display_name, phone) values (new.id, meta_display_name, meta_phone);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.lookup_auth_user_id_by_email(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.mark_inquiry_read(p_inquiry_id uuid, p_as text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_as = 'customer' then
    update public.inquiries
    set customer_last_read_at = now()
    where id = p_inquiry_id and user_id = auth.uid();
  elsif p_as = 'business' then
    update public.inquiries
    set business_last_read_at = now()
    where id = p_inquiry_id
      and business_id is not null
      and exists (
        select 1 from public.business_members bm
        where bm.business_id = inquiries.business_id and bm.user_id = auth.uid()
      );
  else
    raise exception 'invalid role';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qualify_referral_earning(p_business_id uuid, p_stripe_session_id text, p_gross_amount_cents integer, p_discount_amount_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_attribution public.referral_attributions;
  v_partner public.referral_partners;
  v_commission_cents integer;
  v_earning_id uuid;
begin
  if p_business_id is null or p_stripe_session_id is null then
    raise exception 'invalid_arguments';
  end if;

  select * into v_attribution from public.referral_attributions where business_id = p_business_id;
  if v_attribution.id is null then
    return jsonb_build_object('qualified', false, 'reason', 'not_referred');
  end if;

  select * into v_partner from public.referral_partners where id = v_attribution.referral_partner_id;
  if v_partner.id is null then
    return jsonb_build_object('qualified', false, 'reason', 'partner_not_found');
  end if;

  v_commission_cents := v_partner.default_commission_cents;

  begin
    insert into public.referral_earnings (
      referral_partner_id, business_id, attribution_id, qualifying_payment_reference,
      gross_amount_cents, discount_amount_cents, commission_amount_cents, status
    ) values (
      v_attribution.referral_partner_id, p_business_id, v_attribution.id, p_stripe_session_id,
      p_gross_amount_cents, p_discount_amount_cents, v_commission_cents, 'available'
    )
    returning id into v_earning_id;
  exception when unique_violation then
    return jsonb_build_object('qualified', false, 'reason', 'already_qualified');
  end;

  update public.referral_attributions
  set
    status = 'qualified',
    converted_to_pro_at = now(),
    qualifying_payment_reference = p_stripe_session_id,
    gross_amount_cents = p_gross_amount_cents,
    discount_amount_cents = p_discount_amount_cents
  where id = v_attribution.id and status = 'unqualified';

  return jsonb_build_object(
    'qualified', true,
    'earning_id', v_earning_id,
    'referral_partner_id', v_attribution.referral_partner_id,
    'commission_amount_cents', v_commission_cents
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_event_management_invite(p_code text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.pro_invites;
  v_now timestamptz := now();
  v_candidate_expiry timestamptz;
  v_source text;
  v_existing_expires_at timestamptz;
  v_granted_expiry timestamptz;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;

  select * into v_invite
  from public.pro_invites
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_invite.id is null then
    raise exception 'invalid_code';
  end if;
  if v_invite.grant_purpose <> 'event_management' then
    raise exception 'wrong_invite_purpose';
  end if;
  if not v_invite.is_active then
    raise exception 'invite_inactive';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= v_now then
    raise exception 'invite_expired';
  end if;
  if v_invite.max_redemptions is not null and v_invite.redemption_count >= v_invite.max_redemptions then
    raise exception 'invite_redemption_limit_reached';
  end if;

  v_candidate_expiry := v_now + make_interval(days => v_invite.duration_days);
  v_source := 'invite:' || v_invite.code;

  select expires_at into v_existing_expires_at
  from public.account_entitlements
  where user_id = p_user_id and entitlement_key = 'event_management' and source = v_source
  for update;

  if v_existing_expires_at is not null and v_existing_expires_at > v_candidate_expiry then
    v_granted_expiry := v_existing_expires_at;
  else
    v_granted_expiry := v_candidate_expiry;
  end if;

  insert into public.account_entitlements (user_id, entitlement_key, source, granted_at, expires_at)
  values (p_user_id, 'event_management', v_source, v_now, v_granted_expiry)
  on conflict (user_id, entitlement_key, source)
  do update set expires_at = v_granted_expiry;

  update public.pro_invites
  set redemption_count = redemption_count + 1
  where id = v_invite.id;

  return jsonb_build_object('granted_until', v_granted_expiry);
end;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_pro_invite(p_code text, p_business_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_invite public.pro_invites;
  v_business public.businesses;
  v_now timestamptz := now();
  v_candidate_expiry timestamptz;
  v_granted_expiry timestamptz;
  v_will_touch_plan boolean;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_business_id is null then
    raise exception 'business_required';
  end if;

  if not exists (
    select 1 from public.business_members
    where business_id = p_business_id and user_id = p_user_id
  ) then
    raise exception 'not_authorized_for_business';
  end if;

  if p_code is null or btrim(p_code) = '' then
    raise exception 'invalid_code';
  end if;

  select * into v_invite
  from public.pro_invites
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_invite.id is null then
    raise exception 'invalid_code';
  end if;
  if not v_invite.is_active then
    raise exception 'invite_inactive';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= v_now then
    raise exception 'invite_expired';
  end if;
  if v_invite.max_redemptions is not null and v_invite.redemption_count >= v_invite.max_redemptions then
    raise exception 'invite_redemption_limit_reached';
  end if;
  if exists (
    select 1 from public.pro_invite_redemptions
    where invite_id = v_invite.id and business_id = p_business_id
  ) then
    raise exception 'already_redeemed_by_business';
  end if;

  select * into v_business from public.businesses where id = p_business_id for update;
  if v_business.id is null then
    raise exception 'business_not_found';
  end if;

  v_will_touch_plan := v_business.plan_tier is distinct from 'pro_seller';

  v_candidate_expiry := v_now + make_interval(days => v_invite.duration_days);
  if v_business.plan_expires_at is not null and v_business.plan_expires_at > v_candidate_expiry then
    v_granted_expiry := v_business.plan_expires_at;
  else
    v_granted_expiry := v_candidate_expiry;
  end if;

  if v_will_touch_plan then
    update public.businesses
    set
      plan_tier = 'pro',
      plan_source = 'complimentary',
      plan_started_at = coalesce(plan_started_at, v_now),
      plan_expires_at = v_granted_expiry,
      plan_payment_reference = 'invite:' || v_invite.code
    where id = p_business_id;
  end if;

  insert into public.pro_invite_redemptions (
    invite_id, business_id, redeemed_by, previous_plan_tier, granted_plan_tier, granted_until
  ) values (
    v_invite.id, p_business_id, p_user_id, v_business.plan_tier, 'pro', v_granted_expiry
  );

  update public.pro_invites
  set redemption_count = redemption_count + 1
  where id = v_invite.id;

  return jsonb_build_object(
    'business_id', p_business_id,
    'business_name', v_business.name,
    'plan_tier_changed', v_will_touch_plan,
    'granted_until', v_granted_expiry
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_business_owner(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner public.business_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('business_members:' || p_business_id::text));

  select * into v_owner
  from public.business_members
  where business_id = p_business_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.business_members where id = v_owner.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_event_owner(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner public.event_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('event_members:' || p_event_id::text));

  select * into v_owner
  from public.event_members
  where event_id = p_event_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.event_members where id = v_owner.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_location_owner(p_location_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner public.location_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('location_members:' || p_location_id::text));

  select * into v_owner
  from public.location_members
  where location_id = p_location_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.location_members where id = v_owner.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_referral_payout(p_referral_partner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total_cents integer;
  v_request_id uuid;
begin
  if p_referral_partner_id is null then
    raise exception 'partner_required';
  end if;

  if not exists (select 1 from public.referral_partners where id = p_referral_partner_id) then
    raise exception 'partner_not_found';
  end if;

  perform 1
  from public.referral_earnings
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null
  for update;

  select coalesce(sum(commission_amount_cents), 0) into v_total_cents
  from public.referral_earnings
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null;

  if v_total_cents <= 0 then
    raise exception 'no_available_balance';
  end if;

  insert into public.referral_payout_requests (referral_partner_id, requested_amount_cents, status)
  values (p_referral_partner_id, v_total_cents, 'requested')
  returning id into v_request_id;

  update public.referral_earnings
  set status = 'included_in_payout', payout_request_id = v_request_id
  where referral_partner_id = p_referral_partner_id
    and status = 'available'
    and payout_request_id is null;

  return jsonb_build_object('payout_request_id', v_request_id, 'requested_amount_cents', v_total_cents);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_category(p_business_id uuid, p_category_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.categories
    where id = p_category_id and kind = 'business'
  ) then
    raise exception 'invalid_category';
  end if;

  if not exists (
    select 1 from public.businesses where id = p_business_id
  ) then
    raise exception 'business_not_found';
  end if;

  delete from public.business_categories where business_id = p_business_id;

  insert into public.business_categories (business_id, category_id)
  values (p_business_id, p_category_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_inquiry_status(p_inquiry_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_status not in ('new', 'replied', 'contacted', 'booked', 'closed') then
    raise exception 'invalid status';
  end if;

  update public.inquiries
  set status = p_status
  where id = p_inquiry_id
    and business_id is not null
    and exists (
      select 1 from public.business_members bm
      where bm.business_id = inquiries.business_id and bm.user_id = auth.uid()
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_business_ownership(p_business_id uuid, p_new_owner_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target public.business_members;
  v_current_owner public.business_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('business_members:' || p_business_id::text));

  select * into v_target
  from public.business_members
  where id = p_new_owner_member_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  select * into v_current_owner
  from public.business_members
  where business_id = p_business_id and role = 'owner'
  for update;

  if found then
    update public.business_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  begin
    update public.business_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_event_ownership(p_event_id uuid, p_new_owner_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target public.event_members;
  v_current_owner public.event_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('event_members:' || p_event_id::text));

  select * into v_target
  from public.event_members
  where id = p_new_owner_member_id and event_id = p_event_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  select * into v_current_owner
  from public.event_members
  where event_id = p_event_id and role = 'owner'
  for update;

  if found then
    update public.event_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  begin
    update public.event_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_location_ownership(p_location_id uuid, p_new_owner_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target public.location_members;
  v_current_owner public.location_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('location_members:' || p_location_id::text));

  select * into v_target
  from public.location_members
  where id = p_new_owner_member_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  select * into v_current_owner
  from public.location_members
  where location_id = p_location_id and role = 'owner'
  for update;

  if found then
    update public.location_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  begin
    update public.location_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$function$;

-- ============================================================================
-- SECTION 10 — TRIGGERS
-- ============================================================================

create trigger trg_businesses_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_categories_hierarchy BEFORE INSERT OR UPDATE OF parent_id, kind ON public.categories FOR EACH ROW EXECUTE FUNCTION enforce_category_hierarchy();
create trigger trg_event_occurrence_businesses_updated_at BEFORE UPDATE ON public.event_occurrence_businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_event_occurrences_updated_at BEFORE UPDATE ON public.event_occurrences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_pro_invites_updated_at BEFORE UPDATE ON public.pro_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_referral_attributions_updated_at BEFORE UPDATE ON public.referral_attributions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_referral_codes_updated_at BEFORE UPDATE ON public.referral_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_referral_earnings_updated_at BEFORE UPDATE ON public.referral_earnings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_referral_partners_updated_at BEFORE UPDATE ON public.referral_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
create trigger trg_referral_payout_requests_updated_at BEFORE UPDATE ON public.referral_payout_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- auth.users trigger — standard Supabase "create a profiles row on signup"
-- pattern. Creating a trigger on auth.users is permitted for the project
-- owner/service role in Supabase.
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();
-- ============================================================================
-- SECTION 11 — GRANTS (deviations from the Supabase platform default only)
--
-- Every table created in Section 1 already inherits the standard Supabase
-- per-project default privileges (full grant to anon/authenticated/
-- service_role) the instant it's created — this is a platform-level
-- default-privileges setting on every Supabase project, not something any
-- FindMi migration configures, so it is NOT re-declared per table here.
-- service_role additionally always bypasses RLS.
--
-- The statements below reproduce the SPECIFIC, DELIBERATE narrowings
-- present in FindMi's live schema today — verified directly via
-- information_schema.role_table_grants / role_column_grants immediately
-- before writing this file. If Highperlocal's own project ever turns out
-- to have different default privileges than assumed here, re-run the same
-- introspection query (see this bootstrap's own README) against it to
-- confirm parity after applying this file.
-- ============================================================================

-- businesses / products — public reads only a safe column subset; internal
-- billing/commerce/Stripe columns stay admin/service-role-only. Mirrors
-- 20260831000000_restrict_internal_commerce_columns.sql plus the two later
-- narrow public-column grants for market_area_id and is_pro_member.
revoke select on public.businesses from anon, authenticated;
grant select (
  id, slug, name, short_description, description, logo_url, cover_image_url,
  website_url, instagram_url, facebook_url, tiktok_url, email, phone, city,
  state, country, service_radius_miles, verified, founding_member,
  membership_status, created_at, updated_at, is_demo, commerce_enabled,
  publication_status, is_featured, inquiry_cta_label, inquiry_cta_url,
  cta_1_label, cta_1_url, cta_1_enabled, cta_2_label, cta_2_url,
  cta_2_enabled, cta_3_label, cta_3_url, cta_3_enabled, bulletin_enabled,
  bulletin_heading, bulletin_body, bulletin_label, bulletin_url,
  native_inquiries_enabled, market_area_id, is_pro_member
) on public.businesses to anon, authenticated;
-- Intentionally NOT granted (internal-only): lead_status,
-- marketplace_fee_percent, processing_fee_payer, payout_method,
-- stripe_account_id, stripe_connect_status, plan_tier, plan_source,
-- plan_started_at, plan_expires_at, plan_payment_reference,
-- ownership_verification_*, payment_confirmation_* (the latter two are
-- added later, by the Highperlocal migration — see this bootstrap's README).

revoke select on public.products from anon, authenticated;
grant select (
  id, business_id, name, slug, description, image_url, price, price_label,
  product_type, external_purchase_url, is_featured, is_active, purchasable,
  inventory_status, home_sort_order, profile_sort_order, marketplace_status
) on public.products to anon, authenticated;
-- Intentionally NOT granted (internal-only): marketplace_fee_override_percent,
-- processing_fee_payer_override, moderation_status, pending_changes,
-- marketplace_submitted_at, marketplace_approved_at.

-- profiles — every column is fully public-select/insert-able (needed for
-- public_profiles-style reads and the handle_new_auth_user() trigger insert),
-- but UPDATE excludes phone/email_verified_at — those change only through a
-- controlled server-side path, never a direct client update.
revoke update on public.profiles from anon, authenticated;
grant update (
  id, display_name, avatar_url, created_at, updated_at, username, bio, location_label
) on public.profiles to anon, authenticated;

-- location_images — public read-only gallery; writes are admin/service-role
-- only (no direct owner/consumer upload path exists for this table).
revoke insert, update, delete on public.location_images from anon, authenticated;

-- account_entitlements — admin/service-role only. No anon/authenticated
-- access at all; entitlements are only ever granted via the SECURITY
-- DEFINER redeem_* functions below, never a direct table write.
revoke all on public.account_entitlements from anon, authenticated;

-- business_members / event_members / location_members — a signed-in user
-- may only ever SELECT their own membership rows (see the *_select_own
-- policies); every actual membership mutation (create/claim/transfer/
-- remove) goes exclusively through the SECURITY DEFINER RPCs in Section 9,
-- never a direct client insert/update/delete.
revoke all on public.business_members from anon;
revoke insert, update, delete on public.business_members from authenticated;
revoke all on public.event_members from anon;
revoke insert, update, delete on public.event_members from authenticated;
revoke all on public.location_members from anon;
revoke insert, update, delete on public.location_members from authenticated;

-- business_claim_requests / event_claim_requests / location_claim_requests —
-- a signed-in user may create their own pending claim and read their own
-- claims; approval/rejection happens only via the SECURITY DEFINER
-- approve_*_claim() functions (service_role), never a direct client update.
revoke all on public.business_claim_requests from anon;
revoke update, delete on public.business_claim_requests from authenticated;
revoke all on public.event_claim_requests from anon;
revoke update, delete on public.event_claim_requests from authenticated;
revoke all on public.location_claim_requests from anon;
revoke update, delete on public.location_claim_requests from authenticated;

-- event_occurrence_businesses — publicly readable (approved rows only, via
-- its own RLS policy), but written only by admin/service-role server actions.
revoke insert, update, delete on public.event_occurrence_businesses from anon, authenticated;

-- Function EXECUTE grants — every function in Section 9 defaults to
-- service_role/owner-only on a fresh Supabase project (its own default
-- privileges revoke EXECUTE from PUBLIC on new functions); these are the
-- specific ones FindMi's live schema additionally exposes to anon and/or
-- authenticated for direct client calls. Every other function (the
-- ownership/claim/referral/pro-invite RPCs) stays service_role-only,
-- called only from server actions via getAdminSupabase().
grant execute on function public.follow_business(uuid, text) to anon, authenticated;
grant execute on function public.follow_event(uuid, text) to anon, authenticated;
grant execute on function public.mark_inquiry_read(uuid, text) to authenticated;
grant execute on function public.set_inquiry_status(uuid, text) to authenticated;
-- enforce_category_hierarchy()/set_updated_at()/handle_new_auth_user() are
-- trigger functions only, invoked by Postgres itself when their trigger
-- fires — they never need a direct EXECUTE grant to any client role for
-- that to work. FindMi's live schema happens to also carry an explicit
-- anon/authenticated grant on all three (harmless — nothing calls a
-- trigger function directly), reproduced here for exact parity:
grant execute on function public.enforce_category_hierarchy() to anon, authenticated;
grant execute on function public.set_updated_at() to anon, authenticated;
grant execute on function public.handle_new_auth_user() to anon, authenticated;
