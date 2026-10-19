// Moment UX polish — section previews in the editor, the cover kept in
// the public story, one Add Your Moment CTA, and section badges only in
// All. Pure rules exercised directly; page/component composition pinned
// with source-level guards (this repo's convention). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const O = await import("../src/lib/moment-media-order.ts");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const PAGE = code(readFileSync("src/app/(public)/journal/[id]/page.tsx", "utf8"));
const MOMENT = code(readFileSync("src/components/journal/JournalMomentGallery.tsx", "utf8"));
const STAGE = code(readFileSync("src/components/journal/MomentPhotosStage.tsx", "utf8"));
const HOOK = code(readFileSync("src/components/journal/useJournalPhotoUpload.ts", "utf8"));

const ids = (list) => list.map((p) => p.id ?? p.localId);
const ph = (id, sectionId = null, isCover = false) => ({ id, sectionId, isCover });
// A B C D E F, F is the cover; F and B are in "place".
const STORY = [ph("A"), ph("B", "place"), ph("C", "food"), ph("D"), ph("E", "food"), ph("F", "place", true)];

test("1. the cover remains in the All gallery", () => {
  assert.deepEqual(ids(G.momentGalleryPhotos(STORY, null)), ["A", "B", "C", "D", "E", "F"]);
  assert.equal(G.momentGalleryPhotos(STORY, null).length, STORY.length, "photo count and gallery agree");
});

test("2. the cover keeps its display_order position", () => {
  const all = ids(G.momentGalleryPhotos(STORY, null));
  assert.equal(all.indexOf("F"), 5);
  const middleCover = [ph("A"), ph("B", null, true), ph("C")];
  assert.deepEqual(ids(G.momentGalleryPhotos(middleCover, null)), ["A", "B", "C"]);
});

test("3. the cover appears in its Section filter", () => {
  assert.deepEqual(ids(G.momentGalleryPhotos(STORY, "place")), ["B", "F"]);
});

test("4. selecting/changing the cover never alters display_order", () => {
  const order = ["A", "B", "C"];
  const rows = order.map((id, i) => ({ id, display_order: i, section_id: null }));
  // A layout save after a cover change re-sends the same order: nothing to write.
  assert.deepEqual(O.planMediaLayout(rows, { mediaOrder: order }), []);
  const makeCover = HOOK.slice(HOOK.indexOf("const makeCover"), HOOK.indexOf("const makeCover") + 1500);
  assert.doesNotMatch(makeCover, /reorder\(|arrayMove|display_order|sectionId/);
  assert.match(PAGE, /isCover: m\.id === cover\?\.id,/, "the page flags the cover; it never removes it");
});

const items = [
  { localId: "A", sectionId: "place" },
  { localId: "B", sectionId: null },
  { localId: "C", sectionId: "food" },
  { localId: "D", sectionId: "place" },
  { localId: "E", sectionId: "food" },
];

test("5-6. a Section preview holds only its photos, in global relative order", () => {
  assert.deepEqual(ids(O.filterBySection(items, "place")), ["A", "D"]);
  assert.deepEqual(ids(O.filterBySection(items, "food")), ["C", "E"]);
  assert.match(STAGE, /photos=\{filterBySection\(items, section\.id\)\}/, "the preview is a filtered view of the one global order");
  const block = STAGE.slice(STAGE.indexOf("function SectionBlock"));
  assert.match(block, /\{photos\.map\(\(p\) => \(\s*<li key=\{p\.localId\} className="relative h-12 w-12 overflow-hidden rounded-lg/);
  assert.doesNotMatch(block, /JournalPhotoStrip|onDragReorder|sort\(/, "compact thumbnails only — no second grid, no reordering");
});

test("7. moving a photo between Sections changes only membership, not order", () => {
  const moved = O.assignSectionInPlace(items, ["A"], "food");
  assert.deepEqual(ids(moved), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(ids(O.filterBySection(moved, "place")), ["D"], "gone from the old preview");
  assert.deepEqual(ids(O.filterBySection(moved, "food")), ["A", "C", "E"], "in the new preview, in global order");
});

test("8. clearing a Section removes the photo from that preview without changing order", () => {
  const cleared = O.assignSectionInPlace(items, ["D"], null);
  assert.deepEqual(ids(cleared), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(ids(O.filterBySection(cleared, "place")), ["A"]);
});

test("9. the final Moment renders TWO Add Your Moment CTAs: one right after This Moment Is From, one after the story", () => {
  assert.equal((PAGE.match(/<AddYourMomentPill /g) ?? []).length, 2);
  assert.match(PAGE, /\{!hasGallery && \(\s*<div className="mt-5 flex">\s*<AddYourMomentPill href=\{addMomentHref\} \/>/, "bottom fallback only when there is no gallery");
  assert.match(MOMENT, /\{addMomentHref && \(\s*<Link/, "otherwise the gallery's own end-of-story CTA");
  const source = PAGE.slice(PAGE.indexOf("{primaryKind && ("), PAGE.indexOf("<AddYourMomentPill href={addMomentHref} />"));
  assert.doesNotMatch(source, /AddYourMomentPill/, "nothing INSIDE the This Moment Is From block");
  assert.ok(PAGE.indexOf("{!hasGallery && (") < PAGE.indexOf("Visit Details"), "Visit Details stays after the story");
});

test("10-11. Section badges show in All and hide inside a specific Section", () => {
  assert.equal(G.momentBadgeVisible(null), true);
  assert.equal(G.momentBadgeVisible("place"), false);
  assert.match(MOMENT, /badge: p\.sectionId && momentBadgeVisible\(active\?\.id \?\? null\) \?/);
});
