// Business Development — Checkpoint 3B: private Contacts. Pure Contact
// validation is exercised directly (src/lib/bd/domain.ts); the server
// boundary, actions, pages and the Organization integration are pinned with
// source-level guards (no rendering harness, never a database). The 3A
// suite (bd-admin.test.mjs) and the narrowed foundation boundary
// (bd-foundation.test.mjs) keep guarding the shared layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const D = await import("../src/lib/bd/domain.ts");

const MIGRATION = readFileSync("supabase/migrations/20261013000000_bd_foundation.sql", "utf8").replace(/--.*$/gm, "");
const BD_APP = join("src", "app", "admin", "(protected)", "bd");
const C = join(BD_APP, "contacts");
const read = (...p) => readFileSync(join(...p), "utf8");
const QUERIES = read("src", "lib", "admin", "bd", "contacts.ts");
const ORG_QUERIES = read("src", "lib", "admin", "bd", "organizations.ts");
const ACTIONS = read(C, "actions.ts");
const FORM = read(C, "ContactForm.tsx");
const ROW = read(C, "ContactRow.tsx");
const LIST = read(C, "page.tsx");
const NEW = read(C, "new", "page.tsx");
const DETAIL = read(C, "[id]", "page.tsx");
const EDIT = read(C, "[id]", "edit", "page.tsx");
const ORG_DETAIL = read(BD_APP, "organizations", "[id]", "page.tsx");
const SEARCH = read("src", "app", "admin", "api", "search", "route.ts");
const PICKER = read("src", "components", "admin", "RelationPicker.tsx");
const SEARCH_HOOK = read("src", "components", "admin", "useAdminSearch.ts");

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const SRC = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const ID = "11111111-1111-4111-8111-111111111111";

// ── Domain ───────────────────────────────────────────────────────────────
test("domain: Contact limits match bd.contacts' CHECK constraints", () => {
  const body = MIGRATION.slice(MIGRATION.indexOf("create table bd.contacts ("), MIGRATION.indexOf("create table bd.projects ("));
  assert.match(body, /contacts_name_check check \(char_length\(btrim\(name\)\) between 1 and 200\)/);
  assert.match(body, /contacts_title_check check \(title is null or char_length\(title\) <= 200\)/);
  assert.match(body, /contacts_email_check check \(email is null or char_length\(email\) <= 320\)/);
  assert.match(body, /contacts_phone_check check \(phone is null or char_length\(phone\) <= 50\)/);
  assert.match(body, /contacts_notes_check check \(notes is null or char_length\(notes\) <= 5000\)/);
  assert.match(body, /organization_id uuid\s+constraint contacts_organization_id_fkey references bd\.organizations\(id\) on delete set null/);
  assert.deepEqual({ ...D.CONTACT_LIMITS }, { name: 200, title: 200, email: 320, phone: 50, notes: 5000 });
});

test("validation: a Contact is valid with only a (trimmed) name; everything else optional", () => {
  assert.deepEqual(D.validateContactInput({ name: "  Daniele Foti " }), {
    ok: true,
    value: { name: "Daniele Foti", organization_id: null, title: null, email: null, phone: null, notes: null },
  });
  for (const name of [undefined, null, "", "   "]) assert.equal(D.validateContactInput({ name }).ok, false);
  const blanks = D.validateContactInput({ name: "A", organization_id: "", title: " ", email: "", phone: "", notes: "" });
  assert.deepEqual(blanks.value, { name: "A", organization_id: null, title: null, email: null, phone: null, notes: null });
});

test("validation: max lengths enforced exactly at the schema limits", () => {
  for (const [key, max] of Object.entries(D.CONTACT_LIMITS)) {
    assert.equal(D.validateContactInput({ name: "A", [key]: "x".repeat(max) }).ok, true, `${key} at ${max}`);
    assert.equal(D.validateContactInput({ name: "A", [key]: "x".repeat(max + 1) }).ok, false, `${key} over ${max}`);
  }
});

test("validation: no invented email format rule; Organization optional uuid", () => {
  assert.equal(D.validateContactInput({ name: "A", email: "not an email at all" }).ok, true, "the schema has no email format check");
  assert.equal(D.validateContactInput({ name: "A", organization_id: ID }).value.organization_id, ID);
  assert.equal(D.validateContactInput({ name: "A", organization_id: "nope" }).ok, false);
  assert.match(D.contactWriteErrorMessage({ code: "23503", message: "fk" }), /Organization no longer exists/);
  assert.doesNotMatch(D.contactWriteErrorMessage({ code: "XX000", message: "relation bd.contacts detail" }), /relation|bd\./);
});

// ── Security boundary ───────────────────────────────────────────────────
test("security: Contact access is server-only and goes through the approved BD client", () => {
  assert.match(QUERIES, /^import "server-only";/);
  assert.match(QUERIES, /import \{ getBdAdminClient \} from "\.\/client";/);
  assert.doesNotMatch(QUERIES, /\.schema\(|getAdminSupabase|requireAdminSupabase|createClient/);
  assert.equal((QUERIES.match(/await getBdAdminClient\(\)/g) ?? []).length, 3, "every Contact read goes through the BD client");
});

test("security: every Contact action authorizes before any privileged work; no hard delete", () => {
  assert.match(ACTIONS, /^"use server";/);
  const actions = [...ACTIONS.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*(.+)/g)];
  assert.deepEqual(actions.map((a) => a[1]).sort(), ["archiveContact", "createContact", "restoreContact", "updateContact"]);
  for (const [, name, firstLine] of actions) assert.equal(firstLine.trim(), "await requireAdmin();", name);
  assert.doesNotMatch(ACTIONS, /\.delete\(\)/);
  assert.doesNotMatch(ACTIONS, /from\("organizations"\)|from\("businesses"\)/, "Contact actions never write Organizations or Businesses");
});

test("security: Contact data never reaches public code, a Client Component's imports, or a browser client", () => {
  for (const f of SRC) {
    const src = readFileSync(f, "utf8");
    if (!/from ["'][^"']*lib\/admin\/bd\/contacts["']/.test(src)) continue;
    assert.ok(f.startsWith(BD_APP), `${f} imports Contact data outside the Admin BD area`);
    assert.doesNotMatch(src, /^["']use client["'];/m, `${f} is a Client Component importing Contact data`);
  }
  assert.match(FORM, /^"use client";/);
  assert.doesNotMatch(FORM, /lib\/admin\/bd|supabase/i);
  for (const f of walk(C)) assert.doesNotMatch(readFileSync(f, "utf8"), /trackEvent|analytics|generateMetadata/, `${f}: no analytics payloads or dynamic metadata`);
  assert.doesNotMatch(read("src", "app", "sitemap.ts"), /contacts|bd/);
});

test("security: no migration, grant, policy or public Business write introduced", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files.filter((f) => f > "20261013000000_bd_foundation.sql"), ["20261014000000_optional_business_geography.sql", "20261014010000_event_attendance_cta_and_location_visibility.sql" /* Event attendance pass */, "20261015000000_business_location_availability.sql" /* Find Us At pass */, "20261016000000_event_taxonomy_v1.sql" /* Event Taxonomy V1 pass */, "20261017000000_event_formats_v1.sql" /* Event Formats V1 pass */, "20261018000000_event_occurrence_details.sql" /* Event Occurrence details pass */, "20261018220515_discovery_lanes_add_placement.sql" /* Discovery Lanes Placement & Density Refinement pass */, "20261018223910_discovery_lanes_set_primary_lane_rpc.sql" /* atomic Make Primary RPC */, "20261018224010_discovery_lanes_set_primary_lane_rpc_restrict_grants.sql" /* atomic Make Primary RPC */, "20261018233210_market_areas_add_image_url.sql" /* Discovery Tile Visual System, Part B */, "20261019000000_event_date_time_precision.sql" /* Event date/time precision pass */, "20261020000000_moment_authorship_and_access_history.sql" /* Identity & Authorship V1 pass */, "20261021000000_brand_audit_and_opportunity_ideas.sql" /* Brand Audit + Opportunity Ideas V1 pass */, "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */, "20261025000000_canonical_entity_geography.sql" /* Canonical Entity Geography pass */, "20261026000000_business_availability_details.sql" /* Business Manager redesign: Where To Find Us details */, "20261101000000_findmi_here_relationships_sets_import.sql" /* Missing-functionality pass */, "20261101000100_entity_moment_display.sql" /* Missing-functionality pass */, "20261102000000_business_location_placements.sql" /* Pass 2 Block A */, "20261102010000_growth_goal_increase_distribution.sql" /* Pass 2 Block A */, "20261103000000_business_location_placement_activities.sql" /* Pass 2 Block A closeout */, "20261104000000_opportunity_listings_geography.sql" /* Pass 2 Block B */, "20261105000000_opportunity_relationship_thread.sql" /* Opportunity Relationship Thread */, "20261106000000_business_targets.sql" /* Cross-Entity Target Foundation */, "20261107000000_commercial_discovery_categories.sql" /* Commercial Discovery Foundation */, "20261108000000_commercial_inquiries.sql" /* Commercial Inquiry v1 */, "20261109000000_entity_public_actions.sql" /* Public Actions */, "20261110000000_location_import_target.sql" /* Location import target */, "20261111000000_trust_privacy_foundation.sql" /* Trust & Privacy Phase 2A */]);
  for (const f of [...walk(C), join("src", "lib", "admin", "bd", "contacts.ts")]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\bgrant\b|\bpolicy\b|row level security|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE/i, f);
    assert.doesNotMatch(src, /from\("businesses"\)/, f);
  }
});

// ── Search ───────────────────────────────────────────────────────────────
test("search: only bd_organizations is added, behind requireAdmin, sanitized, minimal fields", () => {
  const auth = SEARCH.indexOf("await requireAdmin();");
  const branch = SEARCH.indexOf('if (entity === "bd_organizations")');
  assert.ok(auth > 0 && branch > auth, "the BD branch runs only after Admin authorization");
  assert.doesNotMatch(SEARCH, /bd_contacts|bd_projects/);
  const fn = ORG_QUERIES.slice(ORG_QUERIES.indexOf("export async function searchOrganizationsForPicker"));
  assert.match(fn, /const term = sanitizeBdSearchTerm\(q\);\s*if \(!term\) return \[\];/);
  assert.match(fn, /\.select\("id, name, kind, archived_at"\)\.ilike\("name", `%\$\{term\}%`\)\.order\("name"\)\.limit\(20\)/, "single-column ilike — no .or() interpolation");
  assert.doesNotMatch(fn, /notes|website|business_id/, "never exposes private fields");
  assert.match(SEARCH_HOOK, /"bd_organizations"/);
  assert.match(PICKER, /entity: AdminSearchEntity;/);
  assert.match(PICKER, /badgeFor=\{badgeFor\}/, "additive passthrough; existing callers unaffected");
});

// ── CRUD ─────────────────────────────────────────────────────────────────
test("create/edit: validated Contact written to bd.contacts; Organization set, changed or cleared", () => {
  assert.match(ACTIONS, /await bd\.from\("contacts"\)\.insert\(parsed\.value\)\.select\("id"\)\.single\(\)/);
  assert.match(ACTIONS, /await bd\.from\("contacts"\)\.update\(parsed\.value\)\.eq\("id", id\)/);
  assert.match(ACTIONS, /organization_id: formData\.get\("organization_id"\)/, "blank clears the link (validated to null)");
  assert.match(FORM, /name="organization_id"\s+entity="bd_organizations"/);
  assert.match(FORM, /clearLabel="No Organization"/);
});

test("Organization assignment: must exist; archived blocked for NEW assignment but an existing link is preserved", () => {
  const fn = ACTIONS.slice(ACTIONS.indexOf("async function organizationAssignmentError"), ACTIONS.indexOf("function revalidateContact"));
  assert.match(fn, /if \(!organization\) return "That Organization no longer exists/);
  assert.match(fn, /if \(organization\.archived_at && organizationId !== currentOrganizationId\)/);
  assert.match(ACTIONS, /organizationAssignmentError\(parsed\.value\.organization_id, null\)/, "create: no existing link to preserve");
  assert.match(ACTIONS, /organizationAssignmentError\(parsed\.value\.organization_id, current\.organization_id\)/, "edit: the current link is allowed");
  assert.match(FORM, /badgeFor=\{\(r\) => \(r\.archived \? "Archived" : null\)\}/, "archived Organizations listed but not pickable");
  assert.match(EDIT, /label: contact\.organization\?\.name \?\? "Linked Organization"/);
  assert.match(EDIT, /sublabel: contact\.organization\?\.archived_at \? "Archived" : undefined/);
});

test("archive/restore: set and clear archived_at with confirmation", () => {
  assert.match(ACTIONS, /\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("id", id\)\s*\.is\("archived_at", null\)/);
  assert.match(ACTIONS, /\.update\(\{ archived_at: null \}\)\.eq\("id", id\)/);
  assert.match(DETAIL, /confirmMessage=\{`Archive "\$\{contact\.name\}"\?/);
  assert.match(DETAIL, /isArchived \? \(\s*<ConfirmSubmitButton\s+action=\{restoreContact/);
});

test("list: active by default, Archived view, Organization filter, server-side sanitized search, bounded", () => {
  assert.match(QUERIES, /query = filters\.archived \? query\.not\("archived_at", "is", null\) : query\.is\("archived_at", null\);/);
  assert.match(QUERIES, /if \(filters\.organizationId\) query = query\.eq\("organization_id", filters\.organizationId\);/);
  assert.match(QUERIES, /const term = sanitizeBdSearchTerm\(filters\.q\);\s*if \(term\) query = query\.or\(`name\.ilike\.%\$\{term\}%,email\.ilike\.%\$\{term\}%,title\.ilike\.%\$\{term\}%`\);/);
  assert.match(QUERIES, /\.limit\(CONTACT_LIST_LIMIT\)/);
  assert.match(QUERIES, /organization:organizations\(id, name, archived_at\)/, "Organization embedded inside bd — no N+1");
  assert.match(LIST, /const organizationId = isUuid\(sp\.organization\) \? sp\.organization : null;/);
  assert.match(LIST, /const archived = sp\.archived === "1";/);
  assert.doesNotMatch(LIST, /<table/);
});

// ── Organization integration ─────────────────────────────────────────────
test("Organization detail: real Contacts section (active first), Add Contact prefill, failed read shown honestly", () => {
  assert.match(ORG_DETAIL, /listContactsForOrganization\(organization\.id\)/);
  assert.match(QUERIES, /\.eq\("organization_id", organizationId\)\s*\.order\("archived_at", \{ ascending: true, nullsFirst: true \}\)\s*\.order\("name"\)/);
  assert.match(ORG_DETAIL, /href=\{`\/admin\/bd\/contacts\/new\?organization=\$\{organization\.id\}`\}/);
  assert.match(ORG_DETAIL, /contacts === null \?/);
  assert.match(ORG_DETAIL, /<ContactRow key=\{c\.id\} contact=\{c\} showOrganization=\{false\} \/>/);
  assert.match(ROW, /href=\{`\/admin\/bd\/contacts\/\$\{contact\.id\}`\}/);
  assert.doesNotMatch(ORG_DETAIL, /Projects|Activit/, "no placeholder sections for unshipped systems");
});

test("Add Contact prefill: only an existing, active Organization is preselected", () => {
  assert.match(NEW, /const organization = isUuid\(organizationParam\) \? await getOrganization\(organizationParam\) : null;/);
  assert.match(NEW, /const prefill = organization && !organization\.archived_at \? organization : null;/);
  assert.match(NEW, /initialOrganization=\{prefill \? \{ value: prefill\.id, label: prefill\.name \} : null\}/);
});

test("Contact detail: links back to its private Organization; no fake related systems", () => {
  assert.match(DETAIL, /href=\{`\/admin\/bd\/organizations\/\$\{organization\.id\}`\}/);
  assert.match(DETAIL, /Not linked to an Organization\./);
  assert.match(DETAIL, /href=\{`mailto:\$\{contact\.email\}`\}/);
  assert.doesNotMatch(DETAIL, /Projects|Activit|Timeline|History/);
});
