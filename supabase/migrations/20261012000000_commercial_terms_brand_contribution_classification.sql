-- Opportunities — Commercial Terms classification correction.
--
-- Replaces the bodies of the two commercial_mode-consistency trigger
-- functions created by 20261009000000_opportunity_commercial_terms_
-- foundation.sql. No table, column, constraint, index, grant, trigger
-- binding or row is touched: CREATE OR REPLACE keeps each function's
-- owner, privileges and the existing triggers that call it.
--
-- Why: the original rules counted EVERY required In-Kind row, whoever
-- provided it. A deal with no fee and nothing required from the Business,
-- where Findmi (or an organizer) provides staff or space, could therefore
-- never be Complimentary. commercial_mode classifies the BUSINESS's side
-- of the deal, so only two things make an Option Structured:
--   - a monetary row (participation_fee / compensation / project_budget)
--   - an In-Kind row REQUIRED FROM THE RECIPIENT BUSINESS
-- Inclusions from Findmi / organizer / other never do.
--
-- Provider null handling: coalesce(in_kind_provider, 'recipient_business')
-- — a missing provider counts as the recipient Business (the strict side).
-- The existing opportunity_option_components_shape_check already requires
-- in_kind_provider on every In-Kind row, so this only matters if that
-- constraint were ever bypassed. Mirrors isRequiredBrandContribution() in
-- src/lib/opportunity-commercial-terms-domain.ts — change both together.
--
-- Effect on data: this only LOOSENS what a Complimentary Option may own.
-- Every row valid before stays valid. Structured Options are unaffected by
-- either function (both return early for 'structured'). The "a Structured
-- Option needs money or a required brand contribution" direction remains
-- a domain-layer rule (validateOption), exactly as before.

create or replace function public.check_option_component_commercial_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mode text;
begin
  select commercial_mode into v_mode from public.opportunity_options where id = new.option_id;
  if v_mode = 'structured' then
    return new;
  end if;
  -- A Complimentary Option may own In-Kind rows that are optional, or that
  -- someone other than the recipient Business provides. Never money, and
  -- never something required from the Business.
  if v_mode = 'complimentary'
     and new.component_type = 'in_kind'
     and not (new.in_kind_required and coalesce(new.in_kind_provider, 'recipient_business') = 'recipient_business') then
    return new;
  end if;
  raise exception 'opportunity_option_components: option % is % and cannot own this Component (a Complimentary option may only own optional or non-Business-provided In-Kind rows)', new.option_id, v_mode;
end;
$$;

create or replace function public.check_option_mode_change_allowed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.commercial_mode = 'structured' then
    return new;
  end if;
  if new.commercial_mode = 'custom' and exists (
    select 1 from public.opportunity_option_components where option_id = new.id
  ) then
    raise exception 'opportunity_options: % cannot be set to custom while it still owns Components', new.id;
  end if;
  if new.commercial_mode = 'complimentary' and exists (
    select 1 from public.opportunity_option_components
    where option_id = new.id
      and (
        component_type <> 'in_kind'
        or (in_kind_required and coalesce(in_kind_provider, 'recipient_business') = 'recipient_business')
      )
  ) then
    raise exception 'opportunity_options: % cannot be set to complimentary while it owns a monetary Component or something required from the Business', new.id;
  end if;
  return new;
end;
$$;
