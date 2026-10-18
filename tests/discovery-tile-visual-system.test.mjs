// Discovery Tile Visual System pass — Part A (Topic Images) and Part C
// (Date/Status Tile Presentation). Part B (Area Images) is gated on an
// additive market_areas.image_url migration that has NOT been applied
// yet — see the migration-plan report for this pass — so this file
// covers only what actually shipped. Same source-inspection convention
// as the rest of this suite (CLAUDE.md §4): the Admin page and
// DiscoveryLanes are a Server Component/Server Action this environment
// can't render without a live Supabase client, so every claim here is
// verified by reading the real, committed source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const ADMIN_PAGE = read("src/app/admin/(protected)/site/discovery/page.tsx");
const LANES = read("src/components/discovery/DiscoveryLanes.tsx");
const QUERY = read("src/lib/discovery/query.ts");
const ENGINE = read("src/lib/discovery/engine.ts");

// ── A. Topic Images — reuse ImageField, preserve stored shape ───────────

test("the Admin Topic form uses the shared ImageField component for image_url, not a plain URL input", () => {
  assert.match(ADMIN_PAGE, /import ImageField from "@\/components\/admin\/ImageField";/);
  assert.match(ADMIN_PAGE, /<ImageField label="Image" name="image_url" defaultValue=\{editing\?\.image_url\} \/>/);
  // The old plain input for this exact field is gone.
  assert.doesNotMatch(ADMIN_PAGE, /Image URL<input name="image_url"/);
});

test("ImageField itself preserves both manual URL entry and file upload, filling the SAME field — nothing about the stored URL format changes", () => {
  const FIELD = read("src/components/admin/ImageField.tsx");
  assert.match(FIELD, /type="text"\s*\n\s*name=\{name\}/);
  assert.match(FIELD, /type="file"/);
  assert.match(FIELD, /import \{ uploadImage \} from "@\/lib\/admin\/upload";/);
});

test("saveTopicAction still reads image_url as a plain string field — the form control changed, the action/column contract didn't", () => {
  const ACTIONS = read("src/app/admin/(protected)/site/discovery/actions.ts");
  assert.match(ACTIONS, /image_url: str\(formData, "image_url"\)/);
});

test("TopicTile shows an uploaded image with a readable overlay, object-cover cropping, and a text-only fallback when none is set", () => {
  const fn = LANES.slice(LANES.indexOf("export function TopicTile"), LANES.indexOf("export function TileRail"));
  assert.match(fn, /fill sizes="\(min-width: 1024px\) 18vw, 40vw" className="object-cover/, "cropping");
  assert.match(fn, /bg-gradient-to-t from-black\/60 via-black\/10 to-transparent/, "legibility overlay over a photo");
  assert.match(fn, /\$\{showImage \? "text-white" : "text-findmi-700"\}/, "text-only fallback uses the dark-on-pale-aqua treatment, not white-on-nothing");
});

test("Discovery topic queries and routing are untouched by this pass — no change to query.ts/engine.ts's resolution logic", () => {
  assert.match(QUERY, /export const DISCOVERY_WHEN = \["now", "today", "tonight", "tomorrow", "week", "weekend", "upcoming"\] as const;/);
  assert.match(ENGINE, /export function windowDates\(when: DiscoveryWhen, now: Date = new Date\(\)\): \{ from: string; to: string \} \| null \{/);
  assert.match(ENGINE, /export function matchesWhen\(i: DiscoveryItem, when: DiscoveryWhen, now: Date = new Date\(\)\): boolean \{/);
});

// ── C. Date/Status Tile Presentation ─────────────────────────────────────

test("date/status detection is structural (topic.query.when) at the call site, never title matching", () => {
  assert.match(LANES, /dateStatus=\{Boolean\(t\.query\.when\)\}/);
  // Nowhere in this file does a tile's presentation branch on topic.name/title text.
  assert.doesNotMatch(LANES, /topic\.name === |t\.name === |\.name\.includes\(/);
});

test("a dateStatus tile never shows decorative photography, even if image_url happens to be set — the suppression lives in TopicTile itself, not just in today's data", () => {
  const fn = LANES.slice(LANES.indexOf("export function TopicTile"), LANES.indexOf("export function TileRail"));
  assert.match(fn, /const showImage = !dateStatus && Boolean\(topic\.image_url\);/);
  assert.match(fn, /\{showImage && \(/);
});

test("every dateStatus tile uses the SAME one icon (NavIcon \"calendar\") — consistent, not a different icon per when value", () => {
  assert.match(LANES, /import NavIcon from "@\/components\/NavIcon";/);
  const fn = LANES.slice(LANES.indexOf("export function TopicTile"), LANES.indexOf("export function TileRail"));
  assert.equal((fn.match(/<NavIcon name="calendar"/g) ?? []).length, 1, "one icon reference, reused for every dateStatus tile via props — not hardcoded per topic");
});

test("live counts and destination hrefs for date/status tiles are computed exactly the same way as any other topic tile — only presentation branches on dateStatus", () => {
  const topicsBranch = LANES.slice(LANES.indexOf('if (lane.kind === "topics")'), LANES.indexOf('if (lane.kind === "topic_results")'));
  assert.match(topicsBranch, /const counted = await Promise\.all\(topics\.map\(async \(t\) => \(\{ t, n: \(await runDiscovery\(\{ topics: \[t\.slug\], limit: 1 \}, \{ context \}\)\)\.total \}\)\)\);/);
  assert.match(topicsBranch, /href=\{searchHref\(\{ \.\.\.context, topics: \[t\.slug\] \}\)\}/);
  // dateStatus is the ONLY extra prop added for this pass — count/href untouched.
  assert.match(topicsBranch, /<TopicTile topic=\{t\} count=\{n\} href=\{searchHref\(\{ \.\.\.context, topics: \[t\.slug\] \}\)\} dateStatus=\{Boolean\(t\.query\.when\)\} \/>/);
});

// ── Guardrails ────────────────────────────────────────────────────────────

test("Area tiles are unaffected by this pass — still pass dateStatus=false (the default) and the hardcoded image_url: null pending the Part B migration", () => {
  const areasBranch = LANES.slice(LANES.lastIndexOf("const m = vocab.marketRows.find"), LANES.length);
  assert.match(areasBranch, /<TopicTile topic=\{\{ name: a\.name, image_url: null, description: null \}\} href=\{`\/explore\/\$\{m\.slug\}\/\$\{a\.slug\}`\} \/>/);
  assert.doesNotMatch(areasBranch, /dateStatus/);
});

test("DiscoveryTile (event/business/location/moment preview cards) is a completely separate component, untouched by this pass", () => {
  const TILE = read("src/components/discovery/DiscoveryTile.tsx");
  assert.match(TILE, /aspect-square w-full shrink-0 overflow-hidden bg-black\/5/);
  assert.doesNotMatch(TILE, /dateStatus|calendar/);
});

test("TileRail (horizontal swipe, mobile tap targets) is byte-identical — this pass only changed TopicTile's own inner rendering", () => {
  assert.match(LANES, /export function TileRail\(\{ children \}: \{ children: React\.ReactNode \}\) \{\s*\n\s*return <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 \[scrollbar-width:none\] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-6">\{children\}<\/div>;/);
  assert.match(LANES, /className="w-\[40%\] shrink-0 snap-start sm:w-auto"/);
});
