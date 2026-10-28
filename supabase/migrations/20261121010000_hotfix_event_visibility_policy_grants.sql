-- HOTFIX for 20261121000000_consolidation_publication_rules.
--
-- The restrictive "Hide unpublished events" policy read event_members /
-- business_members directly. RLS policy expressions run with the
-- QUERYING role's privileges, and anon has no SELECT grant on those
-- tables, so every anonymous Event read failed with
-- "permission denied for table event_members".
--
-- Fix: the membership check moves into a SECURITY DEFINER helper (the
-- same pattern can_view_event / is_event_retired use). It never queries
-- events itself, so there is no self-reference. Visibility semantics are
-- unchanged: live Events are public; pending / rejected Events are
-- visible only to their own managers; service_role bypasses RLS.

create or replace function public.viewer_manages_event(p_event_id uuid, p_host_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      exists (
        select 1 from public.event_members m
        where m.event_id = p_event_id and m.user_id = auth.uid()
      )
      or (
        p_host_business_id is not null
        and exists (
          select 1 from public.business_members bm
          where bm.business_id = p_host_business_id and bm.user_id = auth.uid()
        )
      )
    );
$$;
revoke all on function public.viewer_manages_event(uuid, uuid) from public;
grant execute on function public.viewer_manages_event(uuid, uuid) to anon, authenticated, service_role;

drop policy if exists "Hide unpublished events" on public.events;
create policy "Hide unpublished events"
  on public.events
  as restrictive
  for select
  to public
  using (
    publication_status = 'live'
    or public.viewer_manages_event(id, host_business_id)
  );
