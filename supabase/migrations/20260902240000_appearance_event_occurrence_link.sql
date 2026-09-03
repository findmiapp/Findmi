-- ============================================================================
-- Appearance <-> Event Occurrence link — adds ONE nullable column and ONE
-- partial unique index. Touches nothing else: no backfill, no change to
-- existing appearances rows, no change to event_id, no RLS changes, no
-- other schema changes.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Why nullable and independent of event_id: existing appearances (no
-- event_id at all, or linked only to a non-recurring event with no
-- occurrences) must stay exactly as they are — this column is additive,
-- not a replacement for event_id, and every current row is valid with it
-- simply unset (null).
--
-- The partial unique index is scoped to event_occurrence_id is not null
-- (so it has no effect until a row actually sets it) and status <>
-- 'canceled' (so a business can be re-added to the same occurrence after
-- a prior canceled appearance without hitting a unique violation on that
-- old row) — same partial-unique-index shape already used elsewhere in
-- this schema (business_claim_requests_one_pending,
-- business_members_one_owner_per_business).
-- ============================================================================

alter table public.appearances
  add column event_occurrence_id uuid references public.event_occurrences(id) on delete set null;

create unique index appearances_one_per_business_occurrence
  on public.appearances (business_id, event_occurrence_id)
  where event_occurrence_id is not null and status <> 'canceled';
