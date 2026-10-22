// Homepage Featured Locations — image eligibility. The pure selection logic
// (lib/featured-locations.ts) is tested directly; source guards pin that the
// filters run BEFORE the candidate limit / top-3 slice, are opt-in (every
// other Location feed is unchanged), and that the homepage hides the section
// when nothing qualifies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
registerHooks({
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith("/src/lib/featured-locations.ts")) {
      const path = new URL(url).pathname;
      const { code } = transform(readFileSync(path, "utf8"), { transforms: ["typescript"], filePath: path });
      return { format: "module", source: code, shortCircuit: true };
    }
    return next(url, context);
  },
});
const { hasUsableImageUrl, selectFeaturedLocations } = await import(pathToFileURL(resolve("src/lib/featured-locations.ts")).href);

const DATA = readFileSync("src/lib/data.ts", "utf8");
const HOME = readFileSync("src/app/(public)/page.tsx", "utf8");
const CARD = readFileSync("src/components/discover/FeaturedLocationCard.tsx", "utf8");
const IMG = "https://x.supabase.co/storage/v1/object/public/findmi-media/a.jpg";
const act = (id, imageUrl) => ({ id, imageUrl });
const loc = (id, cover, activities, activityCount = activities.length) => ({ id, cover_image_url: cover, activities, activityCount });

test("usable image: real http(s)/relative URLs only — blank, null and junk strings are rejected", () => {
  assert.equal(hasUsableImageUrl(IMG), true);
  assert.equal(hasUsableImageUrl("/images/x.jpg"), true);
  for (const bad of [null, undefined, "", "   ", "null", "undefined", "NULL", "not a url", "data:image/png;base64,AAAA"]) {
    assert.equal(hasUsableImageUrl(bad), false, String(bad));
  }
});

test("a Location without a usable cover image never qualifies", () => {
  const out = selectFeaturedLocations([loc("a", null, [act("e1", IMG)]), loc("b", "", [act("e1", IMG)]), loc("c", "  ", [act("e1", IMG)]), loc("d", IMG, [act("e1", IMG)])], 8);
  assert.deepEqual(out.map((l) => l.id), ["d"]);
});

test("image-less happenings are dropped from the rail; the rest keep their order", () => {
  const [l] = selectFeaturedLocations([loc("a", IMG, [act("e1", null), act("e2", IMG), act("e3", ""), act("e4", IMG)])], 8);
  assert.deepEqual(l.activities.map((a) => a.id), ["e2", "e4"]);
});

test("a Location with no qualifying happening is not featured (no empty Happening Here rail)", () => {
  const out = selectFeaturedLocations([loc("a", IMG, [act("e1", null), act("e2", "")]), loc("b", IMG, []), loc("c", IMG, [act("e1", IMG)], 0), loc("d", IMG, [act("e1", IMG)])], 8);
  assert.deepEqual(out.map((l) => l.id), ["d"]);
});

test("the limit applies AFTER eligibility — image-less records don't displace valid ones", () => {
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) => loc(`bad${i}`, null, [act("e", IMG)])),
    ...Array.from({ length: 3 }, (_, i) => loc(`ok${i}`, IMG, [act("e", IMG)])),
  ];
  assert.deepEqual(selectFeaturedLocations(candidates, 2).map((l) => l.id), ["ok0", "ok1"]);
});

test("nothing qualifies → empty result; the homepage hides the section cleanly", () => {
  assert.deepEqual(selectFeaturedLocations([loc("a", null, [act("e", IMG)])], 8), []);
  assert.match(HOME, /\{featuredLocations\.length > 0 && \(\s*<Section\s+title="Featured Locations"/);
});

test("input Locations are not mutated (nothing is hidden or rewritten elsewhere)", () => {
  const original = loc("a", IMG, [act("e1", null), act("e2", IMG)]);
  selectFeaturedLocations([original], 8);
  assert.equal(original.activities.length, 2);
});

test("data layer: cover filter runs in the query before .limit(); activity images before the top-3 slice; both opt-in", () => {
  assert.match(DATA, /requireCoverImage = false, requireActivityImages = false/);
  // The cover rule is now part of the canonical discovery filter (listed AND Logo AND Cover),
  // applied to the query before the limit for every caller — see location-discovery-eligibility.test.mjs.
  const q = DATA.indexOf('applyLocationDiscoveryFilter(supabase.from("locations").select("*, category:categories(id, name, slug)"))');
  const lim = DATA.indexOf('await query.order("name").limit(limit)');
  assert.ok(q > 0 && lim > q, "canonical (cover + logo) filter precedes the limit");
  assert.match(DATA, /if \(requireImages && !hasUsableImageUrl\(e\.cover_image_url\)\) continue;/);
  assert.match(DATA, /if \(requireImages && !hasUsableImageUrl\(appearanceImage\)\) continue;/);
  const filt = DATA.indexOf("if (requireImages && !hasUsableImageUrl(e.cover_image_url))");
  const slice = DATA.indexOf(".slice(0, ACTIVITY_PREVIEW_ITEMS_PER_LOCATION)");
  assert.ok(filt > 0 && slice > filt, "image filter precedes the per-Location slice");
  assert.match(DATA, /getLocations\(\{ limit: 60, requireCoverImage: true, requireActivityImages: true \}\)/);
  assert.match(DATA, /return selectFeaturedLocations\(locations, limit\)/);
});

test("only getFeaturedLocations opts in — /locations, /discover and every other getLocations caller are unchanged", () => {
  assert.equal(DATA.split("requireCoverImage: true").length - 1, 1);
  assert.equal(DATA.split("requireActivityImages: true").length - 1, 1);
  const SRC = ["src/app", "src/lib", "src/components"];
  const hits = [];
  const walk = (d) => {
    for (const e of require("node:fs").readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /requireCoverImage|requireActivityImages|selectFeaturedLocations/.test(readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  SRC.forEach(walk);
  assert.deepEqual(hits.sort(), ["src/lib/data.ts", "src/lib/featured-locations.ts"]);
});

test("card actions are untouched: Follow, Save, Directions and View This Location remain", () => {
  for (const needle of ["LocationFollowButton", "toggleSaved", "directionsHref", "View This Location"]) assert.ok(CARD.includes(needle), needle);
});
