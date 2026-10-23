-- Commercial Inquiry v1.
--
-- A Commercial Inquiry is a Business's EXPLICIT, outward request — made
-- deliberately from a private Target (or directly) — asking Findmi to help
-- connect it with exactly one counterparty (a Business, a Location or an
-- Event) about ONE commercial intent. It is its own domain object: never a
-- Target (which stays private), never an event-participation Opportunity
-- (event_participation routes to that existing workflow instead), never a
-- Findmi Opportunity listing / recipient, never an Order.
--
-- Additive only:
--   1. commercial_inquiries — exactly one typed counterparty FK; ONE intent
--      (the canonical vocabulary minus event_participation); a small
--      lifecycle (sent → responded → accepted / declined; withdrawn by the
--      sender; closed by Findmi). The private Target is referenced only by
--      target_id (ON DELETE SET NULL) — none of its Context, Activity, Next
--      Action, status or internal notes is copied here.
--   2. routed_entity_type / routed_entity_id — who on the other side was
--      SAFELY resolved at send time (verified members only); null means
--      Findmi mediates alone (Sender ↔ Findmi).
--   3. Idempotency: one Inquiry per (sender, request_key) — a double tap or
--      retry of the same send resolves to the same row; and at most one OPEN
--      (sent / responded) Inquiry per sender + counterparty + intent — a
--      Placement and a Pop-Up Inquiry to the same place may both be open, and
--      a new same-intent Inquiry is possible once the previous one is resolved.
--   4. One Conversation per Inquiry (reusing conversations; subject_type
--      'commercial_inquiry', subject_id = the Inquiry), unique both ways.
-- RLS on with no client policies; service_role only. No existing row changes.
-- Nothing is removed or replaced destructively.

create table if not exists public.commercial_inquiries (
  id                        uuid primary key default gen_random_uuid(),
  sender_business_id        uuid not null
    constraint commercial_inquiries_sender_business_id_fkey references public.businesses(id) on delete cascade,
  target_id                 uuid
    constraint commercial_inquiries_target_id_fkey references public.business_targets(id) on delete set null,
  counterparty_business_id  uuid
    constraint commercial_inquiries_counterparty_business_id_fkey references public.businesses(id) on delete cascade,
  counterparty_location_id  uuid
    constraint commercial_inquiries_counterparty_location_id_fkey references public.locations(id) on delete cascade,
  counterparty_event_id     uuid
    constraint commercial_inquiries_counterparty_event_id_fkey references public.events(id) on delete cascade,
  intent                    text not null
    constraint commercial_inquiries_intent_check check (
      intent in ('placement', 'wholesale', 'distribution', 'collaboration', 'sponsorship', 'sampling', 'activation', 'pop_up', 'vending', 'content', 'booking')
    ),
  status                    text not null default 'sent'
    constraint commercial_inquiries_status_check check (status in ('sent', 'responded', 'accepted', 'declined', 'withdrawn', 'closed')),
  message                   text
    constraint commercial_inquiries_message_check check (message is null or char_length(btrim(message)) between 1 and 2000),
  conversation_id           uuid
    constraint commercial_inquiries_conversation_id_fkey references public.conversations(id) on delete set null,
  routed_entity_type        text
    constraint commercial_inquiries_routed_entity_type_check check (routed_entity_type is null or routed_entity_type in ('business', 'location', 'event')),
  routed_entity_id          uuid,
  request_key               uuid not null,
  created_by_user_id        uuid
    constraint commercial_inquiries_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  status_changed_at         timestamptz not null default now(),
  responded_at              timestamptz,
  constraint commercial_inquiries_one_counterparty_check
    check (num_nonnulls(counterparty_business_id, counterparty_location_id, counterparty_event_id) = 1),
  constraint commercial_inquiries_not_self_check
    check (counterparty_business_id is null or counterparty_business_id <> sender_business_id),
  constraint commercial_inquiries_routed_shape_check
    check ((routed_entity_type is null) = (routed_entity_id is null)),
  constraint commercial_inquiries_sender_request_key unique (sender_business_id, request_key)
);

-- At most one OPEN Inquiry per sender + counterparty + intent (a resolved one never blocks a new one).
create unique index if not exists commercial_inquiries_open_counterparty_intent_key
  on public.commercial_inquiries (sender_business_id, coalesce(counterparty_business_id, counterparty_location_id, counterparty_event_id), intent)
  where status in ('sent', 'responded');
create unique index if not exists commercial_inquiries_conversation_id_key
  on public.commercial_inquiries (conversation_id) where conversation_id is not null;
create index if not exists commercial_inquiries_sender_idx
  on public.commercial_inquiries (sender_business_id, created_at desc);
create index if not exists commercial_inquiries_routed_idx
  on public.commercial_inquiries (routed_entity_type, routed_entity_id, status) where routed_entity_id is not null;
create index if not exists commercial_inquiries_target_idx
  on public.commercial_inquiries (target_id) where target_id is not null;

-- One Conversation per Inquiry.
create unique index if not exists conversations_commercial_inquiry_subject_key
  on public.conversations (subject_id) where subject_type = 'commercial_inquiry';

create or replace function public.commercial_inquiries_status_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.commercial_inquiries_status_changed() from public, anon, authenticated;

create or replace trigger trg_commercial_inquiries_status_changed
  before update on public.commercial_inquiries
  for each row execute function public.commercial_inquiries_status_changed();

create or replace trigger trg_commercial_inquiries_updated_at
  before update on public.commercial_inquiries
  for each row execute function public.set_updated_at();

alter table public.commercial_inquiries enable row level security;
revoke all on public.commercial_inquiries from public, anon, authenticated;
grant select, insert, update on public.commercial_inquiries to service_role;

comment on table public.commercial_inquiries is
  'Commercial Inquiry v1: a Business''s explicit, outward request (via Findmi) to exactly one counterparty about ONE commercial intent. Shared with its Conversation''s participants; the private Target it may come from (target_id) is never exposed or copied. Server-only (RLS on, no client policies).';
comment on column public.commercial_inquiries.target_id is
  'The sender''s private Target this Inquiry came from, if any. Sender-side only: never returned to the counterparty.';
comment on column public.commercial_inquiries.routed_entity_type is
  'Who on the counterparty side was safely resolved at send time (verified members only): the Business, the Location / Event itself, or its operating / host Business. Null = Findmi mediates alone.';
comment on column public.commercial_inquiries.request_key is
  'Client-generated key for one Send operation: a double tap or retry resolves to the same Inquiry.';
