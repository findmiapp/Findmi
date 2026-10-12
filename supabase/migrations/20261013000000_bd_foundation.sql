-- Business Development Phase 1 — private BD foundation (schema `bd`).
--
-- Internal, Admin-only commercial context: Organizations, Contacts,
-- Projects, Project Parties and Notes & Activity. Nothing here is public
-- and nothing here changes public Findmi.
--
-- Privacy boundary: a separate schema whose USAGE is granted to
-- service_role ONLY. anon/authenticated (and PUBLIC) cannot resolve
-- anything in `bd` — even a future table that some default privilege
-- grants to them stays unreachable without schema USAGE. Every table also
-- has RLS enabled with ZERO policies (service_role bypasses RLS; nothing
-- else could read a row even with a grant) and explicit table revokes.
--
-- Additive only: creates schema bd and five tables in it. The only
-- references into `public` are a foreign key to public.businesses(id)
-- and reuse of the existing trigger function public.set_updated_at()
-- (SECURITY INVOKER, search_path = '', only assigns NEW.updated_at). No
-- public object is altered, no function is created, no data is written.
--
-- Deployment note: supabase-js `.schema('bd')` additionally requires
-- `bd` in the Data API "Exposed schemas" setting (a separate, explicitly
-- approved production step — not part of this migration). Exposing the
-- schema does not grant access: the USAGE revoke below still applies.

create schema bd;

-- ── Schema privileges ────────────────────────────────────────────────────
revoke all on schema bd from public;
revoke all on schema bd from anon, authenticated;
grant usage on schema bd to service_role;

-- Future tables created in bd by the migration role get service_role CRUD
-- automatically. The schema-scoped revoke is defensive: it only clears
-- schema-specific defaults (a new schema has none) — Postgres cannot
-- revoke GLOBAL default privileges per schema (e.g. PUBLIC's built-in
-- EXECUTE on functions). The boundary for every future object is the
-- schema USAGE revoke above: without it, anon/authenticated cannot
-- resolve any table, view or function in bd whatever its own grants.
alter default privileges in schema bd revoke all on tables from public, anon, authenticated;
alter default privileges in schema bd grant select, insert, update, delete on tables to service_role;

-- ── Organizations ────────────────────────────────────────────────────────
-- Any company Findmi deals with privately. `kind` is descriptive only —
-- it never limits the roles an Organization may hold in a Project.
-- `business_id` optionally links a public Findmi Business (unique when
-- present); linking/unlinking never changes the Business itself.
create table bd.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint organizations_name_check check (char_length(btrim(name)) between 1 and 200),
  kind text
    constraint organizations_kind_check check (kind in ('brand', 'agency', 'venue', 'vendor', 'sponsor', 'media', 'partner', 'other')),
  website text
    constraint organizations_website_check check (website is null or char_length(website) between 1 and 500),
  business_id uuid
    constraint organizations_business_id_key unique
    constraint organizations_business_id_fkey references public.businesses(id) on delete set null,
  notes text
    constraint organizations_notes_check check (notes is null or char_length(notes) <= 5000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Contacts ─────────────────────────────────────────────────────────────
-- A person Findmi deals with; an Organization is optional.
create table bd.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid
    constraint contacts_organization_id_fkey references bd.organizations(id) on delete set null,
  name text not null
    constraint contacts_name_check check (char_length(btrim(name)) between 1 and 200),
  title text
    constraint contacts_title_check check (title is null or char_length(title) <= 200),
  email text
    constraint contacts_email_check check (email is null or char_length(email) <= 320),
  phone text
    constraint contacts_phone_check check (phone is null or char_length(phone) <= 50),
  notes text
    constraint contacts_notes_check check (notes is null or char_length(notes) <= 5000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Projects ─────────────────────────────────────────────────────────────
-- The commercial root (one row Deal → Project). No client required.
-- next_action / next_action_at: the immediate commercial next step — not
-- a task system (no assignees, statuses or reminders).
create table bd.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint projects_name_check check (char_length(btrim(name)) between 1 and 200),
  stage text not null default 'lead'
    constraint projects_stage_check check (stage in ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'delivering', 'completed', 'lost', 'on_hold')),
  summary text
    constraint projects_summary_check check (summary is null or char_length(summary) <= 5000),
  next_action text
    constraint projects_next_action_check check (next_action is null or char_length(next_action) <= 500),
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Project Parties ──────────────────────────────────────────────────────
-- How an Organization participates in a Project; the role is contextual
-- and authoritative for that Project. One row per role (an Organization
-- can be both Brand and Client). Deleting a Project removes its parties;
-- an Organization cannot be deleted while it is a party.
create table bd.project_parties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    constraint project_parties_project_id_fkey references bd.projects(id) on delete cascade,
  organization_id uuid not null
    constraint project_parties_organization_id_fkey references bd.organizations(id) on delete restrict,
  role text not null
    constraint project_parties_role_check check (role in ('client', 'payer', 'brand', 'sponsor', 'venue', 'vendor', 'partner', 'operator')),
  notes text
    constraint project_parties_notes_check check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  constraint project_parties_project_organization_role_key unique (project_id, organization_id, role)
);

-- ── Notes & Activity ─────────────────────────────────────────────────────
-- The private log. Related to at least one of Organization / Contact /
-- Project (any combination). Parent links are SET NULL on delete, but the
-- at-least-one check means a parent whose deletion would orphan a note is
-- blocked rather than silently losing the note.
create table bd.activities (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    constraint activities_kind_check check (kind in ('note', 'meeting', 'call', 'email', 'proposal', 'other')),
  body text not null
    constraint activities_body_check check (char_length(btrim(body)) between 1 and 5000),
  occurred_at timestamptz not null default now(),
  organization_id uuid
    constraint activities_organization_id_fkey references bd.organizations(id) on delete set null,
  contact_id uuid
    constraint activities_contact_id_fkey references bd.contacts(id) on delete set null,
  project_id uuid
    constraint activities_project_id_fkey references bd.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_parent_check check (num_nonnulls(organization_id, contact_id, project_id) >= 1)
);

-- ── Indexes (foreign keys + the obvious list orders) ────────────────────
create index contacts_organization_id_idx on bd.contacts (organization_id);
create index projects_stage_idx on bd.projects (stage);
create index project_parties_organization_id_idx on bd.project_parties (organization_id);
create index activities_organization_id_idx on bd.activities (organization_id, occurred_at desc);
create index activities_contact_id_idx on bd.activities (contact_id, occurred_at desc);
create index activities_project_id_idx on bd.activities (project_id, occurred_at desc);
create index activities_occurred_at_idx on bd.activities (occurred_at desc);

-- ── updated_at (existing shared trigger function) ────────────────────────
create trigger trg_bd_organizations_updated_at
  before update on bd.organizations
  for each row execute function public.set_updated_at();
create trigger trg_bd_contacts_updated_at
  before update on bd.contacts
  for each row execute function public.set_updated_at();
create trigger trg_bd_projects_updated_at
  before update on bd.projects
  for each row execute function public.set_updated_at();
create trigger trg_bd_activities_updated_at
  before update on bd.activities
  for each row execute function public.set_updated_at();

-- ── RLS: enabled, zero policies ──────────────────────────────────────────
alter table bd.organizations enable row level security;
alter table bd.contacts enable row level security;
alter table bd.projects enable row level security;
alter table bd.project_parties enable row level security;
alter table bd.activities enable row level security;

-- ── Table privileges: service_role CRUD only ─────────────────────────────
revoke all on table bd.organizations, bd.contacts, bd.projects, bd.project_parties, bd.activities from public, anon, authenticated;
grant select, insert, update, delete on table bd.organizations, bd.contacts, bd.projects, bd.project_parties, bd.activities to service_role;
