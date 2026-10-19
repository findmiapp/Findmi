// Right Now Carousel Visual Refinement pass — the six-icon date/status
// tile redesign (white card, 1px light-gray border, icon left of a
// stacked title/count, ~72px compact height, teal focus treatment).
// Same source-inspection convention as the rest of this suite (CLAUDE.md
// §4): DiscoveryLanes.tsx is rendered by a Server Component this
// environment can't execute without a live Supabase client, so every
// claim here is verified by reading the real, committed source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LANES = readFileSync("src/components/discovery/DiscoveryLanes.tsx", "utf8");

const DETECT = LANES.slice(LANES.indexOf("function dateStatusKindOf"), LANES.indexOf("function DateStatusIcon"));
const ICONS = LANES.slice(LANES.indexOf("function DateStatusIcon"), LANES.indexOf("// Discovery Intelligence V1 — homepage Lanes"));
const TILE = LANES.slice(LANES.indexOf("export function TopicTile"), LANES.indexOf("export function TileRail"));

// ── Structural detection for all six cases — never title matching ──────

test("endingSoonHours and justAnnouncedDays each map to their own kind, checked ahead of `when`", () => {
  assert.match(DETECT, /if \(q\.endingSoonHours !== undefined\) return "endingSoon";/);
  assert.match(DETECT, /if \(q\.justAnnouncedDays !== undefined\) return "justAnnounced";/);
});

test("each of the four `when` values with a dedicated icon maps to its own kind", () => {
  assert.match(DETECT, /if \(q\.when === "now"\) return "now";/);
  assert.match(DETECT, /if \(q\.when === "today"\) return "today";/);
  assert.match(DETECT, /if \(q\.when === "tonight"\) return "tonight";/);
  assert.match(DETECT, /if \(q\.when === "weekend"\) return "weekend";/);
});

test("a non-date/status topic (no when, no endingSoonHours, no justAnnouncedDays) resolves to null — eligible for a photo", () => {
  assert.match(DETECT, /return null;\s*\n\}/);
});

test("detection never inspects a title/name string — only q.when/q.endingSoonHours/q.justAnnouncedDays", () => {
  assert.doesNotMatch(DETECT, /\.name|\.title|includes\(/);
});

// ── Icon mapping — one glyph per required case ───────────────────────────

test("Happening Now (now) renders the radio/pulse glyph", () => {
  const nowCase = ICONS.slice(ICONS.indexOf('case "now":'), ICONS.indexOf('case "tonight":'));
  assert.match(nowCase, /<circle cx="12" cy="12" r="2" fill="currentColor" \/>/);
});

test("Today (today) and any unmapped `when` fall back to the existing NavIcon \"calendar\" — reusing the established unified icon system, not inventing a new calendar glyph", () => {
  const defaultCase = ICONS.slice(ICONS.lastIndexOf('case "today":'), ICONS.length);
  assert.match(defaultCase, /return <NavIcon name="calendar" className=\{className\} \/>;/);
});

test("Tonight (tonight) renders a moon glyph, distinct from every other case", () => {
  const tonightCase = ICONS.slice(ICONS.indexOf('case "tonight":'), ICONS.indexOf('case "weekend":'));
  assert.match(tonightCase, /A8\.5 8\.5 0 1110\.5 4a7 7 0 009\.5 10\.5z/, "crescent-moon path");
});

test("This Weekend (weekend) renders a calendar-range glyph built from the same base calendar shape plus a highlighted multi-day band", () => {
  const weekendCase = ICONS.slice(ICONS.indexOf('case "weekend":'), ICONS.indexOf('case "endingSoon":'));
  assert.match(weekendCase, /rect x="3\.5" y="5" width="17" height="15\.5" rx="2"/, "same calendar frame as NavIcon's own calendar");
  assert.match(weekendCase, /fill="currentColor" opacity="0\.25"/, "the added range band distinguishing it from plain calendar");
});

test("Ending Soon (endingSoon) renders a clock glyph", () => {
  const endingSoonCase = ICONS.slice(ICONS.indexOf('case "endingSoon":'), ICONS.indexOf('case "justAnnounced":'));
  assert.match(endingSoonCase, /<circle cx="12" cy="12" r="8\.5" stroke="currentColor"/, "clock face");
  assert.match(endingSoonCase, /M12 7\.5V12l3\.2 2/, "clock hands");
});

test("Just Announced (justAnnounced) renders a zap/lightning glyph", () => {
  const justAnnouncedCase = ICONS.slice(ICONS.indexOf('case "justAnnounced":'), ICONS.indexOf('case "today":'));
  assert.match(justAnnouncedCase, /M13 3L6 13h5l-1 8 7-10h-5l1-8z/, "lightning-bolt path");
});

test("all six cases produce textually distinct SVG markup — no icon is accidentally duplicated across two different kinds", () => {
  const svgs = ICONS.match(/<svg[\s\S]*?<\/svg>|<NavIcon[^/]*\/>/g) ?? [];
  assert.equal(svgs.length, 6);
  assert.equal(new Set(svgs).size, 6, "every one of the six render branches is unique markup");
});

// ── The five new icons stay OUT of the founder's nav-item icon picker ───

test("the five new local glyphs are never added to NavIcon.tsx's curated NAV_ICON_KEYS set — only the pre-existing \"calendar\" entry is reused", () => {
  const NAV_ICON = readFileSync("src/components/NavIcon.tsx", "utf8");
  for (const needle of ["pulse", "radio", "moon", "calendar-range", "endingSoon", "justAnnounced", "zap", "lightning"]) {
    assert.doesNotMatch(NAV_ICON, new RegExp(`case "${needle}"`, "i"));
  }
  const NAVIGATION = readFileSync("src/lib/navigation.ts", "utf8");
  // NAV_ICON_KEYS is untouched — still exactly the 10 pre-existing curated keys.
  assert.match(NAVIGATION, /export const NAV_ICON_KEYS = \[\s*\n\s*"compass",\s*\n\s*"pin",\s*\n\s*"target",\s*\n\s*"bookmark",\s*\n\s*"person",\s*\n\s*"tag",\s*\n\s*"calendar",\s*\n\s*"storefront",\s*\n\s*"home",\s*\n\s*"cart",\s*\n\s*\] as const;/);
});

// ── Design: white card, light-gray border, icon left of stacked text ───

test("the date/status tile is white with a 1px light-gray border (replacing the pale-aqua photo-tile background), and keeps rounded-2xl corners", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.match(dateStatusBranch, /className="group flex h-\[72px\] w-full items-center gap-2\.5 rounded-2xl border border-black\/10 bg-white/);
});

test("the icon sits left of a vertically stacked title (dark, semibold) over count (muted gray, regular weight)", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.match(dateStatusBranch, /className="group flex h-\[72px\] w-full items-center gap-2\.5/, "icon-left row layout, not the photo tile's flex-col");
  assert.match(dateStatusBranch, /<DateStatusIcon kind=\{dateStatusKind\} className="h-5 w-5 shrink-0 text-findmi-700" \/>/);
  assert.match(dateStatusBranch, /<span className="flex min-w-0 flex-1 flex-col">/, "title/count stacked vertically, to the right of the icon");
  assert.match(dateStatusBranch, /font-semibold leading-tight text-ink/, "title: dark charcoal (text-ink), semibold — not font-bold like the photo tile");
  assert.match(dateStatusBranch, /text-\[11px\] font-normal text-ink\/55/, "count: muted gray, regular weight");
});

test("the tile height is fixed at 72px — inside the approved ~68-80px mobile range, uniform at every breakpoint (no sm: override, unlike the photo tile's responsive aspect ratio)", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.match(dateStatusBranch, /h-\[72px\]/);
  assert.doesNotMatch(dateStatusBranch, /sm:h-|sm:aspect/);
});

test("a subtle teal border/focus treatment exists for hover and keyboard focus, using the existing findmi brand token — never a new color", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.match(dateStatusBranch, /hover:border-findmi-300/);
  assert.match(dateStatusBranch, /focus-visible:ring-2 focus-visible:ring-findmi-300/);
});

// ── Preservation: swipe, partial visibility, tap targets, counts, links ──

test("the outer w-[40%]/snap-start/sm:w-auto wrapper around every TopicTile (horizontal swipe + partial next-tile visibility) is completely untouched by this pass", () => {
  assert.equal((LANES.match(/className="w-\[40%\] shrink-0 snap-start sm:w-auto"/g) ?? []).length, 2, "one for the topics-kind rail, one for the areas-kind rail — both unchanged");
});

test("the date/status tile's own tap target is the entire Link (no nested interactive element, no reduced hit area)", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.equal((dateStatusBranch.match(/<a[\s>]|<button[\s>]|<Link[\s>]/g) ?? []).length, 1);
});

test("live counts still render exactly '1 Thing' / 'N Things', unchanged by the redesign", () => {
  const dateStatusBranch = TILE.slice(TILE.indexOf("if (dateStatusKind)"), TILE.indexOf("const showImage"));
  assert.match(dateStatusBranch, /\{count === 1 \? "1 Thing" : `\$\{count\} Things`\}/);
});

// ── Scope: photographic Topic tiles, Area tiles, and other sections untouched ──

test("photographic Topic/Area tiles (dateStatusKind null) are rendered by the untouched second branch — same classes as the prior pass", () => {
  const photoBranch = TILE.slice(TILE.indexOf("const showImage"), TILE.length);
  assert.match(photoBranch, /aspect-\[2\/1\] w-full flex-col justify-end overflow-hidden rounded-2xl bg-findmi-50 p-3 transition active:scale-\[0\.98\] sm:aspect-\[4\/3\]/);
});

test("DiscoveryTile (event/business/location/moment cards) and homepage ordering files are untouched by this pass", () => {
  const TILE_FILE = readFileSync("src/components/discovery/DiscoveryTile.tsx", "utf8");
  assert.doesNotMatch(TILE_FILE, /dateStatusKind|DateStatusIcon|h-\[72px\]/);
  const PAGE = readFileSync("src/app/(public)/page.tsx", "utf8");
  assert.doesNotMatch(PAGE, /dateStatusKind|DateStatusIcon/);
});
