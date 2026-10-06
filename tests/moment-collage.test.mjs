// Findmi Moments discovery — collage geometry, filters and static guards.
// Pure functions + source checks. No database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_COLLAGE_REGIONS,
  SEAM_DEGREES,
  collageLayout,
  collageOverflow,
  orderPreviewMedia,
} from "../src/lib/moment-collage.ts";
import {
  MOMENT_FILTER_LABELS,
  PRIMARY_MOMENT_FILTERS,
  isMomentFilterKey,
  momentCategoryTags,
  momentMatchesFilter,
} from "../src/lib/moment-filters.ts";

const ASPECTS = [16 / 10, 5 / 4, 4 / 3];

// Shoelace area of a polygon in collage-percentage units.
const area = (pts) => Math.abs(pts.reduce((a, [x1, y1], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return a + x1 * y2 - x2 * y1;
}, 0)) / 2;

test("region count is 1–5 and clamps outside that range", () => {
  for (const aspect of ASPECTS) {
    for (let n = 1; n <= 5; n++) assert.equal(collageLayout(n, aspect).length, n);
    assert.equal(collageLayout(0, aspect).length, 1);
    assert.equal(collageLayout(22, aspect).length, MAX_COLLAGE_REGIONS);
  }
});

test("layouts are deterministic", () => {
  for (const aspect of ASPECTS) for (let n = 1; n <= 5; n++) assert.deepEqual(collageLayout(n, aspect), collageLayout(n, aspect));
});

test("regions stay inside the frame and nearly tile it (thin seams only)", () => {
  for (const aspect of ASPECTS) {
    for (let n = 1; n <= 5; n++) {
      const regions = collageLayout(n, aspect);
      for (const reg of regions) for (const [x, y] of reg.points) {
        assert.ok(x >= -0.001 && x <= 100.001 && y >= -0.001 && y <= 100.001, `point ${x},${y} out of frame`);
      }
      const covered = regions.reduce((a, r) => a + area(r.points), 0);
      assert.ok(covered > 100 * 100 * 0.97 && covered <= 100 * 100 + 0.01, `n=${n} coverage ${covered}`);
    }
  }
});

test("the hero (region 0) dominates and multi-photo layouts are never equal grids", () => {
  for (const aspect of ASPECTS) {
    for (let n = 2; n <= 5; n++) {
      const areas = collageLayout(n, aspect).map((r) => area(r.points));
      assert.ok(areas[0] === Math.max(...areas), `hero not largest for n=${n}`);
      assert.ok(areas[0] / 10000 >= 0.5 && areas[0] / 10000 <= 0.66, `hero share ${areas[0] / 10000} for n=${n}`);
      const support = areas.slice(1).map((a) => Math.round(a));
      if (n >= 4) assert.equal(new Set(support).size, support.length, `supporting regions equal for n=${n}`);
    }
  }
});

test("main seam leans by the configured physical angle", () => {
  assert.ok(SEAM_DEGREES >= 2 && SEAM_DEGREES <= 4);
  const aspect = 5 / 4;
  const [hero] = collageLayout(2, aspect);
  const [, topRight, bottomRight] = hero.points; // [0,0],[xTop,0],[xBottom,100],[0,100]
  const dxPhysical = ((topRight[0] - bottomRight[0]) / 100) * aspect; // width units → height units
  const deg = (Math.atan(dxPhysical) * 180) / Math.PI;
  assert.ok(Math.abs(deg - SEAM_DEGREES) < 0.05, `seam ${deg}°`);
});

test("clip-paths are polygons and single photos are full-bleed", () => {
  const [only] = collageLayout(1, 5 / 4);
  assert.deepEqual(only.box, { left: 0, top: 0, width: 100, height: 100 });
  for (const reg of collageLayout(5, 5 / 4)) assert.match(reg.clipPath, /^polygon\(/);
});

test("preview order: cover first, then display_order, then id", () => {
  const ordered = orderPreviewMedia([
    { id: "c", is_cover: false, display_order: 1 },
    { id: "b", is_cover: false, display_order: 0 },
    { id: "a", is_cover: true, display_order: 5 },
    { id: "d", is_cover: false, display_order: 0 },
  ]);
  assert.deepEqual(ordered.map((m) => m.id), ["a", "b", "d", "c"]);
});

test("+N overflow only when more photos than regions", () => {
  assert.equal(collageOverflow(5, 5), null);
  assert.equal(collageOverflow(3, 3), null);
  assert.equal(collageOverflow(8, 5), 3);
});

test("filters: labels are Title Case, no Nearby, category tags from real slugs", () => {
  assert.equal(isMomentFilterKey("nearby"), false);
  assert.equal(PRIMARY_MOMENT_FILTERS[0], "for-you");
  for (const label of Object.values(MOMENT_FILTER_LABELS)) assert.match(label, /^[A-Z]/);
  assert.deepEqual(momentCategoryTags(["coffee", "market"]), ["food-drink", "pop-ups"]);
  assert.deepEqual(momentCategoryTags(["something-else"]), []);
});

test("following matches only this device's follows", () => {
  const moment = { tags: [], follow: { businessSlugs: ["tabli"], eventIds: ["e1"], locationIds: [] } };
  const none = { businessSlugs: [], eventIds: [], locationIds: [] };
  assert.equal(momentMatchesFilter(moment, "following", none), false);
  assert.equal(momentMatchesFilter(moment, "following", { ...none, eventIds: ["e1"] }), true);
  assert.equal(momentMatchesFilter(moment, "for-you", none), true);
  assert.equal(momentMatchesFilter(moment, "food-drink", none), false);
});

test("static guards: anon feed, no user ids in cards, no video, brand casing", () => {
  const feed = readFileSync("src/lib/moment-discovery.ts", "utf8");
  assert.match(feed, /import "server-only"/);
  assert.match(feed, /\.eq\("visibility", "public"\)/);
  assert.match(feed, /\.eq\("status", "published"\)/);
  const cardType = feed.slice(feed.indexOf("export interface MomentFeedCard"), feed.indexOf("export interface MomentFeedPage"));
  assert.doesNotMatch(cardType, /user_?[iI]d|email/);
  for (const f of [
    "src/components/moments/MomentMediaCollage.tsx",
    "src/components/moments/MomentDiscoveryCard.tsx",
    "src/components/moments/MomentsDiscovery.tsx",
    "src/app/(public)/moments/page.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /<video|autoPlay/, f);
    assert.doesNotMatch(src, /FindMi|FINDMI/, f);
    assert.doesNotMatch(src, /Math\.random|rotate\(/, f);
  }
});
