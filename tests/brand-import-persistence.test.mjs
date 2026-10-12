// Brand Ingestion P2 — Admin bulk Brand Import persistence
// (supabase/migrations/20261012010000_brand_import_persistence.sql).
// Static guards on the migration's SEMANTICS — internal, server-only
// tables that are never Businesses and never public. The migration is
// validated against a disposable local Postgres separately; it is NOT
// applied to production by this repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const FILE = "20261012010000_brand_import_persistence.sql";
const RAW = readFileSync(join(DIR, FILE), "utf8");
// Code only (comments stripped), whitespace collapsed, lowercase.
const SQL = RAW.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

/** The column definition text for one column of brand_import_candidates. */
function column(name) {
  const body = SQL.slice(SQL.indexOf("create table public.brand_import_candidates ("));
  const m = body.match(new RegExp(`[(,] ${name} (.*?)(?=, [a-z_]+ (?:uuid|smallint|integer|text|jsonb|numeric|timestamptz)\\b|, constraint brand_import_candidates_batch_position_key)`));
  assert.ok(m, `column ${name}`);
  return m[1];
}

test("one new, independently applicable migration, later than every migration that preceded it", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  // Directly follows the migration that was latest when P2 was written;
  // later, unrelated migrations (e.g. Phase 0B) may follow it.
  assert.equal(files[files.indexOf(FILE) - 1], "20261012000000_commercial_terms_brand_contribution_classification.sql");
  assert.equal(files.filter((f) => f.includes("brand_import")).length, 1);
  assert.ok(statSync(join(DIR, FILE)).size < 20_000);
});

test("both tables are declared in public", () => {
  assert.match(SQL, /create table public\.brand_import_batches \(/);
  assert.match(SQL, /create table public\.brand_import_candidates \(/);
  assert.equal((SQL.match(/create table /g) ?? []).length, 2, "no other tables");
});

test("batch: minimal parent — id, submitted_count (1–20), created_at only", () => {
  const batch = SQL.slice(SQL.indexOf("create table public.brand_import_batches ("), SQL.indexOf("create table public.brand_import_candidates ("));
  assert.match(batch, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(batch, /submitted_count smallint not null constraint \w+ check \(submitted_count between 1 and 20\)/);
  assert.match(batch, /created_at timestamptz not null default now\(\)/);
  for (const speculative of ["title", "name", "notes", "created_by", "metadata", "total_cost", "_count integer"]) {
    assert.ok(!batch.includes(` ${speculative} `), `no ${speculative}`);
  }
});

test("candidate status: exactly the 8 approved states, default queued; processing needs a lease", () => {
  const status = column("status");
  assert.match(status, /text not null default 'queued'/);
  const allowed = status.slice(status.indexOf("check (status in ("));
  const values = [...allowed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(values.sort(), ["created", "creating", "discarded", "existing_business", "failed", "processing", "queued", "ready"]);
  assert.doesNotMatch(SQL, /needs_review|'approved'/);
  assert.match(SQL, /check \(status <> 'processing' or processing_started_at is not null\)/);
});

test("relationships: batch cascades; Business links SET NULL; created Business at most once", () => {
  assert.match(column("batch_id"), /uuid not null references public\.brand_import_batches\(id\) on delete cascade/);
  assert.match(column("matched_business_id"), /uuid references public\.businesses\(id\) on delete set null/);
  assert.match(column("created_business_id"), /uuid references public\.businesses\(id\) on delete set null constraint \w+ unique/);
});

test("integrity: same host once per batch (allowed across batches), position bounds/uniqueness, input bounds", () => {
  assert.match(SQL, /constraint brand_import_candidates_batch_host_key unique \(batch_id, normalized_host\)/);
  assert.doesNotMatch(SQL, /unique \(normalized_host\)/, "never globally unique");
  assert.match(SQL, /constraint brand_import_candidates_batch_position_key unique \(batch_id, position\)/);
  assert.match(column("position"), /check \(position between 1 and 20\)/);
  assert.match(column("submitted_input"), /check \(char_length\(submitted_input\) <= 200 and btrim\(submitted_input\) <> ''\)/);
  assert.match(column("normalized_host"), /normalized_host = lower\(normalized_host\)/);
  assert.match(column("failure_code"), /failure_code ~ '\^\[a-z\]\[a-z0-9_\]\{0,63\}\$'/);
  assert.match(column("attempt_count"), /smallint not null default 0 .*check \(attempt_count >= 0\)/);
});

test("proposal: nullable JSON object, size-bounded, no per-field SQL columns", () => {
  const proposal = column("proposal");
  assert.match(proposal, /^jsonb constraint/);
  assert.match(proposal, /proposal is null or \(jsonb_typeof\(proposal\) = 'object' and octet_length\(proposal::text\) <= 16384\)/);
  for (const field of ["short_description", "about", "instagram", "category_id", "logo_url", "cover_url"]) {
    assert.doesNotMatch(SQL, new RegExp(`\\b${field}\\b`), `no ${field} column`);
  }
});

test("AI observability: nullable, non-negative counts and cost; known ai_status values", () => {
  for (const c of ["ai_input_tokens", "ai_output_tokens", "ai_cache_creation_input_tokens", "ai_cache_read_input_tokens"]) {
    assert.match(column(c), new RegExp(`^integer constraint \\w+ check \\(${c} is null or ${c} >= 0\\)`), c);
  }
  assert.match(column("ai_estimated_cost_usd"), /^numeric\(10, 6\) constraint \w+ check \(ai_estimated_cost_usd is null or ai_estimated_cost_usd >= 0\)/);
  assert.match(column("ai_status"), /ai_status in \('used', 'skipped', 'failed'\)/);
});

test("indexes and updated_at: only the justified ones; shared set_updated_at trigger", () => {
  assert.deepEqual(SQL.match(/create (?:unique )?index \w+/g), ["create index brand_import_candidates_status_updated_idx"]);
  assert.match(SQL, /on public\.brand_import_candidates \(status, updated_at\)/);
  assert.match(SQL, /before update on public\.brand_import_candidates for each row execute function public\.set_updated_at\(\)/);
  assert.doesNotMatch(SQL, /create (or replace )?function/, "no new trigger utility");
});

test("security: RLS on both, zero policies, anon/authenticated revoked, service_role only", () => {
  for (const t of ["brand_import_batches", "brand_import_candidates"]) {
    assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security;`), `${t} RLS`);
    assert.match(SQL, new RegExp(`revoke all on table public\\.${t} from anon, authenticated;`), `${t} revoke`);
    assert.match(SQL, new RegExp(`grant all on table public\\.${t} to service_role;`), `${t} service_role`);
  }
  assert.doesNotMatch(SQL, /create policy|alter policy/, "no policies of any kind");
  assert.doesNotMatch(SQL, /grant [^;]* to [^;]*(anon|authenticated|public)\b/, "no grants to client roles");
  assert.doesNotMatch(SQL, /disable row level security|security definer/);
});

test("scope: touches nothing else — no Business/policy/ledger/destructive statements", () => {
  assert.doesNotMatch(SQL, /alter table public\.businesses|on public\.businesses|drop |truncate |delete from |update public\.|insert into /);
  assert.doesNotMatch(SQL, /schema_migrations|create schema/);
  const altered = [...SQL.matchAll(/alter table (public\.\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)].sort(), ["public.brand_import_batches", "public.brand_import_candidates"]);
});

test("app boundary: only Admin server code may ever reference these tables", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("brand_import_")) {
        const adminServer = p.startsWith(join("src", "lib", "admin")) || p.startsWith(join("src", "app", "admin"));
        if (!adminServer || /^"use client";/.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});
