-- ============================================================================
-- Native Free Business Creation — atomic create_owned_business() RPC
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Native Business Onboarding, Pass 2. Lets an authenticated FindMi user
-- create a brand-new business and become its owner in one atomic step —
-- the businesses row + its business_categories row + the creator's own
-- business_members owner row either all commit together or none do,
-- exactly the same "one Postgres function, one implicit transaction"
-- pattern this codebase already uses for approve_business_claim() and
-- set_business_category() (reused directly below rather than
-- reimplemented).
--
-- plan_tier and publication_status are NOT parameters — they're hardcoded
-- 'free' / 'pending_review' inside the function body, so there is no
-- client-controlled path to create an already-Pro or already-live
-- business. p_user_id is expected to already be the caller's own
-- session-derived identity (getServerSupabase().auth.getUser(), read by
-- the calling Server Action BEFORE this RPC is ever invoked, via the
-- service-role client — the same authorize-then-elevate shape every
-- other member action in this codebase already uses) — never a
-- client-supplied form field.
--
-- category kind validated here too (not just app-side), same defense-in-
-- depth set_business_category() already documents for its own p_category_id.
-- ============================================================================

create or replace function public.create_owned_business(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_category_id uuid,
  p_city text,
  p_state text,
  p_website_url text,
  p_instagram_url text
)
returns public.businesses
language plpgsql
security definer
set search_path = ''
as $$
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

  return v_business;
end;
$$;

revoke execute on function public.create_owned_business(uuid, text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_owned_business(uuid, text, text, uuid, text, text, text, text) to service_role;
