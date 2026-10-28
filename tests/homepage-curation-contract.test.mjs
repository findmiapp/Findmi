// Consolidated Finish pass — the homepage curation contract. Regression
// coverage for three production misses found READ-ONLY on 2026-10-28:
//   • Featured Locations: Atlantic Terminal Plaza / Duffy Square / 262 Mott
//     Street have a Cover but no Logo, and the lane required both.
//     Duffy Square's only happening (Tamagotchi Times Square Spectacular)
//     also has no Event cover — its host Business's real imagery is used.
//   • Brands We Love: RYZE Superfoods and Tamagotchi are live + Featured
//     but have no Appearance rows — only HOSTED upcoming Events — so the
//     primary row's "upcoming presence" gate excluded them; ordering was a
//     random shuffle within tiers.
//   • What's Happening: fetched 10 show_on_homepage Events but rendered 6;
//     the Tamagotchi Event was 7th chronologically.
// Pure functions + static source guards; no network, no production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const D = await import("../src/lib/data.ts");
const L = await import("../src/lib/location-eligibility.ts");
const F = await import("../src/lib/featured-locations.ts");
const DATA = readFileSync("src/lib/data.ts", "utf8");
const HOME = readFileSync("src/app/(public)/page.tsx", "utf8");

const COVER = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/locations/cover.jpg";
const LOGO = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/businesses/logo.png";
const fnBody = (name) => {
  const start = DATA.indexOf(`export async function ${name}`) >= 0 ? DATA.indexOf(`export async function ${name}`) : DATA.indexOf(`export function ${name}`);
  return DATA.slice(start, DATA.indexOf("\n}\n", start) + 2);
};

// ── Featured Locations ────────────────────────────────────────────────────

test("lane: a listed Location with a Cover but NO Logo qualifies (Atlantic Terminal / Duffy Square / 262 Mott shape)", () => {
  for (const name of ["Atlantic Terminal Plaza", "Duffy Square", "262 Mott Street"]) {
    const loc = { name, is_demo: false, logo_url: null, cover_image_url: COVER };
    assert.equal(L.isFeaturedLaneLocation(loc), true, name);
    // …while full consumer discovery (cards, search, sitemap, map) is unchanged.
    assert.equal(L.isLocationDiscoverable(loc), false, name);
  }
});

test("lane: still requires listed + a renderable Cover", () => {
  assert.equal(L.isFeaturedLaneLocation({ is_demo: true, logo_url: LOGO, cover_image_url: COVER }), false);
  assert.equal(L.isFeaturedLaneLocation({ is_demo: false, logo_url: LOGO, cover_image_url: null }), false);
  assert.equal(L.isFeaturedLaneLocation({ is_demo: false, logo_url: LOGO, cover_image_url: "https://evil.example.com/x.jpg" }), false);
  assert.equal(L.isFeaturedLaneLocation(null), false);
});

test("lane: DB filter is listed + Cover only (no logo_url clause); discovery filter still demands both", () => {
  const calls = [];
  const q = { eq: (...a) => (calls.push(["eq", ...a]), q), or: (s) => (calls.push(["or", s]), q) };
  L.applyFeaturedLaneLocationFilter(q);
  assert.deepEqual(calls[0], ["eq", "is_demo", false]);
  assert.equal(calls.filter(([k]) => k === "or").length, 1);
  assert.ok(calls[1][1].includes("cover_image_url.ilike.") && !calls[1][1].includes("logo_url"));
  calls.length = 0;
  L.applyLocationDiscoveryFilter(q);
  assert.equal(calls.filter(([k]) => k === "or").length, 2);
});

test("lane: only getFeaturedLocations opts in, and the lane is ordered deterministically (name, then id) before the limit", () => {
  const body = fnBody("getLocations");
  assert.match(body, /requireCoverImage \? applyFeaturedLaneLocationFilter\(baseLocationQuery\) : applyLocationDiscoveryFilter\(baseLocationQuery\)/);
  assert.match(body, /\.order\("name"\)\.order\("id"\)\.limit\(limit\)/);
  assert.equal(DATA.split("requireCoverImage: true").length - 1, 1);
});

test("happening image: Event cover → live host Business cover → host logo; never a placeholder", () => {
  const host = { logo_url: LOGO, cover_image_url: COVER, is_demo: false, publication_status: "live" };
  assert.equal(D.eventPreviewImage({ cover_image_url: "https://x.supabase.co/storage/v1/object/public/e.jpg", host }), "https://x.supabase.co/storage/v1/object/public/e.jpg");
  // Tamagotchi Times Square Spectacular shape: no Event cover, live host with imagery.
  assert.equal(D.eventPreviewImage({ cover_image_url: null, host }), COVER);
  assert.equal(D.eventPreviewImage({ cover_image_url: null, host: [{ ...host, cover_image_url: null }] }), LOGO);
  // Unlisted / demo hosts lend nothing; no host → stays image-less (dropped from the lane).
  assert.equal(D.eventPreviewImage({ cover_image_url: null, host: { ...host, publication_status: "draft" } }), null);
  assert.equal(D.eventPreviewImage({ cover_image_url: null, host: { ...host, is_demo: true } }), null);
  assert.equal(D.eventPreviewImage({ cover_image_url: null, host: null }), null);
});

test("Duffy Square end-to-end shape: no Logo + host-imaged happening → featured", () => {
  const duffy = { id: "duffy", is_demo: false, logo_url: null, cover_image_url: COVER, activityCount: 1 };
  const host = { logo_url: LOGO, cover_image_url: null, is_demo: false, publication_status: "live" };
  const activities = [{ id: "occ", imageUrl: D.eventPreviewImage({ cover_image_url: null, host }) }];
  assert.equal(L.isFeaturedLaneLocation(duffy), true);
  assert.deepEqual(F.selectFeaturedLocations([{ ...duffy, activities }], 8).map((l) => l.id), ["duffy"]);
});

test("privacy: only location_visibility='hidden' Events are withheld from a place; 'none' (262 Mott's Salt & Stone Event) still counts", () => {
  // excludeHiddenEventRows (lib/event-location-privacy.ts) drops only 'hidden' Events from a
  // precise place. 262 Mott Street's only Event is location_visibility='none' with occurrences
  // AT 262 Mott, so it counts and the Location is featured once the Logo rule is lifted.
  assert.match(fnBody("getLocations"), /excludeHiddenEventRows/);
  assert.match(readFileSync("src/lib/event-location-privacy.ts", "utf8"), /\.eq\("location_visibility", "hidden"\)/);
  const mott = { id: "mott", is_demo: false, logo_url: null, cover_image_url: COVER, activityCount: 4, activities: [{ id: "occ", imageUrl: COVER }] };
  assert.deepEqual(F.selectFeaturedLocations([mott], 8).map((l) => l.id), ["mott"]);
  // A Location whose only happenings ARE withheld has no activity and is not featured.
  assert.deepEqual(F.selectFeaturedLocations([{ ...mott, activityCount: 0, activities: [] }], 8), []);
});

test("the occurrence preview embeds the host Business through the real FK", () => {
  assert.match(DATA, /host:businesses!events_host_business_id_fkey\(logo_url, cover_image_url, is_demo, publication_status\)/);
});

// ── Brands We Love ────────────────────────────────────────────────────────

const biz = (id, name, is_featured = true, founding_member = false) => ({ id, name, is_featured, founding_member });

test("order: deterministic — same input, same output, every time (no Math.random)", () => {
  const rows = [biz("c", "Ceres"), biz("a", "Alpyn"), biz("b", "Bloom"), biz("d", "Dune")];
  const first = D.orderHomepageBusinesses(rows).map((b) => b.id);
  for (let i = 0; i < 20; i++) assert.deepEqual(D.orderHomepageBusinesses([...rows].reverse()).map((b) => b.id), first);
  assert.deepEqual(first, ["a", "b", "c", "d"]);
  assert.doesNotMatch(fnBody("getHomepageRowBusinesses"), /Math\.random|shuffle/);
  assert.doesNotMatch(fnBody("orderHomepageBusinesses"), /Math\.random/);
});

test("order: founder tiers first, then soonest upcoming presence, then name, then id", () => {
  const rows = [biz("late", "Aardvark"), biz("soon", "Zed"), biz("fm", "Mid", true, true), biz("plain", "Plain", false, false), biz("none", "Bee")];
  const soonest = new Map([
    ["late", "2026-11-22T14:00:00.000Z"],
    ["soon", "2026-11-01T13:00:00.000Z"],
  ]);
  assert.deepEqual(D.orderHomepageBusinesses(rows, soonest).map((b) => b.id), ["fm", "soon", "late", "none", "plain"]);
  // id tiebreak for identical names
  assert.deepEqual(D.orderHomepageBusinesses([biz("b2", "Same"), biz("b1", "Same")]).map((b) => b.id), ["b1", "b2"]);
  // input is not mutated
  const input = [biz("z", "Z"), biz("a", "A")];
  D.orderHomepageBusinesses(input);
  assert.deepEqual(input.map((b) => b.id), ["z", "a"]);
});

test("presence: hosting an upcoming live, listed Event counts (RYZE / Tamagotchi shape); Appearances still count", () => {
  const body = fnBody("getBusinessUpcomingPresence");
  assert.match(body, /from\("appearances"\)[\s\S]*\.neq\("status", "canceled"\)[\s\S]*\.gt\("end_at", nowIso\)/);
  assert.match(body, /from\("events"\)[\s\S]*\.not\("host_business_id", "is", null\)[\s\S]*\.eq\("publication_status", "live"\)[\s\S]*\.eq\("is_demo", false\)[\s\S]*\.is\("archived_at", null\)[\s\S]*\.is\("trashed_at", null\)/);
  assert.match(body, /from\("event_occurrences"\)[\s\S]*\.eq\("status", "scheduled"\)[\s\S]*occurrenceUpcomingOr\(nowIso, todayIn\(APP_TIMEZONE\)\)/);
  assert.doesNotMatch(body, /event_businesses/, "participation rows still never gate display");
  // The Set resolver every caller already uses is exactly this map's keys — one definition.
  assert.match(fnBody("getBusinessIdsWithUpcomingAppearance"), /getBusinessUpcomingPresence\(candidateIds\)/);
});

test("presence gate + featuredOnly compose: RYZE/Tamagotchi (featured, hosted-event presence) are eligible", () => {
  const presence = new Map([
    ["ryze", "2026-11-01T13:00:00.000Z"],
    ["tamagotchi", "2026-11-22T14:00:00.000Z"],
    ["saltstone", "2026-10-29T14:00:00.000Z"],
  ]);
  const featured = new Set(["ryze", "tamagotchi", "saltstone", "quiet"]);
  const eligible = D.composeEligibleBusinessIds(["ryze", "tamagotchi", "saltstone", "quiet", "unfeatured"], {
    requireUpcomingAppearance: true,
    featuredOnly: true,
    upcomingIds: new Set(presence.keys()),
    featuredIds: featured,
  });
  assert.deepEqual(eligible, ["ryze", "tamagotchi", "saltstone"]);
  const rows = [biz("tamagotchi", "Tamagotchi"), biz("ryze", "RYZE Superfoods"), biz("saltstone", "Salt & Stone")];
  assert.deepEqual(D.orderHomepageBusinesses(rows, presence).map((b) => b.id), ["saltstone", "ryze", "tamagotchi"]);
});

test("getHomepageRowBusinesses: order applied BEFORE the row limit, with the presence map from the gate", () => {
  const body = fnBody("getHomepageRowBusinesses");
  assert.match(body, /getBusinessUpcomingPresence\(liveIds\)/);
  assert.match(body, /const ordered = orderHomepageBusinesses\(.*, soonestById\);\s*return attachCategories\(ordered\.slice\(0, params\.limit \?\? 8\)\);/);
});

// ── What's Happening ──────────────────────────────────────────────────────

test("What's Happening: one capacity for fetch AND render — no hidden slice drops eligible Events", () => {
  assert.match(HOME, /const HOMEPAGE_HAPPENING_LIMIT = 10;/);
  assert.match(HOME, /getUpcomingEvents\(HOMEPAGE_HAPPENING_LIMIT, WINDOW_BY_TIME_KEY\[timeKey\], marketSlug, areaSlug\)/);
  assert.match(HOME, /\{nextEvents\.map\(\(event, i\) => \(/);
  assert.doesNotMatch(HOME, /nextEvents\.slice\(0, 6\)/);
});

test("What's Happening: eligibility is show_on_homepage, ordered chronologically with an id tiebreak (deterministic)", () => {
  assert.match(fnBody("getUpcomingEvents"), /requireShowOnHomepage: true/);
  assert.match(DATA, /\.order\("occurrence_date", \{ ascending: true \}\)\s*\.order\("start_at", \{ ascending: true, nullsFirst: false \}\)\s*\.order\("id", \{ ascending: true \}\)/);
});
