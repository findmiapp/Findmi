// Pass 2 Block A — Placement Core (business_location_placements): domain rules, server
// reads/writes against an in-memory fake client, privacy of internal_notes, the Add Target
// place paths, the migration, and that accepted Pass 1 Find Us Here wiring is unchanged.
// No network, no database.
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

const D = await import("../src/lib/business-placements-domain.ts");
const L = await import("../src/lib/business-placements.ts");
const PLACE = await import("../src/lib/places/inline-place.ts");
const ELIG = await import("../src/lib/location-eligibility.ts");
const AUDIT = await import("../src/lib/brand-audit-domain.ts");
const read = (p) => readFileSync(p, "utf8");

// ── In-memory fake of the service-role client ──────────────────────────────

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOC_1 = "11111111-1111-4111-8111-111111111111";
const LOC_2 = "22222222-2222-4222-8222-222222222222";
const LOC_OURS = "33333333-3333-4333-8333-333333333333";
const LOC_ARCH = "44444444-4444-4444-8444-444444444444";
const LOC_NEW = "55555555-5555-4555-8555-555555555555";
const P_A1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P_A2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const P_B1 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const USER_1 = "99999999-9999-4999-8999-999999999999";
const MEMBER = { actor: "business", userId: USER_1 };

function seed() {
  const loc = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), address: "1 Main St", city: "Jersey City", state: "NJ", postal_code: "07302", logo_url: null, cover_image_url: null, is_demo: false, archived_at: null, trashed_at: null, ...extra });
  const row = (id, business_id, location_id, status, extra = {}) => ({
    id, business_id, location_id, status, status_changed_at: "2026-10-20T10:00:00.000Z", notes: null, internal_notes: "FINDMI SECRET " + id, next_action: null, next_action_at: null, source: "business", created_by_user_id: null, created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z", ...extra,
  });
  return {
    locations: [loc(LOC_1, "Hidden Grounds Coffee"), loc(LOC_2, "Modcup Coffee", { is_demo: true }), loc(LOC_OURS, "Our Shop"), loc(LOC_ARCH, "Gone Cafe", { archived_at: "2026-01-01T00:00:00Z" })],
    business_locations: [{ id: "bl1", business_id: BIZ_A, location_id: LOC_OURS }],
    business_location_placements: [row(P_A1, BIZ_A, LOC_1, "in_conversation", { notes: "Met the owner", next_action: "Drop samples", next_action_at: "2026-10-30" }), row(P_A2, BIZ_A, LOC_2, "passed"), row(P_B1, BIZ_B, LOC_1, "target")],
  };
}

function fakeDb(tables, { insertError = null } = {}) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const call = { table, select: null, filters: [], op: "select", payload: null, ors: [] };
      calls.push(call);
      const preds = [];
      let single = null;
      let head = false;
      let countMode = null;
      let returning = false;
      const chain = {
        select(cols, opts) {
          if (call.op === "select") call.select = cols;
          else returning = true;
          countMode = opts?.count ?? null;
          head = Boolean(opts?.head);
          return chain;
        },
        eq(c, v) { call.filters.push(`eq ${c}=${v}`); preds.push((r) => r[c] === v); return chain; },
        is(c, v) { call.filters.push(`is ${c}=${v}`); preds.push((r) => (r[c] ?? null) === v); return chain; },
        or(expr, opts) { call.ors.push({ expr, opts }); return chain; },
        in(c, vals) { call.filters.push(`in ${c}`); preds.push((r) => vals.includes(r[c])); return chain; },
        order() { return chain; },
        range() { return chain; },
        limit() { return chain; },
        insert(payload) { call.op = "insert"; call.payload = payload; return chain; },
        update(payload) { call.op = "update"; call.payload = payload; return chain; },
        maybeSingle() { single = "maybe"; return chain; },
        single() { single = "one"; return chain; },
        then(resolve) {
          const rows = tables[table] ?? [];
          const join = (r) => (table === "business_location_placements" && call.select?.includes("locations!inner") ? { ...r, locations: tables.locations.find((l) => l.id === r.location_id) ?? null } : r);
          const project = (r) => {
            if (!call.select || call.select === "*") return { ...r };
            const out = {};
            for (const raw of call.select.split(/,(?![^(]*\))/)) {
              const k = raw.trim().split("(")[0].replace(/!inner$/, "").split(":")[0];
              if (k in r) out[k] = r[k];
            }
            return out;
          };
          if (call.op === "insert") {
            if (insertError) return resolve({ data: null, error: insertError });
            const dup = rows.find((r) => r.business_id === call.payload.business_id && r.location_id === call.payload.location_id);
            if (table === "business_location_placements" && dup) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            const created = { id: LOC_NEW, status: "target", ...call.payload };
            (tables[table] ??= []).push(created);
            return resolve({ data: { ...created }, error: null });
          }
          const matched = rows.filter((r) => preds.every((p) => p(r)));
          if (call.op === "update") {
            for (const r of matched) Object.assign(r, call.payload);
            return resolve({ data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null });
          }
          if (head) return resolve({ data: null, count: matched.length, error: null });
          const data = matched.map((r) => project(join(r)));
          if (single) return resolve({ data: data[0] ?? null, error: null });
          return resolve({ data, count: countMode === "exact" ? data.length : null, error: null });
        },
      };
      return chain;
    },
  };
  return db;
}

// ── Domain ─────────────────────────────────────────────────────────────────

test("statuses are exactly the approved five, with Title Case labels", () => {
  assert.deepEqual([...D.PLACEMENT_STATUSES], ["target", "in_conversation", "placement_pending", "active", "passed"]);
  assert.deepEqual(Object.values(D.PLACEMENT_STATUS_LABELS), ["Target", "In Conversation", "Placement Pending", "Active", "Passed"]);
  assert.equal(D.isPlacementStatus("pending"), false, "never a bare 'pending' (Find Us Here's moderation status)");
});

test("any status can move to any other — including reopening Passed as Target", () => {
  for (const a of D.PLACEMENT_STATUSES) for (const b of D.PLACEMENT_STATUSES) assert.equal(D.canChangePlacementStatus(a, b), true);
  assert.equal(D.canChangePlacementStatus("passed", "bogus"), false);
});

test("validation: status required, text trimmed/limited, dates must be real calendar dates", () => {
  assert.equal(D.validatePlacementUpdate({ status: "nope" }).ok, false);
  const ok = D.validatePlacementUpdate({ status: "active", notes: "  hi  ", nextAction: "  Call   buyer ", nextActionAt: "2026-11-05" });
  assert.deepEqual(ok, { ok: true, value: { status: "active", notes: "hi", next_action: "Call buyer", next_action_at: "2026-11-05" } });
  assert.deepEqual(D.validatePlacementUpdate({ status: "target", notes: "   ", nextAction: "", nextActionAt: "" }).value, { status: "target", notes: null, next_action: null, next_action_at: null });
  assert.equal(D.validatePlacementUpdate({ status: "target", nextActionAt: "2026-02-30" }).ok, false);
  assert.equal(D.validatePlacementUpdate({ status: "target", nextActionAt: "11/05/2026" }).ok, false);
  assert.equal(D.validatePlacementUpdate({ status: "target", notes: "x".repeat(2001) }).ok, false);
  assert.equal(D.validatePlacementUpdate({ status: "target", nextAction: "x".repeat(501) }).ok, false);
  assert.equal(D.validateInternalNotes("x".repeat(2001)).ok, false);
});

test("a Business edit can never carry internal_notes, source or identity columns", () => {
  const v = D.validatePlacementUpdate({ status: "active", notes: "n", internal_notes: "hack", internalNotes: "hack", source: "admin", business_id: BIZ_B, location_id: LOC_2 });
  assert.deepEqual(Object.keys(v.value).sort(), ["next_action", "next_action_at", "notes", "status"]);
});

test("permissions: owner/manager edit, staff read-only, founder Admin manages", () => {
  assert.equal(D.canEditPlacements("owner"), true);
  assert.equal(D.canEditPlacements("manager"), true);
  assert.equal(D.canEditPlacements("staff"), false);
  assert.equal(D.canEditPlacements(null), false);
  assert.equal(D.canEditPlacements("staff", true), true);
});

test("filters are parsed from untrusted URL params", () => {
  assert.deepEqual(D.parsePlacementFilter({ q: "  Joe's, (Cafe) %  ", status: "active" }), { q: "Joe's Cafe", status: "active" });
  assert.deepEqual(D.parsePlacementFilter({ q: 5, status: "pending" }), D.EMPTY_PLACEMENT_FILTER);
  assert.equal(D.parsePlacementFilter({ q: "x".repeat(200) }).q.length, 60);
});

test("placementChanges is empty for a no-op save and lists only what changed", () => {
  const cur = { status: "target", notes: "a", next_action: null, next_action_at: null };
  assert.deepEqual(D.placementChanges(cur, { status: "target", notes: "a", next_action: null, next_action_at: null }), {});
  assert.deepEqual(D.placementChanges(cur, { status: "active", notes: "a", next_action: "x", next_action_at: null }), { status: "active", next_action: "x" });
});

// ── Reads: scoping and internal_notes isolation ────────────────────────────

test("Business reads never select internal_notes, and items carry no internal-notes field", async () => {
  assert.doesNotMatch(L.BUSINESS_PLACEMENT_COLUMNS, /internal/);
  const db = fakeDb(seed());
  const page = await L.getBusinessPlacementsPage(db, BIZ_A, D.EMPTY_PLACEMENT_FILTER, 1);
  assert.equal(page.available, true);
  assert.equal(page.items.length, 2, "only this Business's rows");
  assert.deepEqual(page.counts, { all: 2, target: 0, in_conversation: 1, placement_pending: 0, active: 0, passed: 1 });
  const json = JSON.stringify(page);
  assert.doesNotMatch(json, /FINDMI SECRET|internal/i);
  for (const c of db.calls.filter((c) => c.table === "business_location_placements")) {
    assert.ok(c.filters.includes(`eq business_id=${BIZ_A}`), "every read is scoped to the Business");
    assert.doesNotMatch(c.select ?? "", /internal_notes/);
  }
  const one = await L.getBusinessPlacement(db, BIZ_A, P_A1);
  assert.equal(one.locationName, "Hidden Grounds Coffee");
  assert.equal(one.nextAction, "Drop samples");
  assert.doesNotMatch(JSON.stringify(one), /FINDMI SECRET|internal/i);
});

test("one Business can never open another Business's Target", async () => {
  const db = fakeDb(seed());
  assert.equal(await L.getBusinessPlacement(db, BIZ_A, P_B1), null);
  assert.equal(await L.getBusinessPlacement(db, BIZ_A, "not-a-uuid"), null);
  const res = await L.updateBusinessPlacement(db, BIZ_A, P_B1, { status: "active" }, MEMBER);
  assert.equal(res.ok, false);
  assert.equal(seed().business_location_placements.find((r) => r.id === P_B1).status, "target");
});

test("search filters by status and Location text in the database", async () => {
  const db = fakeDb(seed());
  await L.getBusinessPlacementsPage(db, BIZ_A, { q: "coffee", status: "passed" }, 1);
  const list = db.calls.find((c) => c.table === "business_location_placements" && c.select === L.BUSINESS_PLACEMENT_COLUMNS);
  assert.ok(list.filters.includes("eq status=passed"));
  assert.deepEqual(list.ors[0], { expr: "name.ilike.%coffee%,city.ilike.%coffee%,address.ilike.%coffee%", opts: { referencedTable: "locations" } });
});

test("before the migration is applied the view fails safe (available: false)", async () => {
  const fail = () => {
    const c = { select: () => c, eq: () => c, or: () => c, order: () => c, range: () => c, then: (r) => r({ data: null, count: null, error: { code: "42P01", message: "relation \"business_location_placements\" does not exist" } }) };
    return c;
  };
  const page = await L.getBusinessPlacementsPage({ from: fail }, BIZ_A, D.EMPTY_PLACEMENT_FILTER, 1);
  assert.equal(page.available, false);
});

// ── Adds: unique Business + Location, reopen, collisions ───────────────────

test("adding a new place creates one Target (status target, source recorded)", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await L.addBusinessPlacement(db, BIZ_B, { locationId: LOC_2, source: "admin", userId: null });
  assert.equal(res.ok, true);
  assert.equal(res.existing, false);
  const ins = db.calls.find((c) => c.op === "insert");
  assert.deepEqual(ins.payload, { business_id: BIZ_B, location_id: LOC_2, status: "target", source: "admin", created_by_user_id: null });
  assert.ok(!("internal_notes" in ins.payload));
});

test("adding a place already in the pipeline returns the existing Target — never a duplicate (Passed included)", async () => {
  const t = seed();
  const db = fakeDb(t);
  const again = await L.addBusinessPlacement(db, BIZ_A, { locationId: LOC_2, source: "business", userId: null });
  assert.deepEqual(again, { ok: true, id: P_A2, existing: true, status: "passed" });
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
  assert.equal(t.business_location_placements.filter((r) => r.business_id === BIZ_A && r.location_id === LOC_2).length, 1);
});

test("a concurrent duplicate insert (unique violation) resolves to the existing row", async () => {
  const t = seed();
  // The pre-check misses (row appears between check and insert): simulate by hiding the row from the first read.
  let reads = 0;
  const db = fakeDb(t);
  const wrapped = {
    from(table) {
      const c = db.from(table);
      if (table !== "business_location_placements") return c;
      const origThen = c.then;
      c.then = (resolve) => (c && reads++ === 0 ? resolve({ data: null, error: null }) : origThen(resolve));
      return c;
    },
  };
  t.business_location_placements.push({ id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0", business_id: BIZ_B, location_id: LOC_2, status: "target" });
  const res = await L.addBusinessPlacement(wrapped, BIZ_B, { locationId: LOC_2, source: "business", userId: null });
  assert.deepEqual(res, { ok: true, id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0", existing: true, status: "target" });
});

test("one of the Business's own Locations, an archived place or a bad id cannot be a Target", async () => {
  const db = fakeDb(seed());
  assert.deepEqual(await L.addBusinessPlacement(db, BIZ_A, { locationId: LOC_OURS, source: "business", userId: null }), { ok: false, error: L.ALREADY_OUR_LOCATION_TARGET_ERROR });
  assert.equal((await L.addBusinessPlacement(db, BIZ_A, { locationId: LOC_ARCH, source: "business", userId: null })).ok, false);
  assert.equal((await L.addBusinessPlacement(db, BIZ_A, { locationId: "x", source: "business", userId: null })).ok, false);
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
});

// ── Edits ──────────────────────────────────────────────────────────────────

test("an edit writes only the changed Business fields; reopening Passed is status → target on the same row", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await L.updateBusinessPlacement(db, BIZ_A, P_A2, { status: "target", notes: null, nextAction: null, nextActionAt: null, internal_notes: "hack", internalNotes: "hack" }, MEMBER);
  assert.deepEqual(res, { ok: true, changed: true });
  const upd = db.calls.find((c) => c.op === "update");
  // A status change carries its actor in the SAME update (the trigger records Activity and clears it).
  assert.deepEqual(upd.payload, { status: "target", status_actor: "business", status_actor_user_id: USER_1 });
  assert.ok(upd.filters.includes(`eq business_id=${BIZ_A}`));
  const row = t.business_location_placements.find((r) => r.id === P_A2);
  assert.equal(row.status, "target");
  assert.equal(row.internal_notes, "FINDMI SECRET " + P_A2, "internal notes untouched");
  assert.equal(t.business_location_placements.length, 3, "no new row");
});

test("a save that changes nothing is a no-op", async () => {
  const db = fakeDb(seed());
  const res = await L.updateBusinessPlacement(db, BIZ_A, P_A1, { status: "in_conversation", notes: "Met the owner", nextAction: "Drop samples", nextActionAt: "2026-10-30" }, MEMBER);
  assert.deepEqual(res, { ok: true, changed: false });
  assert.equal(db.calls.filter((c) => c.op === "update").length, 0);
});

test("Findmi-only notes: read and written only by the admin functions, scoped to the Business", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.equal(await L.adminGetPlacementInternalNotes(db, BIZ_A, P_A1), "FINDMI SECRET " + P_A1);
  assert.equal(await L.adminGetPlacementInternalNotes(db, BIZ_A, P_B1), null, "never across Businesses");
  assert.deepEqual(await L.adminSetPlacementInternalNotes(db, BIZ_A, P_A1, "  managed by Findmi "), { ok: true });
  assert.deepEqual(db.calls.find((c) => c.op === "update").payload, { internal_notes: "managed by Findmi" });
  assert.equal((await L.adminSetPlacementInternalNotes(db, BIZ_A, P_B1, "x")).ok, false);
});

// ── Add Target: existing places and the new-place path ─────────────────────

test("the Target picker searches every linkable place — published and not-yet-public — never archived/trashed", async () => {
  const db = fakeDb(seed());
  const found = await L.searchTargetLocations(db, "coffee");
  const call = db.calls.find((c) => c.table === "locations");
  assert.ok(call.filters.includes("is archived_at=null") && call.filters.includes("is trashed_at=null"));
  assert.ok(!call.filters.some((f) => f.startsWith("eq is_demo")), "unlisted places stay linkable");
  assert.equal(call.ors[0].expr, "name.ilike.%coffee%,city.ilike.%coffee%,address.ilike.%coffee%");
  assert.deepEqual(found.map((f) => [f.name, f.is_public]), [["Hidden Grounds Coffee", true], ["Modcup Coffee", false], ["Our Shop", true]]);
});

test("new place: the shared inline-place workflow offers existing matches first (duplicate detection)", async () => {
  const db = fakeDb(seed());
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "Hidden Grounds Coffee", address: "1 Main Street", city: "Jersey City", state: "NJ", postal_code: "07302" })) fd.set(k, v);
  const res = await PLACE.insertInlinePlace(db, fd);
  assert.equal(res.status, "duplicates");
  assert.equal(res.duplicates[0].id, LOC_1);
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
});

test("new place: created unlisted (is_demo) with no membership — usable as a Target, never consumer-discoverable", async () => {
  const t = seed();
  const db = fakeDb(t);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "URBY Jersey City", address: "200 Greene St", city: "Jersey City", state: "NJ", postal_code: "07311" })) fd.set(k, v);
  const res = await PLACE.insertInlinePlace(db, fd);
  assert.equal(res.status, "created");
  const ins = db.calls.find((c) => c.op === "insert" && c.table === "locations");
  assert.equal(ins.payload.is_demo, true);
  assert.equal(db.calls.filter((c) => /members|business_locations/.test(c.table) && c.op === "insert").length, 0);
  assert.equal(ELIG.isLocationDiscoverable(ins.payload), false);
  // …and that new canonical Location is attached as a Target like any picked place.
  const added = await L.addBusinessPlacement(db, BIZ_A, { locationId: res.location.id, source: "business", userId: null });
  assert.equal(added.ok, true);
});

test("Add Target's create action reuses the shared inline-place workflow behind Business-scoped authorization", () => {
  const src = read("src/app/(public)/account/business/[id]/placement-actions.ts");
  assert.match(src, /export async function createTargetPlaceAction[\s\S]*?authorizeWrite\(businessId\)[\s\S]*?insertInlinePlace\(admin, formData\)/);
  assert.doesNotMatch(src, /from\("locations"\)\.insert/, "never a separate place insert");
  assert.match(src, /canEditPlacements\(membership\.role, membership\.viaAdmin\)/);
  // Only the four Business fields reach the update.
  assert.match(src, /updateBusinessPlacement\(\s*admin,\s*businessId,\s*placementId,\s*\{\s*status: input\?\.status,\s*notes: input\?\.notes,\s*nextAction: input\?\.nextAction,\s*nextActionAt: input\?\.nextActionAt,\s*\},\s*await actingAs\(auth\.viaAdmin\)\s*\)/);
  // Internal notes require a founder Admin session, never membership.
  assert.match(src, /export async function saveTargetInternalNotesAction[\s\S]*?if \(!\(await isAdminSession\(\)\)\) return/);
  const picker = read("src/components/places/PlaceFindOrCreate.tsx");
  assert.match(picker, /useResults = usePlaceResults/, "existing picker callers keep the account search");
});

test("the Manager page reads internal notes only for a founder Admin session and only for the open relationship workspace", () => {
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /const findmiAdmin = Boolean\(data\.placement\) && \(isAdminElevated \|\| \(await isAdminSession\(\)\)\);/);
  assert.match(page, /data\.placement && findmiAdmin \? adminGetPlacementInternalNotes\(admin, id, data\.placement\.id\) : null,/);
  assert.match(page, /canEdit=\{canEditPlacements\(membershipRole, isAdminElevated\)\}/);
  const view = read("src/app/(public)/account/business/[id]/v2/RelationshipWorkspace.tsx");
  assert.match(view, /\{placement && props\.isFindmiAdmin && <InternalNotes /);
});

// ── Pass 1 Find Us Here unchanged ──────────────────────────────────────────

test("Places and By Market keep their exact links; Targets is an added third view", () => {
  const sw = read("src/app/(public)/account/business/[id]/v2/MarketFootprintView.tsx");
  assert.match(sw, /item\("places", "Places", `\$\{basePath\}\?tab=findmi-here&view=find-us`\)/);
  assert.match(sw, /item\("markets", "By Market", `\$\{basePath\}\?tab=findmi-here&view=find-us&fv=markets`\)/);
  assert.match(sw, /item\("targets", "Targets", `\$\{basePath\}\?tab=findmi-here&view=find-us&fv=targets`\)/);
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /const onFindUsPlaces = onFindUs && !onFindUsMarkets && !onFindUsTargets;/);
  assert.match(page, /whenP\(onFindUsPlaces, \(\) => getOwnerAvailabilityPage\(admin, id, findUsFilter/);
  // Placements never write Find Us Here.
  for (const f of ["src/lib/business-placements.ts", "src/app/(public)/account/business/[id]/placement-actions.ts"]) {
    assert.doesNotMatch(read(f), /business_location_availability/);
  }
});

// ── Migrations ─────────────────────────────────────────────────────────────

test("placements migration: additive, server-only, unique pair, status list mirrors the domain", () => {
  const body = read("supabase/migrations/20261102000000_business_location_placements.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(body, /\bdrop\s+table|\bdelete\s+from|\btruncate\b|\bupdate\s+public\.|\balter\s+table\s+public\.(?!business_location_placements)/i);
  assert.doesNotMatch(body, /create\s+policy/i);
  assert.match(body, /alter table public\.business_location_placements enable row level security;/);
  assert.match(body, /revoke all on public\.business_location_placements from public, anon, authenticated;/);
  assert.match(body, /grant select, insert, update, delete on public\.business_location_placements to service_role;/);
  assert.doesNotMatch(body, /grant[^;]*to (anon|authenticated)/i);
  assert.match(body, /unique \(business_id, location_id\)/);
  assert.ok(body.includes(`check (status in (${D.PLACEMENT_STATUSES.map((s) => `'${s}'`).join(", ")}))`));
  assert.ok(body.includes(`check (source in (${D.PLACEMENT_SOURCES.map((s) => `'${s}'`).join(", ")}))`));
  for (const col of ["status_changed_at", "notes", "internal_notes", "next_action", "next_action_at", "created_by_user_id", "updated_at"]) assert.match(body, new RegExp(`\\n  ${col}\\s`));
  for (const col of ["market_id", "priority", "assignee", "opportunity", "availability_id"]) assert.doesNotMatch(body, new RegExp(`\\n  ${col}`), `${col} is not stored`);
});

test("goal migration: increase_distribution added to the existing Growth goals; every other list unchanged (strict superset)", () => {
  const lists = (sql) => Object.fromEntries([...sql.matchAll(/kind = '([a-z_]+)' and option_key in \(([^)]*)\)/g)].map((m) => [m[1], m[2].split(",").map((s) => s.trim().replace(/'/g, ""))]));
  const before = lists(read("supabase/migrations/20261023000000_brand_intelligence_v1_2.sql"));
  const after = lists(read("supabase/migrations/20261102010000_growth_goal_increase_distribution.sql"));
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const k of Object.keys(before)) {
    for (const key of before[k]) assert.ok(after[k].includes(key), `${k}:${key} kept`);
    const added = after[k].filter((x) => !before[k].includes(x));
    assert.deepEqual(added, k === "goal" ? ["increase_distribution"] : []);
  }
  assert.deepEqual(after.goal, [...AUDIT.AUDIT_GOALS]);
  assert.equal(AUDIT.AUDIT_GOAL_OPTIONS.increase_distribution.label, "Increase Distribution");
  assert.equal(AUDIT.AUDIT_GOAL_OPTIONS.retail_trial.label, "Grow Retail Presence", "Grow Retail Presence stays separate");
});
