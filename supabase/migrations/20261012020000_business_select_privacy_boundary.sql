-- Phase 0B — Business SELECT privacy boundary.
--
-- Problem: public.businesses has a permissive SELECT policy
-- "Public read businesses" USING (true) for all roles, so the anon key
-- (shipped to every browser) can list NON-PUBLIC Businesses directly
-- through the Data API — pending_review, paused, rejected — even though
-- every public app loader filters publication_status = 'live' in code.
-- The only existing restrictive policy hides archived/trashed rows.
--
-- Fix: two ADDITIVE, role-scoped RESTRICTIVE SELECT policies. Restrictive
-- policies are ANDed with every permissive policy, so this holds no matter
-- which permissive policies exist. Nothing is dropped or replaced; no
-- grants, rows or functions change; service_role (Admin, matching,
-- webhooks, owner management via the service-role server client)
-- bypasses RLS and is unaffected.
--
-- Resulting invariant (together with the existing restrictive
-- "Hide archived or trashed businesses"):
--   anon           → live AND not archived AND not trashed
--   authenticated  → (live OR a member of the Business) AND not archived
--                    AND not trashed
--   service_role   → unrestricted (unchanged)
--
-- The member exception uses the EXISTING membership model
-- (public.business_members, any role) — it keeps the signed-in owner
-- paths that read their own Business through the session client working
-- for a pending_review/paused/rejected Business (account dashboard,
-- /account/business list, account context, schedule, messages, Pro
-- redeem). It is evaluated with the caller's own rights: authenticated
-- may SELECT business_members, whose own policy returns only the caller's
-- rows (auth.uid() = user_id) — no SECURITY DEFINER, no recursion (that
-- policy never reads businesses).
--
-- The anon policy deliberately does NOT reference business_members: anon
-- has no privilege on that table, and referencing it would make every
-- anon read of businesses fail with "permission denied".
--
-- is_demo is not a privacy boundary and is not included (unchanged).

create policy "Anon sees only live businesses"
  on public.businesses
  as restrictive
  for select
  to anon
  using (publication_status = 'live');

create policy "Authenticated sees live businesses or their own"
  on public.businesses
  as restrictive
  for select
  to authenticated
  using (
    publication_status = 'live'
    or exists (
      select 1
      from public.business_members m
      where m.business_id = businesses.id
        and m.user_id = (select auth.uid())
    )
  );
