-- JC local preview — FICTIONAL Jersey City preview content.
--
-- Loaded ONLY into the throwaway local preview database by
-- scripts/jc-preview/start.sh, never into any Supabase project. Every
-- business, place and event below is invented. Rows are ordinary Findmi
-- rows (businesses, locations, events, occurrences, appearances), so the
-- real Findmi pages render them through their real queries and rules.
-- Dates are generated relative to "now" (America/New_York) on every load,
-- including one past event and one expired recurring date that must never
-- appear as current, one date-only event and one hidden-location event.

-- deterministic ids so rows can reference each other
create or replace function pg_temp.pid(k text) returns uuid language sql immutable as $$ select md5('jc-preview:' || k)::uuid $$;
-- local wall-clock (America/New_York) day offset + hour → instant
create or replace function pg_temp.at(d int, h int) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/New_York')::date + d) + make_interval(hours => h)) at time zone 'America/New_York' $$;
create or replace function pg_temp.day(d int) returns date language sql stable as $$
  select (now() at time zone 'America/New_York')::date + d $$;
-- days until the coming Saturday (0 on Saturday)
create or replace function pg_temp.sat() returns int language sql stable as $$
  select ((6 - extract(dow from (now() at time zone 'America/New_York'))::int + 7) % 7) $$;
create or replace function pg_temp.img(id text) returns text language sql immutable as $$
  select 'https://images.unsplash.com/photo-' || id || '?auto=format&fit=crop&w=1200&q=70' $$;
create or replace function pg_temp.mkt() returns uuid language sql stable as $$ select id from public.markets where slug = 'north-jersey' $$;
create or replace function pg_temp.area(s text) returns uuid language sql stable as $$
  select id from public.market_areas where market_id = pg_temp.mkt() and slug = s $$;
create or replace function pg_temp.cat(k text, s text) returns uuid language sql stable as $$
  select id from public.categories where kind = k and slug = s $$;

-- ── Neighborhoods: child Areas of Jersey City (local preview only) ─────
insert into public.market_areas (id, market_id, name, slug, active, consumer_visible, sort_order, parent_area_id, level, image_url)
select pg_temp.pid('area:' || s), pg_temp.mkt(), n, s, true, true, o, pg_temp.area('jersey-city'), 'neighborhood', pg_temp.img(i)
from (values
  ('downtown', 'Downtown', 1, '1477959858617-67f85cf4f1df'),
  ('the-heights', 'The Heights', 2, '1449824913935-59a10b8d2000'),
  ('journal-square', 'Journal Square', 3, '1519501025264-65ba15a82390'),
  ('hamilton-park', 'Hamilton Park', 4, '1500530855697-b586d89ba3ee'),
  ('paulus-hook', 'Paulus Hook', 5, '1496442226666-8d4d0e62e6e9'),
  ('bergen-lafayette', 'Bergen-Lafayette', 6, '1444723121867-7a241cacace9')
) v(s, n, o, i);

-- ── Places ─────────────────────────────────────────────────────────────
insert into public.locations (id, name, slug, address, city, state, postal_code, is_demo, market_id, market_area_id, description, cover_image_url, category_id, place_type, geo_place_key)
select pg_temp.pid('loc:' || s), n, s, a, 'Jersey City', 'NJ', z, false, pg_temp.mkt(), pg_temp.area(h), d, pg_temp.img(i), pg_temp.cat('location', c), 'venue', 'place:3436000'
from (values
  ('harbor-roast', 'Harbor Roast', 'Grand St', '07302', 'paulus-hook', 'cafe-coffee-shop', '1501339847302-ac426a4a7cbb', 'A bright corner espresso bar a block from the water.'),
  ('pavonia-coffee-co', 'Pavonia Coffee Co.', 'Newark Ave', '07302', 'downtown', 'cafe-coffee-shop', '1559925393-8be0ec4767c8', 'Neighborhood roaster with a tiny back patio.'),
  ('lantern-and-salt', 'Lantern & Salt', 'Jersey Ave', '07302', 'hamilton-park', 'restaurant', '1517248135467-4c7edcad34c4', 'Wood-fired seasonal plates in a converted rowhouse facing the park.'),
  ('newark-ave-noodle-bar', 'Newark Ave Noodle Bar', 'Newark Ave', '07306', 'journal-square', 'restaurant', '1555396273-367ea4eb4db5', 'Hand-pulled noodles and late-night dumplings.'),
  ('ninth-street-taproom', 'Ninth Street Taproom', 'Ninth St', '07307', 'the-heights', 'brewery-taproom', '1470337458703-46ad1756a187', 'Small-batch beer and a back room for comedy nights.'),
  ('liberty-pier-lawn', 'Liberty Pier Lawn', 'Hudson River Waterfront', '07302', 'downtown', 'park-outdoor-space', '1500530855697-b586d89ba3ee', 'A waterfront lawn with a skyline view.'),
  ('studio-on-monticello', 'Studio on Monticello', 'Monticello Ave', '07304', 'bergen-lafayette', 'gallery', '1531058020387-3be344556be6', 'A volunteer-run gallery and print studio.'),
  ('grove-street-plaza', 'Grove Street Plaza', 'Grove St', '07302', 'downtown', 'market', '1488459716781-31db52582fe9', 'The downtown plaza where the weekend markets set up.'),
  ('riverview-park', 'Riverview Park', 'Palisade Ave', '07307', 'the-heights', 'park-outdoor-space', '1444723121867-7a241cacace9', 'Cliff-top park with views over Hoboken and Manhattan.')
) v(s, n, a, z, h, c, i, d);

-- ── Brands (businesses) ────────────────────────────────────────────────
insert into public.businesses (id, slug, name, short_description, description, logo_url, cover_image_url, city, state, is_demo, publication_status, is_featured, market_area_id, geo_place_key)
select pg_temp.pid('biz:' || s), s, n, sd, sd, pg_temp.img(i), pg_temp.img(i), 'Jersey City', 'NJ', false, 'live', f, pg_temp.area(h), 'place:3436000'
from (values
  ('paulus-hook-provisions', 'Paulus Hook Provisions', 'Small-batch hot sauces and pickles from a Jersey City kitchen.', '1504674900247-0877df9cc836', 'paulus-hook', true),
  ('heights-flower-cart', 'Heights Flower Cart', 'A rolling flower cart with seasonal stems and bouquets.', '1490750967868-88aa4486c946', 'the-heights', true),
  ('pier-dumpling-co', 'Pier Dumpling Co.', 'Hand-folded dumplings at markets across the city.', '1496116218417-1a781b1c416c', 'journal-square', true),
  ('second-hand-stories', 'Second Hand Stories', 'Curated vintage denim, records and ceramics.', '1441986300917-64674bd600d8', 'journal-square', true),
  ('grove-st-ceramics', 'Grove St Ceramics', 'Wheel-thrown mugs and planters, made in Bergen-Lafayette.', '1565193566173-7a0ee3dbe261', 'bergen-lafayette', false),
  ('hudson-film-club', 'Hudson Film Club', 'Outdoor screenings and film nights along the waterfront.', '1489599849927-2ee91cede3ba', 'downtown', false)
) v(s, n, sd, i, h, f);

insert into public.business_markets (business_id, market_id, relationship, active)
select pg_temp.pid('biz:' || s), pg_temp.mkt(), 'primary', true
from unnest(array['paulus-hook-provisions','heights-flower-cart','pier-dumpling-co','second-hand-stories','grove-st-ceramics','hudson-film-club']) s;

insert into public.business_market_areas (business_id, market_id, market_area_id)
select b.id, pg_temp.mkt(), b.market_area_id from public.businesses b where b.id in (
  select pg_temp.pid('biz:' || s) from unnest(array['paulus-hook-provisions','heights-flower-cart','pier-dumpling-co','second-hand-stories','grove-st-ceramics','hudson-film-club']) s);

insert into public.business_categories (business_id, category_id)
select pg_temp.pid('biz:' || s), pg_temp.cat('business', c)
from (values ('paulus-hook-provisions','packaged-goods'),('heights-flower-cart','flowers'),('pier-dumpling-co','food-truck'),
             ('second-hand-stories','vintage-resale'),('grove-st-ceramics','makers-goods'),('hudson-film-club','experiences-entertainment')) v(s, c)
where pg_temp.cat('business', c) is not null;

-- ── Events + their dates ───────────────────────────────────────────────
-- (slug, name, img, day offset, start h, end h [null = date only], place,
--  area, event category, featured, tickets url, rsvp url, rsvp label,
--  external url, location visibility, description)
create temp table ev (s text, n text, i text, d int, sh int, eh int, loc text, h text, c text, f bool, tix text, rsvp text, rcta text, ext text, vis text, descr text);
insert into ev values
  ('sunset-sessions-on-the-pier','Sunset Sessions on the Pier','1459749411175-04bf5292ceea',0,17,21,'liberty-pier-lawn','downtown','live-music',true,null,'https://example.com/rsvp',null,null,'exact','Local bands, a skyline sunset and food trucks along the waterfront.'),
  ('heights-night-market','Heights Night Market','1488459716781-31db52582fe9',0,16,22,'riverview-park','the-heights','markets-pop-ups',false,null,null,null,'https://example.com/market','exact','Forty-plus local makers, dumplings, natural wine and a DJ under string lights.'),
  ('latte-art-throwdown','Latte Art Throwdown','1509042239860-f550ce710b93',1,19,22,'harbor-roast','paulus-hook','coffee-tea',false,'https://example.com/tickets',null,null,null,'exact','Baristas from across the city go head to head.'),
  ('first-friday-open-studios','First Friday Open Studios','1541701494587-cb58502866ab',greatest(pg_temp.sat()-1,2),18,22,'studio-on-monticello','bergen-lafayette','art-exhibitions',false,null,null,null,null,'exact','Open studios, prints and live drawing.'),
  ('vintage-flea-on-grove','Vintage Flea on Grove','1441986300917-64674bd600d8',pg_temp.sat(),10,16,'grove-street-plaza','downtown','vintage-resale',true,null,'https://example.com/flea','register',null,'exact','Racks of vintage denim, records, ceramics and film cameras. Every Saturday through the season.'),
  ('comedy-in-the-cellar','Comedy in the Cellar','1527224857830-43a7acc85260',pg_temp.sat()+1,20,22,'ninth-street-taproom','the-heights','comedy',false,'https://example.com/tickets',null,null,null,'exact','Stand-up in the taproom''s back room.'),
  ('waterfront-film-night','Waterfront Film Night','1489599849927-2ee91cede3ba',4,19,22,'liberty-pier-lawn','downtown','film-screenings',false,null,null,null,null,'exact','A classic on the big screen with the skyline behind it.'),
  ('natural-wine-tasting','Natural Wine Tasting','1510812431401-41d2bd2722f3',5,18,20,'lantern-and-salt','hamilton-park','tastings-drinks',false,'https://example.com/tickets',null,null,null,'exact','Six pours from small producers.'),
  ('harvest-weekend-on-newark-ave','Harvest Weekend on Newark Ave','1500530855697-b586d89ba3ee',pg_temp.sat(),null,null,null,'journal-square','local-festivals-street-fairs',false,null,null,null,null,'exact','A street fair weekend. Times vary by block.'),
  ('secret-supper-club','Secret Supper Club','1414235077428-338989a2e8c0',3,19,22,'lantern-and-salt','downtown','dining-experiences',false,null,'https://example.com/supper','register',null,'hidden','A five-course dinner at a location shared after registration.'),
  ('last-weeks-block-party','Last Week''s Block Party','1492684223066-81342ee5ff30',-6,12,18,'grove-street-plaza','downtown','local-festivals-street-fairs',false,null,null,null,null,'exact','Already happened. Must never appear as current.');

insert into public.events (id, slug, name, description, cover_image_url, start_at, end_at, start_date, venue_name, address, city, state, is_featured, is_demo, follow_enabled,
  rsvp_enabled, rsvp_url, rsvp_cta, tickets_enabled, tickets_url, external_url, market_id, market_area_id, publication_status, show_on_homepage, location_visibility, directions_enabled, geo_place_key)
select pg_temp.pid('ev:' || e.s), e.s, e.n, e.descr, pg_temp.img(e.i),
  case when e.sh is null then null else pg_temp.at(e.d, e.sh) end,
  case when e.eh is null then null else pg_temp.at(e.d, e.eh) end,
  pg_temp.day(e.d),
  case when e.vis = 'hidden' then null else coalesce(l.name, 'Newark Ave') end,
  case when e.vis = 'hidden' then null else l.address end,
  'Jersey City', 'NJ', e.f, false, true,
  e.rsvp is not null, e.rsvp, e.rcta, e.tix is not null, e.tix, e.ext,
  pg_temp.mkt(), pg_temp.area(e.h), 'live', true, e.vis, e.vis <> 'hidden', 'place:3436000'
from ev e left join public.locations l on l.slug = e.loc;

insert into public.event_occurrences (event_id, start_at, end_at, location_id, status, timezone, market_id, occurrence_date, venue_name, city, state)
select pg_temp.pid('ev:' || e.s),
  case when e.sh is null then null else pg_temp.at(e.d + w, e.sh) end,
  case when e.eh is null then null else pg_temp.at(e.d + w, e.eh) end,
  case when e.vis = 'hidden' then null else pg_temp.pid('loc:' || e.loc) end,
  'scheduled', 'America/New_York', pg_temp.mkt(), pg_temp.day(e.d + w),
  case when e.loc is null then 'Newark Ave' end, 'Jersey City', 'NJ'
from ev e
cross join lateral unnest(case when e.s = 'vintage-flea-on-grove' then array[-7, 0, 7, 14] else array[0] end) w;

insert into public.event_categories (event_id, category_id)
select pg_temp.pid('ev:' || s), pg_temp.cat('event', c) from ev where pg_temp.cat('event', c) is not null;

-- Brands taking part in events (Who You'll Find Here)
insert into public.event_businesses (event_id, business_id, status, featured, display_order)
select pg_temp.pid('ev:' || e), pg_temp.pid('biz:' || b), 'approved', f, o
from (values ('heights-night-market','pier-dumpling-co',true,1),('heights-night-market','heights-flower-cart',false,2),('heights-night-market','paulus-hook-provisions',false,3),
             ('vintage-flea-on-grove','second-hand-stories',true,1),('vintage-flea-on-grove','grove-st-ceramics',false,2),
             ('waterfront-film-night','hudson-film-club',true,1),('sunset-sessions-on-the-pier','pier-dumpling-co',false,1)) v(e, b, f, o);

-- ── Appearances (where brands will be next) ────────────────────────────
insert into public.appearances (business_id, title, description, start_at, end_at, venue_name, address, city, state, status, show_on_home, market_id, market_area_id, location_id, geo_place_key)
select pg_temp.pid('biz:' || b), t, null, pg_temp.at(d, sh), pg_temp.at(d, eh), l.name, l.address, 'Jersey City', 'NJ', 'confirmed', true, pg_temp.mkt(), l.market_area_id, l.id, 'place:3436000'
from (values ('heights-flower-cart','Flower Cart at Harbor Roast',1,9,13,'harbor-roast'),
             ('paulus-hook-provisions','Hot Sauce Tasting',2,17,20,'lantern-and-salt'),
             ('grove-st-ceramics','Mug Pop-Up',3,11,16,'pavonia-coffee-co'),
             ('pier-dumpling-co','Dumplings at the Taproom',pg_temp.sat(),18,22,'ninth-street-taproom'),
             ('second-hand-stories','Record Swap',6,12,17,'studio-on-monticello')) v(b, t, d, sh, eh, loc)
join public.locations l on l.slug = v.loc;

-- ── JerseyCity.guide editorial page (site discoveryPageSlug) ───────────
insert into public.discovery_pages (id, internal_name, title, slug, is_published, is_system, market_slug, area_slug, market_id, market_area_id)
values (pg_temp.pid('page:jc'), 'JerseyCity.guide Home', 'JerseyCity.guide', 'jerseycity-guide', true, false, 'north-jersey', 'jersey-city', pg_temp.mkt(), pg_temp.area('jersey-city'));

insert into public.homepage_rows (title, subtitle, content_type, mode, featured_only, item_limit, is_visible, sort_order, page_id, section_type)
values ('Jersey City Brands', 'Local makers and businesses worth knowing', 'businesses', 'dynamic', false, 10, true, 10, pg_temp.pid('page:jc'), 'feed');

-- ── Out-of-scope CONTROL rows (not Jersey City) ────────────────────────
-- Used to verify JerseyCity.guide never lists them and sends their detail
-- pages to Findmi; Findmi itself shows them normally.
create or replace function pg_temp.mkt2(s text) returns uuid language sql stable as $$ select id from public.markets where slug = s $$;
create or replace function pg_temp.area2(m text, s text) returns uuid language sql stable as $$
  select id from public.market_areas where market_id = pg_temp.mkt2(m) and slug = s $$;

insert into public.locations (id, name, slug, address, city, state, is_demo, market_id, market_area_id, description, cover_image_url, category_id, place_type)
values (pg_temp.pid('loc:control-brooklyn'), 'Control: Brooklyn Roastery', 'control-brooklyn-roastery', 'Bedford Ave', 'Brooklyn', 'NY', false,
        pg_temp.mkt2('nyc'), pg_temp.area2('nyc', 'brooklyn'), 'Out-of-scope control place.', pg_temp.img('1554118811-1e0d58224f24'), pg_temp.cat('location', 'cafe-coffee-shop'), 'venue'),
       (pg_temp.pid('loc:control-hoboken'), 'Control: Hoboken Hall', 'control-hoboken-hall', 'Washington St', 'Hoboken', 'NJ', false,
        pg_temp.mkt(), pg_temp.area('hoboken'), 'Out-of-scope control place (same Market, other Area).', pg_temp.img('1514933651103-005eec06c04b'), pg_temp.cat('location', 'event-venue'), 'venue');

insert into public.businesses (id, slug, name, short_description, logo_url, cover_image_url, city, state, is_demo, publication_status, is_featured)
values (pg_temp.pid('biz:control-brooklyn'), 'control-brooklyn-bakery', 'Control: Brooklyn Bakery', 'Out-of-scope control brand.', pg_temp.img('1509440159596-0249088772ff'), pg_temp.img('1509440159596-0249088772ff'), 'Brooklyn', 'NY', false, 'live', true);
insert into public.business_markets (business_id, market_id, relationship, active) values (pg_temp.pid('biz:control-brooklyn'), pg_temp.mkt2('nyc'), 'primary', true);
insert into public.business_market_areas (business_id, market_id, market_area_id) values (pg_temp.pid('biz:control-brooklyn'), pg_temp.mkt2('nyc'), pg_temp.area2('nyc', 'brooklyn'));

insert into public.events (id, slug, name, description, cover_image_url, start_at, end_at, start_date, venue_name, city, state, is_demo, publication_status, show_on_homepage, market_id, market_area_id, location_visibility, is_featured)
values (pg_temp.pid('ev:control-brooklyn'), 'control-brooklyn-market', 'Control: Brooklyn Market', 'Out-of-scope control event.', pg_temp.img('1488459716781-31db52582fe9'),
        pg_temp.at(1, 12), pg_temp.at(1, 17), pg_temp.day(1), 'Control: Brooklyn Roastery', 'Brooklyn', 'NY', false, 'live', true, pg_temp.mkt2('nyc'), pg_temp.area2('nyc', 'brooklyn'), 'exact', true),
       (pg_temp.pid('ev:control-hoboken'), 'control-hoboken-concert', 'Control: Hoboken Concert', 'Out-of-scope control event (same Market, other Area).', pg_temp.img('1459749411175-04bf5292ceea'),
        pg_temp.at(2, 19), pg_temp.at(2, 22), pg_temp.day(2), 'Control: Hoboken Hall', 'Hoboken', 'NJ', false, 'live', true, pg_temp.mkt(), pg_temp.area('hoboken'), 'exact', true);
insert into public.event_occurrences (event_id, start_at, end_at, location_id, status, timezone, market_id, occurrence_date)
values (pg_temp.pid('ev:control-brooklyn'), pg_temp.at(1, 12), pg_temp.at(1, 17), pg_temp.pid('loc:control-brooklyn'), 'scheduled', 'America/New_York', pg_temp.mkt2('nyc'), pg_temp.day(1)),
       (pg_temp.pid('ev:control-hoboken'), pg_temp.at(2, 19), pg_temp.at(2, 22), pg_temp.pid('loc:control-hoboken'), 'scheduled', 'America/New_York', pg_temp.mkt(), pg_temp.day(2));

-- ── Moments (shared Findmi Moments; JC shows the Jersey City ones) ─────
insert into auth.users (id, email) values (pg_temp.pid('user:preview'), 'preview@example.invalid');
insert into public.profiles (id, display_name, username) values (pg_temp.pid('user:preview'), 'Preview Member', 'previewmember');

insert into public.journal_entries (id, user_id, title, entry_date, notes, location_id, visibility, status)
values
  -- JC by Location
  (pg_temp.pid('moment:harbor'), pg_temp.pid('user:preview'), 'Cortado by the water', pg_temp.day(-2), 'Morning at Harbor Roast.', pg_temp.pid('loc:harbor-roast'), 'public', 'published'),
  -- JC by Event connection only (no Location on the Moment itself)
  (pg_temp.pid('moment:night-market'), pg_temp.pid('user:preview'), 'Night market haul', pg_temp.day(-1), 'Dumplings and flowers.', null, 'public', 'published'),
  -- JC by Event DATE connection only
  (pg_temp.pid('moment:flea'), pg_temp.pid('user:preview'), 'Found a 70s jacket', pg_temp.day(-7), null, null, 'public', 'published'),
  -- private JC Moment: must never appear publicly
  (pg_temp.pid('moment:private'), pg_temp.pid('user:preview'), 'Private: my notes', pg_temp.day(-1), null, pg_temp.pid('loc:pavonia-coffee-co'), 'private', 'published'),
  -- CONTROL: public, but in Brooklyn
  (pg_temp.pid('moment:control-brooklyn'), pg_temp.pid('user:preview'), 'Control: Brooklyn Moment', pg_temp.day(-1), null, pg_temp.pid('loc:control-brooklyn'), 'public', 'published'),
  -- CONTROL: public, connected to a JC Brand only (who, not where) — not JC
  (pg_temp.pid('moment:control-brand-only'), pg_temp.pid('user:preview'), 'Control: Brand-only Moment', pg_temp.day(-1), null, null, 'public', 'published');

insert into public.journal_entry_connections (journal_entry_id, business_id, event_id, event_occurrence_id)
select pg_temp.pid('moment:night-market'), null::uuid, pg_temp.pid('ev:heights-night-market'), null::uuid
union all
select pg_temp.pid('moment:flea'), null::uuid, null::uuid, (select id from public.event_occurrences where event_id = pg_temp.pid('ev:vintage-flea-on-grove') order by occurrence_date limit 1)
union all
select pg_temp.pid('moment:control-brand-only'), pg_temp.pid('biz:pier-dumpling-co'), null::uuid, null::uuid;

-- ── Lavazza-style brand: based elsewhere, appearing in Jersey City ─────
-- One brand record (NYC Market/Area) whose only JC link is a structured
-- Appearance at a JC Location — must be listed on JC and on Findmi.
insert into public.businesses (id, slug, name, short_description, logo_url, cover_image_url, city, state, is_demo, publication_status, is_featured)
values (pg_temp.pid('biz:visiting-roaster'), 'visiting-roaster', 'Visiting Roaster', 'An NYC coffee brand on tour.', pg_temp.img('1495474472287-4d71bcdd2085'), pg_temp.img('1495474472287-4d71bcdd2085'), 'New York', 'NY', false, 'live', false);
insert into public.business_markets (business_id, market_id, relationship, active) values (pg_temp.pid('biz:visiting-roaster'), pg_temp.mkt2('nyc'), 'primary', true);
insert into public.business_market_areas (business_id, market_id, market_area_id) values (pg_temp.pid('biz:visiting-roaster'), pg_temp.mkt2('nyc'), pg_temp.area2('nyc', 'brooklyn'));
insert into public.appearances (business_id, title, start_at, end_at, venue_name, city, state, status, show_on_home, market_id, location_id)
values (pg_temp.pid('biz:visiting-roaster'), 'Visiting Roaster at Harbor Roast', pg_temp.at(4, 9), pg_temp.at(4, 14), 'Harbor Roast', 'Jersey City', 'NJ', 'confirmed', true, pg_temp.mkt(), pg_temp.pid('loc:harbor-roast'));
