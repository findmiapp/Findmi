// Public Moment Named-Section Carousel pass — media explicitly assigned to
// a named Moment section ("The Place", "The Experience", etc.) now renders
// as a horizontally scrollable, square-card carousel (JournalSectionCarousel)
// instead of sharing JournalPhotoGallery's mixed-size editorial grid with
// unassigned media. This suite follows this repo's own established
// convention for client-component layout logic (see moment-collage.test.mjs,
// image-variants.test.mjs's "static guards", opportunity-admin.test.mjs): no
// JSX rendering harness exists in this plain node:test suite, so behavior is
// proven via source-level static guards plus pure arithmetic on the actual
// sizing constants extracted from source — not component mounting. No
// network, no database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CAROUSEL = readFileSync("src/components/journal/JournalSectionCarousel.tsx", "utf8");
const GALLERY = readFileSync("src/components/journal/JournalPhotoGallery.tsx", "utf8");
const PAGE = readFileSync("src/app/(public)/journal/[id]/page.tsx", "utf8");
const JOURNAL_LIB = readFileSync("src/lib/journal.ts", "utf8");

// ── 1. Named section (multi-item) uses the new carousel, not the gallery ──
test("a named section's photos render via JournalSectionCarousel, not JournalPhotoGallery", () => {
  assert.match(PAGE, /import JournalSectionCarousel from "@\/components\/journal\/JournalSectionCarousel";/);
  const sectionsBlockStart = PAGE.indexOf("photoSections.map(({ section, photos })");
  const sectionsBlockEnd = PAGE.indexOf("unsectioned.length > 0", sectionsBlockStart);
  assert.ok(sectionsBlockStart !== -1 && sectionsBlockEnd !== -1, "could not locate the named-sections render block");
  const sectionsBlock = PAGE.slice(sectionsBlockStart, sectionsBlockEnd);
  assert.match(sectionsBlock, /<JournalSectionCarousel items=\{toGalleryItems\(photos\)\}/);
  assert.doesNotMatch(sectionsBlock, /<JournalPhotoGallery/, "named sections must not use the editorial gallery");
});

// ── 2. Square aspect ratio, never the gallery's mixed anchor/grid shapes ──
test("section media uses a consistent square (1:1) aspect ratio, never the editorial grid's mixed shapes", () => {
  assert.match(CAROUSEL, /aspect-square/);
  assert.doesNotMatch(CAROUSEL, /aspect-\[4\/3\]/);
  assert.doesNotMatch(CAROUSEL, /aspect-\[16\/10\]/);
});

// ── 3. Ordering preserved: no sort/reverse anywhere in the new component or its data path ──
test("section media stays in its stored display_order: no reordering in the carousel, and the server query orders by display_order", () => {
  assert.doesNotMatch(CAROUSEL, /\.sort\(|\.reverse\(/, "the carousel must not reorder items itself");
  assert.match(PAGE, /photos: media\.filter\(\(m\) => m\.section_id === sec\.id\)/, "section photos are a plain filter over the already-ordered media array");
  assert.match(JOURNAL_LIB, /\.order\("display_order", \{ ascending: true \}\)/, "journal_entry_media is fetched in display_order server-side, unchanged by this pass");
});

// ── 4. Mobile card width bounded (~70%), never full-width ─────────────────
test("section cards are bounded around 70% of mobile content width, not full-width", () => {
  const widthMatch = CAROUSEL.match(/w-\[(\d+)%\]/);
  assert.ok(widthMatch, "expected an explicit mobile card width percentage");
  const pct = Number(widthMatch[1]);
  assert.ok(pct >= 68 && pct <= 72, `card width ${pct}% is outside the 68-72% target range`);
  // The OUTER scroll-item wrapper (the one carrying the 70% width and
  // shrink-0) must never ALSO be full-width — the inner GalleryTile's own
  // "w-full" is fine (it fills that 70% parent, not the viewport).
  const wrapperMatch = CAROUSEL.match(/<div key=\{item\.id\} className="([^"]*)">/);
  assert.ok(wrapperMatch, "expected a per-item wrapper div");
  assert.doesNotMatch(wrapperMatch[1], /\bw-full\b/, "the scroll-item wrapper itself must never be full-width");
});

// ── 5. Multi-item section exposes next-card/overflow behavior ─────────────
test("2+ section items necessarily overflow the viewport, proving the next-card peek is real, not cosmetic", () => {
  const widthMatch = CAROUSEL.match(/w-\[(\d+)%\]/);
  const cardPercent = Number(widthMatch[1]);
  // Two cards at ~70% each, plus any inter-card gap, exceeds 100% of the
  // scroll container's own width — so with >=2 items the content is wider
  // than the viewport and must scroll. (Gap is >=0, so this holds even in
  // the limiting case.)
  assert.ok(cardPercent * 2 > 100, "two cards at the configured width must overflow a single viewport");
  assert.match(CAROUSEL, /overflow-x-auto/);
  assert.match(CAROUSEL, /shrink-0/, "cards must not shrink to fit — that would silently defeat the overflow");
  assert.match(CAROUSEL, /snap-x/, "CSS scroll snapping must be present");
});

// ── 6. Single-image section: same bounded square card, nothing faked ──────
test("a single-image section gets the exact same component with no item-count special-casing or faked items", () => {
  // Unlike JournalPhotoGallery's EditorialGrid (which explicitly branches
  // on items.length === 1 / === 2), the carousel must treat every count
  // uniformly — proving a lone item never gets stretched to full width or
  // padded with fake placeholder cards. (No-pagination-UI is covered by
  // its own static guard further below, scoped to actual markup rather
  // than this file's own explanatory prose.)
  assert.doesNotMatch(CAROUSEL, /items\.length === 1/);
  assert.doesNotMatch(CAROUSEL, /items\.length === 2/);
  assert.doesNotMatch(CAROUSEL, /Array\.from\(\{\s*length:/, "must never synthesize extra items");
});

// ── 7. Unassigned media keeps the existing editorial gallery, byte-for-byte ──
test("unassigned media (both the 'More Photos' section and the no-sections flat gallery) still renders via JournalPhotoGallery", () => {
  assert.match(PAGE, /id="more-photos"[\s\S]{0,300}<JournalPhotoGallery items=\{toGalleryItems\(unsectioned\)\}/);
  assert.match(PAGE, /id="moment-photos"[\s\S]{0,200}<JournalPhotoGallery items=\{toGalleryItems\(unsectioned\)\}/);
});

test("JournalPhotoGallery's own editorial grid logic (1/2/3+ item shapes) is untouched", () => {
  assert.match(GALLERY, /function EditorialGrid/);
  assert.match(GALLERY, /if \(items\.length === 1\)/);
  assert.match(GALLERY, /if \(items\.length === 2\)/);
  assert.match(GALLERY, /aspect-\[4\/3\]/);
  assert.match(GALLERY, /aspect-\[16\/10\]/);
});

// ── 8. No changes to section assignment semantics ─────────────────────────
test("section assignment/ordering semantics (section_id filtering, sections data layer) are unchanged", () => {
  assert.match(PAGE, /const sectionIds = new Set\(sections\.map\(\(sec\) => sec\.id\)\);/);
  assert.match(PAGE, /const photoSections = sections\s*\n\s*\.map\(\(sec\) => \(\{ section: sec, photos: media\.filter\(\(m\) => m\.section_id === sec\.id\) \}\)\)/);
  // journal-sections.ts (section CRUD/labeling) is not imported by the new
  // component at all -- the carousel only ever receives already-resolved
  // JournalGalleryItem[] from page.tsx, same as JournalPhotoGallery does.
  assert.doesNotMatch(CAROUSEL, /journal-sections/);
});

// ── 9. Existing click/tap + lightbox behavior is reused verbatim ──────────
test("the carousel opens the same shared Global Media Viewer via the same GalleryTile/JournalPhotoTrigger, not a reimplementation", () => {
  assert.match(CAROUSEL, /import \{ GalleryTile, type JournalGalleryItem \} from "\.\/JournalPhotoGallery";/);
  assert.match(CAROUSEL, /<GalleryTile item=\{item\}/);
  assert.match(GALLERY, /export function GalleryTile/);
  assert.match(GALLERY, /JournalPhotoTrigger/, "GalleryTile itself still opens the shared viewer");
});

// ── 10. Moment hero rendering is unaffected ───────────────────────────────
test("the Moment hero block is unchanged by this pass", () => {
  assert.match(PAGE, /className="relative aspect-\[4\/3\] w-full overflow-hidden bg-ink sm:rounded-b-3xl"/);
  assert.match(PAGE, /label=\{`View photo\$\{media\.length === 1 \? "" : "s"\}`\}/);
  assert.match(PAGE, /linear-gradient\(to top, rgba\(0,0,0,0\.88\) 0%, rgba\(0,0,0,0\.6\) 35%, rgba\(0,0,0,0\) 85%\)/);
});

// ── Scope guards: unrelated areas untouched ───────────────────────────────
test("static guard: media-calibration gate and the appearance-count fix from a06ecc2 are untouched", () => {
  const calibration = readFileSync("src/lib/admin/media-calibration.ts", "utf8");
  assert.match(calibration, /MEDIA_CALIBRATION_ENABLED/);
  const data = readFileSync("src/lib/data.ts", "utf8");
  assert.match(data, /export async function getUpcomingAppearanceCounts/);
  assert.match(data, /export (?:async )?function resolveUpcomingAppearanceCounts/);
});

test("static guard: no pagination dots or extra carousel controls were introduced anywhere in this pass's new file", () => {
  assert.doesNotMatch(CAROUSEL, /role="tablist"|aria-label="(Next|Previous)"|<button/i);
});

// ── 11/12. Section heading typography: stronger, but scoped to ONLY the ──
// ── user-created section title — every other heading on this page is ────
// ── byte-identical to before this pass. ──────────────────────────────────
test("a user-created section heading gets stronger typography (text-3xl, up from text-lg) via an existing type-scale token", () => {
  const h2Start = PAGE.indexOf("{journalSectionLabel(section)}");
  assert.ok(h2Start !== -1, "expected the section-title heading");
  const tagStart = PAGE.lastIndexOf("<h2", h2Start);
  const heading = PAGE.slice(tagStart, h2Start);
  assert.match(heading, /font-display/, "must stay on the existing Inter display token, never a new font");
  assert.match(heading, /\btext-3xl\b/, "must use an existing Tailwind type-scale step, not an arbitrary one-off size");
  assert.doesNotMatch(heading, /text-lg/, "must actually be bigger than the untouched baseline");
  assert.match(heading, /font-bold/, "bold weight, consistent with every other heading on this page");
  assert.match(heading, /tracking-tight/, "keeps the existing Findmi font-display tracking correction — never reverted");
});

test("the section heading holds one consistent size across breakpoints, never reaching beyond text-3xl", () => {
  const h2Start = PAGE.indexOf("{journalSectionLabel(section)}");
  const tagStart = PAGE.lastIndexOf("<h2", h2Start);
  const heading = PAGE.slice(tagStart, h2Start);
  // Per explicit product direction, the section heading is held at one
  // visually-prominent size (text-3xl, ~30px) across every breakpoint --
  // no sm: bump for an additional desktop increase, and never any larger
  // step (text-4xl+). Matching or exceeding the hero's own SIZE at a given
  // breakpoint is explicitly acceptable here: the hero's image, placement,
  // overlay, and composition already establish it as the primary title.
  assert.doesNotMatch(heading, /sm:text-/, "must not add a responsive size bump -- ~30px across breakpoints is the intended result");
  assert.doesNotMatch(heading, /text-4xl|text-5xl|text-6xl/, "must never grow beyond the text-3xl step");
});

test("the stronger heading treatment is scoped ONLY to user-created section titles -- every other heading on this page is unchanged", () => {
  // "More Photos" (unassigned-media fallback, not user-created), "Visit
  // Details", and "More Findmi Moments" must all still be the original
  // text-lg -- proving this pass didn't bump heading size globally.
  for (const label of ["More Photos", "Visit Details", "More Findmi Moments"]) {
    const labelIndex = PAGE.indexOf(`>${label}</h2>`);
    assert.ok(labelIndex !== -1, `expected to find the "${label}" heading`);
    const tagStart = PAGE.lastIndexOf("<h2", labelIndex);
    const heading = PAGE.slice(tagStart, labelIndex);
    assert.match(heading, /text-lg/, `"${label}" must keep its original text-lg -- this pass only touches user-created section titles`);
    assert.doesNotMatch(heading, /text-2xl|text-3xl/, `"${label}" must not have been bumped`);
  }
  // The Moment hero, the "This Moment Is From" label, and relationship-card
  // typography are untouched (none of these are <h2>'s at all, so they
  // can't have been caught by any accidental broad find/replace).
  assert.match(PAGE, /This Moment Is From/);
  assert.match(PAGE, /text-xs font-bold uppercase tracking-wide text-findmi-700">This Moment Is From/);
});

// ── 13. Long section titles wrap naturally -- never clamped/truncated ────
test("the section heading has no truncation/line-clamp/fixed-width constraint -- long titles wrap naturally", () => {
  const h2Start = PAGE.indexOf("{journalSectionLabel(section)}");
  const tagStart = PAGE.lastIndexOf("<h2", h2Start);
  const heading = PAGE.slice(tagStart, h2Start);
  assert.doesNotMatch(heading, /truncate/, "must not truncate long titles");
  assert.doesNotMatch(heading, /line-clamp/, "must not clamp long titles to a fixed number of lines");
  assert.doesNotMatch(heading, /\bw-1\/3\b|\bw-1\/2\b|w-\[3[0-9]%\]|w-\[4[0-9]%\]|w-\[50%\]/, "must not force the heading's own container to a fixed 1/3-1/2 width -- the 1/3-1/2 ask is about visual prominence (font size), not a literal width constraint");
});

// ── 14. The carousel never introduces a shared/global media cap, and ─────
// ── never changes which/how-many media records belong to a section. ─────
test("the carousel applies no limit/slice to the items it's given -- the section keeps exactly the media its author assigned, in full", () => {
  assert.doesNotMatch(CAROUSEL, /\.slice\(/, "the carousel must render every item it receives, never truncate to a preview cap");
  assert.doesNotMatch(CAROUSEL, /\.limit\(|\bLIMIT\b/i, "no query/limit concept belongs in a pure presentational component");
  // page.tsx must hand the carousel the business's FULL, unfiltered set of
  // that section's photos -- the same `photos` array used to decide
  // whether to render the carousel at all, never a sliced subset.
  assert.match(PAGE, /<JournalSectionCarousel items=\{toGalleryItems\(photos\)\}/, "receives the section's full photos array, not a truncated one");
  assert.doesNotMatch(PAGE, /toGalleryItems\(photos\)\.slice\(/, "page.tsx must not pre-slice a section's photos before handing them to the carousel");
});
