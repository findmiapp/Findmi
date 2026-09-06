-- ============================================================================
-- Multi-Entity Self-Service V1, Stage 3 — Location ownership foundation.
--
-- Mirrors the exact business_members/event_members + claim +
-- create_owned_* + ownership-transfer architecture this codebase already
-- has proven twice (see claim_and_membership_foundation,
-- create_owned_business_rpc, create_owned_event_rpc,
-- ownership_transfer_rpcs) — extended to a THIRD, independent entity:
-- Locations. Location ownership is user -> location_members -> Location,
-- explicitly NOT Business -> owns -> Location (see this stage's own
-- Locked Product Model) — a Location may later optionally relate to a
-- Business, but that relationship (not built in this migration) would
-- never be ownership.
--
-- Fully additive: no existing table/column/RLS policy is altered except
-- widening market_requests' own source CHECK constraint (a strictly
-- broader allow-list, never a behavior change for any existing row) and
-- adding new NULLABLE columns to the existing `locations` table.
-- ============================================================================

-- ── location_members — exact structural mirror of business_members/
-- event_members ─────────────────────────────────────────────────────────
create table if not exists public.location_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, location_id)
);

-- Same real, database-level "at most one owner" backstop as
-- business_members_one_owner_per_business/event_members_one_owner_per_event.
create unique index if not exists location_members_one_owner_per_location
  on public.location_members (location_id) where role = 'owner';

create index if not exists location_members_user_id_idx on public.location_members (user_id);
create index if not exists location_members_location_id_idx on public.location_members (location_id);

alter table public.location_members enable row level security;

create policy "location_members_select_own"
  on public.location_members for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.location_members from anon;
revoke all on public.location_members from authenticated;
grant select on public.location_members to authenticated;
grant select, insert, update, delete on public.location_members to service_role;

-- ── location_claim_requests — exact structural mirror of
-- business_claim_requests/event_claim_requests, payment columns included
-- (V1 rule: Location claiming is FREE, exactly like Business claiming —
-- these columns exist purely so the existing generic admin claim-review
-- queries, which select a uniform column set across every claim table,
-- keep working without a special case; payment_status stays 'unpaid' for
-- every Location claim row forever, same as a Business claim row today,
-- and nothing here ever reads it as an approval gate). ─────────────────
create table if not exists public.location_claim_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  message text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  payment_amount integer,
  paid_at timestamptz,
  payment_reference text,
  full_name text,
  email text,
  phone text
);

create unique index if not exists location_claim_requests_one_pending
  on public.location_claim_requests (user_id, location_id) where status = 'pending';
create unique index if not exists location_claim_requests_payment_reference_idx
  on public.location_claim_requests (payment_reference) where payment_reference is not null;

create index if not exists location_claim_requests_user_id_idx on public.location_claim_requests (user_id);
create index if not exists location_claim_requests_location_id_idx on public.location_claim_requests (location_id);
create index if not exists location_claim_requests_status_idx on public.location_claim_requests (status);

alter table public.location_claim_requests enable row level security;

create policy "location_claim_requests_select_own"
  on public.location_claim_requests for select
  to authenticated
  using (auth.uid() = user_id);
-- Same escalation-path close as business/event_claim_requests_insert_own_
-- pending: a client could otherwise submit status/payment_status directly.
create policy "location_claim_requests_insert_own_pending"
  on public.location_claim_requests for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending' and payment_status = 'unpaid');

revoke all on public.location_claim_requests from anon;
revoke all on public.location_claim_requests from authenticated;
grant select, insert on public.location_claim_requests to authenticated;
grant select, insert, update, delete on public.location_claim_requests to service_role;

-- ── approve_location_claim() — exact mirror of approve_business_claim()/
-- approve_event_claim() ──────────────────────────────────────────────────
create or replace function public.approve_location_claim(p_claim_id uuid)
returns public.location_claim_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.location_claim_requests;
begin
  select * into v_claim from public.location_claim_requests where id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'claim_not_pending';
  end if;

  if exists (
    select 1 from public.location_members
    where location_id = v_claim.location_id and user_id = v_claim.user_id
  ) then
    raise exception 'already_member';
  end if;

  if exists (
    select 1 from public.location_members
    where location_id = v_claim.location_id and role = 'owner'
  ) then
    raise exception 'already_owned';
  end if;

  begin
    insert into public.location_members (user_id, location_id, role)
    values (v_claim.user_id, v_claim.location_id, 'owner');
  exception when unique_violation then
    raise exception 'already_owned';
  end;

  update public.location_claim_requests
  set status = 'approved', reviewed_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$$;

revoke execute on function public.approve_location_claim(uuid) from public, anon, authenticated;
grant execute on function public.approve_location_claim(uuid) to service_role;

-- ── transfer_location_ownership() / remove_location_owner() — exact
-- mirrors of transfer_business_ownership()/remove_business_owner() (and
-- their event equivalents), same advisory-lock concurrency discipline. ──
create or replace function public.transfer_location_ownership(
  p_location_id uuid,
  p_new_owner_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.location_members;
  v_current_owner public.location_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('location_members:' || p_location_id::text));

  select * into v_target
  from public.location_members
  where id = p_new_owner_member_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'target_not_found';
  end if;

  if v_target.role = 'owner' then
    raise exception 'already_owner';
  end if;

  select * into v_current_owner
  from public.location_members
  where location_id = p_location_id and role = 'owner'
  for update;

  if found then
    update public.location_members
    set role = 'manager'
    where id = v_current_owner.id;
  end if;

  begin
    update public.location_members
    set role = 'owner'
    where id = v_target.id;
  exception when unique_violation then
    raise exception 'ownership_conflict';
  end;
end;
$$;

revoke execute on function public.transfer_location_ownership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_location_ownership(uuid, uuid) to service_role;

create or replace function public.remove_location_owner(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.location_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('location_members:' || p_location_id::text));

  select * into v_owner
  from public.location_members
  where location_id = p_location_id and role = 'owner'
  for update;

  if not found then
    raise exception 'no_current_owner';
  end if;

  delete from public.location_members where id = v_owner.id;
end;
$$;

revoke execute on function public.remove_location_owner(uuid) from public, anon, authenticated;
grant execute on function public.remove_location_owner(uuid) to service_role;

-- ── locations — minimal additive venue-profile fields ───────────────────
-- Only what's needed for a real public venue profile (per this stage's
-- own scope): description, a single hero/cover image, and contact/link
-- fields following the exact naming convention businesses/events already
-- use for the same concepts (website_url, not "website"; email/phone
-- bare, matching businesses.email/phone).
alter table public.locations
  add column if not exists description text,
  add column if not exists website_url text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists cover_image_url text;

-- ── location_images — gallery, same shape as business_images (id,
-- location_id, url, display_order) — Locations don't need event_images'
-- two-kind ("event"/"venue") split since there's only ever one gallery
-- here. ───────────────────────────────────────────────────────────────
create table if not exists public.location_images (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  url text not null,
  display_order integer,
  created_at timestamptz not null default now()
);

create index if not exists location_images_location_id_idx on public.location_images (location_id);

alter table public.location_images enable row level security;

create policy "location_images_public_read"
  on public.location_images for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.location_images from anon;
revoke insert, update, delete on public.location_images from authenticated;
grant select on public.location_images to anon;
grant select on public.location_images to authenticated;
grant select, insert, update, delete on public.location_images to service_role;

-- ── create_owned_location() — mirrors create_owned_event()'s own shape:
-- no category (Locations have none), Market OPTIONAL (same reasoning as
-- events — a venue can exist without one yet), is_demo hardcoded TRUE
-- (never accepted as input) so a native Location is never auto-public —
-- same moderation semantics locations already uses (is_demo, no separate
-- publication_status column). ────────────────────────────────────────
create or replace function public.create_owned_location(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_address text,
  p_city text,
  p_state text,
  p_market_id uuid default null,
  p_requested_market_text text default null
)
returns public.locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location public.locations;
begin
  if p_user_id is null then
    raise exception 'user_required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'slug_required';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.locations (
    name, slug, address, city, state, market_id, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    p_market_id,
    true
  )
  returning * into v_location;

  insert into public.location_members (user_id, location_id, role)
  values (p_user_id, v_location.id, 'owner');

  if p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    insert into public.market_requests (
      requested_text, city, state, normalized_key, effective_normalized_key, requester_user_id, source, source_location_id
    ) values (
      btrim(p_requested_market_text),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'location_creation',
      v_location.id
    );
  end if;

  return v_location;
end;
$$;

revoke execute on function public.create_owned_location(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_owned_location(uuid, text, text, text, text, text, uuid, text) to service_role;

-- ── market_requests — extend source to include 'location_creation' ─────
alter table public.market_requests drop constraint if exists market_requests_source_check;
alter table public.market_requests add constraint market_requests_source_check
  check (source = any (array['consumer', 'business_creation', 'event_creation', 'location_creation']));

alter table public.market_requests
  add column if not exists source_location_id uuid references public.locations(id) on delete set null;

create index if not exists market_requests_source_location_id_idx on public.market_requests (source_location_id);
