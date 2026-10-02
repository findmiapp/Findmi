-- Journal V2 Pass 2 — Event Occurrence integrity. Journal previously could
-- only connect to the parent Event (journal_entry_connections.event_id),
-- never to a specific Event Occurrence — so a Journal entry documenting a
-- real visit to one date of a multi-date activation (e.g. "A Cup of Love,"
-- which ran Sep 29 - Oct 1) had no way to record WHICH date it was, even
-- though the Event-originated creation path already had that occurrence
-- available at the moment of creation (see journalCaptureActions.ts).
--
-- Purely additive: one new nullable column + FK + lookup index, following
-- the exact same pattern business_id/product_id/event_id already use on
-- this table (see 20261001010000_journal_foundation.sql). No existing row
-- is touched by this migration; every existing connection row already
-- satisfies the updated CHECK below unchanged (event_occurrence_id is null
-- for all of them, so the "exactly one of four" sum is identical to the
-- previous "exactly one of three" sum).
--
-- The parent Event relationship is NOT replaced — a Journal entry may
-- (and for an occurrence-backed experience, should) carry BOTH an event_id
-- row and a separate event_occurrence_id row, each satisfying the
-- exactly-one-target CHECK on its own row, exactly like business_id and
-- event_id already coexist as two separate rows today.

alter table public.journal_entry_connections
  add column event_occurrence_id uuid references public.event_occurrences(id) on delete cascade;

alter table public.journal_entry_connections
  drop constraint journal_entry_connections_exactly_one_object;

alter table public.journal_entry_connections
  add constraint journal_entry_connections_exactly_one_object check (
    (case when business_id is not null then 1 else 0 end) +
    (case when product_id is not null then 1 else 0 end) +
    (case when event_id is not null then 1 else 0 end) +
    (case when event_occurrence_id is not null then 1 else 0 end) = 1
  );

-- Same "one connection of this type per entry" + "reverse lookup" pair
-- every other connection type already gets.
create unique index journal_entry_connections_occurrence_uidx
  on public.journal_entry_connections (journal_entry_id, event_occurrence_id)
  where event_occurrence_id is not null;

create index journal_entry_connections_occurrence_lookup_idx
  on public.journal_entry_connections (event_occurrence_id)
  where event_occurrence_id is not null;
