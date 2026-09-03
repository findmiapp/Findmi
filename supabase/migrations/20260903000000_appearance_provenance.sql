-- ============================================================================
-- Appearance Provenance — Schema Foundation Only
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Adds ONE column + inline CHECK constraint. No backfill/inference, no
-- change to any existing row's status/visibility, no RLS/grant change, no
-- reverse-sync logic (that's explicitly a later pass — see the Appearance
-- Provenance pass's own report for why reverse-sync couldn't safely ship
-- without this column first: business_id + event_id + event_occurrence_id
-- alone can't tell an admin-approval-generated appearance apart from an
-- owner-added one that happens to reference the same event/occurrence).
--
-- Three creation paths, three values:
--   - 'manual'                — addManualAppearance (owner's own
--     standalone appearance, account/business/actions.ts)
--   - 'event_self_added'      — addAppearanceFromEvent (owner choosing an
--     existing FindMi event/occurrence themselves, same file)
--   - 'official_participation' — ensureEventAppearance/
--     ensureOccurrenceAppearance (admin/events/actions.ts's approval sync)
-- ============================================================================

alter table public.appearances
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'event_self_added', 'official_participation'));

-- Existing-data default: every current appearance row — regardless of
-- whether it actually originated from admin approval, an owner's own
-- "choose an existing event" add, or a true standalone/manual entry —
-- becomes 'manual' via the column default above. Deliberately NOT
-- inferred from event_id/event_occurrence_id being set: that would be
-- exactly the same unsafe guess reverse-sync itself can't make (an
-- owner-added appearance already carries a real event_id/
-- event_occurrence_id too). 'manual' is the conservative choice — it
-- guarantees no historical row can ever be mistaken for
-- 'official_participation' and swept up by a future reverse-sync that
-- only acts on that value. No existing row's status or public visibility
-- changes; this column is purely additive.
