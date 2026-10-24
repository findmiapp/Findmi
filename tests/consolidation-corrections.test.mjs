// Correction / consolidation pass — My Moments + board swipe, the restored
// Moment photo experience, dates up front, compact taxonomy pickers, the
// clearer Event importer, Our Locations bulk import, Places density,
// /join, Admin logout and Findmi for Business. Pure rules are exercised
// directly; wiring is pinned with source guards (repo convention). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    // The app's "@/…" alias → src/…(.ts)
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), SRC).href;
      try {
        return next(base, context);
      } catch {
        return next(`${base}.ts`, context);
      }
    }
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const B = "src/app/(public)/account/business/[id]";

const F = await import("../src/lib/moment-filters.ts");
const SCH = await import("../src/lib/event-create-schedule.ts");
const LF = await import("../src/lib/locator-import/fields.ts");

// ── 1–2, 14. Moments: Explore · For You · My Moments + board swipe ─────────

test("three modes with deterministic URLs; My Moments auth links return to My Moments", () => {
  assert.deepEqual(F.MOMENTS_PAGE_MODES, ["explore", "for-you", "my-moments"]);
  assert.equal(F.momentsModeHref("explore"), "/moments");
  assert.equal(F.momentsModeHref("for-you"), "/moments?mode=for-you");
  assert.equal(F.momentsModeHref("my-moments"), "/moments?mode=my-moments");
  assert.equal(F.momentsModeHref("my-moments", "events"), "/moments?mode=my-moments&filter=events");
  const { login, signup } = F.myMomentsAuthHrefs();
  assert.equal(login, "/login?next=%2Fmoments%3Fmode%3Dmy-moments");
  assert.equal(signup, "/signup?next=%2Fmoments%3Fmode%3Dmy-moments");
  assert.equal(F.isMyMomentsFilter("places"), true);
  assert.equal(F.isMyMomentsFilter("evil"), false);
});

test("board navigation: adjacent board in a fixed order; only a dominant horizontal swipe counts", () => {
  const order = ["all", "food-drink", "pop-ups"];
  assert.equal(F.adjacentBoard(order, "all", 1), "food-drink");
  assert.equal(F.adjacentBoard(order, "all", -1), null, "nothing past the start");
  assert.equal(F.adjacentBoard(order, "pop-ups", 1), null, "nothing past the end");
  assert.equal(F.swipeDirection(-80, 10), 1, "swipe left → next");
  assert.equal(F.swipeDirection(80, 10), -1, "swipe right → previous");
  assert.equal(F.swipeDirection(-40, 0), null, "too short");
  assert.equal(F.swipeDirection(-80, 70), null, "mostly vertical scrolling never changes the view");
});

test("/moments: My Moments is an owner-scoped, bounded read of the canonical journal records", () => {
  const page = code(read("src/app/(public)/moments/page.tsx"));
  assert.match(page, /const myMode = params\.mode === "my-moments";/);
  assert.match(page, /getJournalArchiveEntries\(user\.id, \{ limit: MY_MOMENTS_LIMIT \}\)/);
  assert.match(page, /myMode \? \{ cards: \[\], nextCursor: null \} : await getMomentFeed/, "the public feed isn't loaded in My Moments");
  assert.equal(F.MY_MOMENTS_LIMIT, 48);
  const view = read("src/components/moments/MyMomentsView.tsx");
  assert.match(view, /entries === null \? \(\s*<SignedOut \/>/, "signed out ≠ empty");
  assert.match(view, /My Moments holds the experiences you document on Findmi/);
  assert.match(view, />\s*Log In\s*</);
  assert.match(view, />\s*Create Account\s*</);
  assert.match(view, /filterByObjectType\(entries, filter\)/, "existing archive filters");
  assert.match(view, /href="\/my-world\/journal"/, "full history one tap away");
  assert.match(view, /href="\/my-world"/, "Saved & Following linked");
  assert.doesNotMatch(view, /My World|World Journal/);
});

test("mode tabs: Explore/For You switch in place; My Moments is a real navigation", () => {
  const tabs = read("src/components/moments/MomentsModeTabs.tsx");
  assert.match(tabs, /if \(onSelect && m !== "my-moments"\)/);
  assert.match(tabs, /href=\{momentsModeHref\(m\)\}/);
});

test("Moments grid: swipe the content surface between category boards (pan-y, no card swiping)", () => {
  const ui = code(read("src/components/moments/MomentsDiscovery.tsx"));
  assert.match(ui, /const swipe = useBoardSwipe\(\(dir\) => \{\s*const next = adjacentBoard\(chipCategories, category, dir\);/);
  assert.match(ui, /className="mt-4 touch-pan-y"/);
  assert.match(ui, /\{\.\.\.\(layout === "grid" \? swipe\.handlers : \{\}\)\}/, "homepage carousel keeps its own sideways scroll");
  const hook = read("src/components/moments/useBoardSwipe.ts");
  assert.match(hook, /swipeDirection\(t\.clientX - s\.x, t\.clientY - s\.y\)/);
});

// ── 3. Moment photo experience ──────────────────────────────────────────────

test("no giant two-button block: the photo grid stays primary; add affordances open a compact action menu", () => {
  const strip = code(read("src/components/journal/JournalPhotoStrip.tsx"));
  assert.doesNotMatch(strip, /PhotoSourceButtons/);
  assert.match(strip, /Add Photos<\/span>/, "the original empty Add Photos area is back");
  assert.match(strip, /if \(source\.canCapture\) setSourceSheetOpen\(true\);\s*else source\.choosePhotos\(\);/, "desktop keeps the file picker");
  // Existing management is untouched: drag/reorder, cover, remove, notes, sections.
  for (const cap of ["onDragReorder", "onMakeCover", "onRemove", "onMoveEarlier", "onMoveLater", "onEditNote", "onMoveToSection", "SortableContext"]) assert.match(strip, new RegExp(cap), cap);
  const src = read("src/components/journal/photoSource.tsx");
  assert.match(src, /export function PhotoSourceMenu/);
  assert.match(src, /<MomentSheet title="Add Photos" onClose=\{onClose\}>/);
  assert.doesNotMatch(src, /export function PhotoSourceButtons/);
  assert.match(read("src/components/journal/MomentPhotosStage.tsx"), /<PhotoSourceMenu takePhoto=\{source\.takePhoto\} choosePhotos=\{source\.choosePhotos\} \/>/);
});

// ── 6. Dates up front ───────────────────────────────────────────────────────

test("Date Range: first day is the Primary Date, the rest become occurrences (same daily hours)", () => {
  const r = SCH.resolveCreateSchedule("range", { rangeStart: "2026-11-06", rangeEnd: "2026-11-08", dailyStart: "10:00", dailyEnd: "17:00" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.primary, { startLocal: "2026-11-06T10:00", endLocal: "2026-11-06T17:00" });
  assert.deepEqual(r.extraDates.map((d) => d.date), ["2026-11-07", "2026-11-08"]);
  // Late hours that cross midnight end the next day (lib/schedule-dates rule).
  const late = SCH.resolveCreateSchedule("range", { rangeStart: "2026-11-06", rangeEnd: "2026-11-07", dailyStart: "20:00", dailyEnd: "01:00" });
  assert.equal(late.primary.endLocal, "2026-11-07T01:00");
  assert.equal(SCH.resolveCreateSchedule("range", { rangeStart: "2026-11-06", rangeEnd: "2026-11-06", dailyStart: "10:00", dailyEnd: "17:00" }).ok, false, "one day → Single Date");
});

test("Multiple Dates: sorted, one per day, earliest is primary; bad input is rejected, never guessed", () => {
  const dates = SCH.parseScheduleDates(JSON.stringify([
    { date: "2026-12-05", start_time: "11:00", end_time: "15:00" },
    { date: "2026-11-21", start_time: "11:00", end_time: "15:00" },
    { date: "2026-12-05", start_time: "16:00", end_time: "18:00" },
  ]));
  const r = SCH.resolveCreateSchedule("multiple", { dates });
  assert.equal(r.ok, true);
  assert.equal(r.primary.startLocal, "2026-11-21T11:00");
  assert.deepEqual(r.extraDates, [{ date: "2026-12-05", start_time: "11:00", end_time: "15:00" }]);
  assert.equal(SCH.resolveCreateSchedule("multiple", { dates: dates.slice(0, 1) }).ok, false);
  assert.equal(SCH.resolveCreateSchedule("multiple", { dates: [{ date: "2026-11-21", start_time: "10:00", end_time: "10:00" }, { date: "2026-11-22", start_time: "10:00", end_time: "12:00" }] }).ok, false);
  assert.deepEqual(SCH.parseScheduleDates("not json"), []);
});

test("creation reuses the ONE occurrence generator (no second date model)", () => {
  const actions = code(read("src/app/(public)/account/event/actions.ts"));
  assert.match(actions, /const resolved = resolveCreateSchedule\(scheduleMode, \{/);
  assert.match(actions, /await bulkGenerateEventDates\(eventId, extraDates, locationHintId \?\? null, manualVenue\);/);
  assert.match(actions, /\.\.\.scheduleFields,/, "schedule fields survive a validation error");
  const page = read("src/app/(public)/account/event/new/page.tsx");
  assert.match(page, /<EventScheduleFields/);
  assert.match(page, /single=\{\s*<DateTimeRangeFields/, "Single Date is the established start/end pair");
  const fields = read("src/components/scheduling/EventScheduleFields.tsx");
  assert.match(fields, /<input type="hidden" name="schedule_mode" value="range" \/>/);
  assert.match(fields, /<input type="hidden" name="multi_dates" value=\{JSON\.stringify/);
});

// ── 8. Category / Format: compact pickers ───────────────────────────────────

test("compact Category / Format on the Business Event screens; founder-admin forms unchanged", () => {
  for (const f of ["src/app/(public)/account/event/new/page.tsx", "src/app/(public)/account/event/[id]/page.tsx", `${B}/import-event/ReviewParts.tsx`]) {
    const s = read(f);
    assert.match(s, /<CategorySubcategoryField\s+variant="compact"|<CategorySubcategoryField variant="compact"/, f);
    assert.match(s, /<EventFormatField variant="compact"/, f);
  }
  assert.doesNotMatch(read("src/app/admin/(protected)/events/EventForm.tsx"), /variant="compact"/);
  const fmt = read("src/components/admin/EventFormatField.tsx");
  assert.match(fmt, /<input key=\{id\} type="hidden" name=\{EVENT_FORMAT_IDS_FIELD\} value=\{id\} \/>/, "same format_ids contract");
  assert.match(fmt, /<input type="hidden" name=\{EVENT_FORMATS_PRESENT_FIELD\} value="1" \/>/);
  const cat = read("src/components/admin/CategorySubcategoryField.tsx");
  assert.match(cat, /<input type="hidden" name="category_id" value=\{childId \|\| parentId\} \/>/, "same single stored category");
  assert.match(read("src/components/admin/PickerSheet.tsx"), /type="search"\s+autoCapitalize="none"/);
});

test("format summary stays short", async () => {
  const src = read("src/components/admin/EventFormatField.tsx");
  assert.match(src, /names\.length <= max \? names\.join\(", "\) : `\$\{names\.slice\(0, max\)\.join\(", "\)\} \+\$\{names\.length - max\}`/);
});

// ── 7. Event importer ───────────────────────────────────────────────────────

test("importer: what happens is obvious; inputs named plainly; intent copy is Hosting / Appearing At", () => {
  const ui = read(`${B}/import-event/EventImporter.tsx`);
  assert.match(ui, /export const IMPORT_STEPS = \["Give Findmi what you already have", "Findmi extracts the Event details", "You review everything before it’s added"\]/);
  assert.match(ui, /title: "Appearing At An Event"/);
  assert.match(ui, /title: "Hosting An Event"/);
  assert.match(ui, /A calendar or listing page with several Events works too/);
  assert.match(ui, /Pasting several Events\?/, "the existing several-Events paste format is exposed");
  // Intent keys are unchanged, so an Appearance never becomes a hosted Event.
  assert.match(ui, /participating: \{ title: "Appearing At An Event"/);
  assert.match(read(`${B}/import-event/page.tsx`), /href=\{`\$\{businessHome\}\?tab=findmi-here`\}/, "Back returns to Findmi Here → Events");
});

// ── 9–10. Places + Our Locations bulk import ────────────────────────────────

test("import target vocabulary and URL parsing", () => {
  assert.equal(LF.importTargetFromParam("our-locations"), "our_locations");
  assert.equal(LF.importTargetFromParam(undefined), "find_us_here");
  assert.equal(LF.importTargetFromParam("anything"), "find_us_here");
  assert.equal(LF.isImportTarget("our_locations"), true);
  assert.equal(LF.IMPORT_TARGET_LABELS.our_locations, "Our Locations");
});

test("Our Locations import reuses the one importer and keeps the existing ownership rules", () => {
  const server = code(read("src/lib/locator-import/server.ts"));
  assert.match(server, /if \(!wasCreated && !managedLocationIds\.has\(locationId\)\) \{\s*await settle\("failed", NOT_MANAGED_EXISTING_ROW\);/, "existing places only when managed (Connect rule)");
  assert.match(server, /const ours = await linkBusinessLocation\(admin, businessId, locationId\);/, "same link as one-at-a-time creation");
  assert.match(server, /operatedImport \? ALREADY_OPERATED_ROW : ALREADY_OUR_LOCATION_ERROR/);
  assert.match(server, /const ids = operatedImport \? \[\] :/, "source-id identity stays Find Us Here–only");
  assert.match(server, /\.\.\.\(input\.target === "our_locations" \? \{ target: "our_locations" \} : \{\}\)/, "Find Us Here never depends on the new column");
  assert.match(code(read("src/lib/locator-import/history.ts")), /=== "our_locations"\) return \{ applicable: false, total: 0, entries: \[\] \};/, "Not In This File stays Find Us Here–only");
  const mig = read("supabase/migrations/20261110000000_location_import_target.sql");
  assert.match(mig, /add column if not exists target text not null default 'find_us_here'/);
  assert.doesNotMatch(mig, /drop |delete |truncate /i, "additive only");
});

test("Places: compact Our Locations with a top action row incl. Import Locations; no big explanatory card", () => {
  const pv = code(read(`${B}/v2/PresenceViews.tsx`));
  assert.match(pv, /href=\{`\/account\/business\/\$\{encodeURIComponent\(businessId\)\}\/import-locations\?target=our-locations`\}/);
  assert.doesNotMatch(pv, /Add and manage locations for/);
  assert.match(pv, /\{!addOpen && actions\}/);
  assert.doesNotMatch(code(read(`${B}/v2/AvailableAtView.tsx`)), /Where people can find your products and services beyond your own locations/, "no duplicate lens copy");
  assert.match(read(`${B}/import-locations/page.tsx`), /const target = resume\?\.target \?\? importTargetFromParam\(targetParam\);/);
});

// ── 13, 15, 16. Join, Admin logout, Findmi for Business ─────────────────────

test("/join: the two loops on one account", () => {
  const join = read("src/app/(public)/join/page.tsx");
  assert.match(join, /const JOIN_PERSON_LOOP = \["Discover", "Save & Follow", "Organize", "Experience", "Capture Moments", "Revisit"\]/);
  assert.match(join, /const JOIN_BUSINESS_LOOP = \["Create Or Claim", "Publish Your Presence", "Show Where You’re Appearing", "Connect", "Grow"\]/);
  assert.match(join, /manage a Business and still use Findmi for yourself/);
  assert.doesNotMatch(code(join), /passbook framing|My World|World Journal|Digital Passbook/i);
});

test("Admin menu: Log Out + Exit Admin via the existing actions, behind the shared confirmation", () => {
  const bar = read("src/components/AdminToolbarBar.tsx");
  assert.match(bar, /import \{ signOut \} from "@\/app\/\(public\)\/account\/profile\/actions";/);
  assert.match(bar, /import \{ logout as adminLogout \} from "@\/app\/admin\/login\/actions";/);
  assert.match(bar, /<SignOutConfirm action=\{signOut\} className=\{cls\}>\s*Log Out/);
  assert.match(bar, /<SignOutConfirm action=\{adminLogout\} className=\{cls\}>\s*Exit Admin/);
  assert.match(bar, /closest\?\.\('\[role="alertdialog"\]'\)/, "confirming doesn't close the menu under it");
  assert.match(bar, /<SessionActions variant="sheet" \/>/, "mobile Admin menu");
});

test("Findmi for Business: one compact connected-presence section; no demo tiles", () => {
  const page = read("src/app/(public)/join/business/page.tsx");
  assert.match(page, /One Business Presence, Connected Across Findmi/);
  for (const h of ["Your Business Page", "Products", "Where Customers Can Find You", "Events", "Moments", "Discovery", "Connections & Growth"]) assert.ok(page.includes(`heading: "${h}"`), h);
  assert.doesNotMatch(page, /function DemoTile|function WhatYouGetGrid|Everything above is part of your free/);
  assert.match(page, /Free\. No trial\. No credit card\./, "Free positioning kept");
});

test("nothing here adds a second Moment/Event/Location model or a map table", () => {
  for (const f of ["src/lib/event-create-schedule.ts", "src/components/moments/MyMomentsView.tsx", "src/lib/locator-import/fields.ts"]) {
    assert.doesNotMatch(read(f), /\.from\("(map_|moment_posts|personal_posts|event_dates)/, f);
  }
  assert.ok(!existsSync("src/lib/map"), "no Map v1");
});
