-- QR Campaigns V2 Foundation (Pass 1) — forward-only schema additions on
-- top of the existing, already-live qr_campaigns table (its own defining
-- migration predates this repo's tracked migration history — verified
-- structurally, live, before writing this file: id/name/code/business_id/
-- event_id/event_occurrence_id/appearance_id/location_id/product_id/
-- destination_path/placement/campaign_label/is_active/created_at/
-- updated_at, RLS enabled with zero policies, only 3 existing rows, all
-- with clean context references and safe internal destination_path
-- values). This migration is purely additive: no existing column is
-- renamed, retyped, or dropped, no existing row's destination_path stops
-- working, and no existing QR code is regenerated or invalidated.
--
-- Core principle carried through every change below: QR ATTRIBUTION
-- CONTEXT (business_id/appearance_id/event_id/event_occurrence_id/
-- location_id/product_id — "where/what this code was physically
-- printed for") IS INDEPENDENT FROM QR REDIRECT DESTINATION (the new
-- destination_type/destination_id/destination_url, or the legacy
-- destination_path) — nothing here forces context to equal destination.

-- ---------------------------------------------------------------------
-- 1. Campaign lifecycle — active/paused/archived replaces the plain
--    is_active boolean as the forward-looking authority. is_active
--    stays (still read by the existing /q/[code] route and admin/owner
--    actions during this pass) and is kept in lockstep by application
--    code (see setQrCampaignActive), never contradicting status.
-- ---------------------------------------------------------------------
alter table public.qr_campaigns
  add column if not exists status text not null default 'active'
    check (status in ('active', 'paused', 'archived'));

-- Backfill: is_active = true rows already read 'active' via the column
-- default above; only the false ones need flipping to 'paused'. Nothing
-- is archived automatically — archiving is a deliberate future action.
update public.qr_campaigns set status = 'paused' where is_active = false;

create index if not exists qr_campaigns_status_idx on public.qr_campaigns (status);

-- ---------------------------------------------------------------------
-- 2. Independent, structured destination model — additive alongside
--    destination_path (kept verbatim for every existing/legacy
--    campaign; the app's resolver falls back to it whenever these three
--    are null — see resolveQrDestination in lib/qr-v2.ts). No historical
--    campaign is required to be converted; classification was
--    intentionally NOT attempted for the 3 existing rows in this pass
--    since none of their destinations are unambiguous business/product/
--    event/location UUID references (see the Pass 1 report).
-- ---------------------------------------------------------------------
alter table public.qr_campaigns
  add column if not exists destination_type text
    check (destination_type in ('business', 'product', 'event', 'location', 'custom')),
  add column if not exists destination_id uuid,
  add column if not exists destination_url text;

-- Shape invariant: a "custom" destination must carry its own URL/path; any
-- other structured type must carry the id it points at. NULL
-- destination_type (every existing legacy campaign) always passes —
-- three-valued NULL logic already allows it, but the explicit branch
-- keeps this constraint's intent legible.
alter table public.qr_campaigns
  add constraint qr_campaigns_destination_shape_check check (
    destination_type is null
    or (destination_type = 'custom' and destination_url is not null)
    or (destination_type is distinct from 'custom' and destination_id is not null)
  );

-- Defense in depth against an open redirect: even if application-layer
-- validation (validateCustomDestination, reused from lib/navigation.ts)
-- were ever bypassed, the database itself refuses a "custom"
-- destination_url that isn't an absolute https:// URL or an internal
-- path starting with "/" — no javascript:/data:/other scheme can ever
-- be stored.
alter table public.qr_campaigns
  add constraint qr_campaigns_custom_destination_safe_check check (
    destination_type is distinct from 'custom' or destination_url ~ '^(https://|/)'
  );

create index if not exists qr_campaigns_destination_type_idx on public.qr_campaigns (destination_type);

-- ---------------------------------------------------------------------
-- 3. Context integrity — verified against live data before writing this
--    file: zero existing campaigns reference a business/event/event
--    occurrence/appearance/location/product id that doesn't exist. Safe
--    to add validated (not NOT VALID) foreign keys directly.
--    on delete set null (never cascade-delete a permanent QR code's row
--    or its scan history just because a linked context entity was later
--    removed) — the code/redirect/history all survive regardless.
-- ---------------------------------------------------------------------
alter table public.qr_campaigns
  add constraint qr_campaigns_business_id_fkey
    foreign key (business_id) references public.businesses(id) on delete set null,
  add constraint qr_campaigns_event_id_fkey
    foreign key (event_id) references public.events(id) on delete set null,
  add constraint qr_campaigns_event_occurrence_id_fkey
    foreign key (event_occurrence_id) references public.event_occurrences(id) on delete set null,
  add constraint qr_campaigns_appearance_id_fkey
    foreign key (appearance_id) references public.appearances(id) on delete set null,
  add constraint qr_campaigns_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete set null,
  add constraint qr_campaigns_product_id_fkey
    foreign key (product_id) references public.products(id) on delete set null;

-- destination_id is intentionally NOT a foreign key — which table it
-- points at depends on destination_type (polymorphic), which Postgres
-- can't express as a single FK. Application code (resolveQrDestination)
-- validates it at resolve time instead, exactly like every other
-- polymorphic reference in this codebase (e.g. nav_items.route_key).

-- ---------------------------------------------------------------------
-- 4. Grant hardening — qr_campaigns has had RLS enabled with ZERO
--    policies since before this repo's tracked migration history
--    (verified live), so anon/authenticated writes were already denied
--    at the RLS layer regardless of the broad table-level grants below
--    (every real read/write goes through getAdminSupabase()/
--    requireAdminSupabase(), which use the service role and bypass RLS
--    entirely). This closes that latent gap so a future RLS policy
--    added here by mistake can't combine with a leftover broad grant to
--    expose QR campaign writes publicly.
-- ---------------------------------------------------------------------
revoke all on public.qr_campaigns from anon, authenticated;
