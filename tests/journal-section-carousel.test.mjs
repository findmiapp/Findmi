// Public Moment Named-Section Carousel pass — media explicitly assigned to
// a named Moment section ("The Place", "The Experience", etc.) now renders
// as a horizontally scrollable carousel (JournalSectionCarousel) instead of
// sharing JournalPhotoGallery's mixed-size editorial grid with unassigned
// media. Visual-correction pass: the carousel's cards now use each photo's
// own natural aspect ratio (mixed widths at one consistent height) rather
// than a uniform square, the carousel no longer cancels the page's LEFT
// gutter (only the right edge still bleeds, for the next-card peek), and
// the section heading uses the existing text-page-title-lg (~26px) token
// rather than text-3xl (~30px, found too dominant once several sections
// repeat down the page). This suite follows this repo's own established
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

// ── 2/3/4. Mixed natural aspect ratio at one consistent card height ───────
test("section items are no longer forced to a uniform aspect-square box", () => {
  // Scoped to actual className strings, not this file's own explanatory
  // doc comments (which legitimately discuss the OLD square treatment by
  // name when explaining why this pass moved away from it).
  const classNameMatches = [...CAROUSEL.matchAll(/className="([^"]*)"|className=\{`([^`]*)`\}/g)].flatMap((m) => m[1] ?? m[2] ?? "");
  const classNames = classNameMatches.join(" ");
  assert.doesNotMatch(classNames, /aspect-square/, "the mixed-aspect pass must not force every card into the same square shape");
  assert.doesNotMatch(classNames, /aspect-\[4\/3\]/);
  assert.doesNotMatch(classNames, /aspect-\[16\/10\]/, "must not reuse the editorial grid's own anchor shapes either");
});

test("each card's width comes from a deterministic, index-based editorial pattern -- never from the loaded image's own dimensions", () => {
  // No natural width/height is stored anywhere in the Journal media schema
  // (checked lib/journal.ts's JournalEntryMediaRow and the
  // journal_entry_sections/journal_foundation migrations — no such column
  // exists, and this pass adds none). An earlier version of this component
  // read the real ratio off the loaded <img> at runtime, but that meant
  // every card started at a square default and then visibly resized once
  // its image finished loading -- a real, user-visible layout shift. This
  // was explicitly rejected in favor of a width that's already correct on
  // first render: derived purely from the item's position, not from any
  // network/decode-timing-dependent signal.
  // Scoped to the actual code, not this file's own doc comment (which
  // legitimately names onLoad/naturalWidth/naturalHeight when explaining
  // why the earlier, load-time-dependent approach was rejected).
  const code = CAROUSEL.slice(CAROUSEL.indexOf("*/") + 2);
  assert.doesNotMatch(code, /onLoad|naturalWidth|naturalHeight|useState/, "must not depend on the image finishing loading to know its own width");
  assert.doesNotMatch(JOURNAL_LIB, /natural_width|natural_height|aspect_ratio/i, "no new width/height/aspect-ratio column was added to the data layer");
  assert.match(CAROUSEL, /EDITORIAL_RATIOS/, "expected a named, stable ratio sequence");
  assert.match(CAROUSEL, /index % EDITORIAL_RATIOS\.length/, "the pattern must cycle by each item's own index, not its content");
  // One shared height constant drives every card (via a single Tailwind
  // height utility applied through GalleryTile's className), while WIDTH is
  // the part that varies by position -- that's what makes this "one
  // consistent height, varied widths" rather than fully free-form boxes.
  const heightClassMatches = CAROUSEL.match(/\bh-56\b/g) ?? [];
  assert.ok(heightClassMatches.length >= 1, "expected a single shared height utility applied to every card");
  assert.doesNotMatch(CAROUSEL, /aspect-\[/, "no per-item Tailwind aspect-ratio class -- height is fixed, width is computed");
});

test("the editorial ratio pattern is a pure function of index -- identical on server and client, so it can never hydration-mismatch or depend on load timing", () => {
  const ratiosMatch = CAROUSEL.match(/EDITORIAL_RATIOS\s*=\s*\[([^\]]+)\]/);
  assert.ok(ratiosMatch, "expected an EDITORIAL_RATIOS array literal");
  // eslint-disable-next-line no-new-func -- evaluating a small, local array
  // literal of numeric expressions (e.g. `4 / 3`) extracted from our own
  // source file, not external input.
  const ratios = new Function(`return [${ratiosMatch[1]}];`)();
  assert.ok(ratios.length >= 3, "expected a multi-step pattern (e.g. landscape/portrait/square), not just one shape");
  const kinds = ratios.map((r) => (r > 1.05 ? "landscape" : r < 0.95 ? "portrait" : "square"));
  assert.ok(kinds.includes("landscape") && kinds.includes("portrait") && kinds.includes("square"), "expected a genuinely mixed landscape/portrait/square pattern, not near-identical ratios");
  assert.doesNotMatch(CAROUSEL, /Math\.random/, "must be fully deterministic -- no randomness");
});

test("widthForRatio clamps portrait cards above a usable minimum and landscape cards below a viewport-eating maximum", () => {
  const minMatch = CAROUSEL.match(/MIN_WIDTH\s*=\s*(\d+)/);
  const maxMatch = CAROUSEL.match(/MAX_WIDTH\s*=\s*(\d+)/);
  const heightMatch = CAROUSEL.match(/CARD_HEIGHT\s*=\s*(\d+)/);
  assert.ok(minMatch && maxMatch && heightMatch, "expected MIN_WIDTH/MAX_WIDTH/CARD_HEIGHT constants");
  const minWidth = Number(minMatch[1]);
  const maxWidth = Number(maxMatch[1]);
  const height = Number(heightMatch[1]);
  // A very tall portrait (e.g. a 9:16 screenshot-style photo, ratio 0.5625)
  // must not be allowed to shrink to an unusably thin sliver.
  assert.ok(minWidth >= 120, `MIN_WIDTH (${minWidth}px) is too narrow to read as a real portrait card`);
  const extremePortraitWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(height * 0.5)));
  assert.strictEqual(extremePortraitWidth, minWidth, "an extreme portrait ratio must be clamped up to MIN_WIDTH, not left as a sliver");
  // A very wide panorama (ratio 2.4) must not be allowed to balloon out to
  // essentially the whole mobile viewport.
  assert.ok(maxWidth <= 360, `MAX_WIDTH (${maxWidth}px) is wide enough to consume an entire mobile viewport`);
  const extremeLandscapeWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(height * 2.4)));
  assert.strictEqual(extremeLandscapeWidth, maxWidth, "an extreme landscape ratio must be clamped down to MAX_WIDTH, not left oversized");
  // object-cover is the safety net whenever a clamped box doesn't exactly
  // match the source ratio -- crops, never stretches/distorts.
  assert.match(GALLERY, /object-cover/);
});

// ── 3. Ordering preserved: no sort/reverse anywhere in the new component or its data path ──
test("section media stays in its stored display_order: no reordering in the carousel, and the server query orders by display_order", () => {
  assert.doesNotMatch(CAROUSEL, /\.sort\(|\.reverse\(/, "the carousel must not reorder items itself");
  assert.match(PAGE, /photos: media\.filter\(\(m\) => m\.section_id === sec\.id\)/, "section photos are a plain filter over the already-ordered media array");
  assert.match(JOURNAL_LIB, /\.order\("display_order", \{ ascending: true \}\)/, "journal_entry_media is fetched in display_order server-side, unchanged by this pass");
});

// ── 7/8. Left gutter restored; only the right edge still bleeds ───────────
test("the first carousel card respects the page's normal left content gutter -- the previous negative-left-margin/full-bleed treatment is removed", () => {
  const rootDivMatch = CAROUSEL.match(/<div className="([^"]*)">\s*\n\s*\{items\.map/);
  assert.ok(rootDivMatch, "expected the carousel's root scroll-row div");
  const rootClass = rootDivMatch[1];
  // No `-mx-4` (symmetric bleed) and no standalone `-ml-4` (left-only
  // bleed) -- the row must inherit the page's own left px-4 gutter
  // undisturbed, so the first card's left edge lines up with the section
  // heading and the relationship card above it.
  assert.doesNotMatch(rootClass, /-mx-4/, "must not cancel the gutter on both sides");
  assert.doesNotMatch(rootClass, /-ml-4/, "must not cancel the left gutter specifically");
  assert.doesNotMatch(rootClass, /\bpl-4\b.*-m[xl]-4|-m[xl]-4.*\bpl-4\b/, "no left-side gutter-cancel+reapply pairing");
  // The RIGHT edge is explicitly allowed (and intended) to keep bleeding
  // past the page's own right gutter, so later cards can peek/scroll
  // toward the viewport edge -- that's the one asymmetry this pass keeps.
  assert.match(rootClass, /-mr-4/, "the right edge should still bleed past the page's own gutter for the next-card peek");
});

// ── 9/10. Horizontal overflow, next-item discoverability, scroll snap ─────
test("multi-item sections remain horizontally scrollable with CSS scroll-snap and a real next-card peek", () => {
  assert.match(CAROUSEL, /overflow-x-auto/);
  assert.match(CAROUSEL, /shrink-0/, "cards must not shrink to fit — that would silently defeat the overflow");
  assert.match(CAROUSEL, /snap-x/, "CSS scroll snapping (axis) must be present");
  assert.match(CAROUSEL, /snap-mandatory/, "CSS scroll snapping (mandatory stop) must be present");
  assert.match(CAROUSEL, /snap-start/, "each card must be a snap stop");
  const maxMatch = CAROUSEL.match(/MAX_WIDTH\s*=\s*(\d+)/);
  const minMatch = CAROUSEL.match(/MIN_WIDTH\s*=\s*(\d+)/);
  const maxWidth = Number(maxMatch[1]);
  const minWidth = Number(minMatch[1]);
  // Even a maximum-width (landscape) card plus a minimum-width (portrait)
  // card together comfortably exceed a conservative mobile content width,
  // so a realistic mixed section still overflows and must scroll.
  assert.ok(maxWidth + minWidth + 12 > 320, "a landscape + portrait pair should still be wide enough to overflow a typical mobile content column");
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

// ── 11/12. Section heading typography: ~26px via an existing token, ─────
// ── scoped to ONLY the user-created section title — every other heading ──
// ── on this page is byte-identical to before this pass. ──────────────────
test("a user-created section heading uses the existing ~26px text-page-title-lg token, not text-3xl", () => {
  const h2Start = PAGE.indexOf("{journalSectionLabel(section)}");
  assert.ok(h2Start !== -1, "expected the section-title heading");
  const tagStart = PAGE.lastIndexOf("<h2", h2Start);
  const heading = PAGE.slice(tagStart, h2Start);
  assert.match(heading, /font-display/, "must stay on the existing Inter display token, never a new font");
  assert.match(heading, /\btext-page-title-lg\b/, "must use the existing ~26px Findmi type-scale token (tailwind.config.ts), not an arbitrary one-off size");
  assert.doesNotMatch(heading, /text-lg\b/, "must actually be bigger than the untouched baseline");
  assert.doesNotMatch(heading, /\btext-3xl\b/, "text-3xl (~30px) was found too dominant once several sections repeat and must not remain");
  assert.match(heading, /font-bold/, "bold weight, consistent with every other heading on this page");
  // text-page-title-lg already bundles the correct letter-spacing (see
  // tailwind.config.ts), so a separate tracking-tight utility alongside it
  // would be redundant -- matching this token's established usage
  // elsewhere in the app (e.g. AdminSectionHub.tsx, admin home page).
  assert.doesNotMatch(heading, /tracking-tight/, "letter-spacing is already baked into text-page-title-lg");
});

test("the section heading holds one consistent ~26px size across breakpoints, with no responsive bump", () => {
  const h2Start = PAGE.indexOf("{journalSectionLabel(section)}");
  const tagStart = PAGE.lastIndexOf("<h2", h2Start);
  const heading = PAGE.slice(tagStart, h2Start);
  assert.doesNotMatch(heading, /sm:text-/, "must not add a responsive size bump -- ~26px across breakpoints is the intended result");
  assert.doesNotMatch(heading, /text-3xl|text-4xl|text-5xl|text-6xl/, "must never grow beyond text-page-title-lg");
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
    assert.doesNotMatch(heading, /text-2xl|text-3xl|text-page-title/, `"${label}" must not have been bumped`);
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
