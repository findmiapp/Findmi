-- ============================================================================
-- Business Category Taxonomy Update (revised) — renames 4 existing
-- business categories (id/slug preserved, name only), adds the remaining
-- canonical categories that don't exist yet (including "Other" and
-- "Gifts & Specialty Goods" as brand-new rows, not reassignments), and
-- deliberately leaves "Markets & Pop-Ups" and "Packaged Goods" completely
-- untouched as temporary legacy categories — no rename, no delete, no
-- change to their existing business_categories relationships. EVENT-kind
-- and PRODUCT-kind categories are completely untouched — every statement
-- below is scoped to kind = 'business'.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Renames (id/slug preserved — no URL or relationship impact):
--   Coffee            -> Coffee, Tea & Beverages    (slug: coffee)
--   Flowers           -> Flowers & Plants           (slug: flowers)
--   Food Truck        -> Food Trucks & Mobile Food  (slug: food-truck)
--   Makers & Goods    -> Makers & Handmade Goods    (slug: makers-goods)
--   Food & Drink      -> unchanged (already matches the canonical list)
--
-- Left completely intact, on purpose (temporary legacy categories, not
-- part of the 25-name canonical list, but not removed/renamed/merged
-- either — Wildflower Market Co. and Sunny Sip Kombucha keep their
-- existing category exactly as-is):
--   Markets & Pop-Ups (slug: markets-pop-ups)
--   Packaged Goods    (slug: packaged-goods)
--
-- New categories (20 inserts) — every canonical name not already covered
-- by a rename above, including Other and Gifts & Specialty Goods as
-- genuinely new rows (no existing business is assigned to either).
-- show_on_home/home_sort_order left at table defaults (false/null) —
-- unchanged founder curation until explicitly set in /admin/categories.
--
-- Result: 27 business categories total (25 canonical + the 2 untouched
-- legacy rows above).
--
-- NOT included in this migration: enforcing "Other always last" in
-- display order — see this pass's report, item 6, for why that isn't a
-- single obvious central-helper change (two independent call sites each
-- do their own .order("name")) and was therefore left unimplemented.
-- ============================================================================

update public.categories set name = 'Coffee, Tea & Beverages'
  where id = '22222222-2222-4222-8222-222222222201' and kind = 'business';
update public.categories set name = 'Flowers & Plants'
  where id = '22222222-2222-4222-8222-222222222202' and kind = 'business';
update public.categories set name = 'Food Trucks & Mobile Food'
  where id = '22222222-2222-4222-8222-222222222203' and kind = 'business';
update public.categories set name = 'Makers & Handmade Goods'
  where id = '22222222-2222-4222-8222-222222222205' and kind = 'business';

insert into public.categories (name, slug, kind) values
  ('Art & Illustration', 'art-illustration', 'business'),
  ('Bakery & Sweets', 'bakery-sweets', 'business'),
  ('Beauty & Self-Care', 'beauty-self-care', 'business'),
  ('Classes & Workshops', 'classes-workshops', 'business'),
  ('Events & Event Services', 'events-event-services', 'business'),
  ('Experiences & Entertainment', 'experiences-entertainment', 'business'),
  ('Fashion & Apparel', 'fashion-apparel', 'business'),
  ('Gifts & Specialty Goods', 'gifts-specialty-goods', 'business'),
  ('Health, Fitness & Wellness', 'health-fitness-wellness', 'business'),
  ('Home & Decor', 'home-decor', 'business'),
  ('Home & Local Services', 'home-local-services', 'business'),
  ('Jewelry & Accessories', 'jewelry-accessories', 'business'),
  ('Kids & Family', 'kids-family', 'business'),
  ('Music & Performers', 'music-performers', 'business'),
  ('Other', 'other', 'business'),
  ('Pets', 'pets', 'business'),
  ('Photography & Creative', 'photography-creative', 'business'),
  ('Professional Services', 'professional-services', 'business'),
  ('Retail', 'retail', 'business'),
  ('Vintage & Resale', 'vintage-resale', 'business')
on conflict (kind, slug) do nothing;
