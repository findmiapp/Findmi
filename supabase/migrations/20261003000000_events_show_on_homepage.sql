-- Homepage Event Merchandising — explicit editorial control over the
-- homepage "What's Happening" rail (lib/data.ts's getUpcomingEvents),
-- independent of normal Event publication/discoverability.
--
-- Purely additive: one new NOT NULL DEFAULT false column on `events`, no
-- existing row rewritten to true, no existing constraint narrowed. Every
-- existing Event becomes show_on_homepage = false by default — the
-- homepage rail may show zero Events until a founder explicitly opts
-- specific Events in via the admin Event editor. That is intentional:
-- an empty rail is preferable to the random-eligible-Events behavior
-- this column replaces.
--
-- Deliberately NOT `is_featured` (a separate, pre-existing, general
-- editorial-priority flag used by getFeaturedEvents() and ordered by
-- featured_sort_order) and NOT a reinterpretation of publication_status.
-- This column has exactly one meaning: "is this Event eligible to appear
-- in the homepage Event merchandising surface" — still subject to every
-- other existing homepage eligibility rule (is_demo, date window, etc.),
-- never a bypass of them.
alter table public.events
  add column if not exists show_on_homepage boolean not null default false;

comment on column public.events.show_on_homepage is
  'Founder-controlled homepage Event rail eligibility. Independent of is_featured and publication_status — does not affect discoverability on /discover, /events, /find, Business/Location pages, or Event pages.';
