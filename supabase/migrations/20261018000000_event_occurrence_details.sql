-- Event Occurrence details — additive, nullable, forward-only.
--
-- Descriptive information that belongs to ONE date of an Event (its
-- "programming": who appears, what's activated, what that stop offers) —
-- never the parent Event's description. Plain text; line breaks kept.
-- NULL = no details for that date (every existing row).
--
-- No backfill, no existing row changes, no RLS/grant changes (existing
-- event_occurrences policies cover new columns). Application code writes
-- it best-effort after the occurrence row exists, so imports keep working
-- on a database where this migration hasn't been applied yet.

alter table public.event_occurrences
  add column if not exists details text;

alter table public.event_occurrences
  drop constraint if exists event_occurrences_details_length_check,
  add constraint event_occurrences_details_length_check check (details is null or char_length(details) <= 2000);
