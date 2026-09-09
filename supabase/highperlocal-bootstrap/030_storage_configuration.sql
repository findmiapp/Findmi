-- ============================================================================
-- Highperlocal Bootstrap — 030_storage_configuration.sql
--
-- TARGET: ewwctvowukrwqzuqfttq (Highperlocal) ONLY. Part of the documented
-- Highperlocal bootstrap process in this directory — runs strictly AFTER
-- 000_current_schema.sql, ../migrations/20260908200000_highperlocal_
-- location_classification_and_manual_review.sql, 010_grant_corrections.sql,
-- and 020_initial_configuration.sql (see this directory's README.md for the
-- full sequencing/safety statement, which applies equally to this file).
-- Never apply to FindMi production (drcbrzwchlirfspjgtik) — FindMi already
-- has its own findmi-media bucket; re-running this would only reset it and
-- add unnecessary bucket-level restrictions FindMi doesn't currently carry.
--
-- WHAT THIS FILE IS: storage configuration only — one bucket row in
-- storage.buckets, plus storage.objects RLS. It creates ZERO storage
-- objects and copies/uploads nothing.
--
-- INSPECTION SOURCE (read-only, against drcbrzwchlirfspjgtik):
--   - Every application Storage reference is exactly one bucket:
--     "findmi-media" — src/lib/admin/upload.ts (admin uploads, requireAdmin()
--     gate) and the member-facing upload actions in
--     src/app/(public)/account/{business,event,location}/actions.ts (each
--     gated by its own requireBusinessMember()/equivalent check). ALL of
--     these call admin.storage.from("findmi-media").upload(...) using
--     getAdminSupabase() — the service-role client — never a direct
--     anon/authenticated client call. There is no other bucket referenced
--     anywhere in the codebase.
--   - FindMi's live storage.buckets row: public = true, file_size_limit =
--     null, allowed_mime_types = null (size/MIME are enforced entirely in
--     application code today — src/lib/imageUploadValidation.ts's
--     MAX_UPLOAD_BYTES = 5MB and its MIME_TO_EXTENSION allowlist: image/
--     jpeg, image/png, image/webp, image/gif; image/svg+xml is explicitly
--     rejected there — "they can carry embedded scripts"; HEIC/HEIF is
--     converted server-side to image/jpeg bytes before upload, so storage
--     itself never receives a raw heic/heif object).
--   - FindMi's live storage.objects / storage.buckets RLS: enabled on both
--     tables, with ZERO custom policies on either. That is FindMi's actual,
--     complete security model — not an oversight to fix: the bucket's own
--     `public = true` flag serves public GETs directly (bypassing RLS
--     entirely, same as any Supabase public bucket), every write goes
--     through the service_role client (which bypasses RLS via Postgres
--     BYPASSRLS, same as every other admin/service-role write elsewhere in
--     this app), and RLS-enabled-with-no-matching-policy is default-deny —
--     so anon/authenticated already have zero INSERT/UPDATE/DELETE access
--     and zero non-public-endpoint SELECT access, with no policy required
--     to state that. storage.objects/buckets carry the same full-DML table
--     grants to anon/authenticated on both projects (the Supabase platform
--     default for the storage schema) — already-confirmed parity, not a
--     mismatch, and irrelevant here since RLS is what actually gates the
--     Storage API's per-object read/write.
--
-- WHAT THIS FILE DOES DIFFERENTLY (intentional, additive hardening — see
-- Pass 6's own report): it sets file_size_limit = 5242880 (5 MB, exactly
-- MAX_UPLOAD_BYTES) and allowed_mime_types = the same four raster types the
-- application already validates and is the only ones it ever uploads. This
-- is not a behavior change for the app — every existing successful upload
-- already satisfies both limits — it is a second, storage-layer enforcement
-- of the exact same rule the app already enforces, so a future code change
-- that accidentally weakened lib/imageUploadValidation.ts would still be
-- caught by Storage itself. FindMi's own bucket predates this bootstrap and
-- is intentionally left alone (see the TARGET note above) rather than
-- retrofitted by this pass.
--
-- One explicit "public read" SELECT policy is added on storage.objects,
-- scoped to only this bucket, so public image reading is documented and
-- guaranteed by an explicit, auditable policy rather than depending solely
-- on the bucket's `public` flag never being toggled off. No INSERT/UPDATE/
-- DELETE policy is added for anon or authenticated — matching FindMi's own
-- zero-policy state for those verbs exactly, since the current application
-- never performs a direct client-side storage write (every upload path is
-- server-side via the service-role client, which needs no policy: it
-- bypasses RLS).
--
-- IDEMPOTENCY: the bucket insert uses `on conflict (id) do update`; the
-- policy uses `drop policy if exists` + `create policy`. Both are safe to
-- rerun.
--
-- storage.objects RLS is NOT re-asserted here (no `alter table ... enable
-- row level security` statement): it is already enabled on Highperlocal by
-- the Supabase platform default (verified directly, matching FindMi's own
-- state), and the migration role this bootstrap runs as (`postgres`) is not
-- the owner of storage.objects — attempting the ALTER (even though it would
-- be a no-op) fails with "must be owner of table objects", confirmed while
-- writing this file. CREATE POLICY on the same table succeeds under this
-- role without issue.
-- ============================================================================

-- ── Bucket: findmi-media — the one bucket every upload path in the
--    application uses (see inspection notes above) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'findmi-media',
  'findmi-media',
  true,
  5242880, -- 5 MB — matches lib/imageUploadValidation.ts's MAX_UPLOAD_BYTES exactly
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif'] -- matches MIME_TO_EXTENSION exactly; no svg+xml, no heic/heif (always converted server-side first)
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── storage.objects RLS — already enabled (Supabase platform default,
--    verified on Highperlocal before writing this file); exactly one
--    explicit policy added on top of it ────────────────────────────────────
drop policy if exists "findmi-media public read" on storage.objects;
create policy "findmi-media public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'findmi-media');

-- No INSERT/UPDATE/DELETE policy is created for anon or authenticated —
-- deliberately absent, matching FindMi's own zero-policy state for those
-- verbs. RLS-enabled-with-no-matching-policy is default-deny, so anonymous
-- users cannot insert, update, or delete storage.objects rows (no
-- overwrites, no anonymous uploads, no anonymous deletes), and authenticated
-- users get no broader access than anon here either — exactly matching
-- what the current application requires, since every upload path
-- (src/lib/admin/upload.ts and every account/{business,event,location}/
-- actions.ts upload action) already runs server-side through the
-- service-role client, which bypasses RLS entirely (Postgres BYPASSRLS) and
-- therefore needs no policy to perform founder-admin or member-facing
-- uploads.
