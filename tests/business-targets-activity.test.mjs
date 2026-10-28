// Target Activity (append-only notes + automatic status changes), Context, and Targets
// reachable from BOTH Growth and Find Us Here — ported from Pass 2 Block A's Placement
// Activity onto the canonical business_targets system (Cross-Entity Target Foundation).
// Server reads/writes run against an in-memory fake that also emulates the database
// trigger (the trigger itself is checked in the migration tests). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/business-targets-domain.ts");
const L = await import("../src/lib/business-targets.ts");
const G = await import("../src/lib/growth.ts");
const read = (p) => readFileSync(p, "utf8");

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const JON = "11111111-1111-4111-8111-111111111111";
const EMAILY = "22222222-2222-4222-8222-222222222222";
const MEMBER = { actor: "business", userId: JON };
const FINDMI = { actor: "findmi", userId: null };

let clock = 0;
const tick = () => `2026-10-22T10:${String(clock++).padStart(2, "0")}:00.123456+00:00`;

function seed() {
  clock = 0;
  return {
    business_targets: [
      { id: P_A, business_id: BIZ_A, target_location_id: "l1", target_business_id: null, target_event_id: null, intents: ["placement"], status: "target", context: null, internal_notes: "FINDMI SECRET", next_action: null, next_action_at: null, status_actor: null, status_actor_user_id: null },
      { id: P_B, business_id: BIZ_B, target_location_id: "l1", target_business_id: null, target_event_id: null, intents: ["placement"], status: "target", context: null, internal_notes: "OTHER SECRET", next_action: null, next_action_at: null, status_actor: null, status_actor_user_id: null },
    ],
    business_target_activities: [],
    profiles: [
      { id: JON, display_name: "Jonathan" },
      { id: EMAILY, display_name: "someone@example.com" },
    ],
  };
}

let seq = 0;
const newId = () => `cccccccc-cccc-4ccc-8ccc-${String(++seq).padStart(12, "0")}`;

/** Fake service-role client. UPDATEs on Targets emulate the migration's trigger:
 * a status change inserts one status_change Activity (with the transient actor) and
 * the actor columns are always cleared. */
function fakeDb(t) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, select: null, filters: [], op: "select", payload: null, limit: null, orders: [] };
      calls.push(call);
      const preds = [];
      let single = false;
      let head = false;
      const chain = {
        select(cols, opts) {
          if (call.op === "select") call.select = cols;
          head = Boolean(opts?.head);
          return chain;
        },
        eq(c, v) {
          call.filters.push(`eq ${c}=${v}`);
          preds.push((r) => (c === "business_targets.business_id" ? t.business_targets.find((p) => p.id === r.target_id)?.business_id === v : r[c] === v));
          return chain;
        },
        or(expr) {
          call.filters.push(`or ${expr}`);
          // Only the Activity keyset shape: created_at.lt."A",and(created_at.eq."A",id.lt.ID)
          const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\.([0-9a-f-]+)\)$/.exec(expr);
          assert.ok(m, `unexpected or(): ${expr}`);
          preds.push((r) => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3]));
          return chain;
        },
        in(c, vals) { call.filters.push(`in ${c}`); preds.push((r) => vals.includes(r[c])); return chain; },
        order(c, o) { call.orders.push([c, o?.ascending]); return chain; },
        limit(n) { call.limit = n; return chain; },
        range() { return chain; },
        insert(payload) { call.op = "insert"; call.payload = payload; return chain; },
        update(payload) { call.op = "update"; call.payload = payload; return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        then(resolve) {
          const rows = t[table] ?? [];
          if (call.op === "insert") {
            const row = { id: newId(), metadata: {}, actor: null, created_by_user_id: null, body: null, created_at: tick(), ...call.payload };
            rows.push(row);
            return resolve({ data: { id: row.id }, error: null });
          }
          const matched = rows.filter((r) => preds.every((p) => p(r)));
          if (call.op === "update") {
            for (const r of matched) {
              const before = r.status;
              Object.assign(r, call.payload);
              if (table === "business_targets") {
                if (r.status !== before) {
                  t.business_target_activities.push({ id: newId(), target_id: r.id, activity_type: "status_change", body: null, metadata: { from: before, to: r.status }, actor: r.status_actor, created_by_user_id: r.status_actor_user_id, created_at: tick() });
                }
                r.status_actor = null;
                r.status_actor_user_id = null;
              }
            }
            return resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          }
          if (head) return resolve({ data: null, count: matched.length, error: null });
          let data = matched.map((r) => ({ ...r }));
          if (table === "business_target_activities") data.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
          if (call.limit) data = data.slice(0, call.limit);
          if (single) return resolve({ data: data[0] ?? null, error: null });
          return resolve({ data, count: data.length, error: null });
        },
      };
      return chain;
    },
  };
}

const note = (db, biz, pid, body, by = MEMBER) => L.addTargetNote(db, biz, pid, body, by);

// ── Notes ─────────────────────────────────────────────────────────────────

test("Add Note appends — earlier notes are preserved, and the feed is newest first", async () => {
  const t = seed();
  const db = fakeDb(t);
  for (const body of ["Called GM. Asked me to send samples Friday.", "Samples delivered. Sarah will review with purchasing Monday.", "Interested in 12oz cold cups. Requested pricing."]) {
    assert.deepEqual(await note(db, BIZ_A, P_A, body), { ok: true });
  }
  assert.equal(t.business_target_activities.length, 3, "three rows — nothing replaced");
  const page = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  assert.deepEqual(page.items.map((i) => i.body), ["Interested in 12oz cold cups. Requested pricing.", "Samples delivered. Sarah will review with purchasing Monday.", "Called GM. Asked me to send samples Friday."]);
  assert.ok(page.items.every((i) => i.type === "note" && i.author === "Jonathan"));
  assert.equal(page.nextCursor, null);
  // Notes never touch Context.
  assert.equal(t.business_targets[0].context, null);
});

test("notes are validated: empty refused, 2,000 characters max, trimmed", async () => {
  const db = fakeDb(seed());
  assert.equal((await note(db, BIZ_A, P_A, "   ")).ok, false);
  assert.equal((await note(db, BIZ_A, P_A, "x".repeat(2001))).ok, false);
  assert.equal(D.validateActivityNote("  hi  ").value, "hi");
});

test("Add Note is refused for another Business's Target", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.equal((await note(db, BIZ_A, P_B, "sneaky")).ok, false);
  assert.equal(t.business_target_activities.length, 0);
});

// ── Status changes ────────────────────────────────────────────────────────

test("a status change records one status_change Activity with its actor; actor columns end null", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await L.updateBusinessTarget(db, BIZ_A, P_A, { status: "in_conversation" }, MEMBER);
  assert.deepEqual(res, { ok: true, changed: true });
  const upd = db.calls.find((c) => c.op === "update" && c.table === "business_targets");
  assert.deepEqual(upd.payload, { status: "in_conversation", status_actor: "business", status_actor_user_id: JON });
  const [act] = t.business_target_activities;
  assert.deepEqual({ type: act.activity_type, meta: act.metadata, actor: act.actor, by: act.created_by_user_id }, { type: "status_change", meta: { from: "target", to: "in_conversation" }, actor: "business", by: JON });
  assert.equal(t.business_targets[0].status_actor, null);
  const page = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  assert.deepEqual(page.items.map((i) => [i.type, i.from, i.to, i.author]), [["status_change", "target", "in_conversation", "Jonathan"]]);
});

test("an unchanged status records nothing; an edit without a status change sends no actor", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.deepEqual(await L.updateBusinessTarget(db, BIZ_A, P_A, { status: "target" }, MEMBER), { ok: true, changed: false });
  assert.deepEqual(await L.updateBusinessTarget(db, BIZ_A, P_A, { status: "target", context: "Independent café. Sarah is the owner." }, MEMBER), { ok: true, changed: true });
  const upd = db.calls.find((c) => c.op === "update");
  assert.deepEqual(upd.payload, { context: "Independent café. Sarah is the owner." }, "Context saves; no actor columns");
  assert.equal(t.business_target_activities.length, 0);
  assert.equal(t.business_targets[0].context, "Independent café. Sarah is the owner.");
});

test("the full pipeline, and Passed → Target on reopen, each record their change (Findmi shown as Findmi)", async () => {
  const t = seed();
  const db = fakeDb(t);
  for (const s of ["in_conversation", "agreed", "active", "passed"]) await L.updateBusinessTarget(db, BIZ_A, P_A, { status: s }, MEMBER);
  await L.updateBusinessTarget(db, BIZ_A, P_A, { status: "target" }, FINDMI);
  const page = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  assert.deepEqual(page.items.map((i) => `${i.from}→${i.to}:${i.author}`), [
    "passed→target:Findmi",
    "active→passed:Jonathan",
    "agreed→active:Jonathan",
    "in_conversation→agreed:Jonathan",
    "target→in_conversation:Jonathan",
  ]);
  assert.equal(t.business_targets.filter((p) => p.business_id === BIZ_A).length, 1, "reopen keeps the same row");
});

// ── Reads: privacy, authors, pagination ───────────────────────────────────

test("Activity is scoped through the Target to THIS Business and never carries internal_notes", async () => {
  const t = seed();
  const db = fakeDb(t);
  await note(db, BIZ_B, P_B, "Business B private note");
  const fromA = await L.getTargetActivityPage(db, BIZ_A, P_B, null);
  assert.equal(fromA.items.length, 0, "another Business reads nothing");
  const call = db.calls.filter((c) => c.table === "business_target_activities" && c.op === "select").at(-1);
  assert.ok(call.filters.includes(`eq business_targets.business_id=${BIZ_A}`));
  assert.match(call.select, /business_targets!inner\(business_id\)/);
  const own = await L.getTargetActivityPage(db, BIZ_B, P_B, null);
  assert.doesNotMatch(JSON.stringify(own), /SECRET|internal/i);
  assert.doesNotMatch(call.select, /internal_notes/);
  // No ids or emails leave the module.
  assert.doesNotMatch(JSON.stringify(own), new RegExp(`${JON}|${BIZ_B}|created_by_user_id`));
});

test("authors: display name, never an email; Team Member when unnamed; one batched profile read", async () => {
  const t = seed();
  const db = fakeDb(t);
  await note(db, BIZ_A, P_A, "a", { actor: "business", userId: EMAILY });
  await note(db, BIZ_A, P_A, "b", { actor: "business", userId: JON });
  await note(db, BIZ_A, P_A, "c", { actor: "business", userId: null });
  const page = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  assert.deepEqual(page.items.map((i) => i.author), ["Team Member", "Jonathan", "Team Member"]);
  assert.equal(db.calls.filter((c) => c.table === "profiles").length, 1, "no N+1 author reads");
});

test("pagination: a bounded first page (25) with a cursor; Load More continues from it", async () => {
  const t = seed();
  const db = fakeDb(t);
  for (let i = 0; i < 30; i++) await note(db, BIZ_A, P_A, `n${i}`);
  const first = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  assert.equal(first.items.length, D.TARGET_ACTIVITY_PAGE_SIZE);
  const call = db.calls.filter((c) => c.table === "business_target_activities" && c.op === "select").at(-1);
  assert.equal(call.limit, D.TARGET_ACTIVITY_PAGE_SIZE + 1, "reads one extra row only to know there's more");
  assert.equal(first.items[0].body, "n29");
  assert.ok(first.nextCursor);
  const next = await L.getTargetActivityPage(db, BIZ_A, P_A, D.parseActivityCursor(first.nextCursor));
  assert.deepEqual(next.items.map((i) => i.body), ["n4", "n3", "n2", "n1", "n0"]);
  assert.equal(next.nextCursor, null);
  assert.equal(D.parseActivityCursor(first.nextCursor).at, "2026-10-22T10:05:00.123456+00:00", "microseconds kept");
  assert.equal(D.parseActivityCursor("2026-10-22T10:00:00Z,id.eq.x"), null);
  assert.equal(D.parseActivityCursor('2026-10-22T10:00:00Z|x",id.gt.0'), null, "nothing injectable reaches or()");
  assert.equal(D.parseActivityCursor(5), null);
});

test("pagination never skips or repeats rows that share a timestamp (one transaction)", async () => {
  const t = seed();
  const db = fakeDb(t);
  const same = "2026-10-22T10:00:00.000000+00:00";
  for (let i = 0; i < 30; i++) t.business_target_activities.push({ id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`, target_id: P_A, activity_type: "note", body: `s${i}`, metadata: {}, actor: "business", created_by_user_id: null, created_at: same });
  const first = await L.getTargetActivityPage(db, BIZ_A, P_A, null);
  const next = await L.getTargetActivityPage(db, BIZ_A, P_A, D.parseActivityCursor(first.nextCursor));
  const all = [...first.items, ...next.items].map((i) => i.body);
  assert.equal(all.length, 30);
  assert.equal(new Set(all).size, 30);
});

test("the Targets LIST never reads Activity; only an opened workspace (place or Target) does", async () => {
  const t = seed();
  t.locations = [{ id: "l1", name: "Cafe", slug: "cafe" }];
  const db = fakeDb(t);
  db.from = ((orig) => (table) => {
    const c = orig(table);
    c.not = () => c;
    return c;
  })(db.from);
  await L.getBusinessTargetsPage(db, BIZ_A, D.EMPTY_TARGET_FILTER, 1);
  assert.equal(db.calls.filter((c) => c.table === "business_target_activities").length, 0);
  assert.doesNotMatch(L.BUSINESS_TARGET_COLUMNS, /activit/);
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /data\.target \? getTargetActivityPage\(admin, id, data\.target\.id, null\) : null,/);
  assert.match(page, /getTargetActivityPage\(admin, id, opened\.id, null\)/, "a Business / Event Target's workspace");
  assert.equal((page.match(/getTargetActivityPage\(/g) ?? []).length, 2, "two read sites: the two opened workspaces");
});

// ── Permissions (actions) ─────────────────────────────────────────────────

test("permissions: owner/manager/Findmi Admin add notes; staff read only; Findmi acts as Findmi", () => {
  const src = read("src/app/(public)/account/business/[id]/target-actions.ts");
  assert.match(src, /export async function addTargetNoteAction[\s\S]*?const auth = await authorizeWrite\(businessId\);\s*if \(!auth\.ok\) return auth;/);
  assert.match(src, /export async function loadTargetActivityAction[\s\S]*?authorizeRead\(businessId\)/);
  assert.match(src, /async function authorizeRead[\s\S]*?await requireBusinessMember\(businessId\);\s*return true;/, "staff (any member) may read");
  assert.equal(D.canEditTargets("staff"), false);
  assert.equal(D.canEditTargets("owner"), true);
  assert.equal(D.canEditTargets("manager"), true);
  assert.equal(D.canEditTargets("staff", true), true, "founder Admin (Manage-As)");
  assert.deepEqual(D.targetActor(true, JON), { actor: "findmi", userId: null });
  assert.deepEqual(D.targetActor(false, JON), { actor: "business", userId: JON });
  const view = read("src/app/(public)/account/business/[id]/v2/RelationshipWorkspace.tsx");
  assert.match(view, /<ActivityFeed businessId=\{businessId\} targetId=\{target\.id\} canAdd=\{canEdit\} initial=\{props\.activity\} \/>/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/TargetWorkspace.tsx"), /<ActivityFeed businessId=\{businessId\} targetId=\{target\.id\} canAdd=\{canEdit\} initial=\{activity\} \/>/);
  assert.match(view, /\{canAdd && initial\?\.available !== false && \(/, "the composer only renders for editors");
  const feed = view.slice(view.indexOf("export function ActivityFeed"), view.indexOf("// ── Findmi Internal"));
  assert.ok(feed.length > 0);
  assert.doesNotMatch(feed, /internal/i, "Activity never shows Findmi internal notes");
  assert.doesNotMatch(view.slice(view.indexOf("function ActivityEntry"), view.indexOf("export function ActivityFeed")), /Edit|Delete|Remove/, "append-only: no edit or delete controls");
});

test("Context is the Target's `context` field (migrated from Placement notes): read first, Edit when needed", () => {
  const view = read("src/app/(public)/account/business/[id]/v2/RelationshipWorkspace.tsx");
  assert.equal(D.TARGET_CONTEXT_LABEL, "Context");
  const block = view.slice(view.indexOf("export function SummaryBlock"), view.indexOf("export function IntentsBlock"));
  assert.equal((block.match(/<h3 className=\{sectionTitle\}>Context<\/h3>/g) ?? []).length, 2, "editor and read view");
  assert.match(block, /save\(businessId, item, \{ context: text \|\| null \}\)/);
  assert.match(block, /\{item\.context \? "Edit" : "Add Context"\}/);
  assert.doesNotMatch(view, /">Notes</);
});

// ── Two doors, one pipeline ───────────────────────────────────────────────

test("Targets resolve from Growth and from Find Us Here — the same view, records and actions", () => {
  assert.deepEqual([...G.GROWTH_DESTINATIONS], ["goals", "opportunities", "ideas", "targets"]);
  assert.equal(G.growthHref("/b", "targets"), "/b?tab=growth&view=targets");
  assert.deepEqual(G.GROWTH_WORKFLOW_ROLES.map((r) => r.role), ["What You Want", "What You’re Pursuing", "What May Help", "What’s Available"]);
  const s = (o) => G.summarizeGrowth({ audit: null, activeGoalCount: 0, matchesAwaitingResponse: 0, matchesInProgress: 0, ...o });
  assert.deepEqual(G.growthDestinationStatus(s({}), "targets"), { value: "Add Targets", sub: "Where To Grow" });
  assert.deepEqual(G.growthDestinationStatus(s({ targetsTotal: 5, targetsPursuing: 3 }), "targets"), { value: "3 Pursuing", sub: "Targets" });
  assert.deepEqual(G.growthDestinationStatus(s({ targetsTotal: 2, targetsPursuing: 0 }), "targets").value, "None Active");

  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /const onTargets = onFindUsTargets \|\| onGrowthTargets;/);
  assert.match(page, /const targetsPromise = whenP\(\s*onTargets,/);
  assert.equal((page.match(/<TargetsView\b/g) ?? []).length, 1, "ONE TargetsView element");
  assert.match(page, /onFindUsTargets && targetsView\}/, "Find Us Here door kept");
  assert.match(page, /growthView === "targets" && !workspaceView && \([\s\S]*?<GrowthTargetsHeader basePath=\{basePath\} summary=\{growthSummary\} \/>[\s\S]*?\{targetsView\}/, "Growth door");
  // In-view links keep whichever door you came through (they patch the current URL).
  const view = read("src/app/(public)/account/business/[id]/v2/TargetsView.tsx");
  assert.match(view, /const next = new URLSearchParams\(searchParams\.toString\(\)\);/);
  // Nothing new stores Targets: one table, one library.
  assert.doesNotMatch(read("src/lib/growth.ts"), /business_location_placements|business_targets/);
});

// ── Migration ─────────────────────────────────────────────────────────────

test("legacy Placement Activity migration (history): additive, server-only, append-only, trigger-recorded", () => {
  const body = read("supabase/migrations/20261103000000_business_location_placement_activities.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(body, /\bdrop\s+(table|column|trigger)|\bdelete\s+from|\btruncate\b|\bupdate\s+public\./i);
  assert.doesNotMatch(body, /create\s+policy/i);
  assert.doesNotMatch(body, /bd\./, "not the Findmi-internal BD schema");
  assert.match(body, /alter table public\.business_location_placement_activities enable row level security;/);
  assert.match(body, /revoke all on public\.business_location_placement_activities from public, anon, authenticated, service_role;/);
  assert.match(body, /grant select, insert on public\.business_location_placement_activities to service_role;/, "no update/delete: append-only");
  assert.doesNotMatch(body, /grant[^;]*to (anon|authenticated)/i);
  assert.match(body, /references public\.business_location_placements\(id\) on delete cascade/);
  assert.ok(body.includes("check (activity_type in ('note', 'status_change'))"));
  for (const s of ["target", "in_conversation", "placement_pending", "active", "passed"]) assert.match(body, new RegExp(`'${s}'`));
  assert.match(body, /\(placement_id, created_at desc, id desc\)/);
  // The trigger: only on a real change, one insert, actor copied then cleared.
  const fn = body.slice(body.indexOf("create or replace function public.business_location_placements_status_changed()"));
  assert.match(fn, /if new\.status is distinct from old\.status then[\s\S]*?insert into public\.business_location_placement_activities[\s\S]*?jsonb_build_object\('from', old\.status, 'to', new\.status\), new\.status_actor, new\.status_actor_user_id\);\s*end if;\s*new\.status_actor := null;\s*new\.status_actor_user_id := null;/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("$$;")), /internal_notes/);
  // The already-applied Block A migration file is untouched by this pass.
  assert.match(read("supabase/migrations/20261102000000_business_location_placements.sql"), /drop trigger if exists trg_business_location_placements_status_changed/);
});
