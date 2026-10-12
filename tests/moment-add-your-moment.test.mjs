// Public Moment — "+ Add Your Moment" is offered on EVERY Moment. A real
// connected Event only scopes the destination (/event/<slug>/journal →
// sign-up gateway when signed out → /my-world/journal/new?event=<id>
// prefill); without an Event it opens the canonical generic composer
// (/my-world/journal/new — the global "Add Moment" route). Never an
// invented Event, source label or card. Source-level guards (no rendering
// harness); no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const PAGE = readFileSync("src/app/(public)/journal/[id]/page.tsx", "utf8");
const GALLERY = readFileSync("src/components/journal/JournalMomentGallery.tsx", "utf8");
const ENTRY = readFileSync("src/app/(public)/event/[slug]/journal/page.tsx", "utf8");
const EVENT_VIEW = readFileSync("src/app/(public)/event/[slug]/EventPublicView.tsx", "utf8");
const NEW_MOMENT = readFileSync("src/app/(public)/my-world/journal/new/page.tsx", "utf8");
const QUICK_CREATE = readFileSync("src/components/QuickCreateMenu.tsx", "utf8");
const MIDDLEWARE = readFileSync("src/middleware.ts", "utf8");
const BULLETIN = readFileSync("src/components/HomepageBulletinCarousel.tsx", "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const C = code(PAGE);

// The page's own rule, evaluated against real connection shapes.
const hrefExpr = PAGE.match(/const addMomentHref = (.+);/)[1];
const resolveHref = new Function("events", `return ${hrefExpr};`);

test("destination: Event-scoped when a real Event exists, else the canonical generic composer", () => {
  assert.equal(hrefExpr, 'events[0]?.slug ? `/event/${events[0].slug}/journal` : "/my-world/journal/new"');
  // Illy / Lavazza shape: an Event connection with a slug.
  assert.equal(resolveHref([{ id: "710dc3f5", slug: "illy-cup-of-love" }]), "/event/illy-cup-of-love/journal");
  // Babylist's actual shape: no connections at all → no events.
  assert.equal(resolveHref([]), "/my-world/journal/new");
  // An Event row without a slug never yields a broken Event link.
  assert.equal(resolveHref([{ id: "x", slug: null }]), "/my-world/journal/new");
});

test("both entry points are existing routes — no new composer, route or context param", () => {
  assert.match(EVENT_VIEW, /href=\{`\/event\/\$\{event\.slug\}\/journal`\}/, "the Event page's own + Add Moment");
  assert.match(ENTRY, /redirect\(`\/my-world\/journal\/new\?event=\$\{encodeURIComponent\(event\.id\)\}`\);/);
  assert.match(QUICK_CREATE, /href="\/my-world\/journal\/new"/, "the global Add Moment uses the same generic composer");
  assert.match(NEW_MOMENT, /export default async function NewJournalEntryPage/);
  assert.doesNotMatch(PAGE, /[?&](occurrence|event|location|business)=/, "no speculative context params");
});

test("auth: existing behavior for both destinations", () => {
  assert.match(ENTRY, /redirect\(`\/signup\?next=\$\{encodeURIComponent\(`\/event\/\$\{slug\}\/journal`\)\}`\);/, "Event-scoped: sign-up gateway, back to the same Event");
  assert.match(MIDDLEWARE, /if \(pathname\.startsWith\("\/my-world\/journal"\)\)/);
  assert.match(MIDDLEWARE, /loginUrl\.searchParams\.set\("next", getSafeRedirect\(pathname \+ request\.nextUrl\.search\)\);/, "generic: login, then back to the composer");
});

test("top CTA with a source: beside the 'This Moment Is From' label (Illy/Lavazza unchanged)", () => {
  const block = C.slice(C.indexOf("{primaryKind && ("), C.indexOf("<ContextCard"));
  assert.match(block, /flex min-h-8 items-center justify-between gap-3/);
  assert.match(block, /This Moment Is From<\/p>\s*<AddYourMomentPill href=\{addMomentHref\} \/>/);
  const pill = C.slice(C.indexOf("function AddYourMomentPill"));
  assert.match(pill, /inline-flex h-8 shrink-0 items-center rounded-full border border-findmi\/40 bg-white px-3\.5 text-metadata font-bold text-findmi-700/, "same secondary pill as before");
  assert.match(pill, />\s*\+ Add Your Moment\s*</);
});

test("top CTA without any source (Babylist): standalone pill row — no fake label, card or Event", () => {
  const standalone = C.slice(C.indexOf("{!primaryKind && ("), C.indexOf("{entry.notes && ("));
  assert.match(standalone, /<div className="mt-4 flex">\s*<AddYourMomentPill href=\{addMomentHref\} \/>\s*<\/div>/);
  assert.doesNotMatch(standalone, /This Moment Is From|ContextCard/);
  assert.equal((C.match(/This Moment Is From/g) ?? []).length, 1, "the source label only exists inside the real source block");
  assert.ok(C.indexOf("{!primaryKind && (") > C.indexOf("{primaryKind && ("), "same region where the source block would begin");
  const heroAt = C.indexOf("aspect-[4/3] w-full overflow-hidden bg-ink");
  assert.ok(heroAt > 0 && heroAt < C.indexOf("{!primaryKind && ("), "below the hero, not overlaid");
  // Exactly one top pill renders in either case.
  assert.equal((C.match(/<AddYourMomentPill /g) ?? []).length, 2, "one in the source row, one in the mutually-exclusive standalone row");
});

test("bottom CTA: universal for any Moment with a gallery — Event only changes the destination", () => {
  assert.match(C, /addMomentHref=\{addMomentHref\}/);
  assert.doesNotMatch(C, /primaryKind === "event" \? addMomentHref/, "no Event gate on the bottom CTA");
  const g = code(GALLERY);
  assert.match(g, /\{addMomentHref && \(\s*<Link\s+href=\{addMomentHref\}/);
  assert.match(g, />\s*Add Your Moment\s*<\/Link>/, "exact singular copy");
});

test("bottom CTA follows the visible stream — after All or after the filtered category's last photo", () => {
  const g = code(GALLERY);
  const grid = g.indexOf("<JournalPhotoGallery items={items} />");
  const rootEnd = g.indexOf("</JournalMediaViewerRoot>");
  const cta = g.indexOf("{addMomentHref && (");
  assert.ok(grid > 0 && grid < rootEnd && rootEnd < cta && cta < g.lastIndexOf("</section>"), "after the (filtered) grid, inside the gallery section");
  assert.match(g, /const visible = momentGalleryPhotos\(photos, active\?\.id \?\? null\);/);
  assert.match(g, /const items: JournalGalleryItem\[\] = visible\.map/);
  assert.ok(g.indexOf("ref={stripRef}") < cta, "below the sticky filter strip, never inside it");
});

test("bottom CTA styling preserved from 6349662", () => {
  const g = code(GALLERY);
  const cta = g.slice(g.indexOf("{addMomentHref && ("), g.lastIndexOf("</section>"));
  assert.match(cta, /mt-4 flex min-h-\[44px\] w-full items-center justify-center gap-2\.5 rounded-xl border border-black\/10 bg-white px-4 py-2 text-sm font-semibold text-ink\/85/);
  assert.match(cta, /h-5 w-5 shrink-0 items-center justify-center rounded-full bg-findmi text-white/);
});

test("no gallery (cover-only): the top CTA still exists; no empty gallery is manufactured", () => {
  assert.match(C, /\{hasGallery && <JournalMomentGallery/, "the gallery (and its bottom CTA) still renders only with photos");
  // The top pill doesn't depend on the gallery: one of the two rows always renders.
  const top = C.slice(C.indexOf("{primaryKind && ("), C.indexOf("{hasGallery && <JournalMomentGallery"));
  assert.doesNotMatch(top, /hasGallery/);
});

test("unchanged: source resolution, gallery filtering, viewer, cover; no Bulletin/BD change; no migration", () => {
  assert.match(C, /const primaryKind: "event" \| "location" \| "business" \| null = primaryEvent\s*\?\s*"event"\s*:\s*location\s*\?\s*"location"\s*:\s*businesses\.length > 0\s*\?\s*"business"\s*:\s*null;/);
  const g = code(GALLERY);
  assert.match(g, /<JournalMediaViewerRoot key=\{active\?\.id \?\? "all"\} items=\{viewerItems\}>\s*<JournalPhotoGallery items=\{items\} \/>\s*<\/JournalMediaViewerRoot>/);
  assert.match(g, /if \(momentGalleryPhotos\(photos, null\)\.length === 0\) return null;/);
  assert.match(PAGE, /isCover: m\.id === cover\?\.id,/);
  assert.match(BULLETIN, /if \(stoppedRef\.current\) return;/, "Bulletin carousel interaction guard intact");
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "20261013000000_bd_foundation.sql");
});
