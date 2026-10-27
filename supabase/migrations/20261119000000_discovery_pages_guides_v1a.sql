-- Pages + Sections V1A — public Guide Pages (/guides/[slug]).
--
-- WHAT THIS DOES
--   Adds the Page-level fields a public Guide needs to the EXISTING
--   discovery_pages table (Discovery Page Builder Phase 1):
--     hero_image_url, hero_image_alt   Page hero (no Hero Section type)
--     cta_label, cta_url               optional hero call to action
--     seo_title, seo_description       search metadata (fall back to
--                                      title / description in code)
--     og_image_url                     share image (falls back to hero)
--     starts_on, ends_on               editorial COVERAGE dates only — never
--                                      publish / unpublish anything
--     published_at                     set when a Page is first published
--   Every column is nullable, so every existing row (the system Homepage
--   and the unpublished Phase 1 test page) stays valid as-is.
--
-- WHAT THIS DOES NOT DO
--   No new table, no rename, no change to ids / slugs, policies, grants or
--   the system-Homepage triggers. No row is written (no backfill, no seeded
--   Page). Public reads stay governed by the existing "Public read
--   published discovery pages" policy.
--
-- Idempotent: columns use IF NOT EXISTS, constraints are added only when
-- missing.

begin;

alter table public.discovery_pages
  add column if not exists hero_image_url text,
  add column if not exists hero_image_alt text,
  add column if not exists cta_label text,
  add column if not exists cta_url text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists og_image_url text,
  add column if not exists starts_on date,
  add column if not exists ends_on date,
  add column if not exists published_at timestamptz;

do $$
begin
  -- Images: https only (Findmi Storage uploads are https URLs).
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_hero_image_url_check') then
    alter table public.discovery_pages add constraint discovery_pages_hero_image_url_check
      check (hero_image_url is null or (char_length(hero_image_url) <= 2048 and hero_image_url ~ '^https://'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_og_image_url_check') then
    alter table public.discovery_pages add constraint discovery_pages_og_image_url_check
      check (og_image_url is null or (char_length(og_image_url) <= 2048 and og_image_url ~ '^https://'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_hero_image_alt_check') then
    alter table public.discovery_pages add constraint discovery_pages_hero_image_alt_check
      check (hero_image_alt is null or char_length(hero_image_alt) <= 200);
  end if;
  -- CTA: both or neither; the destination is https or a site-relative path.
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_cta_check') then
    alter table public.discovery_pages add constraint discovery_pages_cta_check
      check (
        (cta_label is null) = (cta_url is null)
        and (cta_label is null or char_length(btrim(cta_label)) between 1 and 40)
        and (cta_url is null or (char_length(cta_url) <= 2048 and (cta_url ~ '^https://' or cta_url ~ '^/([^/]|$)')))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_seo_check') then
    alter table public.discovery_pages add constraint discovery_pages_seo_check
      check (
        (seo_title is null or char_length(seo_title) <= 120)
        and (seo_description is null or char_length(seo_description) <= 300)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'discovery_pages_coverage_check') then
    alter table public.discovery_pages add constraint discovery_pages_coverage_check
      check (starts_on is null or ends_on is null or ends_on >= starts_on);
  end if;
end $$;

commit;
