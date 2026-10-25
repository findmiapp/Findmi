-- Trust & Privacy Phase 2A: permission hardening for the legacy guest
-- email follow functions (pre-account following).
--
-- No Findmi screen or route calls these any more: following is
-- account-based, and /api/follow, /api/follow-event and
-- /api/follow-location return 410. Until now anyone holding the public
-- anon key could still call them directly through /rest/v1/rpc and add
-- email addresses to the legacy follower tables.
--
-- Permissions only. The functions, the followers / event_followers /
-- location_followers tables and every existing row are kept exactly as
-- they are. PUBLIC is included because follow_event and follow_location
-- also carry the default PUBLIC execute grant, which anon would otherwise
-- still inherit. postgres and service_role keep execute.
revoke execute on function public.follow_business(uuid, text) from public, anon, authenticated;
revoke execute on function public.follow_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.follow_location(uuid, text) from public, anon, authenticated;
