-- Admin Content Lifecycle V1/V2 hotfix — businesses and products both use
-- an explicit column-level SELECT allowlist for anon/authenticated (see
-- 20260831192751_restrict_internal_commerce_columns.sql's "narrow the
-- table-level grant to an explicit column list" pattern), unlike events/
-- locations which still carry a blanket table-level grant. archived_at/
-- trashed_at were added to businesses (V2) and products (V1) without ever
-- being added to that allowlist, so their public RLS policies — which
-- both directly reference these columns, and (for products, via the new
-- V2 "Hide products of archived or trashed businesses" policy) reference
-- businesses.archived_at/trashed_at in a subquery — cannot evaluate for
-- anon/authenticated at all. Every public SELECT on products has been
-- failing outright with `permission denied for table businesses` since
-- V1's deploy (fc7d51a), and the same would break businesses' own public
-- reads once V2 ships. Purely additive: grants two already-public,
-- non-sensitive timestamp columns; does not touch the internal-only
-- exclusions (lead_status, marketplace_fee_percent, etc.) from the
-- original migration.
grant select (archived_at, trashed_at) on public.businesses to anon, authenticated;
grant select (archived_at, trashed_at) on public.products to anon, authenticated;
