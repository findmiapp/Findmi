// Discovery Tile Visual System pass, Part B — Area Images. Same
// source-inspection convention as the rest of this suite (CLAUDE.md §4):
// the Admin geography page/action, lib/discovery/server.ts's
// getVocabulary(), and DiscoveryLanes.tsx are Server Components/Server
// Actions this environment can't render or invoke without a live
// Supabase client, so every claim here is verified by reading the real,
// committed source and the applied migration file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20261018233210_market_areas_add_image_url.sql");
const SERVER = read("src/lib/discovery/server.ts");
const LANES = read("src/components/discovery/DiscoveryLanes.tsx");
const GEO_PAGE = read("src/app/admin/(protected)/site/geography/page.tsx");
const GEO_ACTIONS = read("src/app/admin/(protected)/site/geography/actions.ts");

// ── Migration: additive, text-only fallback preserved ───────────────────

test("the applied migration is additive (ADD COLUMN, nullable, no default) — never a destructive rewrite, never a backfill", () => {
  assert.match(MIGRATION, /alter table market_areas\s*\n\s*add column image_url text null;/);
  assert.doesNotMatch(MIGRATION, /drop table|drop column|delete from|truncate|update market_areas/i);
});

// ── 1. AreaRef type + getVocabulary() query ──────────────────────────────

test("AreaRef carries image_url: string | null, and getVocabulary() reads it from market_areas into every AreaRef it builds", () => {
  const iface = SERVER.slice(SERVER.indexOf("export interface AreaRef"), SERVER.indexOf("export interface Vocabulary"));
  assert.match(iface, /image_url: string \| null;/);
  assert.match(SERVER, /image_url: a\.image_url \?\? null,/);
});

test("market_areas is still fetched with select(\"*\") — no new column list to keep in sync, image_url just comes through automatically", () => {
  assert.match(SERVER, /supabase\.from\("market_areas"\)\.select\("\*"\)\.eq\("active", true\)\.order\("sort_order"\)/);
});

// ── 4/5/6. Area image threaded into TopicTile; fallback and overlay preserved ──

test("DiscoveryLanes' \"areas\" branch passes the real a.image_url into TopicTile — the hardcoded null is gone", () => {
  const areasBranch = LANES.slice(LANES.lastIndexOf("const m = vocab.marketRows.find"), LANES.length);
  assert.match(areasBranch, /<TopicTile topic=\{\{ name: a\.name, image_url: a\.image_url, description: null \}\} href=\{`\/explore\/\$\{m\.slug\}\/\$\{a\.slug\}`\} \/>/);
  assert.doesNotMatch(areasBranch, /image_url: null/);
});

test("TopicTile's existing fallback/overlay logic (unchanged by this pass) is what makes an Area tile with no image text-only, and one with an image readable", () => {
  const fn = LANES.slice(LANES.indexOf("export function TopicTile"), LANES.indexOf("export function TileRail"));
  assert.match(fn, /const showImage = Boolean\(topic\.image_url\);/, "an Area tile (dateStatusKind always null/omitted, so it never reaches the early dateStatusKind return) shows its image whenever one is set");
  assert.match(fn, /bg-gradient-to-t from-black\/60 via-black\/10 to-transparent/, "readable name/count overlay over a photo");
  assert.match(fn, /\$\{showImage \? "text-white" : "text-findmi-700"\}/, "pale-aqua text-only fallback when none is set");
});

test("Area tiles are never forced into the date/status presentation — dateStatus is omitted (defaults to false) for areas, so they can show a real photo", () => {
  const areasBranch = LANES.slice(LANES.lastIndexOf("const m = vocab.marketRows.find"), LANES.length);
  assert.doesNotMatch(areasBranch, /dateStatus/);
});

// ── 2/3. Admin geography editor — authorized, scoped to image_url only ──

test("the Admin geography page is still gated by requireAdminSupabase() — only an authorized Admin session reaches the Area Images editor", () => {
  assert.match(GEO_PAGE, /const admin = await requireAdminSupabase\(\);/);
  assert.match(GEO_PAGE, /import ImageField from "@\/components\/admin\/ImageField";/);
  assert.match(GEO_PAGE, /<ImageField label="Image" name="image_url" defaultValue=\{a\.image_url\} \/>/);
});

test("the Area Images section lists one form per Area, each posting to saveAreaImageAction with the Area's id", () => {
  const section = GEO_PAGE.slice(GEO_PAGE.indexOf('<h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Area Images</h2>'), GEO_PAGE.indexOf('<h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Assign Census Geography</h2>'));
  assert.match(section, /\{areaList\.map\(\(a\) => \(/);
  assert.match(section, /<form key=\{a\.id\} action=\{saveAreaImageAction\}/);
  assert.match(section, /<input type="hidden" name="id" value=\{a\.id\} \/>/);
});

test("the market_areas query for this page now selects image_url too", () => {
  assert.match(GEO_PAGE, /admin\.from\("market_areas"\)\.select\("id, name, slug, market_id, sort_order, image_url"\)/);
});

test("saveAreaImageAction requires an authorized admin session and touches ONLY image_url — never name/slug/market_id/parent_area_id/level/consumer_visible/sort_order", () => {
  const fn = GEO_ACTIONS.slice(GEO_ACTIONS.indexOf("export async function saveAreaImageAction"), GEO_ACTIONS.length);
  assert.match(fn, /const admin = await requireAdminSupabase\(\);/);
  const updateCalls = fn.match(/\.update\(\{[^}]*\}\)/g) ?? [];
  assert.equal(updateCalls.length, 1);
  assert.match(updateCalls[0], /^\.update\(\{ image_url: str\(formData, "image_url"\) \}\)$/);
  for (const call of updateCalls) assert.doesNotMatch(call, /name|slug|market_id|parent_area_id|level|consumer_visible|sort_order|active/);
});

test("saveAreaImageAction treats a cleared field the same as never having set one — str() turns an emptied/blank submission into null, not an empty string", () => {
  const fn = GEO_ACTIONS.slice(GEO_ACTIONS.indexOf("export async function saveAreaImageAction"), GEO_ACTIONS.length);
  assert.match(fn, /str\(formData, "image_url"\)/);
  assert.doesNotMatch(fn, /\|\| ""/);
});

test("saveAreaImageAction revalidates both the geography admin page and the homepage, which reads this same column through its \"areas\" Discovery Lane", () => {
  const fn = GEO_ACTIONS.slice(GEO_ACTIONS.indexOf("export async function saveAreaImageAction"), GEO_ACTIONS.length);
  assert.match(fn, /revalidatePath\(PATH\);/);
  assert.match(fn, /revalidatePath\("\/"\);/);
});

test("a missing Area id is rejected before any write", () => {
  const fn = GEO_ACTIONS.slice(GEO_ACTIONS.indexOf("export async function saveAreaImageAction"), GEO_ACTIONS.length);
  const guardAt = fn.indexOf("if (!id) redirect(");
  const updateAt = fn.indexOf(".update({");
  assert.ok(guardAt > -1 && guardAt < updateAt, "the missing-id check runs before the write");
});

// ── 7. Preserved systems ──────────────────────────────────────────────────

test("Census import, Market/Area mapping, and the Area Images editor are three independent sections — adding one never touched the others' actions", () => {
  assert.match(GEO_PAGE, /<CensusImportRunner defaultVintage=\{vintage\} \/>/);
  assert.match(GEO_PAGE, /<BackfillRunner \/>/);
  assert.match(GEO_PAGE, /action=\{addProductGeographyAction\}/);
  assert.match(GEO_PAGE, /action=\{removeProductGeographyAction\}/);
});

test("the areas-kind Lane's filtering (market_id/consumer_visible/level/item_limit) and See-All-free LaneHeader are unchanged — only the tile's image prop changed", () => {
  assert.match(LANES, /vocab\.areaRows\.filter\(\(a\) => a\.market_id === lane\.market_id && a\.consumer_visible && a\.level === "area"\)\.slice\(0, lane\.item_limit\)/);
});
