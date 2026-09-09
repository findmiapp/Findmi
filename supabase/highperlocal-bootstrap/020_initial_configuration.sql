-- ============================================================================
-- Highperlocal Bootstrap — 020_initial_configuration.sql
--
-- TARGET: ewwctvowukrwqzuqfttq (Highperlocal) ONLY. Part of the documented
-- Highperlocal bootstrap process in this directory — runs strictly AFTER
-- 000_current_schema.sql, ../migrations/20260908200000_highperlocal_
-- location_classification_and_manual_review.sql, and 010_grant_corrections.sql
-- (see this directory's README.md for the full sequencing/safety statement,
-- which applies equally to this file). Never apply to FindMi production
-- (drcbrzwchlirfspjgtik) — this is Highperlocal-specific configuration
-- content, not a schema change, and would insert Highperlocal branding into
-- FindMi's real production rows if ever misapplied there.
--
-- WHAT THIS FILE IS: application/configuration seed data only — categories,
-- markets, market_areas, plan_market_limits, membership_plans, nav_items,
-- homepage_rows, site_sections. It creates ZERO users, businesses, locations,
-- events, appearances, products, orders, payments, referrals, or invites.
-- No Stripe identifiers appear anywhere in this file (checkout stays
-- disabled deployment-wide via siteConfig.commerceEnabled === false for the
-- highperlocal brand — see src/lib/site-config.ts — independent of anything
-- seeded here).
--
-- IDEMPOTENCY: every statement is safe to re-run.
--   - categories / markets / membership_plans / plan_market_limits use
--     `insert ... on conflict (<real unique constraint>) do update`.
--   - market_areas uses the same pattern, resolving market_id by the
--     parent market's own slug (already upserted above it in this file).
--   - nav_items / homepage_rows have no natural unique text key in the
--     existing schema (id is a generated uuid), so each row uses
--     `insert ... select ... where not exists (...)` keyed on a stable
--     value (label / title) — rerunning this file finds the existing row
--     and inserts nothing new.
--   - site_sections uses its real `(page_key, section_key)` unique
--     constraint.
--
-- SKIPPED IN THIS PASS (see the Pass 5 report for the full reasoning):
--   - `forms` — every reader in src/lib/forms.ts / src/lib/tally.ts already
--     degrades gracefully to a hidden CTA when no row and no env var is
--     configured (verified by reading the actual resolver code, not
--     assumed). Seeding a row would require a real Tally form_url
--     (NOT NULL, no default) — no such URL exists for Highperlocal yet, and
--     inventing one would be a fabricated, dead external link. Nothing on
--     any existing route requires a `forms` row to render.
--   - Pro / Pro Seller `membership_plans` rows — plan_tier entitlement
--     (free/pro/pro_seller) lives entirely on businesses.plan_tier (column
--     default 'free', enforced independently of this table), so native
--     profile creation needs no membership_plans row at all; the *Free*
--     row below is seeded anyway per this pass's explicit instruction, but
--     Pro/Pro Seller rows would need an invented annual_price with nothing
--     in the current application requiring their existence yet.
-- ============================================================================

-- ── Markets — active, consumer-visible launch markets ─────────────────────
insert into public.markets (name, slug, display_name, description, areas_included, active, consumer_visible, sort_order)
values
  (
    'New York City',
    'new-york-city',
    'New York City',
    'The five NYC boroughs.',
    array['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'],
    true,
    true,
    10
  ),
  (
    'New Jersey',
    'new-jersey',
    'New Jersey',
    'Statewide, organized into North, Central, and South Jersey regions.',
    array['North Jersey', 'Central Jersey', 'South Jersey'],
    true,
    true,
    20
  )
on conflict (slug) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  description = excluded.description,
  areas_included = excluded.areas_included,
  active = excluded.active,
  consumer_visible = excluded.consumer_visible,
  sort_order = excluded.sort_order;

-- ── Market areas — NYC boroughs ────────────────────────────────────────────
insert into public.market_areas (market_id, name, slug, display_name, active, consumer_visible, sort_order)
select m.id, v.name, v.slug, v.name, true, true, v.sort_order
from (values
  ('Manhattan', 'manhattan', 10),
  ('Brooklyn', 'brooklyn', 20),
  ('Queens', 'queens', 30),
  ('The Bronx', 'the-bronx', 40),
  ('Staten Island', 'staten-island', 50)
) as v(name, slug, sort_order)
join public.markets m on m.slug = 'new-york-city'
on conflict (market_id, slug) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  active = excluded.active,
  consumer_visible = excluded.consumer_visible,
  sort_order = excluded.sort_order;

-- ── Market areas — New Jersey practical statewide regions ─────────────────
insert into public.market_areas (market_id, name, slug, display_name, active, consumer_visible, sort_order)
select m.id, v.name, v.slug, v.name, true, true, v.sort_order
from (values
  ('North Jersey', 'north-jersey', 10),
  ('Central Jersey', 'central-jersey', 20),
  ('South Jersey', 'south-jersey', 30)
) as v(name, slug, sort_order)
join public.markets m on m.slug = 'new-jersey'
on conflict (market_id, slug) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  active = excluded.active,
  consumer_visible = excluded.consumer_visible,
  sort_order = excluded.sort_order;

-- ── Categories — business/profile (kind='business') ───────────────────────
insert into public.categories (name, slug, kind, show_on_home, home_sort_order, parent_id)
values
  ('Cannabis Brands', 'cannabis-brands', 'business', false, null, null),
  ('Dispensaries', 'dispensaries', 'business', false, null, null),
  ('Hemp & CBD Brands', 'hemp-cbd-brands', 'business', false, null, null),
  ('Hemp Stores', 'hemp-stores', 'business', false, null, null),
  ('Accessories & Lifestyle', 'accessories-lifestyle', 'business', false, null, null),
  ('Cannabis Services', 'cannabis-services', 'business', false, null, null),
  ('Education & Advocacy', 'education-advocacy', 'business', false, null, null),
  ('Media & Community', 'media-community', 'business', false, null, null)
on conflict (kind, slug) do update set name = excluded.name;

-- ── Categories — event/activation (kind='event') ───────────────────────────
insert into public.categories (name, slug, kind, show_on_home, home_sort_order, parent_id)
values
  ('In-Store Activation', 'in-store-activation', 'event', false, null, null),
  ('Brand Pop-Up', 'brand-pop-up', 'event', false, null, null),
  ('Product Launch', 'product-launch', 'event', false, null, null),
  ('Sampling & Demo', 'sampling-demo', 'event', false, null, null),
  ('Educational Event', 'educational-event', 'event', false, null, null),
  ('Community Event', 'community-event', 'event', false, null, null),
  ('Festival & Expo', 'festival-expo', 'event', false, null, null),
  ('Wellness Event', 'wellness-event', 'event', false, null, null),
  ('Industry Event', 'industry-event', 'event', false, null, null),
  ('Other', 'other', 'event', false, null, null)
on conflict (kind, slug) do update set name = excluded.name;

-- ── Categories — product showcase (kind='product') ─────────────────────────
insert into public.categories (name, slug, kind, show_on_home, home_sort_order, parent_id)
values
  ('Flower', 'flower', 'product', false, null, null),
  ('Pre-Rolls', 'pre-rolls', 'product', false, null, null),
  ('Edibles', 'edibles', 'product', false, null, null),
  ('Beverages', 'beverages', 'product', false, null, null),
  ('Vapes', 'vapes', 'product', false, null, null),
  ('Concentrates', 'concentrates', 'product', false, null, null),
  ('Tinctures & Capsules', 'tinctures-capsules', 'product', false, null, null),
  ('Topicals', 'topicals', 'product', false, null, null),
  ('CBD & Hemp', 'cbd-hemp', 'product', false, null, null),
  ('Accessories', 'accessories', 'product', false, null, null)
on conflict (kind, slug) do update set name = excluded.name;

-- ── Navigation — real, existing PUBLIC_ROUTES only (src/lib/public-routes.ts) ──
-- "Activations" points at route_key 'find' (/find, "Findmi Here" — FindMi's
-- existing appearances-based, temporal feed) since no separate /activations
-- route exists; it is the real existing route that matches "where brands
-- will be next." "Products" points at route_key 'marketplace' (/marketplace).
-- No dispensary-directory nav item is created — no such route exists yet
-- (only /businesses filtered by category via query string); flagged in the
-- Pass 5 report for a later implementation pass rather than invented here.
insert into public.nav_items (label, destination_type, route_key, custom_href, group_label, icon_key, is_visible, is_highlight, sort_order, parent_id)
select v.label, 'route', v.route_key, null, null, v.icon_key, true, false, v.sort_order, null
from (values
  ('Discover', 'discover', 'compass', 10),
  ('Activations', 'find', 'calendar', 20),
  ('Brands', 'businesses', 'storefront', 30),
  ('Products', 'marketplace', 'tag', 40),
  ('Account', 'you', 'person', 50)
) as v(label, route_key, icon_key, sort_order)
where not exists (
  select 1 from public.nav_items existing
  where existing.label = v.label and existing.parent_id is null
);

-- ── Homepage rows — supported content types only (src/lib/homepage-rows.ts) ──
-- Unfiltered (category_slug null) on every row: Highperlocal has zero
-- events/businesses/products today, so an unfiltered dynamic row is the
-- correct "ready for content" state — every resolver in
-- resolveHomepageRowItems() already returns [] gracefully on an empty
-- table (verified by reading getHomepageRowBusinesses / getEventsDiscovery /
-- getHomepageRowProducts directly), so these rows render an empty section,
-- never an error, until real content exists.
insert into public.homepage_rows (title, subtitle, content_type, mode, category_slug, featured_only, time_window, item_limit, curated_ids, is_visible, sort_order)
select v.title, v.subtitle, v.content_type, 'dynamic', null, v.featured_only, v.time_window, 8, '{}', true, v.sort_order
from (values
  ('Upcoming Activations', 'Pop-ups, activations, and events coming up', 'events', false, 'anytime', 10),
  ('Brands on the Move', 'Mobile brands that come to you', 'businesses', false, null, 20),
  ('Featured Brands', 'Discover brands on Highperlocal', 'businesses', true, null, 30),
  ('Products to Discover', 'Real products from Highperlocal brands', 'products', false, null, 40)
) as v(title, subtitle, content_type, featured_only, time_window, sort_order)
where not exists (
  select 1 from public.homepage_rows existing where existing.title = v.title
);

-- ── Site copy — concise, temporary, activation-focused (no purchase claims,
--    never "cannabis marketplace") ──────────────────────────────────────────
insert into public.site_sections (page_key, section_key, eyebrow, heading, body, cta_label, cta_url, is_visible, sort_order, config_json)
values
  (
    'homepage', 'hero',
    null,
    E'Brand activations,\npop-ups, and events —\nwherever they show up next.',
    'Discover cannabis and hemp brand activations, pop-ups, and events — and always know where they''ll be next.',
    null, null, true, 0, '{}'
  ),
  (
    'homepage', 'featured_events',
    null,
    'Upcoming Activations Near You',
    'Pop-ups, activations, and events coming up',
    'View all', '/events', true, 20, '{}'
  ),
  (
    'homepage', 'findmi_here',
    null,
    'See Where Brands Are Next',
    'Follow the brands you love and know exactly where they''ll be showing up',
    'View all', '/find', true, 40, '{}'
  ),
  (
    'homepage', 'findmi_for_business',
    'Highperlocal For Brands',
    'Manage your activation schedule, nationwide.',
    'Highperlocal gives your brand one place to post activations, pop-ups, and events — and helps people find you wherever you show up next.',
    'Get Started', '/join', true, 80, '{}'
  ),
  (
    'homepage', 'closing_cta',
    'Now Onboarding Brands',
    E'Get discovered.\nGet found.\nWherever you go.',
    'List your brand, post activations and pop-ups, and let people know where you''ll be next.',
    'Join Highperlocal', '/join', true, 110, '{}'
  )
on conflict (page_key, section_key) do update set
  eyebrow = excluded.eyebrow,
  heading = excluded.heading,
  body = excluded.body,
  cta_label = excluded.cta_label,
  cta_url = excluded.cta_url,
  is_visible = excluded.is_visible,
  sort_order = excluded.sort_order;

-- ── Membership plans — Free only (usable default for native profile
--    creation); Pro/Pro Seller intentionally not seeded, see header note ──
insert into public.membership_plans (name, slug, annual_price, active, publicly_available, market_limit, description, sort_order, featured_placement_eligible, enhanced_profile, campaign_eligible)
values (
  'Free', 'free', 0, true, true, 1,
  'Create a Highperlocal profile at no cost.',
  0, false, false, false
)
on conflict (slug) do update set
  name = excluded.name,
  annual_price = excluded.annual_price,
  active = excluded.active,
  publicly_available = excluded.publicly_available,
  market_limit = excluded.market_limit,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- ── Plan-market allowances — at least one market for Free; expandable
--    (unlimited, founder-adjustable) allowance for manually activated paid
--    tiers, matching src/lib/entitlements.ts's null === Unlimited convention
insert into public.plan_market_limits (plan_tier, market_limit)
values
  ('free', 1),
  ('pro', null),
  ('pro_seller', null)
on conflict (plan_tier) do update set market_limit = excluded.market_limit;
