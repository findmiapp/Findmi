// Discovery Lanes Placement & Density Refinement pass — regression
// coverage for the Primary Discovery / Explore More split. Same
// source-inspection convention as the rest of this suite (CLAUDE.md §4,
// tests/homepage-section-order.test.mjs): page.tsx, DiscoveryLanes.tsx
// and the Admin discovery route are Server Components / Server Actions
// this environment can't render or invoke without a live Supabase
// client, so every claim here is verified by reading the real source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const PAGE = read("src/app/(public)/page.tsx");
const LANES = read("src/components/discovery/DiscoveryLanes.tsx");
const SERVER = read("src/lib/discovery/server.ts");
const ACTIONS = read("src/app/admin/(protected)/site/discovery/actions.ts");
const ADMIN_PAGE = read("src/app/admin/(protected)/site/discovery/page.tsx");
const MIGRATION = read("supabase/migrations/20261018220515_discovery_lanes_add_placement.sql");

// ── Server: schema + fetch ───────────────────────────────────────────────

test("DiscoveryLane carries a placement field restricted to primary/explore_more", () => {
  const iface = SERVER.slice(SERVER.indexOf("export interface DiscoveryLane"), SERVER.indexOf("export interface AreaRef"));
  assert.match(iface, /placement: "primary" \| "explore_more";/);
});

test("getHomeLanes is wrapped in React's cache() — two DiscoveryLanes renders in one request resolve to the SAME fetch, not two", () => {
  assert.match(LANES, /const getHomeLanes = cache\(async \(\): Promise<DiscoveryLane\[\]> => \{/);
  // Takes no arguments — placement is filtered in-memory, never re-queried per region.
  assert.doesNotMatch(LANES, /getHomeLanes\([^)]+\)/);
});

test("the underlying query is otherwise unchanged: still scoped to the system page, still is_visible, still ordered by sort_order", () => {
  const fn = LANES.slice(LANES.indexOf("const getHomeLanes"), LANES.indexOf("function LaneHeader"));
  assert.match(fn, /\.eq\("is_system", true\)/);
  assert.match(fn, /\.eq\("page_id", page\.id\)\.eq\("is_visible", true\)\.order\("sort_order"\)/);
});

test("DiscoveryLanes requires a placement prop and filters the one fetched list by it — the split is a pure in-memory filter, not a second query", () => {
  assert.match(LANES, /export default async function DiscoveryLanes\(\{ market, area, placement \}: \{ market\?: string; area\?: string; placement: "primary" \| "explore_more" \}\)/);
  assert.match(LANES, /const \[allLanes, vocab\] = await Promise\.all\(\[getHomeLanes\(\), getVocabulary\(\)\]\);/);
  assert.match(LANES, /const lanes = allLanes\.filter\(\(l\) => l\.placement === placement\);/);
});

// ── Homepage: placement + independent Suspense boundaries ───────────────

test("Primary Discovery renders exactly once, with placement=\"primary\", before What's Happening", () => {
  const marker = '<DiscoveryLanes market={marketSlug} area={areaSlug} placement="primary" />';
  assert.equal(PAGE.split(marker).length - 1, 1);
  const upcoming = '{upcomingSec.heading ?? HOMEPAGE_SECTIONS.featured_events.heading!}';
  assert.ok(PAGE.indexOf(marker) < PAGE.indexOf(upcoming));
});

test("Explore More Discovery renders exactly once, with placement=\"explore_more\", after Featured Locations and before the Start Here doorway", () => {
  const marker = '<DiscoveryLanes market={marketSlug} area={areaSlug} placement="explore_more" />';
  assert.equal(PAGE.split(marker).length - 1, 1);
  const featuredLocations = 'title="Featured Locations"';
  const doorway = "New to Findmi? Start here";
  assert.ok(PAGE.indexOf(featuredLocations) < PAGE.indexOf(marker));
  assert.ok(PAGE.indexOf(marker) < PAGE.indexOf(doorway));
});

test("each DiscoveryLanes call site has its own independent Suspense boundary (2 total) — a slow Explore More fetch can never block What's Happening", () => {
  const boundaries = PAGE.match(/<Suspense fallback=\{<DiscoveryLanesSkeleton \/>\}>\s*<DiscoveryLanes/g) ?? [];
  assert.equal(boundaries.length, 2);
});

test("no other DiscoveryLanes call site exists beyond these two (duplicate-rendering guard)", () => {
  assert.equal((PAGE.match(/<DiscoveryLanes /g) ?? []).length, 2);
});

// ── Admin: single-select Primary control touches only placement ────────

test("setPrimaryLaneAction delegates the actual swap to the atomic set_primary_lane RPC — it no longer runs two independent .update() calls itself", () => {
  const fn = ACTIONS.slice(ACTIONS.indexOf("export async function setPrimaryLaneAction"), ACTIONS.indexOf("/** Event attributes"));
  assert.match(fn, /admin\.rpc\("set_primary_lane", \{ p_lane_id: id!, p_page_id: page_id \}\)/);
  assert.doesNotMatch(fn, /\.update\(\{\s*placement:/);
  // Any RPC failure is surfaced as a clear, non-silent Admin-facing message.
  assert.match(fn, /if \(error\) fail\(`[^`]*\$\{error\.message\}`\);/);
});

test("saveLaneAction's own patch never includes placement — an ordinary Title/Order/Visible save can never silently change which Lane is primary", () => {
  const fn = ACTIONS.slice(ACTIONS.indexOf("export async function saveLaneAction"), ACTIONS.indexOf("/** Discovery Lanes Placement"));
  assert.doesNotMatch(fn, /placement/);
});

test("the Admin page wraps each Lane in a plain <div>, not a <form> — setPrimaryLaneAction's own small form is a SIBLING of the Save form, never nested inside it", () => {
  assert.match(ADMIN_PAGE, /\{laneList\.map\(\(l\) => \(\s*<div key=\{l\.id\}/);
  assert.doesNotMatch(ADMIN_PAGE, /<form key=\{l\.id\} action=\{saveLaneAction\}/);
});

test("exactly one Save form and one Make-Primary form exist per Lane template (no duplicate action wiring)", () => {
  assert.equal((ADMIN_PAGE.match(/action=\{saveLaneAction\}/g) ?? []).length, 1);
  assert.equal((ADMIN_PAGE.match(/action=\{setPrimaryLaneAction\}/g) ?? []).length, 1);
});

test("existing Lane fields (Title, Subtitle, topic_slugs/topic_id, Order, Items, Visible, Save button) are all still present and unchanged by the restructure", () => {
  assert.match(ADMIN_PAGE, /Title<input name="title" defaultValue=\{l\.title\}/);
  assert.match(ADMIN_PAGE, /Subtitle<input name="subtitle" defaultValue=\{l\.subtitle \?\? ""\}/);
  assert.match(ADMIN_PAGE, /Topic Slugs \(in order\)<input name="topic_slugs"/);
  assert.match(ADMIN_PAGE, /Order<input name="sort_order" type="number" defaultValue=\{l\.sort_order\}/);
  assert.match(ADMIN_PAGE, /Items<input name="item_limit" type="number" min=\{1\} max=\{24\} defaultValue=\{l\.item_limit\}/);
  assert.match(ADMIN_PAGE, /name="is_visible" defaultChecked=\{l\.is_visible\}/);
});

// ── Migration: additive, scoped, backs the single-primary invariant ────

test("the applied migration is additive (ADD COLUMN, not a destructive rewrite), defaults to explore_more, and constrains to the two allowed values", () => {
  assert.match(MIGRATION, /alter table discovery_lanes\s*\n\s*add column placement text not null default 'explore_more'/);
  assert.match(MIGRATION, /check \(placement in \('primary', 'explore_more'\)\)/);
  assert.doesNotMatch(MIGRATION, /drop table|drop column|delete from|truncate/i);
});

test("the migration backfills ONLY the known Right Now lane id to primary — no other row targeted", () => {
  const updates = MIGRATION.match(/update discovery_lanes[\s\S]*?;/g) ?? [];
  assert.equal(updates.length, 1);
  assert.match(updates[0], /where id = '3445f81b-9314-4d25-8f89-93069ef1de82'/);
});

test("a partial unique index enforces at most one primary Lane per page at the DB layer, backing the Admin single-select control", () => {
  assert.match(MIGRATION, /create unique index discovery_lanes_one_primary_per_page\s*\n\s*on discovery_lanes \(page_id\)\s*\n\s*where placement = 'primary';/);
});

// ── Density pass (commit be733aa) still intact ───────────────────────────

test("TopicTile's mobile-only density reduction from the prior pass is still present and unmodified by this pass", () => {
  assert.match(LANES, /aspect-\[2\/1\] w-full flex-col justify-end overflow-hidden rounded-2xl bg-findmi-50 p-3 transition active:scale-\[0\.98\] sm:aspect-\[4\/3\]/);
});
