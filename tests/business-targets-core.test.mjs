// Cross-Entity Target Foundation (business_targets): canonical intents and their
// compatibility, domain rules, server reads/writes against an in-memory fake client
// (Place, Business and Event Targets), privacy (internal notes; the counterparty never
// sees it), no side effects, the two lenses, the migration + backfill, and that Pass 1
// Find Us Here wiring is unchanged. Ported from Pass 2 Block A's Placement Core.
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

const D = await import("../src/lib/business-targets-domain.ts");
const L = await import("../src/lib/business-targets.ts");
const I = await import("../src/lib/commercial-intents.ts");
const PLACE = await import("../src/lib/places/inline-place.ts");
const ELIG = await import("../src/lib/location-eligibility.ts");
const AUDIT = await import("../src/lib/brand-audit-domain.ts");
const read = (p) => readFileSync(p, "utf8");
const MIGRATION = "supabase/migrations/20261106000000_business_targets.sql";
const V2 = "src/app/(public)/account/business/[id]/v2";
const ACTIONS = "src/app/(public)/account/business/[id]/target-actions.ts";

// ── In-memory fake of the service-role client ──────────────────────────────

const MOCKTAIL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BABYLIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT_BIZ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SODA_CO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOC_SOHO = "11111111-1111-4111-8111-111111111111";
const LOC_UNLISTED = "22222222-2222-4222-8222-222222222222";
const LOC_OURS = "33333333-3333-4333-8333-333333333333";
const LOC_ARCH = "44444444-4444-4444-8444-444444444444";
const EVT_MARKET = "66666666-6666-4666-8666-666666666666";
const EVT_DRAFT = "77777777-7777-4777-8777-777777777777";
const T_SOHO = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const T_PASSED = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const T_OTHER = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const USER_1 = "99999999-9999-4999-8999-999999999999";
const MEMBER = { actor: "business", userId: USER_1 };
const NEW_ID = "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0";

function seed() {
  const loc = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), address: "1 Main St", city: "New York", state: "NY", postal_code: "10012", logo_url: null, cover_image_url: null, is_demo: false, archived_at: null, trashed_at: null, ...extra });
  const biz = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), city: "New York", state: "NY", logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  const evt = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), city: "Jersey City", state: "NJ", venue_name: "Grove St", cover_image_url: null, start_date: "2026-11-07", start_at: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  const target = (id, business_id, cols, status, extra = {}) => ({
    id, business_id, target_location_id: null, target_business_id: null, target_event_id: null, intents: ["placement"], status, status_changed_at: "2026-10-20T10:00:00.000Z", context: null, internal_notes: "FINDMI SECRET " + id, next_action: null, next_action_at: null, source: "business", created_by_user_id: null, created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z", ...cols, ...extra,
  });
  return {
    locations: [loc(LOC_SOHO, "Babylist Soho"), loc(LOC_UNLISTED, "Modcup Coffee", { is_demo: true }), loc(LOC_OURS, "Our Shop"), loc(LOC_ARCH, "Gone Cafe", { archived_at: "2026-01-01T00:00:00Z" })],
    businesses: [biz(MOCKTAIL, "Mocktail Mart"), biz(BABYLIST, "Babylist"), biz(DRAFT_BIZ, "Draft Brand", { publication_status: "draft" }), biz(SODA_CO, "Soda Co")],
    events: [evt(EVT_MARKET, "Jersey City Night Market"), evt(EVT_DRAFT, "Secret Launch", { publication_status: "pending_review" })],
    business_locations: [{ id: "bl1", business_id: MOCKTAIL, location_id: LOC_OURS }],
    business_targets: [
      target(T_SOHO, MOCKTAIL, { target_location_id: LOC_SOHO }, "in_conversation", { context: "See if they are open to zero proof bevs", next_action: "Find contact info for partnerships director", next_action_at: "2026-10-23" }),
      target(T_PASSED, MOCKTAIL, { target_location_id: LOC_UNLISTED }, "passed"),
      target(T_OTHER, BABYLIST, { target_business_id: SODA_CO }, "target", { intents: ["wholesale"] }),
    ],
  };
}

const COUNTERPARTY = ["target_location_id", "target_business_id", "target_event_id"];
const JOINS = [
  ["location", "target_location_id", "locations"],
  ["target_business", "target_business_id", "businesses"],
  ["event", "target_event_id", "events"],
];

function fakeDb(tables) {
  const calls = [];
  return {
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
        neq(c, v) { call.filters.push(`neq ${c}=${v}`); preds.push((r) => r[c] !== v); return chain; },
        not(c, op, v) { call.filters.push(`not ${c} ${op} ${v}`); preds.push((r) => (r[c] ?? null) !== v); return chain; },
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
          const join = (r) => {
            if (table !== "business_targets" || !call.select) return r;
            const out = { ...r };
            for (const [alias, col, t] of JOINS) if (call.select.includes(`${alias}:${t}`)) out[alias] = r[col] ? (tables[t] ?? []).find((x) => x.id === r[col]) ?? null : null;
            return out;
          };
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
            const p = call.payload;
            if (table === "business_targets") {
              // The migration's constraints, emulated.
              if (COUNTERPARTY.filter((c) => p[c]).length !== 1) return resolve({ data: null, error: { code: "23514", message: "business_targets_one_counterparty_check" } });
              const col = COUNTERPARTY.find((c) => p[c]);
              if (rows.some((r) => r.business_id === p.business_id && r[col] === p[col])) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            }
            const created = { id: NEW_ID, status: "target", ...p };
            (tables[table] ??= []).push(created);
            return resolve({ data: { ...created }, error: null });
          }
          const matched = rows.filter((r) => preds.every((pr) => pr(r)));
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
}

const add = (db, biz, kind, id, intents, source = "business") => L.addBusinessTarget(db, biz, { kind, counterpartyId: id, intents, source, userId: null });
const tablesTouched = (db) => [...new Set(db.calls.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`))];

// ── Canonical intents ──────────────────────────────────────────────────────

test("the canonical intent vocabulary is exactly the approved twelve, with Title Case labels", () => {
  assert.deepEqual([...I.COMMERCIAL_INTENTS], ["placement", "wholesale", "distribution", "collaboration", "sponsorship", "sampling", "activation", "pop_up", "event_participation", "vending", "content", "booking"]);
  assert.equal(I.COMMERCIAL_INTENT_LABELS.pop_up, "Pop-Up");
  assert.equal(I.COMMERCIAL_INTENT_LABELS.event_participation, "Event Participation");
  // The database check mirrors the code list (no intents table).
  assert.ok(read(MIGRATION).includes(`intents <@ array[${I.COMMERCIAL_INTENTS.map((s) => `'${s}'`).join(", ")}]`));
  assert.doesNotMatch(read(MIGRATION), /create table[^(]*intent/i, "no intents table");
});

test("6. intent compatibility is centralized per counterparty kind — never inferred from Category", () => {
  assert.deepEqual([...I.INTENTS_BY_KIND.location], ["placement", "sampling", "activation", "pop_up", "vending", "booking"]);
  assert.deepEqual([...I.INTENTS_BY_KIND.business], ["wholesale", "distribution", "collaboration", "sponsorship", "sampling", "activation", "content"]);
  assert.deepEqual([...I.INTENTS_BY_KIND.event], ["event_participation", "sponsorship", "sampling", "activation", "vending", "content"]);
  for (const k of I.TARGET_KINDS) for (const i of I.INTENTS_BY_KIND[k]) assert.ok(I.isCommercialIntent(i));
  assert.deepEqual(I.validateTargetIntents("location", ["wholesale"]).ok, false, "a place is never a wholesale counterparty");
  assert.deepEqual(I.validateTargetIntents("business", ["placement"]).ok, false);
  assert.deepEqual(I.validateTargetIntents("event", ["booking"]).ok, false);
  assert.deepEqual(I.validateTargetIntents("event", ["bogus"]).ok, false);
  assert.deepEqual(I.validateTargetIntents("business", []).ok, false, "at least one");
  assert.doesNotMatch(read("src/lib/commercial-intents.ts"), /categor(y|ies)_id|from\(/);
});

test("7. multiple intents: deduplicated, kept in canonical order", () => {
  assert.deepEqual(I.validateTargetIntents("business", ["collaboration", "wholesale", "collaboration"]), { ok: true, value: ["wholesale", "collaboration"] });
  assert.equal(I.intentsPhrase(["wholesale", "collaboration"]), "Wholesale, Collaboration");
});

test("existing vocabularies map onto the canonical codes (documentation only — nothing migrated)", () => {
  assert.equal(I.INTENT_MAP_OPPORTUNITY_TYPE.sampling_demo, "sampling");
  assert.equal(I.INTENT_MAP_OPPORTUNITY_TYPE.partnership, "collaboration");
  assert.equal(I.INTENT_MAP_GOAL_INTEREST.markets_festivals, "event_participation");
  assert.equal(I.INTENT_MAP_GOAL_INTEREST.residential, null, "an environment is not an intent");
  assert.equal(I.INTENT_MAP_GOAL_OBJECTIVE.increase_distribution, "distribution");
  assert.equal(I.INTENT_MAP_IDEA_TYPE.retail, "placement");
  for (const m of [I.INTENT_MAP_OPPORTUNITY_TYPE, I.INTENT_MAP_GOAL_INTEREST, I.INTENT_MAP_GOAL_OBJECTIVE, I.INTENT_MAP_IDEA_TYPE]) for (const v of Object.values(m)) assert.ok(v === null || I.isCommercialIntent(v));
});

// ── Domain ─────────────────────────────────────────────────────────────────

test("8. statuses: the proven five, with the Location-only word normalized (placement_pending → Agreed)", () => {
  assert.deepEqual([...D.TARGET_STATUSES], ["target", "in_conversation", "agreed", "active", "passed"]);
  assert.deepEqual(Object.values(D.TARGET_STATUS_LABELS), ["Target", "In Conversation", "Agreed", "Active", "Passed"]);
  assert.equal(D.isTargetStatus("pending"), false, "never a bare 'pending' (Find Us Here's moderation status)");
  assert.equal(D.isTargetStatus("placement_pending"), false);
  for (const a of D.TARGET_STATUSES) for (const b of D.TARGET_STATUSES) assert.equal(D.canChangeTargetStatus(a, b), true, "any status may move to any other");
});

test("validation: status required, text trimmed/limited, dates must be real calendar dates", () => {
  assert.equal(D.validateTargetUpdate({ status: "nope" }).ok, false);
  const ok = D.validateTargetUpdate({ status: "active", context: "  hi  ", nextAction: "  Call   buyer ", nextActionAt: "2026-11-05" });
  assert.deepEqual(ok, { ok: true, value: { status: "active", context: "hi", next_action: "Call buyer", next_action_at: "2026-11-05" } });
  assert.deepEqual(D.validateTargetUpdate({ status: "target", context: "   ", nextAction: "", nextActionAt: "" }).value, { status: "target", context: null, next_action: null, next_action_at: null });
  assert.equal(D.validateTargetUpdate({ status: "target", nextActionAt: "2026-02-30" }).ok, false);
  assert.equal(D.validateTargetUpdate({ status: "target", context: "x".repeat(2001) }).ok, false);
  assert.equal(D.validateTargetUpdate({ status: "target", nextAction: "x".repeat(501) }).ok, false);
  assert.equal(D.validateInternalNotes("x".repeat(2001)).ok, false);
});

test("a Business edit can never carry internal_notes, source, intents or identity columns", () => {
  const v = D.validateTargetUpdate({ status: "active", context: "n", internal_notes: "hack", internalNotes: "hack", source: "admin", intents: ["booking"], business_id: BABYLIST, target_location_id: LOC_UNLISTED });
  assert.deepEqual(Object.keys(v.value).sort(), ["context", "next_action", "next_action_at", "status"]);
});

test("21. permissions: owner/manager edit, staff read-only, founder Admin (Manage-As) manages", () => {
  assert.equal(D.canEditTargets("owner"), true);
  assert.equal(D.canEditTargets("manager"), true);
  assert.equal(D.canEditTargets("staff"), false);
  assert.equal(D.canEditTargets(null), false);
  assert.equal(D.canEditTargets("staff", true), true);
  const src = read(ACTIONS);
  assert.match(src, /canEditTargets\(membership\.role, membership\.viaAdmin\)/);
  assert.match(src, /source: auth\.viaAdmin \? "admin" : "business"/, "an Admin-created Target is recorded as such");
  assert.match(src, /export async function saveTargetInternalNotesAction[\s\S]*?if \(!\(await isAdminSession\(\)\)\) return/);
});

test("filters are parsed from untrusted URL params (search, status, kind)", () => {
  assert.deepEqual(D.parseTargetFilter({ q: '  Joe\'s, (Cafe) % "x" ', status: "active", kind: "businesses" }), { q: "Joe's Cafe x", status: "active", kind: "businesses" });
  assert.deepEqual(D.parseTargetFilter({ q: 5, status: "pending", kind: "organizers" }), D.EMPTY_TARGET_FILTER);
  assert.equal(D.parseTargetFilter({ q: "x".repeat(200) }).q.length, 60);
});

// ── 1–5. Creation ──────────────────────────────────────────────────────────

test("1. Location Target creation: one row, intents [placement], status target, source recorded", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await add(db, BABYLIST, "location", LOC_SOHO, ["placement"], "admin");
  assert.deepEqual(res, { ok: true, id: NEW_ID, existing: false, status: "target", kind: "location", locationId: LOC_SOHO });
  const ins = db.calls.find((c) => c.op === "insert");
  assert.deepEqual(ins.payload, { business_id: BABYLIST, target_location_id: LOC_SOHO, intents: ["placement"], status: "target", source: "admin", created_by_user_id: null });
  assert.ok(!("internal_notes" in ins.payload));
});

test("2. Business Target creation: Mocktail Mart → Babylist (the Business) for wholesale + collaboration", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await add(db, MOCKTAIL, "business", BABYLIST, ["collaboration", "wholesale"]);
  assert.equal(res.ok, true);
  assert.equal(res.locationId, null);
  assert.deepEqual(db.calls.find((c) => c.op === "insert").payload, { business_id: MOCKTAIL, target_business_id: BABYLIST, intents: ["wholesale", "collaboration"], status: "target", source: "business", created_by_user_id: null });
  // The Business itself, its unpublished peers and a bad intent are refused.
  assert.deepEqual(await add(db, MOCKTAIL, "business", MOCKTAIL, ["wholesale"]), { ok: false, error: L.OWN_BUSINESS_TARGET_ERROR });
  assert.equal((await add(db, MOCKTAIL, "business", DRAFT_BIZ, ["wholesale"])).ok, false, "an unpublished Business can't be found or targeted");
  assert.equal((await add(db, MOCKTAIL, "business", SODA_CO, ["placement"])).ok, false, "placement doesn't fit a Business");
});

test("3. Event Target creation: an Event is that Event — never its organizer, never organizer_name", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await add(db, MOCKTAIL, "event", EVT_MARKET, ["event_participation", "sampling"]);
  assert.equal(res.ok, true);
  assert.deepEqual(db.calls.find((c) => c.op === "insert").payload, { business_id: MOCKTAIL, target_event_id: EVT_MARKET, intents: ["event_participation", "sampling"], status: "target", source: "business", created_by_user_id: null });
  assert.equal((await add(db, MOCKTAIL, "event", EVT_DRAFT, ["sampling"])).ok, false, "an unpublished Event can't be targeted");
  assert.doesNotMatch(read("src/lib/business-targets.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /organizer_name|host_business_id/, "no organizer is ever inferred");
});

test("4. exactly one counterparty: the server writes exactly one FK; the database refuses zero or two", async () => {
  const body = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(body, /check \(num_nonnulls\(target_business_id, target_location_id, target_event_id\) = 1\)/);
  for (const [col, ref] of [["target_business_id", "businesses"], ["target_location_id", "locations"], ["target_event_id", "events"]]) {
    assert.match(body, new RegExp(`${col}\\s+uuid\\s+constraint business_targets_${col}_fkey references public\\.${ref}\\(id\\) on delete cascade`), `${col} is a real FK`);
  }
  const table = body.slice(body.indexOf("create table if not exists public.business_targets"), body.indexOf("create index if not exists business_targets_business_status_idx"));
  assert.doesNotMatch(table, /\b(entity_type|entity_id|target_type|target_id|counterparty_id)\s/, "never a bare polymorphic id");
  for (const kind of I.TARGET_KINDS) {
    const t = seed();
    const db = fakeDb(t);
    await add(db, SODA_CO, kind, kind === "location" ? LOC_SOHO : kind === "business" ? BABYLIST : EVT_MARKET, [...I.INTENTS_BY_KIND[kind].slice(0, 1)]);
    const payload = db.calls.find((c) => c.op === "insert").payload;
    assert.equal(COUNTERPARTY.filter((c) => payload[c]).length, 1, kind);
  }
  assert.equal((await add(fakeDb(seed()), MOCKTAIL, "person", LOC_SOHO, ["placement"])).ok, false, "no Person targets");
});

test("5. duplicate prevention: one Target per owner + counterparty — re-adding opens it (Passed included) and adds new intents", async () => {
  const t = seed();
  const db = fakeDb(t);
  const again = await add(db, MOCKTAIL, "location", LOC_UNLISTED, ["sampling"]);
  assert.deepEqual(again, { ok: true, id: T_PASSED, existing: true, status: "passed", kind: "location", locationId: LOC_UNLISTED });
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
  assert.deepEqual(t.business_targets.find((r) => r.id === T_PASSED).intents, ["placement", "sampling"]);
  const body = read(MIGRATION);
  for (const col of COUNTERPARTY) assert.match(body, new RegExp(`unique \\(business_id, ${col}\\)`));
});

test("a concurrent duplicate insert (unique violation) resolves to the existing row", async () => {
  const t = seed();
  const db = fakeDb(t);
  let reads = 0;
  const wrapped = {
    from(table) {
      const c = db.from(table);
      if (table !== "business_targets") return c;
      const origThen = c.then;
      c.then = (resolve) => (reads++ === 0 ? resolve({ data: null, error: null }) : origThen(resolve));
      return c;
    },
  };
  t.business_targets.push({ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", business_id: SODA_CO, target_location_id: LOC_SOHO, target_business_id: null, target_event_id: null, intents: ["placement"], status: "target" });
  const res = await add(wrapped, SODA_CO, "location", LOC_SOHO, ["placement"]);
  assert.deepEqual(res, { ok: true, id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", existing: true, status: "target", kind: "location", locationId: LOC_SOHO });
});

test("one of the Business's own Locations, an archived place or a bad id cannot be a Target", async () => {
  const db = fakeDb(seed());
  assert.deepEqual(await add(db, MOCKTAIL, "location", LOC_OURS, ["placement"]), { ok: false, error: L.ALREADY_OUR_LOCATION_TARGET_ERROR });
  assert.equal((await add(db, MOCKTAIL, "location", LOC_ARCH, ["placement"])).ok, false);
  assert.equal((await add(db, MOCKTAIL, "location", "x", ["placement"])).ok, false);
  assert.equal(db.calls.filter((c) => c.op === "insert").length, 0);
});

test("18–19. creating a Target writes ONLY business_targets — no Conversation, notification, Opportunity, Find Us Here, Appearance or Event participation", async () => {
  for (const [kind, id] of [["location", LOC_SOHO], ["business", BABYLIST], ["event", EVT_MARKET]]) {
    const db = fakeDb(seed());
    await add(db, SODA_CO, kind, id, [...I.INTENTS_BY_KIND[kind].slice(0, 1)]);
    assert.deepEqual(tablesTouched(db), ["insert:business_targets"], kind);
  }
  const src = read("src/lib/business-targets.ts") + read(ACTIONS);
  assert.doesNotMatch(src, /from\("(conversations|conversation_participants|conversation_messages|opportunities|opportunity_listings|opportunity_recipients|business_location_availability|appearances|event_businesses|event_occurrence_businesses|location_requests)"\)/);
  assert.doesNotMatch(src, /notify|sendProductNotification|sendOperationalNotification|addEntityParticipants|createConversation/i, "the counterparty is never told");
});

// ── 9–12. Edits ────────────────────────────────────────────────────────────

test("an edit writes only the changed Business fields; reopening Passed is status → target on the same row", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await L.updateBusinessTarget(db, MOCKTAIL, T_PASSED, { status: "target", context: null, nextAction: null, nextActionAt: null, internal_notes: "hack" }, MEMBER);
  assert.deepEqual(res, { ok: true, changed: true });
  const upd = db.calls.find((c) => c.op === "update");
  assert.deepEqual(upd.payload, { status: "target", status_actor: "business", status_actor_user_id: USER_1 });
  assert.ok(upd.filters.includes(`eq business_id=${MOCKTAIL}`));
  assert.equal(t.business_targets.find((r) => r.id === T_PASSED).internal_notes, "FINDMI SECRET " + T_PASSED, "internal notes untouched");
  assert.equal(t.business_targets.length, 3, "no new row");
});

test("9 + 12. Context and Next Action save on any kind; a no-op save writes nothing", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.deepEqual(await L.updateBusinessTarget(db, BABYLIST, T_OTHER, { status: "target", context: "Met at Expo West", nextAction: "Send wholesale deck", nextActionAt: "2026-10-28" }, MEMBER), { ok: true, changed: true });
  assert.deepEqual(db.calls.find((c) => c.op === "update").payload, { context: "Met at Expo West", next_action: "Send wholesale deck", next_action_at: "2026-10-28" });
  const db2 = fakeDb(t);
  assert.deepEqual(await L.updateBusinessTarget(db2, BABYLIST, T_OTHER, { status: "target", context: "Met at Expo West", nextAction: "Send wholesale deck", nextActionAt: "2026-10-28" }, MEMBER), { ok: true, changed: false });
  assert.equal(db2.calls.filter((c) => c.op === "update").length, 0);
});

test("intents can be changed later — only to ones the counterparty kind supports", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.deepEqual(await L.setBusinessTargetIntents(db, MOCKTAIL, T_SOHO, ["sampling", "placement"]), { ok: true, changed: true });
  assert.deepEqual(t.business_targets.find((r) => r.id === T_SOHO).intents, ["placement", "sampling"]);
  assert.equal((await L.setBusinessTargetIntents(db, MOCKTAIL, T_SOHO, ["wholesale"])).ok, false);
  assert.equal((await L.setBusinessTargetIntents(db, MOCKTAIL, T_SOHO, [])).ok, false);
  assert.equal((await L.setBusinessTargetIntents(db, MOCKTAIL, T_OTHER, ["sampling"])).ok, false, "never another Business's Target");
});

test("Findmi-only notes: read and written only by the admin functions, scoped to the owner Business", async () => {
  const t = seed();
  const db = fakeDb(t);
  assert.equal(await L.adminGetTargetInternalNotes(db, MOCKTAIL, T_SOHO), "FINDMI SECRET " + T_SOHO);
  assert.equal(await L.adminGetTargetInternalNotes(db, MOCKTAIL, T_OTHER), null, "never across Businesses");
  assert.deepEqual(await L.adminSetTargetInternalNotes(db, MOCKTAIL, T_SOHO, "  managed by Findmi "), { ok: true });
  assert.deepEqual(db.calls.find((c) => c.op === "update").payload, { internal_notes: "managed by Findmi" });
  assert.equal((await L.adminSetTargetInternalNotes(db, MOCKTAIL, T_OTHER, "x")).ok, false);
});

// ── Reads, lenses, privacy ─────────────────────────────────────────────────

test("Business reads never select internal_notes; items carry the counterparty and kind", async () => {
  assert.doesNotMatch(L.BUSINESS_TARGET_COLUMNS, /internal/);
  const db = fakeDb(seed());
  const page = await L.getBusinessTargetsPage(db, MOCKTAIL, D.EMPTY_TARGET_FILTER, 1);
  assert.equal(page.available, true);
  assert.equal(page.items.length, 2, "only this Business's rows");
  assert.deepEqual(page.counts, { all: 2, target: 0, in_conversation: 1, agreed: 0, active: 0, passed: 1 });
  assert.doesNotMatch(JSON.stringify(page), /FINDMI SECRET|internal/i);
  for (const c of db.calls.filter((c) => c.table === "business_targets")) {
    assert.ok(c.filters.includes(`eq business_id=${MOCKTAIL}`), "every read is scoped to the OWNER Business");
    assert.doesNotMatch(c.select ?? "", /internal_notes/);
  }
  const soho = await L.getBusinessTarget(db, MOCKTAIL, T_SOHO);
  assert.deepEqual([soho.kind, soho.counterparty.name, soho.locationId, soho.intents, soho.nextAction], ["location", "Babylist Soho", LOC_SOHO, ["placement"], "Find contact info for partnerships director"]);
});

test("14. Growth → Targets: All / Places / Businesses / Events read the same records", async () => {
  const t = seed();
  const db0 = fakeDb(t);
  await add(db0, MOCKTAIL, "business", BABYLIST, ["wholesale"]);
  t.business_targets.at(-1).id = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
  await add(db0, MOCKTAIL, "event", EVT_MARKET, ["event_participation"]);
  const kinds = async (kind) => (await L.getBusinessTargetsPage(fakeDb(t), MOCKTAIL, { ...D.EMPTY_TARGET_FILTER, kind }, 1)).items.map((i) => i.kind).sort();
  assert.deepEqual(await kinds(""), ["business", "event", "location", "location"]);
  assert.deepEqual(await kinds("places"), ["location", "location"]);
  assert.deepEqual(await kinds("businesses"), ["business"]);
  assert.deepEqual(await kinds("events"), ["event"]);
  const page = await L.getBusinessTargetsPage(fakeDb(t), MOCKTAIL, D.EMPTY_TARGET_FILTER, 1);
  assert.deepEqual(page.kindCounts, { all: 4, places: 2, businesses: 1, events: 1 });
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /TARGET_KIND_FILTERS\.map\(\(k\) =>/);
  assert.match(view, /\{available && !placesOnly && anyTargets && !adding && \(/, "kind chips only in Growth");
});

test("15. Find Us Here → Targets is a Places-only lens over the same records, whatever the URL says", async () => {
  const t = seed();
  await add(fakeDb(t), MOCKTAIL, "business", BABYLIST, ["wholesale"]);
  const db = fakeDb(t);
  const page = await L.getBusinessTargetsPage(db, MOCKTAIL, { ...D.EMPTY_TARGET_FILTER, kind: "businesses" }, 1, { placesOnly: true });
  assert.deepEqual(page.items.map((i) => i.kind), ["location", "location"]);
  assert.ok(db.calls.some((c) => c.filters.includes("not target_location_id is null")));
  const pageSrc = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(pageSrc, /getBusinessTargetsPage\(admin, id, targetsFilter, Number\(rawSearchParams\.tp\) \|\| 1, \{ placesOnly: onFindUsTargets \}\)/);
  assert.match(pageSrc, /kind: onGrowthTargets \? rawSearchParams\.tk : undefined/, "the kind filter is Growth's alone");
  assert.match(pageSrc, /placesOnly=\{onFindUsTargets\}/);
});

test("search filters by status and counterparty text in the database (per kind, and across kinds)", async () => {
  const db = fakeDb(seed());
  await L.getBusinessTargetsPage(db, MOCKTAIL, { q: "soho", status: "passed", kind: "places" }, 1);
  const list = db.calls.find((c) => c.table === "business_targets" && c.select?.includes("location:locations!inner"));
  assert.ok(list.filters.includes("eq status=passed"));
  assert.deepEqual(list.ors[0], { expr: "name.ilike.%soho%,city.ilike.%soho%,address.ilike.%soho%", opts: { referencedTable: "location" } });
  const db2 = fakeDb(seed());
  await L.getBusinessTargetsPage(db2, MOCKTAIL, { q: "baby", status: "", kind: "" }, 1);
  assert.deepEqual(db2.calls.filter((c) => c.ors.length).map((c) => c.ors[0].opts.referencedTable).sort(), ["event", "location", "target_business"]);
});

test("before the migration is applied the view fails safe (available: false)", async () => {
  const fail = () => {
    const c = { select: () => c, eq: () => c, not: () => c, or: () => c, in: () => c, order: () => c, range: () => c, then: (r) => r({ data: null, count: null, error: { code: "42P01", message: "relation \"business_targets\" does not exist" } }) };
    return c;
  };
  assert.equal((await L.getBusinessTargetsPage({ from: fail }, MOCKTAIL, D.EMPTY_TARGET_FILTER, 1)).available, false);
});

test("17. Babylist privacy: Mocktail Mart → Babylist Soho / → Babylist is invisible to Babylist", async () => {
  const t = seed();
  await add(fakeDb(t), MOCKTAIL, "business", BABYLIST, ["wholesale"]);
  const db = fakeDb(t);
  // Babylist reading ITS OWN Targets sees only what Babylist tracks — never Mocktail's rows about it.
  const babylist = await L.getBusinessTargetsPage(db, BABYLIST, D.EMPTY_TARGET_FILTER, 1);
  assert.deepEqual(babylist.items.map((i) => i.id), [T_OTHER]);
  assert.doesNotMatch(JSON.stringify(babylist), /Find contact info|zero proof|Mocktail|placement/i, "no existence, status, intents, Context, Next Action or notes leak");
  assert.equal(await L.getBusinessTarget(db, BABYLIST, T_SOHO), null);
  assert.equal(await L.getBusinessTargetByLocation(db, BABYLIST, LOC_SOHO), null, "Babylist's own place lookup never finds Mocktail's Target");
  assert.ok((await L.getFollowUpTargets(db, BABYLIST)).every((f) => f.targetId === T_OTHER), "only Babylist's own Targets");
  assert.equal((await L.updateBusinessTarget(db, BABYLIST, T_SOHO, { status: "passed" }, MEMBER)).ok, false);
  assert.equal((await L.addTargetNote(db, BABYLIST, T_SOHO, "peek", MEMBER)).ok, false);
  assert.equal(await L.adminGetTargetInternalNotes(db, BABYLIST, T_SOHO), null);
  // No reader in the system is keyed by the counterparty.
  const lib = read("src/lib/business-targets.ts");
  assert.doesNotMatch(lib.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /\.eq\("target_(business|event)_id"/);
  assert.equal((lib.match(/\.eq\("target_location_id"/g) ?? []).length, 1, "only the owner-scoped place lookup");
  assert.match(lib, /\.eq\("business_id", businessId\)\.eq\("target_location_id", locationId\)/);
  // The tables stay server-only.
  const body = read(MIGRATION).replace(/--.*$/gm, "");
  assert.match(body, /revoke all on public\.business_targets from public, anon, authenticated;/);
  assert.match(body, /revoke all on public\.business_target_activities from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(body, /create\s+policy|grant[^;]*to (anon|authenticated)/i);
});

// ── Add Target pickers ─────────────────────────────────────────────────────

test("pickers search every kind, need 2+ letters (never a dump), and never list unpublished or archived records", async () => {
  const db = fakeDb(seed());
  assert.deepEqual(await L.searchTargetLocations(db, ""), []);
  assert.deepEqual(await L.searchTargetLocations(db, "c"), []);
  assert.equal(db.calls.length, 0, "no read at all below the minimum");
  const found = await L.searchTargetLocations(db, "co");
  const call = db.calls.find((c) => c.table === "locations");
  assert.ok(call.filters.includes("is archived_at=null") && call.filters.includes("is trashed_at=null"));
  assert.ok(!call.filters.some((f) => f.startsWith("eq is_demo")), "unlisted places stay linkable");
  assert.equal(call.ors[0].expr, "name.ilike.%co%,city.ilike.%co%,address.ilike.%co%");
  assert.ok(found.length > 0);
  const db2 = fakeDb(seed());
  await L.searchTargetBusinesses(db2, MOCKTAIL, "baby");
  const b = db2.calls.find((c) => c.table === "businesses");
  for (const f of ["eq is_demo=false", "eq publication_status=live", "is archived_at=null", "is trashed_at=null", `neq id=${MOCKTAIL}`]) assert.ok(b.filters.includes(f), f);
  await L.searchTargetEvents(db2, "market");
  const e = db2.calls.find((c) => c.table === "events");
  for (const f of ["eq is_demo=false", "eq publication_status=live", "is archived_at=null", "is trashed_at=null"]) assert.ok(e.filters.includes(f), f);
  const view = read(`${V2}/TargetsView.tsx`);
  assert.match(view, /if \(query\.trim\(\)\.length < TARGET_SEARCH_MIN_CHARS\) \{/);
  assert.match(view, /<IntentPicker kind=\{kind\} value=\{intents\} onChange=\{setIntents\}/, "choose why after choosing who");
});

test("new place: the shared inline-place workflow offers existing matches first, then creates it unlisted — usable as a Target", async () => {
  const t = seed();
  const db = fakeDb(t);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: "URBY Jersey City", address: "200 Greene St", city: "Jersey City", state: "NJ", postal_code: "07311" })) fd.set(k, v);
  const res = await PLACE.insertInlinePlace(db, fd);
  assert.equal(res.status, "created");
  const ins = db.calls.find((c) => c.op === "insert" && c.table === "locations");
  assert.equal(ins.payload.is_demo, true);
  assert.equal(ELIG.isLocationDiscoverable(ins.payload), false);
  const src = read(ACTIONS);
  assert.match(src, /export async function createTargetPlaceAction[\s\S]*?authorizeWrite\(businessId\)[\s\S]*?insertInlinePlace\(admin, formData\)/);
  assert.doesNotMatch(src, /from\("locations"\)\.insert/, "never a separate place insert");
  assert.match(src, /updateBusinessTarget\(\s*admin,\s*businessId,\s*targetId,\s*\{\s*status: input\?\.status,\s*context: input\?\.context,\s*nextAction: input\?\.nextAction,\s*nextActionAt: input\?\.nextActionAt,\s*\},\s*await actingAs\(auth\.viaAdmin\)\s*\)/);
});

test("the Manager page reads internal notes only for a founder Admin session and only for an opened Target", () => {
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /const findmiAdmin = Boolean\(data\.target\) && \(isAdminElevated \|\| \(await isAdminSession\(\)\)\);/);
  assert.match(page, /data\.target && findmiAdmin \? adminGetTargetInternalNotes\(admin, id, data\.target\.id\) : null,/);
  assert.match(page, /findmiAdmin \? adminGetTargetInternalNotes\(admin, id, opened\.id\) : null/);
  assert.match(read(`${V2}/RelationshipWorkspace.tsx`), /\{target && props\.isFindmiAdmin && <InternalNotes /);
  assert.match(read(`${V2}/TargetWorkspace.tsx`), /\{isFindmiAdmin && <InternalNotes /);
});

// ── Pass 1 Find Us Here unchanged ──────────────────────────────────────────

test("Places and By Market keep their exact links; Targets never write Find Us Here", () => {
  const sw = read(`${V2}/MarketFootprintView.tsx`);
  assert.match(sw, /item\("places", "Places", `\$\{basePath\}\?tab=findmi-here&view=find-us`\)/);
  assert.match(sw, /item\("markets", "By Market", `\$\{basePath\}\?tab=findmi-here&view=find-us&fv=markets`\)/);
  assert.match(sw, /item\("targets", "Targets", `\$\{basePath\}\?tab=findmi-here&view=find-us&fv=targets`\)/);
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /const onFindUsPlaces = onFindUs && !onFindUsMarkets && !onFindUsTargets;/);
  for (const f of ["src/lib/business-targets.ts", ACTIONS]) assert.doesNotMatch(read(f), /business_location_availability/);
});

test("one live Target system: no code reads or writes the legacy placement tables", () => {
  const files = ["src/lib/business-targets.ts", "src/lib/business-relationships.ts", "src/lib/business-follow-ups.ts", ACTIONS, "src/app/(public)/account/business/[id]/(manager)/page.tsx", `${V2}/TargetsView.tsx`, `${V2}/RelationshipWorkspace.tsx`, `${V2}/TargetWorkspace.tsx`, `${V2}/GeographyViews.tsx`];
  for (const f of files) assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /business_location_placement|business-placements|placement-actions/, f);
});

// ── 20. Migration + backfill ───────────────────────────────────────────────

test("20. migration: additive; the existing placement (and its Activity) is copied without loss, ids kept", () => {
  const body = read(MIGRATION).replace(/--.*$/gm, "");
  assert.doesNotMatch(body, /\bdrop\s+(table|column)|\bdelete\s+from|\btruncate\s+(table\s+)?public|\bupdate\s+public\./i);
  assert.doesNotMatch(body, /alter table public\.business_location_placements/i, "the legacy table is never altered");
  assert.match(body, /select\s+p\.id, p\.business_id, p\.location_id, array\['placement'\],\s*case p\.status when 'placement_pending' then 'agreed' else p\.status end,\s*p\.status_changed_at, p\.notes, p\.internal_notes, p\.next_action, p\.next_action_at,\s*p\.source, p\.created_by_user_id, p\.created_at, p\.updated_at\s*from public\.business_location_placements p\s*on conflict do nothing;/);
  assert.match(body, /select\s+a\.id, a\.placement_id, a\.activity_type, a\.body,[\s\S]*?a\.actor, a\.created_by_user_id, a\.created_at\s*from public\.business_location_placement_activities a\s*join public\.business_targets t on t\.id = a\.placement_id\s*on conflict do nothing;/);
  // Legacy becomes read-only (rollback / history), never dropped.
  assert.match(body, /revoke insert, update, delete, truncate on public\.business_location_placements from service_role;/);
  assert.match(body, /revoke insert on public\.business_location_placement_activities from service_role;/);
  // The trigger: only on a real change, one insert, actor copied then cleared.
  const fn = body.slice(body.indexOf("create or replace function public.business_targets_status_changed()"));
  assert.match(fn, /if new\.status is distinct from old\.status then[\s\S]*?insert into public\.business_target_activities[\s\S]*?jsonb_build_object\('from', old\.status, 'to', new\.status\), new\.status_actor, new\.status_actor_user_id\);\s*end if;\s*new\.status_actor := null;\s*new\.status_actor_user_id := null;/);
  assert.match(body, /grant select, insert on public\.business_target_activities to service_role;/, "Activity is append-only");
  assert.ok(body.includes(`check (status in (${D.TARGET_STATUSES.map((s) => `'${s}'`).join(", ")}))`));
  assert.ok(body.includes(`check (source in (${D.TARGET_SOURCES.map((s) => `'${s}'`).join(", ")}))`));
  for (const col of ["status_changed_at", "context", "internal_notes", "next_action", "next_action_at", "created_by_user_id", "updated_at", "intents", "source"]) assert.match(body, new RegExp(`\\n  ${col}\\s`), col);
});

test("legacy placements migration (history) is unchanged", () => {
  const body = read("supabase/migrations/20261102000000_business_location_placements.sql").replace(/--.*$/gm, "");
  assert.match(body, /unique \(business_id, location_id\)/);
  assert.ok(body.includes("check (status in ('target', 'in_conversation', 'placement_pending', 'active', 'passed'))"));
});

test("goal migration: increase_distribution added to the existing Growth goals; every other list unchanged (strict superset)", () => {
  const lists = (sql) => Object.fromEntries([...sql.matchAll(/kind = '([a-z_]+)' and option_key in \(([^)]*)\)/g)].map((m) => [m[1], m[2].split(",").map((s) => s.trim().replace(/'/g, ""))]));
  const before = lists(read("supabase/migrations/20261023000000_brand_intelligence_v1_2.sql"));
  const after = lists(read("supabase/migrations/20261102010000_growth_goal_increase_distribution.sql"));
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const k of Object.keys(before)) {
    for (const key of before[k]) assert.ok(after[k].includes(key), `${k}:${key} kept`);
    assert.deepEqual(after[k].filter((x) => !before[k].includes(x)), k === "goal" ? ["increase_distribution"] : []);
  }
  assert.deepEqual(after.goal, [...AUDIT.AUDIT_GOALS]);
});
