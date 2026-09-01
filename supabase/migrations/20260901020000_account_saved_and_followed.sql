-- ============================================================================
-- Phase 2: account-backed Saved + Following
-- Adds FOUR new tables. Touches nothing else. Fully additive.
--
-- NOT APPLIED YET. Created for review only, per this pass's explicit
-- instruction — apply_migration must not be run against this file until
-- explicit separate approval is given.
--
-- Distinct from the existing `followers` / `event_followers` tables
-- (marketing email-capture, keyed by (business_id/event_id, email), no
-- account required at all) — those are untouched by this migration and
-- keep their existing meaning/behavior. These four tables are a separate,
-- new concept: "this authenticated FindMi account has saved/followed this
-- record," keyed by auth.users(id). Used by /account/saved,
-- /account/following, and the public Save/Follow controls once a visitor
-- is signed in; a signed-out visitor keeps using the existing per-device
-- localStorage lists (lib/saved.ts, lib/followed.ts) exactly as before.
-- ============================================================================

create table if not exists public.account_saved_businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);

create table if not exists public.account_saved_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create table if not exists public.account_saved_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.account_followed_businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, business_id)
);

alter table public.account_saved_businesses enable row level security;
alter table public.account_saved_events enable row level security;
alter table public.account_saved_products enable row level security;
alter table public.account_followed_businesses enable row level security;

-- Strictly self-only, all four tables. No public/anon policy exists at
-- all, so RLS's default-deny means an unauthenticated visitor or any
-- other user's rows are never visible or writable — there is no path to
-- read or change someone else's saved/followed records. No UPDATE policy
-- either: these are pure presence rows (saved vs. not saved), so a toggle
-- is always an insert or a delete, never an update.

create policy "account_saved_businesses_select_own"
  on public.account_saved_businesses for select
  to authenticated
  using (auth.uid() = user_id);
create policy "account_saved_businesses_insert_own"
  on public.account_saved_businesses for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "account_saved_businesses_delete_own"
  on public.account_saved_businesses for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "account_saved_events_select_own"
  on public.account_saved_events for select
  to authenticated
  using (auth.uid() = user_id);
create policy "account_saved_events_insert_own"
  on public.account_saved_events for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "account_saved_events_delete_own"
  on public.account_saved_events for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "account_saved_products_select_own"
  on public.account_saved_products for select
  to authenticated
  using (auth.uid() = user_id);
create policy "account_saved_products_insert_own"
  on public.account_saved_products for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "account_saved_products_delete_own"
  on public.account_saved_products for delete
  to authenticated
  using (auth.uid() = user_id);

create policy "account_followed_businesses_select_own"
  on public.account_followed_businesses for select
  to authenticated
  using (auth.uid() = user_id);
create policy "account_followed_businesses_insert_own"
  on public.account_followed_businesses for insert
  to authenticated
  with check (auth.uid() = user_id);
create policy "account_followed_businesses_delete_own"
  on public.account_followed_businesses for delete
  to authenticated
  using (auth.uid() = user_id);

-- Supports the /account/saved and /account/following list queries
-- (WHERE user_id = auth.uid()), and the per-item existence checks the
-- Save/Follow toggle endpoints run before insert/delete.
create index if not exists account_saved_businesses_user_id_idx on public.account_saved_businesses (user_id);
create index if not exists account_saved_events_user_id_idx on public.account_saved_events (user_id);
create index if not exists account_saved_products_user_id_idx on public.account_saved_products (user_id);
create index if not exists account_followed_businesses_user_id_idx on public.account_followed_businesses (user_id);
