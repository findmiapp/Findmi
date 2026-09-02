-- ============================================================================
-- Phase 1.5: Claim payment tracking ($20 listing-activation payment)
-- Adds payment columns to business_claim_requests / event_claim_requests
-- only. Touches nothing else. Fully additive except for the two ALTER
-- POLICY statements at the end (tightening, not loosening).
--
-- NOT APPLIED YET. Created for review only — apply_migration must not be
-- run against this file until explicit separate approval is given.
--
-- Architecture (kept deliberately separate, per this pass's explicit
-- instruction):
--   1. Claim verification  — business_claim_requests/event_claim_requests
--      themselves (unchanged: still just "a request to become a member").
--   2. Claim payment        — the four columns added below. A payment
--      only ever proves $20 was collected; it is never read by
--      approve_business_claim()/approve_event_claim() as an eligibility
--      condition (those two functions are completely untouched by this
--      migration) and never changes `status`.
--   3. Membership authorization — still exclusively
--      business_members/event_members, still only ever created by the
--      existing SECURITY DEFINER approval functions after a human founder
--      clicks Approve. A paid claim is not an approved claim.
-- ============================================================================

alter table public.business_claim_requests
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),
  add column if not exists payment_amount integer,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text;

alter table public.event_claim_requests
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded')),
  add column if not exists payment_amount integer,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text;

-- Required claim-form contact fields: full_name, email, phone. Collected
-- once, in the FindMi claim form itself, so the Tally payment step never
-- has to ask for them again — see getClaimPaymentFormUrl() in
-- lib/tally.ts, which passes these through as hidden fields for the
-- founder's convenience/record only. `email` here is the claimant's own
-- SUBMITTED contact email (prefilled from their account email, but
-- editable before submission) — deliberately a separate stored value,
-- never read back from auth.users; identity/authorization always comes
-- from user_id alone, never from this column.
--
-- MIGRATION SAFETY: both claim tables are NOT guaranteed empty — a real
-- row already exists in business_claim_requests in production (created
-- before these columns existed, via the earlier claim_and_membership_
-- foundation pass that was committed and deployed). Adding these as
-- `not null` (with or without a CHECK) would fail outright against that
-- row, since there is no meaningful full_name/email/phone to backfill it
-- with. All three are therefore added as plain nullable columns — always
-- safe to add regardless of existing row count or content — and
-- "required" is enforced only at the application layer (POST
-- /api/account/claim rejects a submission missing any of the three
-- before insert), not by a database constraint. A pre-existing row simply
-- keeps NULL in these columns, which is accurate: that claim genuinely
-- was submitted before this data was collected.
alter table public.business_claim_requests
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text;

alter table public.event_claim_requests
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists phone text;

-- Idempotency backstop for the payment webhook, in addition to the
-- webhook's own application-level checks: a given payment reference
-- should never end up attached to more than one claim row. Partial
-- (payment_reference is not null) so the many unpaid rows — always null
-- before payment — never collide with each other.
create unique index if not exists business_claim_requests_payment_reference_idx
  on public.business_claim_requests (payment_reference) where payment_reference is not null;
create unique index if not exists event_claim_requests_payment_reference_idx
  on public.event_claim_requests (payment_reference) where payment_reference is not null;

-- Supports /admin/claims' "PAID — NEEDS REVIEW" filter (status='pending'
-- and payment_status='paid').
create index if not exists business_claim_requests_status_payment_status_idx
  on public.business_claim_requests (status, payment_status);
create index if not exists event_claim_requests_status_payment_status_idx
  on public.event_claim_requests (status, payment_status);

-- Browser cannot set payment_status (Part G). The existing insert-own-
-- pending policies (claim_and_membership_foundation migration) only
-- checked auth.uid() = user_id and status = 'pending' — before this
-- column existed, there was nothing else to check. Now that
-- payment_status exists, a client could otherwise include
-- payment_status: "paid" directly in its insert payload and have it
-- accepted: a column DEFAULT only applies when a client omits the column
-- entirely, and WITH CHECK only rejects rows that fail the check, not
-- rows that supply their own value for an unchecked column. Tightened
-- here so a claim can only ever be inserted as 'unpaid'; the only way
-- payment_status changes afterward is the service-role-only payment
-- webhook route (no authenticated UPDATE policy exists on either table,
-- unchanged by this migration).
alter policy "business_claim_requests_insert_own_pending"
  on public.business_claim_requests
  with check (auth.uid() = user_id and status = 'pending' and payment_status = 'unpaid');

alter policy "event_claim_requests_insert_own_pending"
  on public.event_claim_requests
  with check (auth.uid() = user_id and status = 'pending' and payment_status = 'unpaid');
