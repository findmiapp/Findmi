// Opportunity Relationship Thread — one Business ↔ Findmi Conversation per
// commercial Opportunity recipient (lib/opportunity-recipient-thread.ts,
// lib/opportunity-thread-domain.ts, the Findmi participant + read state in
// lib/opportunities.ts). In-memory Supabase fake; notifications are stubbed
// and recorded. No network, no production DB. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

globalThis.__sent = [];
const stub = (fn) => `data:text/javascript,export async function ${fn}(n){globalThis.__sent.push({fn:${JSON.stringify(fn)},...n});}`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "@/lib/notifications/productNotify") return { url: stub("sendProductNotification"), shortCircuit: true };
    if (specifier === "@/lib/notifications/adminNotify") return { url: stub("notifyAdmin"), shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const T = await import("../src/lib/opportunity-recipient-thread.ts");
const D = await import("../src/lib/opportunity-thread-domain.ts");
const O = await import("../src/lib/opportunities.ts");
const P = await import("../src/lib/communication-policy.ts");
const LD = await import("../src/lib/opportunity-listings-domain.ts");
const read = (p) => readFileSync(p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ADMIN_ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const LISTINGS = read("src/lib/opportunity-listings.ts");
const THREAD_LIB = read("src/lib/opportunity-recipient-thread.ts");
const THREAD_DOMAIN = read("src/lib/opportunity-thread-domain.ts");
const ADMIN_PAGE = read("src/app/admin/(protected)/opportunities/[id]/thread/[recipientId]/page.tsx");
const BIZ_ACTIONS = read("src/app/(public)/account/business/[id]/opportunities/actions.ts");
const BIZ_PAGE = read("src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx");
const INBOX = read("src/app/(public)/account/messages/page.tsx");
const THREAD_PAGE = read("src/app/(public)/account/messages/[id]/page.tsx");
const MIGRATION = read("supabase/migrations/20261105000000_opportunity_relationship_thread.sql");
const fn = (src, name) => {
  const start = src.indexOf(`export async function ${name}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
};

// ── In-memory Supabase ──────────────────────────────────────────────────────

let seq = 0;
function fakeDb(seed = {}) {
  const t = { conversations: [], conversation_participants: [], conversation_messages: [], opportunity_recipients: [], business_members: [], event_members: [], location_members: [], businesses: [], ...structuredClone(seed) };
  const tick = () => new Promise((r) => setImmediate(r));
  const unique = (table, row) => {
    if (table === "conversations" && row.subject_type === "commercial_opportunity")
      return t.conversations.some((c) => c.subject_type === "commercial_opportunity" && c.subject_id === row.subject_id);
    if (table === "conversation_participants")
      return t.conversation_participants.some((p) => ["conversation_id", "user_id", "entity_type", "entity_id"].every((k) => (p[k] ?? null) === (row[k] ?? null)));
    return false;
  };
  const shape = (table, row) => {
    if (table !== "opportunity_recipients") return { ...row };
    const b = t.businesses.find((x) => x.id === row.business_id);
    return { ...row, business: b ? { name: b.name } : null };
  };
  function from(table) {
    const filters = [];
    let op = "select";
    let payload = null;
    let returning = false;
    const matching = () => (t[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => ((returning = op !== "select"), q),
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      limit: () => q,
      insert: (row) => ((op = "insert"), (payload = row), q),
      update: (patch) => ((op = "update"), (payload = patch), q),
      upsert: (row, opts) => ((op = "upsert"), (payload = { row, opts }), q),
      async run() {
        await tick();
        if (op === "insert") {
          const rows = [].concat(payload);
          for (const row of rows) if (unique(table, row)) return { data: null, error: { code: "23505", message: "duplicate" } };
          const made = rows.map((row) => ({ id: `${table}-${++seq}`, created_at: row.created_at ?? new Date().toISOString(), ...row }));
          t[table].push(...made);
          return { data: returning ? made : null, error: null };
        }
        if (op === "upsert") {
          if (!unique(table, payload.row)) t[table].push({ id: `${table}-${++seq}`, last_read_at: null, ...payload.row });
          return { data: null, error: null };
        }
        if (op === "update") {
          const rows = matching();
          for (const r of rows) Object.assign(r, payload);
          return { data: returning ? rows : null, error: null };
        }
        return { data: matching().map((r) => shape(table, r)), error: null };
      },
      async maybeSingle() {
        const { data, error } = await q.run();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      async single() {
        const { data, error } = await q.run();
        const row = Array.isArray(data) ? data[0] : data;
        return { data: row ?? null, error: error ?? (row ? null : { code: "PGRST116" }) };
      },
      then: (ok, err) => q.run().then(ok, err),
    };
    return q;
  }
  const emails = { "u-owner": "owner@mocktail.test", "u-manager": "manager@mocktail.test", "u-other": "other@babylist.test" };
  return { t, from, auth: { admin: { getUserById: async (id) => ({ data: { user: emails[id] ? { email: emails[id] } : null }, error: null }) } } };
}

const SEED = {
  businesses: [
    { id: "mocktail", name: "Mocktail Mart" },
    { id: "babylist", name: "Babylist" },
  ],
  business_members: [
    { id: "m1", business_id: "mocktail", user_id: "u-owner", role: "owner" },
    { id: "m2", business_id: "mocktail", user_id: "u-manager", role: "manager" },
    { id: "m3", business_id: "babylist", user_id: "u-other", role: "owner" },
  ],
  opportunity_recipients: [
    { id: "rec-new", listing_id: "lst", business_id: "mocktail", status: "offered", conversation_id: null, offered_at: "2026-10-01T10:00:00Z", responded_at: null, status_changed_at: "2026-10-01T10:00:00Z" },
    { id: "rec-old", listing_id: "lst", business_id: "mocktail", status: "interested", conversation_id: null, offered_at: "2026-09-01T10:00:00Z", responded_at: "2026-09-03T10:00:00Z", status_changed_at: "2026-09-03T10:00:00Z" },
    { id: "rec-explore", listing_id: "lst", business_id: "babylist", status: "interested", conversation_id: null, offered_at: "2026-09-05T10:00:00Z", responded_at: "2026-09-05T10:00:00Z", status_changed_at: "2026-09-05T10:00:00Z" },
  ],
};
const bodies = (db, conv) => db.t.conversation_messages.filter((m) => m.conversation_id === conv).map((m) => m.body);

// ── 1–4. Creation: once, idempotent, lazy, concurrency-safe ─────────────────

test("1. sending creates exactly one thread: Business members + Findmi, history starts with the send", async () => {
  const db = fakeDb(SEED);
  const r = await T.ensureRecipientThread(db, "rec-new");
  assert.equal(r.created, true);
  assert.equal(db.t.conversations.length, 1);
  assert.deepEqual(db.t.conversations[0], { ...db.t.conversations[0], subject_type: "commercial_opportunity", subject_id: "rec-new" });
  assert.equal(db.t.opportunity_recipients.find((x) => x.id === "rec-new").conversation_id, r.conversationId);
  const parts = db.t.conversation_participants.map((p) => `${p.entity_type}:${p.entity_id}:${p.user_id}`).sort();
  assert.deepEqual(parts, ["business:mocktail:u-manager", "business:mocktail:u-owner", "findmi:null:null"]);
  assert.deepEqual(bodies(db, r.conversationId), ["Opportunity sent to Mocktail Mart."]);
  assert.match(fn(ADMIN_ACTIONS, "sendOpportunity"), /await Promise\.all\(insertedRows\.map\(\(r\) => ensureRecipientThread\(supabase, r\.id\)\)\)/, "only newly inserted recipients");
});

test("2. retrying never creates a second thread, participant or history line", async () => {
  const db = fakeDb(SEED);
  const a = await T.ensureRecipientThread(db, "rec-new");
  const b = await T.ensureRecipientThread(db, "rec-new");
  assert.equal(b.conversationId, a.conversationId);
  assert.equal(b.created, false);
  assert.equal(db.t.conversations.length, 1);
  assert.equal(db.t.conversation_participants.length, 3);
  assert.equal(db.t.conversation_messages.length, 1);
});

test("3. an existing recipient with NULL conversation_id gains one lazily, seeded from its own timestamps", async () => {
  const db = fakeDb(SEED);
  const r = await T.ensureRecipientThread(db, "rec-old");
  const msgs = db.t.conversation_messages.filter((m) => m.conversation_id === r.conversationId);
  assert.deepEqual(msgs.map((m) => [m.body, m.created_at, m.kind]), [
    ["Opportunity sent to Mocktail Mart.", "2026-09-01T10:00:00Z", "system"],
    ["Mocktail Mart is interested.", "2026-09-03T10:00:00Z", "system"],
  ]);
  const explore = await T.ensureRecipientThread(db, "rec-explore");
  assert.deepEqual(bodies(db, explore.conversationId), ["Babylist is interested."], "Explore hand-raise was never 'sent'");
  assert.match(MIGRATION, /no row changes; nothing is backfilled/i);
});

test("4. concurrent ensures resolve to one thread (unique subject index + conditional link)", async () => {
  const db = fakeDb(SEED);
  const [a, b] = await Promise.all([T.ensureRecipientThread(db, "rec-new"), T.ensureRecipientThread(db, "rec-new")]);
  assert.equal(a.conversationId, b.conversationId);
  assert.equal(db.t.conversations.length, 1);
  assert.equal([a.created, b.created].filter(Boolean).length, 1);
  assert.equal(db.t.conversation_messages.length, 1, "history seeded once");
  assert.equal(db.t.conversation_participants.length, 3);
  assert.match(THREAD_LIB, /\.update\(\{ conversation_id: conversationId \}\)\.eq\("id", recipient\.id\)\.is\("conversation_id", null\)/);
  assert.match(MIGRATION, /create unique index if not exists conversations_commercial_opportunity_subject_key\s+on public\.conversations \(subject_id\) where subject_type = 'commercial_opportunity';/);
});

// ── 5–8. Access ─────────────────────────────────────────────────────────────

test("5–7. the recipient Business's members can read; another Business and a public user cannot", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  assert.equal(await O.isAuthorizedForConversation(db, conversationId, "u-owner"), true);
  assert.equal(await O.isAuthorizedForConversation(db, conversationId, "u-manager"), true);
  assert.equal(await O.isAuthorizedForConversation(db, conversationId, "u-other"), false, "Babylist never sees Mocktail's thread");
  assert.equal(await O.isAuthorizedForConversation(db, conversationId, "u-public"), false);
  // The Findmi row (no user, no entity) can never authorize anyone.
  const findmi = db.t.conversation_participants.find((p) => p.entity_type === "findmi");
  assert.equal(findmi.user_id, null);
  assert.equal(findmi.entity_id, null);
  // Business opener: membership + recipient must belong to THIS Business.
  const open = fn(LISTINGS, "openBusinessOpportunityThread");
  assert.match(open, /await requireBusinessMember\(args\.businessId\)/);
  assert.match(open, /\.eq\("id", args\.recipientId\)\.eq\("business_id", args\.businessId\)/);
});

test("8. Admin can open and reply — every write is requireAdmin-gated and scoped to a recipient of that listing", () => {
  for (const name of ["openRecipientThread", "sendFindmiReply"]) {
    const body = fn(ADMIN_ACTIONS, name);
    assert.match(body, /^export async function \w+\([^)]*\) \{\n\s+await requireAdmin\(\);/, name);
    assert.match(body, /\.eq\("id", recipientId\)\.eq\("listing_id", listingId\)/, name);
  }
  assert.match(ADMIN_PAGE, /\.eq\("id", recipientId\)\s*\.eq\("listing_id", id\)/);
  assert.match(read("src/app/admin/(protected)/opportunities/RecipientCard.tsx"), /openRecipientThread\.bind\(null, listingId, r\.id\)/);
  // The global admin Conversations view stays read-only.
  assert.doesNotMatch(read("src/app/admin/(protected)/conversations/[id]/page.tsx"), /<form|action=/);
});

// ── 9–11. Findmi as itself ──────────────────────────────────────────────────

test("9–11. Findmi sends as Findmi; the Business sees “Findmi”; no admin identity is stored or shown", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  globalThis.__sent = [];
  await O.sendFindmiMessage(db, conversationId, "Can you bring samples Friday?");
  const msg = db.t.conversation_messages.at(-1);
  const sender = db.t.conversation_participants.find((p) => p.id === msg.sender_participant_id);
  assert.deepEqual([msg.kind, sender.entity_type, sender.user_id], ["text", "findmi", null]);
  const thread = await O.getConversationThread(db, conversationId, "u-owner");
  const shown = thread.messages.find((m) => m.body === "Can you bring samples Friday?");
  assert.equal(shown.senderLabel, "Findmi");
  assert.ok(thread.parties.some((p) => p.entityType === "findmi" && p.label === "Findmi"));
  // The reply action passes only the body — nothing about who is signed in.
  assert.match(fn(ADMIN_ACTIONS, "sendFindmiReply"), /await sendFindmiMessage\(supabase, thread!\.conversationId, body!\);/);
  assert.match(MIGRATION, /check \(\(\(entity_type = 'findmi'\) = \(user_id is null\)\) and \(entity_type <> 'findmi' or entity_id is null\)\)/);
  // A Business can never post as Findmi.
  assert.match(read("src/app/(public)/connect/actions.ts"), /if \(actingEntityType !== "business" && actingEntityType !== "event" && actingEntityType !== "location" && actingEntityType !== "personal"\)/);
});

// ── 12–17. System messages ──────────────────────────────────────────────────

test("12–17. lifecycle history lines use the real recipient states", () => {
  const m = (s, by = "findmi") => D.recipientStatusMessage(s, "Mocktail Mart", by);
  assert.equal(m("offered"), "Opportunity sent to Mocktail Mart.");
  assert.equal(m("interested", "business"), "Mocktail Mart is interested.");
  assert.equal(m("not_interested", "business"), "Mocktail Mart is not interested.");
  assert.equal(m("confirmed"), "Findmi confirmed this Opportunity.");
  assert.equal(m("completed"), "Findmi marked this Opportunity completed.");
  assert.equal(m("cancelled"), "Findmi cancelled this Opportunity.");
  assert.equal(m("withdrawn"), "Findmi withdrew this Opportunity.");
  assert.equal(m("interested"), "Findmi moved this Opportunity back to Interested.");
});

test("12–17. moves are recorded in the thread — Business answers and Findmi outcomes — without double lines", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  await T.recordRecipientStatus(db, "rec-new", "interested", "business");
  await T.recordRecipientStatus(db, "rec-new", "confirmed", "findmi");
  await T.recordRecipientStatus(db, "rec-new", "completed", "findmi");
  assert.deepEqual(bodies(db, conversationId), ["Opportunity sent to Mocktail Mart.", "Mocktail Mart is interested.", "Findmi confirmed this Opportunity.", "Findmi marked this Opportunity completed."]);
  // First touch of a thread-less recipient: the seed already says it once.
  db.t.opportunity_recipients.find((x) => x.id === "rec-old").status = "not_interested";
  const old = await T.recordRecipientStatus(db, "rec-old", "not_interested", "business");
  assert.equal(bodies(db, old).filter((b) => b === "Mocktail Mart is not interested.").length, 1);
  assert.match(fn(ADMIN_ACTIONS, "setRecipientStatus"), /await recordRecipientStatus\(supabase, recipientId, next, "findmi"\);/);
  assert.match(fn(LISTINGS, "respondToOpportunityListing"), /await recordRecipientStatus\(admin, args\.recipientId, args\.response, "business"\);/);
  assert.match(fn(LISTINGS, "expressExploreInterest"), /await ensureRecipientThread\(admin, data\.id as string\);/);
});

// ── 18–19. Notifications ────────────────────────────────────────────────────

test("18. a Findmi message uses the existing new-message email to the Business's members, never Admin", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  globalThis.__sent = [];
  await O.sendFindmiMessage(db, conversationId, "Hello from Findmi");
  assert.equal(globalThis.__sent.length, 1);
  const [n] = globalThis.__sent;
  assert.equal(n.fn, "sendProductNotification");
  assert.equal(n.type, "message_new");
  assert.deepEqual([...n.to].sort(), ["manager@mocktail.test", "owner@mocktail.test"]);
});

test("18b. a Business reply notifies Findmi (Admin) once, linking to the Admin thread", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  globalThis.__sent = [];
  await O.notifyNewMessage(db, conversationId, "u-owner", "business", "mocktail", "Yes, Friday works.", "Mocktail Mart");
  const admin = globalThis.__sent.filter((n) => n.fn === "notifyAdmin");
  assert.equal(admin.length, 1);
  assert.equal(admin[0].actionUrl, "/admin/opportunities/lst/thread/rec-new");
  const biz = globalThis.__sent.filter((n) => n.fn === "sendProductNotification");
  assert.deepEqual(biz.map((n) => n.to), [["manager@mocktail.test"]], "the co-manager hears; the sender doesn't");
});

test("19. an Admin outcome emails the Business exactly once (Confirmed / Cancelled / Withdrawn); history lines send nothing", async () => {
  assert.ok(D.businessNotificationForAdminStatus("confirmed", "Pop-Up"));
  assert.ok(D.businessNotificationForAdminStatus("cancelled", "Pop-Up"));
  assert.ok(D.businessNotificationForAdminStatus("withdrawn", "Pop-Up"));
  for (const s of ["offered", "interested", "not_interested", "completed"]) assert.equal(D.businessNotificationForAdminStatus(s, "Pop-Up"), null, s);
  const db = fakeDb(SEED);
  await T.ensureRecipientThread(db, "rec-new");
  globalThis.__sent = [];
  await T.recordRecipientStatus(db, "rec-new", "confirmed", "findmi");
  assert.equal(globalThis.__sent.length, 0, "the system line itself never emails");
  const body = fn(ADMIN_ACTIONS, "setRecipientStatus");
  assert.equal((body.match(/sendProductNotification\(/g) ?? []).length, 1);
  assert.doesNotMatch(body, /sendFindmiMessage|notifyNewMessage/);
});

// ── 20–22. Read state ───────────────────────────────────────────────────────

test("20–21. opening marks read for that viewer only; unread is per participant; system lines never count", async () => {
  const db = fakeDb(SEED);
  const { conversationId } = await T.ensureRecipientThread(db, "rec-new");
  await O.sendFindmiMessage(db, conversationId, "Question for you");
  const rowsFor = (u) => db.t.conversation_participants.filter((p) => p.user_id === u);
  const msgs = () => db.t.conversation_messages;
  assert.equal(O.isConversationUnread(rowsFor("u-owner"), msgs()), true);
  await O.markConversationRead(db, conversationId, "u-owner", [{ entityType: "business", entityId: "mocktail" }]);
  assert.ok(rowsFor("u-owner")[0].last_read_at);
  assert.equal(O.isConversationUnread(rowsFor("u-owner"), msgs()), false);
  assert.equal(O.isConversationUnread(rowsFor("u-manager"), msgs()), true, "the co-manager hasn't opened it");
  assert.equal(O.isConversationUnread([{ id: "x", last_read_at: null }], [{ kind: "system", sender_participant_id: null, created_at: "2026-10-01" }]), false);
  assert.equal(O.isConversationUnread([{ id: "x", last_read_at: null }], [{ kind: "text", sender_participant_id: "x", created_at: "2026-10-01" }]), false, "own message");
  assert.match(THREAD_PAGE, /await markConversationRead\(\s*admin,\s*id,\s*user\.id,/);
  assert.match(ADMIN_PAGE, /if \(conversation\) await markFindmiRead\(admin, conversation\.id\);/);
  assert.match(MIGRATION, /add column if not exists last_read_at timestamptz;/);
});

test("22. the Inbox shows an unread dot per thread and a small unread count", () => {
  assert.match(INBOX, /const unreadCount = conversations\.filter\(\(c\) => c\.unread\)\.length;/);
  assert.match(INBOX, /\{unreadCount\} Unread/);
  assert.match(INBOX, /\{c\.unread && <span aria-label="Unread"/);
  assert.match(read("src/lib/opportunities.ts"), /unread: isConversationUnread\(/);
});

// ── 23–24. Requests unchanged ───────────────────────────────────────────────

test("23–24. unread never creates a Business Home Request; Requests stays offered + open", () => {
  const lib = read("src/lib/business-requests.ts");
  assert.doesNotMatch(strip(lib), /conversation|unread|last_read/i);
  assert.match(lib, /opportunities\.filter\(\(o\) => o\.group === "for_you"\)/);
  assert.equal(LD.businessOpportunityGroup("open", "offered"), "for_you");
  for (const s of ["interested", "confirmed", "not_interested", "cancelled", "withdrawn", "completed"]) assert.notEqual(LD.businessOpportunityGroup("open", s), "for_you", s);
  assert.equal(LD.businessOpportunityGroup("closed", "offered"), "past");
});

// ── 25. Boundaries ──────────────────────────────────────────────────────────

test("25. no placements, Location operator, booking, location_requests or automatic outcomes", () => {
  const touched = [THREAD_LIB, THREAD_DOMAIN, ADMIN_PAGE, MIGRATION, fn(LISTINGS, "openBusinessOpportunityThread"), fn(ADMIN_ACTIONS, "openRecipientThread"), fn(ADMIN_ACTIONS, "sendFindmiReply")].map(strip).join("\n");
  assert.doesNotMatch(touched, /placement|location_requests|booking/i);
  assert.doesNotMatch(touched, /from\("(appearances|events|event_businesses|event_occurrences|business_location_availability|opportunities)"\)/);
  assert.doesNotMatch(THREAD_LIB, /"location"/, "the Location/operator is never added");
  assert.match(THREAD_LIB, /addEntityParticipants\(admin, conversationId, "business", recipient\.business_id\)/);
  assert.doesNotMatch(read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx"), /unread|conversation/i);
});

// ── 26. Event participation untouched ───────────────────────────────────────

test("26. event participation threads are unchanged: own subject, Findmi never a party, org-to-org rules intact", () => {
  assert.equal(D.COMMERCIAL_OPPORTUNITY_SUBJECT, "commercial_opportunity");
  assert.notEqual(D.COMMERCIAL_OPPORTUNITY_SUBJECT, "opportunity");
  const parties = [{ entityType: "business", entityId: "mocktail" }, { entityType: "findmi", entityId: null }];
  assert.equal(P.canSendInThread({ subjectType: "commercial_opportunity", hasOpportunity: false, parties }, parties[0], false), true, "a Business can always reply to Findmi");
  const orgs = [{ entityType: "business", entityId: "a" }, { entityType: "business", entityId: "b" }];
  assert.equal(P.canSendInThread({ subjectType: "direct", hasOpportunity: false, parties: orgs }, orgs[0], false), false, "paused org-to-org stays paused");
  assert.equal(P.canSendInThread({ subjectType: "opportunity", hasOpportunity: true, parties: orgs }, orgs[0], false), true, "event Opportunity threads still reply");
  assert.match(read("src/app/(public)/account/messages/page.tsx"), /allConversations\.filter\(\(c\) => c\.subjectType !== "opportunity"\)/);
  assert.match(BIZ_PAGE, /openOpportunityThread\.bind\(null, id, view\.recipientId\)/);
  assert.match(BIZ_ACTIONS, /result = await openBusinessOpportunityThread\(\{ businessId, recipientId \}\);/);
});
