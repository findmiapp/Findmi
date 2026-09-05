-- ============================================================================
-- Business Order Management Overhaul V1
--
-- Extends the existing, already-mature orders/order_items/
-- vendor_order_allocations schema (multi-vendor split by order_items.
-- business_id, fee/commission snapshots, immutable price/quantity
-- snapshots — all already correct and untouched here) rather than
-- building a competing system. Adds only:
--   1. orders.user_id — optional authenticated-account link, so a signed-
--      in customer's own order history can be shown (guest checkout is
--      completely unaffected; this is populated only when startCheckout
--      is called by a signed-in session, never backfilled/guessed for
--      existing orders).
--   2. order_items.internal_note — a business-private fulfillment note.
--   3. order_items.fulfillment_status widened from a plain unfulfilled/
--      fulfilled toggle to a real workflow (new/confirmed/ready/
--      fulfilled/cancelled). Every existing row is 'unfulfilled' (6
--      rows in production) — backfilled to 'new' (the natural "not yet
--      handled" starting state) before the constraint is narrowed, so no
--      row is ever left violating it.
--   4. Customer-facing read RLS (orders/order_items were previously
--      RLS-enabled with ZERO policies — service-role/admin-client only).
--      Business-side reads/writes deliberately do NOT get a new RLS
--      policy here — Business Manager's Orders tab uses the same
--      authorize-then-elevate shape (requireBusinessMember() on the
--      session client, then the admin/service-role client for the
--      actual read/write, always filtered by business_id) already
--      established for Followers and Inquiries in this same app, rather
--      than a harder-to-verify multi-table RLS join over financial data.
-- ============================================================================

alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on public.orders (user_id);

alter table public.order_items add column if not exists internal_note text;
alter table public.order_items add constraint order_items_internal_note_length check (internal_note is null or char_length(internal_note) <= 500);

-- Drop the old (unfulfilled/fulfilled-only) constraint BEFORE
-- backfilling — the backfill's own new value ('new') would otherwise
-- violate it mid-migration, since it isn't in that old allowed set.
alter table public.order_items drop constraint if exists order_items_fulfillment_status_check;

update public.order_items set fulfillment_status = 'new' where fulfillment_status = 'unfulfilled';

alter table public.order_items add constraint order_items_fulfillment_status_check
  check (fulfillment_status = any (array['new', 'confirmed', 'ready', 'fulfilled', 'cancelled']));

-- ── Customer-facing read access (previously none at all) ────────────────
-- Read-only: a customer never writes to orders/order_items directly in
-- this design (order creation stays admin-client-only inside
-- createPendingOrder, completely untouched by this migration).
create policy "orders_select_own"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid());

create policy "order_items_select_own_customer"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );
