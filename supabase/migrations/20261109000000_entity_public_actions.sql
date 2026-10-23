-- Public Actions: up to three entity-controlled buttons on a public Business,
-- Location or Event page (lib/public-actions-domain.ts).
--
-- Why a table: the existing columns cannot hold this. businesses.cta_1..3 are
-- free external URLs (Business only), accepts_inquiries / inquiry_topics
-- configure one Inquire form (Business only), and Locations and Events have no
-- action configuration at all. One generalized table serves all three kinds
-- (no per-kind tables), with exactly one typed entity reference so rows
-- cascade with their entity.
--
-- action_type decides behavior; custom_label is presentation only (validated
-- in the app: trimmed, safe characters, at most 20, fits the 3-button layout;
-- the database enforces length and no surrounding whitespace). At most three
-- per entity: display_order is 1..3 and unique per entity.
--
-- Additive only. RLS on with no client policies; service_role only (the same
-- server-access convention as business_targets and commercial_inquiries).
-- No existing row changes; no data is backfilled (an entity with no rows keeps
-- its existing behavior — e.g. a Business's Inquire button).

create table if not exists public.entity_public_actions (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid
    constraint entity_public_actions_business_id_fkey references public.businesses(id) on delete cascade,
  location_id             uuid
    constraint entity_public_actions_location_id_fkey references public.locations(id) on delete cascade,
  event_id                uuid
    constraint entity_public_actions_event_id_fkey references public.events(id) on delete cascade,
  action_type             text not null
    constraint entity_public_actions_action_type_check check (
      action_type in ('general_inquiry', 'booking', 'wholesale', 'distribution', 'collaboration', 'sponsorship', 'sampling', 'activation', 'pop_up', 'content', 'placement', 'vending', 'event_participation', 'opportunity', 'website')
    ),
  custom_label            text
    constraint entity_public_actions_custom_label_check check (custom_label is null or (char_length(custom_label) between 1 and 20 and custom_label = btrim(custom_label))),
  enabled                 boolean not null default true,
  display_order           smallint not null
    constraint entity_public_actions_display_order_check check (display_order between 1 and 3),
  opportunity_listing_id  uuid
    constraint entity_public_actions_opportunity_listing_id_fkey references public.opportunity_listings(id) on delete cascade,
  created_by_user_id      uuid
    constraint entity_public_actions_created_by_user_id_fkey references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint entity_public_actions_one_entity_check
    check (num_nonnulls(business_id, location_id, event_id) = 1),
  constraint entity_public_actions_event_participation_check
    check (action_type <> 'event_participation' or event_id is not null),
  constraint entity_public_actions_opportunity_check
    check ((action_type = 'opportunity') = (opportunity_listing_id is not null))
);

-- At most three per entity, one per slot.
create unique index if not exists entity_public_actions_entity_order_key
  on public.entity_public_actions (coalesce(business_id, location_id, event_id), display_order);
create index if not exists entity_public_actions_business_idx on public.entity_public_actions (business_id) where business_id is not null;
create index if not exists entity_public_actions_location_idx on public.entity_public_actions (location_id) where location_id is not null;
create index if not exists entity_public_actions_event_idx on public.entity_public_actions (event_id) where event_id is not null;

create or replace trigger trg_entity_public_actions_updated_at
  before update on public.entity_public_actions
  for each row execute function public.set_updated_at();

alter table public.entity_public_actions enable row level security;
revoke all on public.entity_public_actions from public, anon, authenticated;
grant select, insert, update, delete on public.entity_public_actions to service_role;

comment on table public.entity_public_actions is
  'Public Actions: up to three entity-controlled buttons on a public Business / Location / Event page. action_type decides behavior; custom_label is presentation only. Server-only (RLS on, no client policies).';
