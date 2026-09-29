-- FindMi Activations Pass 1 — security correction.
--
-- activation_venues/activation_options/activation_inventory originally
-- shipped with `using (true)` public SELECT policies, reasoning that
-- "real gating lives on the parent Activation." That reasoning only
-- holds if the parent is unreachable except through an already-published
-- Activation — it does not hold against a direct REST/PostgREST query
-- against the child table itself, which bypasses any application-level
-- check. An unpublished/draft Activation's venues, Builder configuration
-- (Goals/Families), and inventory/pricing configuration must not be
-- publicly selectable merely because the child table's own row-level
-- policy allowed it unconditionally.
--
-- Corrected: each child table's public SELECT policy now requires an
-- EXISTS match against activations.is_published = true — the same
-- predicate activations' own "Public read published activations" policy
-- already uses, so a published Activation's permitted rows remain
-- exactly as publicly readable as before. Column-level grants
-- (activation_inventory's internal_estimated_value/requirements
-- restriction) are untouched. No public write policy is added or
-- implied by this change.

drop policy if exists "Public read activation venues" on public.activation_venues;
create policy "Public read activation venues"
  on public.activation_venues
  for select
  using (
    exists (
      select 1
      from public.activations a
      where a.id = activation_venues.activation_id
        and a.is_published = true
    )
  );

drop policy if exists "Public read activation options" on public.activation_options;
create policy "Public read activation options"
  on public.activation_options
  for select
  using (
    exists (
      select 1
      from public.activations a
      where a.id = activation_options.activation_id
        and a.is_published = true
    )
  );

drop policy if exists "Public read activation inventory" on public.activation_inventory;
create policy "Public read activation inventory"
  on public.activation_inventory
  for select
  using (
    exists (
      select 1
      from public.activations a
      where a.id = activation_inventory.activation_id
        and a.is_published = true
    )
  );
