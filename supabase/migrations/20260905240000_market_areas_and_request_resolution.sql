-- ============================================================================
-- Market -> Area/Submarket Hierarchy + Market Request Resolution V2
--
-- (1) market_areas — the structured Area/Submarket model going forward.
-- Each Area belongs to exactly ONE parent Market (on delete cascade: an
-- Area is meaningless without its Market). Reuses the exact same
-- active/consumer_visible split already established on `markets` — an
-- Area can be internally assignable without appearing in consumer Area
-- discovery yet. `markets.areas_included` (plain text[]) is UNCHANGED
-- and stays exactly as it is — this is additive, not a replacement;
-- areas_included remains valid lightweight metadata/search fodder, and
-- market_areas becomes the real, id-addressable structured records that
-- businesses/events/requests can actually point to.
--
-- (2) market_requests gains:
--   - canonical_text: an OPTIONAL admin correction. requested_text
--     itself is NEVER overwritten — it stays the immutable original
--     submission for audit.
--   - effective_normalized_key: normalize(canonical_text ?? requested_text).
--     THIS is what grouping/matching uses from now on (replacing
--     normalized_key's grouping role) — correcting one request's
--     canonical_text recomputes only its own effective_normalized_key,
--     which can cause it to newly share a key with an unrelated request
--     that already normalized the same way on its own (e.g. "Hamptens"
--     corrected to "Hamptons" now shares a key with an independently
--     submitted "Hamptons, NY"). Backfilled to the existing
--     normalized_key for every current row (behavior-neutral: nothing
--     regroups until an admin actually corrects something).
--   - mapped_area_id: set when a request resolves to a market_areas row
--     (mapped_market_id is ALSO set alongside it, to that Area's parent
--     Market, so any code reading mapped_market_id alone keeps working).
--   - resolution_type: which of the four admin resolution paths was
--     used, or which auto-match path (see the app-layer note in
--     lib/market-requests.ts) resolved it — for admin-facing display
--     only, never consulted by discovery/entitlement logic.
--
-- (3) businesses.market_area_id / events.market_area_id — one precise,
-- optional structured Area per business/event, additive alongside (never
-- replacing) their existing parent Market association
-- (business_markets / events.market_id). Same on-delete-set-null
-- convention already used for every other Market-adjacent FK in this
-- codebase.
--
-- Nothing here changes plan_market_limits, existing Market/business/
-- event/occurrence/location assignments, or current ?market= filtering.
-- ============================================================================

create table if not exists public.market_areas (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  name text not null,
  slug text not null,
  display_name text,
  -- Lightweight alternate spellings/short names to help matching (e.g.
  -- "SI" for Staten Island) — informational only, same spirit as
  -- markets.areas_included; never consulted by discovery/entitlement.
  aliases text[],
  active boolean not null default true,
  consumer_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, slug)
);
create index if not exists market_areas_market_id_idx on public.market_areas (market_id);

alter table public.market_areas enable row level security;
-- Same posture as the existing "Public read active markets" policy on
-- markets (qual = true; the app itself filters to active/consumer_visible
-- when it matters) — every field here is exactly as safe to expose as a
-- Market's own name/slug.
create policy "Public read market areas" on public.market_areas
  for select using (true);

-- Seed structured Areas from any existing markets.areas_included text —
-- additive, idempotent (ON CONFLICT DO NOTHING keys off the same
-- (market_id, slug) uniqueness the table itself enforces), never removes
-- or rewrites areas_included. Consumer visibility conservatively follows
-- the PARENT Market's own current consumer_visible value — a seeded Area
-- is never made more visible than the Market it belongs to.
insert into public.market_areas (market_id, name, slug, consumer_visible, active, sort_order)
select
  m.id,
  area_name,
  trim(both '-' from regexp_replace(lower(area_name), '[^a-z0-9]+', '-', 'g')),
  m.consumer_visible,
  true,
  (ordinality - 1)::int
from public.markets m
cross join lateral unnest(m.areas_included) with ordinality as t(area_name, ordinality)
where m.areas_included is not null
on conflict (market_id, slug) do nothing;

alter table public.market_requests
  add column if not exists canonical_text text,
  add column if not exists effective_normalized_key text,
  add column if not exists mapped_area_id uuid references public.market_areas(id) on delete set null,
  add column if not exists resolution_type text
    check (resolution_type is null or resolution_type in ('existing_market', 'existing_area', 'new_market', 'new_area'));

update public.market_requests set effective_normalized_key = normalized_key where effective_normalized_key is null;
alter table public.market_requests alter column effective_normalized_key set not null;

create index if not exists market_requests_effective_key_idx on public.market_requests (effective_normalized_key);
create index if not exists market_requests_mapped_area_id_idx on public.market_requests (mapped_area_id);

alter table public.businesses add column if not exists market_area_id uuid references public.market_areas(id) on delete set null;
alter table public.events add column if not exists market_area_id uuid references public.market_areas(id) on delete set null;
create index if not exists businesses_market_area_id_idx on public.businesses (market_area_id);
create index if not exists events_market_area_id_idx on public.events (market_area_id);
