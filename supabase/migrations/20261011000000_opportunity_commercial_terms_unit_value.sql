-- Opportunities — Commercial Terms Unit-Based Contribution Value (Pass 2.5).
--
-- NOT YET APPLIED TO PRODUCTION. Purely additive to opportunity_option_
-- components — no existing row from an earlier migration is touched (none
-- exist; nothing has been applied to production yet). Does NOT edit
-- 20261009000000_opportunity_commercial_terms_foundation.sql or
-- 20261010000000_opportunity_commercial_terms_persistence.sql in place —
-- it adds columns/constraints via ALTER TABLE and revises exactly one
-- already-named constraint (DROP + re-ADD under the same name), and
-- CREATE OR REPLACEs the one existing RPC function. This preserves the
-- Pass 1/2 migration files' own already-reviewed history untouched.
--
-- ============================================================================
-- What this adds, and why (see the Pass 2.5 design report for the full
-- audit/correction trail)
-- ============================================================================
-- Findmi should model WHAT each party contributes in measurable units;
-- value is an attribute of those units, never required. Four new columns:
--
--   quantity           numeric(10,2) — decimals allowed (2.5 hours is real).
--   unit               text          — a fixed common-unit vocabulary +
--                                       'custom' escape (never requires a
--                                       schema change for a new noun).
--   custom_unit_label  text          — required only when unit = 'custom'.
--   unit_value_cents   integer       — In-Kind ONLY: an optional per-unit
--                                       estimated rate. The calculated total
--                                       (quantity * unit_value_cents) is
--                                       NEVER stored — see
--                                       calculateUnitValueCents() in
--                                       src/lib/opportunity-commercial-
--                                       terms-domain.ts, computed at
--                                       read/format time only.
--
-- estimated_value_cents (Pass 1) is KEPT, not dropped — a direct,
-- admin-entered total estimated value (e.g. "Venue Space, $2,500", which
-- has no meaningful per-unit breakdown) remains fully valid, with or
-- without quantity/unit also present. estimated_value_cents and
-- unit_value_cents are mutually exclusive on one row (enforced below) —
-- an In-Kind Component is valued by EXACTLY ONE method, or not valued at
-- all ("No Value" is always valid).
--
-- Monetary components (participation_fee / compensation / project_budget)
-- keep amount_mode/amount_min_cents/amount_max_cents/currency as the ONLY
-- authoritative financial terms — this migration never derives or
-- overwrites those columns. quantity/unit on a monetary row are purely
-- DESCRIPTIVE ("$1,500 compensation, covering 3 appearances") — a per-unit
-- equivalent ("$500/appearance") is computed for display only
-- (formatMonetaryPerUnitEquivalent() in the domain module) and is never
-- stored. unit_value_cents and estimated_value_cents remain prohibited on
-- monetary components (unchanged from Pass 1, now also explicit for
-- unit_value_cents in the revised shape constraint below).

-- ---------------------------------------------------------------- 1. columns

alter table public.opportunity_option_components
  add column quantity numeric(10, 2),
  add column unit text,
  add column custom_unit_label text,
  add column unit_value_cents integer;

comment on column public.opportunity_option_components.quantity is
  'How much was contributed/covers this term (e.g. 200, 2.5, 3) -- optional, always paired with unit. Decimals allowed (numeric(10,2)) -- "2.5 hours" is a legitimate real-world Opportunity structure.';
comment on column public.opportunity_option_components.unit is
  'The unit quantity is measured in -- a fixed common vocabulary plus a custom escape hatch (custom_unit_label), so a new noun never requires a schema change. Always paired with quantity (both-or-neither).';
comment on column public.opportunity_option_components.custom_unit_label is
  'Required only when unit = ''custom'' -- the admin-entered label for a unit not in the common vocabulary, same pattern as in_kind_category = ''other'' requiring in_kind_description.';
comment on column public.opportunity_option_components.unit_value_cents is
  'In-Kind ONLY: an optional per-unit estimated rate (e.g. $2/sample). Requires quantity + unit. The calculated total (quantity * unit_value_cents) is NEVER stored here or anywhere -- computed at read/format time by calculateUnitValueCents() in src/lib/opportunity-commercial-terms-domain.ts. Mutually exclusive with estimated_value_cents on the same row (see opportunity_option_components_valuation_exclusive_check) -- an In-Kind Component is valued by exactly one method, or not at all.';

-- ---------------------------------------------------------------- 2. quantity/unit validation (both component kinds)

alter table public.opportunity_option_components
  add constraint opportunity_option_components_quantity_unit_check
  check ((quantity is null) = (unit is null));

alter table public.opportunity_option_components
  add constraint opportunity_option_components_quantity_positive_check
  check (quantity is null or quantity > 0);

alter table public.opportunity_option_components
  add constraint opportunity_option_components_unit_vocabulary_check
  check (
    unit is null or unit in (
      'units', 'samples', 'cases', 'hours', 'days', 'staff', 'locations',
      'events', 'activations', 'appearances', 'posts', 'videos', 'photos',
      'deliverables', 'attendees', 'impressions', 'custom'
    )
  );

alter table public.opportunity_option_components
  add constraint opportunity_option_components_custom_unit_label_check
  check (unit <> 'custom' or custom_unit_label is not null);

-- ---------------------------------------------------------------- 3. unit_value_cents validation (In-Kind only)

alter table public.opportunity_option_components
  add constraint opportunity_option_components_unit_value_requires_unit_check
  check (unit_value_cents is null or (quantity is not null and unit is not null));

alter table public.opportunity_option_components
  add constraint opportunity_option_components_unit_value_positive_check
  check (unit_value_cents is null or unit_value_cents > 0);

-- The one new cross-field invariant from the Pass 2.5 correction: a direct
-- total (estimated_value_cents) and a per-unit rate (unit_value_cents) can
-- never both be set on the same row -- exactly one valuation method, or
-- "No Value". Enforced here (DB) AND in validateComponent() (TypeScript) --
-- the TypeScript layer runs first and should never let a conflicting pair
-- reach this far, but this is the same defense-in-depth posture every
-- other invariant in this table already gets.
alter table public.opportunity_option_components
  add constraint opportunity_option_components_valuation_exclusive_check
  check (not (estimated_value_cents is not null and unit_value_cents is not null));

-- ---------------------------------------------------------------- 4. revised shape constraint (monetary may carry quantity/unit; still never a valuation field)

alter table public.opportunity_option_components
  drop constraint opportunity_option_components_shape_check;

alter table public.opportunity_option_components
  add constraint opportunity_option_components_shape_check
  check (
    (
      -- monetary: amount_mode + currency required; every in_kind_* field
      -- AND both valuation fields null. quantity/unit/custom_unit_label are
      -- NOT mentioned here (or in the in_kind branch below) -- deliberately
      -- unrestricted by component_type, since they're purely descriptive on
      -- a monetary row and real measurable facts on an in_kind row.
      component_type in ('participation_fee', 'compensation', 'project_budget')
      and amount_mode is not null
      and currency is not null
      and in_kind_category is null and in_kind_description is null
      and in_kind_provider is null and estimated_value_cents is null
      and unit_value_cents is null
    )
    or
    (
      -- in_kind: category + provider required; every monetary field null.
      component_type = 'in_kind'
      and in_kind_category is not null
      and in_kind_provider is not null
      and amount_mode is null and amount_min_cents is null
      and amount_max_cents is null and currency is null
    )
  );

-- ---------------------------------------------------------------- 5. aggregate persistence RPC: pass the new columns through

-- Same function, same name, same hardening (SECURITY DEFINER,
-- search_path = '', service_role-only EXECUTE, foreign-Option-id
-- rejection, stable-id preservation, one implicit transaction) --
-- see 20261010000000_opportunity_commercial_terms_persistence.sql's own
-- extensive comment for the full rationale, unchanged here. The ONLY
-- change is four more columns in the per-Component INSERT's column list
-- and VALUES tuple; every other line is identical to Pass 2.
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
      if not exists (select 1 from public.opportunity_options where id = v_option_id and listing_id = p_listing_id) then
        raise exception 'foreign_option_id';
      end if;
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
        in_kind_category, in_kind_description, in_kind_provider, in_kind_required, estimated_value_cents,
        quantity, unit, custom_unit_label, unit_value_cents, display_order
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
        nullif(v_component->>'quantity', '')::numeric(10, 2),
        v_component->>'unit',
        v_component->>'custom_unit_label',
        nullif(v_component->>'unit_value_cents', '')::integer,
        coalesce((v_component->>'display_order')::integer, 0)
      );
    end loop;

    v_order := v_order + 1;
  end loop;

  delete from public.opportunity_options
  where listing_id = p_listing_id
    and id <> all (v_incoming_ids);
end;
$$;

revoke execute on function public.replace_opportunity_options(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_opportunity_options(uuid, jsonb) to service_role;

comment on function public.replace_opportunity_options(uuid, jsonb) is
  'Opportunities Commercial Terms Admin Builder (Pass 2, extended Pass 2.5 for unit-based contribution fields): atomically replaces every Option+Component for one listing. Caller must already have validated every Option/Component through validateOption()/validateComponent() in TypeScript -- this function performs transactional integrity + defense-in-depth structural guards only. service_role only.';
