-- Brand Intelligence V1.1 — Admin Opportunity Intelligence review state.
--
-- NOT YET APPLIED TO PRODUCTION. Additive only — one new table. No
-- existing table, row or policy is changed (Brand Audit / Opportunity Idea
-- data is never touched).
--
-- A "signal" is derived on the fly from existing V1 rows:
--   signal_type 'brand_audit'    signal_id = brand_audits.business_id
--   signal_type 'idea_response'  signal_id = opportunity_idea_responses.id
-- A signal is NEW when its source row's updated_at is later than
-- reviewed_at here (or there is no row). Mark Reviewed upserts
-- reviewed_at = now(); a later Brand change makes the signal new again.
-- Kept in its own table (not a column on the source rows) so marking
-- reviewed never fires those rows' updated_at triggers.
--
-- Admin only: RLS enabled with NO anon/authenticated policies or grants;
-- every read/write is server-side through the service role after
-- requireAdmin() — see src/lib/brand-intelligence.ts.
-- Re-running this file is safe.

create table if not exists public.admin_intelligence_reviews (
  signal_type  text not null,
  signal_id    uuid not null,
  reviewed_at  timestamptz not null default now(),
  primary key (signal_type, signal_id),
  constraint admin_intelligence_reviews_type_check check (signal_type in ('brand_audit', 'idea_response'))
);

alter table public.admin_intelligence_reviews enable row level security;
revoke all on public.admin_intelligence_reviews from anon, authenticated;
grant all on public.admin_intelligence_reviews to service_role;

comment on table public.admin_intelligence_reviews is
  'Brand Intelligence V1.1: when Findmi Admin last reviewed each Brand Audit / Idea response signal. Admin only; server-only access.';
