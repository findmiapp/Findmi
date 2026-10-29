// Moments UX polish (on top of the Moments consolidation): homepage grouped
// actions, one mode + Feed/Map row, the map's result tray, marker content,
// stale-selection clearing and the signed-out For You prompt. Pure helpers
// are exercised directly; the rest are static guards. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MM = await import("../src/lib/moment-map.ts");
const F = await import("../src/lib/moment-filters.ts");
const S = await import("../src/lib/auth/safe-redirect.ts");

const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const HOME = read("src/app/(public)/page.tsx");
const DISC = code(read("src/components/moments/MomentsDiscovery.tsx"));
const MAP = code(read("src/components/moments/MomentsMap.tsx"));
const CANVAS = read("src/components/map/DiscoveryMapCanvas.tsx");
const g = (locationId, place, lat, lng) => ({ locationId, place, lat, lng });
const CARDS = [
  { id: "m1", title: "Coffee Tasting", geo: g("L1", "430 W. Broadway", 40.72, -74.0) },
  { id: "m2", title: "Gelato", geo: g("L1", "430 W. Broadway", 40.72, -74.0) },
  { id: "m3", title: "Pop-Up", geo: g("L2", "Duffy Square", 40.76, -73.98) },
  { id: "m4", title: "No Place", geo: null },
];

// ── Homepage ────────────────────────────────────────────────────────────────

test("homepage: View All + My Journal are ONE compact grouped control (not loose underlined links)", () => {
  const nav = HOME.slice(HOME.indexOf("data-moments-actions"), HOME.indexOf("</nav>", HOME.indexOf("data-moments-actions")));
  assert.match(HOME, /<nav\s+aria-label="Findmi Moments"\s+data-moments-actions\s+className="ml-auto flex shrink-0 items-stretch overflow-hidden whitespace-nowrap rounded-md border border-black\/10 bg-white text-\[11px\] font-semibold text-ink\/70 min-\[380px\]:text-xs sm:rounded-lg"/);
  assert.match(nav, /<Link href="\/moments"[^>]*>\s*View All\s*<\/Link>/);
  assert.match(nav, /<Link href=\{MY_JOURNAL_HREF\}[^>]*>\s*My Journal\s*<\/Link>/);
  assert.match(nav, /<span aria-hidden="true" className="w-px bg-black\/10" \/>/, "a divider between the two halves");
  assert.doesNotMatch(nav, /underline/);
  assert.equal(F.MY_JOURNAL_HREF, "/journal");
  // Cards / category carousel below are unchanged.
  assert.match(HOME, /<MomentsDiscovery cards=\{momentFeed\.cards\} layout="carousel" showModes=\{false\} \/>/);
});

test("homepage: title and control share ONE row at every width — title never wraps or shrinks; control compact, right-aligned", () => {
  assert.match(HOME, /<div className="flex items-center gap-1\.5 min-\[380px\]:gap-2 sm:gap-3">\s*<BrandHeading id="home-moments-heading" accent="Moments" size="home" className="shrink-0 whitespace-nowrap" \/>/);
  const section = HOME.slice(HOME.indexOf('aria-labelledby="home-moments-heading"'), HOME.indexOf("<MomentsDiscovery cards={momentFeed.cards}"));
  assert.doesNotMatch(section, /flex-col|justify-between|trailing=/, "no stacked row, no stretched control");
  // Denser on phones (<380px: 11px, 5px segments; 380+: 12px, 8px), roomier from sm.
  assert.equal(section.split('className="flex h-[30px] items-center px-[5px] transition').length - 1, 2);
  assert.match(section, /min-\[380px\]:px-2 sm:h-8 sm:px-2\.5"/);
  assert.match(section, /<\/nav>\s*<\/div>\s*<p className=\{HOMEPAGE_SECTION_SUBTITLE_CLASS\}>Real experiences/, "description directly below the row");
});

// ── One control row ─────────────────────────────────────────────────────────

test("/moments: mode selector and Feed/Map share ONE row — mode takes the width, display stays compact", () => {
  assert.match(DISC, /<div data-moments-controls className="flex items-center gap-2">\s*\{showModes && \(\s*<div className="min-w-0 flex-1">\s*<MomentsModeTabs [^>]*\/>\s*<\/div>\s*\)\}\s*\{layout === "grid" && <DisplaySwitch display=\{display\} onChange=\{setDisplay\} \/>\}/);
  assert.match(DISC, /role="group" aria-label="Show Moments as" className="flex shrink-0 rounded-full bg-black\/\[0\.05\] p-1"/);
  // Same height as the mode tabs (h-9 inside p-1) → one aligned row.
  assert.match(read("src/components/moments/MomentsModeTabs.tsx"), /flex h-9 min-w-0 flex-auto/);
  assert.match(DISC, /flex h-9 min-w-9 items-center justify-center/);
});

test("Feed/Map: accessible at every width — named buttons, pressed state, existing icon set; labels from 420px", () => {
  assert.match(DISC, /aria-pressed=\{on\}\s*aria-label=\{o\.label\}/);
  assert.match(DISC, /\{ key: "feed", label: "Feed", icon: VIEW_MODE_ICONS\.list \}/);
  assert.match(DISC, /\{ key: "map", label: "Map", icon: VIEW_MODE_ICONS\.map \}/);
  assert.match(DISC, /on \? "bg-findmi text-white shadow-sm"/, "selected = filled Aqua, not color alone (also aria-pressed)");
  assert.match(DISC, /className="hidden min-\[420px\]:inline"/);
  assert.match(read("src/components/map/ViewModeSwitch.tsx"), /export const VIEW_MODE_ICONS/);
});

test("URL state is unchanged: mode, category and display stay deep-linkable", () => {
  assert.equal(F.momentFeedQuery("for-you", "food-drink", null, "map"), "mode=for-you&cat=food-drink&display=map");
  assert.deepEqual(F.parseMomentFeedState({ mode: "my-moments", display: "map" }).display, "map");
});

// ── Signed-out For You ──────────────────────────────────────────────────────

test("signed-out For You: compact Personalize prompt with Log In / Create Account; fallback Moments keep rendering", () => {
  assert.match(DISC, /const forYouAuth = unpersonalized && !signedIn \? forYouAuthHrefs\(hrefFor\("for-you", category, null, display, "\/moments"\)\) : null;/);
  assert.match(DISC, /Personalize For You<\/p>/);
  assert.match(DISC, /Log in or create an account to follow Businesses, Events and Places and get Moments picked for you\./);
  assert.match(DISC, /<Link href=\{forYouAuth\.login\}[\s\S]*?Log In/);
  assert.match(DISC, /<Link href=\{forYouAuth\.signup\}[\s\S]*?Create Account/);
  assert.match(DISC, /Showing the latest Moments for now\./);
  // Not a wall: the prompt sits above the feed; the cards still render below it.
  const at = DISC.indexOf("data-for-you-auth");
  assert.ok(at > 0 && DISC.indexOf("renderCards(visible)", at) > at);
});

test("auth return paths keep the exact For You view (mode, category, display) and stay same-origin", () => {
  const { login, signup } = F.forYouAuthHrefs("/moments?mode=for-you&cat=food-drink&display=map");
  assert.equal(login, "/login?next=%2Fmoments%3Fmode%3Dfor-you%26cat%3Dfood-drink%26display%3Dmap");
  assert.equal(signup, "/signup?next=%2Fmoments%3Fmode%3Dfor-you%26cat%3Dfood-drink%26display%3Dmap");
  assert.equal(S.getSafeRedirect(decodeURIComponent(login.split("next=")[1])), "/moments?mode=for-you&cat=food-drink&display=map", "the existing return-path guard accepts it");
  assert.equal(F.forYouAuthHrefs("/moments?mode=for-you").login, "/login?next=%2Fmoments%3Fmode%3Dfor-you");
  assert.equal(F.forYouAuthHrefs("https://evil.example/x").login, "/login?next=%2Fmoments%3Fmode%3Dfor-you", "never anything but /moments");
});

// ── Map markers + tray ──────────────────────────────────────────────────────

test("markers: place name + 'N Moments' (selected rich marker), count inside the compact dot, no '+N' label soup", () => {
  const [l1, l2] = MM.momentMapFeatures(CARDS);
  assert.deepEqual([l1.label, l1.status, l1.pinText, l1.plainLabel], ["430 W. Broadway", "2 Moments", "2", true]);
  assert.deepEqual([l2.label, l2.status, l2.pinText], ["Duffy Square", "1 Moment", "1"], "a single Moment's marker names the PLACE, not the Moment");
  assert.match(CANVAS, /label: f\.count > 1 && !f\.plainLabel \? `\$\{f\.label\} \+\$\{f\.count - 1\}` : f\.label,/);
  assert.match(CANVAS, /initial: f\.pinText \?\? \(f\.label \|\| f\.place \|\| "\?"\)\.slice\(0, 1\)\.toUpperCase\(\),/, "other maps keep their initial");
  assert.match(CANVAS, /mark\.textContent = f\.pinText \?\? \(f\.label \|\| "\?"\)\.slice\(0, 1\)\.toUpperCase\(\);/, "the selected marker's badge is the count too (never a stray '4' from '430 …')");
});

test("markers reflect the filtered dataset; a selection never outlives its marker", () => {
  const all = MM.momentMapFeatures(CARDS);
  const onlyDuffy = MM.momentMapFeatures(CARDS.filter((c) => c.id === "m3"));
  assert.equal(MM.validSelection(all, "moments:L1"), "moments:L1");
  assert.equal(MM.validSelection(onlyDuffy, "moments:L1"), null, "category / mode change drops the stale place");
  assert.equal(MM.validSelection(all, null), null);
  assert.match(MAP, /const features = useMemo\(\(\) => momentMapFeatures\(cards\), \[cards\]\);/, "markers come from the feed's own filtered cards");
  assert.match(MAP, /const selected = validSelection\(features, picked\);/);
  assert.match(MAP, /if \(picked && !selected\) setPicked\(null\);/);
  assert.match(code(read("src/components/moments/MomentsDiscovery.tsx")), /<MomentsMap cards=\{visible\} \/>/);
});

test("tray: the selected place's Moments, updated per selection, over the map", () => {
  const f = MM.momentMapFeatures(CARDS);
  assert.deepEqual(MM.momentsAt(f, "moments:L1", CARDS).map((m) => m.id), ["m1", "m2"]);
  assert.deepEqual(MM.momentsAt(f, "moments:L2", CARDS).map((m) => m.id), ["m3"], "changing the marker changes the tray");
  assert.deepEqual(MM.momentsAt(f, null, CARDS), []);
  assert.match(MAP, /const here = momentsAt\(features, selected, cards\);/);
  // Inside the map box (absolute, bottom), not below it.
  const box = MAP.slice(MAP.indexOf('className="relative h-[52vh]'), MAP.indexOf("</section>"));
  assert.match(box, /<section\s+aria-label=\{`Moments at \$\{feature\.place\}`\}\s+data-moments-tray\s+className="absolute bottom-2 left-2 right-12 z-10/);
  assert.match(box, /\{feature\.place\}<\/p>[\s\S]*?\{momentCountLabel\(here\.length\)\}/);
  assert.match(box, /<MomentDiscoveryCard moment=\{m\} variant="tray" \/>/, "the canonical Moment card, compact variant");
  assert.match(box, /snap-x snap-mandatory gap-2 overflow-x-auto/, "several Moments swipe sideways");
  // No below-map card grid any more.
  assert.doesNotMatch(MAP, /grid grid-cols-1 gap-x-4 gap-y-7/);
});

test("tray: dismissible (✕, Escape, empty-map tap) without leaving the map; map controls stay clear", () => {
  assert.match(MAP, /onClick=\{\(\) => setPicked\(null\)\}\s*aria-label="Close"/);
  assert.match(MAP, /e\.key === "Escape" && setPicked\(null\)/);
  assert.match(CANVAS, /if \(hit\.length === 0\) cb\.current\.onSelect\(null\);/, "empty-map tap clears (existing canvas behavior)");
  assert.match(MAP, /right-12/, "the right edge stays free for the zoom control + attribution");
  assert.match(MAP, /padding=\{\{ top: 40, bottom: TRAY_CLEARANCE, left: 24, right: 24 \}\}/, "the selected place is framed above the tray");
  assert.match(MAP, /focus=\{focus\}/);
});

test("clusters: the shared engine's cluster behavior is untouched (tap zooms to expand; counts sum)", () => {
  assert.match(CANVAS, /map\.on\("click", "fm-cluster", async \(e\) => \{[\s\S]*?getClusterExpansionZoom/);
  assert.match(CANVAS, /clusterProperties: \{ total: \["\+", \["get", "count"\]\]/);
  assert.match(MAP, /dynamic\(\(\) => import\("@\/components\/map\/DiscoveryMapCanvas"\)/);
});

test("privacy: the tray and markers only ever use the feed's own cards (owner-scoped, private-safe signed)", () => {
  // No new reads: the map draws what the feed already loaded under its scope.
  assert.doesNotMatch(MAP, /supabase|fetch\(|getMomentFeed|resolveSignedUrls/);
  const tray = read("src/components/moments/MomentDiscoveryCard.tsx");
  assert.match(tray, /const photo = moment\.media\[0\]\?\.url \?\? null;/, "the card's already-signed preview, nothing else");
  assert.match(read("src/lib/moment-discovery.ts"), /"card", \{ publicView: !owner \}\)/);
});

test("My Journal untouched by this pass (Year/Month approved)", () => {
  const j = read("src/app/(public)/journal/MyJournal.tsx");
  assert.match(j, /const months = buildYearHistory\(entries, year\);/);
  assert.match(j, /const monthEntries = sortNewestFirst\(entriesForMonth\(entries, anchor\)\);/);
});
