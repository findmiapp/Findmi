-- Admin Content Lifecycle V2 hotfix — the cross-table RESTRICTIVE
-- policies added in 20260927015110 ("Hide products of archived or
-- trashed businesses", "Hide appearances of archived or trashed
-- parents", "Hide occurrences of archived or trashed events") each ran a
-- bare subquery against businesses/events. That subquery is ITSELF
-- subject to businesses'/events' own RLS policies for the querying role
-- — including the new "Hide archived or trashed businesses"/"...events"
-- RESTRICTIVE policy, which requires archived_at/trashed_at IS NULL for
-- a row to be visible AT ALL. So the moment a business/event is actually
-- archived, RLS hides that very row from the child policy's own
-- subquery, and `NOT EXISTS(...)` always evaluates true — the child
-- policy could never detect a retired parent. Verified live: an
-- archived test business's product remained publicly readable by anon
-- despite the policy appearing correct in isolation (EXPLAIN showed the
-- subquery's Recheck Cond ANDing "archived_at IS NOT NULL" from this
-- policy with "archived_at IS NULL" from businesses' own policy — a
-- contradiction that can never match).
--
-- Standard fix (Supabase's documented pattern for this exact class of
-- bug): a SECURITY DEFINER helper function, which runs with the
-- function owner's privileges and therefore bypasses RLS on the
-- underlying table for this one narrow, read-only status check only.
-- `set search_path = ''` (with fully-qualified public.businesses/events)
-- is the standard search-path-injection guard for SECURITY DEFINER
-- functions.
create or replace function public.is_business_retired(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id and (b.archived_at is not null or b.trashed_at is not null)
  );
$$;

create or replace function public.is_event_retired(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and (e.archived_at is not null or e.trashed_at is not null)
  );
$$;

grant execute on function public.is_business_retired(uuid) to anon, authenticated;
grant execute on function public.is_event_retired(uuid) to anon, authenticated;

drop policy if exists "Hide products of archived or trashed businesses" on public.products;
create policy "Hide products of archived or trashed businesses" on public.products
  as restrictive for select to public
  using (not public.is_business_retired(products.business_id));

drop policy if exists "Hide appearances of archived or trashed parents" on public.appearances;
create policy "Hide appearances of archived or trashed parents" on public.appearances
  as restrictive for select to public
  using (
    not public.is_business_retired(appearances.business_id)
    and (appearances.event_id is null or not public.is_event_retired(appearances.event_id))
  );

drop policy if exists "Hide occurrences of archived or trashed events" on public.event_occurrences;
create policy "Hide occurrences of archived or trashed events" on public.event_occurrences
  as restrictive for select to public
  using (not public.is_event_retired(event_occurrences.event_id));
