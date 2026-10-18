-- Discovery Tile Visual System pass, Part B — optional editorial cover
-- image for an Area's Discovery tile, same shape as discovery_topics.
-- image_url (nullable text, no default). TopicTile's existing text-only
-- fallback already covers the null case — no new fallback logic needed.
-- No backfill, no index, no grant changes: market_areas' existing
-- table-level grants/RLS already cover any new column automatically.
alter table market_areas
  add column image_url text null;
