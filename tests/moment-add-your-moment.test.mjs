// Public Moment — "+ Add Your Moment". Two entry points on /journal/[id]
// into the EXISTING Event Add Moment flow (/event/<slug>/journal → sign-up
// gateway when signed out → /my-world/journal/new?event=<id> prefill), shown
// only when the Moment's primary context is a real Event. Source-level
// guards (no rendering harness); no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const PAGE = readFileSync("src/app/(public)/journal/[id]/page.tsx", "utf8");
const GALLERY = readFileSync("src/components/journal/JournalMomentGallery.tsx", "utf8");
const ENTRY = readFileSync("src/app/(public)/event/[slug]/journal/page.tsx", "utf8");
const EVENT_VIEW = readFileSync("src/app/(public)/event/[slug]/EventPublicView.tsx", "utf8");
const NEW_MOMENT = readFileSync("src/app/(public)/my-world/journal/new/page.tsx", "utf8");
const MIDDLEWARE = readFileSync("src/middleware.ts", "utf8");
const BULLETIN = readFileSync("src/components/HomepageBulletinCarousel.tsx", "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("destination: the existing Event Add Moment entry point — the same one every Event page uses", () => {
  assert.match(PAGE, /const addMomentHref = events\[0\]\?\.slug \? `\/event\/\$\{events\[0\]\.slug\}\/journal` : null;/);
  assert.match(EVENT_VIEW, /href=\{`\/event\/\$\{event\.slug\}\/journal`\}/, "the Event page's own + Add Moment");
  // That entry point starts a NEW Moment prefilled with the Event.
  assert.match(ENTRY, /redirect\(`\/my-world\/journal\/new\?event=\$\{encodeURIComponent\(event\.id\)\}`\);/);
  assert.match(NEW_MOMENT, /resolvePrefillEvent\(params\.event\)/);
  assert.doesNotMatch(PAGE, /my-world\/journal\/new\?|[?&]occurrence=/, "no new creation route or speculative context param");
});

test("auth: existing behavior — signed-out visitors go through /signup?next= with the entry URL preserved", () => {
  assert.match(ENTRY, /redirect\(`\/signup\?next=\$\{encodeURIComponent\(`\/event\/\$\{slug\}\/journal`\)\}`\);/);
  assert.match(MIDDLEWARE, /if \(pathname\.startsWith\("\/my-world\/journal"\)\)/, "the composer itself stays sign-in gated");
});

test("top CTA: compact pill beside the 'This Moment Is From' label, Event context only", () => {
  const c = code(PAGE);
  const block = c.slice(c.indexOf("This Moment Is From") - 200, c.indexOf("<ContextCard"));
  assert.match(block, /flex min-h-8 items-center justify-between gap-3/);
  assert.match(block, /\{primaryKind === "event" && addMomentHref && \(\s*<Link\s+href=\{addMomentHref\}/);
  assert.match(block, /inline-flex h-8 shrink-0 items-center rounded-full border border-findmi\/40 bg-white px-3\.5 text-metadata font-bold text-findmi-700/, "same secondary pill as the Event page's + Add Moment");
  assert.match(block, />\s*\+ Add Your Moment\s*</);
  // Never over the hero.
  assert.equal((c.match(/\+ Add Your Moment/g) ?? []).length, 1);
  const heroAt = c.indexOf("aspect-[4/3] w-full overflow-hidden bg-ink");
  assert.ok(heroAt > 0 && heroAt < c.indexOf("+ Add Your Moment"), "below the hero, not overlaid");
});

test("bottom CTA: same destination, passed to the gallery only for Event context", () => {
  assert.match(PAGE, /addMomentHref=\{primaryKind === "event" \? addMomentHref : null\}/);
  const g = code(GALLERY);
  assert.match(g, /addMomentHref = null,/, "optional prop; default renders nothing");
  assert.match(g, /\{addMomentHref && \(\s*<Link\s+href=\{addMomentHref\}/);
  assert.match(g, />\s*Add Your Moment\s*<\/Link>/, "exact singular copy");
});

test("bottom CTA: follows the visible stream — after All or after the filtered category's last photo", () => {
  const g = code(GALLERY);
  const grid = g.indexOf("<JournalPhotoGallery items={items} />");
  const rootEnd = g.indexOf("</JournalMediaViewerRoot>");
  const cta = g.indexOf("{addMomentHref && (");
  const sectionEnd = g.lastIndexOf("</section>");
  assert.ok(grid > 0 && grid < rootEnd && rootEnd < cta && cta < sectionEnd, "after the (filtered) grid, inside the gallery section");
  // `items` is built from the current view, so the CTA always ends that view.
  assert.match(g, /const visible = momentGalleryPhotos\(photos, active\?\.id \?\? null\);/);
  assert.match(g, /const items: JournalGalleryItem\[\] = visible\.map/);
  assert.ok(g.indexOf("ref={stripRef}") < cta, "below the sticky filter strip, never inside it");
});

test("bottom CTA styling: thin full-width outline row, small aqua circle with white +, #333-equivalent text", () => {
  const g = code(GALLERY);
  const cta = g.slice(g.indexOf("{addMomentHref && ("), g.lastIndexOf("</section>"));
  assert.match(cta, /mt-4 flex min-h-\[44px\] w-full items-center justify-center gap-2\.5 rounded-xl border border-black\/10 bg-white px-4 py-2 text-sm font-semibold text-ink\/85/);
  assert.match(cta, /h-5 w-5 shrink-0 items-center justify-center rounded-full bg-findmi text-white/);
  assert.doesNotMatch(cta.split("rounded-full bg-findmi")[0], /bg-findmi/, "the row itself is not aqua-filled");
});

test("hidden when there is no legitimate Event source", () => {
  assert.match(PAGE, /events\[0\]\?\.slug \?/, "no Event (or no slug) → null → no CTA");
  // Location- or Business-sourced Moments get neither CTA.
  assert.match(PAGE, /\{primaryKind === "event" && addMomentHref && \(/);
  assert.match(PAGE, /addMomentHref=\{primaryKind === "event" \? addMomentHref : null\}/);
});

test("unchanged: gallery filtering, viewer, cover, sticky strip; no Bulletin/BD change; no migration", () => {
  const g = code(GALLERY);
  assert.match(g, /<JournalMediaViewerRoot key=\{active\?\.id \?\? "all"\} items=\{viewerItems\}>\s*<JournalPhotoGallery items=\{items\} \/>\s*<\/JournalMediaViewerRoot>/);
  assert.match(g, /if \(momentGalleryPhotos\(photos, null\)\.length === 0\) return null;/);
  assert.match(PAGE, /isCover: m\.id === cover\?\.id,/);
  assert.match(BULLETIN, /if \(heldRef\.current\) return;/, "Bulletin fix intact");
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "20261013000000_bd_foundation.sql");
});
