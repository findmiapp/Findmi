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

test("'This Moment Is From' introduces ONLY the relationship card — no CTA beside it (Moment UX polish)", () => {
  const block = C.slice(C.indexOf("{primaryKind && ("), C.indexOf("{entry.notes && ("));
  assert.match(block, /<p className="text-xs font-bold uppercase tracking-wide text-findmi-700">This Moment Is From<\/p>\s*<div className="mt-1\.5">\s*\{primaryKind === "event"/);
  assert.doesNotMatch(block, /AddYourMomentPill|justify-between/);
  const pill = C.slice(C.indexOf("function AddYourMomentPill"));
  assert.match(pill, /inline-flex h-8 shrink-0 items-center rounded-full border border-findmi\/40 bg-white px-3\.5 text-metadata font-bold text-findmi-700/, "same secondary pill as before");
  assert.match(pill, />\s*\+ Add Your Moment\s*</);
});

test("ONE Add Your Moment CTA, after the photo story — never a top pill (Moment UX polish)", () => {
  assert.doesNotMatch(C, /\{!primaryKind && \(/, "no standalone top pill row");
  assert.equal((C.match(/This Moment Is From/g) ?? []).length, 1, "the source label only exists inside the real source block");
  assert.equal((C.match(/<AddYourMomentPill /g) ?? []).length, 1, "only the no-photos fallback");
  const gallery = C.indexOf("{hasGallery && <JournalMomentGallery");
  const fallback = C.indexOf("{!hasGallery && (");
  assert.ok(gallery > C.indexOf("{primaryKind && (") && fallback > gallery, "after the relationship card and the story");
  assert.ok(fallback < C.indexOf("Visit Details"), "before Visit Details");
  assert.match(C.slice(fallback), /^\{!hasGallery && \(\s*<div className="mt-5 flex">\s*<AddYourMomentPill href=\{addMomentHref\} \/>\s*<\/div>\s*\)\}/);
  // With photos, the gallery's own end-of-story CTA is the only one.
  const g = code(GALLERY);
  assert.equal((g.match(/Add Your Moment/g) ?? []).length, 1);
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

test("no photos: the gallery isn't manufactured; the same pill renders after the story instead", () => {
  assert.match(C, /\{hasGallery && <JournalMomentGallery/, "the gallery (and its bottom CTA) still renders only with photos");
  assert.match(C, /const hasGallery = galleryPhotos\.length > 0;/, "a cover-only Moment now HAS a gallery (its one photo)");
  assert.match(C, /\{!hasGallery && \(/);
});

test("unchanged: source resolution, gallery filtering, viewer, cover; no Bulletin/BD change; no migration", () => {
  assert.match(C, /const primaryKind: "event" \| "location" \| "business" \| null = primaryEvent\s*\?\s*"event"\s*:\s*location\s*\?\s*"location"\s*:\s*businesses\.length > 0\s*\?\s*"business"\s*:\s*null;/);
  const g = code(GALLERY);
  assert.match(g, /<JournalMediaViewerRoot key=\{active\?\.id \?\? "all"\} items=\{viewerItems\}>\s*<JournalPhotoGallery items=\{items\} \/>\s*<\/JournalMediaViewerRoot>/);
  assert.match(g, /if \(momentGalleryPhotos\(photos, null\)\.length === 0\) return null;/);
  assert.match(PAGE, /isCover: m\.id === cover\?\.id,/);
  assert.match(BULLETIN, /if \(stoppedRef\.current\) return;/, "Bulletin carousel interaction guard intact");
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(files.filter((f) => f > "20261013000000_bd_foundation.sql"), ["20261014000000_optional_business_geography.sql", "20261014010000_event_attendance_cta_and_location_visibility.sql" /* Event attendance pass */, "20261015000000_business_location_availability.sql" /* Find Us At pass */, "20261016000000_event_taxonomy_v1.sql" /* Event Taxonomy V1 pass */, "20261017000000_event_formats_v1.sql" /* Event Formats V1 pass */, "20261018000000_event_occurrence_details.sql" /* Event Occurrence details pass */, "20261019000000_event_date_time_precision.sql" /* Event date/time precision pass */, "20261020000000_moment_authorship_and_access_history.sql" /* Identity & Authorship V1 pass */, "20261021000000_brand_audit_and_opportunity_ideas.sql" /* Brand Audit + Opportunity Ideas V1 pass */, "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */]);
});
