-- ============================================================================
-- Claim Membership Management: ownership-transfer / remove-owner RPCs.
-- Adds FOUR new service-role-only functions. Touches nothing else — no
-- new tables, columns, indexes, or RLS/policy changes. Fully additive.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Why these need to be database functions at all (not a Server Action
-- doing a few sequential .update()/.delete() calls): ownership change is
-- the one membership mutation that must be atomic AND must never let two
-- rows for the same business/event both carry role = 'owner', even
-- transiently — the existing partial unique indexes
-- (business_members_one_owner_per_business / event_members_one_owner_per_
-- event, from the claim_and_membership_foundation migration) already
-- enforce that at rest, but nothing enforces the safe ORDER of writes to
-- get there from the app layer. Supabase-js has no multi-statement
-- transaction across separate .from() calls, so "demote old owner, then
-- promote new owner" issued as two separate requests from a Server Action
-- would not be atomic (a crash/error between the two calls could leave
-- the business/event with zero owners unexpectedly). These four functions
-- do the whole operation inside ONE Postgres transaction each, mirroring
-- approve_business_claim()/approve_event_claim()'s existing pattern
-- exactly: SECURITY DEFINER, search_path = '', EXECUTE revoked from
-- PUBLIC/anon/authenticated, granted only to service_role — callable
-- exclusively from the founder-admin path (requireAdminSupabase() ->
-- getAdminSupabase()), never from a client.
--
-- Product decision for this pass (explicit instruction):
--   - Transfer Ownership demotes the existing owner to 'manager' (never
--     deletes their membership) and promotes the target to 'owner'.
--   - Remove Owner / Leave Unowned DELETES the current owner's membership
--     row outright, intentionally leaving the business/event with zero
--     owners — a separate, more destructive action from transfer.
--
-- Concurrency: each function takes a transaction-scoped Postgres advisory
-- lock keyed to the specific business/event before reading or writing
-- anything. Two concurrent calls (transfer+transfer, transfer+remove, or
-- remove+remove) for the SAME business/event fully serialize against each
-- other — the second call blocks until the first's transaction has
-- committed or rolled back, so every SELECT it then runs sees true,
-- up-to-date state. This is what actually closes the race the task asks
-- about, rather than relying on read-committed re-check edge cases. The
-- final promote-to-owner UPDATE is additionally wrapped in its own
-- exception handler as defense in depth (not the primary safeguard) —
-- if the one-owner unique index is ever hit anyway, it's turned into a
-- friendly named error instead of a raw constraint-violation.
-- ============================================================================

-- ── transfer_business_ownership ─────────────────────────────────────────
create or replace function public.transfer_business_ownership(
  p_business_id uuid,
  p_new_owner_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.business_members;
  v_current_owner public.business_members;
begin
  -- Serializes every ownership mutation (transfer AND remove) for this
  -- ONE business against every other concurrent call for the SAME
  -- business — held for the lifetime of this transaction, released
  -- automatically on commit/rollback.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('business_members:' || p_business_id::text));

  -- Target must be a real, existing membership row that already belongs
  -- to THIS business, resolved and locked by its own membership row id —
  -- never a browser-supplied user_id. This is also the "target cannot be
  -- unrelated to the business" check: a member of a different business,
  -- or a nonexistent id, simply doesn't match and falls through to
  -- target_not_found below.
  select * into v_target
  from public.business_members
  where id = p_new_owner_member_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  -- No-op/error rather than unnecessary writes when the target already
  -- is the owner — checked before any write happens.
  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  -- Current owner, if any — a business can legitimately have none (see
  -- remove_business_owner below), in which case there's simply nothing
  -- to demote and the target is promoted directly.
  select * into v_current_owner
  from public.business_members
  where business_id = p_business_id and role = 'owner'
  for update;

  if found then
    update public.business_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  -- Promote the target only after the old owner (if any) has already
  -- been demoted in this same transaction, so
  -- business_members_one_owner_per_business never sees two 'owner' rows
  -- for this business at once. All unrelated manager/staff rows are
  -- never selected or touched at all.
  begin
    update public.business_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$$;

revoke execute on function public.transfer_business_ownership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_business_ownership(uuid, uuid) to service_role;

-- ── transfer_event_ownership ─────────────────────────────────────────────
-- Exact mirror of transfer_business_ownership above, on event_members/
-- event_id instead of business_members/business_id.
create or replace function public.transfer_event_ownership(
  p_event_id uuid,
  p_new_owner_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.event_members;
  v_current_owner public.event_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('event_members:' || p_event_id::text));

  select * into v_target
  from public.event_members
  where id = p_new_owner_member_id and event_id = p_event_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  select * into v_current_owner
  from public.event_members
  where event_id = p_event_id and role = 'owner'
  for update;

  if found then
    update public.event_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  begin
    update public.event_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$$;

revoke execute on function public.transfer_event_ownership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_event_ownership(uuid, uuid) to service_role;

-- ── remove_business_owner ─────────────────────────────────────────────────
-- The separate, more destructive "Remove Owner / Leave Unowned" action —
-- DELETES the current owner's membership row outright (never a demote),
-- leaving the business intentionally unowned. All manager/staff rows are
-- never selected or touched.
create or replace function public.remove_business_owner(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.business_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('business_members:' || p_business_id::text));

  select * into v_owner
  from public.business_members
  where business_id = p_business_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.business_members where id = v_owner.id;
end;
$$;

revoke execute on function public.remove_business_owner(uuid) from public, anon, authenticated;
grant execute on function public.remove_business_owner(uuid) to service_role;

-- ── remove_event_owner ────────────────────────────────────────────────────
-- Exact mirror of remove_business_owner above, on event_members/event_id.
create or replace function public.remove_event_owner(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.event_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('event_members:' || p_event_id::text));

  select * into v_owner
  from public.event_members
  where event_id = p_event_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.event_members where id = v_owner.id;
end;
$$;

revoke execute on function public.remove_event_owner(uuid) from public, anon, authenticated;
grant execute on function public.remove_event_owner(uuid) to service_role;

-- Note: the same advisory-lock key namespaces used by transfer_*_ownership
-- above ('business_members:'/'event_members:' concatenated with the
-- entity's own uuid) are reused verbatim here, so a transfer and a remove
-- call racing on the SAME entity also fully serialize against each other,
-- not just transfer-vs-transfer or remove-vs-remove.
