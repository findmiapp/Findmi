-- ============================================================================
-- Event Occurrences foundation — recurring / multi-date events.
-- Adds ONE new table. Touches nothing else. Fully additive.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Architecture: `events` stays the event's identity/content (name, cover,
-- description, CTAs, etc.) — completely unchanged by this migration.
-- `event_occurrences` holds the actual scheduled instances: concrete
-- rows, never a recurrence rule. A weekly market with 12 upcoming dates
-- is 12 real rows here, each independently editable/cancellable — no
-- rule engine, no "generates itself" magic. events.start_at/end_at are
-- left in place and keep meaning exactly what they always have —
-- existing events with zero event_occurrences rows are untouched and
-- keep behaving exactly as before (see the application-layer fallback
-- logic in lib/data.ts, not part of this migration).
-- ============================================================================

create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  -- Optional: a market with no fixed FindMi Location on file can still
  -- have real occurrence rows (see events.venue_name's own existing
  -- free-text precedent) — set null (not cascade-deleted) if the
  -- referenced location is ever removed, so an occurrence never
  -- disappears just because its location row did.
  location_id uuid references public.locations(id) on delete set null,
  featured boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  -- Per-occurrence overrides — e.g. a single date in a recurring series
  -- sells tickets through a different link than the event's own
  -- tickets_url/vendor_application_url. Null means "use the parent
  -- event's own field", never a forced duplicate.
  ticket_url_override text,
  vendor_apply_url_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_occurrences_end_after_start check (end_at > start_at)
);

-- Reuses the existing, already-in-production set_updated_at() trigger
-- function (businesses.updated_at, profiles.updated_at) — no new
-- function needed for this.
create trigger trg_event_occurrences_updated_at
  before update on public.event_occurrences
  for each row execute function public.set_updated_at();

alter table public.event_occurrences enable row level security;

-- Same shape as the existing "Public read events"/"event_images are
-- publicly readable" policies — full public SELECT, no anon/authenticated
-- write policy at all (admin writes go through the founder's
-- service-role client, requireAdminSupabase() -> getAdminSupabase(),
-- same as every other admin-managed table; RLS default-denies writes for
-- every other role since no policy grants them).
create policy "event_occurrences are publicly readable"
  on public.event_occurrences for select
  to public
  using (true);

-- event_id — every per-event lookup (admin occurrence list, public
-- Upcoming Dates carousel) filters on this first.
create index if not exists event_occurrences_event_id_idx
  on public.event_occurrences (event_id);

-- start_at/end_at — window/date-range matching (Today/Weekend/exact-date
-- discovery, duration-overlap logic mirroring events' own).
create index if not exists event_occurrences_start_end_idx
  on public.event_occurrences (start_at, end_at);

-- Upcoming occurrence discovery — "non-cancelled and not yet ended" is
-- the exact predicate discovery/the public carousel filter on; a partial
-- index on just the scheduled rows keeps that lookup small regardless of
-- how many cancelled/past rows accumulate over time.
create index if not exists event_occurrences_upcoming_idx
  on public.event_occurrences (event_id, end_at)
  where status = 'scheduled';

-- Featured occurrence lookup — "the nearest featured, still-scheduled
-- occurrence for this event" (Featured Events dedupe — see the pass
-- report) is its own partial index rather than relying on a full scan
-- filtered in application code.
create index if not exists event_occurrences_featured_idx
  on public.event_occurrences (event_id, start_at)
  where featured = true and status = 'scheduled';
