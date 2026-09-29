-- FindMi Activations Pass 1 — activation_venues.
--
-- Multi-venue support exists structurally from day one (audit §5,
-- Amendment confirms unchanged) even though FindMi Showroom: SoHo
-- initially uses exactly one row. location_id is a nullable link to an
-- EXISTING Location (never a duplicate Location record) — nullable
-- because an Exploring-phase Activation may not have a signed venue yet,
-- in which case name/city/region/country_code/timezone carry a
-- placeholder description on their own.
create table if not exists public.activation_venues (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references public.activations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,

  name text,
  city text,
  region text,
  country_code text,
  timezone text,

  start_at timestamptz,
  end_at timestamptz,

  is_primary boolean not null default false,
  sort_order integer not null default 0,
  status text not null default 'planned'
    check (status in ('planned', 'confirmed', 'cancelled')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activation_venues_activation_id_idx on public.activation_venues (activation_id, sort_order);
create index if not exists activation_venues_location_id_idx on public.activation_venues (location_id);

create trigger trg_activation_venues_updated_at
  before update on public.activation_venues
  for each row execute function public.set_updated_at();

alter table public.activation_venues enable row level security;

-- Public read — same "simple `true` on the child table, real gating
-- lives on the parent" convention already established by
-- business_images ("business_images are publicly readable", `using
-- (true)`). Every field here is safe to expose (no internal financials
-- live on this table), and any future public route reaches these rows
-- only via an already-published parent Activation anyway.
create policy "Public read activation venues"
  on public.activation_venues
  for select
  using (true);

-- No insert/update/delete policy for anon/authenticated — admin-only via
-- requireAdminSupabase(), same as activations itself.
