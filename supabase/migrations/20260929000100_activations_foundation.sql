-- FindMi Activations Pass 1 — the core Activation object.
--
-- FindMi Activations are real-world experiences PRODUCED AND CURATED BY
-- FINDMI (starting with FindMi Showroom: SoHo, Nov 2026) — deliberately
-- NOT modeled as an Event (a consumer-discoverable program/occurrence)
-- or an Appearance (a business at a place/time). An Activation
-- orchestrates/references those existing objects rather than duplicating
-- them; see activation_venues/activation_options/activation_inventory
-- (same migration set) for the rest of the Pass 1 foundation, and the
-- frozen architecture audit + amendment for the full reasoning.
--
-- Operator architecture (Amendment §1/§E) — V1 is FindMi-operated only
-- (operator_type defaults 'findmi', operator_business_id stays null),
-- but the columns exist now so "Activation = FindMi production forever"
-- is never encoded as a permanent schema assumption. No agency/brand
-- Admin UI is built in Pass 1; these columns are read-only defaults.
--
-- Publication (mirrors discovery_pages.is_published exactly): `phase`
-- (internal production lifecycle) and `is_published`/`publish_at`
-- (public visibility) are deliberately independent — an Exploring-phase
-- Activation can already be public (see the Miami Art Week example in
-- the audit), and a Confirmed one can still be embargoed.
--
-- International-safety (Amendment/audit §6) — city/region/country_code/
-- default_timezone/currency_code live here as plain columns rather than
-- assuming the existing (US-only) markets/market_areas tables always
-- apply; market_id/market_area_id stay nullable, optional links for when
-- an Activation does map to an existing Market.
create table if not exists public.activations (
  id uuid primary key default gen_random_uuid(),

  slug text not null unique,
  internal_name text not null,
  public_name text not null,
  concept_label text,
  short_description text,
  description text,
  cover_image_url text,

  phase text not null default 'draft'
    check (phase in ('draft', 'exploring', 'applications_open', 'confirmed', 'live', 'completed', 'archived')),
  is_published boolean not null default false,
  publish_at timestamptz,

  city text,
  region text,
  country_code text,
  default_timezone text not null default 'America/New_York',
  market_id uuid references public.markets(id) on delete set null,
  market_area_id uuid references public.market_areas(id) on delete set null,

  currency_code text not null default 'USD',
  default_price_visibility text not null default 'visible'
    check (default_price_visibility in ('visible', 'hidden', 'custom_label')),

  -- Internal planning targets (audit §7) — plain nullable columns, no
  -- computed comparison/logic anywhere yet; Admin-entered and
  -- Admin-read only (never public, see the column-level grant below).
  target_revenue numeric,
  minimum_committed_threshold numeric,
  target_brand_count integer,
  anchor_partner_target integer,
  venue_budget_ceiling numeric,
  production_budget_ceiling numeric,
  decision_deadline date,

  -- Operator architecture (Amendment §1) — see header comment.
  operator_type text not null default 'findmi'
    check (operator_type in ('findmi', 'agency', 'brand')),
  operator_business_id uuid references public.businesses(id) on delete set null,

  meta_title text,
  meta_description text,
  og_image_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activations_phase_idx on public.activations (phase);
create index if not exists activations_is_published_idx on public.activations (is_published);
create index if not exists activations_market_id_idx on public.activations (market_id);

create trigger trg_activations_updated_at
  before update on public.activations
  for each row execute function public.set_updated_at();

alter table public.activations enable row level security;

-- Public read — mirrors discovery_pages' own "Public read published
-- discovery pages" policy exactly. Unused by any route until the public
-- /activations pages are built (a later pass) — shipped now so RLS
-- doesn't need to be revisited when that pass lands.
create policy "Public read published activations"
  on public.activations
  for select
  using (is_published = true);

-- No insert/update/delete policy for anon/authenticated — every write
-- goes through requireAdminSupabase() (service role, bypasses RLS),
-- same convention as every other admin-managed entity table.

-- Column-level grant (mirrors 20260831192751_restrict_internal_commerce_columns.sql
-- exactly): Supabase's default table-level SELECT grant to anon/
-- authenticated would otherwise let a direct REST call read every
-- column regardless of the row-level policy above, including the
-- internal planning targets and operator_business_id. service_role is
-- untouched (bypasses grants entirely).
revoke select on public.activations from anon, authenticated;

grant select (
  id, slug, public_name, concept_label, short_description, description,
  cover_image_url, phase, is_published, publish_at, city, region,
  country_code, default_timezone, market_id, market_area_id,
  currency_code, default_price_visibility, meta_title, meta_description,
  og_image_url, created_at, updated_at
) on public.activations to anon, authenticated;

-- Intentionally NOT granted to anon/authenticated (internal-only):
--   internal_name, target_revenue, minimum_committed_threshold,
--   target_brand_count, anchor_partner_target, venue_budget_ceiling,
--   production_budget_ceiling, decision_deadline, operator_type,
--   operator_business_id
