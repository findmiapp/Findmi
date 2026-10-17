// Brand Intelligence V1.2 — Audience + Markets + Demographics. The REAL
// server layer (src/lib/brand-audit.ts) and command-center aggregation
// (brand-intelligence-domain.ts) against an in-memory Supabase double, with
// only authorization edges stubbed. Plus the migration's mirrors/safety.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const ROOT = process.cwd();
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });

const STUBS = {
  "server-only": "export{}",
  "@/lib/admin/supabase-admin": "export const getAdminSupabase=()=>globalThis.__db;",
  "@/lib/admin/auth": "export async function requireAdmin(){ if(!globalThis.__admin) throw new Error('admin only'); }",
  "@/lib/permissions":
    "export async function requireBusinessMember(id){ const m=(globalThis.__members??{})[id]; if(!m) throw new Error(\"You don't have access to this business, event, or location.\"); return m; }",
  "@/lib/journal": "export async function getCurrentUserId(){ return globalThis.__userId ?? null; }",
  "next/link": "import {createElement} from 'react'; export default function Link({href,children,...p}){ return createElement('a',{href,...p},children); }",
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
  load(url, context, next) {
    if (url.startsWith("file:") && url.includes("/src/") && /\.tsx?$/.test(url)) {
      const path = fileURLToPath(url);
      const { code } = transform(readFileSync(path, "utf8"), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true, filePath: path });
      return { format: "module", source: code, shortCircuit: true };
    }
    return next(url, context);
  },
});

// ---------------------------------------------------------------- in-memory Supabase

let seq = 0;
const uid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
const UNIQUE = {
  brand_audits: ["business_id"],
  brand_audit_answers: ["business_id", "kind", "option_key"],
  business_intelligence_notes: ["business_id"],
  opportunity_ideas: ["id"],
  opportunity_idea_businesses: ["idea_id", "business_id"],
  opportunity_idea_responses: ["idea_id", "business_id"],
};
function fakeDb(tables) {
  const log = [];
  const now = () => new Date(Date.now() + ++seq).toISOString();
  const embed = (row, select) => {
    const out = { ...row };
    for (const m of select.matchAll(/(\w+):(\w+)\(([^)]*)\)/g)) {
      const [, alias, table] = m;
      const fk = row[`${alias}_id`];
      out[alias] = (tables[table] ?? []).find((t) => t.id === fk) ?? null;
    }
    return out;
  };
  const from = (table) => {
    log.push(table);
    tables[table] ??= [];
    const filters = [];
    let op = { kind: "select", select: "*" };
    let returning = false;
    const match = (r) => filters.every(([k, v, how]) => (how === "in" ? v.includes(r[k]) : r[k] === v));
    const exec = () => {
      const rows = tables[table];
      if (op.kind === "select") return { data: rows.filter(match).map((r) => embed(r, op.select)), error: null };
      if (op.kind === "insert") {
        const list = [].concat(op.rows).map((r) => ({ id: uid(), created_at: now(), updated_at: now(), ...r }));
        for (const r of list) {
          const key = UNIQUE[table];
          if (key && rows.some((x) => key.every((k) => x[k] === r[k]))) return { data: null, error: { code: "23505" } };
        }
        rows.push(...list);
        return { data: list, error: null };
      }
      if (op.kind === "upsert") {
        const key = op.onConflict.split(",");
        const out = [];
        for (const r of [].concat(op.rows)) {
          const hit = rows.find((x) => key.every((k) => x[k] === r[k]));
          if (hit) {
            if (!op.ignoreDuplicates) Object.assign(hit, r, { updated_at: now() });
            out.push(hit);
          } else {
            const created = { id: uid(), created_at: now(), updated_at: now(), ...r };
            rows.push(created);
            out.push(created);
          }
        }
        return { data: out, error: null };
      }
      if (op.kind === "update") {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, op.patch, { updated_at: op.patch.updated_at ?? now() });
        return { data: hit, error: null };
      }
      if (op.kind === "delete") {
        const gone = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
        return { data: gone, error: null };
      }
    };
    const api = {
      select: (s = "*") => (op.kind === "select" ? (op.select = s) : (returning = true), api),
      insert: (rows) => ((op = { kind: "insert", rows }), api),
      upsert: (rows, o) => ((op = { kind: "upsert", rows, onConflict: o.onConflict, ignoreDuplicates: o.ignoreDuplicates }), api),
      update: (patch) => ((op = { kind: "update", patch }), api),
      delete: () => ((op = { kind: "delete" }), api),
      eq: (k, v) => (filters.push([k, v]), api),
      in: (k, v) => (filters.push([k, v, "in"]), api),
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        const r = exec();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = exec();
        return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { code: "PGRST116" }) };
      },
      then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
    };
    void returning;
    return api;
  };
  return { from, log, tables };
}


const A = "biz-a";
const B = "biz-b";
const NYC = "00000000-0000-4000-8000-0000000000c1";
const BOS = "00000000-0000-4000-8000-0000000000c2";
const BROOKLYN = "00000000-0000-4000-8000-0000000000a1";
let db;
// Red Bull-like: a V1 Audit completed before V1.2 (Goals + Challenges only).
const world = () => ({
  businesses: [{ id: A, name: "Red Bull" }, { id: B, name: "Other Brand" }],
  markets: [
    { id: NYC, slug: "nyc", name: "New York City", active: true, sort_order: 1 },
    { id: BOS, slug: "boston", name: "Boston", active: true, sort_order: 2 },
  ],
  market_areas: [{ id: BROOKLYN, slug: "brooklyn", name: "Brooklyn", market_id: NYC, active: true, sort_order: 1 }],
  brand_audits: [{ business_id: A, status: "complete", completed_at: "2026-10-10T12:00:00.000Z", created_at: "2026-10-10T11:00:00.000Z", updated_at: "2026-10-10T12:00:00.000Z" }],
  brand_audit_answers: [
    { id: "v1-1", business_id: A, kind: "goal", option_key: "product_sampling", detail: "Trial in NYC", source: "declared", updated_at: "2026-10-10T11:30:00.000Z" },
    { id: "v1-2", business_id: A, kind: "challenge", option_key: "activation_locations", detail: null, source: "declared", updated_at: "2026-10-10T11:40:00.000Z" },
    // Future researched intelligence must never leak into or be erased by the Audit.
    { id: "r-1", business_id: A, kind: "audience", option_key: "gen_z", detail: "From web research", source: "researched", updated_at: "2026-10-11T00:00:00.000Z" },
  ],
  brand_audit_markets: [],
});
beforeEach(() => {
  db = fakeDb(world());
  globalThis.__db = db;
  globalThis.__admin = false;
  globalThis.__userId = "user-a";
  globalThis.__members = { [A]: { id: "m1", role: "owner" } };
});

const L = await import("../src/lib/brand-audit.ts");
const D = await import("../src/lib/brand-audit-domain.ts");
const I = await import("../src/lib/brand-intelligence-domain.ts");
const ans = (...pairs) => pairs.map(([key, detail = null]) => ({ key, detail }));

test("an existing completed V1 Audit survives untouched: Complete, Goals/Challenges intact, profile 40%, resumes on Target Audience", async () => {
  const a = await L.getBrandAudit(A);
  assert.equal(a.summary.status, "complete");
  assert.equal(a.summary.completedAt, "2026-10-10T12:00:00.000Z");
  assert.deepEqual(a.goals, [{ key: "product_sampling", detail: "Trial in NYC" }]);
  assert.deepEqual(a.challenges, [{ key: "activation_locations", detail: null }]);
  assert.deepEqual(a.audiences, [], "researched rows are never read as the Brand's own answers");
  assert.equal(D.auditProgress(a.summary), 40);
  assert.equal(D.auditState(a.summary), "complete");
  assert.equal(D.auditResumeStep(a.summary), "audience");
  assert.equal(D.auditActionLabel(a.summary), "Complete Your Profile");
});

test("Target Audience: audiences, ages and priorities save, resume and edit; Other needs its text", async () => {
  assert.match((await L.saveBrandAuditAudience(A, { audiences: ans(["other"]), ages: [], priorities: [] })).error, /other audience/);
  assert.deepEqual(
    await L.saveBrandAuditAudience(A, { audiences: ans(["young_professionals", "NYC renters"], ["college_students"]), ages: ans(["25_34"], ["21_24"]), priorities: ans(["women"]) }),
    { ok: true }
  );
  let a = await L.getBrandAudit(A);
  assert.deepEqual(a.audiences, [
    { key: "young_professionals", detail: "NYC renters" },
    { key: "college_students", detail: null },
  ]);
  assert.deepEqual(a.ages.map((x) => x.key), ["21_24", "25_34"], "canonical order");
  assert.deepEqual(a.priorities, [{ key: "women", detail: null }]);
  assert.equal(a.summary.status, "complete", "never downgraded");
  assert.equal(D.auditResumeStep(a.summary), "markets");
  // Edit later: drop college students and the priority, keep the rest.
  await L.saveBrandAuditAudience(A, { audiences: ans(["young_professionals", "NYC renters"]), ages: ans(["25_34"]), priorities: [] });
  a = await L.getBrandAudit(A);
  assert.deepEqual(a.audiences.map((x) => x.key), ["young_professionals"]);
  assert.deepEqual(a.priorities, []);
  assert.equal(db.tables.brand_audit_answers.find((r) => r.id === "r-1").option_key, "gen_z", "the researched row is never deleted");
  assert.match((await L.saveBrandAuditAudience(A, { audiences: [], ages: [], priorities: [] })).error, /at least one/);
});

test("age: 'Age Isn't A Primary Targeting Factor' stands alone; priorities: 'No Specific Demographic Priority' stands alone", async () => {
  assert.match((await L.saveBrandAuditAudience(A, { audiences: [], ages: ans(["not_primary"], ["25_34"]), priorities: [] })).error, /can.t be combined/);
  assert.match((await L.saveBrandAuditAudience(A, { audiences: [], ages: [], priorities: ans(["no_priority"], ["women"]) })).error, /can.t be combined/);
  assert.deepEqual(await L.saveBrandAuditAudience(A, { audiences: [], ages: ans(["not_primary"]), priorities: ans(["no_priority"]) }), { ok: true });
  const a = await L.getBrandAudit(A);
  assert.deepEqual([a.ages[0].key, a.priorities[0].key], ["not_primary", "no_priority"]);
});

test("markets: Current vs Priority stay distinct; real Markets/Areas by id; curated + named NYC neighborhoods; Brand-named markets; labels from Findmi", async () => {
  const r = await L.saveBrandAuditMarkets(A, {
    scope: "national",
    geo: [
      { intent: "current", level: "market", id: BOS },
      { intent: "current", level: "place", label: "Los Angeles" },
      { intent: "priority", level: "market", id: NYC },
      { intent: "priority", level: "area", id: BROOKLYN },
      { intent: "priority", level: "neighborhood", key: "soho" },
      { intent: "priority", level: "neighborhood", label: "Williamsburg" },
      { intent: "priority", level: "neighborhood", label: "Red Hook" },
    ],
  });
  assert.deepEqual(r, { ok: true });
  const a = await L.getBrandAudit(A);
  assert.deepEqual(a.marketScope, [{ key: "national", detail: null }]);
  const pick = (intent) => a.geo.filter((g) => g.intent === intent).map((g) => [g.level, g.place_key, g.label, g.market_id, g.market_area_id]);
  assert.deepEqual(pick("current"), [
    ["market", "boston", "Boston", BOS, null],
    ["place", "los-angeles", "Los Angeles", null, null],
  ]);
  assert.deepEqual(pick("priority"), [
    ["area", "brooklyn", "Brooklyn", NYC, BROOKLYN],
    ["market", "nyc", "New York City", NYC, null],
    ["neighborhood", "red-hook", "Red Hook", NYC, null],
    ["neighborhood", "soho", "SoHo", NYC, null],
    ["neighborhood", "williamsburg", "Williamsburg", NYC, null],
  ]);
  assert.equal(D.auditProgress(a.summary), 60);
  for (const bad of [{ intent: "priority", level: "market", id: "not-a-market" }, { intent: "priority", level: "area", id: NYC }, { intent: "elsewhere", level: "market", id: NYC }, { intent: "current", level: "place", label: "   " }]) {
    assert.equal((await L.saveBrandAuditMarkets(A, { scope: null, geo: [bad] })).ok, false, JSON.stringify(bad));
  }
  assert.match((await L.saveBrandAuditMarkets(A, { scope: "local", geo: [] })).ok ? "" : "x", /^$/, "scope alone is a valid answer");
});

test("markets re-save keeps unchanged places (and their created_at), removes deselected ones", async () => {
  await L.saveBrandAuditMarkets(A, { scope: null, geo: [{ intent: "priority", level: "market", id: NYC }, { intent: "priority", level: "neighborhood", key: "soho" }] });
  const soho = db.tables.brand_audit_markets.find((g) => g.place_key === "soho");
  const created = soho.created_at;
  await L.saveBrandAuditMarkets(A, { scope: null, geo: [{ intent: "priority", level: "neighborhood", key: "soho" }, { intent: "priority", level: "neighborhood", key: "dumbo" }] });
  const rows = db.tables.brand_audit_markets.filter((g) => g.business_id === A);
  assert.deepEqual(rows.map((g) => g.place_key).sort(), ["dumbo", "soho"]);
  assert.equal(rows.find((g) => g.place_key === "soho").created_at, created);
});

test("Activation Environments persist with Other text; staff view only; Admin Manage-As can't write; Business B can't touch A", async () => {
  assert.match((await L.saveBrandAuditStep(A, "environment", ans(["other"]))).error, /other environment/);
  assert.deepEqual(await L.saveBrandAuditStep(A, "environment", ans(["residential", "Luxury rentals"], ["campuses"])), { ok: true });
  assert.deepEqual((await L.getBrandAudit(A)).environments.map((e) => e.key), ["residential", "campuses"]);
  globalThis.__members = { [A]: { id: "m1", role: "staff" } };
  assert.equal((await L.getBrandAudit(A)).available, true, "staff can view");
  assert.match((await L.saveBrandAuditAudience(A, { audiences: ans(["gen_z"]), ages: [], priorities: [] })).error, /owner or manager/);
  assert.match((await L.saveBrandAuditMarkets(A, { scope: "local", geo: [] })).error, /owner or manager/);
  globalThis.__members = { [A]: { id: "admin-override", role: "owner", viaAdmin: true } };
  assert.match((await L.saveBrandAuditMarkets(A, { scope: "local", geo: [] })).error, /Findmi Admin/);
  globalThis.__members = { [B]: { id: "m2", role: "owner" } };
  await assert.rejects(L.getBrandAudit(A), /don't have access/);
  await assert.rejects(L.saveBrandAuditMarkets(A, { scope: "local", geo: [] }), /don't have access/);
  await assert.rejects(L.saveBrandAuditAudience(A, { audiences: ans(["gen_z"]), ages: [], priorities: [] }), /don't have access/);
  globalThis.__members = {};
  await assert.rejects(L.getBrandAudit(A), /don't have access/);
});

test("Admin Business Intelligence includes every new section (declared only)", async () => {
  await L.saveBrandAuditAudience(A, { audiences: ans(["young_professionals"]), ages: ans(["25_34"]), priorities: [] });
  await L.saveBrandAuditMarkets(A, { scope: "national", geo: [{ intent: "priority", level: "market", id: NYC }] });
  await L.saveBrandAuditStep(A, "environment", ans(["residential"]));
  globalThis.__admin = true;
  const intel = await L.getAdminBusinessIntelligence(A);
  assert.deepEqual(
    [intel.audiences.map((x) => x.key), intel.ages.map((x) => x.key), intel.marketScope.map((x) => x.key), intel.geo.map((g) => g.label), intel.environments.map((x) => x.key)],
    [["young_professionals"], ["25_34"], ["national"], ["New York City"], ["residential"]]
  );
  assert.deepEqual(intel.goals.map((g) => g.key), ["product_sampling"], "V1 answers still there");
  assert.equal(JSON.stringify(intel).includes("From web research"), false);
});

// ---------------------------------------------------------------- command center

const t = (d) => `2026-10-${d}T12:00:00.000Z`;
const signal = (reviews, extra = {}) =>
  I.buildSignals({
    audits: [{ business_id: A, status: "complete", completed_at: t(10), created_at: t(10), updated_at: t(20) }],
    answers: [
      { business_id: A, kind: "goal", option_key: "product_sampling", updated_at: t(10) },
      { business_id: A, kind: "audience", option_key: "young_professionals", updated_at: t(18) },
      { business_id: A, kind: "age_range", option_key: "25_34", updated_at: t(18) },
      { business_id: A, kind: "environment", option_key: "residential", updated_at: t(12) },
    ],
    geo: [
      { business_id: A, intent: "priority", level: "market", place_key: "nyc", label: "New York City", created_at: t(19), updated_at: t(19) },
      { business_id: A, intent: "current", level: "place", place_key: "los-angeles", label: "Los Angeles", created_at: t(11), updated_at: t(11) },
    ],
    responses: [],
    ideas: [],
    businesses: [{ id: A, name: "Red Bull" }],
    reviews,
    ...extra,
  })[0];

test("command center: 'Red Bull updated Target Audience & Markets · added New York City As A Priority Market', since Admin's last review", () => {
  const s = signal([{ signal_type: "brand_audit", signal_id: A, reviewed_at: t(15) }]);
  assert.equal(s.isNew, true);
  assert.deepEqual(s.audit.changedSections, ["audience", "markets"], "environments (t12) were reviewed already");
  assert.deepEqual(s.audit.addedPriorityMarkets, ["New York City"]);
  assert.equal(I.auditChangeHeadline(s, D.AUDIT_SECTION_LABELS), "Updated Target Audience & Markets · Added New York City As A Priority Market");
  assert.deepEqual([s.audit.audiences, s.audit.ages, s.audit.priorityMarkets, s.audit.currentMarkets, s.audit.environments], [["Young Professionals"], ["25–34"], ["New York City"], ["Los Angeles"], ["Residential Buildings"]]);
  assert.equal(s.audit.progress, 80, "goals, audience, markets, environments — no challenges");
  // Reviewed after the change → no longer New, nothing singled out.
  const reviewed = signal([{ signal_type: "brand_audit", signal_id: A, reviewed_at: t(21) }]);
  assert.equal(reviewed.isNew, false);
  assert.deepEqual(reviewed.audit.changedSections, []);
  assert.equal(I.auditChangeHeadline(reviewed, D.AUDIT_SECTION_LABELS), null);
});

test("command center: never reviewed → changes after completion; By Brand carries the who/where summary", () => {
  const s = signal([]);
  assert.deepEqual(s.audit.changedSections, ["audience", "markets", "environments"], "everything saved after the completing save");
  const [row] = I.intelligenceByBrand([s]);
  assert.deepEqual(row.audit.priorityMarkets, ["New York City"]);
  assert.equal(row.isNew, true);
});

// ---------------------------------------------------------------- structure / migration

test("structured queryability: 'Brands wanting 25–34 Young Professionals in NYC / SoHo' needs no prose parsing", async () => {
  await L.saveBrandAuditAudience(A, { audiences: ans(["young_professionals"]), ages: ans(["25_34"]), priorities: [] });
  await L.saveBrandAuditMarkets(A, { scope: null, geo: [{ intent: "priority", level: "market", id: NYC }, { intent: "priority", level: "neighborhood", key: "soho" }] });
  const declared = (kind, key) => new Set(db.tables.brand_audit_answers.filter((r) => r.source === "declared" && r.kind === kind && r.option_key === key).map((r) => r.business_id));
  const wantsPlace = (level, key) => new Set(db.tables.brand_audit_markets.filter((g) => g.source === "declared" && g.intent === "priority" && g.level === level && g.place_key === key).map((g) => g.business_id));
  const both = [...declared("age_range", "25_34")].filter((b) => declared("audience", "young_professionals").has(b) && wantsPlace("market", "nyc").has(b));
  assert.deepEqual(both, [A]);
  assert.deepEqual([...wantsPlace("neighborhood", "soho")], [A]);
  assert.deepEqual([...declared("audience", "gen_z")], [], "researched gen_z is not declared");
});

const sql = readFileSync("supabase/migrations/20261023000000_brand_intelligence_v1_2.sql", "utf8").replace(/--.*$/gm, "");

test("migration: additive, server-only, provenance, mirrors every option list", () => {
  assert.doesNotMatch(sql, /\bdrop\s+table|\bdelete\s+from|\btruncate\b|\bupdate\s+public\.|create policy|\bdrop\s+column/i);
  assert.match(sql, /add column if not exists source text not null default 'declared'/);
  assert.match(sql, /alter table public\.brand_audit_markets enable row level security;\s*revoke all on public\.brand_audit_markets from anon, authenticated;/);
  const list = (keys) => keys.map((k) => `'${k}'`).join(",");
  for (const [kind, keys] of Object.entries(D.AUDIT_KEYS)) {
    assert.ok(sql.includes(`kind = '${kind}' and option_key in (${list(keys)})`), kind);
  }
  assert.match(sql, /check \(kind in \('goal', 'challenge', 'audience', 'age_range', 'audience_priority', 'market_scope', 'environment'\)\)/);
  for (const n of D.NYC_NEIGHBORHOODS) assert.match(n.key, /^[a-z0-9]+(-[a-z0-9]+)*$/, "curated keys satisfy the place_key CHECK");
  assert.equal(D.placeKey("Lower East Side"), "lower-east-side");
  assert.equal(D.placeKey("  São Paulo & Co. "), "sao-paulo-and-co");
});
