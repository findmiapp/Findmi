-- Opportunities V1 — Findmi-authored commercial Opportunities and their
-- per-Business recipients.
--
-- Purely additive. This does NOT touch public.opportunities (the existing
-- Event invitation/application decision workflow), event_businesses,
-- event_occurrence_businesses, conversations or activations.
--
-- Access model: server-only. RLS is enabled with NO anon/authenticated
-- policies and no table grants for those roles; every read/write goes
-- through server code (service role) after explicit authorization — see
-- src/lib/opportunity-listings.ts. Row policies cannot hide individual
-- columns (internal_notes), and Business visibility depends on the parent
-- listing's status, so the canonical rules live in that one library.

create table public.opportunity_listings (
  id                 uuid primary key default gen_random_uuid(),
  status             text not null default 'draft'
                       constraint opportunity_listings_status_check
                       check (status in ('draft', 'open', 'closed', 'archived')),
  -- V1 taxonomy (mirrors OPPORTUNITY_TYPES in src/lib/opportunity-listings-domain.ts).
  opportunity_type   text not null
                       constraint opportunity_listings_type_check
                       check (opportunity_type in ('activation', 'sampling_demo', 'vending', 'sponsorship',
                                                   'content', 'partnership', 'other')),
  title              text not null
                       constraint opportunity_listings_title_check
                       check (char_length(btrim(title)) between 1 and 120),
  summary            text constraint opportunity_listings_summary_check
                       check (summary is null or char_length(summary) <= 280),
  description        text constraint opportunity_listings_description_check
                       check (description is null or char_length(description) <= 8000),
  image_url          text,
  location_id        uuid references public.locations(id) on delete set null,
  place_text         text constraint opportunity_listings_place_text_check
                       check (place_text is null or char_length(place_text) <= 160),
  host_name          text constraint opportunity_listings_host_name_check
                       check (host_name is null or char_length(host_name) <= 120),
  event_id           uuid references public.events(id) on delete set null,
  starts_at          timestamptz,
  ends_at            timestamptz,
  timing_note        text constraint opportunity_listings_timing_note_check
                       check (timing_note is null or char_length(timing_note) <= 160),
  response_deadline  timestamptz,
  pricing_mode       text not null
                       constraint opportunity_listings_pricing_mode_check
                       check (pricing_mode in ('fixed', 'starting_at', 'complimentary', 'custom')),
  price_cents        integer constraint opportunity_listings_price_positive_check
                       check (price_cents is null or price_cents > 0),
  currency           text not null default 'USD'
                       constraint opportunity_listings_currency_check
                       check (currency ~ '^[A-Z]{3}$'),
  credits_eligible   boolean not null default false,
  whats_included     text constraint opportunity_listings_whats_included_check
                       check (whats_included is null or char_length(whats_included) <= 4000),
  requirements       text constraint opportunity_listings_requirements_check
                       check (requirements is null or char_length(requirements) <= 4000),
  internal_notes     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Price data must match the pricing mode (no ambiguous combinations).
  constraint opportunity_listings_price_matches_mode_check check (
    (pricing_mode in ('fixed', 'starting_at') and price_cents is not null)
    or (pricing_mode in ('complimentary', 'custom') and price_cents is null)
  ),
  -- Opportunity Credits can't apply to something that is already free.
  constraint opportunity_listings_credits_mode_check
    check (not credits_eligible or pricing_mode <> 'complimentary'),
  constraint opportunity_listings_time_order_check
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

create index opportunity_listings_status_idx
  on public.opportunity_listings (status, created_at desc);
create index opportunity_listings_location_idx
  on public.opportunity_listings (location_id) where location_id is not null;
create index opportunity_listings_event_idx
  on public.opportunity_listings (event_id) where event_id is not null;

create trigger trg_opportunity_listings_updated_at
  before update on public.opportunity_listings
  for each row execute function public.set_updated_at();

create table public.opportunity_recipients (
  id                    uuid primary key default gen_random_uuid(),
  -- restrict: a listing that was ever sent keeps its recipient history
  -- (archive it instead of deleting it).
  listing_id            uuid not null references public.opportunity_listings(id) on delete restrict,
  business_id           uuid not null references public.businesses(id) on delete cascade,
  status                text not null default 'offered'
                          constraint opportunity_recipients_status_check
                          check (status in ('offered', 'interested', 'not_interested',
                                            'confirmed', 'completed', 'cancelled', 'withdrawn')),
  fit_note              text constraint opportunity_recipients_fit_note_check
                          check (fit_note is null or char_length(fit_note) <= 1000),
  response_note         text constraint opportunity_recipients_response_note_check
                          check (response_note is null or char_length(response_note) <= 1000),
  internal_notes        text,
  -- The moment Findmi actually sent this Opportunity to the Business. A
  -- recipient row only exists once sent, so this is always set.
  offered_at            timestamptz not null default now(),
  -- responded_at / responded_by_user_id mean "the Business responded
  -- through Findmi" — never set by Admin status changes (e.g. an offline
  -- confirmation), so no constraint ties them to a status.
  responded_at          timestamptz,
  responded_by_user_id  uuid references auth.users(id) on delete set null,
  status_changed_at     timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint opportunity_recipients_listing_business_key unique (listing_id, business_id),
  -- A responding user is only ever recorded together with a response time
  -- (the user may later be deleted -> null, leaving the time).
  constraint opportunity_recipients_responder_has_time_check
    check (responded_by_user_id is null or responded_at is not null)
);

create index opportunity_recipients_business_idx
  on public.opportunity_recipients (business_id, status);
create index opportunity_recipients_listing_idx
  on public.opportunity_recipients (listing_id, status);

create trigger trg_opportunity_recipients_updated_at
  before update on public.opportunity_recipients
  for each row execute function public.set_updated_at();

-- Server-only access: RLS on, no anon/authenticated policies or grants.
alter table public.opportunity_listings   enable row level security;
alter table public.opportunity_recipients enable row level security;
revoke all on table public.opportunity_listings   from anon, authenticated;
revoke all on table public.opportunity_recipients from anon, authenticated;
grant all on table public.opportunity_listings   to service_role;
grant all on table public.opportunity_recipients to service_role;

comment on table public.opportunity_listings is
  'Opportunities V1: Findmi-authored commercial Opportunities. Server-only access; Businesses see a listing only through their own opportunity_recipients row (rules in src/lib/opportunity-listings-domain.ts). Unrelated to public.opportunities (Event invitations/applications).';
comment on table public.opportunity_recipients is
  'Opportunities V1: one Business offered one Opportunity, with its response and Findmi-managed outcome. internal_notes is Admin-only and must never be selected for Business reads.';
