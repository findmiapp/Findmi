-- ============================================================================
-- FindMi Product Taxonomy V1 — hierarchical Parent -> Subcategory seed
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- NO SCHEMA CHANGE. Confirmed against the live database before writing
-- this file: public.categories already has parent_id uuid (references
-- categories(id) on delete set null), a categories_slug_kind_key unique
-- (kind, slug) constraint, and a trg_categories_hierarchy trigger
-- (enforce_category_hierarchy()) that already enforces every rule V1
-- needs — a category can't be its own parent, a child's kind must match
-- its parent's kind, and hierarchy is capped at exactly one level (a
-- parent can't itself have a parent). All of this shipped with the
-- taxonomy foundation migration and is already live — this migration is
-- pure DATA: seeding the approved 14-parent/~154-child product taxonomy,
-- reusing two existing rows in place, everything else additive.
--
-- Existing PRODUCT-kind categories (verified live, single-digit rows):
--   apparel-accessories "Apparel & Accessories" — 0 product_categories
--     rows. Left completely untouched: the new taxonomy splits this
--     concept into two separate top-level parents (Clothing, and Bags &
--     Accessories), so it can't be confidently mapped to either one —
--     preserved as a legacy, unmapped category per this pass's own
--     instruction, not guessed at. It keeps existing (show_on_home
--     stays false/unset), so it won't appear in the new marketplace
--     primary browse row, but nothing about it is deleted or renamed.
--   food-beverage "Food & Beverage" — 0 product_categories rows. Clearly
--     the same concept as the new taxonomy's "Food & Drink" parent, and
--     with zero product assignments there is no reassignment risk — this
--     exact row is renamed/reused in place (UPDATE, not a new row).
--   home-living "Home & Living" — 0 product_categories rows, name/slug
--     already an exact match for the new taxonomy's "Home & Living"
--     parent — reused in place as-is (just gains show_on_home/
--     home_sort_order below), no rename needed.
--
-- product_categories itself has ZERO rows in production today (verified
-- live) — there are no existing product-category assignments anywhere to
-- preserve, reassign, or risk orphaning. This is a genuinely additive
-- seed, not a data migration in the usual risky sense.
--
-- show_on_home/home_sort_order are reused here for PRODUCT-kind top-level
-- categories exactly the way they already work for BUSINESS-kind ones
-- (see getHomeCategories()) — true + a 1-14 rank marks a parent as part
-- of the marketplace's new primary browse row, in the approved order.
-- Legacy apparel-accessories is deliberately left with show_on_home
-- unset (false), so it's excluded from that row without being deleted.
-- Subcategories don't set either column — a parent's own show_on_home is
-- what gates the row; children of a shown parent are always reachable
-- once their parent is selected (see the app code's own product category
-- tree query).
-- ============================================================================

-- ── Reuse existing rows in place ────────────────────────────────────────
update public.categories
  set name = 'Food & Drink', slug = 'food-drink', show_on_home = true, home_sort_order = 1
  where kind = 'product' and slug = 'food-beverage';

update public.categories
  set show_on_home = true, home_sort_order = 5
  where kind = 'product' and slug = 'home-living';

-- ── New top-level parents (the other 12 — Food & Drink and Home & Living
-- already exist via the reuse above) ────────────────────────────────────
insert into public.categories (name, slug, kind, show_on_home, home_sort_order) values
  ('Jewelry', 'jewelry', 'product', true, 2),
  ('Clothing', 'clothing', 'product', true, 3),
  ('Bags & Accessories', 'bags-accessories', 'product', true, 4),
  ('Art & Collectibles', 'art-collectibles', 'product', true, 6),
  ('Beauty & Wellness', 'beauty-wellness', 'product', true, 7),
  ('Kids & Baby', 'kids-baby', 'product', true, 8),
  ('Toys & Games', 'toys-games', 'product', true, 9),
  ('Pets', 'pets', 'product', true, 10),
  ('Stationery & Paper', 'stationery-paper', 'product', true, 11),
  ('Craft & Maker Goods', 'craft-maker-goods', 'product', true, 12),
  ('Gifts & Occasions', 'gifts-occasions', 'product', true, 13),
  ('Books & Media', 'books-media', 'product', true, 14)
on conflict (kind, slug) do nothing;

-- ── Subcategories — one block per parent, parent_id resolved by slug ────

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Bread & Baked Goods', 'bread-baked-goods'),
  ('Cakes & Desserts', 'cakes-desserts'),
  ('Cookies & Pastries', 'cookies-pastries'),
  ('Candy & Chocolate', 'candy-chocolate'),
  ('Snacks', 'snacks'),
  ('Coffee', 'coffee'),
  ('Tea & Matcha', 'tea-matcha'),
  ('Non-Alcoholic Drinks', 'non-alcoholic-drinks'),
  ('Sauces & Condiments', 'sauces-condiments'),
  ('Jams & Spreads', 'jams-spreads'),
  ('Spices & Seasonings', 'spices-seasonings'),
  ('Pantry Goods', 'pantry-goods'),
  ('Prepared Foods', 'prepared-foods'),
  ('Specialty Foods', 'specialty-foods')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'food-drink'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Earrings', 'earrings'),
  ('Necklaces', 'necklaces'),
  ('Rings', 'rings'),
  ('Bracelets', 'bracelets'),
  ('Anklets', 'anklets'),
  ('Brooches & Pins', 'brooches-pins'),
  ('Charms & Pendants', 'charms-pendants'),
  ('Body Jewelry', 'body-jewelry'),
  ('Watches', 'watches'),
  ('Fine Jewelry', 'fine-jewelry'),
  ('Other Jewelry', 'other-jewelry')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'jewelry'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('T-Shirts & Tops', 't-shirts-tops'),
  ('Sweatshirts & Hoodies', 'sweatshirts-hoodies'),
  ('Dresses', 'dresses'),
  ('Skirts', 'skirts'),
  ('Pants & Shorts', 'pants-shorts'),
  ('Outerwear', 'outerwear'),
  ('Activewear', 'activewear'),
  ('Swimwear', 'swimwear'),
  ('Intimates & Sleepwear', 'intimates-sleepwear'),
  ('Kids Clothing', 'kids-clothing'),
  ('Baby Clothing', 'baby-clothing'),
  ('Vintage Clothing', 'vintage-clothing'),
  ('Other Clothing', 'other-clothing')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'clothing'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Handbags & Purses', 'handbags-purses'),
  ('Tote Bags', 'tote-bags'),
  ('Backpacks', 'backpacks'),
  ('Wallets & Card Holders', 'wallets-card-holders'),
  ('Belts', 'belts'),
  ('Hats & Caps', 'hats-caps'),
  ('Scarves & Wraps', 'scarves-wraps'),
  ('Hair Accessories', 'hair-accessories'),
  ('Sunglasses & Eyewear', 'sunglasses-eyewear'),
  ('Keychains', 'keychains'),
  ('Travel Accessories', 'travel-accessories'),
  ('Other Accessories', 'other-accessories')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'bags-accessories'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Home Decor', 'home-decor'),
  ('Wall Decor', 'wall-decor'),
  ('Candles', 'candles'),
  ('Kitchen & Dining', 'kitchen-dining'),
  ('Drinkware', 'drinkware'),
  ('Furniture', 'furniture'),
  ('Pillows & Textiles', 'pillows-textiles'),
  ('Bedding', 'bedding'),
  ('Bath & Home', 'bath-home'),
  ('Storage & Organization', 'storage-organization'),
  ('Plants & Planters', 'plants-planters'),
  ('Garden & Outdoor', 'garden-outdoor'),
  ('Home Fragrance', 'home-fragrance'),
  ('Other Home Goods', 'other-home-goods')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'home-living'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Paintings', 'paintings'),
  ('Prints', 'prints'),
  ('Illustration', 'illustration'),
  ('Photography', 'photography'),
  ('Sculpture', 'sculpture'),
  ('Mixed Media', 'mixed-media'),
  ('Digital Art', 'digital-art'),
  ('Posters', 'posters'),
  ('Collectibles', 'collectibles'),
  ('Figurines & Miniatures', 'figurines-miniatures'),
  ('Memorabilia', 'memorabilia'),
  ('Other Art', 'other-art')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'art-collectibles'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Skincare', 'skincare'),
  ('Bath & Body', 'bath-body'),
  ('Soap', 'soap'),
  ('Hair Care', 'hair-care'),
  ('Cosmetics', 'cosmetics'),
  ('Fragrance', 'fragrance'),
  ('Nail Care', 'nail-care'),
  ('Wellness Products', 'wellness-products'),
  ('Aromatherapy', 'aromatherapy'),
  ('Grooming', 'grooming'),
  ('Other Beauty & Wellness', 'other-beauty-wellness')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'beauty-wellness'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Baby Accessories', 'baby-accessories'),
  ('Nursery', 'nursery'),
  ('Baby Gifts', 'baby-gifts'),
  ('Kids Accessories', 'kids-accessories'),
  ('Kids Decor', 'kids-decor'),
  ('Educational Products', 'educational-products'),
  ('Baby Essentials', 'baby-essentials'),
  ('Other Kids & Baby', 'other-kids-baby')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'kids-baby'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Toys', 'toys'),
  ('Plush & Stuffed Animals', 'plush-stuffed-animals'),
  ('Dolls & Figures', 'dolls-figures'),
  ('Games', 'games'),
  ('Puzzles', 'puzzles'),
  ('Outdoor Toys', 'outdoor-toys'),
  ('Sensory Toys', 'sensory-toys'),
  ('Collectible Toys', 'collectible-toys'),
  ('Other Toys & Games', 'other-toys-games')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'toys-games'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Pet Treats', 'pet-treats'),
  ('Collars & Leashes', 'collars-leashes'),
  ('Pet Clothing', 'pet-clothing'),
  ('Pet Toys', 'pet-toys'),
  ('Pet Beds', 'pet-beds'),
  ('Bowls & Feeding', 'bowls-feeding'),
  ('Pet Accessories', 'pet-accessories'),
  ('Pet Gifts', 'pet-gifts'),
  ('Other Pet Products', 'other-pet-products')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'pets'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Greeting Cards', 'greeting-cards'),
  ('Invitations', 'invitations'),
  ('Stickers', 'stickers'),
  ('Journals & Notebooks', 'journals-notebooks'),
  ('Planners', 'planners'),
  ('Art Prints', 'art-prints'),
  ('Calendars', 'calendars'),
  ('Stationery', 'stationery'),
  ('Gift Wrap', 'gift-wrap'),
  ('Party Paper Goods', 'party-paper-goods'),
  ('Other Paper Goods', 'other-paper-goods')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'stationery-paper'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Ceramics & Pottery', 'ceramics-pottery'),
  ('Crochet & Knit', 'crochet-knit'),
  ('Leather Goods', 'leather-goods'),
  ('Woodwork', 'woodwork'),
  ('Glasswork', 'glasswork'),
  ('Fiber Arts', 'fiber-arts'),
  ('Metalwork', 'metalwork'),
  ('Resin Goods', 'resin-goods'),
  ('Handmade Soap & Candles', 'handmade-soap-candles'),
  ('Craft Supplies', 'craft-supplies'),
  ('Patterns & Kits', 'patterns-kits'),
  ('Other Maker Goods', 'other-maker-goods')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'craft-maker-goods'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Personalized Gifts', 'personalized-gifts'),
  ('Gift Boxes & Sets', 'gift-boxes-sets'),
  ('Wedding', 'wedding'),
  ('Birthday', 'birthday'),
  ('Baby Shower', 'baby-shower'),
  ('Housewarming', 'housewarming'),
  ('Holiday & Seasonal', 'holiday-seasonal'),
  ('Party Favors', 'party-favors'),
  ('Corporate Gifts', 'corporate-gifts'),
  ('Other Gifts', 'other-gifts')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'gifts-occasions'
on conflict (kind, slug) do nothing;

insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'product', p.id
from (values
  ('Books', 'books'),
  ('Zines', 'zines'),
  ('Comics', 'comics'),
  ('Magazines', 'magazines'),
  ('Music', 'music'),
  ('Vinyl & Physical Media', 'vinyl-physical-media'),
  ('Digital Downloads', 'digital-downloads'),
  ('Other Books & Media', 'other-books-media')
) as v(name, slug), public.categories p
where p.kind = 'product' and p.slug = 'books-media'
on conflict (kind, slug) do nothing;
