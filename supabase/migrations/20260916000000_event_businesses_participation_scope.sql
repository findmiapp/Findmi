-- Multi-Date Business Participation Pass 2B — Durable Participation Scope.
-- event_businesses is the durable Event<->Business relationship + intent
-- record (see lib/appearance-event-sync.ts's own architectural invariant
-- comment); this adds the one additional signal it was missing: whether a
-- Business's participation is meant to durably follow EVERY current and
-- future date of a multi-date Event ('all_dates'), or only an explicit,
-- closed set of dates it was invited to/applied for ('selected_dates').
-- NULL means legacy/unspecified — never auto-backfilled, never treated as
-- either value, and never auto-propagated onto newly-created dates (see
-- propagateAllDatesParticipation in lib/appearance-event-sync.ts, which
-- only ever acts on rows explicitly set to 'all_dates').
ALTER TABLE event_businesses
  ADD COLUMN participation_scope text NULL
  CHECK (participation_scope IN ('all_dates', 'selected_dates'));
