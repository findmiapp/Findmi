// Bounded Production security audit — regression tests for the two HIGH
// fixes. Real modules, in-memory doubles; no network, no database.
//   1. Tally vendor-onboarding webhook: the target Business comes only from
//      the server-stored membership, never from the form's hidden field.
//   2. Admin session: a cookie can never verify when ADMIN_PASSWORD is
//      unset (the HMAC key would otherwise be SHA-256("")).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return js("export{}");
    if (specifier === "./opportunities" && context.parentURL?.endsWith("/event-participation.ts")) return js("export async function createOpportunity(){}");
    if (specifier === "./appearance-event-sync" && context.parentURL?.endsWith("/event-participation.ts")) return js("export async function ensureEventAppearance(){}");
    if (specifier === "next/headers") return js("export const cookies=async()=>({get:()=>undefined,set(){},delete(){}});");
    if (specifier === "next/server")
      return js("export const NextResponse={json:(body,init)=>({body,status:init?.status??200})};");
    if (specifier === "@/lib/admin/supabase-admin") return js("export const getAdminSupabase=()=>globalThis.__db;");
    if (specifier === "@/lib/notifications/claimNotification") return js("export async function notifyFounderOfPaidClaim(){}");
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolvePath(process.cwd(), "src", `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    return next(specifier, context);
  },
});

// ---------------------------------------------------------------- admin session

const AUTH = await import("../src/lib/admin/auth.ts");
const forge = (password, expiry = Date.now() + 3_600_000, version = "1") => {
  const key = createHash("sha256").update(password).digest();
  return `${expiry}.${version}.${createHmac("sha256", key).update(`${expiry}.${version}`).digest("hex")}`;
};

test("admin cookie: a token forged with the empty-password key never verifies when ADMIN_PASSWORD is unset", async () => {
  const saved = process.env.ADMIN_PASSWORD;
  try {
    delete process.env.ADMIN_PASSWORD;
    assert.equal(await AUTH.verifyToken(forge("")), false, "unset");
    process.env.ADMIN_PASSWORD = "";
    assert.equal(await AUTH.verifyToken(forge("")), false, "empty");
  } finally {
    if (saved === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = saved;
  }
});

test("admin cookie: with a password set, only a token signed with that password verifies", async () => {
  const saved = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    assert.equal(await AUTH.verifyToken(forge("correct horse battery staple")), true, "the real admin session still works");
    assert.equal(await AUTH.verifyToken(forge("")), false);
    assert.equal(await AUTH.verifyToken(forge("wrong")), false);
    assert.equal(await AUTH.verifyToken(forge("correct horse battery staple", Date.now() - 1)), false, "expired");
  } finally {
    if (saved === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = saved;
  }
});

// ---------------------------------------------------------------- tally webhook

function fakeDb(tables) {
  const writes = [];
  const from = (table) => {
    const filters = [];
    let op = { kind: "select" };
    const rows = () => (tables[table] ??= []).filter((r) => filters.every(([k, v]) => r[k] === v));
    const exec = () => {
      if (op.kind === "update") {
        const hit = rows();
        for (const r of hit) Object.assign(r, op.patch);
        writes.push({ table, kind: "update", filters: [...filters], patch: op.patch });
        return { data: hit, error: null };
      }
      if (op.kind === "insert") {
        const row = { id: `new-${table}-${(tables[table] ??= []).length + 1}`, ...op.row };
        tables[table].push(row);
        writes.push({ table, kind: "insert", row });
        return { data: row, error: null };
      }
      if (op.kind === "delete") return { data: null, error: null };
      return { data: rows(), error: null };
    };
    const api = {
      select: () => api,
      update: (patch) => ((op = { kind: "update", patch }), api),
      insert: (row) => ((op = { kind: "insert", row }), api),
      delete: () => ((op = { kind: "delete" }), api),
      eq: (k, v) => (filters.push([k, v]), api),
      ilike: () => api,
      maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
      single: async () => exec(),
      then: (resolve, reject) => Promise.resolve(exec()).then(resolve, reject),
    };
    return api;
  };
  return { from, writes, tables };
}

const { POST } = await import("../src/app/api/webhooks/tally/route.ts");
const VICTIM = "11111111-1111-4111-8111-111111111111";
const OWN = "22222222-2222-4222-8222-222222222222";
const field = (label, value) => ({ label, type: "HIDDEN_FIELDS", value });
const submit = (fields) => {
  const body = JSON.stringify({ data: { fields } });
  const signature = createHmac("sha256", process.env.TALLY_WEBHOOK_SECRET).update(body).digest("base64");
  return POST({ text: async () => body, headers: { get: (h) => (h === "tally-signature" ? signature : null) } });
};
const world = (membership) => ({
  memberships: [{ id: "m1", plan_id: null, billing_status: "invited", business_id: null, existing_business_id: null, ...membership }],
  businesses: [
    { id: VICTIM, name: "Victim Brand", publication_status: "live" },
    { id: OWN, name: "Own Brand", publication_status: "live" },
  ],
});
process.env.TALLY_WEBHOOK_SECRET = "test-secret";

test("tally: a forged existing_business_id hidden field can't redirect the update to another Business", async () => {
  globalThis.__db = fakeDb(world({}));
  const res = await submit([field("membership_id", "m1"), field("existing_business_id", VICTIM), field("Business Name", "Attacker Co")]);
  assert.equal(res.status, 200);
  const db = globalThis.__db;
  const victim = db.tables.businesses.find((b) => b.id === VICTIM);
  assert.deepEqual(victim, { id: VICTIM, name: "Victim Brand", publication_status: "live" }, "victim untouched");
  assert.equal(db.writes.some((w) => w.table === "businesses" && w.kind === "update"), false);
  assert.ok(db.writes.some((w) => w.table === "businesses" && w.kind === "insert" && w.row.name === "Attacker Co"), "a new Business is created instead");
  assert.notEqual(db.tables.memberships[0].business_id, VICTIM, "membership never linked to the victim");
});

test("tally: the Admin-assigned existing Business (server-stored) is still updated — the legitimate flow", async () => {
  globalThis.__db = fakeDb(world({ existing_business_id: OWN }));
  // Even when the link's hidden field names someone else.
  const res = await submit([field("membership_id", "m1"), field("existing_business_id", VICTIM), field("Business Name", "Own Brand Updated")]);
  assert.equal(res.status, 200);
  const db = globalThis.__db;
  assert.equal(db.tables.businesses.find((b) => b.id === OWN).name, "Own Brand Updated");
  assert.equal(db.tables.businesses.find((b) => b.id === VICTIM).name, "Victim Brand");
  assert.equal(db.tables.memberships[0].business_id, OWN);
});

test("tally: a membership already linked to a Business only ever updates that Business", async () => {
  globalThis.__db = fakeDb(world({ business_id: OWN }));
  await submit([field("membership_id", "m1"), field("existing_business_id", VICTIM), field("Business Name", "Resubmitted")]);
  const db = globalThis.__db;
  assert.deepEqual(
    db.writes.filter((w) => w.table === "businesses" && w.kind === "update").map((w) => w.filters),
    [[["id", OWN]]]
  );
  assert.equal(db.tables.businesses.find((b) => b.id === VICTIM).name, "Victim Brand");
});

test("tally: a bad signature is still rejected before any write", async () => {
  globalThis.__db = fakeDb(world({}));
  const body = JSON.stringify({ data: { fields: [field("membership_id", "m1"), field("existing_business_id", VICTIM)] } });
  const res = await POST({ text: async () => body, headers: { get: (h) => (h === "tally-signature" ? "forged" : null) } });
  assert.equal(res.status, 401);
  assert.equal(globalThis.__db.writes.length, 0);
});

// ---------------------------------------------------------------- event participation

const { readFileSync } = await import("node:fs");
const EP = await import("../src/lib/event-participation.ts");
const rowDb = (status) => ({
  from: () => {
    const api = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: status ? { status } : null, error: null }) };
    return api;
  },
});

test("event participation: the organizer may approve only a Business-initiated request, never its own invitation", async () => {
  assert.equal(EP.organizerMayApprove("applied"), true, "Business applied → organizer may approve");
  assert.equal(EP.organizerMayApprove("pending"), true);
  for (const s of ["invited", "approved", "declined", null]) assert.equal(EP.organizerMayApprove(s), false, String(s));
  assert.equal(await EP.organizerApprovalBlocked(rowDb("invited"), "e", "b"), true, "invite-then-self-approve is blocked");
  assert.equal(await EP.organizerApprovalBlocked(rowDb(null), "e", "b"), true, "no row at all is blocked");
  assert.equal(await EP.organizerApprovalBlocked(rowDb("applied"), "e", "b"), false, "a real application can still be approved");
});

const fnBody = (src, name) => {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, name);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};

test("event participation: both organizer approval paths check the row BEFORE writing approval / creating Appearances", () => {
  const ev = fnBody(readFileSync("src/app/(public)/account/event/actions.ts", "utf8"), "updateParticipatingBusinessStatus");
  const guard = ev.indexOf("organizerApprovalBlocked(admin, eventId, businessId)");
  assert.ok(guard > 0 && guard < ev.indexOf('.from("event_businesses")') && guard < ev.indexOf("realizeEventLevelApproval("));
  const th = fnBody(readFileSync("src/app/(public)/connect/actions.ts", "utf8"), "respondToApplicationInThread");
  const guard2 = th.indexOf("organizerApprovalBlocked(admin, eventId, businessId)");
  assert.ok(guard2 > 0 && guard2 < th.indexOf('.from("event_businesses")') && guard2 < th.indexOf("realizeEventLevelApproval("));
});

test("event dates: removing a date verifies it belongs to THIS Event before cancelling any Appearances", () => {
  const rm = fnBody(readFileSync("src/app/(public)/account/event/actions.ts", "utf8"), "removeMemberEventDate");
  const own = rm.indexOf('.from("event_occurrences").select("id").eq("id", occurrenceId).eq("event_id", eventId)');
  const bail = rm.indexOf("if (!ownDate) redirect(");
  const cancel = rm.indexOf("cancelOfficialOccurrenceAppearances(admin, occurrenceId)");
  assert.ok(own > 0 && own < bail && bail < cancel, "ownership check → refuse → only then cancel");
});
