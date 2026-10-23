// Commercial Inquiry v1: private Target → deliberate Inquire → shared Commercial
// Inquiry → Findmi-mediated Conversation → simple outcome. The pure rules, the
// server workflow against an in-memory fake (constraints of the migration and
// the Target status trigger emulated), routing, privacy, idempotency,
// notifications, Requests, the UI wiring, the migration, and regressions for
// the existing Opportunity thread and event participation. No network, no DB.
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

process.env.ADMIN_NOTIFICATION_EMAILS = "ops@findmi.test";
delete process.env.RESEND_API_KEY;

const D = await import("../src/lib/commercial-inquiries-domain.ts");
const S = await import("../src/lib/commercial-inquiries.ts");
const I = await import("../src/lib/commercial-intents.ts");
const R = await import("../src/lib/business-requests.ts");
const P = await import("../src/lib/communication-policy.ts");
const read = (p) => readFileSync(p, "utf8");
const MIGRATION = "supabase/migrations/20261108000000_commercial_inquiries.sql";
const V2 = "src/app/(public)/account/business/[id]/v2";
const ACTIONS = "src/app/(public)/account/inquiry-actions.ts";
const PAGE = "src/app/(public)/account/business/[id]/(manager)/page.tsx";
const DETAIL = "src/app/(public)/account/business/[id]/inquiries/[inquiryId]/page.tsx";
const MESSAGES = "src/app/(public)/account/messages/[id]/page.tsx";
const strip = (s) => s.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");

// ── Ids ────────────────────────────────────────────────────────────────────
const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const MOCKTAIL = u(1), BABYLIST = u(2), LAVAZZA = u(3), NOMEMBERS = u(4), DRAFT = u(5), OTHER = u(6), SHOPCO = u(7), GHOSTCO = u(8), SHOP2 = u(9);
const L_430 = u(20), L_BABY = u(21), L_OPERATED = u(22), L_OWN = u(23), L_MULTI = u(24);
const E_MEMBERS = u(30), E_HOSTED = u(31), E_GHOST = u(32);
const T_430 = u(40), T_BABY = u(41), T_BIZ = u(42), T_EVT = u(43), T_PASSED = u(44), T_ACTIVE = u(45), T_HOSTED = u(46);
const USER_MM = u(50), USER_BABY = u(51), USER_LAV = u(52), USER_SHOP = u(53), USER_LOCBABY = u(54), USER_EVT = u(55), USER_OTHER = u(56), USER_GHOST = u(57), USER_SHOP2 = u(58);
const KEY = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seed() {
  const biz = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), logo_url: null, cover_image_url: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  const loc = (id, name) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), cover_image_url: null, logo_url: null, is_demo: false, archived_at: null, trashed_at: null });
  const evt = (id, name, extra = {}) => ({ id, name, slug: name.toLowerCase().replace(/\W+/g, "-"), cover_image_url: null, host_business_id: null, organizer_name: null, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null, ...extra });
  const target = (id, cols, status, intents) => ({ id, business_id: MOCKTAIL, target_business_id: null, target_location_id: null, target_event_id: null, ...cols, status, intents, context: "SECRET CONTEXT: our margin floor is 40%", next_action: "SECRET NEXT: call Dana", next_action_at: "2026-11-01", internal_notes: "FINDMI INTERNAL SECRET", status_actor: null, status_actor_user_id: null });
  return {
    businesses: [biz(MOCKTAIL, "Mocktail Mart"), biz(BABYLIST, "Babylist"), biz(LAVAZZA, "Lavazza"), biz(NOMEMBERS, "Quiet Brand"), biz(DRAFT, "Draft Brand", { publication_status: "draft" }), biz(OTHER, "Other Co"), biz(SHOPCO, "Shop Co"), biz(GHOSTCO, "Ghost Org"), biz(SHOP2, "Shop Two")],
    business_members: [
      { id: "bm1", business_id: MOCKTAIL, user_id: USER_MM, role: "owner" },
      { id: "bm2", business_id: BABYLIST, user_id: USER_BABY, role: "owner" },
      { id: "bm3", business_id: LAVAZZA, user_id: USER_LAV, role: "owner" },
      { id: "bm4", business_id: SHOPCO, user_id: USER_SHOP, role: "manager" },
      { id: "bm5", business_id: OTHER, user_id: USER_OTHER, role: "owner" },
      { id: "bm6", business_id: GHOSTCO, user_id: USER_GHOST, role: "owner" },
      { id: "bm7", business_id: SHOP2, user_id: USER_SHOP2, role: "owner" },
    ],
    locations: [loc(L_430, "430 W. Broadway"), loc(L_BABY, "Babylist Soho"), loc(L_OPERATED, "Shop Co Flagship"), loc(L_OWN, "Mocktail Shop"), loc(L_MULTI, "Shared Market Hall")],
    location_members: [{ id: "lm1", location_id: L_BABY, user_id: USER_LOCBABY, role: "owner" }],
    business_locations: [
      { id: "bl1", business_id: SHOPCO, location_id: L_OPERATED, is_primary: true },
      { id: "bl2", business_id: MOCKTAIL, location_id: L_OWN, is_primary: true },
      { id: "bl3", business_id: SHOPCO, location_id: L_MULTI, is_primary: false },
      { id: "bl4", business_id: SHOP2, location_id: L_MULTI, is_primary: false },
    ],
    events: [evt(E_MEMBERS, "Soho Night Market"), evt(E_HOSTED, "Lavazza Tasting", { host_business_id: LAVAZZA }), evt(E_GHOST, "Ghost Fair", { organizer_name: "Ghost Org" })],
    event_members: [{ id: "em1", event_id: E_MEMBERS, user_id: USER_EVT, role: "owner" }],
    business_targets: [
      target(T_430, { target_location_id: L_430 }, "target", ["placement", "pop_up"]),
      target(T_BABY, { target_location_id: L_BABY }, "in_conversation", ["placement"]),
      target(T_BIZ, { target_business_id: BABYLIST }, "target", ["collaboration"]),
      target(T_EVT, { target_event_id: E_MEMBERS }, "target", ["event_participation", "sponsorship"]),
      target(T_PASSED, { target_business_id: OTHER }, "passed", ["collaboration"]),
      target(T_ACTIVE, { target_business_id: LAVAZZA }, "active", ["wholesale"]),
      target(T_HOSTED, { target_event_id: E_HOSTED }, "target", ["sponsorship"]),
    ],
    business_target_activities: [],
    commercial_inquiries: [],
    conversations: [],
    conversation_participants: [],
    conversation_messages: [],
    opportunities: [],
    opportunity_recipients: [],
    appearances: [],
    business_location_availability: [],
    orders: [],
    event_businesses: [],
  };
}

// ── In-memory fake (the migration's constraints + the Target trigger) ───────

let idSeq = 0;
const newId = () => `bbbbbbbb-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`;
const EMBED_FK = { sender: "sender_business_id", location: "counterparty_location_id", event: "counterparty_event_id" };
const EMBED_TABLE = { sender: "businesses", location: "locations", event: "events" };

function constraintError(table, row, rows) {
  if (table === "commercial_inquiries") {
    const cps = ["counterparty_business_id", "counterparty_location_id", "counterparty_event_id"].filter((c) => row[c]);
    if (cps.length !== 1) return { code: "23514", message: "commercial_inquiries_one_counterparty_check" };
    if (row.counterparty_business_id && row.counterparty_business_id === row.sender_business_id) return { code: "23514", message: "commercial_inquiries_not_self_check" };
    if (!["placement", "wholesale", "distribution", "collaboration", "sponsorship", "sampling", "activation", "pop_up", "vending", "content", "booking"].includes(row.intent)) return { code: "23514", message: "commercial_inquiries_intent_check" };
    if (rows.some((r) => r.sender_business_id === row.sender_business_id && r.request_key === row.request_key)) return { code: "23505", message: "commercial_inquiries_sender_request_key" };
    const cp = (r) => r.counterparty_business_id ?? r.counterparty_location_id ?? r.counterparty_event_id;
    const open = (r) => r.status === "sent" || r.status === "responded";
    if (open(row) && rows.some((r) => r !== row && open(r) && r.sender_business_id === row.sender_business_id && cp(r) === cp(row) && r.intent === row.intent)) return { code: "23505", message: "commercial_inquiries_open_counterparty_intent_key" };
  }
  if (table === "conversations" && row.subject_type === "commercial_inquiry" && rows.some((r) => r.subject_type === "commercial_inquiry" && r.subject_id === row.subject_id)) return { code: "23505", message: "conversations_commercial_inquiry_subject_key" };
  return null;
}

function fakeDb(tables, opts = {}) {
  const calls = [];
  const failures = { ...(opts.fail ?? {}) };
  const db = {
    calls,
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@users.test` } }, error: null }) } },
    from(table) {
      const call = { table, select: null, op: "select", payload: null, filters: [] };
      calls.push(call);
      const preds = [];
      let single = null, limit = Infinity, returning = false, upsertOpts = null;
      const pred = (d, c, fn) => { call.filters.push(`${d} ${c}`); preds.push((r) => fn(r[c])); return chain; };
      const chain = {
        select(cols) { if (call.op === "select") call.select = cols; else returning = true; return chain; },
        eq: (c, v) => pred("eq", c, (x) => x === v),
        neq: (c, v) => pred("neq", c, (x) => x !== v),
        is: (c, v) => pred("is", c, (x) => (x ?? null) === v),
        in: (c, v) => pred("in", c, (x) => v.includes(x)),
        not: (c, op, v) => pred("not", c, (x) => (x ?? null) !== v),
        gte: (c, v) => pred("gte", c, (x) => x != null && String(x) >= String(v)),
        order() { return chain; },
        limit(n) { limit = n; return chain; },
        insert(p) { call.op = "insert"; call.payload = p; return chain; },
        update(p) { call.op = "update"; call.payload = p; return chain; },
        upsert(p, o) { call.op = "upsert"; call.payload = p; upsertOpts = o; return chain; },
        maybeSingle() { single = "maybe"; return chain; },
        single() { single = "one"; return chain; },
        then(resolve, reject) {
          try {
            resolve(run());
          } catch (e) {
            reject(e);
          }
        },
      };
      const run = () => {
        const rows = (tables[table] ??= []);
        if (call.op === "insert" || call.op === "upsert") {
          if (failures[table] > 0) { failures[table]--; return { data: null, error: { code: "08006", message: "network failure" } }; }
          const p = { id: newId(), created_at: new Date(Date.now() + idSeq).toISOString(), ...(table === "commercial_inquiries" ? { status: "sent", target_id: null, counterparty_business_id: null, counterparty_location_id: null, counterparty_event_id: null, conversation_id: null, routed_entity_type: null, routed_entity_id: null, responded_at: null } : {}), ...call.payload };
          if (call.op === "upsert" && table === "conversation_participants") {
            const same = rows.find((r) => r.conversation_id === p.conversation_id && (r.user_id ?? null) === (p.user_id ?? null) && r.entity_type === p.entity_type && (r.entity_id ?? null) === (p.entity_id ?? null));
            if (same) return { data: null, error: null };
          }
          const err = constraintError(table, p, rows);
          if (err) return { data: null, error: err };
          rows.push(p);
          return { data: single ? { ...p } : [{ ...p }], error: null };
        }
        const matched = rows.filter((r) => preds.every((f) => f(r)));
        if (call.op === "update") {
          for (const r of matched) {
            const before = r.status;
            Object.assign(r, call.payload);
            if (table === "business_targets" && "status" in call.payload && call.payload.status !== before) {
              tables.business_target_activities.push({ id: newId(), target_id: r.id, activity_type: "status_change", metadata: { from: before, to: r.status }, actor: r.status_actor });
              r.status_actor = null;
              r.status_actor_user_id = null;
            }
            if (table === "commercial_inquiries" && "status" in call.payload && call.payload.status !== before) r.status_changed_at = new Date().toISOString();
          }
          return { data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null };
        }
        const embeds = [...(call.select ?? "").matchAll(/(\w+):(\w+)(?:![\w]+)?\(/g)].map((m) => m[1]);
        const shaped = matched.slice(0, limit).map((r) => {
          const out = { ...r };
          for (const alias of embeds) if (EMBED_FK[alias]) out[alias] = (tables[EMBED_TABLE[alias]] ?? []).find((x) => x.id === r[EMBED_FK[alias]]) ?? null;
          return out;
        });
        if (single) return { data: shaped[0] ?? null, error: null };
        return { data: shaped, error: null };
      };
      return chain;
    },
  };
  return db;
}

// Notification capture: without RESEND_API_KEY every send logs its subject and skips.
const captured = [];
const origWarn = console.warn, origLog = console.log, origErr = console.error;
console.warn = (...a) => { const s = String(a[0]); if (s.includes("[notifications]")) captured.push(s); else origWarn(...a); };
console.log = (...a) => { const s = String(a[0]); if (s.includes("[notifications]")) captured.push(`${s} ${JSON.stringify(a[1] ?? "")}`); else origLog(...a); };
console.error = (...a) => { const s = String(a[0]); if (s.includes("sendCommercialInquiry") || s.includes("[notifications]")) captured.push(s); else origErr(...a); };
const emails = (re) => captured.filter((s) => re.test(s));

const send = (db, over = {}) =>
  S.sendCommercialInquiry(db, { senderBusinessId: MOCKTAIL, userId: USER_MM, targetId: T_BIZ, kind: "business", counterpartyId: BABYLIST, intent: "collaboration", message: "Would love to explore a co-branded launch.", requestKey: KEY(1), ...over });
const writes = (db) => db.calls.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`);
const thread = (t, inquiry) => ({
  conv: t.conversations.find((c) => c.id === inquiry.conversation_id),
  parts: t.conversation_participants.filter((p) => p.conversation_id === inquiry.conversation_id),
  msgs: t.conversation_messages.filter((m) => m.conversation_id === inquiry.conversation_id),
});

// ── Domain ─────────────────────────────────────────────────────────────────

test("5/6. one primary intent; compatible only; the smallest lifecycle", () => {
  assert.deepEqual([...D.INQUIRY_STATUSES], ["sent", "responded", "accepted", "declined", "withdrawn", "closed"]);
  for (const k of I.TARGET_KINDS) {
    assert.ok(!D.INQUIRY_INTENTS_BY_KIND[k].includes("event_participation"));
    for (const i of D.INQUIRY_INTENTS_BY_KIND[k]) assert.ok(I.INTENTS_BY_KIND[k].includes(i), "the canonical compatibility matrix");
  }
  assert.equal(D.validateInquiryInput({ kind: "location", intent: "wholesale", message: "hi" }).ok, false, "a place is never a wholesale counterparty");
  assert.equal(D.validateInquiryInput({ kind: "business", intent: ["collaboration", "content"], message: "hi" }).ok, false, "exactly one intent");
  assert.equal(D.validateInquiryInput({ kind: "business", intent: "collaboration", message: "  " }).ok, false, "an outward message is required");
  assert.equal(D.validateInquiryInput({ kind: "business", intent: "collaboration", message: "x".repeat(2001) }).ok, false);
  assert.deepEqual(D.validateInquiryInput({ kind: "business", intent: "collaboration", message: " Hello " }), { ok: true, intent: "collaboration", message: "Hello" });
  assert.deepEqual(D.inquiryIntentChoices("location", ["placement", "pop_up"]), { choices: ["placement", "pop_up"], preselected: null, participation: false }, "two → choose one");
  assert.deepEqual(D.inquiryIntentChoices("business", ["collaboration"]), { choices: ["collaboration"], preselected: "collaboration", participation: false }, "one → preselected");
  assert.deepEqual(D.inquiryIntentChoices("event", ["event_participation", "sponsorship"]), { choices: ["sponsorship"], preselected: "sponsorship", participation: true });
});

test("transitions: explicit outcomes only, by the right party, only while open", () => {
  assert.ok(D.canMoveInquiry("counterparty", "sent", "accepted"));
  assert.ok(D.canMoveInquiry("counterparty", "responded", "declined"));
  assert.ok(!D.canMoveInquiry("counterparty", "sent", "withdrawn"));
  assert.ok(D.canMoveInquiry("sender", "sent", "withdrawn"));
  assert.ok(!D.canMoveInquiry("sender", "sent", "accepted"), "the sender can't accept its own Inquiry");
  assert.ok(D.canMoveInquiry("findmi", "responded", "closed"));
  assert.ok(!D.canMoveInquiry("findmi", "accepted", "closed"), "resolved stays resolved");
  for (const a of ["sender", "counterparty", "findmi"]) assert.ok(!D.canMoveInquiry(a, "sent", "responded"), "Responded is never chosen");
  assert.equal(D.statusAfterReply("sent", "counterparty"), "responded");
  assert.equal(D.statusAfterReply("sent", "findmi"), "responded");
  assert.equal(D.statusAfterReply("sent", "sender"), "sent", "a sender's follow-up changes nothing");
  assert.equal(D.statusAfterReply("accepted", "counterparty"), "accepted");
  assert.equal(D.targetStatusAfterInquiry("target"), "in_conversation");
  for (const s of ["in_conversation", "agreed", "active", "passed"]) assert.equal(D.targetStatusAfterInquiry(s), null, `never moves ${s}`);
});

// ── 1–3, 12–16, 21, 24. Sending ────────────────────────────────────────────

test("1/13/14/15/16/21/24. Business Target → Inquiry: one Conversation, Findmi + sender + safe Business counterparty, history + opening message", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await send(db);
  assert.equal(res.ok, true);
  assert.equal(res.existing, false);
  const q = t.commercial_inquiries[0];
  assert.equal(t.commercial_inquiries.length, 1);
  assert.equal(q.status, "sent");
  assert.equal(q.intent, "collaboration");
  assert.equal(q.counterparty_business_id, BABYLIST);
  assert.equal([q.counterparty_location_id, q.counterparty_event_id].filter(Boolean).length, 0, "12. exactly one counterparty");
  assert.deepEqual([q.routed_entity_type, q.routed_entity_id], ["business", BABYLIST]);
  const { conv, parts, msgs } = thread(t, q);
  assert.deepEqual([conv.subject_type, conv.subject_id], ["commercial_inquiry", q.id], "the Conversation preserves the canonical Inquiry id");
  assert.equal(t.conversations.length, 1);
  assert.ok(parts.some((p) => p.entity_type === "findmi" && p.user_id === null), "14. Findmi participates");
  assert.ok(parts.some((p) => p.entity_type === "business" && p.entity_id === MOCKTAIL && p.user_id === USER_MM), "15. sender");
  assert.ok(parts.some((p) => p.entity_type === "business" && p.entity_id === BABYLIST && p.user_id === USER_BABY), "16. safe counterparty");
  assert.deepEqual(msgs.map((m) => [m.kind, m.body]), [
    ["system", "Mocktail Mart sent an Inquiry to Babylist about Collaboration."],
    ["text", "Would love to explore a co-branded launch."],
  ]);
  const opening = msgs[1];
  assert.equal(parts.find((p) => p.id === opening.sender_participant_id).entity_id, MOCKTAIL, "the opening message is from the sender Business");
});

test("2/17. Location Target → Inquiry routes to the place's own members first", async () => {
  const t = seed();
  const res = await send(fakeDb(t), { targetId: T_BABY, kind: "location", counterpartyId: L_BABY, intent: "placement", requestKey: KEY(2) });
  assert.equal(res.ok, true);
  const q = t.commercial_inquiries[0];
  assert.deepEqual([q.routed_entity_type, q.routed_entity_id], ["location", L_BABY]);
  assert.ok(thread(t, q).parts.some((p) => p.entity_type === "location" && p.user_id === USER_LOCBABY));
  assert.ok(!thread(t, q).parts.some((p) => p.entity_id === BABYLIST), "not the Babylist Business: the place's own members come first");
});

test("17. Location without members → its one operating Business; 18. unowned / ambiguous → Findmi only", async () => {
  assert.deepEqual(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "location", L_OPERATED), { entityType: "business", entityId: SHOPCO });
  assert.equal(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "location", L_430), null, "no members, no operator");
  assert.equal(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "location", L_MULTI), null, "two operators, none primary: never guessed");
  const t = seed();
  const res = await send(fakeDb(t), { targetId: T_430, kind: "location", counterpartyId: L_430, intent: "pop_up", requestKey: KEY(3) });
  assert.equal(res.ok, true);
  const q = t.commercial_inquiries[0];
  assert.equal(q.routed_entity_id, null);
  assert.deepEqual(thread(t, q).parts.map((p) => p.entity_type).sort(), ["business", "findmi"], "Sender ↔ Findmi");
});

test("3/19/20. Event: commercial intent → Inquiry via event members, else the canonical host Business; organizer_name ignored", async () => {
  const t = seed();
  const res = await send(fakeDb(t), { targetId: T_EVT, kind: "event", counterpartyId: E_MEMBERS, intent: "sponsorship", requestKey: KEY(4) });
  assert.equal(res.ok, true);
  assert.deepEqual([t.commercial_inquiries[0].routed_entity_type, t.commercial_inquiries[0].routed_entity_id], ["event", E_MEMBERS]);
  assert.deepEqual(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "event", E_HOSTED), { entityType: "business", entityId: LAVAZZA });
  assert.equal(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "event", E_GHOST), null, "a Business named like organizer_name never becomes a participant");
  assert.doesNotMatch(strip(read("src/lib/commercial-inquiries.ts")), /organizer_name/);
  assert.equal(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "business", NOMEMBERS), null, "an unclaimed Business → Findmi only");
  assert.equal(await S.resolveInquiryRoute(fakeDb(seed()), MOCKTAIL, "business", DRAFT), null);
});

test("4. Event 'event_participation' routes to the existing participation flow — never an Inquiry", async () => {
  const t = seed();
  const db = fakeDb(t);
  const res = await send(db, { targetId: T_EVT, kind: "event", counterpartyId: E_MEMBERS, intent: "event_participation", requestKey: KEY(5) });
  assert.deepEqual([res.ok, res.participation], [false, true]);
  assert.deepEqual(writes(db), [], "nothing written");
  const panel = read(`${V2}/InquiryPanel.tsx`);
  assert.match(panel, /Event Participation goes through the Event&rsquo;s own application/);
  assert.match(panel, /Apply on the Event Page/);
  assert.match(read(`${V2}/TargetWorkspace.tsx`), /eventHref=\{target\.kind === "event" \? c\.href : null\}/, "links to the public Event page (applyToEventPublic)");
});

test("6. incompatible intent and a mismatched / foreign Target are rejected", async () => {
  const t = seed();
  assert.equal((await send(fakeDb(t), { intent: "placement" })).ok, false);
  assert.equal((await send(fakeDb(t), { targetId: T_430 })).ok, false, "a Target for a different counterparty");
  const foreign = seed();
  foreign.business_targets.push({ ...foreign.business_targets[2], id: u(99), business_id: OTHER });
  assert.equal((await send(fakeDb(foreign), { targetId: u(99) })).ok, false, "another Business's Target");
  assert.equal((await send(fakeDb(t), { kind: "location", counterpartyId: L_OWN, targetId: null, intent: "placement", requestKey: KEY(6) })).ok, false, "own Location");
  assert.equal((await send(fakeDb(t), { kind: "business", counterpartyId: DRAFT, targetId: null, requestKey: KEY(7) })).ok, false, "unpublished Business");
  assert.equal(t.commercial_inquiries.length, 0);
});

// ── 7–11. Target privacy ───────────────────────────────────────────────────

test("7–11/F. the private Target is never copied or exposed", async () => {
  const t = seed();
  await send(fakeDb(t), { targetId: T_430, kind: "location", counterpartyId: L_430, intent: "pop_up", requestKey: KEY(8) });
  const q = t.commercial_inquiries[0];
  const shared = JSON.stringify({ q, ...thread(t, q) });
  for (const secret of ["SECRET CONTEXT", "SECRET NEXT", "FINDMI INTERNAL SECRET", "2026-11-01"]) assert.ok(!shared.includes(secret), secret);
  assert.ok(!captured.join("\n").includes("SECRET"), "never in an email");
  const src = strip(read("src/lib/commercial-inquiries.ts"));
  assert.doesNotMatch(src, /context|next_action|internal_notes|business_target_activities/, "never reads Context, Next, internal notes or Activity");
  const counterpartyView = await S.toInquiryView(fakeDb(t), q, "counterparty");
  assert.equal(counterpartyView.targetId, null, "G. the counterparty never gets the Target id");
  assert.equal((await S.toInquiryView(fakeDb(t), q, "sender")).targetId, T_430, "the sender keeps its own way back");
  assert.ok(!JSON.stringify(counterpartyView).includes(T_430));
});

test("Target relationship: Target → In Conversation via the trigger; never Passed / Active / anything else", async () => {
  const t = seed();
  await send(fakeDb(t), { targetId: T_430, kind: "location", counterpartyId: L_430, intent: "pop_up", requestKey: KEY(9) });
  assert.equal(t.business_targets.find((x) => x.id === T_430).status, "in_conversation");
  assert.deepEqual(t.business_target_activities.map((a) => [a.target_id, a.metadata.from, a.metadata.to, a.actor]), [[T_430, "target", "in_conversation", "business"]], "one status_change Activity, by the existing trigger; no Inquiry message copied");
  await send(fakeDb(t), { targetId: T_BABY, kind: "location", counterpartyId: L_BABY, intent: "placement", requestKey: KEY(10) });
  assert.equal(t.business_targets.find((x) => x.id === T_BABY).status, "in_conversation", "unchanged");
  await send(fakeDb(t), { targetId: T_PASSED, kind: "business", counterpartyId: OTHER, intent: "collaboration", requestKey: KEY(11) });
  assert.equal(t.business_targets.find((x) => x.id === T_PASSED).status, "passed", "Passed never moves");
  await send(fakeDb(t), { targetId: T_ACTIVE, kind: "business", counterpartyId: LAVAZZA, intent: "wholesale", requestKey: KEY(12) });
  assert.equal(t.business_targets.find((x) => x.id === T_ACTIVE).status, "active", "Active is never overwritten");
  assert.equal(t.business_target_activities.length, 1);
});

// ── 18/22/23. Idempotency ──────────────────────────────────────────────────

test("22/23/42. double tap and retry: one Inquiry, one Conversation, one opening message, one set of emails", async () => {
  const t = seed();
  captured.length = 0;
  const [a, b] = await Promise.all([send(fakeDb(t)), send(fakeDb(t))]);
  const again = await send(fakeDb(t));
  assert.ok(a.ok && b.ok && again.ok);
  assert.equal(new Set([a.inquiryId, b.inquiryId, again.inquiryId]).size, 1);
  assert.equal(t.commercial_inquiries.length, 1);
  assert.equal(t.conversations.length, 1);
  assert.equal(t.conversation_messages.filter((m) => m.kind === "text").length, 1, "no duplicate opening message");
  assert.equal(t.conversation_messages.filter((m) => m.kind === "system").length, 1);
  assert.equal(emails(/New Inquiry from Mocktail Mart/).length, 1, "the counterparty is emailed once");
  assert.equal(emails(/New Commercial Inquiry: Mocktail Mart → Babylist/).length, 1, "Findmi is told once");
  // Participant rows never duplicate.
  const parts = t.conversation_participants.map((p) => `${p.user_id}|${p.entity_type}|${p.entity_id}`);
  assert.equal(new Set(parts).size, parts.length);
});

test("23. retry after a network failure finishes the same send (Conversation and messages written once)", async () => {
  const t = seed();
  captured.length = 0;
  const first = await send(fakeDb(t, { fail: { conversations: 1 } }));
  assert.equal(first.ok, true);
  assert.equal(first.conversationId, null, "the Inquiry exists, its thread failed");
  assert.equal(t.conversations.length, 0);
  const retry = await send(fakeDb(t));
  assert.equal(retry.inquiryId, first.inquiryId);
  assert.equal(t.commercial_inquiries.length, 1);
  assert.equal(t.conversations.length, 1);
  assert.equal(t.conversation_messages.length, 2);
  assert.equal(emails(/New Inquiry from Mocktail Mart/).length, 1);
  const retryAgain = await send(fakeDb(t));
  assert.equal(t.conversation_messages.length, 2, "a further retry writes nothing");
  assert.equal(retryAgain.conversationId, retry.conversationId);
});

// ── Open-Inquiry uniqueness: sender + counterparty + intent ─────────────────

const sendPlace = (t, intent, key, message = `About ${intent}`) =>
  send(fakeDb(t), { targetId: T_BABY, kind: "location", counterpartyId: L_BABY, intent, requestKey: KEY(key), message });

test("U1. same counterparty + same intent while open: the open Inquiry is reused, never a second", async () => {
  const t = seed();
  captured.length = 0;
  const first = await sendPlace(t, "placement", 100);
  const dup = await sendPlace(t, "placement", 101, "A second Placement ask");
  assert.deepEqual([dup.ok, dup.existing, dup.inquiryId], [true, true, first.inquiryId]);
  assert.equal(t.commercial_inquiries.length, 1);
  assert.equal(t.conversations.length, 1);
  assert.equal(t.conversation_messages.length, 2, "no second opening message");
  assert.ok(!t.conversation_messages.some((m) => m.body === "A second Placement ask"));
  assert.equal(emails(/New Inquiry from Mocktail Mart/).length, 1);
  // The database itself refuses a racing duplicate (the open-intent unique index).
  const raw = await fakeDb(t).from("commercial_inquiries").insert({ sender_business_id: MOCKTAIL, counterparty_location_id: L_BABY, intent: "placement", request_key: KEY(102) }).select("id").single();
  assert.equal(raw.error.code, "23505");
});

test("U2. same counterparty + a different intent may be open at the same time", async () => {
  const t = seed();
  const placement = await sendPlace(t, "placement", 110);
  const popUp = await sendPlace(t, "pop_up", 111);
  assert.deepEqual([popUp.ok, popUp.existing], [true, false]);
  assert.notEqual(popUp.inquiryId, placement.inquiryId);
  assert.deepEqual(t.commercial_inquiries.map((q) => [q.intent, q.status]).sort(), [["placement", "sent"], ["pop_up", "sent"]].sort());
  assert.equal(t.conversations.length, 2, "each Inquiry has its own Conversation");
  assert.equal(new Set(t.commercial_inquiries.map((q) => q.conversation_id)).size, 2);
  const panel = read(`${V2}/InquiryPanel.tsx`);
  assert.match(panel, /const choices = allChoices\.filter\(\(i\) => !openList\.some\(\(o\) => o\.intent === i\)\);/, "the composer offers only intents not already open");
  assert.match(panel, /\{openList\.map\(\(open\) => \(/, "every open Inquiry is listed, each with Open Inquiry");
});

test("U3. a resolved same-intent Inquiry allows a new one later", async () => {
  const t = seed();
  const first = await sendPlace(t, "placement", 120);
  assert.equal((await S.setInquiryOutcome(fakeDb(t), first.inquiryId, "counterparty", "declined")).ok, true);
  const later = await sendPlace(t, "placement", 121, "Trying again next season");
  assert.deepEqual([later.ok, later.existing], [true, false]);
  assert.notEqual(later.inquiryId, first.inquiryId);
  assert.equal(t.commercial_inquiries.length, 2);
  for (const resolved of ["withdrawn", "closed"]) {
    const t2 = seed();
    const a = await sendPlace(t2, "placement", 122);
    await S.setInquiryOutcome(fakeDb(t2), a.inquiryId, resolved === "withdrawn" ? "sender" : "findmi", resolved);
    assert.equal((await sendPlace(t2, "placement", 123)).existing, false, resolved);
  }
});

test("U4/U5. request-key retry still resolves to the original — even across intents — with no duplicate thread, messages or emails", async () => {
  const t = seed();
  captured.length = 0;
  const first = await sendPlace(t, "placement", 130);
  const [r1, r2] = await Promise.all([sendPlace(t, "placement", 130), sendPlace(t, "placement", 130)]);
  const changed = await sendPlace(t, "pop_up", 130, "Same key, edited form");
  for (const r of [r1, r2, changed]) assert.deepEqual([r.ok, r.inquiryId], [true, first.inquiryId], "a key is one Send operation");
  assert.equal(t.commercial_inquiries.length, 1);
  assert.equal(t.commercial_inquiries[0].intent, "placement");
  assert.equal(t.conversations.length, 1);
  assert.equal(t.conversation_messages.length, 2);
  assert.equal(emails(/New Inquiry from Mocktail Mart/).length, 1);
  assert.equal(emails(/New Commercial Inquiry/).length, 1);
});

// ── Routing semantics: routed_entity_* is the resolved commercial ENTITY ────

const ALL_USERS = [USER_MM, USER_BABY, USER_LAV, USER_SHOP, USER_LOCBABY, USER_EVT, USER_OTHER, USER_GHOST, USER_SHOP2];
const routeOf = async (over, key) => {
  const t = seed();
  const res = await send(fakeDb(t), { targetId: null, requestKey: KEY(key), ...over });
  assert.equal(res.ok, true, JSON.stringify(res));
  const q = t.commercial_inquiries[0];
  const people = t.conversation_participants.filter((p) => p.conversation_id === q.conversation_id && p.entity_type !== "findmi" && !(p.entity_type === "business" && p.entity_id === MOCKTAIL));
  return { t, q, people };
};

test("R1. Business Target: counterparty = Business B, routing = Business B, B's members join as users", async () => {
  const { q, people } = await routeOf({ kind: "business", counterpartyId: BABYLIST, intent: "collaboration" }, 200);
  assert.deepEqual([q.counterparty_business_id, q.routed_entity_type, q.routed_entity_id], [BABYLIST, "business", BABYLIST]);
  assert.deepEqual(people.map((p) => [p.user_id, p.entity_type, p.entity_id]), [[USER_BABY, "business", BABYLIST]]);
});

test("R2. Location with direct members: counterparty = routing = Location L", async () => {
  const { q, people } = await routeOf({ kind: "location", counterpartyId: L_BABY, intent: "placement" }, 201);
  assert.deepEqual([q.counterparty_location_id, q.routed_entity_type, q.routed_entity_id], [L_BABY, "location", L_BABY]);
  assert.deepEqual(people.map((p) => [p.user_id, p.entity_type, p.entity_id]), [[USER_LOCBABY, "location", L_BABY]]);
});

test("R3. Location → operating Business: counterparty stays Location L, routing becomes Business B, B's members join", async () => {
  const { q, people } = await routeOf({ kind: "location", counterpartyId: L_OPERATED, intent: "placement" }, 202);
  assert.deepEqual([q.counterparty_location_id, q.counterparty_business_id], [L_OPERATED, null], "the canonical counterparty is never mutated into the Business");
  assert.deepEqual([q.routed_entity_type, q.routed_entity_id], ["business", SHOPCO]);
  assert.deepEqual(people.map((p) => [p.user_id, p.entity_type, p.entity_id]), [[USER_SHOP, "business", SHOPCO]]);
});

test("R4. Event with direct members: counterparty = routing = Event E", async () => {
  const { q, people } = await routeOf({ kind: "event", counterpartyId: E_MEMBERS, intent: "sponsorship" }, 203);
  assert.deepEqual([q.counterparty_event_id, q.routed_entity_type, q.routed_entity_id], [E_MEMBERS, "event", E_MEMBERS]);
  assert.deepEqual(people.map((p) => [p.user_id, p.entity_type]), [[USER_EVT, "event"]]);
});

test("R5. Event → canonical host Business: counterparty stays Event E, routing becomes Business B", async () => {
  const { q, people } = await routeOf({ kind: "event", counterpartyId: E_HOSTED, intent: "sponsorship" }, 204);
  assert.deepEqual([q.counterparty_event_id, q.counterparty_business_id], [E_HOSTED, null]);
  assert.deepEqual([q.routed_entity_type, q.routed_entity_id], ["business", LAVAZZA]);
  assert.deepEqual(people.map((p) => [p.user_id, p.entity_type, p.entity_id]), [[USER_LAV, "business", LAVAZZA]]);
});

test("R6. Findmi-only: counterparty stays the original; no routed entity (both null); Sender ↔ Findmi", async () => {
  for (const [over, key] of [
    [{ kind: "location", counterpartyId: L_430, intent: "pop_up" }, 205],
    [{ kind: "location", counterpartyId: L_MULTI, intent: "placement" }, 206],
    [{ kind: "event", counterpartyId: E_GHOST, intent: "sponsorship" }, 207],
    [{ kind: "business", counterpartyId: NOMEMBERS, intent: "collaboration" }, 208],
  ]) {
    const { q, people, t } = await routeOf(over, key);
    assert.equal(S.inquiryCounterpartyId(q), over.counterpartyId);
    assert.deepEqual([q.routed_entity_type, q.routed_entity_id], [null, null], JSON.stringify(over));
    assert.deepEqual(people, [], "nobody external joins");
    assert.ok(t.conversation_participants.some((p) => p.conversation_id === q.conversation_id && p.entity_type === "findmi"));
  }
  assert.match(read(MIGRATION), /check \(\(routed_entity_type is null\) = \(routed_entity_id is null\)\)/, "type and id are null together");
});

test("R7. routed_entity_id is always an entity id of its type — never a user / member id", async () => {
  const cases = [
    [{ kind: "business", counterpartyId: BABYLIST, intent: "collaboration" }, 210],
    [{ kind: "location", counterpartyId: L_BABY, intent: "placement" }, 211],
    [{ kind: "location", counterpartyId: L_OPERATED, intent: "placement" }, 212],
    [{ kind: "event", counterpartyId: E_MEMBERS, intent: "sponsorship" }, 213],
    [{ kind: "event", counterpartyId: E_HOSTED, intent: "sponsorship" }, 214],
  ];
  for (const [over, key] of cases) {
    const { q, t } = await routeOf(over, key);
    const table = { business: "businesses", location: "locations", event: "events" }[q.routed_entity_type];
    assert.ok(t[table].some((r) => r.id === q.routed_entity_id), `${q.routed_entity_type} ${q.routed_entity_id} is a real ${table} row`);
    assert.ok(!ALL_USERS.includes(q.routed_entity_id), "never a user id");
    const memberRowIds = [...t.business_members, ...t.location_members, ...t.event_members].map((m) => m.id);
    assert.ok(!memberRowIds.includes(q.routed_entity_id), "never a membership row id");
  }
  const src = strip(read("src/lib/commercial-inquiries.ts"));
  const route = src.slice(src.indexOf("export async function resolveInquiryRoute"), src.indexOf("async function names("));
  assert.ok(route.length > 200 && !route.includes("async function names("));
  assert.doesNotMatch(route, /user_id/, "routing never reads a user id");
  assert.match(src, /routed_entity_type: routed\?\.entityType \?\? null,\s*routed_entity_id: routed\?\.entityId \?\? null,/, "only the resolved entity is stored");
});

// ── Requests follow routing ────────────────────────────────────────────────

test("Q1. Home → Requests appear only for the Business the Inquiry was routed to", async () => {
  const { t, q } = await routeOf({ kind: "location", counterpartyId: L_OPERATED, intent: "placement" }, 220);
  const shop = await S.getInboundInquiryRequests(fakeDb(t), SHOPCO);
  assert.deepEqual(shop.map((r) => [r.id, r.senderName, r.counterpartyName]), [[q.id, "Mocktail Mart", "Shop Co Flagship"]], "the operating Business, with the place named");
  for (const other of [OTHER, BABYLIST, SHOP2, MOCKTAIL, LAVAZZA]) assert.deepEqual(await S.getInboundInquiryRequests(fakeDb(t), other), [], other);
  assert.equal(t.commercial_inquiries[0].counterparty_location_id, L_OPERATED, "still about the Location");
  const hosted = await routeOf({ kind: "event", counterpartyId: E_HOSTED, intent: "sponsorship" }, 221);
  assert.deepEqual((await S.getInboundInquiryRequests(fakeDb(hosted.t), LAVAZZA)).map((r) => r.counterpartyName), ["Lavazza Tasting"]);
  const direct = await routeOf({ kind: "location", counterpartyId: L_BABY, intent: "placement" }, 222);
  assert.deepEqual(await S.getInboundInquiryRequests(fakeDb(direct.t), BABYLIST), [], "a place routed to its own members is not the Babylist Business's Request");
});

// ── Privacy around routing ─────────────────────────────────────────────────

test("P1. a routed Business sees the shared Inquiry and nothing private; unrelated Businesses see nothing", async () => {
  const t = seed();
  const res = await send(fakeDb(t), { targetId: T_HOSTED, kind: "event", counterpartyId: E_HOSTED, intent: "sponsorship", requestKey: KEY(230) });
  const view = await S.getInquiryForBusiness(fakeDb(t), LAVAZZA, res.inquiryId);
  assert.equal(view.role, "counterparty");
  assert.equal(view.counterparty.name, "Lavazza Tasting");
  assert.equal(view.sender.name, "Mocktail Mart");
  assert.equal(view.targetId, null, "no Target");
  const shared = JSON.stringify({ view, msgs: t.conversation_messages, emails: captured });
  for (const secret of [T_HOSTED, "SECRET CONTEXT", "SECRET NEXT", "FINDMI INTERNAL SECRET", "2026-11-01", "status_change"]) assert.ok(!shared.includes(secret), secret);
  assert.deepEqual(Object.keys(view).sort(), ["conversationId", "counterparty", "createdAt", "findmiOnly", "id", "intent", "message", "role", "sender", "status", "statusChangedAt", "targetId"].sort(), "no Target status / Context / Activity / Next / Internal fields exist on the view");
  assert.equal(view.status, "sent", "the Inquiry's own status, not the Target's (in_conversation)");
  for (const other of [OTHER, BABYLIST, SHOPCO, GHOSTCO]) assert.equal(await S.getInquiryForBusiness(fakeDb(t), other, res.inquiryId), null, other);
  const detail = read(DETAIL);
  assert.doesNotMatch(detail, /getBusinessTarget|getTargetActivityPage|adminGetTargetInternalNotes|nextAction|internalNotes/, "the Inquiry page never reads the Target");
});

test("P2. membership is access, never identity: the Inquiry names entities, and a removed member loses access", async () => {
  const t = seed();
  const res = await send(fakeDb(t), { targetId: null, kind: "location", counterpartyId: L_OPERATED, intent: "placement", requestKey: KEY(231) });
  const q = t.commercial_inquiries[0];
  const ids = [q.sender_business_id, q.counterparty_business_id, q.counterparty_location_id, q.counterparty_event_id, q.routed_entity_id].filter(Boolean);
  assert.ok(ids.every((id) => !ALL_USERS.includes(id)));
  assert.equal(q.created_by_user_id, USER_MM, "the only user id is the audit field of who pressed Send — never shown, never access");
  assert.doesNotMatch(strip(read("src/lib/commercial-inquiries.ts")).slice(strip(read("src/lib/commercial-inquiries.ts")).indexOf("export async function toInquiryView")), /created_by_user_id/, "never in a view");
  // Thread access is entity-level and live (isAuthorizedForConversation): a member removed from Shop Co is no longer authorized.
  assert.match(read("src/lib/opportunities.ts"), /const \{ data: membership \} = await admin\.from\(spec\.table\)\.select\("id"\)\.eq\("user_id", userId\)\.eq\(spec\.column, row\.entity_id\)\.maybeSingle\(\);/);
  assert.ok(res.ok);
});

// ── 25–28. Replies and outcomes ────────────────────────────────────────────

test("25. first reply from the other side (or Findmi) → Responded; sender follow-ups and views change nothing", async () => {
  const t = seed();
  const { inquiryId, conversationId } = await send(fakeDb(t));
  const row = () => t.commercial_inquiries.find((q) => q.id === inquiryId);
  await S.recordInquiryReply(fakeDb(t), conversationId, { entityType: "business", entityId: MOCKTAIL });
  assert.equal(row().status, "sent");
  await S.recordInquiryReply(fakeDb(t), conversationId, { entityType: "business", entityId: BABYLIST });
  assert.equal(row().status, "responded");
  assert.ok(row().responded_at);
  const t2 = seed();
  const s2 = await send(fakeDb(t2));
  await S.recordInquiryReply(fakeDb(t2), s2.conversationId, { entityType: "findmi", entityId: null });
  assert.equal(t2.commercial_inquiries[0].status, "responded");
  assert.match(read("src/app/(public)/connect/actions.ts"), /if \(facts\.subjectType === COMMERCIAL_INQUIRY_SUBJECT\) await recordInquiryReply\(admin, conversationId, \{ entityType: actingEntityType, entityId: actingEntityId \}\);/, "wired after a reply is sent (sendReply)");
  assert.match(read("src/app/admin/(protected)/commercial-inquiries/actions.ts"), /await sendFindmiMessage\(admin!, thread!\.conversationId, body!\);\s*await recordInquiryReply\(admin!, thread!\.conversationId, \{ entityType: "findmi", entityId: null \}\);/);
  assert.doesNotMatch(read("src/lib/opportunities.ts").slice(read("src/lib/opportunities.ts").indexOf("export async function markConversationRead")), /commercial_inquiries/, "reading never changes status");
});

test("26/27/28. accept, decline, withdraw: explicit, once, by the right party, with history and emails", async () => {
  const t = seed();
  captured.length = 0;
  const a = await send(fakeDb(t));
  assert.equal((await S.setInquiryOutcome(fakeDb(t), a.inquiryId, "sender", "accepted")).ok, false, "the sender can't accept");
  assert.deepEqual(await S.setInquiryOutcome(fakeDb(t), a.inquiryId, "counterparty", "accepted"), { ok: true, changed: true });
  assert.deepEqual(await S.setInquiryOutcome(fakeDb(t), a.inquiryId, "counterparty", "accepted"), { ok: true, changed: false }, "a double tap moves it once");
  assert.equal((await S.setInquiryOutcome(fakeDb(t), a.inquiryId, "counterparty", "declined")).ok, false, "resolved stays resolved");
  assert.equal(t.conversation_messages.filter((m) => m.body === "Inquiry accepted.").length, 1);
  assert.equal(emails(/Inquiry accepted: Babylist/).length, 1, "the sender hears about it");

  const t2 = seed();
  const d = await send(fakeDb(t2));
  assert.equal((await S.setInquiryOutcome(fakeDb(t2), d.inquiryId, "counterparty", "declined")).ok, true);
  assert.equal(t2.commercial_inquiries[0].status, "declined");
  assert.equal(emails(/Inquiry declined: Babylist/).length, 1);

  const t3 = seed();
  const w = await send(fakeDb(t3));
  assert.equal((await S.setInquiryOutcome(fakeDb(t3), w.inquiryId, "counterparty", "withdrawn")).ok, false, "only the sender withdraws");
  assert.equal((await S.setInquiryOutcome(fakeDb(t3), w.inquiryId, "sender", "withdrawn")).ok, true);
  assert.ok(t3.conversation_messages.some((m) => m.body === "Mocktail Mart withdrew this Inquiry."));
  assert.equal(emails(/"Inquiry withdrawn: Mocktail Mart"/).length, 1, "the counterparty is told (Findmi's own notice is separate)");
  assert.equal(emails(/"Inquiry withdrawn: Mocktail Mart → Babylist"/).length, 1);

  const t4 = seed();
  const c = await send(fakeDb(t4));
  assert.equal((await S.setInquiryOutcome(fakeDb(t4), c.inquiryId, "findmi", "closed")).ok, true);
  assert.ok(t4.conversation_messages.some((m) => m.body === "Findmi closed this Inquiry."));
});

test("38–41. no side effects: never Find Us Here, Appearance, participation, Opportunity, Order", async () => {
  const t = seed();
  const db = fakeDb(t);
  const a = await send(db);
  await S.recordInquiryReply(db, a.conversationId, { entityType: "business", entityId: BABYLIST });
  await S.setInquiryOutcome(db, a.inquiryId, "counterparty", "accepted");
  const touched = [...new Set(writes(db))].sort();
  assert.deepEqual(touched, ["insert:commercial_inquiries", "insert:conversation_messages", "insert:conversations", "update:business_targets", "update:commercial_inquiries", "upsert:conversation_participants"].sort());
  for (const tbl of ["appearances", "business_location_availability", "opportunities", "opportunity_recipients", "orders", "event_businesses"]) assert.equal(t[tbl].length, 0, tbl);
  assert.doesNotMatch(strip(read("src/lib/commercial-inquiries.ts")), /appearances|business_location_availability|opportunity_recipients|from\("opportunities"\)|orders|event_businesses|ensureEventAppearance/);
});

test("43. Findmi writes as Findmi; no admin identity anywhere", () => {
  const admin = read("src/app/admin/(protected)/commercial-inquiries/actions.ts");
  assert.match(admin, /await requireAdmin\(\);/g);
  assert.match(admin, /sendFindmiMessage/, "the existing Findmi-only writer (a 'findmi' participant, no user)");
  assert.doesNotMatch(strip(admin) + strip(read("src/lib/commercial-inquiries.ts")), /admin_email|ADMIN_PASSWORD|getCurrentUser/);
  assert.match(read("src/app/admin/(protected)/commercial-inquiries/[inquiryId]/page.tsx"), /Replies and outcomes here are recorded as Findmi/);
});

// ── A–E, 29–31. Access ─────────────────────────────────────────────────────

test("A–E. who is a party: sender, the routed counterparty — never an unrelated or text-mentioned Business", async () => {
  const t = seed();
  const s = await send(fakeDb(t), { targetId: T_430, kind: "location", counterpartyId: L_430, intent: "pop_up", requestKey: KEY(30) });
  const routed = await send(fakeDb(t));
  assert.equal((await S.getInquiryForBusiness(fakeDb(t), MOCKTAIL, routed.inquiryId)).role, "sender", "A");
  assert.equal(await S.getInquiryForBusiness(fakeDb(t), OTHER, routed.inquiryId), null, "B. unrelated Business");
  assert.equal((await S.getInquiryForBusiness(fakeDb(t), BABYLIST, routed.inquiryId)).role, "counterparty", "C. the routed Business");
  assert.equal(await S.getInquiryForBusiness(fakeDb(t), BABYLIST, s.inquiryId), null, "C. not a party to an Inquiry it wasn't routed");
  const ghost = seed();
  const g = await send(fakeDb(ghost), { targetId: null, kind: "event", counterpartyId: E_GHOST, intent: "sponsorship", requestKey: KEY(31) });
  assert.equal(await S.getInquiryForBusiness(fakeDb(ghost), GHOSTCO, g.inquiryId), null, "D. named only by organizer_name text");
  const multi = seed();
  const m = await send(fakeDb(multi), { targetId: null, kind: "location", counterpartyId: L_MULTI, intent: "placement", requestKey: KEY(32) });
  assert.equal(await S.getInquiryForBusiness(fakeDb(multi), SHOPCO, m.inquiryId), null, "E. an unverified / ambiguous operator");
  assert.equal(S.inquiryActorForEntity(t.commercial_inquiries[1], { entityType: "location", entityId: L_430 }), null);
  assert.equal(await S.getInquiryForBusiness(fakeDb(t), MOCKTAIL, "not-a-uuid"), null);
});

test("I/J/29–31. anonymous and client roles can't read or act; every action re-verifies server-side", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /alter table public\.commercial_inquiries enable row level security;/);
  assert.match(sql, /revoke all on public\.commercial_inquiries from public, anon, authenticated;/);
  assert.match(sql, /grant select, insert, update on public\.commercial_inquiries to service_role;/);
  assert.doesNotMatch(sql, /create policy/i, "no client policies");
  const actions = read(ACTIONS);
  assert.match(actions, /^"use server";/);
  assert.match(actions, /const membership = await membershipFor\("business", businessId\);\s*if \(!membership\) return/, "send: the sending Business");
  assert.match(actions, /if \(!membership\.viaAdmin && !isManager\(membership\)\) return/, "owners / managers (or Findmi Manage-As)");
  assert.match(actions, /const actor = inquiryActorForEntity\(inquiry, asEntity\);\s*if \(!actor\) return/, "outcome: a real party");
  assert.match(actions, /if \(!membership \|\| membership\.viaAdmin\) return/, "outcome: real membership of THAT entity (Admin acts as Findmi elsewhere)");
  assert.match(read(DETAIL), /const inquiry = await getInquiryForBusiness\(admin, id, inquiryId\);\s*if \(!inquiry\) notFound\(\);/);
  assert.match(read(DETAIL), /loadBusinessShell\(id,/, "the page itself requires membership of :id");
  for (const f of ["src/lib/commercial-inquiries.ts", "src/lib/commercial-inquiries-domain.ts"]) assert.doesNotMatch(read(f), /NEXT_PUBLIC|createBrowserClient/);
});

// ── 32–35. Home ────────────────────────────────────────────────────────────

test("32/33/34. Requests: an unanswered inbound Inquiry appears; it leaves once answered; unread messages never do", async () => {
  const t = seed();
  const a = await send(fakeDb(t));
  const inbound = await S.getInboundInquiryRequests(fakeDb(t), BABYLIST);
  assert.deepEqual(inbound.map((r) => [r.id, r.senderName, r.intent]), [[a.inquiryId, "Mocktail Mart", "collaboration"]]);
  assert.deepEqual(await S.getInboundInquiryRequests(fakeDb(t), MOCKTAIL), [], "never on the sender's Requests");
  const built = R.buildBusinessRequests({ basePath: "/b", opportunities: [], invitations: [], newOrderCount: 0, inquiries: inbound });
  assert.deepEqual(built, [{ key: `inquiry:${a.inquiryId}`, title: "Mocktail Mart", meta: "Inquiry · Collaboration · Response Requested", detail: null, href: `/b/inquiries/${a.inquiryId}`, actionLabel: "Review" }]);
  await S.recordInquiryReply(fakeDb(t), a.conversationId, { entityType: "business", entityId: BABYLIST });
  assert.deepEqual(await S.getInboundInquiryRequests(fakeDb(t), BABYLIST), [], "answered → gone");
  assert.deepEqual(R.buildBusinessRequests({ basePath: "/b", opportunities: [], invitations: [], newOrderCount: 0 }), [], "inquiries are optional: nothing else changes");
  assert.doesNotMatch(strip(read("src/lib/business-requests.ts")), /last_read_at|isConversationUnread|unread/i, "34. unread state is never a Request");
  const page = read(PAGE);
  assert.match(page, /const inquiryRequestsPromise = whenP\(onHome, \(\) => getInboundInquiryRequests\(admin, id\)/);
  assert.match(page, /inquiries: inquiryRequests,/);
});

test("35. Follow-Ups stay Targets-only (no duplicate of an Inquiry)", () => {
  assert.doesNotMatch(read("src/lib/business-follow-ups.ts"), /inquir/i);
  assert.match(read(PAGE), /\/\/ Home → Follow-Ups \(lib\/business-follow-ups\.ts\): Targets only\./);
});

// ── UI ─────────────────────────────────────────────────────────────────────

test("Sender UX: a deliberate Send Inquiry from the Target workspace, never automatic, never pre-filled with private Context", () => {
  const panel = read(`${V2}/InquiryPanel.tsx`);
  assert.match(panel, /Send Inquiry/);
  assert.match(panel, /You&rsquo;re asking Findmi to help connect \{senderName\} with \{counterpartyName\}/);
  assert.match(panel, /const \[message, setMessage\] = useState\(""\);/, "the message starts empty — never the Target's Context");
  assert.doesNotMatch(strip(panel), /\.context|nextAction|internalNotes/);
  assert.match(panel, /const \[requestKey, setRequestKey\] = useState\(newKey\);/, "one key per Send — double taps resolve to one Inquiry");
  assert.match(panel, /disabled=\{pending \|\| !intent \|\| !message\.trim\(\)\}/);
  assert.match(panel, /Open Inquiry/);
  assert.doesNotMatch(read("src/lib/business-targets.ts"), /commercial_inquiries|sendCommercialInquiry/, "adding a Target never sends anything");
  assert.match(read(`${V2}/RelationshipWorkspace.tsx`), /\{target && !data\.ours && \(\s*<InquiryPanel/);
  assert.match(read(`${V2}/TargetWorkspace.tsx`), /\{!c\.archived && \(\s*<InquiryPanel/);
});

test("Counterparty UX: Inquiry detail and the thread card show the Inquiry, never the Target", () => {
  const detail = read(DETAIL);
  assert.match(detail, /inquiryActionsFor\(inquiry\.role, inquiry\.status\)/);
  assert.match(detail, /inquiry\.role === "sender" && inquiry\.targetId/, "only the sender gets the way back to its Target");
  assert.match(detail, /<ReplyComposer conversationId=\{thread\.id\}/);
  const messages = read(MESSAGES);
  assert.match(messages, /thread\.subjectType === COMMERCIAL_INQUIRY_SUBJECT \? await getInquiryByConversation\(admin, id\) : null/);
  assert.match(messages, /<InquiryActions key=/, "a Location / Event counterparty can respond from the thread");
});

test("communication policy: an Inquiry thread stays open for replies while direct org messaging is paused", () => {
  const facts = { subjectType: "commercial_inquiry", hasOpportunity: false, parties: [{ entityType: "business", entityId: MOCKTAIL }, { entityType: "business", entityId: BABYLIST }, { entityType: "findmi", entityId: null }] };
  assert.equal(P.canSendInThread(facts, { entityType: "business", entityId: BABYLIST }, false), true);
  assert.equal(P.canSendInThread({ ...facts, subjectType: "business_business_chat" }, { entityType: "business", entityId: BABYLIST }, false), false, "plain org-to-org threads are still paused");
  assert.equal(P.isStructuredThread({ subjectType: "commercial_opportunity", hasOpportunity: false }), false, "the commercial Opportunity rule is unchanged");
});

// ── Regressions ────────────────────────────────────────────────────────────

test("36. the commercial Opportunity thread is untouched", () => {
  const thread = read("src/lib/opportunity-recipient-thread.ts");
  assert.match(thread, /subject_type: COMMERCIAL_OPPORTUNITY_SUBJECT, subject_id: recipient\.id/);
  assert.doesNotMatch(thread, /inquir/i);
  assert.match(read("src/lib/opportunities.ts"), /if \(c\?\.subject_type === "commercial_opportunity"\) \{[\s\S]*?\} else if \(c\?\.subject_type === "commercial_inquiry"\) \{\s*actionUrl = `\/admin\/commercial-inquiries\/\$\{c\.subject_id\}`;/, "only an extra branch for Findmi's link");
});

test("37. event participation is untouched and never duplicated", () => {
  const ops = read("src/lib/opportunities.ts");
  for (const fn of ["export async function createOpportunity(", "export async function resolveOpportunity(", "export async function resolveEventApplicationDecision("]) assert.ok(ops.includes(fn), fn);
  assert.doesNotMatch(strip(read("src/lib/commercial-inquiries.ts")), /createOpportunity|resolveOpportunity|applyToEventPublic/);
  assert.match(read(MIGRATION), /intent in \('placement', 'wholesale', 'distribution', 'collaboration', 'sponsorship', 'sampling', 'activation', 'pop_up', 'vending', 'content', 'booking'\)/, "the table itself refuses event_participation");
});

// ── Migration ──────────────────────────────────────────────────────────────

test("the migration: additive, no destructive statements, constraints for one counterparty / idempotency / one thread", () => {
  const sql = read(MIGRATION);
  assert.doesNotMatch(sql, /\bdrop\b|\btruncate\b|\bdelete\s+from\b|\balter\s+table\s+public\.(business_targets|conversations|conversation_participants|conversation_messages|opportunit)/i);
  assert.match(sql, /check \(num_nonnulls\(counterparty_business_id, counterparty_location_id, counterparty_event_id\) = 1\)/);
  assert.match(sql, /constraint commercial_inquiries_sender_request_key unique \(sender_business_id, request_key\)/);
  assert.match(sql, /create unique index if not exists commercial_inquiries_open_counterparty_intent_key\s+on public\.commercial_inquiries \(sender_business_id, coalesce\(counterparty_business_id, counterparty_location_id, counterparty_event_id\), intent\)\s+where status in \('sent', 'responded'\);/, "open uniqueness = sender + counterparty + intent; never a permanent ban");
  assert.doesNotMatch(sql, /commercial_inquiries_open_counterparty_key\b/, "the per-counterparty rule is gone");
  assert.match(sql, /on public\.conversations \(subject_id\) where subject_type = 'commercial_inquiry';/);
  assert.match(sql, /references public\.business_targets\(id\) on delete set null/, "a deleted Target never deletes the shared Inquiry");
  assert.match(sql, /create or replace trigger trg_commercial_inquiries_status_changed/);
  assert.doesNotMatch(sql, /\b(context|next_action|internal_notes)\b/, "no Target columns copied");
});
