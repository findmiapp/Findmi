-- Admin Content Lifecycle + Bulk Management V1 — Products (reference
-- implementation of the reusable lifecycle pattern; see the accompanying
-- code pass for the full write-up).
--
-- archived_at / trashed_at are deliberately ADDITIVE and orthogonal to
-- every existing lifecycle/publication signal on this table (is_active,
-- moderation_status, marketplace_status — all of which already have
-- their own distinct meanings, including a real "Pause" concept via
-- marketplace_status='paused'). Neither existing flag is touched,
-- renamed, or reinterpreted by this migration. Archiving/trashing a
-- product never mutates is_active/moderation_status/marketplace_status,
-- which is precisely what makes "Restore" safe without a separate
-- previous-state snapshot column: restoring just clears the one
-- timestamp, and whatever is_active/moderation_status/marketplace_status
-- already held is exactly what it returns to.
--
-- trashed_at can be set independent of archived_at (an active OR an
-- archived record can be trashed directly), and archived_at is left
-- untouched when trashing — so ARCHIVED -> TRASH -> RESTORE correctly
-- returns to ARCHIVED (archived_at is still set), not to fully active.
alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz;

comment on column public.products.archived_at is
  'Admin Content Lifecycle V1. Intentionally retired from normal use; hidden from public/discovery and the default admin list, recoverable via Restore. NULL = not archived. Independent of is_active/moderation_status/marketplace_status (existing Pause/moderation mechanisms) — never set by pausing.';
comment on column public.products.trashed_at is
  'Admin Content Lifecycle V1. Soft-deleted; hidden from public/discovery and every normal admin view (Active/Paused/Archived), recoverable via Restore. NULL = not trashed. May coexist with archived_at (trashed while still archived) so restoring from Trash can return a record to Archived rather than fully active.';

-- Canonical public-safety enforcement layer: the existing RLS policy
-- already gates public/anon SELECT on is_active/moderation_status —
-- extending it here (rather than relying on every future query author to
-- remember two more NULL checks) means archived/trashed products are
-- unreachable through ANY current or future public/anon query path,
-- including ones this pass never touches.
drop policy if exists "Public read active products" on public.products;
create policy "Public read active products" on public.products
  for select
  to public
  using (
    is_active = true
    and moderation_status = 'live'
    and archived_at is null
    and trashed_at is null
  );

create index if not exists products_archived_at_idx on public.products (archived_at) where archived_at is not null;
create index if not exists products_trashed_at_idx on public.products (trashed_at) where trashed_at is not null;
