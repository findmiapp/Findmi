// Admin Bulk Lifecycle V2 — Events + Businesses. Bulk actions expose each
// entity's EXISTING lifecycle (no new states): Events Make Live / Hide /
// Shut Down (= Archive) / Trash; Businesses Approve / Reject / Pause /
// Resume / Archive / Trash. Single-record and bulk controls share ONE
// implementation per entity. Fakes only — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=(...a)=>{(globalThis.__REVALIDATED ??= []).push(a)};", shortCircuit: true };
    if (specifier === "next/navigation") return { url: "data:text/javascript,export const redirect=(u)=>{throw Object.assign(new Error('REDIRECT'),{url:u})};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const EV = await import("../src/lib/admin/event-lifecycle.ts");
const BZ = await import("../src/lib/admin/business-lifecycle.ts");
const EL = await import("../src/lib/admin/lifecycle-eligibility.ts");
const PUB = await import("../src/lib/event-publication.ts");
const EVA = await import("../src/app/admin/(protected)/events/lifecycle-actions.ts");
const BZA = await import("../src/app/admin/(protected)/businesses/lifecycle-actions.ts");
const read = (p) => readFileSync(p, "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** In-memory tables; filter chain + update recorder; `failIds` never confirm. */
function fakeDb(table, rows, { failIds = [], updateError = false, related = {} } = {}) {
  const tables = { [table]: rows.map((r) => ({ ...r })), ...related };
  const writes = [];
  return {
    tables,
    writes,
    from(t) {
      const filters = [];
      let patch = null;
      const apply = () => (tables[t] ?? []).filter((r) => filters.every((f) => f(r)));
      const chain = {
        select: () => chain,
        in: (c, v) => (filters.push((r) => v.includes(r[c])), chain),
        is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), chain),
        eq: (c, v) => (filters.push((r) => r[c] === v), chain),
        update: (p) => ((patch = p), writes.push({ table: t, patch: p }), chain),
        then: (resolve) => {
          if (patch) {
            if (updateError) return resolve({ data: null, error: { message: "boom" } });
            const hit = apply().filter((r) => !failIds.includes(r.id));
            for (const r of hit) Object.assign(r, patch);
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          return resolve({ data: apply().map((r) => ({ ...r })), error: null });
        },
      };
      return chain;
    },
  };
}
const ev = (n, o = {}) => ({ id: id(n), slug: `ev-${n}`, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...o });
const biz = (n, o = {}) => ({ id: id(n), name: `Biz ${n}`, slug: `biz-${n}`, publication_status: "pending_review", archived_at: null, trashed_at: null, is_demo: false, plan_tier: "pro", ...o });
const find = (db, t, n) => db.tables[t].find((r) => r.id === id(n));

// ── EVENTS ──────────────────────────────────────────────────────────────

test("E1. Hidden Event → bulk Make Live (is_demo=false, publication_status='live')", async () => {
  const db = fakeDb("events", [ev(1, { is_demo: true }), ev(2, { is_demo: true, publication_status: "pending_review" })]);
  const r = await EV.transitionEvents(db, [id(1), id(2)], "live");
  assert.deepEqual(r.changed, [id(1), id(2)]);
  assert.equal(PUB.eventVisibility(find(db, "events", 1)), "live");
  assert.equal(find(db, "events", 2).publication_status, "live", "a legacy pending Event is published the same way");
  assert.deepEqual(db.writes.map((w) => w.patch), [EV.EVENT_PUBLISH_PATCH]);
});

test("E2. Live Event → bulk Hide (is_demo=true) — reversible, nothing deleted", async () => {
  const db = fakeDb("events", [ev(1)]);
  const r = await EV.transitionEvents(db, [id(1)], "hide");
  assert.deepEqual(r.changed, [id(1)]);
  assert.equal(PUB.eventVisibility(find(db, "events", 1)), "hidden");
  assert.deepEqual(db.writes.map((w) => w.patch), [{ is_demo: true }]);
  await EV.transitionEvents(db, [id(1)], "live");
  assert.equal(PUB.eventVisibility(find(db, "events", 1)), "live", "a Hidden Event can be republished");
});

test("E3 & E4. mixed Live/Hidden selections are idempotent both ways (no write for already-target rows)", async () => {
  const mixed = () => fakeDb("events", [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ev(n, { is_demo: true })).concat([9, 10, 11].map((n) => ev(n))));
  const all = Array.from({ length: 11 }, (_, i) => id(i + 1));
  const a = await EV.transitionEvents(mixed(), all, "live");
  assert.equal(EV.describeEventTransition(a), "8 Events Published · 3 Already Published");
  const b = await EV.transitionEvents(mixed(), all, "hide");
  assert.equal(EV.describeEventTransition(b), "3 Events Unpublished · 8 Already Draft");
  const db = fakeDb("events", [ev(1)]);
  await EV.transitionEvents(db, [id(1)], "live");
  assert.equal(db.writes.length, 0, "already Live → no write");
});

test("E5 & E6. Shut Down = the existing Archive change (archived_at); Shut Down rows are not Made Live / Hidden", async () => {
  const db = fakeDb("events", [ev(1), ev(2, { is_demo: true }), ev(3, { archived_at: "2026-10-01" }), ev(4, { trashed_at: "2026-10-01" })]);
  const r = await EV.transitionEvents(db, [id(1), id(2), id(3), id(4)], "shutdown", new Date("2026-10-16T12:00:00Z"));
  assert.deepEqual(r.changed, [id(1), id(2)]);
  assert.deepEqual(r.already, [id(3)]);
  assert.deepEqual(r.inactive, [id(4)]);
  assert.equal(find(db, "events", 1).archived_at, "2026-10-16T12:00:00.000Z");
  assert.equal(PUB.EVENT_VISIBILITY_LABEL[PUB.eventVisibility(find(db, "events", 1))], "Archived");
  assert.equal(find(db, "events", 1).is_demo, false, "Shut Down doesn't change publication — Restore returns it to Live/Hidden");
  const live = await EV.transitionEvents(db, [id(3)], "live");
  assert.deepEqual(live.inactive, [id(3)], "Restore first");
  // Bulk Archive (Archived tab) and Shut Down write the same column: ONE toolbar button.
  const actions = read("src/app/admin/(protected)/events/lifecycle-actions.ts");
  assert.match(actions, /export async function bulkArchiveEvents[\s\S]*?\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)/);
  const bar = read("src/app/admin/(protected)/events/EventBulkActionBar.tsx");
  assert.match(bar, /key: "shutdown", label: "Archive"/);
  assert.equal((bar.slice(bar.indexOf("<BulkLifecycleToolbar")).match(/label: "Archive"/g) ?? []).length, 1, "one Archive action (the archived_at change), no duplicate");
  assert.doesNotMatch(bar, /label: "Shut Down"|label: "Make Live"|label: "Hide"/);
});

test("E7. bulk Trash keeps the existing soft-delete action and confirmation", () => {
  const actions = read("src/app/admin/(protected)/events/lifecycle-actions.ts");
  assert.match(actions, /export async function bulkTrashEvents[\s\S]*?\.update\(\{ trashed_at: new Date\(\)\.toISOString\(\) \}\)/);
  const bar = read("src/app/admin/(protected)/events/EventBulkActionBar.tsx");
  assert.match(bar, /\{ key: "trash", label: "Move To Trash", tone: "destructive", action: bulkTrashEvents, confirm:/);
});

test("E8–E10. relationships, occurrences and details survive Hide and Shut Down: only events columns are written", async () => {
  const related = {
    event_occurrences: [{ id: "o1", event_id: id(1), location_id: "loc", details: "Lineup" }],
    event_businesses: [{ event_id: id(1), business_id: "b", featured: true }],
    event_categories: [{ event_id: id(1), category_id: "c" }],
  };
  const db = fakeDb("events", [ev(1)], { related });
  const before = JSON.stringify(related);
  await EV.transitionEvents(db, [id(1)], "hide");
  await EV.transitionEvents(db, [id(1)], "shutdown");
  assert.equal(JSON.stringify({ event_occurrences: db.tables.event_occurrences, event_businesses: db.tables.event_businesses, event_categories: db.tables.event_categories }), before);
  assert.ok(db.writes.every((w) => w.table === "events"));
  const src = read("src/lib/admin/event-lifecycle.ts");
  assert.doesNotMatch(src, /\.delete\(|event_occurrences"\)|event_businesses"\)|insert\(/);
});

test("E11 & E12. partial Event failure is reported; failed ids stay identifiable for retry", async () => {
  const db = fakeDb("events", [ev(1), ev(2), ev(3)], { failIds: [id(3)] });
  const r = await EV.transitionEvents(db, [id(1), id(2), id(3)], "hide");
  assert.deepEqual([r.changed, r.failed], [[id(1), id(2)], [id(3)]]);
  assert.equal(EV.describeEventTransition(r), "2 Events Unpublished · 1 Failed — still selected, try again");
  const err = await EV.transitionEvents(fakeDb("events", [ev(1)], { updateError: true }), [id(1)], "hide");
  assert.deepEqual(err.failed, [id(1)]);
});

test("E13. Event bulk actions require the Admin session; ids validated server-side", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await EVA.bulkTransitionEvents([id(1)], "hide"), { ok: false, error: "Your Admin session has ended. Sign in again." });
  globalThis.__ADMIN = fakeDb("events", [ev(1)]);
  assert.equal((await EVA.bulkTransitionEvents(["x", 3], "hide")).ok, false);
  assert.equal((await EVA.bulkTransitionEvents([id(1)], "delete")).ok, false, "unknown op refused");
  globalThis.__REVALIDATED = [];
  const ok = await EVA.bulkTransitionEvents([id(1), id(1)], "hide");
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result.changed, [id(1)]);
  assert.ok(globalThis.__REVALIDATED.some((a) => a[0] === "/event/ev-1"));
  globalThis.__ADMIN = undefined;
});

// ── BUSINESSES ──────────────────────────────────────────────────────────

function notifier() {
  const sent = [];
  return { sent, fn: async (_c, bid, name, outcome) => void sent.push([bid, outcome]) };
}

test("B14 & B15. Pending Review → bulk Approve (live, owners notified); mixed selection idempotent", async () => {
  const db = fakeDb("businesses", [...[1, 2, 3].map((n) => biz(n)), biz(4, { publication_status: "live" }), biz(5, { publication_status: "live" })]);
  const n = notifier();
  const r = await BZ.transitionBusinesses(db, [1, 2, 3, 4, 5].map(id), "approve", n.fn);
  assert.deepEqual(r.changed, [id(1), id(2), id(3)]);
  assert.deepEqual(r.already, [id(4), id(5)]);
  assert.equal(BZ.describeBusinessTransition(r), "3 Businesses Approved · 2 Already Published");
  assert.deepEqual(n.sent, [[id(1), "live"], [id(2), "live"], [id(3), "live"]], "never re-notified for already-Active rows");
  assert.deepEqual(db.writes.map((w) => w.patch), [{ publication_status: "live" }]);
  assert.equal(EL.businessBadge(find(db, "businesses", 1)).label, "Published");
});

test("B16 & B17. Active → Pause; Paused → Resume; other states skipped (never a pending one paused)", async () => {
  const db = fakeDb("businesses", [biz(1, { publication_status: "live" }), biz(2, { publication_status: "pending_review" }), biz(3, { publication_status: "paused" })]);
  const n = notifier();
  const p = await BZ.transitionBusinesses(db, [id(1), id(2), id(3)], "pause", n.fn);
  assert.deepEqual([p.changed, p.notApplicable, p.already], [[id(1)], [id(2)], [id(3)]]);
  assert.equal(find(db, "businesses", 2).publication_status, "pending_review");
  const res = await BZ.transitionBusinesses(db, [id(1), id(3)], "resume", n.fn);
  assert.deepEqual(res.changed, [id(1), id(3)]);
  assert.deepEqual(n.sent.map((s) => s[1]), ["paused", "restored", "restored"]);
});

test("Reject is the EXISTING rejection state (pending_review → rejected), never a new one", async () => {
  const db = fakeDb("businesses", [biz(1), biz(2, { publication_status: "live" })]);
  const n = notifier();
  const r = await BZ.transitionBusinesses(db, [id(1), id(2)], "reject", n.fn);
  assert.deepEqual([r.changed, r.notApplicable], [[id(1)], [id(2)]]);
  assert.equal(find(db, "businesses", 1).publication_status, "rejected");
  assert.equal(EL.businessBadge(find(db, "businesses", 1)).label, "Rejected");
  assert.deepEqual(n.sent, [[id(1), "rejected"]]);
});

test("B18 & B19. Archive / Trash keep their existing actions; archived / trashed rows are skipped by transitions", async () => {
  const db = fakeDb("businesses", [biz(1, { archived_at: "x" }), biz(2, { trashed_at: "y" })]);
  const r = await BZ.transitionBusinesses(db, [id(1), id(2)], "approve", notifier().fn);
  assert.deepEqual(r.inactive, [id(1), id(2)]);
  assert.equal(db.writes.length, 0);
  const actions = read("src/app/admin/(protected)/businesses/lifecycle-actions.ts");
  assert.match(actions, /export async function bulkArchiveBusinesses[\s\S]*?\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(actions, /export async function bulkTrashBusinesses[\s\S]*?\.update\(\{ trashed_at: new Date\(\)\.toISOString\(\) \}\)/);
  const bar = read("src/app/admin/(protected)/businesses/BusinessBulkActionBar.tsx");
  assert.match(bar, /\{ key: "archive", label: "Archive", tone: "secondary", action: bulkArchiveBusinesses \}/);
  assert.match(bar, /\{ key: "trash", label: "Move To Trash", tone: "destructive", action: bulkTrashBusinesses, confirm:/);
});

test("B20–B22. ownership, memberships, Events, Appearances, Locations and Pro / billing are untouched", async () => {
  const related = {
    business_members: [{ business_id: id(1), user_id: "u", role: "owner" }],
    business_locations: [{ business_id: id(1), location_id: "l" }],
    event_businesses: [{ business_id: id(1), event_id: "e" }],
    appearances: [{ business_id: id(1), id: "a" }],
  };
  const db = fakeDb("businesses", [biz(1)], { related });
  const before = JSON.stringify(related);
  for (const op of ["approve", "pause", "resume"]) await BZ.transitionBusinesses(db, [id(1)], op, notifier().fn);
  assert.equal(JSON.stringify({ business_members: db.tables.business_members, business_locations: db.tables.business_locations, event_businesses: db.tables.event_businesses, appearances: db.tables.appearances }), before);
  assert.equal(find(db, "businesses", 1).plan_tier, "pro");
  assert.ok(db.writes.every((w) => w.table === "businesses" && Object.keys(w.patch).join() === "publication_status"), "only publication_status");
  assert.doesNotMatch(read("src/lib/admin/business-lifecycle.ts"), /plan_tier|stripe|is_demo:|verified|\.delete\(|business_members"\)/);
});

test("B23 & B24. partial Business failure is reported and only confirmed rows notified; failed stay retryable", async () => {
  const db = fakeDb("businesses", [biz(1), biz(2)], { failIds: [id(2)] });
  const n = notifier();
  const r = await BZ.transitionBusinesses(db, [id(1), id(2)], "approve", n.fn);
  assert.deepEqual([r.changed, r.failed], [[id(1)], [id(2)]]);
  assert.equal(BZ.describeBusinessTransition(r), "1 Business Approved · 1 Failed — still selected, try again");
  assert.deepEqual(n.sent, [[id(1), "live"]]);
  const thrown = await BZ.transitionBusinesses(fakeDb("businesses", [biz(1)]), [id(1)], "approve", async () => {
    throw new Error("resend down");
  });
  assert.deepEqual(thrown.changed, [id(1)], "a notification failure never undoes a committed decision");
});

test("B25. Business bulk actions require the Admin session; ids validated server-side", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await BZA.bulkTransitionBusinesses([id(1)], "approve"), { ok: false, error: "Your Admin session has ended. Sign in again." });
  globalThis.__ADMIN = fakeDb("businesses", [biz(1)]);
  assert.equal((await BZA.bulkTransitionBusinesses(["nope"], "approve")).ok, false);
  assert.equal((await BZA.bulkTransitionBusinesses([id(1)], "publish_everything")).ok, false);
  globalThis.__ADMIN = undefined;
});

// ── SHARED ──────────────────────────────────────────────────────────────

test("S26. Select All Visible stays bounded to the rendered rows (shared AdminBulkList)", () => {
  const list = read("src/components/admin/AdminBulkList.tsx");
  assert.match(list, /setSelected\(allSelected \? new Set\(\) : new Set\(items\.map\(\(i\) => i\.id\)\)\)/);
  assert.match(list, /const visible = new Set\(items\.map\(\(i\) => i\.id\)\);/);
  for (const f of ["src/app/admin/(protected)/events/EventBulkListClient.tsx", "src/app/admin/(protected)/businesses/BusinessBulkListClient.tsx"]) {
    assert.match(read(f), /<AdminBulkList/);
    assert.match(read(f), /selectedRows=\{\w+\.filter\(\(\w\) => selectedIds\.includes\(\w\.id\)\)\}/, f);
  }
});

test("S27. eligibility rules are shared by the server helpers and the toolbar counts (no drift)", () => {
  assert.match(read("src/lib/admin/event-lifecycle.ts"), /const c = eventEligibility\(op, row\);/);
  assert.match(read("src/lib/admin/business-lifecycle.ts"), /const c = businessEligibility\(op, row\);/);
  assert.match(read("src/app/admin/(protected)/events/EventBulkActionBar.tsx"), /eventEligibility\(op, r\) === "change"/);
  assert.match(read("src/app/admin/(protected)/businesses/BusinessBulkActionBar.tsx"), /businessEligibility\(op, r\) === "change"/);
  assert.equal(EL.businessEligibility("approve", { publication_status: "live" }), "already");
  assert.equal(EL.eventEligibility("hide", { is_demo: true }), "already");
});

test("S28. existing Quick Edit (Events: Category + Featured; Businesses: existing fields) still posts to the same actions", () => {
  const eb = read("src/app/admin/(protected)/events/EventBulkActionBar.tsx");
  assert.match(eb, /action=\{bulkQuickEditEvents\}/);
  assert.match(eb, /name="apply_category"/);
  assert.match(eb, /name="apply_featured"/);
  assert.match(read("src/app/admin/(protected)/businesses/BusinessBulkActionBar.tsx"), /action=\{bulkQuickEditBusinesses\}/);
});

test("S29. phone toolbar: the shared responsive pattern (2-col grid of ≥40px pills, sm row)", () => {
  const t = read("src/components/admin/BulkLifecycleToolbar.tsx");
  assert.match(t, /export const pillClass = "flex min-h-10 items-center justify-center rounded-full/);
  assert.match(t, /className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"/);
  assert.match(t, /const visible = transitions\.filter\(\(t\) => count === 0 \|\| t\.eligible > 0\);/, "impossible actions hide for the current selection");
  assert.match(t, /keepSelected\?\.\(r\.result\.failed\);/);
  assert.match(t, /\/\/ No optimistic success/);
  for (const f of ["src/app/admin/(protected)/events/EventBulkActionBar.tsx", "src/app/admin/(protected)/businesses/BusinessBulkActionBar.tsx"]) assert.match(read(f), /<BulkLifecycleToolbar/, f);
});

test("S30. single-record and bulk controls use the SAME lifecycle helper", () => {
  const ea = read("src/app/admin/(protected)/events/lifecycle-actions.ts");
  assert.match(ea, /const r = await transitionEvents\(supabase, \[eventId\], op\);/);
  assert.match(ea, /const result = await transitionEvents\(supabase, clean, op\);/);
  const ba = read("src/app/admin/(protected)/businesses/actions.ts");
  for (const [fn, op] of [["approveBusinessListing", "approve"], ["rejectBusinessListing", "reject"], ["pauseBusinessListing", "pause"], ["restoreBusinessListing", "resume"]]) {
    assert.match(ba, new RegExp(`export async function ${fn}[\\s\\S]*?await decideOne\\(id, "${op}"`), fn);
  }
  assert.match(ba, /const r = await transitionBusinesses\(supabase, \[id\], op\);/);
  assert.doesNotMatch(ba, /async function notifyBusinessOwners/, "moved, not duplicated");
  const bla = read("src/app/admin/(protected)/businesses/lifecycle-actions.ts");
  assert.match(bla, /export async function bulkPauseBusinesses\(formData: FormData\) \{\n\s+await formTransition\(formData, "pause"\);/);
  assert.match(bla, /const result = await transitionBusinesses\(supabase, clean, op\);/);
});

test("row badges come from existing columns only", () => {
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "pending_review" }).label, "Needs Review");
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "paused" }).label, "Paused");
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "live", archived_at: "x" }).label, "Archived");
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "live", trashed_at: "x" }).label, "Trashed");
  assert.equal(EL.businessBadge({ is_demo: true, publication_status: "live" }).label, "Demo");
  assert.equal(EL.businessBadge({ is_demo: false, publication_status: "draft" }).label, "Draft", "draft no longer shows as Public");
  assert.deepEqual(Object.values(PUB.EVENT_VISIBILITY_LABEL), ["Published", "Draft", "Archived", "Trashed"]);
});
