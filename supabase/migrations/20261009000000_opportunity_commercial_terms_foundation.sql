-- Opportunities — Commercial Terms Foundation (Schema + Domain, Pass 1).
--
-- NOT YET APPLIED TO PRODUCTION. Purely additive — no existing column on
-- opportunity_listings (pricing_mode, price_cents, currency,
-- credits_eligible) is touched, renamed, or backfilled. No existing row is
-- rewritten. This migration creates the NEW structured-terms foundation
-- (Opportunity -> Option -> Component) alongside the existing legacy
-- pricing columns; nothing here migrates or reinterprets legacy content.
-- The Admin authoring UI, Business presentation, and legacy-row
-- classification are later, separate passes.
--
-- Conceptual model:
--   opportunity_options            — one alternative commercial
--                                    configuration of an Opportunity. Every
--                                    newly-authored Opportunity will
--                                    eventually have at least one row here
--                                    (not created automatically by this
--                                    migration — no rows are backfilled for
--                                    existing listings).
--   opportunity_option_components  — the structured terms that apply
--                                    TOGETHER within one Option (at most one
--                                    monetary component + zero or more
--                                    in-kind components).
--
-- Access model is the same as opportunity_listings / opportunity_recipients
-- / business_opportunity_goals: RLS enabled with NO anon/authenticated
-- policies or grants — no client key can read or write either table. Every
-- read/write is server-side through the service role after the app's own
-- authorization (requireBusinessMember for Business reads,
-- requireAdmin for Findmi Admin writes) — this migration does not weaken
-- or change that model.
--
-- Value lists mirror src/lib/opportunity-commercial-terms-domain.ts —
-- change both together.

-- ---------------------------------------------------------------- 1. options

create table public.opportunity_options (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.opportunity_listings (id) on delete cascade,
  -- Presentation only (e.g. "Resident Demo + Content") — never a substitute
  -- for the structured components underneath. Null is fine: the common
  -- single-option case has no reason to show a name at all.
  name               text,
  description        text,
  -- STRUCTURED = at least one monetary component (participation_fee /
  -- compensation / project_budget) OR at least one REQUIRED in_kind
  -- component. COMPLIMENTARY = Admin deliberately chose no required
  -- commercial consideration — zero monetary components, zero REQUIRED
  -- in_kind components, but zero OR MORE OPTIONAL in_kind components ARE
  -- allowed ("Complimentary + optional product support" is a real,
  -- distinct, meaningful state — not the same as having no components at
  -- all). CUSTOM = Admin deliberately chose an unstructured/negotiated
  -- arrangement (zero Components of any kind, an optional free-text note
  -- instead). commercial_mode is never inferred from row count alone in
  -- either direction — it is validated to stay CONSISTENT with the actual
  -- component content by the triggers below, so the stored mode is always
  -- a true classification, not just a label.
  commercial_mode    text not null default 'structured',
  custom_terms_note  text,
  display_order      integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint opportunity_options_name_check
    check (name is null or char_length(name) between 1 and 120),
  constraint opportunity_options_description_check
    check (description is null or char_length(description) <= 280),
  constraint opportunity_options_commercial_mode_check
    check (commercial_mode in ('structured', 'complimentary', 'custom')),
  constraint opportunity_options_custom_terms_note_check
    check (custom_terms_note is null or char_length(custom_terms_note) <= 500),
  -- custom_terms_note only ever means something on a CUSTOM option.
  constraint opportunity_options_custom_note_mode_check
    check (commercial_mode = 'custom' or custom_terms_note is null)
  -- NOTE: "a STRUCTURED option must have a monetary term or a required
  -- In-Kind Component once authoring is complete" is NOT a CHECK
  -- constraint here — a plain CHECK cannot see rows in another table, and
  -- there is no "draft vs. complete" state in this foundation pass to
  -- anchor a deferred constraint against. Persistence contract for the
  -- upcoming Admin builder (Pass 2): an Option and its Components are
  -- written together through ONE validated aggregate write (an RPC/
  -- transaction, the same SECURITY DEFINER pattern already established by
  -- approve_pro_access_request for Pro Access Request — see
  -- 20261008000000_business_pro_access_requests.sql) — never as two
  -- separate sequential client inserts that could leave a structured
  -- option transiently empty if the second write failed. validateOption()
  -- in the domain module is the single pre-write gate that aggregate
  -- write calls; it is the one and only place "complete" is decided. The
  -- REVERSE direction — which Component shapes a given mode may ever own,
  -- regardless of completeness — IS a real per-insert, per-table
  -- invariant and IS enforced at the DB layer below via trigger, since
  -- that one is cleanly checkable at write time.
);

create index opportunity_options_listing_idx
  on public.opportunity_options (listing_id, display_order);

drop trigger if exists trg_opportunity_options_updated_at on public.opportunity_options;
create trigger trg_opportunity_options_updated_at
  before update on public.opportunity_options
  for each row execute function public.set_updated_at();

alter table public.opportunity_options enable row level security;
revoke all on public.opportunity_options from anon, authenticated;
grant all on public.opportunity_options to service_role;

comment on table public.opportunity_options is
  'Opportunities Commercial Terms Foundation: one alternative commercial configuration of an Opportunity. Every Opportunity has >=1 row once authored through the new flow; the common single-option case is never shown as "an option" in the UI. Server-only access (no client policies) — see src/lib/opportunity-listings.ts.';
comment on column public.opportunity_options.commercial_mode is
  'structured = a monetary Component (participation_fee/compensation/project_budget) or a REQUIRED in_kind Component. complimentary = no monetary Component and no REQUIRED in_kind Component -- zero or more OPTIONAL in_kind Components are explicitly allowed ("Complimentary + optional product support" is a real, distinct state). custom = no Components of any kind, optional custom_terms_note. Row count alone never implies a mode -- see the two mode-consistency triggers on opportunity_option_components / opportunity_options.';

-- ---------------------------------------------------------------- 2. components

create table public.opportunity_option_components (
  id                     uuid primary key default gen_random_uuid(),
  option_id              uuid not null references public.opportunity_options (id) on delete cascade,
  component_type         text not null,

  -- Monetary fields — meaningful only when component_type is one of
  -- participation_fee / compensation / project_budget. At most ONE
  -- monetary component may exist per option (enforced by the partial
  -- unique index below) — different Options on the same Opportunity may
  -- each use a different monetary component_type.
  amount_mode            text,
  amount_min_cents       integer,
  amount_max_cents       integer,
  currency               text,

  -- In-Kind fields — meaningful only when component_type = 'in_kind'.
  -- `recipient_business` deliberately names the Business this Opportunity/
  -- Option is being presented to (the one with the opportunity_recipients
  -- row) — NEVER the Opportunity's creator in general. This distinction
  -- matters once Opportunities can originate from brands/venues/organizers
  -- (not built yet): the recipient Business providing product is a
  -- different fact from "whoever created this Opportunity" providing it.
  in_kind_category       text,
  in_kind_description    text,
  in_kind_provider       text,
  in_kind_required       boolean not null default true,
  estimated_value_cents  integer,

  display_order          integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint opportunity_option_components_type_check
    check (component_type in ('participation_fee', 'compensation', 'project_budget', 'in_kind')),

  constraint opportunity_option_components_amount_mode_check
    check (amount_mode is null or amount_mode in ('fixed', 'starting_at', 'range', 'undisclosed')),
  constraint opportunity_option_components_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint opportunity_option_components_amount_positive_check
    check (
      (amount_min_cents is null or amount_min_cents > 0)
      and (amount_max_cents is null or amount_max_cents > 0)
    ),

  -- Monetary vs. In-Kind fields are mutually exclusive on one row, and each
  -- side's own fields are required/forbidden together with its type.
  constraint opportunity_option_components_shape_check
    check (
      (
        -- monetary: amount_mode + currency required; every in_kind_* field null.
        component_type in ('participation_fee', 'compensation', 'project_budget')
        and amount_mode is not null
        and currency is not null
        and in_kind_category is null and in_kind_description is null
        and in_kind_provider is null and estimated_value_cents is null
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
    ),

  -- Amount shape per mode: fixed/starting_at need only a floor; range needs
  -- both bounds (max >= min); undisclosed needs neither (direction is
  -- known, the number isn't published yet).
  constraint opportunity_option_components_amount_shape_check
    check (
      amount_mode is null
      or (amount_mode in ('fixed', 'starting_at') and amount_min_cents is not null and amount_max_cents is null)
      or (amount_mode = 'range' and amount_min_cents is not null and amount_max_cents is not null and amount_max_cents >= amount_min_cents)
      or (amount_mode = 'undisclosed' and amount_min_cents is null and amount_max_cents is null)
    ),

  constraint opportunity_option_components_in_kind_category_check
    check (in_kind_category is null or in_kind_category in ('product_samples', 'staffing', 'equipment', 'space_venue', 'services', 'content_media', 'promotion', 'other')),
  constraint opportunity_option_components_in_kind_provider_check
    check (in_kind_provider is null or in_kind_provider in ('recipient_business', 'findmi', 'organizer', 'other')),
  constraint opportunity_option_components_in_kind_description_check
    check (in_kind_description is null or char_length(in_kind_description) <= 1000),
  -- "Other" is only useful with a description; every other category can
  -- stand on its own (the category label already says what it is).
  constraint opportunity_option_components_in_kind_other_check
    check (in_kind_category <> 'other' or (in_kind_description is not null and char_length(btrim(in_kind_description)) > 0)),
  constraint opportunity_option_components_estimated_value_check
    check (estimated_value_cents is null or estimated_value_cents > 0)
);

-- At most one monetary component per Option — a plain partial unique
-- index on option_id, scoped to the three monetary types, same pattern as
-- business_pro_access_requests_one_pending.
create unique index opportunity_option_components_one_monetary_idx
  on public.opportunity_option_components (option_id)
  where component_type in ('participation_fee', 'compensation', 'project_budget');

create index opportunity_option_components_option_idx
  on public.opportunity_option_components (option_id, display_order);

drop trigger if exists trg_opportunity_option_components_updated_at on public.opportunity_option_components;
create trigger trg_opportunity_option_components_updated_at
  before update on public.opportunity_option_components
  for each row execute function public.set_updated_at();

-- A CUSTOM option can never own a Component row. A COMPLIMENTARY option
-- may own ONLY optional (in_kind_required = false) In-Kind rows — never a
-- monetary component, never a REQUIRED In-Kind row (the reverse — a
-- STRUCTURED option having zero qualifying rows mid-authoring — is a
-- domain/application-layer concern enforced by the single aggregate-write
-- path described on opportunity_options above, not by this trigger). This
-- is the one real cross-table invariant worth a trigger here: narrow,
-- single-purpose, mirroring no new mechanism beyond what set_updated_at
-- already establishes as this codebase's trigger pattern.
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
  if v_mode = 'complimentary' and new.component_type = 'in_kind' and new.in_kind_required = false then
    return new;
  end if;
  raise exception 'opportunity_option_components: option % is % and cannot own this Component (only an optional In-Kind row is allowed on a Complimentary option)', new.option_id, v_mode;
end;
$$;

drop trigger if exists trg_opportunity_option_components_mode_check on public.opportunity_option_components;
create trigger trg_opportunity_option_components_mode_check
  before insert or update on public.opportunity_option_components
  for each row execute function public.check_option_component_commercial_mode();

-- Symmetric guard: an option can't be switched to CUSTOM while it owns any
-- Component, and can't be switched to COMPLIMENTARY while it owns a
-- monetary or REQUIRED In-Kind Component (existing OPTIONAL In-Kind rows
-- are fine and simply stay). Switching TO structured is always allowed —
-- structured accepts any existing row shape.
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
      and not (component_type = 'in_kind' and in_kind_required = false)
  ) then
    raise exception 'opportunity_options: % cannot be set to complimentary while it owns a monetary or required In-Kind Component', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunity_options_mode_change_check on public.opportunity_options;
create trigger trg_opportunity_options_mode_change_check
  before update of commercial_mode on public.opportunity_options
  for each row execute function public.check_option_mode_change_allowed();

alter table public.opportunity_option_components enable row level security;
revoke all on public.opportunity_option_components from anon, authenticated;
grant all on public.opportunity_option_components to service_role;

comment on table public.opportunity_option_components is
  'Opportunities Commercial Terms Foundation: the structured terms that apply TOGETHER within one Option. At most one monetary component (participation_fee | compensation | project_budget) per Option, plus zero or more in_kind components. Server-only access (no client policies).';
comment on column public.opportunity_option_components.in_kind_provider is
  'recipient_business = the Business this Opportunity/Option is presented to (never the Opportunity''s creator in general). findmi / organizer / other name who else may provide in-kind value. Not a generalized party ledger — just enough to render "who provides this" correctly and to stay compatible with future non-Findmi-authored Opportunities.';
