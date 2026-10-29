// UX consolidation pass — one Findmi product over the existing canonical
// systems. Pure rules are exercised directly; UI wiring is pinned with
// source-level guards, following this repo's convention. No network.
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

const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const B = "src/app/(public)/account/business/[id]";

const EI = await import(`../${B}/v2/eventIntent.ts`);
const L = await import("../src/lib/manager-links.ts");
const F = await import("../src/lib/moment-filters.ts");
const S = await import("../src/lib/guest-moment-session.ts");
const D = await import("../src/lib/guest-moment-draft.ts");
const { emptyMomentInitial } = await import("../src/lib/moment-composer.ts");
const BS = await import("../src/lib/business-name-search-domain.ts");

const PAGE = code(read(`${B}/(manager)/page.tsx`));

// ── 1. Business Home ────────────────────────────────────────────────────────

test("Management cards: ONE Event entry (no separate Where I'll Be) that opens the Hosting / Appearing chooser", () => {
  const items = code(read(`${B}/v2/managementCardItems.ts`));
  assert.doesNotMatch(items, /key: "where"/);
  assert.equal((items.match(/key: "events"/g) ?? []).length, 1);
  assert.match(items, /addHref: managerHref\(businessId, "add-event"\)/);
  assert.equal(L.managerHref("b1", "add-event"), "/account/business/b1?tab=findmi-here&add=event");
  for (const k of ["locations", "products", "qr", "moments", "targets"]) assert.match(items, new RegExp(`key: "${k}"`), `${k} stays`);
});

test("Management cards never overflow the PAGE at phone width: the swipe row scrolls inside itself, bleeding only into the shell gutter", () => {
  const cards = code(read(`${B}/v2/ManagementCards.tsx`));
  // -mx-4 matches the shell's px-4 exactly, so the row reaches the screen
  // edge and no further; overflow is contained in the row itself.
  assert.match(read(`${B}/v2/BusinessAppShell.tsx`), /max-w-6xl px-4 pb-28/);
  assert.match(cards, /-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [^"]*md:grid md:snap-none md:grid-cols-6/);
  assert.match(cards, /min-w-0 shrink-0 snap-start/);
});

test("Moment creation uses the canonical Moments photo icon — never the pencil", () => {
  const icon = code(read(`${B}/v2/CreateActionIcon.tsx`));
  assert.match(icon, /icon === "moment"\) return <NavIcon name="moments"/);
  assert.doesNotMatch(icon, /MomentGlyph/);
  const quick = code(read("src/components/QuickCreateMenu.tsx"));
  assert.match(quick, /label="Add Moment"[\s\S]*?icon=\{<NavIcon name="moments"/);
  assert.doesNotMatch(quick, /PencilGlyph/);
  assert.doesNotMatch(code(read("src/components/opportunities/OpportunityGlyphs.tsx")), /M17 3a2\.1 2\.1 0 013 3L8\.5 17\.5/);
  for (const f of ["src/app/(public)/event/[slug]/EventPublicView.tsx", "src/app/(public)/location/[slug]/LocationPublicView.tsx", "src/app/(public)/business/[slug]/BusinessPublicView.tsx", "src/app/(public)/product/[slug]/page.tsx", "src/app/(public)/journal/MyJournal.tsx", "src/app/(public)/moments/page.tsx", `${B}/v2/MomentsView.tsx`]) {
    const src = code(read(f));
    assert.doesNotMatch(src, /\+ Add Moment/, f);
    assert.match(src, /<NavIcon name="moments"/, f);
  }
  // A pencil that genuinely means Edit stays (the Moment page's Edit).
  assert.match(read("src/app/(public)/journal/[id]/page.tsx"), /function EditPencilGlyph/);
});

test("Home Opportunities + Growth Manager: summary kept as FOUR thin controls deep-linking to the exact state", () => {
  const panel = code(read(`${B}/v2/GrowthPanel.tsx`));
  assert.match(panel, /<nav aria-label=\{OPPORTUNITIES_MANAGER_TITLE\}>/);
  assert.match(panel, /GROWTH_DESTINATIONS\.map/);
  assert.match(panel, /href=\{growthHref\(basePath, d\)\}/);
  assert.match(panel, /growthDestinationStatus\(summary, d\)/);
  assert.match(panel, /className="flex h-11 /, "thin, not big cards");
  assert.match(panel, /Open Opportunities/);
});

// ── 2–3. Findmi Here: Events ────────────────────────────────────────────────

test("Findmi Here top lenses: Events · Places · Past (view keys unchanged)", () => {
  const pv = code(read(`${B}/v2/PresenceViews.tsx`));
  assert.match(pv, /\{ key: "events", label: "Events"/);
  assert.match(pv, /\{ key: "places", label: "Places"/);
  assert.match(pv, /\{ key: "past", label: "Past"/);
  assert.doesNotMatch(pv, /label: "Happening"/);
});

test("Compact Add Event pill at the header, intent asked first, then the existing workflow", () => {
  const chooser = code(read(`${B}/v2/AddEventChooser.tsx`));
  assert.match(chooser, /rounded-full border border-findmi-200 bg-white/, "thin outlined pill, not a filled CTA");
  assert.match(chooser, /Add Event/);
  assert.match(chooser, /What Are You Adding\?/);
  assert.match(chooser, /Hosting An Event/);
  assert.match(chooser, /Appearing At An Event/);
  assert.match(PAGE, /action=\{presenceView === "upcoming" \|\| presenceView === "past" \? <AddEventChooser/);
  assert.doesNotMatch(PAGE, /<AddToPresence /, "the giant + Add sheet is gone from Events");
  assert.equal(EI.addEventIntentHref("/b", "hosting", "b1"), "/account/event/new?business_id=b1", "Hosting → the canonical Host an Event page");
  assert.equal(EI.addEventIntentHref("/b", "appearing", "b1"), "/b?tab=findmi-here&compose=1#going-somewhere");
  assert.equal(EI.parseComposeIntent("1"), "appearing", "existing Where I'll Be links still land");
  assert.equal(EI.parseComposeIntent("hosting"), "hosting");
  assert.equal(EI.parseComposeIntent(undefined), null);
});

test("Import comes AFTER intent and carries it", () => {
  assert.equal(EI.eventImportHref("b1", "hosting"), "/account/business/b1/import-event?intent=hosting");
  assert.equal(EI.eventImportHref("b1", "appearing"), "/account/business/b1/import-event?intent=participating");
  // Hosting's Import lives on the canonical Host an Event page; Appearing's here.
  assert.match(read("src/app/(public)/account/event/new/page.tsx"), /import-event\?intent=hosting/);
  assert.match(PAGE, /href=\{eventImportHref\(id, "appearing"\)\}/);
  assert.doesNotMatch(PAGE, /bg-findmi text-button font-bold text-white[^"]*"\s*>\s*Import Event/, "no giant generic Import Event button");
});

test("Search Findmi shows nothing until the owner types; results stay bounded", () => {
  const picker = code(read(`${B}/EventSearchPicker.tsx`));
  assert.match(picker, /export const EVENT_SEARCH_MIN_CHARS = 2/);
  assert.match(picker, /if \(!searching\) return \[\];/);
  assert.match(picker, /\.slice\(0, 8\)/);
  assert.doesNotMatch(picker, /: options;/, "no default browse list");
});

// ── 4–5. Places: Find Us Here | Our Locations + Growth bridge ───────────────

test("Places lens: Find Us Here | Our Locations — one Location model, split by relationship", () => {
  const pv = code(read(`${B}/v2/PresenceViews.tsx`));
  assert.match(pv, /label: "Find Us Here", body: "Places where customers can find your products or services\."/);
  assert.match(pv, /label: "Our Locations", body: "Places your Business owns or operates\."/);
  assert.match(PAGE, /<PlacesLens basePath=\{`\/account\/business\/\$\{id\}`\} view="find-us" \/>/);
  assert.match(PAGE, /<PlacesLens basePath=\{`\/account\/business\/\$\{id\}`\} view="locations" \/>/);
  // Each side keeps its own add/import flow → its own relationship table.
  assert.match(PAGE, /<AvailableAtView/);
  assert.match(PAGE, /<LocationsPresence/);
});

test("Targets are not Find Us Here inventory: the sub-view is gone and its old URL lands in Growth", () => {
  const sw = code(read(`${B}/v2/MarketFootprintView.tsx`));
  assert.doesNotMatch(sw, /"Targets"/);
  assert.match(sw, /"All Places"/);
  assert.match(sw, /"By Market"/);
  assert.match(code(read(`${B}/(manager)/page.tsx`)), /rawSearchParams\.fv === "targets" && !rawSearchParams\.loc && !rawSearchParams\.tgt && !rawSearchParams\.pt\) \{\s*redirect\(managerHref\(id, "targets"\)\)/);
  assert.equal(L.originBack("b1", "findmi-here").href, "/account/business/b1?tab=findmi-here&view=find-us");
});

test("Growth bridge: Want To Grow Your Footprint? → Add Target · Discover · Opportunities (no Target data here)", () => {
  const bridge = code(read(`${B}/v2/GrowthFootprintBridge.tsx`));
  assert.match(bridge, /Want To Grow Your Footprint\?/);
  assert.match(bridge, /managerHref\(businessId, "add-target"\)/);
  assert.match(bridge, /managerHref\(businessId, "discover"\)/);
  assert.match(bridge, /managerHref\(businessId, "opportunities"\)/);
  assert.doesNotMatch(bridge, /from\("business_targets"\)|getBusinessTargets/);
  assert.match(PAGE, /<GrowthFootprintBridge businessId=\{id\} \/>/);
});

// ── 7–8. Moments: Explore vs For You ────────────────────────────────────────

const card = (tags, follow = {}) => ({ tags, follow: { businessSlugs: [], eventIds: [], locationIds: [], businessIds: [], ...follow } });
const NONE = { businessSlugs: [], eventIds: [], locationIds: [] };

test("feed state: Explore default; each mode owns its category; legacy ?filter= still lands", () => {
  assert.deepEqual(F.parseMomentFeedState({}), { mode: "explore", categories: { explore: "all", "for-you": "all", "my-moments": "all" }, display: "feed" });
  const s = F.parseMomentFeedState({ mode: "for-you", cat: "pop-ups" });
  assert.equal(s.mode, "for-you");
  assert.equal(s.categories["for-you"], "pop-ups");
  assert.equal(s.categories.explore, "all", "For You's category is never forced onto Explore");
  assert.equal(F.parseMomentFeedState({ filter: "following" }).mode, "for-you");
  assert.deepEqual(F.parseMomentFeedState({ filter: "food-drink" }).categories, { explore: "food-drink", "for-you": "all", "my-moments": "all" });
  assert.equal(F.momentFeedQuery("explore", "all"), "");
  assert.equal(F.momentFeedQuery("for-you", "classes", "2026-01-01_x"), "mode=for-you&cat=classes&cursor=2026-01-01_x");
});

test("For You is real ordering from the viewer's own follows — not a cosmetic label", () => {
  const followed = card(["food-drink"], { eventIds: ["e1"] });
  const other = card(["pop-ups"]);
  const r = F.orderForYou([other, followed], { ...NONE, eventIds: ["e1"] });
  assert.equal(r.personalized, true);
  assert.deepEqual(r.fromFollows, [followed]);
  assert.deepEqual(r.more, [other]);
  const none = F.orderForYou([other, followed], NONE);
  assert.equal(none.personalized, false, "no signal → it says so instead of pretending");
  assert.deepEqual(none.more, [other, followed]);
  assert.equal(F.momentInCategory(followed, "all"), true);
  assert.equal(F.momentInCategory(followed, "pop-ups"), false);
});

test("Moments UI: mode toggle, per-mode category state, swipeable chip rail with gutter", () => {
  const ui = code(read("src/components/moments/MomentsDiscovery.tsx"));
  // Correction pass: the three-mode control (Explore · For You · My Moments).
  assert.match(ui, /\{showModes && <MomentsModeTabs active=\{mode\} onSelect=\{ownCards \? undefined : setMode\} display=\{display\} \/>\}/);
  assert.match(ui, /setCategories\(\(prev\) => \(\{ \.\.\.prev, \[mode\]: c \}\)\)/);
  assert.match(ui, /-mx-4 mt-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4/);
  assert.match(ui, /From What You Follow/);
});

test("/moments: general destination with Explore/For You and a compact Add Moment beside the heading", () => {
  const page = read("src/app/(public)/moments/page.tsx");
  assert.match(page, /parseMomentFeedState\(params\)/);
  assert.match(page, /trailing=\{\s*<Link\s+href=\{ADD_MOMENT_HREF\}/);
  assert.match(page, /Add Moment/);
  assert.doesNotMatch(page, /^export const ADD_MOMENT_HREF/m, "no non-standard page exports");
  const home = read("src/app/(public)/page.tsx");
  assert.match(home, /href="\/moments"\s+className="flex items-center gap-2 rounded-2xl/, "homepage Moments action → /moments");
});

// ── 9. Photo capture ────────────────────────────────────────────────────────

test("Take Photo (camera capture) + Choose From Photos (multi) on the shared photo strip; desktop unchanged", () => {
  // read(), not code(): accept="image/*" would look like a comment opener.
  const src = read("src/components/journal/photoSource.tsx");
  assert.match(src, /type="file" accept="image\/\*" capture="environment"/);
  assert.match(src, /type="file" accept="image\/\*" multiple aria-label="Add photos"/);
  assert.match(src, /matchMedia\("\(pointer: coarse\)"\)/);
  assert.match(src, /camera: "Take Photo", library: "Choose From Photos"/);
  const strip = code(read("src/components/journal/JournalPhotoStrip.tsx"));
  assert.match(strip, /usePhotoSource\(onFilesSelected/, "same upload + draft pipeline");
  assert.match(strip, /if \(source\.canCapture\) setSourceSheetOpen\(true\);\s*else source\.choosePhotos\(\);/);
});

// ── 10. Draft recovery ──────────────────────────────────────────────────────

const LOC_A = { value: "loc-a", label: "Flatiron North Plaza" };
const LOC_B = { value: "loc-b", label: "Corner Cafe" };
const initialAt = (loc) => ({ ...emptyMomentInitial(), location: loc });
const draft = (patch) => ({ ...D.emptyGuestMomentDraft(), ...patch });

test("signed out, a Moment in progress for a DIFFERENT place → ask first, never mix", () => {
  const d = draft({ location: LOC_A, title: "Coffee pop-up" });
  const decision = S.decideGuestStartup({ authed: false, resume: false, initial: initialAt(LOC_B), draft: d });
  assert.equal(decision.kind, "switch");
  assert.equal(decision.draft.location.value, "loc-a", "the draft itself is untouched (no merge)");
  assert.equal(S.draftContextLabel(d), "Flatiron North Plaza");
});

test("same context (reload / auth round trip) and cold entry still restore; prefill-only drafts start clean", () => {
  const d = draft({ location: LOC_A, title: "Coffee pop-up" });
  assert.equal(S.decideGuestStartup({ authed: false, resume: false, initial: initialAt(LOC_A), draft: d }).kind, "restore");
  assert.equal(S.decideGuestStartup({ authed: false, resume: false, initial: emptyMomentInitial(), draft: d }).kind, "restore");
  const prefillOnly = draft({ location: LOC_A });
  assert.equal(S.decideGuestStartup({ authed: false, resume: false, initial: initialAt(LOC_B), draft: prefillOnly }).kind, "none");
});

test("composer: You Have A Moment In Progress — Continue restores its own context; Start New never destroys on the spot", () => {
  const c = code(read("src/components/journal/MomentComposer.tsx"));
  assert.match(c, /title="You Have A Moment In Progress"/);
  assert.match(c, /Continue your Moment with \$\{draftContextLabel\(switchDraftPrompt\)\}\?/);
  assert.match(c, />\s*Continue Moment\s*</);
  assert.match(c, />\s*Start A New Moment\s*</);
  assert.match(c, /function continueSwitchDraft\(\) \{[\s\S]*?void restoreGuestDraft\(draft\)/);
  assert.match(c, /function startNewOverSwitchDraft\(\) \{[\s\S]*?pendingReplaceRef\.current = draft;/);
  const startNew = c.slice(c.indexOf("function startNewOverSwitchDraft"));
  assert.doesNotMatch(startNew.slice(0, startNew.indexOf("\n  }\n")), /clearGuestMomentDraft|deleteAllGuestMomentMedia/);
  assert.match(c, /onClose=\{\(\) => \{\}\}/, "a required choice");
});

// ── 12–14. Journal, /join, Add Business ─────────────────────────────────────

test("Journal alignment: My Moments (feed) → My Journal (history), same records; no Saved or Explore detours in the Journal", () => {
  const journal = code(read("src/app/(public)/journal/MyJournal.tsx"));
  assert.doesNotMatch(journal, /href="\/moments"|href="\/account\/saved"|Saved &(amp;)? Following/);
  assert.match(read("src/components/moments/MomentsDiscovery.tsx"), /<Link href=\{MY_JOURNAL_HREF\}[\s\S]{0,160}View My Journal/);
  assert.doesNotMatch(read("src/components/moments/MomentsDiscovery.tsx"), /World Journal|My World/);
});

test("/join: one account, multiple ways to use Findmi — no passbook framing, no account types", () => {
  const join = code(read("src/app/(public)/join/page.tsx"));
  assert.match(join, /One Findmi Account\. Multiple Ways To Use Findmi\./);
  assert.match(join, /title="Add Or Claim A Business"/);
  assert.match(join, /"Capture Moments"/);
  assert.doesNotMatch(join, /Build your digital passbook/i);
  assert.doesNotMatch(join, /account_type|role=/);
});

test("Add Business: search-first actions per management state", () => {
  assert.equal(BS.businessMatchAction("unclaimed", false), "claim");
  assert.equal(BS.businessMatchAction("claim_pending", false), "pending");
  assert.equal(BS.businessMatchAction("managed", false), "request");
  assert.equal(BS.businessMatchAction("managed", true), "manage");
  assert.equal(BS.businessMatchHref("claim", { id: "i", slug: "joe" }, true), "/business/joe?claim=1");
  assert.equal(BS.businessMatchHref("claim", { id: "i", slug: "joe" }, false), "/login?next=%2Fbusiness%2Fjoe%3Fclaim%3D1");
  assert.equal(BS.businessMatchHref("manage", { id: "i", slug: "joe" }, true), "/account/business/i");
  assert.equal(BS.isMeaningfulBusinessQuery("jo"), false);
  assert.equal(BS.isMeaningfulBusinessQuery("joe"), true);
});

test("Add Business: bounded, throttled lookup over the existing public brand matcher (a Server Action — no JSON API route); form revealed by Create", () => {
  const route = code(read("src/app/(public)/account/business/new/lookup-action.ts"));
  assert.match(route, /^"use server";/);
  assert.match(route, /lookupBrand\(classified, authenticated, deps\)/);
  assert.match(route, /isBrandLookupRateLimited\(\)/);
  assert.match(route, /businessManagementState\(/);
  const ui = code(read("src/app/(public)/account/business/new/BusinessNameSearchFirst.tsx"));
  assert.match(ui, /BUSINESS_SEARCH_DEBOUNCE_MS/);
  assert.match(ui, /Can&rsquo;t Find Your Business\?/);
  assert.match(ui, /Create &ldquo;\{typed\}&rdquo;/);
  assert.match(ui, /className=\{creating \? "contents" : "hidden"\}/);
  const page = code(read("src/app/(public)/account/business/new/page.tsx"));
  assert.match(page, /<BusinessNameSearchFirst/);
  assert.match(page, /I confirm that I am authorized to create and manage this business on Findmi\./, "authorization confirmation preserved");
});

// ── 16. Performance frozen ──────────────────────────────────────────────────

test("Performance views were not touched by this pass", () => {
  // The Home snapshot keeps its exact Performance contract.
  const home = code(read(`${B}/v2/BusinessHome.tsx`));
  assert.match(home, /<MetricTile label="Views"/);
  assert.match(home, /<MetricTile label="Scans"/);
});
