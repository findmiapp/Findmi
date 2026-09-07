-- Admin Where I'll Be Review Inbox V1 — additive, backward-safe.
-- admin_reviewed_at is acknowledgement-only: it records that a founder has
-- seen/acknowledged an appearance record. It is NEVER read by any public
-- visibility rule, moderation gate, Event participation status, or
-- Market/Area logic — those all remain entirely untouched by this column.
--
-- No admin_reviewed_by: this project's Admin auth is a single shared
-- ADMIN_PASSWORD session with no per-admin accounts/roles (see
-- src/lib/admin/auth.ts) — there is no real user identity to attribute a
-- review to, so inventing one here would be a fake reference. Timestamp
-- alone answers the only question this feature needs: "has this been
-- looked at."
--
-- Deliberately NULL by default and NOT backfilled: existing rows must
-- stay unreviewed so Admin gets an honest initial view of the current
-- appearance inventory, per this pass's own requirement.
alter table public.appearances
  add column admin_reviewed_at timestamptz null;
