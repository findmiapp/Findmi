-- ============================================================================
-- Product Want / Demand — the ONE canonical "this person wants this Product"
-- relationship.
--
-- Distinct from Save (account_saved_products — a bookmark) and from
-- Marketplace (commerce). A Product can be Wanted whatever its Marketplace
-- state; Wanting never creates a Save and Saving never creates a Want.
--
-- Identity — exactly one of:
--   user_id  a signed-in account (canonical whenever signed in)
--   email    a signed-out visitor's interest, normalized lower(trim) by the
--            server before insert. NOT verified, so it is never attributed
--            to an account automatically (see product_want_counts for how
--            it is still counted once).
-- One row per identity per Product (partial unique indexes): repeated taps
-- update the same row. Un-Want sets removed_at (history kept for future
-- conversion attribution: Wanted → Marketplace-enabled → purchased);
-- re-Want clears it. Counts only include rows with removed_at IS NULL.
-- source / source_channel record where the Want came from (product_page,
-- product_card, saved_sheet, …; channel like the cart's
-- "business:<slug>").
--
-- Privacy: Businesses NEVER read this table. RLS lets a signed-in person
-- read/write only their own rows; signed-out email rows are written by the
-- server (service role) only. Business Manager gets aggregate counts via
-- product_want_counts(), executable by service_role only, after the app
-- has checked Business membership.
--
-- Backfill: the existing Product "want" rows in user_entity_relationships
-- (the Save sheet's Want classification — 1 row in production when this
-- was written) are COPIED here so Things I Want keeps them. The source rows
-- are left untouched (not deleted); the app stops reading Product "want"
-- from user_entity_relationships.
--
-- Additive only: new table, indexes, policies, one function. No existing
-- Product / Save / order row is modified.
-- ============================================================================

create table if not exists public.product_wants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,
  email           text,
  source          text,
  source_channel  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  removed_at      timestamptz,
  constraint product_wants_one_identity check ((user_id is not null) <> (email is not null)),
  constraint product_wants_email_normalized check (email is null or (email = lower(btrim(email)) and length(email) between 3 and 320)),
  constraint product_wants_source_len check (source is null or length(source) <= 40),
  constraint product_wants_channel_len check (source_channel is null or length(source_channel) <= 120)
);

create unique index if not exists product_wants_user_unique on public.product_wants (product_id, user_id) where user_id is not null;
create unique index if not exists product_wants_email_unique on public.product_wants (product_id, email) where email is not null;
create index if not exists product_wants_active_product_idx on public.product_wants (product_id) where removed_at is null;
create index if not exists product_wants_user_idx on public.product_wants (user_id) where user_id is not null;

alter table public.product_wants enable row level security;
revoke all on public.product_wants from anon, authenticated;
grant select, insert, update on public.product_wants to authenticated;
grant all on public.product_wants to service_role;

drop policy if exists "Own product wants read" on public.product_wants;
create policy "Own product wants read" on public.product_wants
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own product wants insert" on public.product_wants;
create policy "Own product wants insert" on public.product_wants
  for insert to authenticated with check (auth.uid() = user_id and email is null);
drop policy if exists "Own product wants update" on public.product_wants;
create policy "Own product wants update" on public.product_wants
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id and email is null);

comment on table public.product_wants is
  'Canonical Product Want/demand. Not Save, not Marketplace. Businesses only ever see aggregate counts (product_want_counts).';

-- Aggregate demand — counts only, never identities. A signed-out email Want
-- whose email matches the VERIFIED email of an account that also Wants the
-- same Product is the same person: counted once (no attribution is made).
create or replace function public.product_want_counts(p_product_ids uuid[])
returns table (product_id uuid, want_count bigint, recent_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select w.product_id,
         count(*)::bigint as want_count,
         count(*) filter (where w.created_at >= now() - interval '30 days')::bigint as recent_count
  from public.product_wants w
  where w.product_id = any (p_product_ids)
    and w.removed_at is null
    and not (
      w.email is not null
      and exists (
        select 1
        from public.product_wants u
        join auth.users au on au.id = u.user_id
        where u.product_id = w.product_id
          and u.removed_at is null
          and au.email_confirmed_at is not null
          and lower(au.email) = w.email
      )
    )
  group by w.product_id
$$;

revoke all on function public.product_want_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.product_want_counts(uuid[]) to service_role;

-- Backfill (copy, never move) the Save sheet's existing Product "want" rows.
insert into public.product_wants (product_id, user_id, source, created_at, updated_at)
select r.entity_id, r.user_id, 'saved_sheet', r.created_at, r.created_at
from public.user_entity_relationships r
join public.products p on p.id = r.entity_id
where r.entity_type = 'product' and r.relation = 'want'
on conflict (product_id, user_id) where user_id is not null do nothing;
