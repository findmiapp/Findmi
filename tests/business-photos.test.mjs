// Business Manager Photos — the Business gallery as its own destination
// (?tab=gallery, label "Photos"), reachable from More, Home and Public
// Profile; owner reordering through SortableImageGrid (drag from the grip
// handle only, a Move menu, the keyboard); explicit Save with unsaved-change
// protection; and an insert-first gallery save that never reports success
// after a failed write. Pure nav helpers are called directly; component and
// action structure is proven with source-level guards (no JSX harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const NAV = await import("../src/app/(public)/account/business/[id]/v2/business-nav.ts");
const L = await import("../src/lib/manager-links.ts");

const read = (p) => readFileSync(p, "utf8");
const B = "src/app/(public)/account/business/[id]";
const PAGE = read(`${B}/(manager)/page.tsx`);
const MORE = read(`${B}/v2/MoreMenu.tsx`);
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const FIELD = read(`${B}/MemberGalleryField.tsx`);
const GRID = read("src/components/SortableImageGrid.tsx");
const ACTIONS = read("src/app/(public)/account/business/actions.ts");

const galleryAction = () => {
  const start = ACTIONS.indexOf("export async function updateBusinessGallery");
  return ACTIONS.slice(start, ACTIONS.indexOf("\n}\n", start));
};

// ── Destination ──────────────────────────────────────────────────────────

test("Photos is a real destination again: valid key, no redirect to Profile, label Photos", () => {
  assert.ok(NAV.VALID_BUSINESS_TAB_KEYS.has("gallery"));
  assert.equal(NAV.LEGACY_TAB_REDIRECTS.gallery, undefined);
  assert.equal(NAV.canonicalTab("gallery"), "gallery");
  assert.equal(NAV.sectionForTab("gallery"), "more", "highlights More, like the other directory destinations");
  assert.equal(NAV.BUSINESS_MORE_TABS.gallery.label, "Photos");
  assert.equal(L.managerHref("b1", "gallery"), "/account/business/b1?tab=gallery");
});

test("the 5-slot mobile bar and the desktop rail are unchanged (no Photos slot)", () => {
  assert.deepEqual(
    NAV.BUSINESS_NAV.map((n) => [n.label, n.tab, Boolean(n.desktopOnly)]),
    [["Home", "overview", false], ["Moments", "moments", false], ["Findmi Here", "findmi-here", false], ["Performance", "performance", false], ["Products", "products", true], ["Growth", "growth", true], ["More", "more", false]]
  );
});

test("Photos view: title, View Public Page, the gallery form; no form when the gallery couldn't be read", () => {
  const view = PAGE.slice(PAGE.indexOf('{activeTab === "gallery" && ('), PAGE.indexOf("── Products ──"));
  assert.match(view, /<h1[^>]*>Photos<\/h1>/);
  assert.match(view, /View Public Page/);
  assert.match(view, /\{photos \? \(/);
  assert.match(view, /<form action=\{galleryAction\}>\s*<MemberGalleryField businessId=\{id\} name="gallery_image_url" initialUrls=\{photos\} \/>/);
  assert.match(view, /couldn&rsquo;t load your photos/);
  // A failed read is null, never [] (an empty list would let Save wipe the gallery).
  assert.match(PAGE, /return readError \|\| !data \? null : data\.map/);
  assert.match(PAGE, /const onGallery = activeTab === "gallery";/);
});

test("Profile no longer embeds the gallery; one shared section nav (Manager segmented tabs) links both", () => {
  const profile = PAGE.slice(PAGE.indexOf('{activeTab === "profile" && ('), PAGE.indexOf('{activeTab === "gallery" && ('));
  assert.doesNotMatch(profile, /MemberGalleryField|galleryAction|Panel id="gallery"/);
  assert.match(profile, /<ProfileSectionNav businessId=\{id\} current="profile" \/>/);
  assert.match(PAGE, /<ProfileSectionNav businessId=\{id\} current="gallery" \/>/);
  assert.doesNotMatch(profile, /\["#details", "Details"\]/, "no raw inline anchor links");
  const nav = read(`${B}/v2/ProfileSectionNav.tsx`);
  assert.match(nav, /<OptimisticTabs/);
  assert.match(nav, /<ScrollActiveIntoView/);
  assert.match(nav, /overflow-x-auto rounded-full bg-black\/\[0\.04\] p-1/, "same track as Findmi Here's Events / Places / Past");
  assert.match(nav, /whitespace-nowrap/);
  assert.match(nav, /shrink-0/, "items keep their width and the track scrolls instead of wrapping");
  assert.doesNotMatch(nav, /flex-wrap/);
});

test("reachable from More → Manage (right after Public Profile) and Home's Public Profile row", () => {
  const profileRow = MORE.indexOf('to("profile")');
  const photosRow = MORE.indexOf('to("gallery")');
  assert.ok(profileRow > 0 && photosRow > profileRow && photosRow < MORE.indexOf('to("products")'));
  assert.match(MORE, /label: T\.gallery\.label/);
  assert.match(HOME, /<Link href=\{managerHref\(businessId, "gallery"\)\}[^>]*>\s*Photos\s*<\/Link>/);
});

// ── Reorder interaction ──────────────────────────────────────────────────

test("grid: only the grip handle gets the drag listeners and touch-none; the photo stays a scroll surface", () => {
  assert.equal(GRID.match(/\{\.\.\.listeners\}/g).length, 1);
  const handle = GRID.slice(GRID.indexOf("ref={setActivatorNodeRef}") - 200, GRID.indexOf("ref={setActivatorNodeRef}") + 600);
  assert.match(handle, /\{\.\.\.listeners\}/);
  assert.match(handle, /touch-none/);
  assert.equal(GRID.match(/className="[^"]*touch-none/g).length, 1, "touch-none is on the handle's class only");
  assert.match(GRID, /<div className="flex h-10 shrink-0 border-t/, "40px control bar under the photo");
  assert.match(handle, /flex-1/, "the grip fills the bar beside the 40px menu button");
  assert.match(handle, /select-none/);
  assert.match(GRID, /draggable=\{false\}/, "no native image drag on the photo");
});

test("grid: pointer + touch sensors with a 4px threshold, keyboard sensor, default auto-scroll", () => {
  assert.match(GRID, /useSensor\(PointerSensor, \{ activationConstraint: \{ distance: 4 \} \}\)/);
  assert.match(GRID, /useSensor\(TouchSensor, \{ activationConstraint: \{ distance: 4 \} \}\)/);
  assert.match(GRID, /useSensor\(KeyboardSensor, \{ coordinateGetter: sortableKeyboardCoordinates \}\)/);
  assert.doesNotMatch(GRID, /autoScroll=\{false\}/);
  assert.match(GRID, /grid auto-rows-fr grid-cols-3/);
});

test("grid: Move menu (Front / Earlier / Later / End / Remove), visible positions, announcements", () => {
  for (const label of ["Move to Front", "Move Earlier", "Move Later", "Move to End", "Remove"]) assert.match(GRID, new RegExp(`label="${label}"`));
  assert.match(GRID, /role="menu"/);
  assert.match(GRID, /role="menuitem"/);
  assert.match(GRID, /min-h-10/, "40px menu rows");
  assert.match(GRID, /aria-haspopup="menu"/);
  assert.match(GRID, /\{index \+ 1\}/, "visible position number");
  assert.match(GRID, /announcements,/);
  assert.match(GRID, /screenReaderInstructions/);
  assert.match(GRID, /aria-live="polite"/, "menu moves are announced too");
});

test("only the Business owner gallery uses the grid this pass", () => {
  assert.match(FIELD, /import SortableImageGrid from "@\/components\/SortableImageGrid"/);
  for (const f of [
    "src/app/(public)/account/event/[id]/MemberEventGalleryField.tsx",
    "src/app/(public)/account/location/[id]/MemberLocationGalleryField.tsx",
    "src/components/admin/GalleryField.tsx",
  ]) assert.doesNotMatch(read(f), /SortableImageGrid/, f);
});

// ── Explicit save + unsaved changes ──────────────────────────────────────

test("field: local list, DOM order is the saved order, dirty vs the saved gallery, guard, Save waits for uploads", () => {
  assert.match(FIELD, /<input type="hidden" name=\{name\} value=\{url\} \/>/);
  assert.match(FIELD, /const dirty = urls\.length !== initialUrls\.length \|\| urls\.some\(\(u, i\) => u !== initialUrls\[i\]\);/);
  assert.match(FIELD, /useUnsavedChangesGuard\(dirty\);/);
  assert.match(FIELD, /\{dirty && <SaveButton disabled=\{isPending\} \/>\}/, "Save shows when there are changes, waits for uploads");
  assert.match(FIELD, /\{dirty && <SaveButton compact disabled=\{isPending\} \/>\}/);
  assert.match(FIELD, /htmlFor=\{fileInputId\}[\s\S]*Add Photos/, "visible Add Photos action");
  assert.match(FIELD, /type="submit"/);
  assert.doesNotMatch(FIELD, /import[^\n]*updateBusinessGallery|requestSubmit|\.submit\(/, "no autosave");
});

test("field: the Foxden upload loop is untouched (per-file, preprocessing, HEIC, size guard live in lib/gallery-upload)", () => {
  assert.match(FIELD, /uploadGalleryFiles\(files, \{/);
  assert.match(FIELD, /upload: \(fd\) => uploadMemberBusinessImage\(businessId, fd\)/);
  assert.match(FIELD, /setError\(galleryUploadErrorMessage\(failures\)\)/);
  assert.match(FIELD, /disabled=\{isPending\}/);
});

// ── Save safety ──────────────────────────────────────────────────────────

test("save: insert the new list first, then delete everything else; returns to Photos", () => {
  const fn = galleryAction();
  const insert = fn.indexOf(".insert(");
  const del = fn.indexOf('.delete().eq("business_id", businessId)');
  assert.ok(insert > 0 && del > insert, "insert happens before the old rows are deleted");
  assert.match(fn, /display_order: i/);
  assert.match(fn, /\.not\("id", "in", `\(\$\{insertedIds\.join\(","\)\}\)`\)/);
  assert.match(fn, /const redirectPath = `\/account\/business\/\$\{businessId\}\?tab=gallery`;/);
});

test("save: every failure redirects with an error, never ?saved=1; delete failure rolls back the insert", () => {
  const fn = galleryAction();
  assert.match(fn, /if \(insertError \|\| !inserted \|\| inserted\.length !== galleryUrls\.length\)/);
  assert.match(fn, /if \(deleteError\) \{/);
  assert.match(fn, /\.delete\(\)\.in\("id", insertedIds\)/, "rollback of the rows just inserted");
  assert.match(fn, /fail\(undoError \? GALLERY_NEEDS_CHECK : GALLERY_NOT_SAVED\)/);
  assert.equal(fn.match(/saved: "1"/g).length, 1);
  assert.ok(fn.lastIndexOf('saved: "1"') > fn.lastIndexOf("fail("), "success is reported only after every write succeeded");
});
