-- Featured Appearance System (Business Public Profile) — lets a Business
-- manually pin which of its own eligible Appearances the public profile's
-- unified Featured Appearance card shows, instead of always the
-- automatically-nearest one. Same nullable-FK-pointer shape as the
-- existing featured_event_id (20260930020000_featured_event_pointer.sql),
-- just targeting appearances instead of events — Appearance is already
-- the canonical row for BOTH standalone and event-backed business
-- participation (every real/synced event_businesses/
-- event_occurrence_businesses participation has a corresponding
-- `appearances` row — see appearance-event-sync.ts), so one pointer type
-- safely covers both presentation paths without a polymorphic
-- destination_type/destination_id system.
--
-- ON DELETE SET NULL covers a hard-deleted Appearance; a canceled/ended/
-- otherwise-ineligible-but-not-deleted one falls back to automatic
-- selection at the app layer instead (see resolveFeaturedAppearance in
-- BusinessPublicView.tsx), which simply checks membership in the same
-- already-fetched eligible-appearances list used elsewhere on the page —
-- no extra query, no owner cleanup required for public correctness.
--
-- Business Public Profile only — Location is intentionally out of scope
-- for this pass (its own Featured Event system/featured_event_id is
-- untouched).

alter table public.businesses
  add column if not exists featured_appearance_id uuid references public.appearances(id) on delete set null;

create index if not exists businesses_featured_appearance_id_idx
  on public.businesses (featured_appearance_id)
  where featured_appearance_id is not null;

-- businesses.* is column-grant-restricted for anon/authenticated (see
-- 20260831000000_restrict_internal_commerce_columns.sql's explicit
-- allowlist) — a new column is invisible to the public anon client until
-- added to that grant, same reason featured_event_id needed its own grant
-- line in its own migration.
grant select (featured_appearance_id) on public.businesses to anon, authenticated;
