-- ============================================================================
-- Product Marketplace Distribution — Foundation
--
-- CONTENT moderation (products.moderation_status/pending_changes, see the
-- product_moderation_workflow pass) is untouched by this migration and
-- stays the sole gate on whether a Product's content is approved at all.
-- This adds a second, fully independent axis: whether an approved Product
-- may ALSO appear in broader FindMi Marketplace/discovery surfaces (the
-- homepage, /marketplace, event product carousels), separate from its own
-- business profile/storefront, which a Product with moderation_status='live'
-- and is_active=true remains visible on regardless of this column.
--
-- marketplace_status:
--   catalog_only — default. Business-profile/storefront/direct-URL visible
--     once approved; never enters broader Marketplace/discovery surfaces.
--   submitted    — owner requested Marketplace consideration; awaiting an
--     admin decision. Still catalog-visible only until approved.
--   approved     — admin granted broader Marketplace/discovery visibility.
--     Takes effect only once moderation_status='live' AND is_active=true —
--     enforced at the application query layer (see lib/data.ts), not by
--     this column or any RLS policy alone.
--   rejected     — admin declined Marketplace placement. Stays fully
--     visible on the business's own profile/storefront; excluded only from
--     broader Marketplace/discovery surfaces.
--   paused       — admin temporarily withdrew Marketplace visibility
--     without rejecting the submission outright. Same catalog-visibility
--     as rejected; resuming restores 'approved' without a new review.
--
-- Existing rows default/backfill to 'catalog_only' via the column DEFAULT
-- below — additive, single metadata-only ALTER, no full table rewrite.
-- No existing Product is assumed Marketplace-approved just because it
-- pre-dates this feature.
-- ============================================================================

alter table public.products
  add column if not exists marketplace_status text not null default 'catalog_only'
    check (marketplace_status in ('catalog_only', 'submitted', 'approved', 'rejected', 'paused')),
  add column if not exists marketplace_submitted_at timestamptz,
  add column if not exists marketplace_approved_at timestamptz;

-- Anon/authenticated need to FILTER on marketplace_status themselves — the
-- broader Marketplace/discovery read functions (getMarketplaceProducts,
-- getFeaturedProducts, getHomepageRowProducts, getProductsByIds,
-- getEventProducts) add an explicit .eq("marketplace_status","approved")
-- query filter, which requires column-level SELECT privilege the same way
-- an explicit .eq("is_active", true) does. Business-catalog/direct-product-
-- page reads (getProductsForBusiness, getProductBySlug) never filter on it,
-- so a catalog_only product stays fully visible there regardless of this
-- grant. Deliberately additive to the existing column-level grant (see
-- restrict_internal_commerce_columns) rather than a full re-grant — Postgres
-- column privileges accumulate per grant statement.
--
-- Timestamps are NOT granted — no public query needs them, same precedent
-- as marketplace_fee_override_percent staying ungranted.
grant select (marketplace_status) on public.products to anon, authenticated;
