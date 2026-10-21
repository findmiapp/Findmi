// Findmi Brand Audit + Opportunity Intelligence V1 — the REAL server data
// layer (src/lib/brand-audit.ts) against an in-memory Supabase double, with
// only the authorization edges stubbed (requireBusinessMember reads a
// per-test membership table, requireAdmin a flag). Plus the migration
// (mirrors, seeds, server-only access) and the dashboard components
// rendered with react-dom/server. No network, no database.
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
let db;
const IDEAS = () => [
  { id: "i-all", title: "Residential Sampling", summary: "s", details: null, idea_type: "residential", status: "published", display_order: 10, audience: "all_brands" },
  { id: "i-a", title: "Workplace Activations", summary: "s", details: "d", idea_type: "workplace", status: "published", display_order: 20, audience: "selected_businesses" },
  { id: "i-draft", title: "Draft Idea", summary: "s", details: null, idea_type: "other", status: "draft", display_order: 5, audience: "all_brands" },
  { id: "i-arch", title: "Archived Idea", summary: "s", details: null, idea_type: "other", status: "archived", display_order: 6, audience: "all_brands" },
];
beforeEach(() => {
  db = fakeDb({ opportunity_ideas: IDEAS(), opportunity_idea_businesses: [{ idea_id: "i-a", business_id: A }] });
  globalThis.__db = db;
  globalThis.__admin = false;
  globalThis.__userId = "user-a";
  globalThis.__members = { [A]: { id: "m1", role: "manager" } };
});

const L = await import("../src/lib/brand-audit.ts");
const D = await import("../src/lib/brand-audit-domain.ts");
const goals = (...pairs) => pairs.map(([key, detail = null]) => ({ key, detail }));

// ---------------------------------------------------------------- authorization

test("Business A cannot read or write Business B's private intelligence; a public visitor can't either", async () => {
  await assert.rejects(L.getBrandAudit(B), /don't have access/);
  await assert.rejects(L.saveBrandAuditStep(B, "goal", goals(["drive_sales"])), /don't have access/);
  await assert.rejects(L.getIdeasForBusiness(B), /don't have access/);
  await assert.rejects(L.respondToIdea(B, "i-all", "interested"), /don't have access/);
  globalThis.__members = {};
  globalThis.__userId = null;
  await assert.rejects(L.getBrandAudit(A), /don't have access/);
  await assert.rejects(L.getIdeasForBusiness(A), /don't have access/);
  assert.equal(db.tables.brand_audit_answers?.length ?? 0, 0, "nothing written");
});

test("staff can view but not change; an Admin Manage-As session can't author as the Business", async () => {
  globalThis.__members = { [A]: { id: "m1", role: "staff" } };
  assert.equal((await L.getBrandAudit(A)).available, true);
  assert.match((await L.saveBrandAuditStep(A, "goal", goals(["drive_sales"]))).error, /owner or manager/);
  assert.match((await L.respondToIdea(A, "i-all", "interested")).error, /owner or manager/);
  globalThis.__members = { [A]: { id: "admin-override", role: "owner", viaAdmin: true } };
  assert.match((await L.saveBrandAuditStep(A, "goal", goals(["drive_sales"]))).error, /Findmi Admin/);
});

test("Admin functions require an Admin session", async () => {
  await assert.rejects(L.getAdminBusinessIntelligence(A), /admin only/);
  await assert.rejects(L.getAdminIdeas(), /admin only/);
  await assert.rejects(L.saveBusinessIntelligenceNote(A, "x"), /admin only/);
  await assert.rejects(L.createAdminIdea({}), /admin only/);
});

// ---------------------------------------------------------------- brand audit

test("a manager saves Goals; each elaboration persists with ITS Goal; Other works with its text", async () => {
  const r = await L.saveBrandAuditStep(A, "goal", goals(["foot_traffic", "Weekend traffic at our SoHo store"], ["build_awareness"], ["other", "Win a regional grocery chain"]));
  assert.deepEqual(r, { ok: true });
  const audit = await L.getBrandAudit(A);
  assert.deepEqual(audit.goals, [
    { key: "build_awareness", detail: null },
    { key: "foot_traffic", detail: "Weekend traffic at our SoHo store" },
    { key: "other", detail: "Win a regional grocery chain" },
  ]);
  assert.equal(audit.summary.status, "in_progress");
  assert.equal(D.auditProgress(audit.summary), 20, "1 of 5 profile sections");
  assert.equal(db.tables.brand_audit_answers.every((a) => a.business_id === A && a.updated_by_user_id === "user-a"), true);
});

test("Other must be explained; unknown choices and empty steps are rejected", async () => {
  assert.match((await L.saveBrandAuditStep(A, "goal", goals(["other", "  "]))).error, /other goal/);
  assert.match((await L.saveBrandAuditStep(A, "challenge", goals(["other"]))).error, /other challenge/);
  assert.match((await L.saveBrandAuditStep(A, "goal", goals(["finding_opportunities"]))).error, /isn.t available/, "a Challenge key is not a Goal");
  assert.match((await L.saveBrandAuditStep(A, "goal", [])).error, /at least one Goal/);
});

test("Challenges persist with their own elaboration and never touch Goals", async () => {
  await L.saveBrandAuditStep(A, "goal", goals(["drive_sales", "DTC"]));
  await L.saveBrandAuditStep(A, "challenge", goals(["activation_locations", "Hard to find lobbies"], ["measuring_results"]));
  const audit = await L.getBrandAudit(A);
  assert.deepEqual(audit.goals, [{ key: "drive_sales", detail: "DTC" }]);
  assert.deepEqual(audit.challenges, [
    { key: "activation_locations", detail: "Hard to find lobbies" },
    { key: "measuring_results", detail: null },
  ]);
  assert.equal(D.auditProgress(audit.summary), 40, "2 of 5 profile sections");
});

test("resume + edit later: lands on the next step; deselecting removes only that answer; completion keeps its first date", async () => {
  await L.saveBrandAuditStep(A, "goal", goals(["drive_sales", "v1"], ["partnerships"]));
  assert.equal(D.auditResumeStep((await L.getBrandAudit(A)).summary), "challenges");
  assert.match((await L.completeBrandAudit(A)).error, /Challenge/);
  await L.saveBrandAuditStep(A, "challenge", goals(["budget_efficiency"]));
  assert.deepEqual(await L.completeBrandAudit(A), { ok: true });
  const done = (await L.getBrandAudit(A)).summary;
  assert.equal(done.status, "complete");
  assert.ok(done.completedAt);
  assert.equal(D.auditResumeStep(done), "audience", "a completed V1 audit resumes on the first newer section");
  // Edit later: drop Partnerships, rewrite Drive Sales' note.
  await L.saveBrandAuditStep(A, "goal", goals(["drive_sales", "v2"]));
  await L.completeBrandAudit(A);
  const after = await L.getBrandAudit(A);
  assert.deepEqual(after.goals, [{ key: "drive_sales", detail: "v2" }]);
  assert.deepEqual(after.challenges, [{ key: "budget_efficiency", detail: null }]);
  assert.equal(after.summary.status, "complete", "editing never downgrades");
  assert.equal(after.summary.completedAt, done.completedAt, "first completion date kept");
});

test("dashboard entry labels: Start / Continue · N% / Complete", () => {
  const s = (o) => ({ status: null, goalCount: 0, challengeCount: 0, completedAt: null, updatedAt: null, ...o });
  assert.equal(D.auditActionLabel(s({})), "Set Up Growth");
  assert.equal(D.auditActionLabel(s({ status: "in_progress", goalCount: 2 })), "Continue Growth Setup");
  assert.equal(D.auditProgress(s({ status: "in_progress", goalCount: 2 })), 20);
  assert.equal(D.auditActionLabel(s({ status: "complete", goalCount: 1, challengeCount: 1, completedAt: "x" })), "Improve Your Matches", "V1-complete, newer sections open");
  assert.equal(D.auditActionLabel(s({ status: "complete", goalCount: 1, challengeCount: 1, audienceCount: 1, marketCount: 1, environmentCount: 1, completedAt: "x" })), "Review & Update");
});

// ---------------------------------------------------------------- ideas

test("eligibility: All Brands + Selected Businesses for A; B sees All Brands only; Draft/Archived never surface", async () => {
  const a = (await L.getIdeasForBusiness(A)).ideas.map((i) => i.id);
  assert.deepEqual(a, ["i-all", "i-a"]);
  globalThis.__members = { [B]: { id: "m2", role: "owner" } };
  assert.deepEqual((await L.getIdeasForBusiness(B)).ideas.map((i) => i.id), ["i-all"]);
  // Server-side, not UI: B can't respond to A's targeted Idea, nobody to a Draft/Archived one.
  assert.match((await L.respondToIdea(B, "i-a", "interested")).error, /isn.t available/);
  assert.match((await L.respondToIdea(B, "i-draft", "interested")).error, /isn.t available/);
  assert.match((await L.respondToIdea(B, "i-arch", "maybe")).error, /isn.t available/);
  assert.equal(db.tables.opportunity_idea_responses?.length ?? 0, 0);
});

test("Interested / Maybe / Not For Us persist, can be changed, and a note stays with that Business's response", async () => {
  assert.deepEqual(await L.respondToIdea(A, "i-all", "interested"), { ok: true });
  assert.deepEqual(await L.respondToIdea(A, "i-a", "maybe"), { ok: true });
  let ideas = (await L.getIdeasForBusiness(A)).ideas;
  assert.deepEqual(ideas.map((i) => [i.id, i.response.value]), [["i-all", "interested"], ["i-a", "maybe"]]);
  await L.respondToIdea(A, "i-all", "interested", "Premium residential buildings around NYC and Jersey City.");
  await L.respondToIdea(A, "i-all", "not_for_us"); // change the response, keep the note
  ideas = (await L.getIdeasForBusiness(A)).ideas;
  const all = ideas.find((i) => i.id === "i-all");
  assert.equal(all.response.value, "not_for_us");
  assert.equal(all.response.note, "Premium residential buildings around NYC and Jersey City.");
  assert.equal(db.tables.opportunity_idea_responses.length, 2, "one row per Business per Idea");
  assert.match((await L.respondToIdea(A, "i-all", "love it")).error, /isn.t available/);
});

test("answered Ideas move behind unanswered ones (no nagging)", async () => {
  db.tables.opportunity_ideas.push({ id: "i-3", title: "Retail Pop-Ups", summary: "s", details: null, idea_type: "retail", status: "published", display_order: 30, audience: "all_brands" });
  await L.respondToIdea(A, "i-all", "maybe");
  assert.deepEqual((await L.getIdeasForBusiness(A)).ideas.map((i) => i.id), ["i-a", "i-3", "i-all"]);
});

// ---------------------------------------------------------------- admin intelligence

test("Admin sees Goals, Challenges, Idea signals and the internal note; no Business read ever touches the note", async () => {
  await L.saveBrandAuditStep(A, "goal", goals(["product_sampling", "NYC trial"]));
  await L.saveBrandAuditStep(A, "challenge", goals(["activation_locations"]));
  await L.respondToIdea(A, "i-all", "interested", "Lobbies in Jersey City");
  const businessReads = db.log.slice();
  globalThis.__admin = true;
  assert.deepEqual(await L.saveBusinessIntelligenceNote(A, "Mentioned apartment sampling on our call. Follow up next week."), { ok: true });
  const intel = await L.getAdminBusinessIntelligence(A);
  assert.deepEqual(intel.goals, [{ key: "product_sampling", detail: "NYC trial" }]);
  assert.deepEqual(intel.challenges, [{ key: "activation_locations", detail: null }]);
  assert.deepEqual(intel.signals.map((s) => [s.title, s.response, s.note]), [["Residential Sampling", "interested", "Lobbies in Jersey City"]]);
  assert.equal(intel.note.text, "Mentioned apartment sampling on our call. Follow up next week.");
  // The Brand's own reads never include the note — structurally.
  globalThis.__admin = false;
  db.log.length = 0;
  const own = await L.getBrandAudit(A);
  await L.getIdeasForBusiness(A);
  assert.equal([...businessReads, ...db.log].includes("business_intelligence_notes"), false);
  assert.equal(JSON.stringify(own).includes("apartment sampling"), false);
  const src = readFileSync("src/lib/brand-audit.ts", "utf8");
  const noteUses = [...src.matchAll(/from\("business_intelligence_notes"\)/g)].length;
  assert.equal(noteUses, 2, "read once in getAdminBusinessIntelligence, written once in saveBusinessIntelligenceNote");
  for (const fn of ["getAdminBusinessIntelligence", "saveBusinessIntelligenceNote"]) {
    assert.match(src, new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\n  await requireAdmin\\(\\);`), `${fn} is Admin-gated first`);
  }
});

test("Admin Idea library: create with Selected Businesses, edit, archive; counts and responding Businesses are exact", async () => {
  globalThis.__admin = true;
  db.tables.businesses = [{ id: A, name: "Brand A" }, { id: B, name: "Brand B" }];
  assert.match((await L.createAdminIdea({ title: "X", summary: "y", idea_type: "retail", status: "draft", audience: "selected_businesses", display_order: "5", target_business_ids: [] })).error, /at least one Business/);
  const created = await L.createAdminIdea({ title: "Campus Tour", summary: "Meet students.", details: "", idea_type: "campus", status: "published", audience: "selected_businesses", display_order: "15", target_business_ids: [A, B] });
  assert.equal(created.ok, true);
  globalThis.__admin = false;
  await L.respondToIdea(A, created.id, "interested", "Spring semester");
  globalThis.__admin = true;
  let detail = await L.getAdminIdea(created.id);
  assert.deepEqual(detail.counts, { interested: 1, maybe: 0, not_for_us: 0 });
  assert.deepEqual(detail.responses.map((r) => [r.businessName, r.note]), [["Brand A", "Spring semester"]]);
  assert.equal(detail.noResponse, 1, "Brand B targeted, not answered");
  assert.deepEqual(await L.updateAdminIdea(created.id, { title: "Campus Tour", summary: "Meet students.", idea_type: "campus", status: "published", audience: "selected_businesses", display_order: "15", target_business_ids: [A] }), { ok: true });
  detail = await L.getAdminIdea(created.id);
  assert.deepEqual(detail.targets.map((t) => t.id), [A]);
  assert.deepEqual(await L.setAdminIdeaStatus(created.id, "archived"), { ok: true });
  globalThis.__admin = false;
  assert.equal((await L.getIdeasForBusiness(A)).ideas.some((i) => i.id === created.id), false, "archived never surfaces");
  globalThis.__admin = true;
  const list = await L.getAdminIdeas();
  assert.deepEqual(list.ideas.find((i) => i.id === created.id).counts, { interested: 1, maybe: 0, not_for_us: 0 });
});

test("a missing migration degrades safely (available: false, friendly write errors)", async () => {
  const broken = { from: () => { const api = { select: () => api, eq: () => api, in: () => api, order: () => api, limit: () => api, maybeSingle: async () => ({ data: null, error: { code: "42P01" } }), then: (r) => r({ data: null, error: { code: "42P01" } }) }; return api; } };
  globalThis.__db = broken;
  assert.equal((await L.getBrandAudit(A)).available, false);
  assert.equal((await L.getIdeasForBusiness(A)).available, false);
  assert.match((await L.saveBrandAuditStep(A, "goal", goals(["drive_sales"]))).error, /isn.t available yet/);
});

// ---------------------------------------------------------------- migration

const sql = readFileSync("supabase/migrations/20261021000000_brand_audit_and_opportunity_ideas.sql", "utf8");
const body = sql.replace(/--.*$/gm, "");

test("migration: additive, server-only (RLS on, no client grants or policies), value lists mirror the domain", () => {
  assert.doesNotMatch(body, /\bdrop\s+table|\bdelete\s+from|\btruncate\b|\balter\s+table\s+public\.(?!brand_audit|business_intelligence|opportunity_idea)/i);
  assert.doesNotMatch(body, /create\s+policy/i);
  assert.match(body, /revoke all on public\.brand_audits, public\.brand_audit_answers, public\.business_intelligence_notes,\s*public\.opportunity_ideas, public\.opportunity_idea_businesses, public\.opportunity_idea_responses\s*from anon, authenticated;/);
  for (const t of ["brand_audits", "brand_audit_answers", "business_intelligence_notes", "opportunity_ideas", "opportunity_idea_businesses", "opportunity_idea_responses"]) {
    assert.match(body, new RegExp(`alter table public\\.${t} enable row level security;`));
  }
  const list = (keys) => keys.map((k) => `'${k}'`).join(",");
  assert.ok(body.includes(`kind = 'goal' and option_key in (${list(D.AUDIT_GOALS)})`));
  assert.ok(body.includes(`kind = 'challenge' and option_key in (${list(D.AUDIT_CHALLENGES)})`));
  assert.ok(body.includes(`idea_type in (${list(D.IDEA_TYPES)})`));
  assert.ok(body.includes(`response in ('interested', 'maybe', 'not_for_us')`));
});

test("seed library: 12–15 Published All-Brands templates, idempotent by seed_key, no fabricated claims", () => {
  const seeds = [...body.matchAll(/\('([a-z_]+)', '([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([a-z]+)', '([a-z]+)', (\d+), '([a-z_]+)'\)/g)];
  assert.ok(seeds.length >= 12 && seeds.length <= 15, `${seeds.length} seeds`);
  assert.equal(new Set(seeds.map((s) => s[1])).size, seeds.length, "unique seed keys");
  assert.equal(new Set(seeds.map((s) => s[2])).size, seeds.length, "no duplicate titles");
  for (const [, , title, , , type, status, , audience] of seeds) {
    assert.ok(D.IDEA_TYPES.includes(type), type);
    assert.equal(status, "published");
    assert.equal(audience, "all_brands");
    assert.match(title, /^([A-Z][\w-]*|&)( ([A-Z][\w-]*|&))*$/, `${title} is Title Case`);
    assert.ok(title.length <= D.IDEA_LIMITS.title);
  }
  for (const s of seeds) assert.ok(s[3].length <= D.IDEA_LIMITS.summary, s[2]);
  assert.match(body, /\)\s*on conflict \(seed_key\) do nothing;\s*$/, "re-running never duplicates");
  assert.doesNotMatch(body, /\$\d|guarantee|\d+,\d{3} (residents|people)|available now/i);
});

// ---------------------------------------------------------------- rendered components

const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: AuditChoiceList } = await import("../src/components/brand-audit/AuditChoiceList.tsx");
const { default: IdeasForYourBrand } = await import("../src/app/(public)/account/business/[id]/v2/IdeasForYourBrand.tsx");
const h = React.createElement;

test("Goal / Challenge list: one stacked column, checkbox left, bold Title Case name, italic explanation; Other opens its textarea", () => {
  const html = renderToStaticMarkup(
    h(AuditChoiceList, { keys: D.AUDIT_GOALS, options: D.AUDIT_GOAL_OPTIONS, value: { drive_sales: "", other: "" }, onChange: () => {}, placeholder: "p", otherPlaceholder: "Have a goal we didn’t cover?" })
  );
  assert.doesNotMatch(html, /grid-cols-2/);
  assert.match(html, /^<ul class="flex flex-col gap-2">/);
  assert.equal((html.match(/role="checkbox"/g) ?? []).length, D.AUDIT_GOALS.length, "every choice stays visible");
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 2);
  assert.match(html, /font-bold text-primary">Increase Brand Awareness</);
  assert.match(html, /italic text-muted">Get your brand known/);
  assert.match(html, /Describe Or Elaborate \(Optional\)/, "a selected Goal offers its own elaboration");
  assert.equal((html.match(/<textarea/g) ?? []).length, 1, "only Other opens automatically");
  assert.match(html, /placeholder="Have a goal we didn’t cover\?"/);
  for (const o of [...Object.values(D.AUDIT_GOAL_OPTIONS), ...Object.values(D.AUDIT_CHALLENGE_OPTIONS)]) {
    assert.match(o.label, /^([A-Z][\w/'-]*|&)( ([A-Z][\w/'-]*|&))*$/, `${o.label} is Title Case`);
  }
  assert.ok(D.AUDIT_GOALS.length >= 8 && D.AUDIT_GOALS.length <= 12 && D.AUDIT_CHALLENGES.length >= 8 && D.AUDIT_CHALLENGES.length <= 12);
});

test("Ideas For Your Brand renders the eligible Ideas as a swipe rail, answered ones with their response", async () => {
  await L.respondToIdea(A, "i-a", "interested");
  const { ideas } = await L.getIdeasForBusiness(A);
  const html = renderToStaticMarkup(h(IdeasForYourBrand, { ideas, canRespond: true, respond: async () => ({ ok: true }) }));
  assert.match(html, /Ideas For Your Brand/);
  assert.match(html, /Explore ways Findmi could help you reach your goals\./);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /snap-start/);
  assert.match(html, /Residential Sampling[\s\S]*Workplace Activations/, "unanswered first");
  assert.match(html, /Interested<\/span>/);
  assert.doesNotMatch(html, /Draft Idea|Archived Idea/);
  assert.equal(renderToStaticMarkup(h(IdeasForYourBrand, { ideas: [], canRespond: true, respond: async () => ({ ok: true }) })), "", "nothing to show → nothing rendered");
});
