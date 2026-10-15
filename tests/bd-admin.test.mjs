// Business Development — Checkpoint 3A: the private Admin data layer and
// Organizations. Pure domain rules are exercised directly
// (src/lib/bd/domain.ts); the server boundary, actions and pages are pinned
// with source-level guards (this suite has no rendering harness and never
// touches a database). Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const D = await import("../src/lib/bd/domain.ts");

const MIGRATION = readFileSync("supabase/migrations/20261013000000_bd_foundation.sql", "utf8").replace(/--.*$/gm, "");
const CLIENT_PATH = join("src", "lib", "admin", "bd", "client.ts");
const CLIENT = readFileSync(CLIENT_PATH, "utf8");
const QUERIES = readFileSync("src/lib/admin/bd/organizations.ts", "utf8");
const BD_APP = join("src", "app", "admin", "(protected)", "bd");
const ACTIONS = readFileSync(join(BD_APP, "organizations", "actions.ts"), "utf8");
const FORM = readFileSync(join(BD_APP, "organizations", "OrganizationForm.tsx"), "utf8");
const LIST = readFileSync(join(BD_APP, "organizations", "page.tsx"), "utf8");
const DETAIL = readFileSync(join(BD_APP, "organizations", "[id]", "page.tsx"), "utf8");
const EDIT = readFileSync(join(BD_APP, "organizations", "[id]", "edit", "page.tsx"), "utf8");
const NAV = readFileSync("src/components/admin/adminNavItems.ts", "utf8");
const SEARCH = readFileSync("src/app/admin/api/search/route.ts", "utf8");

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const SRC = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const BD_FILES = [...walk(BD_APP), ...walk(join("src", "lib", "admin", "bd")), join("src", "lib", "bd", "domain.ts")];
const checkValues = (constraint) => {
  const m = MIGRATION.match(new RegExp(`constraint ${constraint} check \\(\\w+ in \\(([^)]*)\\)\\)`));
  assert.ok(m, constraint);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]);
};

// ── Domain ───────────────────────────────────────────────────────────────
test("domain: every value list matches the migration's CHECK constraint exactly", () => {
  assert.deepEqual([...D.ORGANIZATION_KINDS], checkValues("organizations_kind_check"));
  assert.deepEqual([...D.PROJECT_STAGES], checkValues("projects_stage_check"));
  assert.deepEqual([...D.PARTY_ROLES], checkValues("project_parties_role_check"));
  assert.deepEqual([...D.ACTIVITY_KINDS], checkValues("activities_kind_check"));
  assert.deepEqual(Object.keys(D.ORGANIZATION_KIND_LABELS), [...D.ORGANIZATION_KINDS]);
});

test("domain: organization limits match the column constraints", () => {
  assert.match(MIGRATION, /char_length\(btrim\(name\)\) between 1 and 200/);
  assert.match(MIGRATION, /website is null or char_length\(website\) between 1 and 500/);
  assert.match(MIGRATION, /organizations_notes_check check \(notes is null or char_length\(notes\) <= 5000\)/);
  assert.deepEqual({ ...D.ORGANIZATION_LIMITS }, { name: 200, website: 500, notes: 5000 });
});

test("validation: name required and trimmed; every other field optional and nullable", () => {
  assert.deepEqual(D.validateOrganizationInput({ name: "  Lavazza  " }), {
    ok: true,
    value: { name: "Lavazza", kind: null, website: null, business_id: null, notes: null },
  });
  for (const name of [undefined, null, "", "   "]) assert.equal(D.validateOrganizationInput({ name }).ok, false);
  assert.equal(D.validateOrganizationInput({ name: "x".repeat(200) }).ok, true);
  assert.equal(D.validateOrganizationInput({ name: "x".repeat(201) }).ok, false);
  assert.equal(D.validateOrganizationInput({ name: "A", website: "w".repeat(501) }).ok, false);
  assert.equal(D.validateOrganizationInput({ name: "A", notes: "n".repeat(5001) }).ok, false);
  assert.equal(D.validateOrganizationInput({ name: "A", notes: "n".repeat(5000) }).ok, true);
});

test("validation: kind optional but constrained; empty kind stays null (never forced)", () => {
  for (const kind of D.ORGANIZATION_KINDS) assert.equal(D.validateOrganizationInput({ name: "A", kind }).value.kind, kind);
  assert.equal(D.validateOrganizationInput({ name: "A", kind: "" }).value.kind, null);
  for (const kind of ["client", "Brand", "brandx", "x"]) assert.equal(D.validateOrganizationInput({ name: "A", kind }).ok, false, kind);
});

test("validation: optional Business link — uuid accepted, blank disconnects, junk rejected", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(D.validateOrganizationInput({ name: "A", business_id: id }).value.business_id, id);
  assert.equal(D.validateOrganizationInput({ name: "A", business_id: "" }).value.business_id, null, "cleared picker posts '' → unlink");
  assert.equal(D.validateOrganizationInput({ name: "A", business_id: "not-a-uuid" }).ok, false);
});

test("search terms are sanitized before reaching a PostgREST filter", () => {
  assert.equal(D.sanitizeBdSearchTerm("  Lava  zza "), "Lava zza");
  assert.equal(D.sanitizeBdSearchTerm("a,name.eq.x)"), "a name.eq.x");
  assert.equal(D.sanitizeBdSearchTerm('%_*"\\'), null);
  assert.equal(D.sanitizeBdSearchTerm(""), null);
  assert.equal(D.sanitizeBdSearchTerm(42), null);
  assert.equal(D.sanitizeBdSearchTerm("x".repeat(300)).length, 100);
});

test("errors: a duplicate Business link maps to a useful message, never the raw Postgres error", () => {
  const dup = { code: "23505", message: 'duplicate key value violates unique constraint "organizations_business_id_key"' };
  assert.match(D.organizationWriteErrorMessage(dup, "Lavazza US"), /already linked to the private Organization “Lavazza US”/);
  assert.match(D.organizationWriteErrorMessage(dup), /already linked to another private Organization/);
  assert.match(D.organizationWriteErrorMessage({ code: "23503", message: "fk" }), /no longer exists/);
  const generic = D.organizationWriteErrorMessage({ code: "XX000", message: "relation bd.organizations secret detail" });
  assert.doesNotMatch(generic, /relation|bd\.|secret/);
});

// ── Security boundary ───────────────────────────────────────────────────
test("security: .schema(\"bd\") exists only in the server-only, admin-authorized client", () => {
  const users = SRC.filter((f) => /\.schema\(\s*["']bd["']\s*\)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(users, [CLIENT_PATH]);
  assert.match(CLIENT, /^import "server-only";/);
  assert.match(CLIENT, /export async function getBdAdminClient\(\) \{\s*const supabase = await requireAdminSupabase\(\);\s*return supabase\.schema\("bd"\);\s*\}/);
  assert.match(QUERIES, /^import "server-only";/);
  assert.doesNotMatch(QUERIES, /getAdminSupabase\(/, "public Business reads also go through the admin-authorized client");
});

test("security: no Client Component and no non-Admin file imports private BD data access", () => {
  for (const f of SRC) {
    const src = readFileSync(f, "utf8");
    if (!/from ["'][^"']*lib\/admin\/bd\/[^"']*["']|from ["']\.\/client["']/.test(src)) continue;
    // The Admin search route is the one non-BD-area importer (3B's
    // bd_organizations picker branch, behind its requireAdmin()).
    const allowed = f.startsWith(join("src", "lib", "admin", "bd")) || f.startsWith(BD_APP) || f === join("src", "app", "admin", "api", "search", "route.ts");
    assert.ok(allowed, `${f} imports private BD data access outside the Admin BD area`);
    assert.doesNotMatch(src, /^["']use client["'];/m, `${f} is a Client Component importing private BD data access`);
  }
  assert.match(FORM, /^"use client";/);
  assert.doesNotMatch(FORM, /lib\/admin\/bd|supabase/i, "the form only calls Server Actions");
});

test("security: no service-role key, browser client, grants, policies or migration in BD code", () => {
  for (const f of BD_FILES) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE|createBrowserClient|createClient\(|@\/lib\/supabase"/, f);
    assert.doesNotMatch(src, /\bgrant\b|\bpolicy\b|row level security|\.rpc\(/i, f);
  }
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files.filter((f) => f > "20261013000000_bd_foundation.sql"), ["20261014000000_optional_business_geography.sql", "20261014010000_event_attendance_cta_and_location_visibility.sql" /* Event attendance pass */, "20261015000000_business_location_availability.sql" /* Find Us At pass */, "20261016000000_event_taxonomy_v1.sql" /* Event Taxonomy V1 pass */, "20261017000000_event_formats_v1.sql" /* Event Formats V1 pass */], "no BD migration after the BD foundation");
});

test("security: BD code never writes public.businesses (read-only, bounded, one query)", () => {
  for (const f of BD_FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.from\("businesses"\)([^;]*)/g)) {
      assert.doesNotMatch(m[1], /\.(insert|update|upsert|delete)\(/, f);
      assert.match(m[1], /^\.select\("id, name, slug, logo_url, city, state"\)\.in\("id", ids\)/, f);
    }
  }
  assert.match(QUERIES, /const ids = \[\.\.\.new Set\(businessIds\.filter/, "deduplicated ids, one read for a whole list (no N+1)");
});

// ── Admin / routing ──────────────────────────────────────────────────────
test("admin: every BD action authorizes before any privileged work", () => {
  assert.match(ACTIONS, /^"use server";/);
  const actions = [...ACTIONS.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*(.+)/g)];
  assert.deepEqual(actions.map((a) => a[1]).sort(), ["archiveOrganization", "createOrganization", "restoreOrganization", "updateOrganization"]);
  for (const [, name, firstLine] of actions) assert.equal(firstLine.trim(), "await requireAdmin();", name);
});

test("admin: BD routes live only under /admin; nav exposes only shipped routes", () => {
  for (const f of SRC.filter((f) => /[\\/]bd[\\/]/.test(f) && f.includes(join("src", "app")))) {
    assert.ok(f.startsWith(join("src", "app", "admin", "(protected)", "bd")), f);
  }
  assert.match(NAV, /label: "Business Development · Private"/);
  const bdHrefs = [...NAV.matchAll(/href: "(\/admin\/bd[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(bdHrefs, ["/admin/bd", "/admin/bd/organizations", "/admin/bd/contacts"], "only shipped BD routes — no dead Projects links");
  assert.match(SEARCH, /await requireAdmin\(\);/);
});

// ── Organization CRUD ────────────────────────────────────────────────────
test("create/edit: validated input written to bd.organizations only; duplicate link named", () => {
  assert.match(ACTIONS, /await bd\.from\("organizations"\)\.insert\(parsed\.value\)\.select\("id"\)\.single\(\)/);
  assert.match(ACTIONS, /await bd\.from\("organizations"\)\.update\(parsed\.value\)\.eq\("id", id\)/);
  assert.match(ACTIONS, /if \(!parsed\.ok\) return \{ error: parsed\.error \};/);
  assert.match(ACTIONS, /error\.code === "23505" && businessId \? await findOrganizationLinkedToBusiness\(businessId, exceptId\)/);
  assert.match(ACTIONS, /business_id: formData\.get\("business_id"\)/, "link and disconnect both flow through the same field");
  assert.doesNotMatch(ACTIONS, /\.delete\(\)/, "Organizations are never hard-deleted");
});

test("archive/restore: set and clear archived_at — no delete", () => {
  assert.match(ACTIONS, /\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)\.eq\("id", id\)\.is\("archived_at", null\)/);
  assert.match(ACTIONS, /\.update\(\{ archived_at: null \}\)\.eq\("id", id\)/);
  assert.match(DETAIL, /confirmMessage=\{`Archive "\$\{organization\.name\}"\?/, "archive asks first");
  assert.match(DETAIL, /isArchived \? \(\s*<ConfirmSubmitButton\s+action=\{restoreOrganization/);
});

test("list: archived hidden by default, archived view intentional, kind filter constrained, search server-side", () => {
  assert.match(QUERIES, /query = filters\.archived \? query\.not\("archived_at", "is", null\) : query\.is\("archived_at", null\);/);
  assert.match(QUERIES, /if \(filters\.kind\) query = query\.eq\("kind", filters\.kind\);/);
  assert.match(QUERIES, /const term = sanitizeBdSearchTerm\(filters\.q\);\s*if \(term\) query = query\.or\(`name\.ilike\.%\$\{term\}%,website\.ilike\.%\$\{term\}%`\);/);
  assert.match(QUERIES, /\.limit\(ORGANIZATION_LIST_LIMIT\)/);
  assert.match(LIST, /const kind = isOrganizationKind\(sp\.kind\) \? sp\.kind : null;/);
  assert.match(LIST, /const archived = sp\.archived === "1";/);
  assert.match(LIST, /getLinkedBusinesses\(organizations\.map\(\(o\) => o\.business_id\)\)/);
  assert.doesNotMatch(LIST, /<table/, "card rows, not a desktop table");
});

test("business link UI: existing RelationField, clearly labelled, disconnectable; edit never silently unlinks", () => {
  assert.match(FORM, /label="Linked Findmi Business \(Optional\)"/);
  assert.match(FORM, /name="business_id"\s+entity="businesses"/);
  assert.match(FORM, /clearLabel="Not linked"/);
  assert.match(EDIT, /: organization\.business_id\s*\?/);
  assert.match(EDIT, /\{ value: organization\.business_id, label: "Linked Findmi Business" \}/);
  assert.match(DETAIL, /href=\{`\/business\/\$\{business\.slug\}`\}/);
  assert.match(DETAIL, /Public Findmi Business/);
});
