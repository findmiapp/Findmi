-- ============================================================================
-- Event Market Mapping Foundation V1
--
-- Follow-up to the read-only Event Market Mapping Readiness Trace. Adds
-- the schema needed to map event geography onto the existing `markets`
-- table (reused as-is — no new taxonomy), mirroring the same three-way
-- separation already locked for businesses: Based In / physical address
-- vs. a distinct, explicit Market assignment. Event Market is physical
-- geography of the event/occurrence — a structurally separate concept
-- from business_markets (a business's discovery/distribution
-- entitlement), and this migration never touches that table.
--
-- Locked resolution precedence for an event occurrence's EFFECTIVE Market
-- (implemented in code, not the database — see lib/event-markets.ts):
--   1. event_occurrences.market_id  (explicit per-occurrence override)
--   2. ELSE the linked locations.market_id (via occurrence.location_id)
--   3. ELSE the parent events.market_id (the event's default/normal
--      physical Market)
--   4. ELSE no Market (null)
-- A legacy event with zero occurrence rows simply resolves to
-- events.market_id.
--
-- All three columns are nullable — assigning a Market to any of these is
-- an explicit, opt-in admin action, never inferred or backfilled by this
-- migration itself (see this pass's own separate, human-reviewed
-- reconciliation step for the 5 already-identified live NYC events).
--
-- ON DELETE SET NULL (not RESTRICT, unlike business_markets.market_id):
-- these are single optional descriptive attributes on locations/events/
-- event_occurrences, not membership rows in a join table recording a
-- deliberate relationship — deleting a Market should just clear the
-- reference, never block or cascade-delete the location/event/occurrence
-- that happened to reference it.
--
-- Out of scope for this migration (per this pass's task): no
-- event_markets join table, no market_areas/radius/geofence concept, no
-- change to business_markets, no plan/pricing fields, no consumer
-- discovery filtering.
-- ============================================================================

alter table public.locations
  add column if not exists market_id uuid references public.markets(id) on delete set null;

alter table public.events
  add column if not exists market_id uuid references public.markets(id) on delete set null;

alter table public.event_occurrences
  add column if not exists market_id uuid references public.markets(id) on delete set null;

-- FK lookup/filter indexes — same precedent as business_markets_market_id_idx.
create index if not exists locations_market_id_idx on public.locations (market_id);
create index if not exists events_market_id_idx on public.events (market_id);
create index if not exists event_occurrences_market_id_idx on public.event_occurrences (market_id);
