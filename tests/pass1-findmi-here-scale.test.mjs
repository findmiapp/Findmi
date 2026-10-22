// Pass 1 — Findmi Here at scale, re-import, Market view, Moment display (all entities), Growth workflow,
// QR filter groups. Pure rules + source checks; no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const read = (p) => readFileSync(p, "utf8");
const BULK = await import("../src/lib/business-availability-bulk-domain.ts");
const MATCH = await import("../src/lib/locator-import/match.ts");
const GROWTH = await import("../src/lib/growth.ts");
const DISPLAY = await import("../src/lib/entity-moment-display.ts");
const HIST = await import("../src/lib/locator-import/history.ts");

// ── Filters ────────────────────────────────────────────────────────────────

test("availability filters are parsed from untrusted input and never carry list-breaking characters", () => {
  const f = BULK.parseAvailabilityFilter({ q: "  Joe's, (Cafe) %  ", status: "live", relationship: "sold", imported: "1" });
  assert.deepEqual(f, { q: "Joe's Cafe", status: "live", relationship: "sold", imported: true });
  assert.deepEqual(BULK.parseAvailabilityFilter({ status: "hax", relationship: "nope", imported: "0" }), BULK.EMPTY_AVAILABILITY_FILTER);
  assert.equal(BULK.parseAvailabilityFilter({ q: "x".repeat(200) }).q.length, 60);
  assert.equal(BULK.isEmptyAvailabilityFilter(BULK.EMPTY_AVAILABILITY_FILTER), true);
});

// ── Bulk operations ────────────────────────────────────────────────────────

test("bulk ops validate: relationships canonicalized, products capped, unknown kinds refused", () => {
  const add = BULK.validateBulkOp({ kind: "add_relationships", relationships: ["sampled", "stocked", "bogus"] });
  assert.deepEqual(add.ok && add.op.relationships, ["stocked", "sampled"]);
  assert.equal(BULK.validateBulkOp({ kind: "add_relationships", relationships: ["bogus"] }).ok, false);
  assert.equal(BULK.validateBulkOp({ kind: "add_products", productIds: [] }).ok, false);
  assert.equal(BULK.validateBulkOp({ kind: "apply_set", setId: "" }).ok, false);
  assert.equal(BULK.validateBulkOp({ kind: "delete_location" }).ok, false);
  assert.equal(BULK.validateBulkOp({ kind: "remove_from_footprint" }).ok, true);
  const many = BULK.validateBulkOp({ kind: "add_products", productIds: Array.from({ length: 80 }, (_, i) => `p${i}`) });
  assert.equal(many.op.productIds.length, 25);
});

test("relationship plan: adds union, removes subtract, the last relationship is never removed", () => {
  const add = (cur, rels) => BULK.planRelationships(cur, { kind: "add_relationships", relationships: rels });
  const rem = (cur, rels) => BULK.planRelationships(cur, { kind: "remove_relationships", relationships: rels });
  assert.deepEqual(add(["stocked"], ["sold", "served"]), { next: ["stocked", "sold", "served"], changed: true });
  assert.deepEqual(add(["stocked", "sold"], ["sold"]), { next: ["stocked", "sold"], changed: false });
  assert.deepEqual(rem(["stocked", "sold"], ["stocked"]), { next: ["sold"], changed: true });
  assert.deepEqual(rem(["sold"], ["featured"]), { next: ["sold"], changed: false });
  assert.deepEqual(rem(["sold"], ["sold"]), { skip: "Would leave no relationship" });
  assert.deepEqual(rem(["sold", "served"], ["sold", "served"]), { skip: "Would leave no relationship" });
});

test("only an op that ADDS a way the Business is there can return entries to review; product, set, narrowing and removal never do", () => {
  assert.equal(BULK.bulkOpReturnsToReview({ kind: "add_relationships", relationships: ["served"] }), true);
  for (const op of [
    { kind: "add_products", productIds: ["a"] },
    { kind: "remove_products", productIds: ["a"] },
    { kind: "apply_set", setId: "s" },
    { kind: "remove_relationships", relationships: ["sold"] },
    { kind: "remove_from_footprint" },
  ]) assert.equal(BULK.bulkOpReturnsToReview(op), false, op.kind);
});

test("bulk progress merges counts and groups skip reasons across chunks", () => {
  const a = { processed: 200, changed: 150, unchanged: 40, skipped: [{ reason: "Would leave no relationship", count: 10 }], returnedToReview: 120 };
  const b = { processed: 50, changed: 30, unchanged: 5, skipped: [{ reason: "Would leave no relationship", count: 15 }], returnedToReview: 10 };
  const m = BULK.mergeBulkProgress(a, b);
  assert.deepEqual(m, { processed: 250, changed: 180, unchanged: 45, skipped: [{ reason: "Would leave no relationship", count: 25 }], returnedToReview: 130 });
});

test("bulk server: every write is scoped by business_id, chunked, and never touches locations", () => {
  const src = read("src/lib/business-availability-bulk.ts");
  assert.match(src, /BULK_CHUNK/);
  assert.doesNotMatch(src, /from\("locations"\)/);
  for (const m of src.matchAll(/\.from\("business_location_availability"\)\s*\n?\s*\.(update|delete)\(/g)) assert.ok(m.index > 0);
  assert.match(src, /\.eq\("business_id", businessId\)/);
  const actions = read("src/app/(public)/account/business/[id]/availability-actions.ts");
  assert.match(actions, /export async function bulkAvailabilityAction/);
  assert.match(actions.slice(actions.indexOf("export async function bulkAvailabilityAction")), /await authorize\(businessId\)/);
});

test("the owner list is one server-side page at a time (no unpaged read of the whole footprint)", () => {
  const view = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(view, /getOwnerAvailabilityPage\(/);
  assert.doesNotMatch(view, /getOwnerAvailability\(admin/);
  const owner = read("src/lib/business-availability-owner.ts");
  const fn = owner.slice(owner.indexOf("export async function getOwnerAvailabilityPage"));
  assert.match(fn, /\.range\(from, from \+ size - 1\)/);
  assert.match(fn, /AVAILABILITY_LIST_PAGE_SIZE/);
});

// ── Re-import ──────────────────────────────────────────────────────────────

const row = (o = {}) => ({ externalId: "S1", name: "Corner Shop", address: "5 Elm Street", city: "Newark", state: "NJ", postalCode: "07102", website: null, phone: null, relationships: null, ...o });
const known = { availabilityId: "A1", locationId: "L1" };
const cand = (id, o = {}) => ({ id, slug: id, name: "Corner Shop", address: "5 Elm St", city: "Newark", state: "NJ", postal_code: "07102", is_demo: false, category: null, ...o });

test("a repeat row for the same place stays a quiet update of its entry", () => {
  const m = MATCH.classifyImportRow(row(), 1, { known, candidates: [], knownLocation: { name: "Corner Shop", address: "5 Elm St" } });
  assert.deepEqual([m.status, m.matchedLocationId, m.repeat], ["existing", "L1", true]);
});

test("a repeat row whose address or name changed is flagged for review, with the current Location kept by default", () => {
  assert.equal(MATCH.sourceDetailsChanged(row({ address: "99 Oak Ave" }), { name: "Corner Shop", address: "5 Elm St" }), true);
  assert.equal(MATCH.sourceDetailsChanged(row({ name: "Totally Different Deli" }), { name: "Corner Shop", address: "5 Elm St" }), true);
  assert.equal(MATCH.sourceDetailsChanged(row({ address: null }), { name: "Corner Shop", address: "5 Elm St" }), false, "absence is not a change");
  assert.equal(MATCH.sourceDetailsChanged(row(), null), false);
  const m = MATCH.classifyImportRow(row({ address: "99 Oak Ave" }), 1, { known, candidates: [cand("L2", { address: "99 Oak Avenue" })], knownLocation: { name: "Corner Shop", address: "5 Elm St" } });
  assert.equal(m.status, "possible");
  assert.equal(m.problem, MATCH.SOURCE_CHANGED_PROBLEM);
  assert.deepEqual(m.candidateLocationIds, ["L1", "L2"]);
  assert.equal(m.matchedLocationId, "L1");
  const base = { match_status: m.status, matched_location_id: m.matchedLocationId, candidate_location_ids: m.candidateLocationIds, decision: null, chosen_location_id: null, problem: m.problem };
  assert.deepEqual(MATCH.effectiveAction(base), { kind: "link", locationId: "L1" }, "default keeps the current Location");
  assert.deepEqual(MATCH.effectiveAction({ ...base, decision: "use_match", chosen_location_id: "L2" }), { kind: "link", locationId: "L2" });
  assert.equal(MATCH.effectiveAction({ ...base, decision: "use_match", chosen_location_id: "EVIL" }).kind, "unresolved");
});

test("a place chosen from address matching never defaults to anything (only a changed repeat row does)", () => {
  const base = { match_status: "possible", matched_location_id: null, candidate_location_ids: ["L1", "L2"], decision: null, chosen_location_id: null, problem: null };
  assert.equal(MATCH.effectiveAction(base).kind, "unresolved");
});

test("re-import server: source id moves release the old entry (kept, not deleted); no silent re-tie; file never deletes", () => {
  const src = read("src/lib/locator-import/server.ts");
  assert.match(src, /external_source: null, external_id: null/);
  assert.match(src, /previous place was kept without its source link/);
  assert.match(src, /already linked to source id/);
  const link = src.slice(src.indexOf("async function linkAvailability"), src.indexOf("export async function commitBatch"));
  assert.doesNotMatch(link, /\.delete\(\)/, "an import never deletes an entry");
  assert.doesNotMatch(link, /location_id: locationId \}/, "an entry's place is never rewritten");
  assert.match(link, /explicitRelationships/);
});

test("history reads only stored data and offers outcome filters; not-in-file is information only", () => {
  assert.equal(HIST.parseImportRowsFilter("bogus"), "attention");
  assert.equal(HIST.parseImportRowsFilter("created"), "created");
  const src = read("src/lib/locator-import/history.ts");
  assert.doesNotMatch(src, /\.delete\(|\.update\(|\.insert\(/, "history is read-only");
  const page = read("src/app/(public)/account/business/[id]/import-locations/history/[batchId]/MissingFromFile.tsx");
  assert.match(page, /stay on your footprint unless you choose to remove them/);
  assert.match(page, /kind: "remove_from_footprint"/);
});

// ── Product Sets ───────────────────────────────────────────────────────────

test("Product Sets: duplicate, rename/edit, counts; entries never reference a set", () => {
  const sets = read("src/lib/business-product-sets.ts");
  assert.match(sets, /export async function duplicateProductSet/);
  const panel = read("src/app/(public)/account/business/[id]/v2/ProductSetsPanel.tsx");
  assert.match(panel, /Duplicate/);
  assert.match(panel, /Product(s)?\b/);
  const bulk = read("src/lib/business-availability-bulk.ts");
  assert.match(bulk, /business_location_availability_products/);
  assert.doesNotMatch(bulk, /set_id.*insert|insert.*set_id/s);
});

// ── Market view ────────────────────────────────────────────────────────────

test("the Market view uses only real rows: curated market_id, no percentages, scores or text matching", () => {
  // Pass 2 Block B: the Market view now reads through the shared relationship
  // reader + geography scope helper — the same rules still hold.
  for (const f of ["src/lib/business-market-footprint.ts", "src/lib/business-relationships.ts", "src/lib/geography-scope.ts"]) {
    const lib = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(lib, /market_id/, f);
    assert.doesNotMatch(lib, /penetration|score|percent|%/i, f);
    assert.doesNotMatch(lib, /ilike|\.eq\("city"|\.eq\("state"|\.or\(/, f);
  }
  const view = read("src/app/(public)/account/business/[id]/v2/GeographyViews.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(view, /Not In A Findmi Market Yet/);
  assert.doesNotMatch(view, /score|percent|%/i, "no estimates or scores");
  assert.doesNotMatch(view, /Hamptons|Long Island|New Jersey|NYC|Jersey City/, "no launch market is hard-coded");
});

// ── Moments display for all three entities ─────────────────────────────────

function recorder() {
  const calls = [];
  const chain = (table) => {
    const rec = { table, ops: [] };
    calls.push(rec);
    const p = new Proxy({}, {
      get(_, name) {
        if (name === "then") return (res) => res({ error: null, data: null });
        return (...args) => { rec.ops.push([name, ...args]); return p; };
      },
    });
    return p;
  };
  return { calls, client: { from: chain } };
}
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const W = "33333333-3333-4333-8333-333333333333";

test("featuring replaces the entity's previous featured Moment, then writes one 'featured' row", async () => {
  const { calls, client } = recorder();
  const r = await DISPLAY.setMomentDisplay(client, "location", U, V, "featured", null);
  assert.equal(r.ok, true);
  const del = calls[0].ops.map((o) => o[0]);
  assert.deepEqual(del.slice(0, 1), ["delete"]);
  assert.ok(calls[0].ops.some((o) => o[0] === "eq" && o[1] === "display" && o[2] === "featured"));
  assert.ok(calls[0].ops.some((o) => o[0] === "neq" && o[1] === "journal_entry_id" && o[2] === V));
  const up = calls[1].ops.find((o) => o[0] === "upsert");
  assert.equal(up[1].display, "featured");
  assert.equal(up[1].entity_type, "location");
});

test("hiding writes one 'hidden' row; showing deletes it; a bad id is refused", async () => {
  let { calls, client } = recorder();
  await DISPLAY.setMomentDisplay(client, "event", U, V, "hidden", null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ops.find((o) => o[0] === "upsert")[1].display, "hidden");
  ({ calls, client } = recorder());
  await DISPLAY.setMomentDisplay(client, "business", U, V, "shown", null);
  assert.equal(calls[0].ops[0][0], "delete");
  assert.equal((await DISPLAY.setMomentDisplay(recorder().client, "event", "nope", V, "hidden", null)).ok, false);
});

test("location and event actions: manager-only, entity-scoped, Moment must be connected; staff stay read-only", () => {
  const act = read("src/app/(public)/account/entity-moment-actions.ts");
  assert.match(act, /requireLocationMember\(entityId\)/);
  assert.match(act, /requireEventMember\(entityId\)/);
  assert.match(act, /isPageManagerRole\(membership\.role\)/);
  assert.match(act, /isEntryOnEntityPage/);
  assert.doesNotMatch(act, /\.delete\(\)|from\("journal_entries"\)\s*\.(update|delete)/, "never edits or deletes a Moment");
  const section = read("src/components/account/EntityMomentRow.tsx");
  assert.match(section, /canManage \?/);
  assert.match(read("src/app/(public)/account/location/[id]/page.tsx"), /EntityMomentsSection kind="location"/);
  assert.match(read("src/app/(public)/account/event/[id]/page.tsx"), /EntityMomentsSection kind="event"/);
});

test("public collections: featured Moment is first on page one, excluded from the date-ordered list, never shown twice", () => {
  const src = read("src/lib/journal-distribution.ts");
  assert.match(src, /hiddenIds = display\.featured \? \[\.\.\.display\.hidden, display\.featured\]/);
  assert.match(src, /loadFeatured/);
  assert.match(src, /featured: true/);
  assert.match(read("src/components/journal/JournalPreviewCard.tsx"), /Featured · /);
});

// ── Public entity nav ──────────────────────────────────────────────────────

test("every nav chip id exists as a section id in the page source (no chip points at nothing)", () => {
  const ids = (file) => new Set([...read(file).matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]));
  const chips = (file) => [...read(file).slice(read(file).indexOf("buildSectionAnchors([")).matchAll(/\{ id: "([a-z-]+)"/g)].map((m) => m[1]);
  const shared = new Set([...ids("src/components/BusinessShopSection.tsx"), ...ids("src/components/OurLocations.tsx"), ...ids("src/components/FindUsAt.tsx")]);
  const biz = "src/app/(public)/business/[slug]/BusinessPublicView.tsx";
  for (const id of chips(biz)) assert.ok(ids(biz).has(id) || shared.has(id), `business: ${id}`);
  const loc = "src/app/(public)/location/[slug]/LocationPublicView.tsx";
  for (const id of chips(loc)) assert.ok(ids(loc).has(id), `location: ${id}`);
  assert.ok(chips(loc).includes("within"));
  const ev = "src/app/(public)/event/[slug]/EventPublicView.tsx";
  for (const id of chips(ev).slice(0, 10)) assert.ok(ids(ev).has(id), `event: ${id}`);
});

// ── Growth workflow ────────────────────────────────────────────────────────

test("Growth reads as one workflow with real statuses on every Growth page", () => {
  const s = GROWTH.summarizeGrowth({ audit: null, activeGoalCount: 0, matchesAwaitingResponse: 0, matchesInProgress: 0 });
  const steps = GROWTH.growthWorkflowSteps(s);
  assert.deepEqual(steps.map((x) => [x.key, x.role]), [["goals", "What You Want"], ["targets", "What You’re Pursuing"] /* Pass 2 Block A closeout */, ["ideas", "What May Help"], ["opportunities", "What’s Available"]]);
  assert.match(steps[0].status, /Get Started/);
  const live = GROWTH.summarizeGrowth({ audit: null, activeGoalCount: 2, matchesAwaitingResponse: 3, matchesInProgress: 1, ideasForYou: 4, ideasNew: 2 });
  const lines = GROWTH.growthWorkflowSteps(live);
  assert.match(lines[0].status, /2 Set/);
  assert.match(lines[2].status, /4 For You · 2 New/);
  assert.equal(lines[3].highlight, true);
  for (const f of ["src/app/(public)/account/business/[id]/v2/GrowthView.tsx", "src/app/(public)/account/business/[id]/(manager)/page.tsx"]) assert.match(read(f), /summary=\{(summary|growthSummary)\}/);
});

// ── QR filters ─────────────────────────────────────────────────────────────

test("QR Codes filters are two labeled groups (Status, Type), each its own rail", () => {
  const src = read("src/app/(public)/account/business/[id]/QrCampaignGroups.tsx");
  assert.match(src, /<FilterRail label="Status">/);
  assert.match(src, /<FilterRail label="Type">/);
  assert.match(src, /role="group" aria-label=\{label\}/);
  assert.match(src, /after:w-2\.5 after:shrink-0/, "trailing spacer so the last chip clears the edge");
  for (const l of ["All", "Active", "Paused", "Archived", "Any Type", "Events", "Products", "Locations", "Business"]) assert.match(src, new RegExp(`label: "${l}"`));
});

test("Findmi Here view tabs fit a phone without clipping; Moments filters wrap", () => {
  assert.match(read("src/app/(public)/account/business/[id]/v2/PresenceViews.tsx"), /min-w-0 flex-1 items-center justify-center/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/MomentsView.tsx"), /navClass="flex flex-wrap gap-1\.5"/);
});

// ── No schema in this pass ─────────────────────────────────────────────────

test("Pass 1 proposes no migration: the newest migration is still the Pass 0 moment-display one", () => {
  // Pass 2 migrations (20261102…) come later; none landed between Pass 0 and Pass 2.
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f < "20261102").sort();
  assert.equal(files.at(-1), "20261101000100_entity_moment_display.sql");
});
