-- ============================================================================
-- Recurring Events V2 — occurrence-specific vendors, RSVP override, and
-- occurrence-level timezone. Adds ONE new table and THREE new columns on
-- the existing event_occurrences table. Touches nothing else. Fully
-- additive except for one explicit, deterministic UPDATE that corrects
-- two known-mislabeled production rows (see the timezone section below).
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Architecture: `events` stays the permanent series identity (title,
-- slug, description, gallery, default/fallback RSVP/ticket/vendor-apply
-- URLs). `event_occurrences` (already deployed) is the concrete
-- date/time/location instance. This migration adds the occurrence's
-- OWN vendor roster (event_occurrence_businesses — deliberately separate
-- from the existing parent-level event_businesses, never a replacement
-- for it) and the two remaining pieces of date-specific context the
-- product model calls for: an RSVP override to match the existing
-- ticket_url_override/vendor_apply_url_override pair, and an explicit
-- IANA timezone so one recurring series can correctly span multiple
-- real-world timezones without guessing from city/state text or the
-- server's own timezone.
-- ============================================================================

-- ── event_occurrences: RSVP override ────────────────────────────────────
alter table public.event_occurrences
  -- Matches the existing ticket_url_override/vendor_apply_url_override
  -- shape exactly: null means "use the parent event's own rsvp_url",
  -- never a forced duplicate.
  add column if not exists rsvp_url_override text;

-- ── event_occurrences: timezone ─────────────────────────────────────────
-- MIGRATION CORRECTION PASS: production was inspected read-only before
-- writing this section. Both of the 2 existing event_occurrences rows
-- belong to "Planted Culture Market | September 3rd" and are NOT in the
-- Eastern timezone:
--
--   c36fc138-b9e6-4286-bd96-1ba5702708a1 — Sep 10, Mueller Lake Park,
--     Austin, TX (4550 Mueller Blvd)               -> America/Chicago
--   a859ef23-8376-405d-a1d8-6a77eebab073 — Sep 17, Circuit of the
--     Americas Lot C, Austin, TX                    -> America/Chicago
--
-- A blind `not null default 'America/New_York'` (this migration's first
-- draft) would have silently mislabeled both real rows as Eastern when
-- their actual location is Austin (Central). Austin, TX is unambiguously
-- within the America/Chicago IANA zone for both dates (no DST-boundary
-- city-split concern), so this is a deterministic correction based on
-- exact inspected production data — not a freeform city/state inference
-- at runtime (which the product spec explicitly forbids; this is a
-- one-time, reviewed, ID-targeted migration backfill instead).
--
-- Sequence, exactly as requested: (1) add the column in a migration-safe
-- nullable form with no default yet; (2) explicitly backfill the two
-- known rows above by id; (3) only then establish the default/NOT NULL
-- constraint that governs every other row (there are none today beyond
-- the two above, but the WHERE-null UPDATE is a harmless safety net if
-- that ever isn't true by the time this is actually applied) — matching
-- the app's one existing global timezone assumption
-- (lib/format.ts's APP_TIMEZONE, lib/admin/form-helpers.ts's
-- localDateTimeToIso/isoToLocalDateTime, both hardcoded to it today),
-- so nothing else changes behavior. The eventual admin UI will require
-- the founder to explicitly select an occurrence's timezone going
-- forward (application-code follow-up, not part of this migration) —
-- this default only covers rows created before that UI ships.

-- 1) Add nullable, no default yet.
alter table public.event_occurrences add column if not exists timezone text;

-- 2) Explicit, deterministic, ID-targeted backfill for the exact known
-- production rows (never a general city/state CASE expression).
update public.event_occurrences
set timezone = 'America/Chicago'
where id in (
  'c36fc138-b9e6-4286-bd96-1ba5702708a1', -- Sep 10 — Mueller Lake Park, Austin, TX
  'a859ef23-8376-405d-a1d8-6a77eebab073'  -- Sep 17 — Circuit of the Americas Lot C, Austin, TX
);

-- 3) Establish the final default/constraint for every other row. Safety
-- net first (no-op today — both existing rows were just set above), then
-- the default + NOT NULL that governs future rows until the admin UI
-- collects this explicitly.
update public.event_occurrences set timezone = 'America/New_York' where timezone is null;
alter table public.event_occurrences alter column timezone set default 'America/New_York';
alter table public.event_occurrences alter column timezone set not null;

-- Not validated by a CHECK constraint: Postgres CHECK constraints can't
-- reference the pg_timezone_names system view, so a real-IANA-identifier
-- guarantee belongs at the admin input layer (a constrained <select>,
-- not free text) in the later implementation phase.

-- ── event_occurrence_businesses ─────────────────────────────────────────
-- Occurrence-specific vendor participation — deliberately a NEW,
-- independent relationship, never a repurposing of event_businesses
-- (which remains exactly as-is for legacy one-time events and any future
-- series-level relationship). Same shape/status enum as event_businesses
-- (invited/applied/pending/approved/declined) so the admin mental model
-- carries over, but keyed to the occurrence, not the parent event, and
-- with its own surrogate id + updated_at (event_businesses uses a
-- composite (event_id, business_id) primary key with neither).
create table if not exists public.event_occurrence_businesses (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.event_occurrences(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'approved' check (status in ('invited', 'applied', 'pending', 'approved', 'declined')),
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (occurrence_id, business_id)
);

-- Reuses the existing, already-in-production set_updated_at() trigger
-- function (event_occurrences.updated_at, businesses.updated_at,
-- profiles.updated_at) — no new function needed.
create trigger trg_event_occurrence_businesses_updated_at
  before update on public.event_occurrence_businesses
  for each row execute function public.set_updated_at();

alter table public.event_occurrence_businesses enable row level security;

-- Public SELECT is intentionally MORE restrictive than event_businesses'
-- existing "Public read event_businesses" policy (which is `using
-- (true)` — every status, filtered only in application code today, e.g.
-- getBusinessesForEvent()'s own "Only 'approved' participants are
-- public" comment). This table's own instruction is explicit: don't rely
-- solely on application filtering to hide invited/pending/declined
-- participation — so the policy itself only ever exposes approved rows.
-- This is a deliberate divergence from the older table's looser policy,
-- not an oversight; event_businesses itself (its RLS, its grants) is
-- untouched by this migration.
create policy "event_occurrence_businesses approved rows are publicly readable"
  on public.event_occurrence_businesses for select
  to public
  using (status = 'approved');

-- MIGRATION CORRECTION PASS — explicit table-level privileges, not
-- reliance on Supabase's schema-wide default grants. Mirrors the
-- claim_and_membership_foundation migration's own "Explicit Data API
-- table privileges" convention: revoke first, then re-grant only the
-- exact operations each role should have. anon and authenticated both
-- get SELECT only (this roster is public-readable content, same as
-- event_occurrences/events/locations — an anonymous visitor must be able
-- to read it, not just a signed-in account) and nothing else; combined
-- with the approved-only policy above, a client can read ONLY approved
-- rows and can never INSERT/UPDATE/DELETE any row regardless of status.
-- service_role already receives broad privileges via Supabase's
-- project-wide default grants, but is made explicit here too rather than
-- relied on implicitly — founder mutations (all statuses) go through
-- requireAdminSupabase() -> getAdminSupabase(), which also bypasses RLS
-- entirely (service_role has rolbypassrls = true), so it manages every
-- status regardless of the public-only SELECT policy above.

revoke all on public.event_occurrence_businesses from anon;
revoke all on public.event_occurrence_businesses from authenticated;

grant select on public.event_occurrence_businesses to anon;
grant select on public.event_occurrence_businesses to authenticated;

grant select, insert, update, delete on public.event_occurrence_businesses to service_role;

-- event_id — every per-occurrence lookup (admin roster editor, the
-- public approved-roster query) filters on this first. Unfiltered by
-- status so the admin editor can see the full invited/applied/pending/
-- approved/declined roster for one date, not just the public subset.
create index if not exists event_occurrence_businesses_occurrence_id_idx
  on public.event_occurrence_businesses (occurrence_id);

-- Public roster fetch + featured-first ordering — "approved only,
-- featured first" is the exact predicate/order the public page uses; a
-- partial index on just the approved rows keeps that small regardless of
-- how many invited/pending/declined rows accumulate for a date.
create index if not exists event_occurrence_businesses_approved_idx
  on public.event_occurrence_businesses (occurrence_id, featured)
  where status = 'approved';

-- business_id — reverse lookup for a future "FindMi Here" surface on the
-- business profile (which occurrences is this business confirmed for) —
-- deferred per the pass report, but the index costs nothing to add now
-- and avoids a schema follow-up purely for that later query shape.
create index if not exists event_occurrence_businesses_business_id_idx
  on public.event_occurrence_businesses (business_id);
