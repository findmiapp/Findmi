-- VCL A2b — Optional Business geography.
--
-- A Business does not require geography: "No geography is better than false
-- geography." The only database invariant that required one was
-- create_owned_business()'s `market_required` raise. This replaces that one
-- function with the smallest change:
--   * a valid p_market_id      → business_markets primary row (unchanged)
--   * a non-blank requested text → market_requests row (unchanged)
--   * neither                  → the Business alone (no Market, no request)
-- Every other check (user/name/slug/category, market_choice_ambiguous,
-- invalid_market), the insert, publication_status = 'pending_review',
-- category, owner membership, SECURITY DEFINER, search_path and grants are
-- unchanged. No table, column, row or Market is added or modified.

CREATE OR REPLACE FUNCTION public.create_owned_business(p_user_id uuid, p_name text, p_slug text, p_category_id uuid, p_city text, p_state text, p_website_url text, p_instagram_url text, p_market_id uuid, p_requested_market_text text DEFAULT NULL::text)
 RETURNS businesses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_business public.businesses;
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'name_required'; end if;
  if p_slug is null or btrim(p_slug) = '' then raise exception 'slug_required'; end if;
  if not exists (select 1 from public.categories where id = p_category_id and kind = 'business') then raise exception 'invalid_category'; end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then raise exception 'market_choice_ambiguous'; end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then raise exception 'invalid_market'; end if;
  insert into public.businesses (name, slug, city, state, website_url, instagram_url, plan_tier, publication_status, is_demo)
  values (btrim(p_name), btrim(p_slug), nullif(btrim(coalesce(p_city,'')),''), nullif(btrim(coalesce(p_state,'')),''), nullif(btrim(coalesce(p_website_url,'')),''), nullif(btrim(coalesce(p_instagram_url,'')),''), 'free', 'pending_review', false)
  returning * into v_business;
  perform public.set_business_category(v_business.id, p_category_id);
  insert into public.business_members (user_id, business_id, role) values (p_user_id, v_business.id, 'owner');
  if p_market_id is not null then
    insert into public.business_markets (business_id, market_id, relationship, provenance, active) values (v_business.id, p_market_id, 'primary', 'self_selected', true);
  elsif p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    insert into public.market_requests (requested_text, city, state, normalized_key, requester_user_id, source, source_business_id)
    values (btrim(p_requested_market_text), nullif(btrim(coalesce(p_city,'')),''), nullif(btrim(coalesce(p_state,'')),''), lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')), p_user_id, 'business_creation', v_business.id);
  end if;
  return v_business;
end; $function$;
