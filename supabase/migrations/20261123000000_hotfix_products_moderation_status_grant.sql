-- ============================================================================
-- Hotfix — public read of products.moderation_status
--
-- The consolidation pass (20261121000000) made public Product reads select /
-- filter on products.moderation_status (getProductBySlug selects it; the
-- Marketplace filter applies .eq('moderation_status','live')). anon /
-- authenticated never had a column-level SELECT grant on it (see
-- restrict_internal_commerce_columns / product_marketplace_distribution for
-- the column-grant model), so PostgREST refused every such query with 42501
-- "permission denied for table products": every /product/[slug] 404'd and
-- Marketplace / homepage Product rows came back empty.
--
-- Additive and safe: the "Public read active products" RLS policy already
-- limits public rows to moderation_status = 'live', so the only value a
-- public reader can ever see is 'live'. No row, policy or other grant
-- changes. Applied to production 2026-10-28 (authorized hotfix).
-- ============================================================================

grant select (moderation_status) on public.products to anon, authenticated;
