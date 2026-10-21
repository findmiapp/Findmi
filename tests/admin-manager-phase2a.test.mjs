// Admin & Manager cleanup, Phase 2A — functional duplicates removed from the
// UI only. Stored data, keys, save actions and old URLs all stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const A = "src/app/admin/(protected)";
const M = "src/app/(public)/account";
const MB = `${M}/business/[id]`;

test("Site Editor → Homepage: only controls the public homepage reads are editable", () => {
  const home = read("src/app/(public)/page.tsx");
  const consumed = [...home.matchAll(/resolve\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(consumed, ["closing_cta", "featured_events", "hero"], "the public homepage reads exactly these fixed sections");
  const editor = read(`${A}/site/homepage/page.tsx`);
  assert.match(editor, /const liveSectionKeys = \["featured_events", "closing_cta"\];/);
  assert.match(editor, /def\.orderable === false/, "Hero stays pinned and prominent");
  assert.match(editor, /<WeatherCard/);
  for (const gone of ["DiscoveryTopicsCard", "saveDiscoveryTopics", "getDiscoveryTopicsRaw", "moveSectionUp", "moveSectionDown", "HOMEPAGE_ORDERABLE_KEYS", "Unused"]) {
    assert.ok(!editor.includes(gone), `${gone} is gone from the editor UI`);
  }
  assert.match(editor, /href="\/admin\/site\/homepage\/rows"/, "Homepage Rows link stays prominent");
});

test("…and nothing is deleted: keys, resolvers and save actions remain", () => {
  const sections = read("src/lib/site-sections.ts");
  for (const key of ["hero", "business_doorway", "brand_spotlight", "featured_events", "shop_findmi", "findmi_here", "featured_brands", "category_feeds", "explore_by_category", "brands_on_the_move", "findmi_for_business", "one_profile", "popular_locations", "closing_cta"]) {
    assert.match(sections, new RegExp(`\\b${key}: \\{`), key);
  }
  assert.match(sections, /export function resolveDiscoveryTopics/);
  const actions = read(`${A}/site/homepage/actions.ts`);
  for (const fn of ["saveDiscoveryTopics", "moveSectionUp", "moveSectionDown", "saveSiteSection"]) assert.match(actions, new RegExp(`export async function ${fn}`), fn);
});

test("Admin Business detail: Gallery is a section of Profile; no separate Gallery tab; old key redirects", () => {
  const page = read(`${A}/businesses/[id]/page.tsx`);
  assert.doesNotMatch(page, /\{ key: "gallery", label: "Gallery" \}/);
  assert.match(page, /const LEGACY_ADMIN_TABS: Record<string, string> = \{ gallery: "profile", "find-us-at": "locations" \}/);
  assert.match(page, /redirect\(`\/admin\/businesses\/\$\{id\}\?\$\{q\.toString\(\)\}`\)/);
  const profile = page.indexOf('{tab === "profile" && (');
  const gallery = page.indexOf('<form action={galleryAction}');
  const products = page.indexOf('{tab === "products" && (');
  assert.ok(profile > 0 && gallery > profile && gallery < products, "the gallery form renders inside the Profile tab, after the profile form");
  assert.match(page.slice(profile, gallery + 400), /<section aria-label="Gallery"/);
  assert.match(page, /saveLabel="Save Gallery"/, "its own save button stays");
  assert.match(read(`${A}/businesses/actions.ts`), /export async function saveBusinessGallery/);
  assert.match(read(`${A}/businesses/actions.ts`), /\/admin\/businesses\/\$\{id\}\?tab=profile/);
});

test("Admin Business detail: Locations workspace holds Our Locations and Find Us At with all actions", () => {
  const page = read(`${A}/businesses/[id]/page.tsx`);
  assert.doesNotMatch(page, /\{ key: "find-us-at", label: "Find Us At" \}/);
  assert.ok(page.includes('{ key: "locations", label: "Locations" }'));
  const a = page.indexOf('<p className="text-sm font-semibold text-ink">Our Locations</p>');
  const b = page.indexOf('<p className="text-sm font-semibold text-ink">Find Us At</p>');
  assert.ok(a > 0 && b > a, "Our Locations first, then Find Us At");
  assert.match(page, /tab === "locations" && marketsAdmin \? await getAvailabilityLocationsForBusiness/, "availability data loads with the Locations tab");
  assert.match(page, /adminConnectFindUsAt/);
  assert.match(page, /adminDisconnectFindUsAt|adminRemoveFindUsAt|FindUsAt/);
  assert.match(read(`${A}/businesses/availability-actions.ts`), /\?tab=locations/);
});

test("Manager QR: ?tab=qr is canonical; /qr redirects; one creator; detail pages untouched", () => {
  const page = read(`${MB}/page.tsx`);
  // Business Manager redesign: QR lives inside Performance (QR Codes view).
  const perfViews = read(`${MB}/v2/PerformanceViews.tsx`);
  assert.match(perfViews, /import QrCampaignGroups from "\.\.\/QrCampaignGroups"/);
  assert.doesNotMatch(page, /import QrCampaignCreator,/, "no second central creator in the Manager page");
  assert.doesNotMatch(page, /centralOptions/);
  assert.match(perfViews, /href=\{`\$\{basePath\}\/qr\/new`\}/);
  assert.match(page, /<PerformanceViewTabs basePath=\{basePath\} view="qr" \/>/);
  assert.match(page, /getBusinessQrCampaigns\(admin, id\)/);
  const qr = read(`${MB}/qr/page.tsx`);
  assert.match(qr, /redirect\(`\/account\/business\/\$\{id\}\?tab=qr`\)/);
  assert.ok(!qr.includes("getBusinessQrCampaigns"), "the old Campaign Manager list is gone — one list, in the tab");
  assert.ok(existsSync(`${MB}/qr/new/page.tsx`) && existsSync(`${MB}/qr/new/QrIntelligentCreator.tsx`), "the V2 creator stays");
  assert.ok(existsSync(`${M}/qr/[id]/page.tsx`), "campaign detail pages stay");
  const perf = read(`${MB}/PerformanceTab.tsx`);
  assert.ok(!perf.includes("QrCampaignCreator") && perf.includes("tab=qr"), "Performance's QR panel links to the QR tab");
  const creator = read(`${MB}/QrCampaignCreator.tsx`);
  assert.doesNotMatch(creator, /centralOptions/);
  assert.match(creator, /export function QrCampaignContextualPanel/);
  for (const p of [`${M}/event/[id]/page.tsx`, `${M}/location/[id]/page.tsx`]) assert.match(read(p), /QrCampaignContextualPanel/, "per-entity quick QR stays");
  assert.match(read(`${MB}/qr/new/QrIntelligentCreator.tsx`), /\?tab=qr/);
  assert.match(read(`${M}/business/qr-manager-actions.ts`), /revalidatePath\(`\/account\/business\/\$\{row\.business_id\}`\)/);
});

test("Manager More: no redundant Referral entry (redirect kept); Performance lives in the primary nav, not More", () => {
  const more = read(`${MB}/v2/MoreMenu.tsx`).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(more, /Referral|showReferral|tab=referral/);
  assert.match(more, /desktopHidden: true/);
  assert.match(more, /className=\{l\.desktopHidden \? "lg:hidden" : undefined\}/);
  assert.doesNotMatch(more, /\?tab=performance/, "Performance is a primary slot now — not repeated in More");
  const nav = read(`${MB}/v2/business-nav.ts`);
  assert.match(nav, /section: "performance", label: "Performance", tab: "performance"/, "the bottom nav and rail list Performance");
  assert.doesNotMatch(nav.match(/section: "performance"[^\n]*/)[0], /desktopOnly/, "…on mobile too");
  assert.match(nav, /"referral",/, "?tab=referral stays a valid key");
  assert.match(read(`${MB}/page.tsx`), /tab === "referral" && referralPartner[\s\S]{0,80}redirect\(`\/account\/business\/\$\{id\}\?tab=settings`\)/, "…and still redirects to Settings");
  assert.doesNotMatch(read(`${MB}/page.tsx`), /showReferral=/);
});
