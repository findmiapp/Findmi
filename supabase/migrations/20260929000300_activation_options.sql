-- FindMi Activations Pass 1 — activation_options.
--
-- Simple, unpriced, orderable Builder picker lists — Goals and Activation
-- Families — one table, `kind` discriminator, mirroring the exact
-- `categories.kind` pattern already proven in this codebase (business/
-- event/product/location categories share one table the same way).
-- Scoped per-Activation (never global) per audit §8/§9 — each Activation
-- gets its own Goals/Families list, which is also what makes a future
-- Duplicate Activation able to copy this table's rows safely as fresh
-- per-Activation configuration.
create table if not exists public.activation_options (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references public.activations(id) on delete cascade,

  kind text not null check (kind in ('goal', 'family')),
  label text not null,
  description text,
  icon_or_image_url text,

  sort_order integer not null default 0,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activation_options_activation_id_idx on public.activation_options (activation_id, kind, sort_order);

create trigger trg_activation_options_updated_at
  before update on public.activation_options
  for each row execute function public.set_updated_at();

alter table public.activation_options enable row level security;

-- Public read — same convention as activation_venues (simple `true`,
-- real gating lives on the published parent Activation).
create policy "Public read activation options"
  on public.activation_options
  for select
  using (true);

-- No insert/update/delete policy for anon/authenticated — admin-only via
-- requireAdminSupabase().
