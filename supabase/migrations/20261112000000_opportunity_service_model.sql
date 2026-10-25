-- Trust & Privacy Phase 2A: platform-facilitated vs Findmi-managed
-- Commercial Opportunities.
--
-- Additive only. One new column on opportunity_listings with a default, so
-- every existing row reads 'platform' and nothing else changes. No data is
-- rewritten or deleted; no grants or policies change (opportunity_listings
-- stays server-only).
--
--   platform        Findmi publishes the Opportunity and connects the
--                   parties; the participating parties coordinate the
--                   engagement themselves.
--   findmi_managed  Findmi has expressly agreed to coordinate / perform
--                   the engagement (e.g. an Activation Findmi produces).
--                   Set deliberately by Findmi Admin per listing.
alter table public.opportunity_listings
  add column if not exists service_model text not null default 'platform'
  check (service_model in ('platform', 'findmi_managed'));
