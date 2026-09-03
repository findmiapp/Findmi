-- ============================================================================
-- Official Participation Historical Reconciliation
--
-- NO SCHEMA CHANGE — pure data reconciliation, no DDL. Companion to the
-- read-only investigation confirming: forward sync (4fca592), provenance
-- (760872a), and reverse-sync/reactivation (50fdd2f) are all correct and
-- unchanged by this file, but historical event_occurrence_businesses rows
-- that were approved before (or otherwise outside) those write paths were
-- never reconciled — 10 approved businesses on the Planted Culture Market
-- Sept 3 2026 occurrence (event_occurrence_id
-- c36fc138-b9e6-4286-bd96-1ba5702708a1), Vegan Mikes among them, had ZERO
-- matching official_participation appearances (verified live before
-- writing this file; also confirmed system-wide — no other occurrence
-- currently has any approved participation at all, so this occurrence is
-- the entire gap).
--
-- CANONICAL IDENTITY: one appearance per (business_id, event_occurrence_id)
-- with source = 'official_participation' — same key
-- appearances_one_per_business_occurrence already enforces.
--
-- FIELD MAPPING — deliberately NOT a second interpretation: mirrors
-- ensureOccurrenceAppearance's own logic in
-- src/app/admin/(protected)/events/actions.ts field-for-field —
-- title = event.name, start_at/end_at = the OCCURRENCE's own start/end
-- (never the parent event's), venue/address/city/state/lat/lng = the
-- occurrence's linked location (event_occurrences.location_id) AS A WHOLE
-- when one resolves, else the parent event's own venue fields AS A WHOLE
-- (never a per-column mix of the two — same all-or-nothing swap the TS
-- code does with its own `if (location) { venue = {...} }`).
--
-- SAFETY:
--   - Only ever touches source = 'official_participation' rows, or
--     inserts new ones with that exact source. Never reads/writes/deletes
--     a 'manual' or 'event_self_added' row (Madrina Vegana's two existing
--     manual appearances for this same event are untouched by every
--     WHERE clause below — none of them filters on source in a way that
--     could ever match a non-official row).
--   - Never touches event_occurrence_businesses.status (participation
--     status untouched) or businesses.plan_tier (Free/Pro untouched) —
--     this file contains no UPDATE against either table.
--   - Idempotent: an already-active official appearance is left alone
--     (no UPDATE matches it — the reactivation UPDATE's WHERE clause
--     requires status = 'canceled'); the INSERT's own NOT EXISTS guard
--     plus the ON CONFLICT clause (mirroring
--     appearances_one_per_business_occurrence exactly) means a second run
--     of this exact file creates zero new rows and reactivates nothing
--     further — verified by re-running the same statements a second time
--     after this migration's own apply (see this pass's report).
-- ============================================================================

-- ── Step 1: reactivate any CANCELED official_participation appearance for
-- a currently-approved relationship (none existed at the time this file
-- was written — verified live — but this stays in place for correctness/
-- reuse if this ever needs to run again after a decline+re-approve cycle
-- that predates a future admin save). ──────────────────────────────────
with approved as (
  select eob.business_id, eob.occurrence_id
  from public.event_occurrence_businesses eob
  where eob.status = 'approved'
),
computed as (
  select
    a.business_id,
    a.occurrence_id,
    eo.event_id,
    e.name as title,
    eo.start_at,
    eo.end_at,
    case when l.id is not null then l.name else e.venue_name end as venue_name,
    case when l.id is not null then l.address else e.address end as address,
    case when l.id is not null then l.city else e.city end as city,
    case when l.id is not null then l.state else e.state end as state,
    case when l.id is not null then l.latitude else e.latitude end as latitude,
    case when l.id is not null then l.longitude else e.longitude end as longitude
  from approved a
  join public.event_occurrences eo on eo.id = a.occurrence_id
  join public.events e on e.id = eo.event_id
  left join public.locations l on l.id = eo.location_id
)
update public.appearances ap
set
  event_id = c.event_id,
  title = c.title,
  start_at = c.start_at,
  end_at = c.end_at,
  venue_name = c.venue_name,
  address = c.address,
  city = c.city,
  state = c.state,
  latitude = c.latitude,
  longitude = c.longitude,
  status = 'confirmed'
from computed c
where ap.business_id = c.business_id
  and ap.event_occurrence_id = c.occurrence_id
  and ap.source = 'official_participation'
  and ap.status = 'canceled';

-- ── Step 2: insert the canonical appearance for every approved
-- relationship that has no official_participation row at all yet (active
-- or canceled) — the actual Sept 3 gap. ─────────────────────────────────
with approved as (
  select eob.business_id, eob.occurrence_id
  from public.event_occurrence_businesses eob
  where eob.status = 'approved'
),
computed as (
  select
    a.business_id,
    a.occurrence_id,
    eo.event_id,
    e.name as title,
    eo.start_at,
    eo.end_at,
    case when l.id is not null then l.name else e.venue_name end as venue_name,
    case when l.id is not null then l.address else e.address end as address,
    case when l.id is not null then l.city else e.city end as city,
    case when l.id is not null then l.state else e.state end as state,
    case when l.id is not null then l.latitude else e.latitude end as latitude,
    case when l.id is not null then l.longitude else e.longitude end as longitude
  from approved a
  join public.event_occurrences eo on eo.id = a.occurrence_id
  join public.events e on e.id = eo.event_id
  left join public.locations l on l.id = eo.location_id
)
insert into public.appearances (
  business_id, event_id, event_occurrence_id, title, start_at, end_at,
  venue_name, address, city, state, latitude, longitude, status, source
)
select
  c.business_id, c.event_id, c.occurrence_id, c.title, c.start_at, c.end_at,
  c.venue_name, c.address, c.city, c.state, c.latitude, c.longitude,
  'confirmed', 'official_participation'
from computed c
where not exists (
  select 1 from public.appearances ap
  where ap.business_id = c.business_id
    and ap.event_occurrence_id = c.occurrence_id
    and ap.source = 'official_participation'
)
-- Same predicate as appearances_one_per_business_occurrence itself — the
-- race-safe backstop this migration's own idempotency (and the live
-- ensure*/cancel* sync's) already relies on.
on conflict (business_id, event_occurrence_id)
  where event_occurrence_id is not null and status <> 'canceled'
  do nothing;
