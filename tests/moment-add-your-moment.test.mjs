// Public Moment — "+ Add Your Moment" is offered on EVERY Moment, TWICE:
// right after the "This Moment Is From" card and again after the photo
// story. Both use ONE href straight into the guest-capable composer: a real
// connected Event only scopes it via the existing ?event= prefill
// (/my-world/journal/new?event=<id>); without an Event it is the canonical
// generic composer (/my-world/journal/new). No auth logic in either CTA — a
// guest's account is only asked for at the composer's final Save/Publish.
// Never an invented Event, source label or card. Source-level guards (no rendering
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

test("destination: straight into the composer, Event-scoped via the existing ?event= prefill when a real Event exists", () => {
  assert.equal(hrefExpr, 'events[0]?.id ? `/my-world/journal/new?event=${encodeURIComponent(events[0].id)}` : "/my-world/journal/new"');
  assert.equal(resolveHref([{ id: "710dc3f5", slug: "illy-cup-of-love" }]), "/my-world/journal/new?event=710dc3f5");
  // Babylist's actual shape: no connections at all → no events.
  assert.equal(resolveHref([]), "/my-world/journal/new");
  assert.equal(resolveHref([{ id: null, slug: "x" }]), "/my-world/journal/new", "no id, no invented Event");
});

test("guest CTA never points at Login, Create Account/Sign Up or an intermediary gateway", () => {
  assert.doesNotMatch(hrefExpr, /login|signup|\/event\/.*\/journal/);
  assert.doesNotMatch(C, /\/login|\/signup/, "the Moment page itself carries no auth routing");
  // The stale Event gateway no longer bounces a signed-out visitor to sign-up.
  assert.doesNotMatch(code(ENTRY), /\/signup|\/login|getUser\(\)/);
});

test("both entry routes land in the same composer; only the existing ?event= param carries context", () => {
  assert.match(EVENT_VIEW, /href=\{`\/event\/\$\{event\.slug\}\/journal`\}/, "the Event page's own + Add Moment (now guest-capable too)");
  assert.match(ENTRY, /redirect\(`\/my-world\/journal\/new\?event=\$\{encodeURIComponent\(event\.id\)\}`\);/);
  assert.match(QUICK_CREATE, /href="\/my-world\/journal\/new"/, "the global Add Moment uses the same generic composer");
  assert.match(NEW_MOMENT, /export default async function NewJournalEntryPage/);
  assert.doesNotMatch(PAGE, /[?&](occurrence|location|business|product)=/, "no speculative context params");
  assert.match(NEW_MOMENT, /event\?: string/, "?event= is the composer's own existing param");
});

test("auth: nothing in the CTAs; the composer stays open to guests and only its other journal routes stay gated", () => {
  assert.match(MIDDLEWARE, /if \(pathname\.startsWith\("\/my-world\/journal"\)\)/);
  assert.match(MIDDLEWARE, /if \(!user && pathname === "\/my-world\/journal\/new"\) return response;/, "guests reach the composer");
  assert.match(MIDDLEWARE, /loginUrl\.searchParams\.set\("next", getSafeRedirect\(pathname \+ request\.nextUrl\.search\)\);/, "every other journal route still redirects");
  // Final Save/Publish authentication is the composer's own, unchanged.
  const composer = readFileSync("src/components/journal/MomentComposer.tsx", "utf8");
  assert.match(composer, /finishAsGuest\(action === "publish" \? "publish" : "draft"\);/);
  assert.match(composer, /Your Moment Is Ready/);
});

test("Event creation stays identity/Page gated (Add Your Moment never touches it)", () => {
  assert.match(MIDDLEWARE, /GUEST_ACCESSIBLE_PATHS = new Set\(\["\/account\/business\/new", "\/account\/location\/new", "\/account\/event\/new"\]\);/);
  const eventNew = readFileSync("src/app/(public)/account/event/new/page.tsx", "utf8");
  assert.match(eventNew, /Events on Findmi are published through a Business or Location Page\./);
});

test("'This Moment Is From': the heading and the top CTA share ONE row (heading left, pill right, vertically centred), the card sits below", () => {
  const block = C.slice(C.indexOf("{primaryKind && ("), C.indexOf("{!primaryKind && ("));
  assert.match(
    block,
    /<div className="flex items-center justify-between gap-3">\s*<p className="text-xs font-bold uppercase tracking-wide text-findmi-700">This Moment Is From<\/p>\s*<AddYourMomentPill href=\{addMomentHref\} \/>\s*<\/div>\s*<div className="mt-1\.5">\s*\{primaryKind === "event"/
  );
  const pill = C.slice(C.indexOf("function AddYourMomentPill"));
  assert.match(pill, /inline-flex h-8 shrink-0 items-center rounded-full border border-findmi\/40 bg-white px-3\.5 text-metadata font-bold text-findmi-700/, "same compact secondary pill as before");
  assert.match(pill, />\s*\+ Add Your Moment\s*</);
});

test("TWO Add Your Moment CTAs: first in the context heading row (before story, category tabs and photos); second is the existing one after the photo story", () => {
  assert.equal((C.match(/This Moment Is From/g) ?? []).length, 1, "the source label only exists inside the real source block");
  assert.equal((C.match(/<AddYourMomentPill /g) ?? []).length, 3, "heading-row CTA + the context-less top CTA (never both) + the no-photos bottom fallback");
  const card = C.indexOf("{primaryKind && (");
  const top = C.indexOf("<AddYourMomentPill href={addMomentHref} />");
  const contextless = C.indexOf("{!primaryKind && (");
  const notes = C.indexOf("{entry.notes && (");
  const gallery = C.indexOf("{hasGallery && <JournalMomentGallery");
  const fallback = C.indexOf("{!hasGallery && (");
  assert.ok(card > 0 && top > card && top < contextless, "inside the This Moment Is From block, on its heading row");
  assert.ok(contextless < notes && notes < gallery, "a Moment with no context card keeps its own top row, still before the story and photos");
  assert.ok(gallery > notes && fallback > gallery, "bottom CTA position unchanged: after the relationship card and the story");
  assert.ok(fallback < C.indexOf("Visit Details"), "before Visit Details");
  assert.match(C.slice(contextless), /^\{!primaryKind && \(\s*<div className="mt-3 flex">\s*<AddYourMomentPill href=\{addMomentHref\} \/>\s*<\/div>\s*\)\}/);
  assert.match(C.slice(fallback), /^\{!hasGallery && \(\s*<div className="mt-5 flex">\s*<AddYourMomentPill href=\{addMomentHref\} \/>\s*<\/div>\s*\)\}/);
  // With photos, the gallery's own end-of-story CTA is the bottom one (kept).
  const g = code(GALLERY);
  assert.equal((g.match(/Add Your Moment/g) ?? []).length, 1);
});

test("both CTAs share the exact same destination", () => {
  assert.equal((C.match(/addMomentHref/g) ?? []).length, 6, "one const, then the heading-row pill, the context-less pill, the gallery prop (name + value) and the fallback pill — no second href anywhere");
  assert.match(C, /addMomentHref=\{addMomentHref\}/);
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
  assert.deepEqual(files.filter((f) => f > "20261013000000_bd_foundation.sql"), ["20261014000000_optional_business_geography.sql", "20261014010000_event_attendance_cta_and_location_visibility.sql" /* Event attendance pass */, "20261015000000_business_location_availability.sql" /* Find Us At pass */, "20261016000000_event_taxonomy_v1.sql" /* Event Taxonomy V1 pass */, "20261017000000_event_formats_v1.sql" /* Event Formats V1 pass */, "20261018000000_event_occurrence_details.sql" /* Event Occurrence details pass */, "20261018220515_discovery_lanes_add_placement.sql" /* Discovery Lanes Placement & Density Refinement pass */, "20261018223910_discovery_lanes_set_primary_lane_rpc.sql" /* atomic Make Primary RPC */, "20261018224010_discovery_lanes_set_primary_lane_rpc_restrict_grants.sql" /* atomic Make Primary RPC */, "20261018233210_market_areas_add_image_url.sql" /* Discovery Tile Visual System, Part B */, "20261019000000_event_date_time_precision.sql" /* Event date/time precision pass */, "20261020000000_moment_authorship_and_access_history.sql" /* Identity & Authorship V1 pass */, "20261021000000_brand_audit_and_opportunity_ideas.sql" /* Brand Audit + Opportunity Ideas V1 pass */, "20261022000000_admin_intelligence_reviews.sql" /* Brand Intelligence V1.1 pass */, "20261023000000_brand_intelligence_v1_2.sql" /* Brand Intelligence V1.2 pass */, "20261024000000_discovery_intelligence_v1.sql" /* Discovery Intelligence V1 pass */, "20261025000000_canonical_entity_geography.sql" /* Canonical Entity Geography pass */, "20261026000000_business_availability_details.sql" /* Business Manager redesign: Where To Find Us details */, "20261101000000_findmi_here_relationships_sets_import.sql" /* Missing-functionality pass */, "20261101000100_entity_moment_display.sql" /* Missing-functionality pass */, "20261102000000_business_location_placements.sql" /* Pass 2 Block A */, "20261102010000_growth_goal_increase_distribution.sql" /* Pass 2 Block A */, "20261103000000_business_location_placement_activities.sql" /* Pass 2 Block A closeout */, "20261104000000_opportunity_listings_geography.sql" /* Pass 2 Block B */, "20261105000000_opportunity_relationship_thread.sql" /* Opportunity Relationship Thread */]);
});
