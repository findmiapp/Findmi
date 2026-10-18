// Discovery Lanes Placement — ATOMIC "Make Primary" correction. The
// prior setPrimaryLaneAction ran two independent Supabase requests
// (demote, then promote); a failure between them could leave a page
// with zero primary Lanes. This closure replaces that with a single
// Postgres function (set_primary_lane) invoked via admin.rpc() — one
// function call is one transaction, so a failure anywhere rolls back
// both writes, never just one.
//
// Same no-live-database convention as the rest of this suite (CLAUDE.md
// §4): this environment has no live Postgres connection to actually run
// concurrent transactions or trigger a mid-write failure against, so
// every claim here — successful swap, invalid/mismatched lane id,
// failed-promotion rollback, concurrent-request serialization, and
// authorization — is verified by reading the real, applied migration
// SQL and the real Server Action source, the same way every other
// DB-touching claim in this suite already is (see
// canonical-entity-geography-idempotency-fix.test.mjs for the same
// pattern applied to a different migration).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const RPC = read("supabase/migrations/20261018223910_discovery_lanes_set_primary_lane_rpc.sql");
const GRANTS = read("supabase/migrations/20261018224010_discovery_lanes_set_primary_lane_rpc_restrict_grants.sql");
const ACTIONS = read("src/app/admin/(protected)/site/discovery/actions.ts");

const FN = RPC.slice(RPC.indexOf("create or replace function set_primary_lane"), RPC.indexOf("revoke all on function"));

// ── Successful swap: one function, one transaction ──────────────────────

test("the demote and promote writes live inside the SAME plpgsql function body — a single RPC call is a single Postgres transaction, so both writes always land together", () => {
  assert.match(RPC, /create or replace function set_primary_lane\(p_lane_id uuid, p_page_id uuid\)\s*\nreturns void\s*\nlanguage plpgsql/);
  const demoteAt = FN.indexOf("set placement = 'explore_more'");
  const promoteAt = FN.indexOf("set placement = 'primary'");
  assert.ok(demoteAt > -1 && promoteAt > -1 && demoteAt < promoteAt, "demote runs before promote, both inside the same function/transaction");
});

test("the demote only ever targets the SAME page and excludes the Lane being promoted — it can never demote the row it's about to promote", () => {
  assert.match(FN, /update discovery_lanes set placement = 'explore_more' where page_id = p_page_id and placement = 'primary' and id <> p_lane_id;/);
});

test("the promote targets only the validated Lane id — no other row's placement is ever written by this function", () => {
  assert.match(FN, /update discovery_lanes set placement = 'primary' where id = p_lane_id;/);
  // Exactly these two UPDATE statements exist in the function — nothing broader.
  assert.equal((FN.match(/\bupdate discovery_lanes set placement = /g) ?? []).length, 2);
});

test("no column other than placement is ever written by this function (title/subtitle/order/items/visible/topics stay exactly as the founder last saved them)", () => {
  const writes = FN.match(/update discovery_lanes set [^;]*;/g) ?? [];
  assert.equal(writes.length, 2);
  for (const w of writes) assert.doesNotMatch(w, /title|subtitle|sort_order|item_limit|is_visible|topic_id/);
});

// ── Invalid / mismatched lane id ─────────────────────────────────────────

test("an unknown Lane id raises an exception BEFORE any write — nothing changes", () => {
  const validateAt = FN.indexOf("if v_actual_page_id is null then");
  const firstWriteAt = FN.indexOf("update discovery_lanes set placement =");
  assert.ok(validateAt > -1 && validateAt < firstWriteAt, "the not-found check runs before either write");
  assert.match(FN, /raise exception 'Lane not found\.' using errcode = 'P0002';/);
});

test("a Lane that exists but belongs to a DIFFERENT page than the one given also raises BEFORE any write — validates the Lane belongs to the intended page", () => {
  const mismatchAt = FN.indexOf("if v_actual_page_id <> p_page_id then");
  const firstWriteAt = FN.indexOf("update discovery_lanes set placement =");
  assert.ok(mismatchAt > -1 && mismatchAt < firstWriteAt);
  assert.match(FN, /raise exception 'That Lane does not belong to this Discovery page\.' using errcode = '22023';/);
});

// ── Failed promotion → full rollback, previous primary unchanged ────────

test("a raised exception anywhere in the function rolls back the WHOLE transaction (Postgres's own guarantee for a failed function call) — there is no partial-success path, and the previous primary Lane is left untouched", () => {
  // No exception handler swallows an error and lets execution continue —
  // any RAISE EXCEPTION, or a unique-index violation from the final
  // UPDATE, propagates out of the function and rolls back everything
  // the function already did in this call.
  assert.doesNotMatch(FN, /exception\s+when/);
  // The unique-primary-per-page index from the earlier migration is
  // never dropped/recreated here — it's still the backstop that turns
  // any theoretical double-primary write into exactly this kind of
  // full-rollback failure instead of silent corruption.
  assert.doesNotMatch(RPC, /drop index|drop table|delete from|truncate/i);
});

// ── Concurrent requests: serialized, not racing ──────────────────────────

test("every Lane row for the given page is locked (SELECT ... FOR UPDATE) BEFORE the Lane lookup or either write — a second concurrent call for the SAME page blocks here until the first call's transaction ends", () => {
  const lockAt = FN.indexOf("for update");
  const lookupAt = FN.indexOf("select page_id into v_actual_page_id");
  const firstWriteAt = FN.indexOf("update discovery_lanes set placement =");
  assert.ok(lockAt > -1 && lockAt < lookupAt && lockAt < firstWriteAt, "the lock is acquired first, before validation or either write");
  assert.match(FN, /perform 1 from discovery_lanes where page_id = p_page_id for update;/);
});

test("the lock is scoped to page_id, not to the whole table — concurrent 'Make Primary' calls for DIFFERENT pages are never serialized against each other", () => {
  assert.match(FN, /where page_id = p_page_id for update/);
  assert.doesNotMatch(FN, /from discovery_lanes for update;/, "never locks the entire table");
});

// ── Authorization: not a publicly callable mutation ─────────────────────

test("PUBLIC's default EXECUTE privilege on the new function is explicitly revoked, and EXECUTE is granted only to service_role", () => {
  assert.match(RPC, /revoke all on function set_primary_lane\(uuid, uuid\) from public;/);
  assert.match(RPC, /grant execute on function set_primary_lane\(uuid, uuid\) to service_role;/);
  assert.doesNotMatch(RPC, /grant execute on function set_primary_lane\(uuid, uuid\) to (anon|authenticated);/);
});

test("Supabase's own default-privileges auto-grant to anon/authenticated is independently revoked too (closing the gap a plain 'revoke ... from public' leaves)", () => {
  assert.match(GRANTS, /revoke execute on function set_primary_lane\(uuid, uuid\) from anon;/);
  assert.match(GRANTS, /revoke execute on function set_primary_lane\(uuid, uuid\) from authenticated;/);
});

test("the Server Action only ever calls this RPC through requireAdminSupabase()'s service-role client, which itself requires a verified admin session first — never the anon/authenticated client", () => {
  const fn = ACTIONS.slice(ACTIONS.indexOf("export async function setPrimaryLaneAction"), ACTIONS.indexOf("/** Event attributes"));
  assert.match(fn, /const admin = await requireAdminSupabase\(\);/);
  assert.match(fn, /admin\.rpc\("set_primary_lane"/);
});
