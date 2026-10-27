-- Pages + Sections V1B — new Section types on the EXISTING homepage_rows
-- table (the Sections of every discovery_pages Page).
--
-- WHAT THIS DOES
--   1. Adds homepage_rows.config (jsonb, default '{}') — the validated,
--      per-type settings of a V1B Section (Entity Results filters / mode /
--      includes / exclusions / pins, Text & Editorial content, Map
--      source). Shape is validated in application code
--      (src/lib/page-sections.ts); the database only guarantees it is a
--      JSON object of bounded size.
--   2. Widens homepage_rows_section_type_check from feed/group to also
--      allow entity_results, rich_text and map.
--   3. Re-states homepage_rows_content_type_check so the new types (like a
--      Group) carry no legacy content_type; feed and group rules are
--      unchanged.
--   Every existing row (section_type feed/group, config defaulted to '{}')
--   satisfies the new constraints as-is.
--
-- WHAT THIS DOES NOT DO
--   No new table, no rename, no dropped column, no change to ids, page_id /
--   parent_id foreign keys, the one-level-group triggers, policies or
--   grants. No row is written, updated or deleted (no backfill, no seeded
--   Page or Section).
--
-- Idempotent: the column uses IF NOT EXISTS; each constraint is dropped if
-- present and re-added in its final form.

begin;

alter table public.homepage_rows
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.homepage_rows drop constraint if exists homepage_rows_config_check;
alter table public.homepage_rows add constraint homepage_rows_config_check
  check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 32768);

alter table public.homepage_rows drop constraint if exists homepage_rows_section_type_check;
alter table public.homepage_rows add constraint homepage_rows_section_type_check
  check (section_type = any (array['feed', 'group', 'entity_results', 'rich_text', 'map']));

alter table public.homepage_rows drop constraint if exists homepage_rows_content_type_check;
alter table public.homepage_rows add constraint homepage_rows_content_type_check
  check (
    (section_type = 'feed' and content_type = any (array['businesses', 'events', 'products', 'business_showcase']))
    or (section_type in ('group', 'entity_results', 'rich_text', 'map') and content_type is null)
  );

commit;
