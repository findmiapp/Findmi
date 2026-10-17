// Brand Intelligence V1.1 — Admin Opportunity Intelligence Command Center.
// The REAL server module (src/lib/brand-intelligence.ts) and its pure
// aggregation (brand-intelligence-domain.ts) against an in-memory Supabase
// double; only requireAdmin is stubbed (a flag). Plus the migration and
// the source boundaries (no Business/public surface reaches this data).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath, join } from "node:path";

const ROOT = process.cwd();
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const STUBS = {
  "server-only": "export{}",
  "@/lib/admin/supabase-admin": "export const getAdminSupabase=()=>globalThis.__db;",
  "@/lib/admin/auth": "export async function requireAdmin(){ if(!globalThis.__admin) throw new Error('admin only'); }",
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    if (specifier.startsWith("@/")) {
      const f = withExt(resolvePath(ROOT, "src", specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const f = withExt(resolvePath(fileURLToPath(new URL(".", context.parentURL)), specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// In-memory Supabase: select / eq / in / upsert, with a table-access log.
function fakeDb(tables) {
  const log = [];
  const from = (table) => {
    log.push(table);
    const filters = [];
    let op = { kind: "select" };
    const exec = () => {
      if (!(table in tables)) return { data: null, error: { code: "42P01" } };
      const rows = tables[table];
      if (op.kind === "upsert") {
        const key = op.onConflict.split(",");
        for (const r of op.rows) {
          const hit = rows.find((x) => key.every((k) => x[k] === r[k]));
          if (hit) Object.assign(hit, r);
          else rows.push({ ...r });
        }
        return { data: op.rows, error: null };
      }
      return { data: rows.filter((r) => filters.every(([k, v, how]) => (how === "in" ? v.includes(r[k]) : r[k] === v))), error: null };
    };
    const api = {
      select: () => api,
      eq: (k, v) => (filters.push([k, v]), api),
      in: (k, v) => (filters.push([k, v, "in"]), api),
      order: () => api,
      upsert: (rows, o) => ((op = { kind: "upsert", rows, onConflict: o.onConflict }), api),
      then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
    };
    return api;
  };
  return { from, log, tables };
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ILLY, LAVAZZA, X] = [uuid(1), uuid(2), uuid(3)];
const [RES, WORK] = [uuid(10), uuid(11)];
const [R1, R2, R3] = [uuid(20), uuid(21), uuid(22)];
const t = (min) => new Date(Date.UTC(2026, 0, 17, 12, min)).toISOString();

let db;
const world = () => ({
  businesses: [
    { id: ILLY, name: "illy" },
    { id: LAVAZZA, name: "Lavazza" },
    { id: X, name: "Brand X" },
  ],
  brand_audits: [
    // Lavazza completed in the same save (completed_at ≈ updated_at).
    { business_id: LAVAZZA, status: "complete", completed_at: t(30), created_at: t(1), updated_at: t(30) },
    // illy completed long ago, then updated.
    { business_id: ILLY, status: "complete", completed_at: t(2), created_at: t(1), updated_at: t(40) },
    // Brand X started but answered nothing → not a signal.
    { business_id: X, status: "in_progress", completed_at: null, created_at: t(3), updated_at: t(3) },
  ],
  brand_audit_answers: [
    { business_id: LAVAZZA, kind: "goal", option_key: "product_sampling", source: "declared" },
    { business_id: LAVAZZA, kind: "goal", option_key: "build_awareness", source: "declared" },
    { business_id: LAVAZZA, kind: "challenge", option_key: "activation_locations", source: "declared" },
    { business_id: ILLY, kind: "goal", option_key: "partnerships", source: "declared" },
    { business_id: ILLY, kind: "challenge", option_key: "staffing_execution", source: "declared" },
  ],
  opportunity_ideas: [
    { id: RES, title: "Residential Sampling", status: "published" },
    { id: WORK, title: "Workplace Activations", status: "published" },
  ],
  opportunity_idea_responses: [
    { id: R1, idea_id: RES, business_id: ILLY, response: "interested", note: "Premium residential buildings around NYC", created_at: t(50), updated_at: t(50) },
    { id: R2, idea_id: WORK, business_id: X, response: "maybe", note: null, created_at: t(10), updated_at: t(45) },
    { id: R3, idea_id: RES, business_id: LAVAZZA, response: "not_for_us", note: null, created_at: t(20), updated_at: t(20) },
  ],
  admin_intelligence_reviews: [],
  brand_audit_markets: [],
  business_intelligence_notes: [{ business_id: ILLY, note: "SECRET internal note" }],
});
beforeEach(() => {
  db = fakeDb(world());
  globalThis.__db = db;
  globalThis.__admin = true;
});

const L = await import("../src/lib/brand-intelligence.ts");
const D = await import("../src/lib/brand-intelligence-domain.ts");

test("Admin-only: every command-center function rejects a non-Admin (Business member or public visitor)", async () => {
  globalThis.__admin = false;
  await assert.rejects(L.getCommandCenter(), /admin only/);
  await assert.rejects(L.getIntelligenceSummary(), /admin only/);
  await assert.rejects(L.markSignalReviewed("idea_response", R1), /admin only/);
  await assert.rejects(L.markAllSignalsReviewed(), /admin only/);
  assert.deepEqual(db.log, [], "nothing read before the Admin check");
});

test("recent feed: newest first, correct Business on every signal, audit completed vs updated, empty audits skipped", async () => {
  const cc = await L.getCommandCenter();
  assert.equal(cc.available, true);
  assert.deepEqual(
    cc.signals.map((s) => [s.business.name, s.event, s.idea?.title ?? null]),
    [
      ["illy", "idea_responded", "Residential Sampling"],
      ["Brand X", "idea_response_changed", "Workplace Activations"],
      ["illy", "audit_updated", null],
      ["Lavazza", "audit_completed", null],
      ["Lavazza", "idea_responded", "Residential Sampling"],
    ]
  );
  const lav = cc.signals.find((s) => s.type === "brand_audit" && s.business.id === LAVAZZA);
  assert.deepEqual(lav.audit.goals, ["Increase Brand Awareness", "Drive Product Trial"], "canonical option order");
  assert.deepEqual(lav.audit.challenges, ["Finding Places To Activate"]);
  assert.equal(cc.signals.find((s) => s.id === R1).idea.note, "Premium residential buildings around NYC");
  assert.equal(cc.signals.every((s) => s.isNew), true, "nothing reviewed yet");
});

test("metrics and By Idea counts are exact; By Brand groups each Brand's intelligence", async () => {
  const cc = await L.getCommandCenter();
  assert.deepEqual(
    { ...cc.metrics, newBreakdown: undefined },
    { newSignals: 5, brandsProfiled: 2, completedAudits: 2, interested: 1, maybe: 1, notForUs: 1, brandsOpenToIdeas: 2, newBreakdown: undefined }
  );
  assert.deepEqual(cc.metrics.newBreakdown, { interested: 1, maybe: 1, notForUs: 1, auditsCompleted: 1, auditsUpdated: 1 });
  const res = cc.byIdea.find((i) => i.idea.id === RES);
  assert.deepEqual(res.counts, { interested: 1, maybe: 0, not_for_us: 1 });
  assert.deepEqual(res.businesses.interested.map((b) => b.name), ["illy"]);
  assert.deepEqual(res.businesses.not_for_us.map((b) => b.name), ["Lavazza"]);
  assert.deepEqual(cc.byIdea.map((i) => i.idea.title), ["Residential Sampling", "Workplace Activations"], "strongest demand first");
  const illy = cc.byBrand.find((b) => b.business.id === ILLY);
  assert.deepEqual([illy.interested, illy.maybe, illy.notForUs, illy.openTo, illy.auditEvent], [1, 0, 0, ["Residential Sampling"], "audit_updated"]);
  assert.equal(cc.byBrand.find((b) => b.business.id === X).audit, null, "Brand X has no answered audit");
});

test("review state: Mark Reviewed persists; a later Brand change makes it New again; Mark All covers only what's new now", async () => {
  assert.deepEqual(await L.markSignalReviewed("idea_response", R1), { ok: true });
  assert.equal(db.tables.admin_intelligence_reviews.length, 1);
  let cc = await L.getCommandCenter(); // a fresh read = another session/device
  assert.equal(cc.signals.find((s) => s.id === R1).isNew, false);
  assert.equal(cc.metrics.newSignals, 4);
  // The Brand changes its response afterwards → New again.
  const firstReview = Date.parse(db.tables.admin_intelligence_reviews[0].reviewed_at);
  db.tables.opportunity_idea_responses.find((r) => r.id === R1).updated_at = new Date(firstReview + 1).toISOString();
  await new Promise((r) => setTimeout(r, 5));
  cc = await L.getCommandCenter();
  assert.equal(cc.signals.find((s) => s.id === R1).isNew, true);
  assert.deepEqual(await L.markAllSignalsReviewed(), { ok: true });
  cc = await L.getCommandCenter();
  assert.equal(cc.metrics.newSignals, 0);
  assert.equal(db.tables.admin_intelligence_reviews.length, 5, "one row per signal, upserted");
  assert.equal(db.tables.admin_intelligence_reviews.some((r) => r.signal_type === "brand_audit" && r.signal_id === LAVAZZA), true);
  assert.equal(db.tables.admin_intelligence_reviews.some((r) => r.signal_id === X), false, "an empty audit was never a signal");
});

test("invalid review targets are rejected; V1 data is never written", async () => {
  assert.match((await L.markSignalReviewed("internal_note", R1)).error, /isn.t available/);
  assert.match((await L.markSignalReviewed("idea_response", "not-a-uuid")).error, /isn.t available/);
  const before = JSON.stringify([db.tables.brand_audits, db.tables.brand_audit_answers, db.tables.opportunity_idea_responses]);
  await L.markAllSignalsReviewed();
  assert.equal(JSON.stringify([db.tables.brand_audits, db.tables.brand_audit_answers, db.tables.opportunity_idea_responses]), before);
});

test("the internal Admin note is never read by the command center", async () => {
  db.log.length = 0;
  const cc = await L.getCommandCenter();
  await L.getIntelligenceSummary();
  assert.equal(db.log.includes("business_intelligence_notes"), false);
  assert.equal(JSON.stringify(cc).includes("SECRET"), false);
});

test("before the V1.1 migration: everything reads New, marking explains why it can't persist", async () => {
  delete db.tables.admin_intelligence_reviews;
  const cc = await L.getCommandCenter();
  assert.equal(cc.available, true);
  assert.equal(cc.reviewsAvailable, false);
  assert.equal(cc.metrics.newSignals, 5);
  assert.match((await L.markSignalReviewed("idea_response", R1)).error, /V1\.1 migration/);
  delete db.tables.brand_audits;
  assert.equal((await L.getCommandCenter()).available, false);
});

test("pure rules: audit event and newness boundaries", () => {
  assert.equal(D.auditEvent({ status: "in_progress", completed_at: null, updated_at: t(5) }), "audit_in_progress");
  assert.equal(D.auditEvent({ status: "complete", completed_at: t(5), updated_at: t(5) }), "audit_completed");
  assert.equal(D.auditEvent({ status: "complete", completed_at: t(5), updated_at: t(7) }), "audit_updated");
  assert.equal(D.isSignalNew(t(5), undefined), true);
  assert.equal(D.isSignalNew(t(5), { reviewed_at: t(5) }), false, "reviewed at the same instant = reviewed");
  assert.equal(D.isSignalNew(t(6), { reviewed_at: t(5) }), true);
});

// ---------------------------------------------------------------- migration + boundaries

const sql = readFileSync("supabase/migrations/20261022000000_admin_intelligence_reviews.sql", "utf8").replace(/--.*$/gm, "");

test("migration: one additive Admin-only table; no V1 table touched", () => {
  assert.equal((sql.match(/create table/gi) ?? []).length, 1);
  assert.match(sql, /create table if not exists public\.admin_intelligence_reviews/);
  assert.match(sql, /alter table public\.admin_intelligence_reviews enable row level security;/);
  assert.match(sql, /revoke all on public\.admin_intelligence_reviews from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy|\bdrop table|\bdelete from|\btruncate\b|\binsert into|\bupdate public\./i);
  assert.doesNotMatch(sql, /brand_audits|brand_audit_answers|opportunity_idea|business_intelligence_notes/);
  assert.match(sql, /signal_type in \('brand_audit', 'idea_response'\)/);
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.includes("20261022000000_admin_intelligence_reviews.sql"));
});

test("no Business-facing or public surface imports the command center", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const offenders = walk("src")
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /brand-intelligence/.test(readFileSync(f, "utf8")))
    .filter((f) => !f.startsWith("src/app/admin/") && !f.startsWith("src/lib/brand-intelligence"));
  assert.deepEqual(offenders, []);
  for (const f of ["src/app/admin/(protected)/opportunities/intelligence/actions.ts"]) {
    assert.match(readFileSync(f, "utf8"), /^"use server";/);
  }
  const lib = readFileSync("src/lib/brand-intelligence.ts", "utf8");
  for (const fn of ["getCommandCenter", "getIntelligenceSummary", "markSignalReviewed", "markAllSignalsReviewed"]) {
    assert.match(lib, new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\n  await requireAdmin\\(\\);`), `${fn} is Admin-gated first`);
  }
});
