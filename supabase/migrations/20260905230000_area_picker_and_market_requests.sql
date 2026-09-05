-- ============================================================================
-- Consumer Area Picker + Market Requests V1
--
-- (1) markets.consumer_visible — a Market can now be a valid, active,
-- internally-assignable FindMi Market WITHOUT appearing in the consumer
-- Area picker yet (supply can exist before a public Area "launch").
-- Deliberately a SEPARATE column from `active` (which stays "valid at
-- all" — internal/admin/business Market pickers keep using `active`
-- alone). Defaults to true so every existing row (and anything inserted
-- by older code that doesn't know this column exists) keeps showing in
-- consumer Area discovery exactly as it does today — this migration
-- changes zero current consumer-visible behavior for the 5 existing
-- Markets.
--
-- (2) market_requests — unreviewed geography proposed by a consumer,
-- a business/event creation flow, or (later) admin. NEVER a canonical
-- Market: nothing reads this table for discovery/entitlement, and
-- nothing here is written into `markets` except by an explicit admin
-- review action (see the app-layer Market Requests queue). One row per
-- distinct request "instance" — a business/event creation request is
-- always its own row (1:1 with the business/event it blocked), while
-- consumer requests are deduped at the app layer onto one pending row
-- per normalized_key (see market_request_interests below for how repeat
-- consumer interest is counted without creating duplicate rows).
--
-- normalized_key is computed server-side (never trusted client input) —
-- a lowercased/punctuation-stripped/state-abbreviation-stripped form of
-- the requested text, used only for lightweight grouping/dedup, never
-- for geocoding or automatic Market assignment.
--
-- (3) market_request_interests — one row per distinct person (signed-in
-- user OR email) who has expressed interest in a given PENDING consumer
-- request, so "18 people want Austin" is a real count rather than 18
-- duplicate market_requests rows. Partial unique indexes prevent the
-- same user or email from inflating the count for the same request.
--
-- Both new tables have RLS enabled with NO public write policies —
-- every public-facing write (a consumer's request, a business/event
-- creation's linked request) goes through a validated Server Action
-- using the service-role admin client, exactly like every other
-- consumer-facing table that needs write validation beyond what RLS
-- alone can express (see business_markets/pro_invites precedent). Admin
-- review reads/writes go through the same service-role client
-- (requireAdminSupabase()) every other admin screen already uses.
-- ============================================================================

alter table public.markets
  add column if not exists consumer_visible boolean not null default true;

create table if not exists public.market_requests (
  id uuid primary key default gen_random_uuid(),
  requested_text text not null,
  city text,
  state text,
  country text default 'US',
  -- Lightweight grouping/dedup key only — see this file's own header
  -- comment. Never geocoded, never used for automatic Market matching.
  normalized_key text not null,
  requester_user_id uuid references auth.users(id) on delete set null,
  requester_email text,
  source text not null check (source in ('consumer', 'business_creation', 'event_creation')),
  source_business_id uuid references public.businesses(id) on delete set null,
  source_event_id uuid references public.events(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'mapped', 'rejected')),
  mapped_market_id uuid references public.markets(id) on delete set null,
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists market_requests_normalized_key_idx on public.market_requests (normalized_key);
create index if not exists market_requests_status_idx on public.market_requests (status);
create index if not exists market_requests_source_business_id_idx on public.market_requests (source_business_id);
create index if not exists market_requests_source_event_id_idx on public.market_requests (source_event_id);

create table if not exists public.market_request_interests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.market_requests(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  created_at timestamptz not null default now(),
  constraint market_request_interests_identity_check check (user_id is not null or email is not null)
);

-- Same request, same signed-in person -> counted once.
create unique index if not exists market_request_interests_user_unique
  on public.market_request_interests (request_id, user_id)
  where user_id is not null;
-- Same request, same email (signed-out) -> counted once. Emails are
-- lowercased/trimmed server-side before insert so this index actually
-- dedupes case/whitespace variants.
create unique index if not exists market_request_interests_email_unique
  on public.market_request_interests (request_id, email)
  where email is not null;

alter table public.market_requests enable row level security;
alter table public.market_request_interests enable row level security;
-- Safest minimal model, same posture as business_markets/pro_invites:
-- RLS enabled with ZERO policies for anon/authenticated. Every read/
-- write goes through the service-role admin client from a validated
-- Server Action (public request submission) or an admin-authenticated
-- screen (the Market Requests queue) — never a direct client-side
-- Supabase call.

-- ----------------------------------------------------------------------
-- Business creation — allow a Market Request in place of an existing
-- Market, atomically. Extends (never replaces) create_owned_business:
-- p_market_id stays the normal path; p_requested_market_text is a NEW
-- optional alternative. Exactly one of the two must be supplied. When a
-- request is supplied, the business is created exactly as before (same
-- owner membership, category, plan/publication defaults) but NO
-- business_markets row is inserted — the business simply has no active
-- Primary Market yet, which is the correct/safe "does not grant
-- discovery" state — and a linked market_requests row is inserted in
-- the SAME function call, preserving the atomicity this RPC exists for
-- (business + owner + category + [market row OR market request] all
-- succeed together or none do).
-- ----------------------------------------------------------------------
-- CREATE OR REPLACE cannot change a function's parameter TYPE signature
-- (adding a trailing parameter counts as a different signature, even
-- with a default) — it would silently leave the old 9-arg overload
-- callable alongside this new 10-arg one. Drop it explicitly first so
-- exactly one create_owned_business exists afterward.
drop function if exists public.create_owned_business(uuid, text, text, uuid, text, text, text, text, uuid);

create or replace function public.create_owned_business(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_category_id uuid,
  p_city text,
  p_state text,
  p_website_url text,
  p_instagram_url text,
  p_market_id uuid,
  p_requested_market_text text default null
)
returns businesses
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_business public.businesses;
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
  if not exists (select 1 from public.categories where id = p_category_id and kind = 'business') then
    raise exception 'invalid_category';
  end if;

  if p_market_id is null and (p_requested_market_text is null or btrim(p_requested_market_text) = '') then
    raise exception 'market_required';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;

  insert into public.businesses (
    name, slug, city, state, website_url, instagram_url,
    plan_tier, publication_status, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_website_url, '')), ''),
    nullif(btrim(coalesce(p_instagram_url, '')), ''),
    'free',
    'pending_review',
    false
  )
  returning * into v_business;

  perform public.set_business_category(v_business.id, p_category_id);

  insert into public.business_members (user_id, business_id, role)
  values (p_user_id, v_business.id, 'owner');

  if p_market_id is not null then
    insert into public.business_markets (business_id, market_id, relationship, provenance, active)
    values (v_business.id, p_market_id, 'primary', 'self_selected', true);
  else
    insert into public.market_requests (
      requested_text, city, state, normalized_key, requester_user_id, source, source_business_id
    ) values (
      btrim(p_requested_market_text),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_state, '')), ''),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'business_creation',
      v_business.id
    );
  end if;

  return v_business;
end;
$function$;

revoke execute on function public.create_owned_business(uuid, text, text, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_owned_business(uuid, text, text, uuid, text, text, text, text, uuid, text) to service_role;
