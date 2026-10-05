-- ============================================================================
-- Business-Hosted Events V1, Pass 1 — canonical host Business
--
-- Adds ONE optional canonical host Business per Event:
--
--   events.host_business_id -> businesses(id), NULL = no Business host.
--
-- Hosting is deliberately its own relationship, distinct from:
--   - participation   (event_businesses / event_occurrence_businesses)
--   - physical presence (appearances)
--   - human management (event_members)
--   - physical place  (event_occurrences.location_id)
-- Nothing here writes participation rows or appearances, and no existing
-- Event is backfilled (every legacy Event keeps host_business_id NULL and
-- behaves exactly as before). Deleting a Business never deletes an Event:
-- the host simply clears (ON DELETE SET NULL).
--
-- create_owned_event() gains an OPTIONAL p_host_business_id (default
-- NULL). The function body is the CURRENT PRODUCTION definition (which
-- already sets publication_status = 'pending_review' — newer than the
-- 20260906000000 file in this repo) plus the host check/insert. The old
-- 7-argument signature is dropped first so named-argument calls without
-- the new parameter resolve unambiguously to the single 8-argument
-- function (two overloads both matching via defaults would be ambiguous
-- to PostgREST). Execution stays service_role-only, unchanged.
--
-- When a host is supplied, p_user_id (the caller's session-derived
-- identity, same contract as before) must hold a business_members row for
-- THAT Business with role owner or manager — staff cannot host. Pro
-- entitlement for the host Business is checked by the calling Server
-- Action with the app's canonical isBusinessPro() (not re-interpreted
-- here). The creator still always receives the event_members owner row.
-- ============================================================================

alter table public.events
  add column if not exists host_business_id uuid null
  references public.businesses(id) on delete set null;

create index if not exists events_host_business_id_idx
  on public.events (host_business_id)
  where host_business_id is not null;

comment on column public.events.host_business_id is
  'Canonical host Business (the Business that hosts/organizes this Event). Zero or one per Event. NOT participation (event_businesses / event_occurrence_businesses), NOT a Location (event_occurrences.location_id), NOT human membership (event_members). NULL = no Business host.';

drop function if exists public.create_owned_event(uuid, text, text, timestamptz, timestamptz, uuid, text);

create or replace function public.create_owned_event(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_market_id uuid default null,
  p_requested_market_text text default null,
  p_host_business_id uuid default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
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
  if p_start_at is null then
    raise exception 'start_required';
  end if;
  if p_end_at is null or p_end_at <= p_start_at then
    raise exception 'invalid_end';
  end if;
  if p_market_id is not null and p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    raise exception 'market_choice_ambiguous';
  end if;
  if p_market_id is not null and not exists (select 1 from public.markets where id = p_market_id and active) then
    raise exception 'invalid_market';
  end if;
  -- Host authorization — never trusts the supplied id on its own: the
  -- creator must be an owner or manager of THAT Business.
  if p_host_business_id is not null and not exists (
    select 1
    from public.business_members bm
    where bm.business_id = p_host_business_id
      and bm.user_id = p_user_id
      and bm.role in ('owner', 'manager')
  ) then
    raise exception 'host_not_authorized';
  end if;

  insert into public.events (
    name, slug, start_at, end_at, market_id, is_demo, publication_status, host_business_id
  ) values (
    btrim(p_name),
    btrim(p_slug),
    p_start_at,
    p_end_at,
    p_market_id,
    true,
    'pending_review',
    p_host_business_id
  )
  returning * into v_event;

  insert into public.event_members (user_id, event_id, role)
  values (p_user_id, v_event.id, 'owner');

  if p_requested_market_text is not null and btrim(p_requested_market_text) <> '' then
    insert into public.market_requests (
      requested_text, normalized_key, effective_normalized_key, requester_user_id, source, source_event_id
    ) values (
      btrim(p_requested_market_text),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      lower(regexp_replace(btrim(p_requested_market_text), '[^a-zA-Z0-9]+', ' ', 'g')),
      p_user_id,
      'event_creation',
      v_event.id
    );
  end if;

  return v_event;
end;
$$;

revoke execute on function public.create_owned_event(uuid, text, text, timestamptz, timestamptz, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_owned_event(uuid, text, text, timestamptz, timestamptz, uuid, text, uuid) to service_role;
