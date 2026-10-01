-- Journal V1.1 — manual (non-canonical) Journal location support.
--
-- A Journal Entry is personal documentation; a user must be able to record
-- where something happened even when that place doesn't exist yet as a
-- canonical public Findmi Location (journal_entries.location_id). These
-- columns are additive, nullable, and live directly on journal_entries
-- (the same table entry_date/entry_time already live on, for the same
-- reason: a 1:1, small, always-fetched-with-the-entry piece of data that
-- doesn't need its own joined table). location_id is UNCHANGED (still
-- nullable, still the canonical reference) — these columns are a parallel,
-- narrower concept: "what the owner personally typed," never promoted into
-- the public locations table by this or any future automated process.
--
-- manual_location_suggested is the entire "suggest this place to Findmi"
-- signal for this pass, intentionally as narrow as the task allows: a
-- plain boolean on the entry itself. No submissions/moderation table, no
-- admin review queue — a future pass can query
-- `journal_entries where manual_location_suggested = true` directly when
-- that's actually needed. This never inserts into public.locations.
alter table public.journal_entries
  add column if not exists manual_location_name text,
  add column if not exists manual_location_address text,
  add column if not exists manual_location_city text,
  add column if not exists manual_location_state text,
  add column if not exists manual_location_zip text,
  add column if not exists manual_location_suggested boolean not null default false;
