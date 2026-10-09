-- Opportunities — Commercial Terms Admin Builder + Atomic Aggregate
-- Persistence (Pass 2).
--
-- NOT YET APPLIED TO PRODUCTION. Purely additive — adds exactly one new
-- function. No existing table, column, row, trigger, or constraint from
-- 20261009000000_opportunity_commercial_terms_foundation.sql (or any
-- earlier migration) is altered.
--
-- ============================================================================
-- Why this function exists, and what it is NOT
-- ============================================================================
-- Pass 1's own report assumed a future Postgres RPC could "call
-- validateOption()". It cannot: validateOption()/validateComponent() in
-- src/lib/opportunity-commercial-terms-domain.ts are plain TypeScript with
-- no database access. Every business rule they express (monetary
-- exclusivity, amount-mode shape, Complimentary-vs-Structured
-- classification, text limits, etc.) MUST already have been checked in
-- TypeScript, server-side, before this function is ever called — see
-- src/app/admin/(protected)/opportunities/actions.ts's
-- parseCommercialTermsForm()/saveCommercialTerms helpers, which parse the
-- submitted form fields, run them through validateOption()/
-- validateComponent() exactly as committed in Pass 1, and only call this
-- RPC once every Option has already been accepted.
--
-- This function's own job is narrower and purely mechanical:
--   1. Atomicity — an Option and its Components must never be visible to
--      any other reader mid-write (e.g. a Structured Option transiently
--      empty, or carrying its old Components under its new
--      commercial_mode). A single SECURITY DEFINER PL/pgSQL function body
--      is one implicit transaction, so every insert/update/delete below
--      either all lands or all rolls back together.
--   2. Defense-in-depth structural guards a TypeScript caller could get
--      wrong or a crafted payload could try to smuggle past it — rejecting
--      an empty option set, and rejecting an incoming option id that
--      doesn't actually belong to p_listing_id (never trust a client- or
--      caller-supplied id as already scoped).
--   3. Replaying the real per-row CHECK constraints and the two existing
--      mode-consistency triggers from the Pass 1 migration, which still
--      fire on every insert/update here exactly as they do for any other
--      caller — this function adds no exception for itself.
-- It is NOT a second implementation of validateOption()'s classification
-- logic, and it never will be: if these two layers ever disagree, the
-- TypeScript layer is wrong by construction (it ran first) and must be
-- fixed there, not patched around here.
--
-- ============================================================================
-- Stable Option ids across ordinary edits
-- ============================================================================
-- `opportunity_recipients.option_id` does not exist yet (deliberately out
-- of scope for this pass — see the Pass 2 report), but a future Business
-- response will need to reference a specific Option by a stable id, so an
-- ordinary edit (re-titling an Option, tweaking an amount) must not
-- destroy and recreate every Option/Component row on every save. Each
-- element of p_options may carry its own existing `id`; when it does, that
-- Option is UPDATED in place (its id is preserved) rather than
-- deleted-and-reinserted. Only Options genuinely removed by the admin (an
-- id that existed before this call but is absent from p_options) are
-- deleted — cascading to their Components via the Pass 1 foreign key.
-- Components themselves have no caller-visible id yet (nothing references
-- one), so each kept Option's Components are simply replaced in full —
-- deliberately the smallest correct approach, never a row-by-row Component
-- diff this schema gives no reason to need yet.
--
-- ============================================================================
-- p_options shape (produced server-side only, by the TypeScript caller
-- above — never passed through from a raw client payload):
-- [
--   {
--     "id": "<uuid, or null/absent for a new Option>",
--     "name": "<string or null>",
--     "description": "<string or null>",
--     "commercial_mode": "structured" | "complimentary" | "custom",
--     "custom_terms_note": "<string or null>",
--     "components": [
--       {
--         "component_type": "participation_fee" | "compensation" | "project_budget" | "in_kind",
--         "amount_mode": "fixed" | "starting_at" | "range" | "undisclosed" | null,
--         "amount_min_cents": <integer or null>,
--         "amount_max_cents": <integer or null>,
--         "currency": "<3-letter code or null>",
--         "in_kind_category": "<string or null>",
--         "in_kind_description": "<string or null>",
--         "in_kind_provider": "<string or null>",
--         "in_kind_required": <boolean>,
--         "estimated_value_cents": <integer or null>
--       }, ...
--     ]
--   }, ...
-- ]
-- ============================================================================

create or replace function public.replace_opportunity_options(
  p_listing_id uuid,
  p_options jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option jsonb;
  v_component jsonb;
  v_option_id uuid;
  v_incoming_ids uuid[] := '{}';
  v_order integer := 0;
begin
  if not exists (select 1 from public.opportunity_listings where id = p_listing_id) then
    raise exception 'listing_not_found';
  end if;

  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) = 0 then
    raise exception 'no_options';
  end if;

  for v_option in select * from jsonb_array_elements(p_options)
  loop
    v_option_id := nullif(v_option->>'id', '')::uuid;

    if v_option_id is not null then
      -- Defense-in-depth: never trust a caller-supplied id as already
      -- scoped to this listing, even though the TypeScript caller is only
      -- ever supposed to pass ids it just read for this same listing.
      if not exists (select 1 from public.opportunity_options where id = v_option_id and listing_id = p_listing_id) then
        raise exception 'foreign_option_id';
      end if;
      -- Components are cleared BEFORE the mode update so a mode change
      -- (e.g. structured -> complimentary) is never blocked by the
      -- trg_opportunity_options_mode_change_check guard seeing stale rows
      -- from the shape this Option is leaving.
      delete from public.opportunity_option_components where option_id = v_option_id;
      update public.opportunity_options
      set
        name = v_option->>'name',
        description = v_option->>'description',
        commercial_mode = v_option->>'commercial_mode',
        custom_terms_note = v_option->>'custom_terms_note',
        display_order = v_order
      where id = v_option_id;
    else
      insert into public.opportunity_options (listing_id, name, description, commercial_mode, custom_terms_note, display_order)
      values (
        p_listing_id,
        v_option->>'name',
        v_option->>'description',
        v_option->>'commercial_mode',
        v_option->>'custom_terms_note',
        v_order
      )
      returning id into v_option_id;
    end if;

    v_incoming_ids := array_append(v_incoming_ids, v_option_id);

    for v_component in select * from jsonb_array_elements(coalesce(v_option->'components', '[]'::jsonb))
    loop
      insert into public.opportunity_option_components (
        option_id, component_type, amount_mode, amount_min_cents, amount_max_cents, currency,
        in_kind_category, in_kind_description, in_kind_provider, in_kind_required, estimated_value_cents, display_order
      ) values (
        v_option_id,
        v_component->>'component_type',
        v_component->>'amount_mode',
        nullif(v_component->>'amount_min_cents', '')::integer,
        nullif(v_component->>'amount_max_cents', '')::integer,
        v_component->>'currency',
        v_component->>'in_kind_category',
        v_component->>'in_kind_description',
        v_component->>'in_kind_provider',
        coalesce((v_component->>'in_kind_required')::boolean, true),
        nullif(v_component->>'estimated_value_cents', '')::integer,
        coalesce((v_component->>'display_order')::integer, 0)
      );
    end loop;

    v_order := v_order + 1;
  end loop;

  -- Options the admin removed (present before this call, absent now).
  -- Cascades to their Components via the Pass 1 foreign key.
  delete from public.opportunity_options
  where listing_id = p_listing_id
    and id <> all (v_incoming_ids);
end;
$$;

revoke execute on function public.replace_opportunity_options(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_opportunity_options(uuid, jsonb) to service_role;

comment on function public.replace_opportunity_options(uuid, jsonb) is
  'Opportunities Commercial Terms Admin Builder (Pass 2): atomically replaces every Option+Component for one listing. Caller (Admin Server Action) must already have validated every Option/Component through validateOption()/validateComponent() in TypeScript -- this function performs transactional integrity + defense-in-depth structural guards only, never a second implementation of that business-rule validation. service_role only.';
