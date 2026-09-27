-- Free Tier Entitlement Reset V1 — "FREE CREATES AND DISTRIBUTES" now
-- includes relevant Markets with no plan-based ceiling. plan_market_limits
-- itself (table/columns/RLS) is untouched — this only updates its
-- existing Free-tier configuration row from a numeric ceiling to
-- Unlimited (NULL), the same convention every other tier already uses
-- for "no limit" (see the table's own migration comment). Pro/Pro Seller
-- were already NULL/Unlimited and are untouched. This was previously a
-- founder-set value of 5, set via /admin/plans (not migration-tracked);
-- recorded here as a proper migration going forward per this reset's own
-- "safest canonical mechanism, not an ad hoc production-only UPDATE"
-- requirement.
update public.plan_market_limits
set market_limit = null, updated_at = now()
where plan_tier = 'free';
