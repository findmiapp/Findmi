-- FindMi Activations Pass 1 — activation_inventory.
--
-- Sellable/configurable inventory — Space, Timing (a COMMERCIAL
-- DURATION/OFFERING such as "2-hour activation" or "Full Day," never an
-- actual calendar booking slot — that belongs to later architecture, not
-- Pass 1), and Add-ons — one table, `kind` discriminator, same economy
-- as activation_options above. Scoped per-Activation, optionally further
-- scoped to one activation_venue (null = activation-wide, e.g. most
-- add-ons).
--
-- Price visibility (Amendment §5 — the corrected model): price_visibility
-- is nullable text sharing the EXACT same domain as
-- activations.default_price_visibility ('visible'/'hidden'/
-- 'custom_label'); null means "inherit the Activation's default." This
-- replaces the originally-proposed nullable boolean, which could not
-- represent the 'custom_label' state.
--
-- relevant_category_ids reuses the EXISTING categories table (kind=
-- 'business') via a plain uuid[] column — deliberately not a join table:
-- pure many-to-many tagging with no independent lifecycle of its own
-- (see audit §39's own test). internal_estimated_value is always
-- populated for Admin regardless of public price_visibility, and is
-- restricted from public/anon select below, same as requirements
-- (ops-facing only, not meant for public Builder display in Pass 1).
create table if not exists public.activation_inventory (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references public.activations(id) on delete cascade,
  venue_id uuid references public.activation_venues(id) on delete set null,

  kind text not null check (kind in ('space', 'timing', 'addon')),
  name text not null,
  description text,
  image_url text,

  capacity integer,

  price_type text not null default 'fixed'
    check (price_type in ('fixed', 'starting_at', 'custom', 'included', 'free')),
  price_amount numeric,
  price_label text,
  internal_estimated_value numeric,
  price_visibility text
    check (price_visibility is null or price_visibility in ('visible', 'hidden', 'custom_label')),

  relevant_category_ids uuid[],
  requirements text,

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activation_inventory_activation_id_idx on public.activation_inventory (activation_id, kind, sort_order);
create index if not exists activation_inventory_venue_id_idx on public.activation_inventory (venue_id);

create trigger trg_activation_inventory_updated_at
  before update on public.activation_inventory
  for each row execute function public.set_updated_at();

alter table public.activation_inventory enable row level security;

create policy "Public read activation inventory"
  on public.activation_inventory
  for select
  using (true);

-- No insert/update/delete policy for anon/authenticated — admin-only via
-- requireAdminSupabase().

-- Column-level grant (same pattern as activations' own migration and
-- 20260831192751_restrict_internal_commerce_columns.sql) — the row-level
-- policy above is `using (true)`, so without this, a direct REST call
-- with only the anon key could read internal_estimated_value and
-- requirements regardless of price_visibility. service_role is
-- untouched.
revoke select on public.activation_inventory from anon, authenticated;

grant select (
  id, activation_id, venue_id, kind, name, description, image_url,
  capacity, price_type, price_amount, price_label, price_visibility,
  relevant_category_ids, sort_order, is_active, created_at, updated_at
) on public.activation_inventory to anon, authenticated;

-- Intentionally NOT granted to anon/authenticated (internal-only):
--   internal_estimated_value, requirements
