# Data Model

The entity ontology mapped to real production tables (verified against the
live schema on 2026-10-29). This is a map, not a full schema. For exact
columns, query the live database through Supabase MCP. Remember the
migration ledger is incomplete (see `DEPLOYMENT.md`).

## People and identity

| Concept | Tables | Notes |
| --- | --- | --- |
| Account | `auth.users` → `profiles` (+ `public_profiles` view) | Supabase Auth. `profiles` holds identity, phone and email verification |
| Handle / username | `handles` (+ `public_handles` view) | Shared registry for user and entity handles (`/[username]`) |
| People (public persons) | `people`, `business_people` | Founder-curated people pages (`/people`) |
| Page management | `business_members`, `location_members`, `event_members` | Who manages which Page. Ownership-transfer RPCs |
| Entitlements | `account_entitlements` | e.g. event-management entitlement |

## Core entities

| Entity | Table | Key relationships |
| --- | --- | --- |
| Business / Brand | `businesses` | One table. `plan_tier` (free/pro/pro_seller), `publication_status`, market/area, `public_field_status`, Stripe Connect readiness columns (unused) |
| Business images | `business_images` | Gallery |
| Location | `locations` | `parent_location_id` (place hierarchy), `place_type`, hours (`location_hours*`), geocode fields, `timezone`, market/area, Census `geo_*` keys, `featured_event_id`, `review_status`, lifecycle `archived_at`/`trashed_at` |
| Business ↔ Location (own sites) | `business_locations` | `is_primary`. "Our Locations" |
| Event | `events` | Primary Date `start_at`/`end_at` + `start_date`/`end_date`. `host_business_id`, `publication_status`, `location_visibility`, taxonomy, pricing/audience, CTA flags, lifecycle |
| Event Occurrence | `event_occurrences` | `event_id`, own `start_at`/`end_at`/`occurrence_date`/`all_day`/`timezone`, optional `location_id` or manual venue, `details`, URL overrides |
| Event participants | `event_businesses` (event-level: status, featured, offering_text, display_order, participation_scope), `event_occurrence_businesses` (per-date) | Official participation. Reconciled with Appearances |
| Appearance | `appearances` | `business_id` + optional `event_id` / `event_occurrence_id` / `location_id`, start/end, venue, market/area, `source`, `admin_reviewed_at`, `appearance_type_id` |
| Product | `products` | Business-owned. Marketplace fields, moderation status, lifecycle, taxonomy, `product_geographies`, `product_fulfillment_options` |
| Product sets | `business_product_sets`, `business_product_set_items` | Named groups used in Availability |
| Availability | `business_location_availability` (+ `_products`) | `relationships[]` ⊆ {stocked, sold, served, featured, sampled} (1–5), `status` pending/live/declined, `source` admin/business, `starts_on`/`ends_on`, external id, import batch |
| Placements (pipeline) | `business_location_placements` (+ `_activities`) | A Business's retail/placement pursuit at a Location (status, next action) |
| Targets | `business_targets` (+ `_activities`) | A Business's outreach targets (Business/Location/Event) with intents and status |
| Event products | `event_products` | Featured products at an Event |

## Geography and taxonomy

- `markets` → `market_areas` (Areas, with images). `business_markets` and
  `business_market_areas` for footprint. `market_requests` /
  `market_request_interests` for demand.
- Census: `census_geographies`, `census_geography_links`,
  `census_imports`. Entities carry `geo_place_key` / `geo_zcta_key` /
  `geo_state_key` / `geo_resolution`.
- Taxonomy v1: `categories`, `business_categories` (+ assignments),
  `event_categories`, `event_formats`, `location_categories`,
  `product_categories`, `topics` (+ `*_topics`).
- Taxonomy v2: `taxonomy_terms`, `category_tree_v2`, `taxonomy_aliases`,
  `taxonomy_legacy_mappings`, `attribute_definitions`,
  `classification_suggestions`, `classification_field_sources`.

## Moments

| Table | Purpose |
| --- | --- |
| `journal_entries` | A Moment: author `user_id` (or `author_business_id` / `author_label`), `entry_date`/`time`, `location_id` or manual location, `visibility`, `status` (draft/published) |
| `journal_entry_media` | Ordered photos |
| `journal_entry_sections` | Sections: experience ("The Experience"), place ("The Place"), food_drink, products, people, details, favorites, other |
| `journal_entry_connections` | Links to Business / Product / Event / Occurrence |
| `entity_moment_display` | Per-entity Moment display curation |

## Consumer relationships

| Concept | Table(s) |
| --- | --- |
| Follow (account) | `account_followed_businesses`, `account_followed_events`, `account_followed_locations` |
| Follow (legacy email/phone) | `followers`, `event_followers`, `location_followers` (legacy. RPCs revoked) |
| Save (bookmark) | `account_saved_businesses / events / locations / products` |
| Want (product) | `product_wants` (account or email, soft-removed) |
| Mark As relationships | `user_entity_relationships` (`relation` ∈ want, must_do, like, dislike, been, have. `entity_type` ∈ event, business, location, product, topic, area) |
| Collections | `user_collections`, `user_collection_items` (polymorphic, private) |
| Signed-out fallback | Device-local lists (`lib/saved.ts`, `lib/followed*.ts`) imported to the account on sign-in |

## Commerce and billing

`orders`, `order_items` (fee snapshots), `vendor_order_allocations`
(held), `settlement_payments`, `settlement_payment_allocations`, `refunds`,
`stripe_customers`. Plans: `membership_plans`, `memberships`,
`membership_markets`, `plan_market_limits`, `business_subscriptions`,
`billing_sync_anomalies`, `pro_invites`, `pro_invite_redemptions`,
`business_pro_access_requests`. Referrals: `referral_*`. Claims:
`business_claim_requests`, `event_claim_requests`,
`location_claim_requests`.

## Communication

`conversations`, `conversation_participants`, `conversation_messages`,
`conversation_blocks`. `inquiries` + `inquiry_messages` (customer → Business).
`commercial_inquiries` (commercial requests routed through Findmi).
`sales_inquiries`. Direct org-to-org messaging is behind
`DIRECT_BUSINESS_MESSAGING_ENABLED`.

## Opportunities and growth

`opportunities`, `opportunity_recipients` (threads), `opportunity_listings`,
`opportunity_options` + `opportunity_option_components` (commercial terms),
`opportunity_ideas` (+ `_businesses`, `_responses`),
`business_opportunity_goals`. Brand intelligence: `brand_audits` (+
answers/markets), `business_intelligence_notes`, `admin_intelligence_reviews`.

## Measurement, QR, provenance, trust

- `analytics_events`: one row per tracked event, with subject + entity FKs,
  page/placement, session/user, UTM, `qr_campaign_id`, acquisition fields
  and discovery page/section/topic. See `ANALYTICS.md`.
- `qr_campaigns`: `code`, owner `business_id`, destination
  (`destination_type`/`destination_id`/`destination_url`/`destination_path`),
  optional event/occurrence/appearance/location/product, placement, label,
  status.
- `entity_provenance`: import source/method (service-role only).
- `access_events`, `admin_audit_events`: audit trails.
- Trust/privacy: `content_reports`, `privacy_requests`,
  `privacy_preferences`, `legal_acceptances`.

## Site configuration (founder-curated)

`homepage_rows` (with `config`), `homepage_bulletins`, `discovery_lanes`,
`discovery_pages` (Guides), `discovery_topics`, `nav_items`,
`site_sections`, `forms` / `form_assignments`, `media_variants`.

## Imports

`brand_import_batches` / `_candidates`, `location_import_batches` /
`_rows`. Availability rows carry `import_batch_id`.

## Activations / BD

`activations`, `activation_options`, `activation_inventory`,
`activation_venues`. The BD CRM uses `bd_*` modules (see
`BUSINESS_DEVELOPMENT_HANDOFF.md`).

## Rules

- Multi-date = Occurrences, never duplicate Events.
- A Business at an Event = Appearance and/or `event_businesses`, never a
  duplicate Business or Event.
- A product or brand "available here" = Availability, never a free-text
  profile field.
- An Event at a real Location references `location_id`. Its public page
  links to the Location page.
