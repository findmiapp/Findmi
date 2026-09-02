-- ============================================================================
-- Admin Business Owner — email lookup foundation. Adds ONE new function.
-- Touches nothing else — no new tables, columns, indexes, or RLS/policy
-- changes. Fully additive.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Why this needs to be a database function at all: auth.users (email) is
-- not reachable from the app's normal Supabase client the way any public
-- table is — there is no public table/view that duplicates email (see
-- account_foundation.sql's own note: "no email/password is duplicated
-- here"), and the installed Supabase Admin API
-- (@supabase/supabase-js ^2.45.4) has no getUserByEmail method — only
-- auth.admin.listUsers({ page, perPage }), unfiltered by email. Scanning
-- every user page-by-page to find one email is not an acceptable
-- substitute (unbounded, doesn't scale, not "existing infrastructure").
-- This function is the narrow, service-role-only exception that lets
-- founder admin resolve one email straight to its auth.users.id in a
-- single round trip — nothing else about auth.users is exposed.
-- ============================================================================

create or replace function public.lookup_auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

-- Same lockdown shape every other founder-only RPC in this schema uses
-- (approve_business_claim, set_business_category, transfer_business_
-- ownership, etc.): EXECUTE revoked from PUBLIC/anon/authenticated,
-- granted only to service_role — callable exclusively from the founder-
-- admin path (requireAdminSupabase() -> getAdminSupabase()), never from a
-- client session. A signed-in but non-admin user, or a signed-out
-- visitor, has no way to probe whether an email has a FindMi account.
revoke execute on function public.lookup_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_id_by_email(text) to service_role;
