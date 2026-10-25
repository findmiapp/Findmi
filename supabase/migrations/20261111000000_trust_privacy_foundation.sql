-- Trust, Privacy & Legal Infrastructure, Phase 2A.
--
-- Additive only: seven new tables, no changes to existing tables, no data
-- changed or deleted. Every table has RLS enabled.
--
-- 1. privacy_preferences   a signed-in person's privacy choices (own rows).
-- 2. legal_acceptances     versioned acceptance records (own rows readable;
--                           written by the server only).
-- 3. privacy_requests      export / delete / other privacy requests
--                           (service role only; tracked status).
-- 4. content_reports       corrections, removal requests, reports and
--                           copyright / trademark complaints about public
--                           content (service role only).
-- 5. conversation_blocks   a participant closing a conversation to new
--                           messages from the other side (own rows).
-- 6. admin_audit_events    privileged / admin action history (service role
--                           only). The shared admin password means
--                           actor_kind='admin' has no individual identity.
-- 7. entity_provenance     where a public Business / Event / Location (or
--                           an image) came from (service role only; never
--                           selected by a public read).
--
-- Deliberately NOT collected anywhere below: IP addresses, IP hashes, user
-- agents or device fingerprints.

-- ── 1. privacy_preferences ─────────────────────────────────────────────
create table if not exists public.privacy_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- null = no explicit choice yet. Analytics is never on without 'granted'.
  analytics_choice text check (analytics_choice in ('granted', 'denied')),
  analytics_choice_at timestamptz,
  -- Read-time personalization from the person's own explicit actions.
  -- Explicit actions (Save / Follow / Want / Must Do ...) keep working
  -- either way; this only controls ranking by them.
  personalized_discovery boolean not null default true,
  -- Future non-transactional marketing email. Off unless turned on.
  marketing_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.privacy_preferences enable row level security;

drop policy if exists privacy_preferences_select_own on public.privacy_preferences;
create policy privacy_preferences_select_own on public.privacy_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists privacy_preferences_insert_own on public.privacy_preferences;
create policy privacy_preferences_insert_own on public.privacy_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists privacy_preferences_update_own on public.privacy_preferences;
create policy privacy_preferences_update_own on public.privacy_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── 2. legal_acceptances ───────────────────────────────────────────────
create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable identifier, e.g. 'terms', 'privacy_acknowledgement',
  -- 'business_terms', 'marketplace_buyer_terms', 'marketplace_seller_terms',
  -- 'managed_services_terms', 'opportunity_terms', 'content_terms'. Validated
  -- in application code (src/lib/legal/documents.ts) so a new supplemental
  -- document never needs a migration.
  document text not null check (document ~ '^[a-z][a-z0-9_]{1,63}$'),
  version text not null check (char_length(version) between 1 and 40),
  -- Where it was accepted, e.g. 'signup', 'business_claim',
  -- 'business_creation', 'marketplace_checkout', 'seller_onboarding',
  -- 'moment_publish', 'managed_service', 'opportunity_engagement'.
  context text not null check (context ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- Optional subject (e.g. the Business a claim or creation was for).
  subject_type text check (subject_type in ('business', 'event', 'location', 'order', 'opportunity', 'moment')),
  subject_id uuid,
  accepted_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_doc_idx
  on public.legal_acceptances (user_id, document, accepted_at desc);

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_acceptances_select_own on public.legal_acceptances;
create policy legal_acceptances_select_own on public.legal_acceptances
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── 3. privacy_requests ────────────────────────────────────────────────
create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  -- set null (not cascade): a fulfilled deletion request must outlive the
  -- account it deleted, as the record that the request was handled.
  user_id uuid references auth.users(id) on delete set null,
  contact_email text,
  request_type text not null check (request_type in ('export', 'delete', 'access', 'correct', 'other')),
  status text not null default 'received' check (status in ('received', 'in_review', 'completed', 'declined', 'cancelled')),
  details text check (details is null or char_length(details) <= 4000),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (user_id is not null or contact_email is not null)
);

create index if not exists privacy_requests_status_idx on public.privacy_requests (status, created_at desc);
create index if not exists privacy_requests_user_idx on public.privacy_requests (user_id, created_at desc);

alter table public.privacy_requests enable row level security;

-- ── 4. content_reports ─────────────────────────────────────────────────
create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('business', 'event', 'location', 'product', 'moment', 'appearance', 'profile', 'conversation', 'message')),
  entity_id uuid not null,
  report_kind text not null check (report_kind in ('correction', 'removal', 'report', 'copyright', 'trademark')),
  reason text not null check (reason in ('inaccurate', 'privacy', 'copyright', 'trademark', 'impersonation', 'safety', 'abusive', 'spam_scam', 'other')),
  details text check (details is null or char_length(details) <= 4000),
  evidence_url text check (evidence_url is null or char_length(evidence_url) <= 2048),
  reporter_relationship text check (reporter_relationship in ('organization', 'rights_holder', 'authorized_agent', 'subject', 'visitor', 'other')),
  reporter_user_id uuid references auth.users(id) on delete set null,
  -- Only asked for when the reporter is signed out and wants a reply.
  reporter_email text check (reporter_email is null or char_length(reporter_email) <= 320),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  resolution text check (resolution in ('corrected', 'removed', 'restricted', 'no_action', 'other')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists content_reports_status_idx on public.content_reports (status, created_at desc);
create index if not exists content_reports_entity_idx on public.content_reports (entity_type, entity_id);
create index if not exists content_reports_reporter_idx on public.content_reports (reporter_user_id) where reporter_user_id is not null;

alter table public.content_reports enable row level security;

-- ── 5. conversation_blocks ─────────────────────────────────────────────
create table if not exists public.conversation_blocks (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_blocks_user_idx on public.conversation_blocks (user_id);

alter table public.conversation_blocks enable row level security;

drop policy if exists conversation_blocks_select_own on public.conversation_blocks;
create policy conversation_blocks_select_own on public.conversation_blocks
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── 6. admin_audit_events ──────────────────────────────────────────────
create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- 'admin' = the shared founder admin session (no individual identity);
  -- 'user' = a signed-in account (actor_user_id set).
  actor_kind text not null check (actor_kind in ('admin', 'user')),
  actor_user_id uuid,
  target_type text check (char_length(target_type) <= 40),
  target_id text check (char_length(target_id) <= 80),
  -- Bounded, non-sensitive context only. Never passwords, tokens or
  -- message bodies (enforced in src/lib/admin/audit.ts).
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (actor_kind = 'admin' or actor_user_id is not null)
);

create index if not exists admin_audit_events_created_idx on public.admin_audit_events (created_at desc);
create index if not exists admin_audit_events_target_idx on public.admin_audit_events (target_type, target_id);

alter table public.admin_audit_events enable row level security;

-- ── 7. entity_provenance ───────────────────────────────────────────────
create table if not exists public.entity_provenance (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('business', 'event', 'location', 'business_image', 'event_image', 'location_image')),
  entity_id uuid not null,
  -- organization = provided by the organization itself;
  -- findmi        = compiled by Findmi (admin) from public information;
  -- import        = created through an importer (URL / paste / image / CSV);
  -- community     = submitted by a member of the public.
  source_kind text not null check (source_kind in ('organization', 'findmi', 'import', 'community')),
  -- e.g. 'event_url_import', 'brand_website_import', 'admin_manual'.
  source_method text check (source_method is null or source_method ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_url text check (source_url is null or char_length(source_url) <= 2048),
  -- Media only: the basis Findmi holds the image on.
  rights_basis text check (rights_basis in ('provided_by_organization', 'public_source', 'licensed', 'findmi_original', 'unknown')),
  recorded_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  unique (entity_type, entity_id)
);

alter table public.entity_provenance enable row level security;

-- ── Access boundaries ──────────────────────────────────────────────────
-- Supabase's default privileges grant anon/authenticated full table rights
-- on every new public table. Revoke them all, then grant back only what
-- each table needs. service_role keeps full access (server code only).
revoke all on public.privacy_preferences, public.legal_acceptances, public.privacy_requests,
  public.content_reports, public.conversation_blocks, public.admin_audit_events,
  public.entity_provenance from anon, authenticated;

grant select, insert, update on public.privacy_preferences to authenticated;
grant select on public.legal_acceptances to authenticated;
grant select on public.conversation_blocks to authenticated;

-- ── updated_at maintenance ─────────────────────────────────────────────
-- Reuses the project's existing public.set_updated_at() trigger function.
drop trigger if exists trg_privacy_preferences_updated_at on public.privacy_preferences;
create trigger trg_privacy_preferences_updated_at before update on public.privacy_preferences
  for each row execute function public.set_updated_at();
drop trigger if exists trg_privacy_requests_updated_at on public.privacy_requests;
create trigger trg_privacy_requests_updated_at before update on public.privacy_requests
  for each row execute function public.set_updated_at();
drop trigger if exists trg_content_reports_updated_at on public.content_reports;
create trigger trg_content_reports_updated_at before update on public.content_reports
  for each row execute function public.set_updated_at();
