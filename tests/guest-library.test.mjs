// Guest Library — signed-out Collections and list saves on this device,
// merged into the account on sign-in (lib/guest-library.ts,
// /api/collections/import, components/GuestLibrarySync.tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

// The import route runs against an in-memory Supabase stand-in.
const SERVER_STUB = "data:text/javascript," + encodeURIComponent("export async function getServerSupabase(){ return globalThis.__sb; }");
const NEXT_STUB = "data:text/javascript," + encodeURIComponent("export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200, json: async () => body }) };");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/supabase/server") return { url: SERVER_STUB, shortCircuit: true };
    if (specifier === "next/server") return { url: NEXT_STUB, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const G = await import("../src/lib/guest-library.ts");
const { POST } = await import("../src/app/api/collections/import/route.ts");

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const E = (type, n, name = `Thing ${n}`) => ({ type, id: ID(n), name, href: `/${type}/thing-${n}` });
const T = 1_800_000_000_000;

// ---------------------------------------------------------------- pure rules

test("versioned, validated format: bad JSON / wrong version / malformed items are dropped, never trusted", () => {
  assert.deepEqual(G.parseGuestLibrary(null, T), G.emptyGuestLibrary(T));
  assert.deepEqual(G.parseGuestLibrary("{oops", T), G.emptyGuestLibrary(T));
  assert.deepEqual(G.parseGuestLibrary(JSON.stringify({ v: 2, collections: [] }), T), G.emptyGuestLibrary(T), "unknown version → fresh");
  const lib = G.parseGuestLibrary(
    JSON.stringify({
      v: 1,
      saves: 4,
      reminder: "dismissed",
      collections: [
        { key: "g_abc12345", name: "  Gift   Ideas ", items: [E("product", 1), E("product", 1), { type: "user", id: ID(9) }, { type: "event", id: "not-a-uuid" }, { ...E("event", 2), href: "javascript:alert(1)" }] },
        { key: "g_abc12346", name: "gift ideas", items: [] },
        { key: "bad key", name: "X", items: [] },
      ],
      relations: [{ ...E("location", 3), relation: "been" }, { ...E("location", 3), relation: "been" }, { ...E("location", 4), relation: "owner" }],
      email: "someone@example.com",
    }),
    T
  );
  assert.equal(lib.collections.length, 1, "duplicate name (any case) and bad keys dropped");
  assert.equal(lib.collections[0].name, "Gift Ideas");
  assert.deepEqual(lib.collections[0].items.map((i) => `${i.type}:${i.id}`), [`product:${ID(1)}`, `event:${ID(2)}`], "deduped; unknown types / bad ids dropped");
  assert.equal(lib.collections[0].items[1].href, null, "unsafe links never kept");
  assert.equal(lib.relations.length, 1, "duplicates and unknown relations dropped");
  assert.equal(lib.reminder, "dismissed");
  assert.equal("email" in lib, false, "nothing about an account is kept");
});

test("saving to lists and Collections; duplicates are no-ops; names unique ignoring case", () => {
  let lib = G.emptyGuestLibrary(T);
  lib = G.setGuestRelation(lib, E("location", 1), "want", true, T);
  lib = G.setGuestRelation(lib, E("location", 1), "want", true, T);
  assert.equal(lib.relations.length, 1, "a duplicate save doesn't add a second row");
  assert.deepEqual([...G.guestRelationsFor(lib, E("location", 1))], ["want"]);
  const made = G.createGuestCollection(lib, "Date Night", E("event", 2), T, "g_aaaaaaaa");
  assert.ok(made.ok);
  lib = made.lib;
  assert.deepEqual(G.createGuestCollection(lib, "date  night", undefined, T), { ok: false, error: "duplicate" });
  assert.deepEqual(G.createGuestCollection(lib, "   ", undefined, T), { ok: false, error: "name" });
  lib = G.setGuestCollectionItem(lib, "g_aaaaaaaa", E("event", 2), true, T);
  assert.equal(lib.collections[0].items.length, 1, "already in it: no duplicate");
  lib = G.setGuestCollectionItem(lib, "g_aaaaaaaa", E("business", 3), true, T);
  assert.deepEqual([...G.guestCollectionsContaining(lib, E("business", 3))], ["g_aaaaaaaa"]);
  lib = G.setGuestRelation(lib, E("location", 1), "want", false, T);
  assert.equal(lib.relations.length, 0);
});

test("one reminder after ~3 saves; dismissible; saving keeps working without repeated prompts", () => {
  let lib = G.emptyGuestLibrary(T);
  lib = G.setGuestRelation(lib, E("event", 1), "want", true, T);
  lib = G.setGuestRelation(lib, E("event", 2), "want", true, T);
  assert.equal(G.shouldShowGuestReminder(lib), false, "not after two");
  lib = G.setGuestRelation(lib, E("event", 3), "must_do", true, T);
  assert.equal(G.shouldShowGuestReminder(lib), true, "after three successful saves");
  lib = G.dismissGuestReminder(lib, T);
  for (let i = 4; i < 12; i++) lib = G.setGuestRelation(lib, E("event", i), "want", true, T);
  assert.equal(G.shouldShowGuestReminder(lib), false, "never again once dismissed");
  assert.equal(lib.relations.length, 11, "and saving still works");
  // Removing doesn't count as saving.
  const fresh = G.setGuestRelation(G.setGuestRelation(G.emptyGuestLibrary(T), E("event", 1), "want", true, T), E("event", 1), "want", false, T);
  assert.equal(fresh.saves, 1);
});

test("import payload: ids, types and relations only — no display names, no local keys", () => {
  let lib = G.createGuestCollection(G.emptyGuestLibrary(T), "Gifts", E("product", 1), T, "g_bbbbbbbb").lib;
  lib = G.setGuestRelation(lib, E("location", 2), "been", true, T);
  const p = G.toImportPayload(lib);
  assert.deepEqual(p, { v: 1, collections: [{ name: "Gifts", items: [{ type: "product", id: ID(1) }] }], relations: [{ type: "location", id: ID(2), relation: "been" }] });
});

test("storage failures (private browsing, full, blocked): the library lives in memory for the visit, never throws", () => {
  const prev = globalThis.window;
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, addEventListener() {}, removeEventListener() {} };
  let lib = G.setGuestRelation(G.emptyGuestLibrary(T), E("event", 1), "want", true, T);
  assert.equal(G.writeGuestLibrary(lib), true);
  assert.equal(G.readGuestLibrary().persistent, true);
  assert.equal(G.readGuestLibrary().lib.relations.length, 1, "round-trips");
  globalThis.window.localStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  lib = G.setGuestRelation(lib, E("event", 2), "want", true, T);
  assert.equal(G.writeGuestLibrary(lib), false, "says it's memory-only");
  const r = G.readGuestLibrary();
  assert.equal(r.persistent, false);
  assert.equal(r.lib.relations.length, 2, "this visit's saves are still there");
  assert.doesNotThrow(() => G.clearGuestLibrary());
  globalThis.window = prev;
});

// ---------------------------------------------------------------- account merge

function fakeSupabase({ user = { id: "u1" }, visible = [], collections = [], items = [], relations = [], failItems = false } = {}) {
  const db = { collections: collections.map((c) => ({ ...c })), items: items.map((i) => ({ ...i })), relations: relations.map((r) => ({ ...r })) };
  let seq = 100;
  const visibleSet = new Set(visible);
  const result = (data, error = null) => ({ data, error, then: (res) => res({ data, error }) });
  const from = (table) => ({
    select(cols) {
      const q = {
        in: (_col, ids) => result(ids.filter((id) => visibleSet.has(`${table}:${id}`)).map((id) => ({ id }))),
        eq: (_col, uid) => result(db.collections.filter((c) => c.user_id === uid).map(({ id, name }) => ({ id, name }))),
      };
      void cols;
      return q;
    },
    insert(row) {
      if (table === "user_collections") {
        const dup = db.collections.some((c) => c.user_id === row.user_id && c.name.trim().toLowerCase() === row.name.trim().toLowerCase());
        const created = dup ? null : { id: `c${seq++}`, ...row };
        if (created) db.collections.push(created);
        return { select: () => ({ single: async () => (dup ? { data: null, error: { code: "23505" } } : { data: { id: created.id }, error: null }) }) };
      }
      if (table === "user_collection_items") {
        if (failItems) return result(null, { code: "XX000" });
        const dup = db.items.some((i) => i.collection_id === row.collection_id && i.entity_type === row.entity_type && i.entity_id === row.entity_id);
        if (!dup) db.items.push(row);
        return result(null, dup ? { code: "23505" } : null);
      }
      if (table === "user_entity_relationships") {
        const dup = db.relations.some((r) => r.user_id === row.user_id && r.entity_type === row.entity_type && r.entity_id === row.entity_id && r.relation === row.relation);
        if (!dup) db.relations.push(row);
        return result(null, dup ? { code: "23505" } : null);
      }
      throw new Error(`unexpected insert into ${table}`);
    },
  });
  return { db, auth: { getUser: async () => ({ data: { user } }) }, from };
}
const call = async (payload) => (await POST({ json: async () => payload })).body;

const PAYLOAD = {
  v: 1,
  collections: [
    { name: "Date Night", items: [{ type: "event", id: ID(1) }, { type: "location", id: ID(2) }, { type: "event", id: ID(99) }] },
    { name: "Gifts", items: [{ type: "product", id: ID(3) }] },
  ],
  relations: [
    { type: "location", id: ID(2), relation: "want" },
    { type: "event", id: ID(1), relation: "must_do" },
    { type: "product", id: ID(3), relation: "want" },
    { type: "business", id: ID(4), relation: "been" },
  ],
};
const VISIBLE = [`events:${ID(1)}`, `locations:${ID(2)}`, `products:${ID(3)}`, `businesses:${ID(4)}`];

test("sign-in merge: same-named Collections merge (any case), new ones are created, account items are never duplicated", async () => {
  const sb = fakeSupabase({ visible: VISIBLE, collections: [{ id: "c1", user_id: "u1", name: "date night" }], items: [{ collection_id: "c1", entity_type: "event", entity_id: ID(1) }] });
  globalThis.__sb = sb;
  const r = await call(PAYLOAD);
  assert.equal(r.ok, true);
  assert.equal(r.createdCollections, 1, "Gifts is new; Date Night merged into the existing one");
  assert.deepEqual(sb.db.items.filter((i) => i.collection_id === "c1").map((i) => i.entity_id).sort(), [ID(1), ID(2)].sort(), "existing item kept once, new one added");
  assert.equal(r.skipped, 1, "an entity that doesn't exist / isn't visible is skipped");
  assert.deepEqual(sb.db.relations.map((x) => `${x.entity_type}:${x.relation}`).sort(), ["event:must_do", "location:want"], "Product Want (own control) and disallowed relations are never imported");
});

test("interrupted sync: running the same import again changes nothing (idempotent)", async () => {
  const sb = fakeSupabase({ visible: VISIBLE });
  globalThis.__sb = sb;
  await call(PAYLOAD);
  const snapshot = JSON.stringify(sb.db);
  const again = await call(PAYLOAD);
  assert.equal(again.ok, true);
  assert.equal(again.createdCollections, 0);
  assert.equal(again.addedItems, 0);
  assert.equal(again.addedRelations, 0);
  assert.equal(JSON.stringify(sb.db), snapshot);
});

test("a real failure reports ok:false so the device keeps its copy; signed out / wrong version are refused", async () => {
  globalThis.__sb = fakeSupabase({ visible: VISIBLE, failItems: true });
  const r = await call(PAYLOAD);
  assert.equal(r.ok, false);
  globalThis.__sb = fakeSupabase({ user: null });
  assert.equal((await POST({ json: async () => PAYLOAD })).status, 401);
  globalThis.__sb = fakeSupabase({ visible: VISIBLE });
  assert.equal((await POST({ json: async () => ({ ...PAYLOAD, v: 9 }) })).status, 400);
});

test("the device copy is cleared only after a confirmed merge of that exact copy; switching accounts can't inherit it", () => {
  const sync = readFileSync("src/components/GuestLibrarySync.tsx", "utf8");
  assert.match(sync, /if \(!d\?\.ok\) return;/);
  assert.match(sync, /if \(now\.updatedAt !== lib\.updatedAt\) return;\s*clearGuestLibrary\(\);/, "edits made meanwhile are kept for the next sync");
  assert.match(sync, /if \(!authenticated\) return;/, "only for a signed-in visitor");
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /<GuestLibrarySync authenticated=\{authenticated\} \/>/);
  const lib = readFileSync("src/lib/guest-library.ts", "utf8");
  assert.doesNotMatch(lib, /user_id|email|access_token|session/i, "no account data in guest storage");
});
