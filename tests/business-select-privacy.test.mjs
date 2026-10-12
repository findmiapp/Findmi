// Phase 0B — Business SELECT privacy boundary
// (supabase/migrations/20261012020000_business_select_privacy_boundary.sql).
// Static guards on the policy SEMANTICS plus the application read paths
// that depend on them. The policy matrix itself was validated against a
// disposable local PostgreSQL mirroring the live businesses security state;
// the migration is NOT applied to production by this repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const FILE = "20261012020000_business_select_privacy_boundary.sql";
const SQL = readFileSync(join(DIR, FILE), "utf8").replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();
const read = (p) => readFileSync(p, "utf8");
const policies = [...SQL.matchAll(/create policy "([^"]+)" on public\.businesses (.*?);/g)].map((m) => ({ name: m[1], body: m[2] }));

test("one isolated corrective migration, after the P2 migration", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf(FILE) - 1], "20261012010000_brand_import_persistence.sql");
  assert.equal(files.filter((f) => /select_privacy/.test(f)).length, 1);
});

test("exactly two additive RESTRICTIVE SELECT policies, one per client role", () => {
  assert.equal(policies.length, 2);
  for (const p of policies) assert.match(p.body, /^as restrictive for select to (anon|authenticated) using /, p.name);
  assert.deepEqual(policies.map((p) => p.body.match(/ to (\w+) /)[1]).sort(), ["anon", "authenticated"]);
});

test("anon: live only — and never references business_members (anon has no privilege on it)", () => {
  const anon = policies.find((p) => / to anon /.test(p.body));
  assert.equal(anon.body, "as restrictive for select to anon using (publication_status = 'live')");
  assert.doesNotMatch(anon.body, /business_members|auth\.uid/);
});

test("authenticated: live OR the caller's own Business through the existing membership model", () => {
  const auth = policies.find((p) => / to authenticated /.test(p.body));
  assert.match(
    auth.body,
    /using \( publication_status = 'live' or exists \( select 1 from public\.business_members m where m\.business_id = businesses\.id and m\.user_id = \(select auth\.uid\(\)\) \) \)$/
  );
  assert.doesNotMatch(SQL, /security definer|create (or replace )?function/, "no definer helper — caller's own rights");
});

test("scope: nothing dropped, replaced, granted, revoked or written; no other tables", () => {
  assert.doesNotMatch(SQL, /drop |alter policy|alter table|grant |revoke |insert |update |delete |truncate |create table|schema_migrations/);
  assert.equal((SQL.match(/create policy/g) ?? []).length, 2);
  assert.doesNotMatch(SQL, /is_demo/, "is_demo is not a privacy boundary");
});

test("the existing policies this builds on are unchanged in the repo", () => {
  assert.match(read("supabase/schema.sql"), /create policy "Public read businesses" on businesses for select using \(true\);/);
  assert.match(read(join(DIR, "20260927010000_business_event_location_lifecycle_archive_trash.sql")), /create policy "Hide archived or trashed businesses" on public\.businesses\s+as restrictive for select to public\s+using \(archived_at is null and trashed_at is null\);/);
  assert.match(read(join(DIR, "20260901030000_claim_and_membership_foundation.sql")), /create policy "business_members_select_own"\s+on public\.business_members for select\s+to authenticated\s+using \(auth\.uid\(\) = user_id\);/);
});

test("owner paths that read their own Business through the session client stay null-safe", () => {
  // These embed businesses(...) from business_members with the SESSION
  // client — the member exception keeps their non-live Businesses visible;
  // archived/trashed ones were already null and are filtered out.
  for (const [file, pattern] of [
    ["src/app/(public)/account/business/page.tsx", /\.filter\(\(b\): b is \{ id: string; name: string \} => Boolean\(b\)\)/],
    ["src/app/(public)/account/following/page.tsx", /\.filter\(\(b\): b is BusinessWithCategories => Boolean\(b\)\)/],
    ["src/app/(public)/account/saved/page.tsx", /\.filter\(\(b\): b is BusinessWithCategories => Boolean\(b\)\)/],
  ]) {
    assert.match(read(file), pattern, file);
  }
  assert.match(read("src/app/(public)/account/page.tsx"), /select\("business_id, businesses\(name, slug, publication_status, logo_url, cover_image_url\)"\)/);
});

test("public loaders remain live-only in code too; hidden-conflict matching stays server-side", () => {
  const data = read("src/lib/data.ts");
  const bySlug = data.slice(data.indexOf("export async function getBusinessBySlug"), data.indexOf("export async function getBusinessBySlug") + 500);
  assert.match(bySlug, /\.eq\("publication_status", "live"\)/);
  assert.match(data, /\.filter\(\(item\) => item\.business && !item\.business\.is_demo && item\.business\.publication_status === "live"\)/);
  // The matcher takes the service-role client explicitly (sees hidden rows
  // server-side); the anonymous Brand lookup re-reads public matches only.
  assert.match(read("src/lib/business-matching.ts"), /export async function findBusinessMatches\(admin: SupabaseClient/);
  assert.match(read("src/lib/brand-website-analysis.ts"), /findMatches: \(matchInput\) => findBusinessMatches\(admin, matchInput\)/);
});
