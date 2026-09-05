-- ============================================================================
-- Primary Market During Business Creation V1
--
-- Implementation follow-up to Markets Foundation V1. Makes Primary Market
-- selection a required part of native business creation, atomically, by
-- extending create_owned_business() (confirmed LIVE via Supabase MCP
-- before writing this migration — do not trust the "not applied yet"
-- comment header on that RPC's original local migration file) with one
-- new required parameter and one new insert into the same function body.
-- A SECURITY DEFINER plpgsql function's body runs as part of the calling
-- statement's own transaction: if any RAISE EXCEPTION fires (invalid
-- category, invalid/inactive market, etc.), every insert already made
-- inside this same call — business, category, owner membership, market —
-- rolls back together. This is the atomic creation the task asked for,
-- with no separate BEGIN/COMMIT needed and no risk of a partially-created
-- business.
--
-- 1. Widens business_markets_provenance_check to add 'self_selected' —
--    the provenance value for a business owner choosing their own Primary
--    Market through normal native creation (never 'admin', which stays
--    reserved for an admin manually assigning/correcting one later).
-- 2. Drops and recreates create_owned_business() with a new required
--    p_market_id parameter, validated to reference an ACTIVE market, and
--    inserts exactly one business_markets row (relationship='primary',
--    provenance='self_selected', active=true) in the same transaction as
--    the business/category/owner-membership inserts already there.
--    relationship/provenance/active are hardcoded inside the function —
--    never accepted as caller input — so a caller can only ever choose
--    WHICH market, never how it's categorized or how many.
-- ============================================================================

alter table public.business_markets drop constraint business_markets_provenance_check;
alter table public.business_markets add constraint business_markets_provenance_check
  check (provenance is null or provenance in ('paid', 'complimentary', 'promotional', 'admin', 'self_selected'));

drop function if exists public.create_owned_business(uuid, text, text, uuid, text, text, text, text);

create or replace function public.create_owned_business(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_category_id uuid,
  p_city text,
  p_state text,
  p_website_url text,
  p_instagram_url text,
  p_market_id uuid
)
returns businesses
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_business public.businesses;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug_required';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id and kind = 'business') then
    raise exception 'invalid_category';
  end if;
  if p_market_id is null then
    raise exception 'market_required';
  end if;
  if not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.businesses (
    name, slug, city, state, website_url, instagram_url,
    plan_tier, publication_status, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_website_url, '')), ''),
    nullif(btrim(coalesce(p_instagram_url, '')), ''),
    'free',
    'pending_review',
    false
  )
  returning * into v_business;

  -- Reuses the existing atomic category-set RPC rather than
  -- reimplementing its own delete-then-insert/validation — a category is
  -- always required at creation, so this always runs.
  perform public.set_business_category(v_business.id, p_category_id);

  insert into public.business_members (user_id, business_id, role)
  values (p_user_id, v_business.id, 'owner');

  -- market_limit for a brand-new business is always 1 (free/pro/pro_seller
  -- all resolve to 1 today — see getBusinessMarketLimit in
  -- lib/entitlements.ts) so exactly one primary row is always correct
  -- here; this RPC has no path that could ever insert a second one.
  insert into public.business_markets (business_id, market_id, relationship, provenance, active)
  values (v_business.id, p_market_id, 'primary', 'self_selected', true);

  return v_business;
end;
$function$;
