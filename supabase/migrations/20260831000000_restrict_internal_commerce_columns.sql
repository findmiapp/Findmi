-- Security Pass 1 — restrict public/anon access to internal-only commerce
-- columns on businesses and products.
--
-- Both tables already carry a public SELECT RLS policy ("Public read
-- businesses" / "Public read active products" — row-level: every visible
-- row is fully visible). RLS restricts ROWS, not COLUMNS. Supabase's
-- default schema setup additionally grants full table-level SELECT to
-- anon/authenticated on every table, so a direct REST call using only the
-- public anon key (e.g. GET /rest/v1/businesses?select=*) could read every
-- column — including internal-only fields the app UI never shows.
--
-- IMPORTANT: this is why a bare `revoke select (column) ...` would NOT
-- have been sufficient on its own — both tables already hold a table-level
-- SELECT grant for anon/authenticated, and in Postgres a table-level ACL
-- takes precedence over any column-level revoke layered on top of it. The
-- table-level grant has to be revoked first, then replaced with an
-- explicit column-level grant. This matches Supabase's documented pattern
-- for hiding specific columns from the REST API while leaving RLS
-- row-level behavior untouched.
--
-- service_role is not touched by this migration — it bypasses RLS and
-- table/column grants entirely (Supabase's standard service-role setup),
-- so all admin Server Actions/Server Components (which exclusively use
-- getAdminSupabase()) are unaffected.
--
-- Public-safe column lists below are the union of every column actually
-- selected by the public app's anon-client reads (src/lib/data.ts,
-- src/app/(public)/saved/page.tsx, src/app/sitemap.ts). The one anon-client
-- reader that legitimately needed the fee/payer columns being restricted
-- here — src/lib/commerce/quote.ts's computeOrderDraft() — was switched in
-- this same pass to the service-role client (it already only ever runs
-- server-side, in "use server" Server Actions).

-- ── businesses ──────────────────────────────────────────────────────────
revoke select on public.businesses from anon, authenticated;

grant select (
  id, slug, name, short_description, description, logo_url, cover_image_url,
  website_url, instagram_url, facebook_url, tiktok_url, email, phone, city,
  state, country, service_radius_miles, verified, founding_member,
  membership_status, created_at, updated_at, is_demo, commerce_enabled,
  publication_status, is_featured, inquiry_cta_label, inquiry_cta_url,
  cta_1_label, cta_1_url, cta_1_enabled, cta_2_label, cta_2_url,
  cta_2_enabled, cta_3_label, cta_3_url, cta_3_enabled, bulletin_enabled,
  bulletin_heading, bulletin_body, bulletin_label, bulletin_url
) on public.businesses to anon, authenticated;

-- Intentionally NOT granted to anon/authenticated (internal-only):
--   lead_status, marketplace_fee_percent, processing_fee_payer,
--   payout_method, stripe_account_id, stripe_connect_status

-- ── products ────────────────────────────────────────────────────────────
revoke select on public.products from anon, authenticated;

grant select (
  id, business_id, name, slug, description, image_url, price, price_label,
  product_type, external_purchase_url, is_featured, is_active, purchasable,
  inventory_status, home_sort_order, profile_sort_order
) on public.products to anon, authenticated;

-- Intentionally NOT granted to anon/authenticated (internal-only):
--   marketplace_fee_override_percent, processing_fee_payer_override
