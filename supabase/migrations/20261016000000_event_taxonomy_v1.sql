-- Findmi Event Taxonomy V1 — hierarchical Category -> Subcategory seed
-- for kind='event' rows. PURE DATA: no DDL, nothing deleted.
--
-- public.categories already has everything this needs (verified live):
-- parent_id uuid references categories(id) on delete set null, the
-- (kind, slug) unique key, and trg_categories_hierarchy /
-- enforce_category_hierarchy() — a row can't be its own parent, a child's
-- kind must match its parent's, and the hierarchy is exactly one level.
--
-- Existing EVENT categories (verified live) are reused IN PLACE — same id,
-- same slug, so every event_categories row, every /events?category= URL
-- and every Moment filter slug keeps working:
--   food-festival      "Food Festival"       -> "Food Festivals", child of Food & Drink
--   markets-pop-ups    "Markets & Pop-Ups"   -> "Markets & Fairs", child of Shopping & Retail
--   workshops-classes  "Workshops & Classes" -> "Classes & Workshops", top level
-- No event_categories row is touched; existing Events are NOT reclassified.
--
-- Idempotent: inserts use on conflict (kind, slug) do nothing, and the
-- three updates are keyed by (kind, slug).
-- ============================================================================

-- ── Top-level categories (Classes & Workshops is the existing row) ──────
insert into public.categories (name, slug, kind) values
  ('Food & Drink', 'food-drink', 'event'),
  ('Shopping & Retail', 'shopping-retail', 'event'),
  ('Fashion & Style', 'fashion-style', 'event'),
  ('Beauty & Wellness', 'beauty-wellness', 'event'),
  ('Arts & Culture', 'arts-culture', 'event'),
  ('Music & Nightlife', 'music-nightlife', 'event'),
  ('Entertainment', 'entertainment', 'event'),
  ('Sports & Fitness', 'sports-fitness', 'event'),
  ('Business & Tech', 'business-tech', 'event'),
  ('Family & Kids', 'family-kids', 'event'),
  ('Pets & Animals', 'pets-animals', 'event'),
  ('Community & Social', 'community-social', 'event'),
  ('Seasonal & Holiday', 'seasonal-holiday', 'event')
on conflict (kind, slug) do nothing;

update public.categories
  set name = 'Classes & Workshops', parent_id = null
  where kind = 'event' and slug = 'workshops-classes';

-- ── Existing rows reparented (same id, same slug) ───────────────────────
update public.categories c
  set name = 'Food Festivals', parent_id = p.id
  from public.categories p
  where c.kind = 'event' and c.slug = 'food-festival'
    and p.kind = 'event' and p.slug = 'food-drink';

update public.categories c
  set name = 'Markets & Fairs', parent_id = p.id
  from public.categories p
  where c.kind = 'event' and c.slug = 'markets-pop-ups'
    and p.kind = 'event' and p.slug = 'shopping-retail';

-- ── Subcategories — parent_id resolved by the parent's slug ─────────────
insert into public.categories (name, slug, kind, parent_id)
select v.name, v.slug, 'event', p.id
from (values
  ('food-drink', 'Coffee & Tea', 'coffee-tea'),
  ('food-drink', 'Tastings & Drinks', 'tastings-drinks'),
  ('food-drink', 'Dining Experiences', 'dining-experiences'),
  ('food-drink', 'Baking & Sweets', 'baking-sweets'),

  ('shopping-retail', 'Sample Sales', 'sample-sales'),
  ('shopping-retail', 'Vintage & Resale', 'vintage-resale'),
  ('shopping-retail', 'Retail Experiences', 'retail-experiences'),
  ('shopping-retail', 'Home & Lifestyle', 'home-lifestyle'),

  ('fashion-style', 'Fashion', 'fashion'),
  ('fashion-style', 'Jewelry & Accessories', 'jewelry-accessories'),
  ('fashion-style', 'Streetwear & Sneakers', 'streetwear-sneakers'),

  ('beauty-wellness', 'Beauty & Makeup', 'beauty-makeup'),
  ('beauty-wellness', 'Skincare', 'skincare'),
  ('beauty-wellness', 'Fragrance', 'fragrance'),
  ('beauty-wellness', 'Wellness & Self-Care', 'wellness-self-care'),

  ('arts-culture', 'Art & Exhibitions', 'art-exhibitions'),
  ('arts-culture', 'Film & Screenings', 'film-screenings'),
  ('arts-culture', 'Books & Talks', 'books-talks'),
  ('arts-culture', 'Design', 'design'),

  ('music-nightlife', 'Live Music', 'live-music'),
  ('music-nightlife', 'DJs & Dance', 'djs-dance'),
  ('music-nightlife', 'Parties & Nightlife', 'parties-nightlife'),

  ('entertainment', 'Comedy', 'comedy'),
  ('entertainment', 'Theater & Performance', 'theater-performance'),
  ('entertainment', 'Immersive Experiences', 'immersive-experiences'),
  ('entertainment', 'Games & Trivia', 'games-trivia'),

  ('sports-fitness', 'Running', 'running'),
  ('sports-fitness', 'Fitness Classes', 'fitness-classes'),
  ('sports-fitness', 'Outdoor & Recreation', 'outdoor-recreation'),
  ('sports-fitness', 'Sports & Watch Parties', 'sports-watch-parties'),

  ('business-tech', 'Founders & Startups', 'founders-startups'),
  ('business-tech', 'AI', 'ai'),
  ('business-tech', 'Developers & Engineering', 'developers-engineering'),
  ('business-tech', 'Finance & Investing', 'finance-investing'),
  ('business-tech', 'Careers & Networking', 'careers-networking'),

  ('workshops-classes', 'Cooking Classes', 'cooking-classes'),
  ('workshops-classes', 'Art & Craft Classes', 'art-craft-classes'),
  ('workshops-classes', 'Professional & Skill Building', 'professional-skill-building'),

  ('family-kids', 'Kids Activities', 'kids-activities'),
  ('family-kids', 'Family Experiences', 'family-experiences'),
  ('family-kids', 'Parenting', 'parenting'),

  ('pets-animals', 'Pet Events', 'pet-events'),
  ('pets-animals', 'Adoption & Rescue', 'adoption-rescue'),
  ('pets-animals', 'Pet-Friendly Experiences', 'pet-friendly-experiences'),

  ('community-social', 'Meetups & Socials', 'meetups-socials'),
  ('community-social', 'Local Festivals & Street Fairs', 'local-festivals-street-fairs'),
  ('community-social', 'Causes & Volunteering', 'causes-volunteering'),

  ('seasonal-holiday', 'Halloween & Fall', 'halloween-fall'),
  ('seasonal-holiday', 'Holiday & Winter', 'holiday-winter'),
  ('seasonal-holiday', 'Spring & Summer', 'spring-summer'),
  ('seasonal-holiday', 'Cultural Celebrations', 'cultural-celebrations')
) as v(parent_slug, name, slug)
join public.categories p on p.kind = 'event' and p.slug = v.parent_slug and p.parent_id is null
on conflict (kind, slug) do nothing;
