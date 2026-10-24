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
-- Public Actions become the ONE source of a profile's action buttons: no
-- configured + enabled action = no button. Accept Inquiries / inquiry topics
-- stay as capability only; the legacy CTA 1/2/3 and Inquire-label columns are
-- retired (left in place, unread, commented as deprecated below).
--
-- Backfill (deterministic, idempotent, never more than one row per entity):
--   * every Business whose Inquire button is visible today — the exact public
--     rule: Pro (pro / pro_seller, not expired) AND accepts_inquiries AND at
--     least one valid inquiry topic — gets ONE enabled General Inquiry action
--     in slot 1 with the default label, only if it has no Public Actions yet.
--     In production at audit time that is exactly The Native Rose.
--   * legacy CTA 1/2/3: none is live in production (only disabled test values
--     exist), so nothing is migrated. If any CTA becomes live before this runs,
--     the migration STOPS (raises) instead of silently losing it.
--   * Locations / Events: no legacy configurable action rendered through this
--     bar, so nothing is created for them.
--
-- Additive only. RLS on with no client policies; service_role only (the same
-- server-access convention as business_targets and commercial_inquiries).
-- No existing row is changed or removed.

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

-- ── Guard: a live legacy CTA can't be mapped without an external-link action
-- (none exists in production at audit time). Stop rather than lose it.
do $$
declare
  live text;
begin
  select string_agg(slug, ', ' order by slug) into live
  from public.businesses
  where (cta_1_enabled and btrim(coalesce(cta_1_label, '')) <> '' and cta_1_url ~* '^https?://')
     or (cta_2_enabled and btrim(coalesce(cta_2_label, '')) <> '' and cta_2_url ~* '^https?://')
     or (cta_3_enabled and btrim(coalesce(cta_3_label, '')) <> '' and cta_3_url ~* '^https?://');
  if live is not null then
    raise exception 'Public Actions: live legacy CTA buttons need review before cutover: %', live;
  end if;
end
$$;

-- ── Backfill: today's visible Inquire buttons become General Inquiry actions.
insert into public.entity_public_actions (business_id, action_type, custom_label, enabled, display_order)
select b.id, 'general_inquiry', null, true, 1
from public.businesses b
where b.plan_tier in ('pro', 'pro_seller')
  and (b.plan_expires_at is null or b.plan_expires_at > now())
  and b.accepts_inquiries
  and b.inquiry_topics && array['general', 'product_order', 'wholesale', 'catering_booking', 'event_popup', 'collaboration', 'other']::text[]
  and not exists (select 1 from public.entity_public_actions a where a.business_id = b.id);

-- ── Retired (unread) legacy columns.
comment on column public.businesses.cta_1_label is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_1_url is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_1_enabled is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_2_label is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_2_url is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_2_enabled is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_3_label is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_3_url is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.cta_3_enabled is 'DEPRECATED: retired by Public Actions (entity_public_actions); unread.';
comment on column public.businesses.inquiry_cta_label is 'DEPRECATED: the Inquire button label now comes from its General Inquiry Public Action; unread.';
comment on column public.businesses.inquiry_cta_url is 'DEPRECATED: unread.';
comment on column public.businesses.accepts_inquiries is 'Inquiry capability (with inquiry_topics). Does NOT show a button by itself: a General Inquiry Public Action does.';
