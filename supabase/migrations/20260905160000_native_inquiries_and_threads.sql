-- ============================================================================
-- Native Inquiries + Private Conversation Threads V1
--
-- Extends the existing, previously-dormant `inquiries` table (0 rows,
-- never inserted into by any app code — every current "Inquire"/"Book"
-- button resolves to a Tally form or a mailto: link, see lib/forms.ts,
-- untouched by this migration) rather than building a parallel system.
-- Adds a minimal message/thread table alongside it.
-- ============================================================================

-- ── Business opt-in gate ─────────────────────────────────────────────────
-- Off by default so no existing business's page suddenly shows a new CTA
-- — same "off by default, additive" convention as commerce_enabled.
alter table public.businesses add column if not exists native_inquiries_enabled boolean not null default false;

-- businesses already has anon/authenticated SELECT revoked at the table
-- level with an explicit column grant list (see migration
-- restrict_internal_commerce_columns) — column grants are additive, so
-- this just adds the one new public-safe column to that existing list
-- rather than re-granting the whole set.
grant select (native_inquiries_enabled) on public.businesses to anon, authenticated;

-- ── inquiries: authenticated identity + product context + read state ────
alter table public.inquiries add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.inquiries add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.inquiries add column if not exists customer_last_read_at timestamptz;
alter table public.inquiries add column if not exists business_last_read_at timestamptz;

-- Workflow statuses gain "replied" (auto-set the first time a business
-- sends a message — see the app's own reply action) between the existing
-- "new" and "contacted"/"booked"/"closed", which are preserved exactly as
-- they already were (no existing row's status value is invalidated by
-- widening this set).
alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check
  check (status = any (array['new', 'replied', 'contacted', 'booked', 'closed']));

create index if not exists inquiries_user_id_idx on public.inquiries (user_id);
create index if not exists inquiries_business_id_idx on public.inquiries (business_id);
create index if not exists inquiries_product_id_idx on public.inquiries (product_id);

-- RLS: the table already has RLS enabled with one existing policy
-- ("Public insert inquiries", anon+authenticated INSERT, with_check
-- true) — untouched, since it's the one deliberate anonymous-submission
-- path this migration was told to retain safely. Everything below is
-- additive: real read/update access for the two identities that now
-- actually need it (the authenticated customer who owns a row, and an
-- authorized member of the business it belongs to). No policy here
-- grants PUBLIC or plain `anon` read access to inquiries — never.
create policy "inquiries_select_customer"
  on public.inquiries for select
  to authenticated
  using (user_id = auth.uid());

create policy "inquiries_select_business_member"
  on public.inquiries for select
  to authenticated
  using (
    business_id is not null
    and exists (
      select 1 from public.business_members bm
      where bm.business_id = inquiries.business_id and bm.user_id = auth.uid()
    )
  );

-- A native (non-legacy) inquiry is always created with user_id = the
-- inserting session's own auth.uid() — never trusted from an arbitrary
-- client value, and never any other user's id.
create policy "inquiries_insert_customer"
  on public.inquiries for insert
  to authenticated
  with check (user_id = auth.uid());

-- Deliberately NO business-member UPDATE policy on inquiries either —
-- the same column-blindness problem as the customer side, just with a
-- sharper edge: an authorized member could otherwise reassign a row's
-- own user_id (via a raw API call touching a column no UI exposes) and
-- silently hand a completely unrelated other account read access to this
-- business's private thread, or lock the real customer out of their own
-- inquiry. set_inquiry_status() below is the only write path, and it
-- only ever touches the status column.
create or replace function public.set_inquiry_status(p_inquiry_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('new', 'replied', 'contacted', 'booked', 'closed') then
    raise exception 'invalid status';
  end if;

  update public.inquiries
  set status = p_status
  where id = p_inquiry_id
    and business_id is not null
    and exists (
      select 1 from public.business_members bm
      where bm.business_id = inquiries.business_id and bm.user_id = auth.uid()
    );
end;
$$;

revoke all on function public.set_inquiry_status(uuid, text) from public, anon;
grant execute on function public.set_inquiry_status(uuid, text) to authenticated;

-- Deliberately NO customer UPDATE policy on inquiries at all — RLS is
-- row-level, not column-level, so a policy scoped only to "your own row"
-- would still let a raw API call touch status or any other business-
-- owned column on it, not just a read-timestamp. Read-state for the
-- customer side instead goes through mark_inquiry_read() below, a
-- SECURITY DEFINER function that only ever writes customer_last_read_at
-- and only for a row that row's own user_id already matches the caller —
-- the same "narrow, safe RPC instead of a broad column-blind policy"
-- pattern already used elsewhere in this schema (follow_business(),
-- qualify_referral_earning()).
create or replace function public.mark_inquiry_read(p_inquiry_id uuid, p_as text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_as = 'customer' then
    update public.inquiries
    set customer_last_read_at = now()
    where id = p_inquiry_id and user_id = auth.uid();
  elsif p_as = 'business' then
    update public.inquiries
    set business_last_read_at = now()
    where id = p_inquiry_id
      and business_id is not null
      and exists (
        select 1 from public.business_members bm
        where bm.business_id = inquiries.business_id and bm.user_id = auth.uid()
      );
  else
    raise exception 'invalid role';
  end if;
end;
$$;

revoke all on function public.mark_inquiry_read(uuid, text) from public, anon;
grant execute on function public.mark_inquiry_read(uuid, text) to authenticated;

-- ── inquiry_messages: the private thread ─────────────────────────────────
create table if not exists public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'business')),
  -- Who actually sent it, for audit only — a customer message's
  -- sender_user_id always equals that inquiry's own user_id; a business
  -- message's is the replying member's own auth id. NEVER surfaced to
  -- the customer as an identity (see this pass's own report) — the
  -- business side of a thread always renders as the BUSINESS's name,
  -- resolved server-side from inquiries.business_id, never from this
  -- column.
  sender_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.inquiry_messages enable row level security;

create index if not exists inquiry_messages_inquiry_id_idx on public.inquiry_messages (inquiry_id, created_at);

create policy "inquiry_messages_select_customer"
  on public.inquiry_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.inquiries i
      where i.id = inquiry_messages.inquiry_id and i.user_id = auth.uid()
    )
  );

create policy "inquiry_messages_select_business_member"
  on public.inquiry_messages for select
  to authenticated
  using (
    exists (
      select 1 from public.inquiries i
      join public.business_members bm on bm.business_id = i.business_id
      where i.id = inquiry_messages.inquiry_id and bm.user_id = auth.uid()
    )
  );

create policy "inquiry_messages_insert_customer"
  on public.inquiry_messages for insert
  to authenticated
  with check (
    sender_type = 'customer'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from public.inquiries i
      where i.id = inquiry_messages.inquiry_id and i.user_id = auth.uid()
    )
  );

create policy "inquiry_messages_insert_business_member"
  on public.inquiry_messages for insert
  to authenticated
  with check (
    sender_type = 'business'
    and sender_user_id = auth.uid()
    and exists (
      select 1 from public.inquiries i
      join public.business_members bm on bm.business_id = i.business_id
      where i.id = inquiry_messages.inquiry_id and bm.user_id = auth.uid()
    )
  );

-- No UPDATE/DELETE policy for any non-service role — messages are
-- immutable once sent, per this pass's own "No editing/deleting sent
-- messages" instruction; RLS enforces that, not just the UI omitting a
-- delete button.

grant select, insert on public.inquiry_messages to authenticated;
