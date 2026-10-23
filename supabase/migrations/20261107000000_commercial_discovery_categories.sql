-- Commercial Discovery Foundation: the Location and Business categories that
-- Growth → Targets → Discover needs and the canonical taxonomy lacked.
--
-- Additive seed only: new rows in public.categories, idempotent through the
-- existing unique (kind, slug) key. No existing category is renamed, moved or
-- removed, nothing is reassigned to an entity, and place_type stays separate
-- (a category is what a place IS for commerce; place_type is its physical
-- form). show_on_home keeps its default (false) — no consumer surface changes.

insert into public.categories (name, slug, kind) values
  ('Residential', 'residential', 'location'),
  ('Grocery', 'grocery', 'location'),
  ('Fitness / Gym', 'fitness-gym', 'location'),
  ('Salon / Spa', 'salon-spa', 'location'),
  ('Office / Workplace', 'office-workplace', 'location'),
  ('Campus', 'campus', 'location'),
  ('Agency', 'agency', 'business')
on conflict (kind, slug) do nothing;
