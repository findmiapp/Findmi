// Public Moment continuous gallery (Pass A) — /journal/[id] renders its
// photos as ONE continuous story (stored display order, no section
// headings/carousels) with per-photo category badges and a local-state
// category filter. Replaces the retired named-section carousel suite.
// Pure rules are exercised directly (src/lib/moment-gallery.ts); component
// and page composition are pinned with source-level guards, following this
// repo's convention (no JSX rendering harness). No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const G = await import("../src/lib/moment-gallery.ts");

const PAGE = readFileSync("src/app/(public)/journal/[id]/page.tsx", "utf8");
const MOMENT = readFileSync("src/components/journal/JournalMomentGallery.tsx", "utf8");
const GALLERY = readFileSync("src/components/journal/JournalPhotoGallery.tsx", "utf8");
const VIEWER = readFileSync("src/components/journal/JournalMediaViewer.tsx", "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const sec = (id, section_type, title = null, notes = null) => ({ id, section_type, title, notes });
const ph = (id, sectionId = null, isCover = false) => ({ id, sectionId, isCover });
const ids = (list) => list.map((p) => p.id);

// A sectioned Moment in stored display order: cover in "place", then the
// rest flattened section by section, then uncategorized.
const SECTIONS = [sec("s-place", "place", null, "Rooftop at golden hour."), sec("s-food", "food_drink"), sec("s-empty", "details", null, "Notes only."), sec("s-other", "other")];
const PHOTOS = [ph("p1", "s-place", true), ph("p2", "s-place"), ph("p3", "s-food"), ph("p4", "s-food"), ph("p5", "s-other"), ph("p6"), ph("p7")];

// ── Labels: untitled `other` is never a category; custom titles always are ─
test("labels: type label, custom title wins, untitled other / unknown types get none", () => {
  assert.equal(G.momentCategoryLabel(sec("a", "food_drink")), "Food & Drink");
  assert.equal(G.momentCategoryLabel(sec("a", "place", "  The Terrace ")), "The Terrace");
  assert.equal(G.momentCategoryLabel(sec("a", "other")), null);
  assert.equal(G.momentCategoryLabel(sec("a", "other", "   ")), null);
  assert.equal(G.momentCategoryLabel(sec("a", "other", "Backstage")), "Backstage");
  assert.equal(G.momentCategoryLabel(sec("a", "mystery")), null);
  assert.notEqual(G.momentCategoryLabel(sec("a", "other")), "More Photos");
});

// ── Chips ─────────────────────────────────────────────────────────────────
test("chips: section display order, section identity, only sections with photos", () => {
  const cats = G.momentGalleryCategories(SECTIONS, PHOTOS);
  assert.deepEqual(cats.map((c) => c.id), ["s-place", "s-food"], "notes-only section and untitled other get no chip");
  assert.deepEqual(cats.map((c) => c.label), ["The Place", "Food & Drink"]);
  // Duplicate labels are never merged — identity is the section id.
  const dup = G.momentGalleryCategories([sec("x", "place"), sec("y", "place")], [ph("1", "x"), ph("2", "y")]);
  assert.deepEqual(dup.map((c) => [c.id, c.label]), [["x", "The Place"], ["y", "The Place"]]);
  // A custom-titled other is a normal category.
  assert.deepEqual(G.momentGalleryCategories([sec("o", "other", "Backstage")], [ph("1", "o")]).map((c) => c.label), ["Backstage"]);
  // A section whose only photo is the cover still has photos.
  assert.deepEqual(G.momentGalleryCategories([sec("c", "place")], [ph("1", "c", true)]).map((c) => c.id), ["c"]);
});

test("filter strip only when it offers a meaningful choice", () => {
  const show = (sections, photos) => G.showMomentFilter(G.momentGalleryCategories(sections, photos), photos);
  assert.equal(show([], [ph("1", null, true), ph("2"), ph("3")]), false, "unsectioned Moment");
  assert.equal(show([sec("o", "other")], [ph("1", "o"), ph("2", "o")]), false, "untitled other only");
  assert.equal(show([sec("a", "place")], [ph("1", "a", true), ph("2", "a"), ph("3", "a")]), false, "one category holding the whole story repeats All");
  assert.equal(show([sec("a", "place")], [ph("1", "a"), ph("2")]), true, "one category + uncategorized photos");
  assert.equal(show([sec("a", "place"), sec("b", "food_drink")], [ph("1", "a"), ph("2", "b")]), true);
  assert.equal(show(SECTIONS, PHOTOS), true);
});

// ── Views ─────────────────────────────────────────────────────────────────
test("All: the full story in stored order, cover INCLUDED in its own place, nothing duplicated", () => {
  assert.deepEqual(ids(G.momentGalleryPhotos(PHOTOS, null)), ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
  const shuffled = [ph("z"), ph("a", "s1"), ph("m"), ph("b", "s1")];
  assert.deepEqual(ids(G.momentGalleryPhotos(shuffled, null)), ["z", "a", "m", "b"], "never regrouped by section");
});

test("a category: exactly that section's photos in order, its cover included", () => {
  assert.deepEqual(ids(G.momentGalleryPhotos(PHOTOS, "s-place")), ["p1", "p2"]);
  assert.deepEqual(ids(G.momentGalleryPhotos(PHOTOS, "s-food")), ["p3", "p4"]);
  assert.deepEqual(ids(G.momentGalleryPhotos(PHOTOS, "s-empty")), []);
});

// ── Page composition ─────────────────────────────────────────────────────
test("page: one continuous gallery — no section headings, carousels or More Photos", () => {
  const c = code(PAGE);
  assert.match(c, /<JournalMomentGallery\s+photos=\{galleryPhotos\}\s+sections=\{gallerySections\}\s+title=\{entry\.title\}\s+adminToolbar=\{isAuthorizedAdmin\}\s+addMomentHref=\{addMomentHref\}\s+\/>/);
  assert.doesNotMatch(c, /JournalSectionCarousel|More Photos|journalSectionLabel|section-\$\{|photoSections|<JournalPhotoGallery/);
  assert.equal(existsSync("src/components/journal/JournalSectionCarousel.tsx"), false, "carousel deleted");
  assert.equal(existsSync("tests/journal-section-carousel.test.mjs"), false);
  assert.match(c, /const firstPhotosAnchor = hasGallery \? "moment-photos" : null;/);
});

test("page: photos keep stored order; cover flagged (not removed); unknown section ids read as uncategorized", () => {
  const c = code(PAGE);
  assert.match(c, /const galleryPhotos = media\.map\(\(m\) => \(\{/, "the stored media order, unfiltered");
  assert.match(c, /sectionId: m\.section_id && sectionIds\.has\(m\.section_id\) \? m\.section_id : null,/);
  assert.match(c, /isCover: m\.id === cover\?\.id,/, "the same photo the hero shows");
  assert.match(c, /const hasGallery = galleryPhotos\.length > 0;/);
});

test("page: hero keeps the shared page-level viewer over display_order", () => {
  const c = code(PAGE);
  assert.match(c, /const viewerItems: MediaViewerItem\[\] = media\s*\.filter/);
  assert.match(c, /<JournalPhotoTrigger index=\{coverIndex\}/);
  assert.match(c, /<JournalMediaViewerRoot items=\{viewerItems\}>\{pageBody\}<\/JournalMediaViewerRoot>/);
});

// ── Gallery component ────────────────────────────────────────────────────
test("gallery: All vs category through the pure rules; filter is local state only", () => {
  const c = code(MOMENT);
  assert.match(c, /useState<string \| null>\(null\)/);
  assert.match(c, /const visible = momentGalleryPhotos\(photos, active\?\.id \?\? null\);/);
  assert.match(c, /const hasFilter = showMomentFilter\(categories, photos\);/);
  assert.doesNotMatch(c, /useRouter|useSearchParams|usePathname|location\.hash|history\.|\?category=|searchParams/);
});

test("viewer: a nested root scoped to the visible set, re-keyed per filter", () => {
  const c = code(MOMENT);
  assert.match(c, /<JournalMediaViewerRoot key=\{active\?\.id \?\? "all"\} items=\{viewerItems\}>\s*<JournalPhotoGallery items=\{items\} \/>/);
  assert.match(c, /const items: JournalGalleryItem\[\] = visible\.map/);
  assert.match(c, /mediaIndex = viewerItems\.length;\s*viewerItems\.push\(\{ id: p\.id, src: p\.src/);
  // Shared architecture intact: context + trigger, MediaViewer lazily mounted.
  assert.match(VIEWER, /export function JournalMediaViewerRoot/);
  assert.match(VIEWER, /export function JournalPhotoTrigger/);
  assert.match(GALLERY, /<JournalPhotoTrigger index=\{item\.mediaIndex\} label="View photo"/);
});

test("filter chips: accessible buttons with aria-pressed, All first, in a labelled group", () => {
  const c = code(MOMENT);
  assert.match(c, /role="group" aria-label="Filter photos"/);
  assert.match(c, /<FilterChip label="All" selected=\{active === null\} onClick=\{\(\) => choose\(null\)\} \/>\s*\{categories\.map/);
  assert.match(c, /<button\s+type="button"\s+aria-pressed=\{selected\}/);
  assert.match(c, /focus-visible:outline/);
  assert.match(c, /overflow-x-auto/, "horizontally scrollable on mobile");
  assert.match(c, /selected \? "border-findmi\/40 bg-findmi-50 text-findmi-700"/, "quiet Aqua-tint selected state");
});

test("sticky strip: inside the gallery section, under the mobile/admin/desktop headers", () => {
  const c = code(MOMENT);
  const strip = c.slice(c.indexOf("ref={stripRef}"), c.indexOf('role="group"'));
  assert.match(strip, /sticky z-20/, "below the z-40/z-50 headers");
  assert.match(strip, /adminToolbar \? "top-\[calc\(3\.5rem\+1\.75rem\)\]" : "top-14"/, "mobile header h-14, shifted by the 1.75rem admin toolbar");
  assert.match(strip, /md:top-\[93px\]/, "desktop sticky NavDesktop height as measured signed-out (first-paint fallback)");
  assert.match(strip, /style=\{stickyTop !== null \? \{ top: stickyTop \} : undefined\}/, "then the live header is measured");
  assert.match(c, /cs\.position !== "fixed" && cs\.position !== "sticky"/);
  assert.match(c, /\(parseFloat\(cs\.top\) \|\| 0\) \+ h\.getBoundingClientRect\(\)\.height/, "includes the admin-toolbar shift of the fixed mobile header");
  assert.match(c, /new ResizeObserver\(measure\)/);
  assert.ok(c.indexOf("<section ref={rootRef}") < c.indexOf("ref={stripRef}"), "sticky within the gallery, so it unsticks at its end");
});

test("notes: only for the active category, quiet body text — never a heading", () => {
  const c = code(MOMENT);
  assert.match(c, /\{active\?\.notes && <p className="mb-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink\/70">\{active\.notes\}<\/p>\}/);
  assert.doesNotMatch(c, /<h[1-6]/);
  assert.equal(G.momentGalleryCategories(SECTIONS, PHOTOS).find((x) => x.id === "s-place").notes, "Rooftop at golden hour.");
});

// ── Badges + tiles ───────────────────────────────────────────────────────
test("badges: bottom-right, subtle neutral metadata, aria-hidden, only when categorized", () => {
  const c = code(MOMENT);
  assert.match(c, /badge: p\.sectionId && momentBadgeVisible\(active\?\.id \?\? null\) \? \(badgeBySection\.get\(p\.sectionId\) \?\? null\) : null,/);
  assert.match(c, /new Map\(sections\.map\(\(s\) => \[s\.id, momentCategoryLabel\(s\)\]\)\)/, "same label rule as chips (untitled other → none)");
  const g = code(GALLERY);
  const badge = g.slice(g.indexOf("const badge = item.badge"), g.indexOf("const tile ="));
  assert.match(badge, /aria-hidden="true"/);
  assert.match(badge, /absolute bottom-2 right-2/);
  assert.match(badge, /bg-black\/55/);
  assert.match(badge, /text-white\/90/);
  assert.match(badge, /rounded-md/);
  assert.doesNotMatch(badge, /findmi|<svg|Icon|uppercase/, "metadata, not a CTA");
  assert.equal((g.match(/\{badge\}/g) ?? []).length, 2, "on both interactive and plain tiles");
});

test("tiles: Babylist editorial geometry, captions and image variants preserved; no grouping", () => {
  const g = code(GALLERY);
  assert.match(g, /aspect-\[16\/10\] w-full/);
  assert.match(g, /className="aspect-square"/);
  assert.match(g, /aspect-\[4\/3\] w-full/);
  assert.match(g, /<figcaption className="mt-1\.5 whitespace-pre-line text-sm leading-snug text-ink\/70">\{item\.caption\}<\/figcaption>/);
  assert.match(g, /const src = \(large \? item\.largeUrl : null\) \?\? item\.url;/);
  assert.doesNotMatch(g, /groupByCategory|item\.category/);
});

test("no Pass B: no image-dimension / onLoad layout logic, no random aspect ratios", () => {
  for (const src of [code(MOMENT), code(GALLERY), code(PAGE)]) {
    assert.doesNotMatch(src, /onLoad|naturalWidth|naturalHeight|Math\.random|masonry|columns-\d/);
  }
});

test("scope: no migration, editor and journal actions untouched by this pass", () => {
  assert.equal(readdirSync("supabase/migrations").filter((f) => /gallery|moment_filter|section_badge/.test(f)).length, 0);
  for (const f of ["src/components/journal/MomentPhotosStage.tsx", "src/app/(public)/my-world/journal/actions.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /moment-gallery|JournalMomentGallery/, f);
  }
});
