-- ============================================================================
-- Highperlocal Bootstrap — 010_grant_corrections.sql
--
-- TARGET: ewwctvowukrwqzuqfttq (Highperlocal) ONLY. Part of the documented
-- Highperlocal bootstrap process in this directory — runs strictly AFTER
-- 000_current_schema.sql and after
-- ../migrations/20260908200000_highperlocal_location_classification_and_manual_review.sql
-- (see this directory's README.md for the full sequencing/safety statement,
-- which applies equally to this file). Never apply to FindMi production
-- (drcbrzwchlirfspjgtik).
--
-- WHY THIS FILE EXISTS: a Highperlocal Database Permissions Verification
-- pass compared every anon/authenticated/service_role grant on
-- ewwctvowukrwqzuqfttq against FindMi's live production grants
-- (drcbrzwchlirfspjgtik) column-for-column and function-for-function. Two
-- concrete mismatches were found — both are Highperlocal being MORE
-- permissive than FindMi's actual, current, intended posture (never less
-- permissive) — corrected here with the minimum REVOKE statements needed.
-- No table, column, row, or RLS policy is touched by this file.
--
-- ── Mismatch 1 (high severity) — SECURITY DEFINER RPC functions ───────────
-- 000_current_schema.sql's own Section 11 assumed "a fresh Supabase
-- project revokes EXECUTE from PUBLIC on new functions by default" and so
-- granted EXECUTE explicitly only to the 7 functions FindMi exposes to
-- anon/authenticated, leaving the rest ungranted on that assumption. That
-- assumption was WRONG: Supabase's actual per-project default is the
-- opposite (new functions default to EXECUTE granted to anon/
-- authenticated/service_role via that project's own default privileges).
-- Verified directly: on ewwctvowukrwqzuqfttq, all 26 functions ended up
-- callable by anon and authenticated; on drcbrzwchlirfspjgtik, only 7 are
-- (the same 7 the bootstrap's comment already named) — the other 19 have
-- been explicitly revoked in FindMi's real history, predating this repo's
-- tracked migrations, same as this repo's own Pass 2 finding that FindMi's
-- baseline schema predates migration tracking.
--
-- Every one of those 19 is SECURITY DEFINER — it runs with elevated
-- privilege regardless of caller. Left as found, ANY unauthenticated
-- client could call e.g. transfer_business_ownership(), remove_business_
-- owner(), redeem_pro_invite(), or lookup_auth_user_id_by_email() directly
-- via PostgREST's /rpc/ endpoint, completely bypassing every
-- requireBusinessMember()/requireAdminSupabase() authorization check the
-- application layer relies on. This is the one finding in this pass that
-- is a real, exploitable gap, not merely a residual over-grant.
--
-- ── Mismatch 2 (low severity, defense-in-depth) — residual table verbs ────
-- 000_current_schema.sql's Section 11 revoked only the specific DML verbs
-- (INSERT/UPDATE/DELETE) each hardened table needed narrowed, leaving the
-- platform-default REFERENCES/TRIGGER/TRUNCATE grants in place. FindMi's
-- actual current state instead did a full REVOKE ALL + precise re-GRANT on
-- these same tables, so anon/authenticated hold only the exact verbs
-- listed there (typically just SELECT, or INSERT+SELECT) — no REFERENCES/
-- TRIGGER/TRUNCATE residue. Not exploitable via Supabase's client SDKs
-- (PostgREST never issues TRUNCATE/CREATE TRIGGER/ADD CONSTRAINT on a
-- client's behalf), but corrected here for exact parity with FindMi's
-- documented posture, per this pass's own "pay special attention to
-- business_members/business_claims/ownership transfer tables" instruction.
-- ============================================================================

-- ── Mismatch 1 — revoke EXECUTE on the 19 service_role-only RPCs ──────────
revoke execute on function public.approve_business_claim(uuid) from public, anon, authenticated;
revoke execute on function public.approve_event_claim(uuid) from public, anon, authenticated;
revoke execute on function public.approve_location_claim(uuid) from public, anon, authenticated;
revoke execute on function public.attribute_referral(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.create_owned_business(uuid, text, text, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_owned_event(uuid, text, text, timestamp with time zone, timestamp with time zone, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_owned_location(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.lookup_auth_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.qualify_referral_earning(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.redeem_event_management_invite(text, uuid) from public, anon, authenticated;
revoke execute on function public.redeem_pro_invite(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.remove_business_owner(uuid) from public, anon, authenticated;
revoke execute on function public.remove_event_owner(uuid) from public, anon, authenticated;
revoke execute on function public.remove_location_owner(uuid) from public, anon, authenticated;
revoke execute on function public.request_referral_payout(uuid) from public, anon, authenticated;
revoke execute on function public.set_business_category(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.transfer_business_ownership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.transfer_event_ownership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.transfer_location_ownership(uuid, uuid) from public, anon, authenticated;

-- ── Mismatch 2 — strip residual REFERENCES/TRIGGER/TRUNCATE ───────────────
revoke references, trigger, truncate on public.business_claim_requests from authenticated;
revoke references, trigger, truncate on public.business_members from authenticated;
revoke references, trigger, truncate on public.event_claim_requests from authenticated;
revoke references, trigger, truncate on public.event_members from authenticated;
revoke references, trigger, truncate on public.event_occurrence_businesses from anon, authenticated;
revoke references, trigger, truncate on public.location_claim_requests from authenticated;
revoke references, trigger, truncate on public.location_members from authenticated;
