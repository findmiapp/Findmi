-- Pass 2 Block B — commercial Opportunity geography (opportunity_listings).
--
-- Lets a commercial Opportunity cover a GEOGRAPHY instead of one specific
-- place: "Jersey City sampling series" (an Area) or "North Jersey" (a Market).
--
--   location_id set   → a Location-specific Opportunity. Its geography keeps
--                       coming from the Location (locations.market_id /
--                       market_area_id); these two columns stay null.
--   market_area_id    → an Area-wide Opportunity (the Area and its child
--                       Areas — e.g. Jersey City and its neighborhoods).
--   market_id only    → a Market-wide Opportunity.
--   none of the three → no geography (unchanged behaviour).
--
-- None of the three is required. The application writes market_id together
-- with an Area that belongs to it (validated server-side, same posture as
-- locations/events), and clears both when a Location is chosen.
--
-- Only the COMMERCIAL table changes. public.opportunities (Event
-- participation invitations/applications) is not touched.
--
-- Additive only: two nullable columns, their foreign keys (ON DELETE SET
-- NULL — retiring a Market/Area never deletes an Opportunity), two partial
-- indexes and comments. No existing row changes; nothing is backfilled.
-- opportunity_listings keeps its existing server-only access (RLS on, no
-- client policies or grants) — no grant or policy changes here.

alter table public.opportunity_listings
  add column if not exists market_id uuid
    constraint opportunity_listings_market_id_fkey references public.markets(id) on delete set null,
  add column if not exists market_area_id uuid
    constraint opportunity_listings_market_area_id_fkey references public.market_areas(id) on delete set null;

create index if not exists opportunity_listings_market_id_idx
  on public.opportunity_listings (market_id) where market_id is not null;
create index if not exists opportunity_listings_market_area_id_idx
  on public.opportunity_listings (market_area_id) where market_area_id is not null;

comment on column public.opportunity_listings.market_id is
  'Block B: the Market an Opportunity covers when it is not tied to one Location (null when location_id is set — geography then comes from the Location).';
comment on column public.opportunity_listings.market_area_id is
  'Block B: the Area (and its child Areas) an Opportunity covers when it is not tied to one Location. Belongs to market_id (validated by the app).';
