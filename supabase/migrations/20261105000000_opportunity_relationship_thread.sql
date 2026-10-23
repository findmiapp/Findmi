-- Opportunity Relationship Thread — Findmi as a Level 2 marketplace mediator.
--
-- A commercial Opportunity sent to a Business (opportunity_recipients) gains
-- one persistent Conversation between that Business and Findmi. The
-- recipient row stays the canonical workflow record; the Conversation is the
-- communication / history layer (same split as event participation:
-- opportunities.conversation_id).
--
-- Additive only:
--   1. conversation_participants.last_read_at — per-participant read state.
--   2. A "findmi" participant: Findmi takes part as itself, never as a
--      Business / Location / customer / organizer. It has no user (admin is a
--      shared session, not an account), so user_id becomes nullable for that
--      one participant type only — enforced by a check. Business membership
--      can never authorize a "findmi" row (no members table maps to it). The
--      existing UNIQUE NULLS NOT DISTINCT (conversation_id, user_id,
--      entity_type, entity_id) already allows at most one per conversation.
--   3. opportunity_recipients.conversation_id (ON DELETE SET NULL, same as
--      opportunities.conversation_id), one recipient per conversation.
--   4. One thread per recipient: a partial unique index on the new subject
--      type, so concurrent sends can't create two.
-- No row changes; nothing is backfilled (existing recipients gain a thread
-- lazily, idempotently, the first time it's opened or used). RLS stays on
-- with no client policies — these tables remain server-only.

alter table public.conversation_participants
  add column if not exists last_read_at timestamptz;

alter table public.conversation_participants
  drop constraint if exists conversation_participants_entity_type_check;
alter table public.conversation_participants
  add constraint conversation_participants_entity_type_check
    check (entity_type = any (array['business', 'event', 'location', 'personal', 'findmi']));

alter table public.conversation_participants
  alter column user_id drop not null;
alter table public.conversation_participants
  drop constraint if exists conversation_participants_findmi_shape_check;
alter table public.conversation_participants
  add constraint conversation_participants_findmi_shape_check
    check (((entity_type = 'findmi') = (user_id is null)) and (entity_type <> 'findmi' or entity_id is null));

alter table public.opportunity_recipients
  add column if not exists conversation_id uuid
    constraint opportunity_recipients_conversation_id_fkey references public.conversations(id) on delete set null;

create unique index if not exists opportunity_recipients_conversation_id_key
  on public.opportunity_recipients (conversation_id) where conversation_id is not null;

create unique index if not exists conversations_commercial_opportunity_subject_key
  on public.conversations (subject_id) where subject_type = 'commercial_opportunity';

comment on column public.conversation_participants.last_read_at is
  'When this participant last opened the thread (null = never). Unread = a message from someone else after this.';
comment on column public.opportunity_recipients.conversation_id is
  'The Business ↔ Findmi thread for this commercial Opportunity relationship (subject_type commercial_opportunity).';
