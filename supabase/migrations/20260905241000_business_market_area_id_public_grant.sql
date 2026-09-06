-- Market -> Area/Submarket Hierarchy V2 — businesses.market_area_id needs
-- an anon/authenticated SELECT grant to participate in a WHERE filter at
-- all (Security Pass 1 replaced businesses' table-level SELECT with an
-- explicit per-column allow-list — see lib/data.ts's PUBLIC_BUSINESS_COLUMNS
-- comment). Read-only: SELECT only, never INSERT/UPDATE — anon has no
-- legitimate path to write this column, and RLS still governs row access
-- regardless of this grant.
grant select (market_area_id) on public.businesses to anon, authenticated;
