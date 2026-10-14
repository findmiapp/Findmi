-- Event attendance CTA + location visibility — additive, nullable, forward-only.
--
-- Attendance reuses the EXISTING action fields (tickets_enabled/tickets_url,
-- rsvp_enabled/rsvp_url, occurrence rsvp/ticket overrides). rsvp_cta only
-- labels the existing RSVP action: 'rsvp' → "RSVP", 'register' →
-- "Register". NULL keeps every existing Event's RSVP exactly as before.
--
-- location_visibility records what the Event's source made public:
--   'exact'  precise public venue/address;
--   'broad'  only broad geography (e.g. New York, NY);
--   'hidden' the organizer withholds the address until registration —
--            no venue/address/Location is stored or shown;
--   'none'   no meaningful location.
-- NULL = an Event created before this column (treated as before).
--
-- No backfill, no existing row changes, no RLS/grant changes (events has no
-- column-level grants; existing policies cover new columns).

alter table public.events
  add column if not exists rsvp_cta text,
  add column if not exists location_visibility text;

alter table public.events
  drop constraint if exists events_rsvp_cta_check,
  add constraint events_rsvp_cta_check check (rsvp_cta is null or rsvp_cta in ('rsvp', 'register'));

alter table public.events
  drop constraint if exists events_location_visibility_check,
  add constraint events_location_visibility_check check (location_visibility is null or location_visibility in ('exact', 'broad', 'hidden', 'none'));

comment on column public.events.rsvp_cta is
  'Label of the existing RSVP action: rsvp → "RSVP", register → "Register". NULL = RSVP (unchanged legacy behavior).';
comment on column public.events.location_visibility is
  'What the source made public about the place: exact | broad | hidden (address shared after registration — never stored/shown) | none. NULL = legacy.';
