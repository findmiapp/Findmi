-- Taxonomy V2 — Pass 4A: curation markers for Admin classification.
--
-- WHAT THIS DOES
--   Widens the allowed values of classification_field_sources.field with the
--   four dimensions the compatibility layer re-derives from live V1 data and
--   that have no column of their own to carry a field source:
--     categories            Business / Location / Event / Product Category
--     topics                Topics (every entity type)
--     event_type            Event Type
--     experience_mechanics  Experience Mechanics
--   A durable (admin / owner / importer) row on one of these fields marks
--   that entity's dimension CURATED: its explicit V2 assignments become
--   authoritative and V1 inference no longer adds values to it, so a value
--   removed or replaced on purpose cannot be resurrected by V1
--   (src/lib/taxonomy/compat-policy.ts, cardinality.ts CURATION_FIELD).
--   Business Model needs no new value: 'business_models' already exists and
--   doubles as its marker.
--
-- WHAT THIS DOES NOT DO
--   No new table, column, policy, grant or function. No row is written,
--   changed or deleted (no backfill). The new list is a strict superset of
--   the old one, so every existing row stays valid. V1 tables and every
--   public / owner read are untouched.
--
-- Idempotent: re-running replaces the constraint with the same definition.

begin;

alter table public.classification_field_sources drop constraint if exists classification_field_sources_field_check;
alter table public.classification_field_sources add constraint classification_field_sources_field_check check (field in (
  'price_kind', 'price_range', 'setting', 'audience', 'age_range', 'entry_modes', 'benefits', 'all_day',
  'appearance_type', 'business_models', 'attributes', 'hours', 'hours_status', 'opportunity_category',
  'categories', 'topics', 'event_type', 'experience_mechanics'
));

commit;
