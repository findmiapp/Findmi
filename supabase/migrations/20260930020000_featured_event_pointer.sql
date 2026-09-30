-- Featured Event System — lets a Business or Location manually pin which
-- Event its public "Featured Event" hero shows, instead of always the
-- automatically-nearest one. Simple nullable FK (not a polymorphic
-- destination_type/destination_id pointer like homepage_bulletins) since
-- the target here is always exactly one type: events.
--
-- ON DELETE SET NULL is the fallback-safety mechanism for a hard-deleted
-- Event; an unpublished/archived/cancelled-but-not-deleted Event falls
-- back to automatic selection at the app layer instead (see
-- lib/featured-event.ts), because the anon-client read of `events` that
-- resolves this pointer is already RLS-gated and simply returns nothing
-- for a row that's no longer publicly visible.

alter table public.businesses
  add column if not exists featured_event_id uuid references public.events(id) on delete set null;

alter table public.locations
  add column if not exists featured_event_id uuid references public.events(id) on delete set null;

create index if not exists businesses_featured_event_id_idx
  on public.businesses (featured_event_id)
  where featured_event_id is not null;

create index if not exists locations_featured_event_id_idx
  on public.locations (featured_event_id)
  where featured_event_id is not null;

-- businesses.* is column-grant-restricted for anon/authenticated (see
-- 20260831000000_restrict_internal_commerce_columns.sql's explicit
-- allowlist) — a new column is invisible to the public anon client until
-- added to that grant. Additive: this extends the existing allowlist, it
-- does not replace it. locations has no such restriction (still the
-- Supabase-default full-row grant), so no equivalent grant is needed there.
grant select (featured_event_id) on public.businesses to anon, authenticated;
