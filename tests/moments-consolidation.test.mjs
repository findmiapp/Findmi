// Moments consolidation — ONE Moments product:
//   Findmi Moments (/moments)  discovery feed: Explore · For You · My Moments
//   My Moments                 the viewer's own Moments, same feed + cards
//   My Journal (/journal)      their chronological history, NOW → PAST
//   /my-world                  retired → /journal (compatibility redirect)
// Pure helpers are exercised directly; the rest are static source guards.
// No network, no production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const JA = await import("../src/lib/journalArchive.ts");
const MM = await import("../src/lib/moment-map.ts");
const F = await import("../src/lib/moment-filters.ts");

const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const HOME = read("src/app/(public)/page.tsx");
const DISC = read("src/components/moments/MomentsDiscovery.tsx");
const JOURNAL = read("src/app/(public)/journal/MyJournal.tsx");
const JPAGE = read("src/app/(public)/journal/page.tsx");
const FEED = read("src/lib/moment-discovery.ts");
const e = (id, entry_date, entry_time = null) => ({ id, entry_date, entry_time, coverUrl: null });

// ── Homepage module ─────────────────────────────────────────────────────────

test("homepage: a preview module — no Explore / For You / My Moments switch; category rail and card rail stay", () => {
  assert.match(HOME, /<MomentsDiscovery cards=\{momentFeed\.cards\} layout="carousel" showModes=\{false\} \/>/);
  assert.match(code(DISC), /\{showModes && \(\s*<div className="min-w-0 flex-1">\s*<MomentsModeTabs /, "the switch only renders when asked");
  assert.match(code(DISC), /role="group"\s+aria-label=\{`Filter \$\{MOMENTS_PAGE_MODE_LABELS\[mode\]\} by category`\}/, "category rail unchanged for every layout");
  assert.match(DISC, /function MomentCarousel\(/, "homepage cards keep the carousel presentation");
});

test("homepage: heading actions — View All → /moments, My Journal → /journal", () => {
  const section = HOME.slice(HOME.indexOf('aria-labelledby="home-moments-heading"'), HOME.indexOf("<MomentsDiscovery cards={momentFeed.cards}"));
  assert.match(section, /href="\/moments"[\s\S]*?>\s*View All\s*</);
  assert.match(section, /href=\{MY_JOURNAL_HREF\}[\s\S]*?>\s*My Journal\s*</);
  assert.doesNotMatch(section, /See All/);
  assert.equal(F.MY_JOURNAL_HREF, "/journal");
});

test("homepage: the abandoned Map button stays gone; the Search row is the pre-experiment markup", () => {
  assert.ok(!existsSync("src/components/HomeMapButton.tsx"));
  assert.doesNotMatch(HOME, /HomeMapButton|bg-\[#000000\]/);
  assert.match(HOME, /<div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">\s*<SearchBar marketSlug=\{marketSlug\} placeholder="Search anything you're into…" \/>\s*<\/div>/);
});

// ── /moments ────────────────────────────────────────────────────────────────

test("/moments: URL state — mode, its category and Feed/Map are deep-linkable; defaults omitted", () => {
  assert.equal(F.momentsModeHref("explore"), "/moments");
  assert.equal(F.momentsModeHref("my-moments"), "/moments?mode=my-moments");
  assert.equal(F.momentsModeHref("explore", "map"), "/moments?display=map");
  assert.equal(F.momentFeedQuery("for-you", "pop-ups", null, "map"), "mode=for-you&cat=pop-ups&display=map");
  const s = F.parseMomentFeedState({ mode: "my-moments", cat: "food-drink", display: "map" });
  assert.deepEqual(s, { mode: "my-moments", categories: { explore: "all", "for-you": "all", "my-moments": "food-drink" }, display: "map" });
  assert.equal(F.parseMomentFeedState({ display: "nonsense" }).display, "feed");
  assert.match(code(DISC), /const next = hrefFor\(mode, category, pagination\.cursor\);[\s\S]*?\}, \[mode, category, display\]\);/, "the address bar follows mode, category and display");
});

test("/moments: My Moments renders the SAME canonical cards through the same feed component", () => {
  const view = code(read("src/components/moments/MyMomentsView.tsx"));
  assert.match(view, /<MomentsDiscovery cards=\{page\.cards\} layout="grid" initialState=\{state\}/);
  assert.doesNotMatch(view, /JournalArchiveCard/);
  assert.match(DISC, /<MomentDiscoveryCard/);
  // Owner-only state is composed onto the one card, not a second card.
  assert.match(read("src/components/moments/MomentDiscoveryCard.tsx"), /\{moment\.ownerBadge && \(/);
  // Leaving My Moments for Explore / For You is a navigation (public cards aren't loaded).
  assert.match(code(DISC), /const ownCards = initialState\.mode === "my-moments";/);
});

test("/moments: My Moments links lightly to My Journal; empty and signed-out states are intentional", () => {
  assert.match(DISC, /mode === "my-moments" && \([\s\S]{0,120}<Link href=\{MY_JOURNAL_HREF\}[\s\S]*?View My Journal/);
  const view = read("src/components/moments/MyMomentsView.tsx");
  assert.match(view, /Your Moments will appear here\./);
  assert.match(view, /href=\{ADD_MOMENT_HREF\}[\s\S]*?Add Moment/);
  assert.match(view, /if \(page === null\)[\s\S]*?<SignedOut \/>/);
  assert.match(read("src/app/(public)/moments/page.tsx"), /trailing=\{\s*<Link\s+href=\{ADD_MOMENT_HREF\}/, "Add Moment stays on /moments");
});

test("feed loader: owner scope = the Journal's ownership rule; public scope unchanged", () => {
  assert.match(FEED, /const scope = await ownMomentsScope\(owner\.client, owner\.userId\);\s*query = scopeToOwnMoments\(query, owner\.userId, scope\.authorship, scope\.managedIds\);/);
  assert.match(FEED, /query = query\.eq\("visibility", "public"\)\.eq\("status", "published"\);/);
  assert.match(FEED, /"card", \{ publicView: !owner \}\)/, "public viewers only ever get metadata-free variants");
  assert.match(read("src/lib/journal.ts"), /query = scopeToOwnMoments\(query, userId, authorship, managedIds\);/, "the archive uses the same rule");
});

// ── Moments Map ─────────────────────────────────────────────────────────────

test("map points only from real relationships: the Moment's Location, else an Event date's Location (never hidden, never a Business)", () => {
  assert.match(FEED, /function locationGeo\(l: EntryLocation \| null \| undefined\): MomentGeo \| null \{\s*if \(!l \|\| l\.is_demo/);
  assert.match(FEED, /one\(o\.event\)\?\.location_visibility === "hidden" \? null : locationGeo\(one\(o\.location\)\)/);
  assert.match(FEED, /locationGeo\(location\) \?\?\s*rConns\.map\(\(c\) => \(c\.event_occurrence_id \?/);
  assert.doesNotMatch(code(FEED), /geocode|business.*latitude/i);
});

test("momentMapFeatures: one marker per Location with the Moment count; un-placed Moments skipped", () => {
  const g = (locationId, place, lat, lng) => ({ locationId, place, lat, lng });
  const features = MM.momentMapFeatures([
    { id: "m1", title: "Coffee", geo: g("L1", "Eataly", 40.74, -73.99) },
    { id: "m2", title: "Gelato", geo: g("L1", "Eataly", 40.74, -73.99) },
    { id: "m3", title: "Pop-Up", geo: g("L2", "Duffy Square", 40.76, -73.98) },
    { id: "m4", title: "Somewhere", geo: null },
  ]);
  assert.deepEqual(
    features.map((f) => [f.id, f.count, f.label, f.status, f.keys]),
    [
      ["moments:L1", 2, "Eataly", "2 Moments", ["m1", "m2"]],
      ["moments:L2", 1, "Duffy Square", "1 Moment", ["m3"]],
    ]
  );
  assert.ok(features.every((f) => f.live === false && f.tone === "place"), "never the red LIVE treatment");
  assert.equal(MM.mappableCount([{ id: "a", title: "", geo: null }, { id: "b", title: "", geo: g("L", "P", 1, 2) }]), 1);
  assert.equal(MM.momentMapBounds([]), null);
  assert.deepEqual(MM.momentMapBounds(features, 0), [-73.99, 40.74, -73.98, 40.76]);
});

test("Moments Map reuses the one map renderer (DiscoveryMapCanvas) — no second engine, /map untouched", () => {
  const map = code(read("src/components/moments/MomentsMap.tsx"));
  assert.match(map, /dynamic\(\(\) => import\("@\/components\/map\/DiscoveryMapCanvas"\)/);
  assert.doesNotMatch(map, /maplibre-gl|new maplibregl|Search This Area/);
  assert.match(code(DISC), /const showMap = layout === "grid" && display === "map";/);
  assert.match(code(DISC), /<MomentsMap cards=\{visible\} \/>/, "the map draws exactly the feed's filtered Moments");
  assert.doesNotMatch(read("src/app/(public)/map/page.tsx"), /Moment/);
});

// ── My Journal ──────────────────────────────────────────────────────────────

test("/journal: no subject → My Journal (signed out → canonical login, returning to /journal); subjects unchanged", () => {
  assert.match(JPAGE, /if \(!hasSubject\(params\)\) \{[\s\S]*?redirect\("\/login\?next=" \+ encodeURIComponent\(qs \? `\/journal\?\$\{qs\}` : "\/journal"\)\);[\s\S]*?return <MyJournal userId=\{user\.id\} params=\{params\} \/>;/);
  assert.match(JPAGE, /if \(!hasSubject\(params\)\) return \{ title: "My Journal", robots: \{ index: false \} \};/);
  assert.match(JPAGE, /const subject = await resolveSubject\(params\);\s*if \(!subject\) notFound\(\);/);
  assert.match(JOURNAL, />My Journal<\/h1>/);
  assert.match(JOURNAL, /Your personal history of the places, brands and experiences you&rsquo;ve lived\./);
  assert.match(JOURNAL, /return `\/journal\?\$\{qp\.toString\(\)\}`;/, "every view/date/filter link stays on /journal");
});

test("/my-world is retired: compatibility redirects to /journal, no live duplicate page", () => {
  const cfg = read("next.config.mjs");
  assert.match(cfg, /\{ source: "\/my-world", missing: \[jcHost\], destination: "\/journal", permanent: true \}/);
  assert.match(cfg, /\{ source: "\/my-world\/journal", missing: \[jcHost\], destination: "\/journal", permanent: true \}/);
  assert.ok(!existsSync("src/app/(public)/my-world/page.tsx"));
  assert.ok(!existsSync("src/app/(public)/my-world/journal/page.tsx"));
  // The composer + editor routes are untouched (no second creation flow).
  assert.ok(existsSync("src/app/(public)/my-world/journal/new/page.tsx"));
  assert.equal(F.ADD_MOMENT_HREF, "/my-world/journal/new");
  // No redirect loop: /journal is a real page, never redirected.
  assert.doesNotMatch(cfg, /source: "\/journal"/);
});

test("internal navigation points straight at /journal (no hop through the redirect)", () => {
  for (const f of ["src/lib/primary-nav.ts", "src/app/(public)/account/PersonalAppShell.tsx", "src/app/(public)/account/page.tsx", "src/app/(public)/account/privacy/page.tsx", "src/app/(public)/event/[slug]/EventPublicView.tsx", "src/app/(public)/join/welcome/page.tsx", "src/components/moments/MyMomentsView.tsx", "src/components/moments/MomentsDiscovery.tsx"]) {
    assert.doesNotMatch(code(read(f)), /"\/my-world"|"\/my-world\/journal"|=\/my-world/, f);
  }
  assert.match(read("src/lib/primary-nav.ts"), /\{ href: "\/journal", label: "My Journal", icon: "moments", match: \["=\/journal"\] \}/);
});

test("Journal header: no Saved & Following / Saved / Explore Moments detours; Add Moment stays", () => {
  const c = code(JOURNAL);
  assert.doesNotMatch(c, /Saved &(amp;)? Following|href="\/account\/saved"|Explore Moments|href="\/moments"/);
  assert.match(c, /href=\{ADD_MOMENT_HREF\}[\s\S]*?Add Moment/);
});

test("Journal empty state is intentional", () => {
  assert.match(JOURNAL, /Start building your Journal\./);
  assert.match(JOURNAL, /Add Your First Moment/);
});

test("chronology: newest first within a day (timed later first, then untimed), and across days", () => {
  const out = JA.sortNewestFirst([e("a", "2026-10-01", "09:00"), e("b", "2026-10-03"), e("c", "2026-10-01", "18:30"), e("d", "2026-10-01")]);
  assert.deepEqual(out.map((x) => x.id), ["b", "c", "a", "d"]);
  const groups = JA.groupNewestFirst([e("a", "2026-09-02"), e("b", "2026-09-28"), e("c", "2026-09-15")]);
  assert.deepEqual(groups.map(([d]) => d), ["2026-09-28", "2026-09-15", "2026-09-02"]);
});

test("Year: only months with Moments, latest month first — no January…December graveyard", () => {
  const months = JA.buildYearHistory([e("a", "2026-10-02"), e("b", "2026-03-11"), e("c", "2026-10-20"), e("d", "2025-12-31")], 2026);
  assert.deepEqual(months.map((m) => [m.label, m.count]), [["October", 2], ["March", 1]]);
  assert.deepEqual(JA.buildYearHistory([], 2026), []);
  assert.doesNotMatch(JOURNAL, /"No Moments"\s*\}/, "no per-month 'No Moments' rows");
  assert.match(JOURNAL, /No Moments in \$\{year\}\./, "an empty year says so once");
});

test("every Journal view uses the newest-first helpers", () => {
  const c = code(JOURNAL);
  assert.match(c, /const monthEntries = sortNewestFirst\(entriesForMonth\(entries, anchor\)\);/);
  assert.match(c, /const weekEntries = sortNewestFirst\(entriesForWeek\(entries, weekDays\)\);\s*const days = groupNewestFirst\(weekEntries\);/);
  assert.match(c, /const dayEntries = sortNewestFirst\(entriesForDay\(entries, ymd\)\);/);
  assert.match(c, /const months = buildYearHistory\(entries, year\);/);
  assert.match(c, /const newest = sortNewestFirst\(entries\);/);
});
