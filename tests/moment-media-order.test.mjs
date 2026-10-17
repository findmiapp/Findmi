// Moments — persistent media order + section independence. A Moment has
// ONE creator-controlled photo order (journal_entry_media.display_order);
// a photo's section is independent metadata. Pure rules are exercised
// directly (src/lib/moment-media-order.ts, src/lib/moment-gallery.ts);
// the server action, hook, editor and readers are pinned with
// source-level guards, following this repo's convention. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const O = await import("../src/lib/moment-media-order.ts");
const G = await import("../src/lib/moment-gallery.ts");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const ACTIONS = code(readFileSync("src/app/(public)/my-world/journal/actions.ts", "utf8"));
const HOOK = code(readFileSync("src/components/journal/useJournalPhotoUpload.ts", "utf8"));
const STAGE = code(readFileSync("src/components/journal/MomentPhotosStage.tsx", "utf8"));
const STRIP = code(readFileSync("src/components/journal/JournalPhotoStrip.tsx", "utf8"));
const JOURNAL = code(readFileSync("src/lib/journal.ts", "utf8"));

// The spec's example: A→B→C→D→E, Place/Products/Experience/Products/Place.
const PLACE = "s-place", PRODUCTS = "s-products", EXPERIENCE = "s-experience";
const it = (localId, sectionId = null) => ({ localId, sectionId });
const ids = (list) => list.map((p) => p.localId);
const untagged = () => ["A", "B", "C", "D", "E"].map((id) => it(id));
const tag = (items) =>
  [["A", PLACE], ["B", PRODUCTS], ["C", EXPERIENCE], ["D", PRODUCTS], ["E", PLACE]].reduce((acc, [id, s]) => O.assignSectionInPlace(acc, [id], s), items);
const TAGGED = tag(untagged());

// Simulates the save → reload round-trip: client order → server plan →
// stored rows → read back ordered by display_order.
const row = (id, display_order, section_id = null) => ({ id, display_order, section_id });
function save(rows, clientItems) {
  const plan = O.planMediaLayout(rows, {
    mediaOrder: clientItems.map((c) => c.localId),
    assignments: new Map(clientItems.map((c) => [c.localId, c.sectionId ?? null])),
  });
  const byId = new Map(plan.map((p) => [p.id, p.patch]));
  return rows.map((r) => ({ ...r, ...(byId.get(r.id) ?? {}) })).sort((a, b) => a.display_order - b.display_order);
}
const STORED = ["A", "B", "C", "D", "E"].map((id, i) => row(id, i));

test("1. manual order persists after assigning Sections", () => {
  const manual = O.moveAdjacent(untagged(), "E", -1); // A B C E D
  const tagged = O.assignSectionInPlace(O.assignSectionInPlace(manual, ["E"], PLACE), ["B", "D"], PRODUCTS);
  assert.deepEqual(ids(tagged), ["A", "B", "C", "E", "D"]);
  assert.deepEqual(ids(TAGGED), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(TAGGED.map((p) => p.sectionId), [PLACE, PRODUCTS, EXPERIENCE, PRODUCTS, PLACE]);
});

test("2. changing a Section does not alter order", () => {
  const changed = O.assignSectionInPlace(TAGGED, ["B"], EXPERIENCE);
  assert.deepEqual(ids(changed), ["A", "B", "C", "D", "E"]);
  assert.equal(changed[1].sectionId, EXPERIENCE);
  // Server: a section-only change writes section_id and never display_order.
  const rows = TAGGED.map((p, i) => row(p.localId, i, p.sectionId));
  const plan = O.planMediaLayout(rows, { mediaOrder: ids(changed), assignments: new Map([["B", EXPERIENCE]]) });
  assert.deepEqual(plan, [{ id: "B", patch: { section_id: EXPERIENCE } }]);
});

test("3. removing a Section does not alter order", () => {
  const cleared = O.assignSectionInPlace(TAGGED, ["B", "D"], null);
  assert.deepEqual(ids(cleared), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(cleared.map((p) => p.sectionId), [PLACE, null, EXPERIENCE, null, PLACE]);
  // Deleting a section server-side never rewrites the photo order.
  const del = ACTIONS.slice(ACTIONS.indexOf("export async function deleteJournalSection"), ACTIONS.indexOf("export interface JournalManualLocationInput"));
  assert.doesNotMatch(del, /writeJournalMediaLayout|display_order/);
  // Nor does reordering sections: no photo order, so no renumbering.
  assert.deepEqual(O.planMediaLayout([row("A", 0, PLACE), row("B", 5, PRODUCTS)], {}), []);
  assert.match(ACTIONS, /reorderJournalSections[\s\S]*?writeJournalMediaLayout\(admin, entryId, \{ sectionOrder: orderedSectionIds \}\)/);
});

test("4. Products filter keeps relative order", () => {
  assert.deepEqual(ids(O.filterBySection(TAGGED, PRODUCTS)), ["B", "D"]);
});

test("5. Place filter keeps relative order", () => {
  assert.deepEqual(ids(O.filterBySection(TAGGED, PLACE)), ["A", "E"]);
});

test("6. returning to All restores the exact order", () => {
  O.filterBySection(TAGGED, PRODUCTS);
  O.filterBySection(TAGGED, PLACE);
  assert.equal(O.filterBySection(TAGGED, "all"), TAGGED);
  assert.deepEqual(ids(O.filterBySection(TAGGED, "all")), ["A", "B", "C", "D", "E"]);
});

test("7. save/reload preserves order (no section flattening)", () => {
  const reloaded = save(STORED, TAGGED);
  assert.deepEqual(reloaded.map((r) => r.id), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(reloaded.map((r) => r.section_id), [PLACE, PRODUCTS, EXPERIENCE, PRODUCTS, PLACE]);
  // A manual reorder round-trips exactly.
  const manual = O.moveAdjacent(TAGGED, "D", -1);
  assert.deepEqual(save(STORED, manual).map((r) => r.id), ["A", "B", "D", "C", "E"]);
  // The server writer has no section grouping left.
  assert.doesNotMatch(ACTIONS, /flattened|orderedSections\.flatMap/);
  assert.match(ACTIONS, /planMediaLayout\(media, \{ mediaOrder: opts\.mediaOrder, assignments \}\)/);
  assert.match(JOURNAL, /\.order\("display_order", \{ ascending: true \}\)/);
});

test("8. public rendering respects the stored order", () => {
  const photos = [
    { id: "A", sectionId: PLACE, isCover: true },
    { id: "B", sectionId: PRODUCTS, isCover: false },
    { id: "C", sectionId: EXPERIENCE, isCover: false },
    { id: "D", sectionId: PRODUCTS, isCover: false },
    { id: "E", sectionId: PLACE, isCover: false },
  ];
  assert.deepEqual(G.momentGalleryPhotos(photos, PRODUCTS).map((p) => p.id), ["B", "D"]);
  assert.deepEqual(G.momentGalleryPhotos(photos, PLACE).map((p) => p.id), ["A", "E"]);
  assert.deepEqual(G.momentGalleryPhotos(photos, null).map((p) => p.id), ["B", "C", "D", "E"], "All = stored order after the cover");
});

test("9. private/editor rendering respects the order: one global strip, no per-section strips", () => {
  assert.match(STAGE, /const visible = filterBySection\(items, activeFilter\);/);
  assert.match(STAGE, /items=\{visible\}/);
  assert.doesNotMatch(STAGE, /items\.filter\(\(it\) => groupOf\(it\.sectionId\) === section\.id\)/);
  assert.doesNotMatch(STAGE, /displayOrder|unsectioned/);
  assert.match(STAGE, /const coverLocalId = \(items\.find\(\(it\) => it\.isCover\) \?\? items\[0\]\)/);
  assert.match(HOOK, /function buildInitialItems[\s\S]*?initial\.map\(/, "initial photos keep their read order");
});

test("10. a filtered view cannot rewrite global order", () => {
  assert.equal(O.canReorder("all"), true);
  assert.equal(O.canReorder(PRODUCTS), false);
  assert.match(STAGE, /const reorderLocked = !canReorder\(activeFilter\);/);
  assert.match(STAGE, /reorderLocked=\{reorderLocked\}/);
  assert.match(STRIP, /if \(reorderLocked \|\| !over \|\| active\.id === over\.id\) return;/);
  assert.match(STRIP, /useSortable\(\{ id: item\.localId, disabled: reorderLocked \}\)/);
  assert.match(STRIP, /canMoveEarlier=\{!reorderLocked && index > 0\}/);
  assert.match(STRIP, /canMoveLater=\{!reorderLocked && index < items\.length - 1\}/);
  assert.match(STRIP, /\{!reorderLocked && \(\s*<button[\s\S]*?aria-label="Drag to reorder"/);
  // Move Earlier/Later step through the global order, never within a section.
  assert.doesNotMatch(HOOK, /moveWithinGroup/);
  assert.deepEqual(ids(O.moveAdjacent(TAGGED, "B", 1)), ["A", "C", "B", "D", "E"]);
});

test("11. upload then tag preserves order", () => {
  const uploaded = untagged(); // Add Photos → upload, in picked order
  assert.deepEqual(ids(tag(uploaded)), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(save(STORED, tag(uploaded)).map((r) => r.id), ["A", "B", "C", "D", "E"]);
  assert.match(HOOK, /reorder\(\(prev\) => assignSectionInPlace\(prev, localIds, sectionId\)\)/);
  assert.doesNotMatch(HOOK, /\.\.\.moving\]/, "assignSection no longer appends to the end");
});

test("12. tag then reorder preserves the final manual order", () => {
  let order = TAGGED;
  order = O.moveAdjacent(order, "E", -1); // A B C E D
  order = O.moveAdjacent(order, "E", -1); // A B E C D
  order = O.moveAdjacent(order, "A", 1); //  B A E C D
  assert.deepEqual(ids(order), ["B", "A", "E", "C", "D"]);
  const reloaded = save(STORED, order);
  assert.deepEqual(reloaded.map((r) => r.id), ["B", "A", "E", "C", "D"]);
  assert.deepEqual(reloaded.map((r) => r.section_id), [PRODUCTS, PLACE, PLACE, EXPERIENCE, PRODUCTS]);
  assert.deepEqual(ids(O.filterBySection(order, PLACE)), ["A", "E"]);
});

test("scope: no migration for this pass", () => {
  assert.equal(readdirSync("supabase/migrations").filter((f) => /media_order|moment_order|reorder/.test(f)).length, 0);
});
