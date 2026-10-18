-- Discovery Lanes Placement — atomic "Make Primary" admin action. The
-- prior implementation ran two independent Supabase requests (demote,
-- then promote); a failure/crash between them could leave a page with
-- zero primary Lanes. This single Postgres function makes the swap one
-- transaction: either both writes land or neither does.
create or replace function set_primary_lane(p_lane_id uuid, p_page_id uuid)
returns void
language plpgsql
as $$
declare
  v_actual_page_id uuid;
begin
  -- Serialize concurrent "Make Primary" calls for the SAME page — locks
  -- every Lane row on this page for the rest of this transaction, so a
  -- second concurrent call for the same page blocks here until the
  -- first commits (and then sees its result) or rolls back (and then
  -- proceeds against the original, unchanged state). A call for a
  -- DIFFERENT page is never blocked by this.
  perform 1 from discovery_lanes where page_id = p_page_id for update;

  -- Validate the selected Lane actually belongs to the intended page
  -- before changing anything — a stale/mismatched id changes nothing.
  select page_id into v_actual_page_id from discovery_lanes where id = p_lane_id;
  if v_actual_page_id is null then
    raise exception 'Lane not found.' using errcode = 'P0002';
  end if;
  if v_actual_page_id <> p_page_id then
    raise exception 'That Lane does not belong to this Discovery page.' using errcode = '22023';
  end if;

  -- Demote whichever Lane currently holds primary on this page (never
  -- the one being promoted), then promote the selected Lane. One
  -- function call = one transaction: if either write fails, or the
  -- partial unique index is ever violated, BOTH are rolled back and the
  -- previous primary Lane is left exactly as it was — touches only the
  -- placement column, never title/subtitle/sort_order/item_limit/
  -- is_visible/topic_ids/topic_id.
  update discovery_lanes set placement = 'explore_more' where page_id = p_page_id and placement = 'primary' and id <> p_lane_id;
  update discovery_lanes set placement = 'primary' where id = p_lane_id;
end;
$$;

-- Postgres functions are executable by PUBLIC by default; Supabase's
-- PostgREST layer exposes any such function as a callable RPC endpoint
-- for anon/authenticated API keys. Revoke that default and grant
-- execution ONLY to service_role — the only role the Admin's
-- requireAdminSupabase() ever hands out (gated behind a verified admin
-- session).
revoke all on function set_primary_lane(uuid, uuid) from public;
grant execute on function set_primary_lane(uuid, uuid) to service_role;
