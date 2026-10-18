-- Supabase's own default-privileges setup grants EXECUTE on every new
-- public-schema function to anon/authenticated explicitly (separate
-- from, and not removed by, "revoke ... from public"). The previous
-- migration's revoke only removed the PUBLIC pseudo-role's grant;
-- anon/authenticated still had their own explicit grants. This closes
-- that gap — set_primary_lane remains callable only by service_role
-- (the only role requireAdminSupabase() ever hands out, gated behind a
-- verified admin session).
revoke execute on function set_primary_lane(uuid, uuid) from anon;
revoke execute on function set_primary_lane(uuid, uuid) from authenticated;
