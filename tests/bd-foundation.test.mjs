// Business Development Phase 1 — Checkpoint 1: the private `bd` schema
// foundation migration (supabase/migrations/20261013000000_bd_foundation.sql).
// Static guards on the migration's SEMANTICS and privilege model. The
// behavior itself is validated against a disposable local Postgres with
// Supabase-like roles (see the checkpoint report); this migration is NOT
// applied to production by this repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const FILE = "20261013000000_bd_foundation.sql";
const RAW = readFileSync(join(DIR, FILE), "utf8");
// Code only (comments stripped), whitespace collapsed, lowercase.
const SQL = RAW.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
const TABLES = ["organizations", "contacts", "projects", "project_parties", "activities"];

/** The body of one `create table bd.<name> ( … );` statement. */
function table(name) {
  const start = SQL.indexOf(`create table bd.${name} (`);
  assert.ok(start >= 0, `bd.${name}`);
  return SQL.slice(start, SQL.indexOf(");", start) + 2);
}
const columns = (name) =>
  [...table(name).matchAll(/[(,] ([a-z_]+) (uuid|text|timestamptz)\b/g)].map((m) => m[1]);
const checkValues = (body, constraint) => {
  const m = body.match(new RegExp(`constraint ${constraint} check \\(\\w+ in \\(([^)]*)\\)\\)`));
  assert.ok(m, constraint);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]);
};

test("one additive migration, directly after the current head (Phase 0B)", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf(FILE) - 1], "20261012020000_business_select_privacy_boundary.sql");
  assert.equal(files.filter((f) => /\bbd_|_bd_/.test(f)).length, 1);
  assert.ok(statSync(join(DIR, FILE)).size < 20_000);
});

test("creates exactly the bd schema and the five approved tables — fails loudly if bd already exists", () => {
  assert.match(SQL, /^create schema bd;/, "plain create — never silently adopts an existing schema");
  assert.doesNotMatch(SQL, /create schema if not exists/);
  const created = [...SQL.matchAll(/create table ([a-z_.]+) \(/g)].map((m) => m[1]);
  assert.deepEqual(created.sort(), TABLES.map((t) => `bd.${t}`).sort());
  assert.equal((SQL.match(/create schema/g) ?? []).length, 1);
});

test("organizations: approved minimum fields; descriptive kinds; optional unique Business link (SET NULL)", () => {
  const body = table("organizations");
  assert.deepEqual(columns("organizations"), ["id", "name", "kind", "website", "business_id", "notes", "archived_at", "created_at", "updated_at"]);
  assert.deepEqual(checkValues(body, "organizations_kind_check").sort(), ["agency", "brand", "media", "other", "partner", "sponsor", "vendor", "venue"]);
  assert.match(body, /kind text constraint organizations_kind_check/, "kind is optional");
  assert.match(body, /business_id uuid constraint organizations_business_id_key unique constraint organizations_business_id_fkey references public\.businesses\(id\) on delete set null/);
  assert.match(body, /name text not null constraint organizations_name_check check \(char_length\(btrim\(name\)\) between 1 and 200\)/);
});

test("contacts: Organization optional (SET NULL); approved fields only", () => {
  const body = table("contacts");
  assert.deepEqual(columns("contacts"), ["id", "organization_id", "name", "title", "email", "phone", "notes", "archived_at", "created_at", "updated_at"]);
  assert.match(body, /organization_id uuid constraint contacts_organization_id_fkey references bd\.organizations\(id\) on delete set null/);
  assert.doesNotMatch(body, /organization_id uuid not null/);
});

test("projects: approved fields and stages, default lead; next action is not a task system", () => {
  const body = table("projects");
  assert.deepEqual(columns("projects"), ["id", "name", "stage", "summary", "next_action", "next_action_at", "created_at", "updated_at"]);
  assert.deepEqual(checkValues(body, "projects_stage_check"), ["lead", "qualified", "proposal", "negotiation", "won", "delivering", "completed", "lost", "on_hold"]);
  assert.match(body, /stage text not null default 'lead'/);
  assert.match(body, /next_action_at timestamptz,/);
  assert.doesNotMatch(SQL, /probabilit|assignee|reminder|task|owner|amount|budget|revenue|cost|fee|commission|client_id/, "no economics, owners, tasks or a single client field");
});

test("project_parties: contextual roles incl. operator; unique (project, organization, role); cascade/restrict", () => {
  const body = table("project_parties");
  assert.deepEqual(columns("project_parties"), ["id", "project_id", "organization_id", "role", "notes", "created_at"]);
  assert.deepEqual(checkValues(body, "project_parties_role_check").sort(), ["brand", "client", "operator", "partner", "payer", "sponsor", "vendor", "venue"]);
  assert.match(body, /project_id uuid not null constraint project_parties_project_id_fkey references bd\.projects\(id\) on delete cascade/);
  assert.match(body, /organization_id uuid not null constraint project_parties_organization_id_fkey references bd\.organizations\(id\) on delete restrict/);
  assert.match(body, /constraint project_parties_project_organization_role_key unique \(project_id, organization_id, role\)/);
  // Organization kind never constrains party roles (no cross-table check/trigger).
  assert.doesNotMatch(SQL, /create (or replace )?function|create trigger [a-z_]+ before insert/);
});

test("activities (Notes & Activity): approved kinds; occurred_at timestamptz default now(); ≥1 parent link", () => {
  const body = table("activities");
  assert.deepEqual(columns("activities"), ["id", "kind", "body", "occurred_at", "organization_id", "contact_id", "project_id", "created_at", "updated_at"]);
  assert.deepEqual(checkValues(body, "activities_kind_check").sort(), ["call", "email", "meeting", "note", "other", "proposal"]);
  assert.match(body, /occurred_at timestamptz not null default now\(\)/);
  assert.doesNotMatch(SQL, /occurred_on|\bdate\b/);
  assert.match(body, /constraint activities_parent_check check \(num_nonnulls\(organization_id, contact_id, project_id\) >= 1\)/);
  for (const [col, ref] of [["organization_id", "organizations"], ["contact_id", "contacts"], ["project_id", "projects"]]) {
    assert.match(body, new RegExp(`${col} uuid constraint activities_${col}_fkey references bd\\.${ref}\\(id\\) on delete set null`), col);
  }
});

test("indexes: foreign keys and list orders only", () => {
  const idx = [...SQL.matchAll(/create (unique )?index ([a-z_]+) on ([a-z_.]+) \(([^)]*)\)/g)].map((m) => `${m[2]} ${m[3]}(${m[4]})`);
  assert.deepEqual(idx.sort(), [
    "activities_contact_id_idx bd.activities(contact_id, occurred_at desc)",
    "activities_occurred_at_idx bd.activities(occurred_at desc)",
    "activities_organization_id_idx bd.activities(organization_id, occurred_at desc)",
    "activities_project_id_idx bd.activities(project_id, occurred_at desc)",
    "contacts_organization_id_idx bd.contacts(organization_id)",
    "project_parties_organization_id_idx bd.project_parties(organization_id)",
    "projects_stage_idx bd.projects(stage)",
  ]);
});

test("updated_at: reuses public.set_updated_at() on the four editable tables (parties are append-only)", () => {
  const triggers = [...SQL.matchAll(/create trigger (\w+) before update on bd\.(\w+) for each row execute function public\.set_updated_at\(\);/g)].map((m) => m[2]);
  assert.deepEqual(triggers.sort(), ["activities", "contacts", "organizations", "projects"]);
  assert.equal((SQL.match(/create trigger/g) ?? []).length, 4);
});

test("security: schema USAGE for service_role only; nothing for PUBLIC/anon/authenticated", () => {
  assert.match(SQL, /revoke all on schema bd from public;/);
  assert.match(SQL, /revoke all on schema bd from anon, authenticated;/);
  assert.match(SQL, /grant usage on schema bd to service_role;/);
  assert.doesNotMatch(SQL, /grant [^;]* on schema bd to [^;]*(anon|authenticated|public)\b/);
  assert.doesNotMatch(SQL, /grant (create|all)[^;]* on schema bd/);
});

test("security: every table RLS-enabled, zero policies, explicit revokes, service_role CRUD only", () => {
  for (const t of TABLES) assert.match(SQL, new RegExp(`alter table bd\\.${t} enable row level security;`), t);
  assert.doesNotMatch(SQL, /create policy|alter policy|disable row level security|security definer/);
  const list = TABLES.map((t) => `bd.${t}`).join(", ");
  assert.ok(SQL.includes(`revoke all on table ${list} from public, anon, authenticated;`));
  assert.ok(SQL.includes(`grant select, insert, update, delete on table ${list} to service_role;`));
  assert.doesNotMatch(SQL, /grant [^;]* to [^;]*\b(anon|authenticated|public)\b/, "no grants to client roles");
  assert.doesNotMatch(SQL, /grant (all|truncate|references|trigger)/);
});

test("security: future bd tables default to service_role only", () => {
  assert.match(SQL, /alter default privileges in schema bd revoke all on tables from public, anon, authenticated;/);
  assert.match(SQL, /alter default privileges in schema bd grant select, insert, update, delete on tables to service_role;/);
  assert.doesNotMatch(SQL, /alter default privileges[^;]* grant [^;]* to [^;]*(anon|authenticated|public)/);
});

test("scope: additive only — no public changes, no functions, no data, no ledger", () => {
  assert.doesNotMatch(SQL, /alter table public\.|drop |truncate |delete from |update [a-z_.]+ set |insert into /);
  assert.doesNotMatch(SQL, /create (or replace )?function|create (or replace )?view|create extension/);
  assert.doesNotMatch(SQL, /schema_migrations|supabase_migrations/);
  assert.doesNotMatch(SQL, /membership_status/, "Phase 0A is a separate issue");
  // The only references into public: the Business FK and the shared trigger function.
  const publicRefs = [...new Set([...SQL.matchAll(/public\.[a-z_]+/g)].map((m) => m[0]))].sort();
  assert.deepEqual(publicRefs, ["public.businesses", "public.set_updated_at"]);
});

test("app boundary: only the approved private Admin BD server boundary reads the bd schema", () => {
  // Checkpoint 3A narrowed this from "nothing reads bd": the ONE file
  // allowed to select the schema is the server-only, admin-authorized
  // client. Any other `.schema("bd")` or raw `bd.<table>` reference in src
  // fails here (tests/bd-admin.test.mjs guards the rest of the boundary).
  const APPROVED = join("src", "lib", "admin", "bd", "client.ts");
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const offenders = walk("src").filter((f) => f !== APPROVED && /\.(ts|tsx)$/.test(f) && /\.schema\(\s*["']bd["']\s*\)|["']bd\.(organizations|contacts|projects|project_parties|activities)["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
  const client = readFileSync(APPROVED, "utf8");
  assert.match(client, /^import "server-only";/);
  assert.match(client, /await requireAdminSupabase\(\);\s*return supabase\.schema\("bd"\);/);
});
