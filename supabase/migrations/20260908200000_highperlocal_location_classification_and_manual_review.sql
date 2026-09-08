-- ============================================================================
-- Highperlocal Prep, Pass 1 — additive schema foundation only.
--
-- NOT applied to any live project by this migration file's presence —
-- see this pass's own report for confirmation it was written, not run.
--
-- Three independent, additive changes. None alters an existing column,
-- constraint, or row; every new column is either nullable or has a
-- non-destructive default that preserves current behavior.
--
-- 1. appearances.location_id — an optional link from a brand Appearance
--    to a real, canonical `locations` row (a known dispensary/retailer/
--    venue/other saved Location), alongside — never instead of — the
--    existing free-text venue_name/address/city/state/latitude/longitude
--    columns, which are unchanged and keep working as the display
--    snapshot/fallback whenever no canonical Location is linked. NULL
--    event_id (standalone brand activations, no parent event) is already
--    supported by the existing schema — untouched here.
--
-- 2. locations.classification — Highperlocal's retail-location
--    classification (adult_use / medical / adult_use_medical / hemp_store
--    / other). Nullable, no default, never backfilled or guessed here —
--    an existing Location simply starts unclassified until a founder sets
--    it. Classifies the physical retail Location itself, never a parent
--    Business/brand.
--
-- 3. businesses.ownership_verification_status / payment_confirmation_status
--    (+ their timestamp/note companions) — two independent, additive
--    manual-review provenance fields for Highperlocal's non-Stripe
--    workflow (manual business verification + external payment
--    confirmation). Deliberately kept separate from each other and from
--    the business's EXISTING publication_status and plan_tier/
--    plan_source/plan_started_at/plan_expires_at/plan_payment_reference
--    entitlement provenance (all untouched — they already cover
--    "publication status" and "entitlement/access status + expiration";
--    no need to duplicate them here). Setting either new status never
--    writes to publication_status or plan_tier from this migration or
--    from any code in this pass — a confirmed payment must never
--    auto-publish or auto-verify a business; that stays a separate,
--    explicit admin action.
--
-- Grants: appearances and locations already carry table-level SELECT for
-- anon/authenticated (verified against the live schema before writing
-- this migration) — new columns on them inherit that automatically, no
-- grant statement needed. businesses uses a column-level allowlist grant
-- model instead (plan_tier/plan_source/etc. are deliberately NOT
-- anon/authenticated-readable) — the three new businesses columns below
-- default to ungranted, same admin/service-role-only posture as those
-- existing columns, which is intentional: these are internal review
-- fields, never meant for public read.
-- ============================================================================

-- ── 1. Appearances -> canonical Location (optional) ────────────────────────
alter table public.appearances
  add column location_id uuid null references public.locations(id) on delete set null;

create index appearances_location_id_idx on public.appearances using btree (location_id);

-- ── 2. Location retail classification ───────────────────────────────────────
alter table public.locations
  add column classification text null
    check (classification in ('adult_use', 'medical', 'adult_use_medical', 'hemp_store', 'other'));

create index locations_classification_idx on public.locations using btree (classification);

-- ── 3. Business manual-review provenance (Highperlocal) ─────────────────────

-- Ownership/business verification — independent of the existing `verified`
-- boolean (untouched by this migration; this adds richer provenance
-- alongside it, never repurposing it).
alter table public.businesses
  add column ownership_verification_status text not null default 'unverified'
    check (ownership_verification_status in ('unverified', 'pending', 'verified', 'rejected')),
  add column ownership_verified_at timestamptz null,
  add column ownership_verification_note text null;

-- External/manual payment confirmation — independent of plan_tier/
-- plan_source, which stay the sole source of truth for entitlement/access
-- itself. Recording a confirmed payment here does NOT by itself grant
-- plan_tier — an admin still separately activates the entitlement.
alter table public.businesses
  add column payment_confirmation_status text not null default 'none'
    check (payment_confirmation_status in ('none', 'pending', 'confirmed', 'expired')),
  add column payment_confirmed_at timestamptz null,
  add column payment_confirmation_note text null;

create index businesses_ownership_verification_status_idx on public.businesses using btree (ownership_verification_status);
create index businesses_payment_confirmation_status_idx on public.businesses using btree (payment_confirmation_status);
