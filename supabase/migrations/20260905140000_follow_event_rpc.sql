-- Restore Event Follow pass — event_followers never got the same fix
-- `followers` already has (see follow_business(), applied ad-hoc as
-- "fix_follow_business_rpc" — not itself in this repo's migration
-- history, mirrored here from the live function definition). A direct
-- `.from("event_followers").upsert(..., {onConflict: "event_id,email"})`
-- from the anon client (the current /api/follow-event implementation)
-- fails the moment the SAME email re-follows the SAME event: Postgres
-- must evaluate the ON CONFLICT target under RLS, which requires SELECT
-- visibility that event_followers intentionally never grants (an anon-
-- writable table of follower emails should never be bulk-readable via
-- the anon key). First-time follows happened to work (a plain INSERT,
-- no conflict to evaluate) — only a repeat submission actually exercised
-- the broken path, which is why this went unnoticed. Exact mirror of
-- follow_business(), including leaving the default PUBLIC execute grant
-- in place (same as that function — never explicitly revoked there
-- either, unlike the newer referral RPCs which do revoke it).
create or replace function public.follow_event(p_event_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into event_followers (event_id, email)
  values (p_event_id, p_email)
  on conflict (event_id, email) do update set email = excluded.email;
end;
$$;
