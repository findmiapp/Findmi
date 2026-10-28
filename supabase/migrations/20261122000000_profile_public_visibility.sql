-- Findmi Consolidation pass — Admin-controlled visibility of a Business's
-- outbound profile elements (links, contact, announcement) and of every
-- page's Profile Buttons (entity_public_actions). Additive and
-- backward-compatible:
--
--   * No row's public visibility changes. Both new columns default to
--     "live", so every existing link, contact detail, announcement and
--     button stays exactly as visible as today. Nothing is backfilled.
--   * Hiding never deletes: the underlying value stays in its own column /
--     row; only whether the public page renders it changes.
--   * Neither column is granted to anon/authenticated. Both are read and
--     written only server-side through the service role (the public
--     Business page already reads contact details that way).

-- 1. Businesses: per-field public visibility. Keys are the outbound field
--    names (website_url, instagram_url, facebook_url, tiktok_url, email,
--    phone, bulletin); values 'pending_review' | 'hidden'. A missing key
--    means LIVE ON PROFILE.
alter table public.businesses
  add column if not exists public_field_status jsonb not null default '{}'::jsonb;

-- 2. Profile Buttons: Admin moderation state per configured action.
alter table public.entity_public_actions
  add column if not exists admin_status text not null default 'live';

alter table public.entity_public_actions
  drop constraint if exists entity_public_actions_admin_status_check;
alter table public.entity_public_actions
  add constraint entity_public_actions_admin_status_check
  check (admin_status in ('live', 'pending_review', 'hidden'));

-- 3. Admin queue lookups stay index-backed as the tables grow.
create index if not exists entity_public_actions_pending_idx
  on public.entity_public_actions (created_at)
  where admin_status = 'pending_review';
create index if not exists businesses_public_field_status_pending_idx
  on public.businesses (updated_at)
  where public_field_status <> '{}'::jsonb;
