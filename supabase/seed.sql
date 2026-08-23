-- ============================================================================
-- Findmi seed data
-- Realistic, clearly-fictional sample businesses, products, events and
-- appearances so the app has something to show immediately after setup.
-- Safe to re-run — inserts are keyed to fixed UUIDs with ON CONFLICT DO
-- NOTHING. Dates are relative to "now" so the demo always looks current.
-- Run this AFTER schema.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- categories
-- ----------------------------------------------------------------------------
insert into categories (id, name, slug) values
  ('22222222-2222-4222-8222-222222222201', 'Coffee', 'coffee'),
  ('22222222-2222-4222-8222-222222222202', 'Flowers', 'flowers'),
  ('22222222-2222-4222-8222-222222222203', 'Food Truck', 'food-truck'),
  ('22222222-2222-4222-8222-222222222204', 'Markets & Pop-Ups', 'markets-pop-ups'),
  ('22222222-2222-4222-8222-222222222205', 'Makers & Goods', 'makers-goods'),
  ('22222222-2222-4222-8222-222222222206', 'Packaged Goods', 'packaged-goods'),
  ('22222222-2222-4222-8222-222222222207', 'Food & Drink', 'food-drink')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- businesses
-- ----------------------------------------------------------------------------
insert into businesses (
  id, slug, name, short_description, description, logo_url, cover_image_url,
  website_url, instagram_url, email, phone, city, state, country,
  service_radius_miles, verified, founding_member, membership_status, lead_status
) values
(
  '11111111-1111-4111-8111-111111111101',
  'bloom-and-brew',
  'Bloom & Brew',
  'Mobile coffee cart and flower stand, pouring lattes and building bouquets curbside.',
  'Bloom & Brew is a mobile coffee-and-flower cart out of a restored 1978 Airstream. We pull espresso and hand-tie small-batch bouquets side by side, so you can walk away with a latte in one hand and fresh stems in the other. Book us for markets, weddings, and office mornings around Austin.',
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=1600&h=900&fit=crop',
  'https://example.com/bloomandbrew',
  'https://instagram.com/bloomandbrew',
  'hello@bloomandbrew.example',
  '512-555-0101',
  'Austin', 'TX', 'US', 25, true, true, 'active', 'qualified'
),
(
  '11111111-1111-4111-8111-111111111102',
  'curbside-kimchi',
  'Curbside Kimchi',
  'Korean-fusion food truck slinging kimchi fries, bulgogi bowls, and fried chicken bao.',
  'Curbside Kimchi started as a weekend pop-up and turned into Austin''s favorite Korean-fusion truck. Expect double-fried chicken bao, kimchi fries loaded with bulgogi, and a rotating list of banchan-inspired sides. Find us parked at markets, breweries, and food truck fests all over town.',
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1600&h=900&fit=crop',
  'https://example.com/curbsidekimchi',
  'https://instagram.com/curbsidekimchi',
  'hi@curbsidekimchi.example',
  '512-555-0102',
  'Austin', 'TX', 'US', 40, true, true, 'active', 'qualified'
),
(
  '11111111-1111-4111-8111-111111111103',
  'wildflower-market-co',
  'Wildflower Market Co.',
  'A curated maker collective bringing 40+ small brands to one pop-up market each month.',
  'Wildflower Market Co. hand-picks a rotating lineup of local makers, vintage sellers, and small food brands for one beautifully styled pop-up market a month. If you love discovering new small businesses in one walkable spot, this is your people.',
  'https://images.unsplash.com/photo-1519677100203-a0e668c92439?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=1600&h=900&fit=crop',
  'https://example.com/wildflowermarketco',
  'https://instagram.com/wildflowermarketco',
  'team@wildflowermarketco.example',
  '512-555-0103',
  'Austin', 'TX', 'US', 50, true, true, 'active', 'qualified'
),
(
  '11111111-1111-4111-8111-111111111104',
  'roast-house-coffee',
  'Roast House Coffee',
  'Small-batch roaster with a flagship counter and a mobile cart for markets and events.',
  'Roast House Coffee roasts in small batches out of East Austin and serves it two ways: from our flagship counter, and from a mobile cart we bring to farmers markets, festivals, and private events. Same beans, same baristas, wherever you find us.',
  'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1600&h=900&fit=crop',
  'https://example.com/roasthousecoffee',
  'https://instagram.com/roasthousecoffee',
  'orders@roasthousecoffee.example',
  '512-555-0104',
  'Austin', 'TX', 'US', 30, true, true, 'active', 'qualified'
),
(
  '11111111-1111-4111-8111-111111111105',
  'palermo-leather-co',
  'Palermo Leather Co.',
  'Handmade leather goods — wallets, totes, and belts, cut and stitched in small runs.',
  'Palermo Leather Co. is a one-person leather shop making full-grain wallets, totes, and belts by hand in small runs. Every piece is cut, dyed, and stitched in a small East Austin studio. You''ll usually find the workbench itself set up at markets on weekends.',
  'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=1600&h=900&fit=crop',
  'https://example.com/palermoleather',
  'https://instagram.com/palermoleather',
  'shop@palermoleather.example',
  '512-555-0105',
  'Austin', 'TX', 'US', 35, true, true, 'active', 'qualified'
),
(
  '11111111-1111-4111-8111-111111111106',
  'sunny-sip-kombucha',
  'Sunny Sip Kombucha',
  'Small-batch kombucha in cans — floral, fruity, and low-sugar flavors made in Austin.',
  'Sunny Sip Kombucha brews small batches of low-sugar, naturally fizzy kombucha and cans it right here in Austin. You''ll find our cans at markets, in local fridges, and at pretty much every pop-up we can talk our way into.',
  'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=256&h=256&fit=crop',
  'https://images.unsplash.com/photo-1600788907416-456578634209?w=1600&h=900&fit=crop',
  'https://example.com/sunnysipkombucha',
  'https://instagram.com/sunnysipkombucha',
  'hello@sunnysipkombucha.example',
  '512-555-0106',
  'Austin', 'TX', 'US', 60, true, true, 'active', 'qualified'
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- The Native Rose — real Staten Island business, added from their own
-- Instagram (@thenativerose.ny): a mobile flower bar + coffee trailer.
-- Photos in /public/seed are cropped from their own posted photos.
-- ----------------------------------------------------------------------------
insert into businesses (
  id, slug, name, short_description, description, logo_url, cover_image_url,
  website_url, instagram_url, email, phone, city, state, country,
  service_radius_miles, verified, founding_member, membership_status, lead_status
) values (
  '11111111-1111-4111-8111-111111111107',
  'the-native-rose',
  'The Native Rose',
  'Mobile flower bar and coffee trailer serving Staten Island markets and pop-ups.',
  'The Native Rose is a flowers-and-coffee trailer built out of a converted horse trailer, parked at markets and pop-ups around Staten Island. Their signature Flower Bar lets you build your own bouquet — pick a size, mix and match stems, and they wrap it beautifully on the spot — alongside iced coffee and cold brew from the window. Flowers. Coffee. Community.',
  null,
  '/seed/native-rose-cover.jpg',
  null,
  'https://instagram.com/thenativerose.ny',
  null,
  null,
  'Staten Island', 'NY', 'US', 20, false, false, 'lead', 'new'
)
on conflict (id) do nothing;

insert into business_categories (business_id, category_id) values
  ('11111111-1111-4111-8111-111111111107', '22222222-2222-4222-8222-222222222202'), -- The Native Rose: Flowers
  ('11111111-1111-4111-8111-111111111107', '22222222-2222-4222-8222-222222222201')  -- The Native Rose: Coffee
on conflict do nothing;

insert into products (id, business_id, name, slug, description, image_url, price, price_label, product_type, is_featured, is_active) values
('55555555-5555-4555-8555-555555555514', '11111111-1111-4111-8111-111111111107', 'Flower Bar — Mini Bloom', 'mini-bloom', '2 focal stems + 3 filler stems, wrapped for you.', '/seed/native-rose-flowerbar.jpg', 20.00, '$20', 'product', true, true),
('55555555-5555-4555-8555-555555555515', '11111111-1111-4111-8111-111111111107', 'Flower Bar — Signature', 'signature-bouquet', '4 focal stems + 6 filler stems — our most popular build.', null, 35.00, '$35', 'product', true, true),
('55555555-5555-4555-8555-555555555516', '11111111-1111-4111-8111-111111111107', 'Flower Bar — Luxe Bloom', 'luxe-bloom', '6 focal stems + 4 filler stems, wrapped for a statement.', null, 55.00, '$55', 'product', false, true),
('55555555-5555-4555-8555-555555555517', '11111111-1111-4111-8111-111111111107', 'Iced Coffee', 'iced-coffee', 'Cold brew and lattes, made to order from the trailer window.', '/seed/native-rose-window.jpg', 6.00, '$6', 'product', true, true)
on conflict (id) do nothing;

-- Real upcoming pop-up schedule from @thenativerose.ny, shifted to stay
-- relative to "now" so it never looks stale — venue names, addresses, and
-- times are taken directly from their flyer.
insert into appearances (id, business_id, event_id, title, description, start_at, end_at, venue_name, address, city, state, status, is_featured) values
('44444444-4444-4444-8444-444444444414', '11111111-1111-4111-8111-111111111107', null, 'Minthorne Market', null, now() + interval '6 days' + interval '12 hours', now() + interval '6 days' + interval '16 hours', 'Minthorne Market', 'Minthorne St', 'Staten Island', 'NY', 'confirmed', true),
('44444444-4444-4444-8444-444444444415', '11111111-1111-4111-8111-111111111107', null, 'Luxe Spa Back-to-School Pop-Up', null, now() + interval '13 days' + interval '11 hours', now() + interval '13 days' + interval '14 hours', 'Luxe Spa', '2248 Victory Blvd', 'Staten Island', 'NY', 'confirmed', false),
('44444444-4444-4444-8444-444444444416', '11111111-1111-4111-8111-111111111107', null, 'Faire and Flourish Market', null, now() + interval '20 days' + interval '12 hours', now() + interval '20 days' + interval '16 hours', 'Staten Island Mall (Outdoor, Main Entrance)', null, 'Staten Island', 'NY', 'confirmed', true),
('44444444-4444-4444-8444-444444444417', '11111111-1111-4111-8111-111111111107', null, 'Piccola Pasta Shop', null, now() + interval '27 days' + interval '10 hours', now() + interval '27 days' + interval '14 hours', 'Piccola Pasta Shop', '3939 Amboy Rd', 'Staten Island', 'NY', 'confirmed', false),
('44444444-4444-4444-8444-444444444418', '11111111-1111-4111-8111-111111111107', null, 'PS 8 Back-to-School Carnival', 'PS 8 students and families only.', now() + interval '34 days' + interval '16 hours 30 minutes', now() + interval '34 days' + interval '19 hours 30 minutes', 'PS 8', null, 'Staten Island', 'NY', 'confirmed', false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- business_categories
-- ----------------------------------------------------------------------------
insert into business_categories (business_id, category_id) values
  ('11111111-1111-4111-8111-111111111101', '22222222-2222-4222-8222-222222222201'), -- Bloom & Brew: Coffee
  ('11111111-1111-4111-8111-111111111101', '22222222-2222-4222-8222-222222222202'), -- Bloom & Brew: Flowers
  ('11111111-1111-4111-8111-111111111102', '22222222-2222-4222-8222-222222222203'), -- Curbside Kimchi: Food Truck
  ('11111111-1111-4111-8111-111111111102', '22222222-2222-4222-8222-222222222207'), -- Curbside Kimchi: Food & Drink
  ('11111111-1111-4111-8111-111111111103', '22222222-2222-4222-8222-222222222204'), -- Wildflower: Markets
  ('11111111-1111-4111-8111-111111111104', '22222222-2222-4222-8222-222222222201'), -- Roast House: Coffee
  ('11111111-1111-4111-8111-111111111104', '22222222-2222-4222-8222-222222222207'), -- Roast House: Food & Drink
  ('11111111-1111-4111-8111-111111111105', '22222222-2222-4222-8222-222222222205'), -- Palermo Leather: Makers
  ('11111111-1111-4111-8111-111111111106', '22222222-2222-4222-8222-222222222206'), -- Sunny Sip: Packaged Goods
  ('11111111-1111-4111-8111-111111111106', '22222222-2222-4222-8222-222222222207')  -- Sunny Sip: Food & Drink
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- products
-- ----------------------------------------------------------------------------
insert into products (id, business_id, name, slug, description, image_url, price, price_label, product_type, is_featured, is_active) values
('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111101', 'Seasonal Bouquet', 'seasonal-bouquet', 'A hand-tied bouquet built from whatever''s freshest that week.', 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&h=800&fit=crop', 28.00, 'from $28', 'product', true, true),
('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111101', 'Oat Milk Latte', 'oat-milk-latte', 'Double shot espresso, steamed oat milk.', 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=800&h=800&fit=crop', 6.00, '$6', 'product', true, true),
('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111101', 'Cart Booking (Private Event)', 'cart-booking', 'Book the Bloom & Brew cart for weddings, offices, and private events.', 'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=800&h=800&fit=crop', null, 'starting at $450', 'service', false, true),

('55555555-5555-4555-8555-555555555504', '11111111-1111-4111-8111-111111111102', 'Kimchi Fries', 'kimchi-fries', 'Crispy fries loaded with bulgogi, kimchi, and spicy mayo.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&h=800&fit=crop', 11.00, '$11', 'product', true, true),
('55555555-5555-4555-8555-555555555505', '11111111-1111-4111-8111-111111111102', 'Fried Chicken Bao', 'fried-chicken-bao', 'Double-fried chicken thigh, slaw, gochujang glaze, steamed bun.', 'https://images.unsplash.com/photo-1552611052-33e04de081de?w=800&h=800&fit=crop', 5.00, '$5 each', 'product', true, true),
('55555555-5555-4555-8555-555555555506', '11111111-1111-4111-8111-111111111102', 'Bulgogi Bowl', 'bulgogi-bowl', 'Marinated bulgogi over rice with pickled vegetables.', 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=800&h=800&fit=crop', 13.00, '$13', 'product', false, true),

('55555555-5555-4555-8555-555555555507', '11111111-1111-4111-8111-111111111104', 'Ethiopia Yirgacheffe', 'ethiopia-yirgacheffe', 'Light roast, floral and bright, 12oz bag.', 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800&h=800&fit=crop', 19.00, '$19', 'product', true, true),
('55555555-5555-4555-8555-555555555508', '11111111-1111-4111-8111-111111111104', 'Cold Brew Concentrate', 'cold-brew-concentrate', '32oz bottle, cuts 1:1 with water or milk.', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=800&h=800&fit=crop', 16.00, '$16', 'product', false, true),
('55555555-5555-4555-8555-555555555509', '11111111-1111-4111-8111-111111111104', 'Mobile Cart Catering', 'mobile-cart-catering', 'Full-service coffee cart for corporate and private events.', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=800&fit=crop', null, 'starting at $500', 'service', true, true),

('55555555-5555-4555-8555-555555555510', '11111111-1111-4111-8111-111111111105', 'Classic Bifold Wallet', 'classic-bifold-wallet', 'Full-grain leather, hand-stitched, ages beautifully.', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800&h=800&fit=crop', 68.00, '$68', 'product', true, true),
('55555555-5555-4555-8555-555555555511', '11111111-1111-4111-8111-111111111105', 'Weekender Tote', 'weekender-tote', 'Oversized leather tote for travel or the studio.', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800&h=800&fit=crop', 210.00, '$210', 'product', true, true),

('55555555-5555-4555-8555-555555555512', '11111111-1111-4111-8111-111111111106', 'Hibiscus Mint 4-Pack', 'hibiscus-mint-4-pack', 'Light, floral, and low-sugar. 12oz cans.', 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=800&h=800&fit=crop', 12.00, '$12', 'product', true, true),
('55555555-5555-4555-8555-555555555513', '11111111-1111-4111-8111-111111111106', 'Ginger Peach 4-Pack', 'ginger-peach-4-pack', 'Spicy ginger, sweet peach, naturally fizzy.', 'https://images.unsplash.com/photo-1600788907416-456578634209?w=800&h=800&fit=crop', 12.00, '$12', 'product', false, true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- events
-- ----------------------------------------------------------------------------
insert into events (id, slug, name, description, cover_image_url, start_at, end_at, venue_name, address, city, state, latitude, longitude, organizer_name, is_featured) values
(
  '33333333-3333-4333-8333-333333333301',
  'eastside-night-market',
  'Eastside Night Market',
  'A monthly evening market with 40+ local makers, food trucks, and live music under string lights.',
  'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=1600&h=900&fit=crop',
  now() + interval '6 days' + interval '18 hours',
  now() + interval '6 days' + interval '22 hours',
  'Canopy Lot',
  '1224 E 5th St',
  'Austin', 'TX', 30.2632, -97.7222,
  'Wildflower Market Co.',
  true
),
(
  '33333333-3333-4333-8333-333333333302',
  'sunday-farmers-market-mueller',
  'Sunday Farmers Market at Mueller',
  'A weekly farmers market with local coffee, flowers, produce, and prepared foods.',
  'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1600&h=900&fit=crop',
  now() + interval '3 days' + interval '9 hours',
  now() + interval '3 days' + interval '13 hours',
  'Mueller Lake Park',
  '4550 Mueller Blvd',
  'Austin', 'TX', 30.2989, -97.7075,
  'Mueller Market Co.',
  true
),
(
  '33333333-3333-4333-8333-333333333303',
  'austin-food-truck-fest',
  'Austin Food Truck Fest',
  'A weekend-long celebration of the city''s best food trucks, all parked in one field.',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1600&h=900&fit=crop',
  now() + interval '13 days' + interval '11 hours',
  now() + interval '14 days' + interval '21 hours',
  'Circuit of the Americas Lot C',
  '9201 Circuit of the Americas Blvd',
  'Austin', 'TX', 30.1328, -97.6411,
  'ATX Truck Collective',
  false
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- event_businesses ("Who You'll Find There")
-- ----------------------------------------------------------------------------
insert into event_businesses (event_id, business_id) values
  -- Eastside Night Market
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111101'),
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111102'),
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111103'),
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111105'),
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111106'),
  -- Sunday Farmers Market at Mueller
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111101'),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111104'),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111106'),
  -- Austin Food Truck Fest
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111102'),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111104')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- appearances ("Findmi Next") — mirrors event_businesses for event-linked
-- rows, plus a few standalone appearances not tied to any event.
-- ----------------------------------------------------------------------------
insert into appearances (id, business_id, event_id, title, description, start_at, end_at, venue_name, address, city, state, latitude, longitude, status, is_featured) values
-- Bloom & Brew
('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333301', 'Eastside Night Market', null, now() + interval '6 days' + interval '18 hours', now() + interval '6 days' + interval '22 hours', 'Canopy Lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222, 'confirmed', true),
('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111101', '33333333-3333-4333-8333-333333333302', 'Sunday Farmers Market at Mueller', null, now() + interval '3 days' + interval '9 hours', now() + interval '3 days' + interval '13 hours', 'Mueller Lake Park', '4550 Mueller Blvd', 'Austin', 'TX', 30.2989, -97.7075, 'confirmed', false),
('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111101', null, 'Private Wedding — South Congress', 'Private booking, cart parked for a private event.', now() + interval '10 days' + interval '16 hours', now() + interval '10 days' + interval '20 hours', 'The Grackle Estate', '2100 S Congress Ave', 'Austin', 'TX', 30.2402, -97.7501, 'confirmed', false),

-- Curbside Kimchi
('44444444-4444-4444-8444-444444444404', '11111111-1111-4111-8111-111111111102', '33333333-3333-4333-8333-333333333301', 'Eastside Night Market', null, now() + interval '6 days' + interval '18 hours', now() + interval '6 days' + interval '22 hours', 'Canopy Lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222, 'confirmed', true),
('44444444-4444-4444-8444-444444444405', '11111111-1111-4111-8111-111111111102', '33333333-3333-4333-8333-333333333303', 'Austin Food Truck Fest', null, now() + interval '13 days' + interval '11 hours', now() + interval '14 days' + interval '21 hours', 'Circuit of the Americas Lot C', '9201 Circuit of the Americas Blvd', 'Austin', 'TX', 30.1328, -97.6411, 'confirmed', false),
('44444444-4444-4444-8444-444444444406', '11111111-1111-4111-8111-111111111102', null, 'Zilker Brewing Parked Truck Night', null, now() + interval '2 days' + interval '17 hours', now() + interval '2 days' + interval '21 hours', 'Zilker Brewing Co.', '1701 E 6th St', 'Austin', 'TX', 30.2610, -97.7247, 'confirmed', false),

-- Wildflower Market Co.
('44444444-4444-4444-8444-444444444407', '11111111-1111-4111-8111-111111111103', '33333333-3333-4333-8333-333333333301', 'Eastside Night Market', null, now() + interval '6 days' + interval '18 hours', now() + interval '6 days' + interval '22 hours', 'Canopy Lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222, 'confirmed', true),
('44444444-4444-4444-8444-444444444408', '11111111-1111-4111-8111-111111111103', null, 'Wildflower Market: South Lamar', null, now() + interval '27 days' + interval '17 hours', now() + interval '27 days' + interval '21 hours', 'South Lamar Plaza', '1100 S Lamar Blvd', 'Austin', 'TX', 30.2564, -97.7638, 'tentative', false),

-- Roast House Coffee
('44444444-4444-4444-8444-444444444409', '11111111-1111-4111-8111-111111111104', '33333333-3333-4333-8333-333333333302', 'Sunday Farmers Market at Mueller', null, now() + interval '3 days' + interval '9 hours', now() + interval '3 days' + interval '13 hours', 'Mueller Lake Park', '4550 Mueller Blvd', 'Austin', 'TX', 30.2989, -97.7075, 'confirmed', true),
('44444444-4444-4444-8444-444444444410', '11111111-1111-4111-8111-111111111104', '33333333-3333-4333-8333-333333333303', 'Austin Food Truck Fest', null, now() + interval '13 days' + interval '11 hours', now() + interval '14 days' + interval '21 hours', 'Circuit of the Americas Lot C', '9201 Circuit of the Americas Blvd', 'Austin', 'TX', 30.1328, -97.6411, 'confirmed', false),

-- Palermo Leather Co.
('44444444-4444-4444-8444-444444444411', '11111111-1111-4111-8111-111111111105', '33333333-3333-4333-8333-333333333301', 'Eastside Night Market', null, now() + interval '6 days' + interval '18 hours', now() + interval '6 days' + interval '22 hours', 'Canopy Lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222, 'confirmed', false),

-- Sunny Sip Kombucha
('44444444-4444-4444-8444-444444444412', '11111111-1111-4111-8111-111111111106', '33333333-3333-4333-8333-333333333301', 'Eastside Night Market', null, now() + interval '6 days' + interval '18 hours', now() + interval '6 days' + interval '22 hours', 'Canopy Lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222, 'confirmed', false),
('44444444-4444-4444-8444-444444444413', '11111111-1111-4111-8111-111111111106', '33333333-3333-4333-8333-333333333302', 'Sunday Farmers Market at Mueller', null, now() + interval '3 days' + interval '9 hours', now() + interval '3 days' + interval '13 hours', 'Mueller Lake Park', '4550 Mueller Blvd', 'Austin', 'TX', 30.2989, -97.7075, 'confirmed', false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- locations
-- ----------------------------------------------------------------------------
insert into locations (id, name, slug, address, city, state, latitude, longitude) values
  ('66666666-6666-4666-8666-666666666601', 'Canopy Lot', 'canopy-lot', '1224 E 5th St', 'Austin', 'TX', 30.2632, -97.7222),
  ('66666666-6666-4666-8666-666666666602', 'Mueller Lake Park', 'mueller-lake-park', '4550 Mueller Blvd', 'Austin', 'TX', 30.2989, -97.7075),
  ('66666666-6666-4666-8666-666666666603', 'Circuit of the Americas Lot C', 'cota-lot-c', '9201 Circuit of the Americas Blvd', 'Austin', 'TX', 30.1328, -97.6411)
on conflict (id) do nothing;
