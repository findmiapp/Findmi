-- ============================================================================
-- Multi-Entity Self-Service V1, Stage 2 — atomic create_owned_event() RPC
--
-- Native Event creation. Lets an authenticated, ENTITLEMENT-QUALIFYING
-- FindMi user (see canCurrentUserManageEvents() in src/lib/entitlements.ts
-- — checked by the calling Server Action BEFORE this RPC is ever invoked,
-- same authorize-then-elevate shape as every other native-creation RPC in
-- this codebase) create a brand-new event and become its owner in one
-- atomic step — the events row + the creator's own event_members owner
-- row + (optionally) a linked market_requests row either all commit
-- together or none do. Mirrors create_owned_business()'s own shape
-- exactly (see 20260905230000_area_picker_and_market_requests.sql for the
-- live version of that function), adapted for events:
--
--   - events has NO publication_status column (unlike businesses) —
--     moderation is entirely via is_demo (true = hidden from every public
--     discovery/detail query — see getEventBySlug() etc. in lib/data.ts).
--     is_demo is hardcoded TRUE here, never accepted as a parameter, so
--     there is no client-controlled path to an already-public event.
--   - Market is OPTIONAL for events (unlike businesses, where a Primary
--     Market is required at creation) — matches the existing admin
--     saveEvent() action, which has never required one. p_market_id and
--     p_requested_market_text are therefore both nullable, and it is NOT
--     an error to supply neither.
--   - No category parameter: event_categories is a many-to-many roster
--     (unlike businesses' exactly-one-category rule enforced via
--     set_business_category()), so category assignment is left to the
--     Event Manager's own Event Details save after creation, same as
--     admin's own event editor already does it (delete-then-reinsert into
--     event_categories, no atomic RPC needed for a plain join table).
--
-- p_user_id is expected to already be the caller's own session-derived
-- identity (getServerSupabase().auth.getUser(), read by the calling
-- Server Action BEFORE this RPC is invoked, via the service-role client)
-- — never a client-supplied form field.
-- ============================================================================

create or replace function public.create_owned_event(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_market_id uuid default null,
  p_requested_market_text text default null
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

  insert into public.events (
    name, slug, start_at, end_at, market_id, is_demo
  ) values (
    btrim(p_name),
    btrim(p_slug),
    p_start_at,
    p_end_at,
    p_market_id,
    true
  )
  returning * into v_event;

  insert into public.event_members (user_id, event_id, role)
  values (p_user_id, v_event.id, 'owner');

  -- Same "unmatched geography -> linked, admin-reviewable request" shape
  -- create_owned_business() uses, adapted to events' own source_event_id
  -- column. The calling action is expected to have already run
  -- findExistingGeographyMatch() itself and passed the resolved
  -- p_market_id directly when a match was found — this branch only ever
  -- reached for genuinely unmatched text, same convention as
  -- createLinkedMarketRequest() (lib/market-requests.ts). Sets
  -- effective_normalized_key explicitly (NOT NULL, no default) — unlike
  -- create_owned_business()'s own market_requests insert, which omits it.
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

revoke execute on function public.create_owned_event(uuid, text, text, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.create_owned_event(uuid, text, text, timestamptz, timestamptz, uuid, text) to service_role;
