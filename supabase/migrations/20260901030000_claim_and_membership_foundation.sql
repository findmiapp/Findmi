-- ============================================================================
-- Phase 1: Claim / Ownership / Permissions foundation (businesses + events)
-- Adds FOUR new tables and TWO service-role-only approval functions.
-- Touches nothing else. Fully additive.
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Design note (explicit instruction for this pass): no `reviewed_by`
-- column. Founder /admin still authenticates via a single shared
-- ADMIN_PASSWORD session cookie (src/lib/admin/auth.ts), not individual
-- auth.users identities — a `reviewed_by uuid references auth.users(id)`
-- column would have nothing real to point at and would misattribute every
-- review to whichever founder happened to be signed into Supabase Auth,
-- if anyone. `reviewed_at` alone is recorded; a real reviewed_by can be
-- added later once founder/admin staff have individual authenticated
-- accounts.
-- ============================================================================

-- ── business_members / event_members ───────────────────────────────────────
-- The actual permission grant. A claim_requests row is never itself
-- authorization — only a row here is. No authenticated INSERT/UPDATE/
-- DELETE policy exists on either table: membership rows are created only
-- by approve_business_claim()/approve_event_claim() below (SECURITY
-- DEFINER, executable only by service_role), so a client can never grant
-- itself (or anyone else) membership directly.

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);

create table if not exists public.event_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

-- At most one 'owner' row per business/event — the real, database-level
-- backstop behind approve_business_claim()/approve_event_claim()'s "don't
-- silently create a second owner" check below. Even if two approvals
-- somehow raced past the function's own SELECT check, this constraint
-- makes a second concurrent owner insert fail outright rather than
-- succeed silently.
create unique index if not exists business_members_one_owner_per_business
  on public.business_members (business_id) where role = 'owner';
create unique index if not exists event_members_one_owner_per_event
  on public.event_members (event_id) where role = 'owner';

create index if not exists business_members_user_id_idx on public.business_members (user_id);
create index if not exists business_members_business_id_idx on public.business_members (business_id);
create index if not exists event_members_user_id_idx on public.event_members (user_id);
create index if not exists event_members_event_id_idx on public.event_members (event_id);

alter table public.business_members enable row level security;
alter table public.event_members enable row level security;

create policy "business_members_select_own"
  on public.business_members for select
  to authenticated
  using (auth.uid() = user_id);

create policy "event_members_select_own"
  on public.event_members for select
  to authenticated
  using (auth.uid() = user_id);

-- ── business_claim_requests / event_claim_requests ─────────────────────────
-- A request to become a member — never itself a grant. A rejected claim
-- doesn't permanently block a future one: the unique constraint is
-- intentionally partial (status = 'pending' only), so a new claim can be
-- submitted after an old one was rejected, while still preventing the
-- same user from stacking up multiple simultaneous pending claims on the
-- same entity.

create table if not exists public.business_claim_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.event_claim_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists business_claim_requests_one_pending
  on public.business_claim_requests (user_id, business_id) where status = 'pending';
create unique index if not exists event_claim_requests_one_pending
  on public.event_claim_requests (user_id, event_id) where status = 'pending';

create index if not exists business_claim_requests_user_id_idx on public.business_claim_requests (user_id);
create index if not exists business_claim_requests_business_id_idx on public.business_claim_requests (business_id);
create index if not exists business_claim_requests_status_idx on public.business_claim_requests (status);
create index if not exists event_claim_requests_user_id_idx on public.event_claim_requests (user_id);
create index if not exists event_claim_requests_event_id_idx on public.event_claim_requests (event_id);
create index if not exists event_claim_requests_status_idx on public.event_claim_requests (status);

alter table public.business_claim_requests enable row level security;
alter table public.event_claim_requests enable row level security;

create policy "business_claim_requests_select_own"
  on public.business_claim_requests for select
  to authenticated
  using (auth.uid() = user_id);
-- `status = 'pending'` in the WITH CHECK (in addition to auth.uid() =
-- user_id) closes an escalation path the task's literal wording didn't
-- call out but that RLS alone doesn't otherwise prevent: without it, a
-- client could POST directly to PostgREST with status: "approved" in the
-- insert body and self-approve, since insert-own-row RLS only checks
-- user_id, not the value of every other column. status defaults to
-- 'pending' regardless, so this never affects a normal insert — it only
-- blocks a maliciously-crafted one.
create policy "business_claim_requests_insert_own_pending"
  on public.business_claim_requests for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

create policy "event_claim_requests_select_own"
  on public.event_claim_requests for select
  to authenticated
  using (auth.uid() = user_id);
create policy "event_claim_requests_insert_own_pending"
  on public.event_claim_requests for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

-- No UPDATE/DELETE policy on either claim_requests table for authenticated
-- — status can only change via the service-role paths below (the approve
-- RPCs, or a plain service-role update for reject), never by the client.
-- No anon policy anywhere in this file, on any of the four tables.

-- ── Explicit Data API table privileges ──────────────────────────────────
-- RLS governs which ROWS are visible/writable, but the underlying
-- table-level grant is a separate layer — Supabase's default schema setup
-- grants broad table-level privileges to anon/authenticated on every new
-- table regardless of RLS (the same reason Security Pass 1's
-- restrict_internal_commerce_columns migration had to explicitly revoke/
-- re-grant around businesses/products). Rather than rely on those
-- defaults, the intended privilege surface is made explicit here on all
-- four new tables: authenticated privileges are revoked first, then only
-- the specific operations below are re-granted; anon gets nothing at all.

revoke all on public.business_members from anon;
revoke all on public.event_members from anon;
revoke all on public.business_claim_requests from anon;
revoke all on public.event_claim_requests from anon;

revoke all on public.business_members from authenticated;
revoke all on public.event_members from authenticated;
revoke all on public.business_claim_requests from authenticated;
revoke all on public.event_claim_requests from authenticated;

grant select on public.business_members to authenticated;
grant select on public.event_members to authenticated;
grant select, insert on public.business_claim_requests to authenticated;
grant select, insert on public.event_claim_requests to authenticated;

-- service_role already receives broad table privileges via Supabase's
-- project-wide default grants, but made explicit here too rather than
-- relied on implicitly. Founder admin claim review/list (SELECT) and
-- rejection (a plain service-role UPDATE, see admin/claims/actions.ts)
-- both go through requireAdminSupabase() → getAdminSupabase(); approval
-- itself writes via the SECURITY DEFINER functions below, which run with
-- the function owner's privileges regardless of this grant, but
-- service_role still needs its own direct table access for everything
-- else the claims admin screen does.
grant select, insert, update, delete on public.business_members to service_role;
grant select, insert, update, delete on public.event_members to service_role;
grant select, insert, update, delete on public.business_claim_requests to service_role;
grant select, insert, update, delete on public.event_claim_requests to service_role;

-- ── Atomic approval ──────────────────────────────────────────────────────
-- Approval is the one operation that must not be a fragile multi-write
-- sequence from the app layer: "claim still pending" + "claimant not
-- already a member" + "entity has no owner yet" + "grant membership" +
-- "mark claim approved" all need to succeed or fail together, and two
-- concurrent approvals of two different pending claims on the same entity
-- must not both succeed. `for update` locks the claim row itself (so two
-- approvals of the SAME claim can't double-process it); the partial
-- unique index above is what actually closes the race between two
-- DIFFERENT claims on the same entity — if both transactions pass the
-- SELECT check before either commits, the second INSERT simply fails the
-- unique constraint, and that failure is caught below and turned into the
-- same friendly 'already_owned' error the SELECT check produces in the
-- non-race case. security definer + search_path='' (same convention as
-- handle_new_auth_user() in the account foundation migration) with EXECUTE
-- revoked from PUBLIC/anon/authenticated and granted only to service_role
-- — callable exclusively from the founder-admin path
-- (requireAdminSupabase() → getAdminSupabase()), never from a client.

create or replace function public.approve_business_claim(p_claim_id uuid)
returns public.business_claim_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.business_claim_requests;
begin
  select * into v_claim from public.business_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.business_members
    where business_id = v_claim.business_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.business_members
    where business_id = v_claim.business_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.business_members (user_id, business_id, role)
    values (v_claim.user_id, v_claim.business_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.business_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$$;

revoke execute on function public.approve_business_claim(uuid) from public, anon, authenticated;
grant execute on function public.approve_business_claim(uuid) to service_role;

create or replace function public.approve_event_claim(p_claim_id uuid)
returns public.event_claim_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.event_claim_requests;
begin
  select * into v_claim from public.event_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.event_members
    where event_id = v_claim.event_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.event_members
    where event_id = v_claim.event_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.event_members (user_id, event_id, role)
    values (v_claim.user_id, v_claim.event_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.event_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$$;

revoke execute on function public.approve_event_claim(uuid) from public, anon, authenticated;
grant execute on function public.approve_event_claim(uuid) to service_role;

-- Rejection is a single, already-atomic UPDATE (status = 'pending' guard
-- in the WHERE clause), issued directly from the admin Server Action via
-- the service-role client — no function needed for it.
