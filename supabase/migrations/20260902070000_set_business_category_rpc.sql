-- ============================================================================
-- Owner Business Mutation — category replacement atomicity fix.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- updateMemberBusiness (src/app/(public)/account/business/actions.ts)
-- replaced a business's category by issuing a DELETE on
-- business_categories followed by a separate INSERT — two independent
-- Supabase requests, not one transaction. If the DELETE succeeded but the
-- INSERT then failed (a transient error, a bad category_id slipping past
-- the app-layer check, etc.), the business would be left with ZERO
-- categories instead of its previous one — a real, if narrow, data-loss
-- window.
--
-- Fixed the same way this codebase already solves every other
-- delete+insert (or multi-write) mutation that must not be allowed to
-- partially apply — see ownership_transfer_rpcs.sql's own note on exactly
-- this problem for business_members/event_members ownership changes: one
-- Postgres function, called as a single request, so Postgres's own
-- implicit per-statement transaction makes the whole body atomic — any
-- exception (including the invalid-category guard below) rolls back
-- everything the function did, including the DELETE, leaving the
-- business's previous category relationship exactly as it was.
--
-- Same SECURITY DEFINER / search_path = '' / service_role-only convention
-- as every other RPC in this codebase (transfer_business_ownership etc.)
-- — callable exclusively from updateMemberBusiness's already-authorized
-- service-role client (getAdminSupabase(), reached only after
-- requireBusinessMember() has verified real business_members access),
-- never directly from anon/authenticated.
-- ============================================================================

create or replace function public.set_business_category(
  p_business_id uuid,
  p_category_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Re-validated here too, not just in the calling Server Action — a real
  -- business-kind category, checked at the same layer that performs the
  -- write, so this function is safe to call on its own and never relies
  -- solely on app-layer validation.
  if not exists (
    select 1 from public.categories
    where id = p_category_id and kind = 'business'
  ) then
    raise exception 'invalid_category';
  end if;

  if not exists (
    select 1 from public.businesses where id = p_business_id
  ) then
    raise exception 'business_not_found';
  end if;

  delete from public.business_categories where business_id = p_business_id;

  insert into public.business_categories (business_id, category_id)
  values (p_business_id, p_category_id);
end;
$$;

revoke execute on function public.set_business_category(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_business_category(uuid, uuid) to service_role;
