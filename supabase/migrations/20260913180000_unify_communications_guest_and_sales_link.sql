-- Unify Site-Wide Communications pass — smallest additive extension of
-- the EXISTING Conversation architecture (conversations/
-- conversation_participants/conversation_messages/opportunities —
-- "Opportunities + Conversation Foundation V1") so controlled public
-- inquiries (Business Inquire, Event Contact Organizer, Venue Contact,
-- Findmi Multi-Region Sales) become real Conversations instead of a
-- second communication system. No parallel messaging tables created.
--
-- (1) conversations.guest_name/guest_email/guest_phone — a true guest
-- (no Findmi account) cannot be a conversation_participants row
-- (user_id is NOT NULL there, by design — see this pass's own report on
-- why a full guest-auth system is out of scope). Their identity instead
-- lives here, on the conversation itself, so an authorized entity
-- manager can see who to follow up with; their opening message is still
-- inserted into conversation_messages normally, with sender_participant_id
-- left null (the same "unattributed" shape a system message already
-- uses). All three columns stay null for every existing conversation and
-- for any authenticated sender (who is instead a real "personal"
-- participant, an existing entity_type this schema already supports).
alter table public.conversations add column if not exists guest_name text;
alter table public.conversations add column if not exists guest_email text;
alter table public.conversations add column if not exists guest_phone text;

-- (2) sales_inquiries.conversation_id — links a Multi-Region sales lead
-- (fc17e04) to its canonical Findmi Sales Conversation, the exact same
-- back-reference shape opportunities.conversation_id already uses to
-- link a structured Opportunity to its Conversation. Nullable/additive:
-- existing sales_inquiries rows (submitted before this pass) simply have
-- no conversation, which the admin UI treats as "no conversation yet"
-- rather than an error.
alter table public.sales_inquiries add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
