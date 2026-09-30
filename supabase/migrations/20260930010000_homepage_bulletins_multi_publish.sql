-- Homepage Bulletin Carousel: allow multiple simultaneously published
-- bulletins instead of at most one. Forward migration only — the
-- original 20260929010000_homepage_bulletins.sql is left untouched.

-- Drop the partial unique index that enforced "at most one published
-- bulletin." Confirmed live definition before dropping:
--   CREATE UNIQUE INDEX homepage_bulletins_single_published_idx
--     ON public.homepage_bulletins USING btree (is_published)
--     WHERE (is_published = true)
drop index if exists public.homepage_bulletins_single_published_idx;

-- Deterministic manual ordering for published bulletins in the
-- carousel. Existing row(s) backfilled to 0 so current display order
-- is unaffected; new rows default to 0 and are placed via admin
-- Move Up/Move Down.
alter table public.homepage_bulletins
  add column if not exists display_order integer not null default 0;

-- Supports "published bulletins ordered by display_order asc,
-- created_at desc" without a full table scan.
create index if not exists homepage_bulletins_published_order_idx
  on public.homepage_bulletins (display_order asc, created_at desc)
  where is_published = true;
