-- Event date/time precision — the calendar DATE is required data; the
-- exact TIME is optional precision on that date.
--
-- Supports three truthful states for an Event date (event_occurrences) and
-- for the parent Event (events):
--   A. date + start + end
--   B. date + start, end not published (e.g. TRACE)
--   C. date only, no universal time published (e.g. FUJIKINA's Locations)
-- Unknown stays NULL. Nothing here invents a timestamp.
--
-- Backfill: ONLY deterministic calendar dates derived from each row's
-- EXISTING real timestamp —
--   event_occurrences.occurrence_date = start_at in the row's own timezone;
--   events.start_date / end_date      = start_at / end_at in America/New_York,
--   the application timezone every Event date is already displayed in
--   (src/lib/format.ts APP_TIMEZONE), so each derived date equals the date
--   the site already shows. No existing timestamp value is changed.
--
-- Triggers keep a KNOWN timestamp and its calendar date in agreement; when a
-- time becomes unknown (set to NULL) the date is left as it was, so the real
-- calendar date is never erased. CHECK constraints reject any contradiction.
--
-- No RLS / grant changes (existing table policies cover new columns).
-- appearances is intentionally unchanged.

-- ── Event dates (event_occurrences) ────────────────────────────────────

alter table public.event_occurrences add column if not exists occurrence_date date;

-- The schema backfill must not make every historical row look edited:
-- the existing updated_at trigger is suspended for THIS statement only and
-- re-enabled immediately after. Both ALTERs are transactional — if the
-- migration fails, the rollback restores the trigger as enabled. No other
-- trigger is touched, and ordinary INSERT / UPDATE behavior is unchanged.
alter table public.event_occurrences disable trigger trg_event_occurrences_updated_at;

update public.event_occurrences
   set occurrence_date = (start_at at time zone timezone)::date
 where occurrence_date is null;

alter table public.event_occurrences enable trigger trg_event_occurrences_updated_at;

alter table public.event_occurrences alter column occurrence_date set not null;
alter table public.event_occurrences alter column start_at drop not null;
alter table public.event_occurrences alter column end_at drop not null;

-- Known end must follow a known start; no end without a start.
alter table public.event_occurrences drop constraint if exists event_occurrences_end_after_start;
alter table public.event_occurrences
  add constraint event_occurrences_end_after_start
  check (end_at is null or (start_at is not null and end_at > start_at));

-- A known start's local date IS the occurrence date.
alter table public.event_occurrences drop constraint if exists event_occurrences_date_matches_start;
alter table public.event_occurrences
  add constraint event_occurrences_date_matches_start
  check (start_at is null or (start_at at time zone timezone)::date = occurrence_date);

create or replace function public.event_occurrences_sync_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A known start decides the calendar date. With no start, the supplied
  -- (or existing) occurrence_date stays authoritative — never erased.
  if new.start_at is not null then
    new.occurrence_date := (new.start_at at time zone new.timezone)::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_event_occurrences_sync_date on public.event_occurrences;
create trigger trg_event_occurrences_sync_date
  before insert or update of start_at, timezone, occurrence_date on public.event_occurrences
  for each row execute function public.event_occurrences_sync_date();

create index if not exists event_occurrences_occurrence_date_idx
  on public.event_occurrences (occurrence_date);

-- ── Parent Event (events) ──────────────────────────────────────────────

alter table public.events add column if not exists start_date date;
alter table public.events add column if not exists end_date date;

update public.events
   set start_date = (start_at at time zone 'America/New_York')::date,
       end_date = case when end_at is null then null else (end_at at time zone 'America/New_York')::date end
 where start_date is null;

alter table public.events alter column start_date set not null;
alter table public.events alter column start_at drop not null;

alter table public.events drop constraint if exists events_date_range_check;
alter table public.events
  add constraint events_date_range_check
  check (end_date is null or end_date >= start_date);

alter table public.events drop constraint if exists events_start_date_matches_start;
alter table public.events
  add constraint events_start_date_matches_start
  check (start_at is null or (start_at at time zone 'America/New_York')::date = start_date);

-- A known end needs a known start, and its local date IS the end date.
alter table public.events drop constraint if exists events_end_date_matches_end;
alter table public.events
  add constraint events_end_date_matches_end
  check (end_at is null or (start_at is not null and end_date is not null and (end_at at time zone 'America/New_York')::date = end_date));

create or replace function public.events_sync_dates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Known timestamps decide their calendar dates. A cleared (NULL)
  -- timestamp leaves its date as it was — never erased.
  if new.start_at is not null then
    new.start_date := (new.start_at at time zone 'America/New_York')::date;
  end if;
  if new.end_at is not null then
    new.end_date := (new.end_at at time zone 'America/New_York')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_sync_dates on public.events;
create trigger trg_events_sync_dates
  before insert or update of start_at, end_at, start_date, end_date on public.events
  for each row execute function public.events_sync_dates();

create index if not exists events_start_date_idx on public.events (start_date);
