// Pages + Sections V1A — public Guide Pages on the existing Discovery Page
// Builder (discovery_pages + page-scoped homepage_rows): the legacy
// fail-closed guard, public / preview reads, the Section tree, hero and
// Page-detail rules, publication timestamps, SEO (metadata, sitemap,
// JSON-LD), the reserved /guides path, audit, and the migration. Pure
// helpers and reads run against the in-memory PostgREST fake; route, Admin
// and homepage structure is proven at source level (no JSX harness).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "react") return { url: "data:text/javascript,export const cache=(f)=>f", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const G = await import("../src/lib/guides.ts");
const H = await import("../src/lib/homepage-rows.ts");
const S = await import("../src/lib/section-types.ts");
const U = await import("../src/lib/username.ts");

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const HOME = read("src/app/(public)/page.tsx");
const ROUTE = read("src/app/(public)/guides/[slug]/page.tsx");
const PREVIEW = read("src/app/admin/(protected)/site/pages/[id]/preview/page.tsx");
const VIEW = read("src/components/guides/GuideView.tsx");
const ACTIONS = read("src/app/admin/(protected)/site/pages/actions.ts");
const EDITOR = read("src/app/admin/(protected)/site/pages/[id]/page.tsx");

// ------------------------------------------------------------ fixture

const page = (o = {}) => ({
  id: o.id ?? "p-" + (o.slug ?? "x"),
  internal_name: "Internal",
  title: "NYC Marathon Week 2026",
  slug: "nyc-marathon-week-2026",
  description: "Everything happening around the race.",
  is_published: true,
  is_system: false,
  category_slug: null,
  market_slug: null,
  area_slug: null,
  hero_image_url: null,
  hero_image_alt: null,
  cta_label: null,
  cta_url: null,
  seo_title: null,
  seo_description: null,
  og_image_url: null,
  starts_on: null,
  ends_on: null,
  published_at: "2026-10-27T12:00:00.000Z",
  created_at: "2026-10-20T00:00:00.000Z",
  updated_at: "2026-10-27T12:00:00.000Z",
  ...o,
});
const PAGES = [
  page(),
  page({ id: "p-draft", slug: "draft-guide", is_published: false, published_at: null }),
  page({ id: "p-home", slug: "home", title: "Findmi Home", is_system: true }),
  page({ id: "p-past", slug: "summer-2025", starts_on: "2025-06-01", ends_on: "2025-08-31" }),
];
let n = 0;
const row = (o = {}) => ({
  id: o.id ?? `r${++n}`,
  title: o.title ?? "Section",
  subtitle: null,
  content_type: "events",
  mode: "curated",
  category_slug: null,
  featured_only: false,
  time_window: null,
  item_limit: 8,
  curated_ids: [],
  pinned_ids: [],
  is_visible: true,
  sort_order: 10,
  page_id: "p-nyc-marathon-week-2026",
  parent_id: null,
  section_type: "feed",
  market_slug: null,
  area_slug: null,
  created_at: "",
  updated_at: "",
  ...o,
});

// ------------------------------------------------------------ 1–4, 13. public reads

test("1–4, 13. public read: published Guide resolves; draft, system Homepage, unknown and malformed slugs don't; a past Guide stays public", async () => {
  const db = fakeDb({ discovery_pages: PAGES.map((p) => ({ ...p })) });
  assert.equal((await G.getPublishedGuide("nyc-marathon-week-2026", db)).title, "NYC Marathon Week 2026");
  assert.equal(await G.getPublishedGuide("draft-guide", db), null, "draft");
  assert.equal(await G.getPublishedGuide("home", db), null, "the system Homepage is never a Guide");
  assert.equal(await G.getPublishedGuide("nope", db), null, "unknown slug");
  assert.equal(await G.getPublishedGuide("../admin", db), null, "malformed slug never queried");
  assert.equal(await G.getPublishedGuide("Bad Slug", db), null);
  const past = await G.getPublishedGuide("summer-2025", db);
  assert.equal(past.slug, "summer-2025", "coverage dates never unpublish a Guide");
  assert.equal(G.coverageStatus(past.starts_on, past.ends_on, "2026-10-27"), "past");
  assert.equal(await G.getPublishedGuide("nyc-marathon-week-2026", null), null, "no client → nothing");
});

test("public route: anon reads only, 404 for anything not published, metadata + JSON-LD, 60s revalidation", () => {
  assert.match(ROUTE, /const page = await getPublishedGuide\(slug\);\s*if \(!page\) notFound\(\);/);
  assert.match(ROUTE, /getGuideSectionRows\(page\.id\)/, "default (anon) client");
  assert.doesNotMatch(ROUTE, /getAdminSupabase|service|requireAdmin/, "no service role on the public route");
  assert.match(ROUTE, /export const revalidate = 60;/);
  assert.match(ROUTE, /guideMetadata\(page, getPublicOrigin\(\)\)/);
  assert.match(ROUTE, /robots: \{ index: false \}/, "a missing Guide is not indexed");
  assert.match(ROUTE, /toJsonLdScript\(guideJsonLd\(page, getPublicOrigin\(\), items\)\)/);
  assert.match(ROUTE, /<GuideView page=\{page\} sections=\{sections\} today=\{todayIn\(\)\} \/>/);
});

// ------------------------------------------------------------ 5–7. Section tree

test("5–7. Guide Sections: sort_order, hidden Sections skipped, unknown / unsupported types fail closed, Groups keep their children", () => {
  const rows = [
    row({ id: "late", sort_order: 30, title: "Late" }),
    row({ id: "early", sort_order: 10, title: "Early", content_type: "businesses" }),
    row({ id: "hidden", sort_order: 5, is_visible: false }),
    row({ id: "future", sort_order: 1, section_type: "entity_results", content_type: null }),
    row({ id: "weird", sort_order: 2, content_type: "moments" }),
    row({ id: "pitch", sort_order: 3, content_type: "business_showcase" }),
    row({ id: "grp", sort_order: 20, section_type: "group", content_type: null, title: "Group" }),
    row({ id: "c2", parent_id: "grp", sort_order: 20, content_type: "products" }),
    row({ id: "c1", parent_id: "grp", sort_order: 10 }),
    row({ id: "c-hidden", parent_id: "grp", sort_order: 5, is_visible: false }),
    row({ id: "c-future", parent_id: "grp", sort_order: 1, section_type: "rich_text", content_type: null }),
    row({ id: "empty-grp", sort_order: 40, section_type: "group", content_type: null }),
    row({ id: "hidden-grp", sort_order: 50, section_type: "group", content_type: null, is_visible: false }),
    row({ id: "orphan", parent_id: "hidden-grp", sort_order: 1 }),
  ];
  const tree = G.buildGuideSections(rows);
  assert.deepEqual(tree.map((t) => t.row.id), ["early", "grp", "late"]);
  assert.deepEqual(tree.find((t) => t.kind === "group").children.map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(G.buildGuideSections([]), []);
});

// ------------------------------------------------------------ 8, 9, 23. legacy guard

test("8. an unknown / future Section type can never fall through to Products — it resolves to nothing", async () => {
  for (const r of [
    row({ section_type: "entity_results", content_type: null }),
    row({ section_type: "entity_results", content_type: "products" }),
    row({ section_type: "feed", content_type: "moments" }),
    row({ section_type: "banner", content_type: "businesses" }),
  ]) {
    assert.equal(S.isLegacyFeedRow(r), false);
    assert.deepEqual(await H.resolveHomepageRowItems(r), { contentType: "unsupported", items: [] });
  }
  assert.equal(H.findPrimaryBusinessesRowId([row({ section_type: "entity_results", content_type: "businesses" })]), null, "never the Brands row");
});

test("9 + 23. valid legacy rows keep resolving exactly as before (dynamic / curated / hybrid, every content type)", async () => {
  for (const content_type of ["businesses", "events", "products", "business_showcase"]) {
    for (const mode of ["dynamic", "curated", "hybrid"]) {
      const r = row({ content_type, mode });
      assert.equal(S.isLegacyFeedRow(r), true);
      assert.equal((await H.resolveHomepageRowItems(r)).contentType, content_type, `${content_type}/${mode}`);
    }
  }
  assert.equal((await H.resolveHomepageRowItems(row({ section_type: "group", content_type: null }))).contentType, "group");
  assert.equal(H.findPrimaryBusinessesRowId([row({ id: "b", content_type: "businesses" })]), "b");
  // The homepage filters to legacy feed rows BEFORE the Brands row, the
  // products rail and the "other rows" loop; the row resolver keeps every
  // existing branch.
  assert.match(HOME, /const homepageRows = allHomepageRows\.filter\(isLegacyFeedRow\);/);
  // Every legacy path below reads the filtered list only.
  const body = HOME.slice(HOME.indexOf("const homepageRows = allHomepageRows"), HOME.indexOf("  return (\n    <div>"));
  assert.match(body, /findPrimaryBusinessesRowId\(homepageRows\)/);
  assert.match(body, /const brandsRowIndex = homepageRows\.findIndex/);
  assert.match(body, /homepageRows\.forEach\(\(row, i\) =>/);
  assert.ok(!/allHomepageRows/.test(HOME.slice(HOME.indexOf("const homepageRows = allHomepageRows") + 40)), "nothing else reads the unfiltered rows");
  const resolver = read("src/lib/homepage-rows.ts");
  for (const fn of ["resolveCuratedBusinesses", "resolveHybridBusinesses", "resolveHybridEvents", "resolveHybridProducts", "getHomepageRowBusinesses", "getEventsDiscovery", "getHomepageRowProducts"]) assert.match(resolver, new RegExp(fn), fn);
  assert.match(read("src/app/api/homepage-business-row/route.ts"), /\.eq\("section_type", "feed"\)/);
});

// ------------------------------------------------------------ 10. hero

test("10. hero: every optional part renders only when set (no empty containers)", () => {
  assert.match(VIEW, /\{page\.hero_image_url && \(/);
  assert.match(VIEW, /\{\(coverage \|\| status === "past"\) && \(/);
  assert.match(VIEW, /\{page\.description && </);
  assert.match(VIEW, /\{page\.cta_label && page\.cta_url && \(/);
  assert.match(VIEW, /<SupabaseImage src=\{page\.hero_image_url\} alt=\{page\.hero_image_alt \?\? ""\}/);
  assert.match(VIEW, /target: "_blank", rel: "noopener noreferrer"/, "external CTA opens safely");
  assert.doesNotMatch(VIEW, /dangerouslySetInnerHTML/, "no HTML from Page fields");
  assert.match(VIEW, /resolved\.items\.length === 0\) return null/, "an empty Section renders nothing");
});

// ------------------------------------------------------------ 11, 12. Page details

const details = (o = {}) => ({ hero_image_url: null, hero_image_alt: null, cta_label: null, cta_url: null, seo_title: null, seo_description: null, og_image_url: null, starts_on: null, ends_on: null, ...o });

test("11. CTA: both or neither; https:// or a Findmi path; never javascript:, http:, // or /admin", () => {
  assert.equal(G.validateGuideDetails(details()).ok, true);
  assert.equal(G.validateGuideDetails(details({ cta_label: "Race Info", cta_url: "https://www.nyrr.org/tcsnycmarathon" })).ok, true);
  assert.equal(G.validateGuideDetails(details({ cta_label: "All Events", cta_url: "/events" })).ok, true);
  for (const bad of ["javascript:alert(1)", "http://example.com", "//evil.com", "/admin/site", "example.com", "https://a b"]) {
    assert.equal(G.validateGuideDetails(details({ cta_label: "Go", cta_url: bad })).ok, false, bad);
  }
  assert.equal(G.validateGuideDetails(details({ cta_label: "Go" })).ok, false, "label without destination");
  assert.equal(G.validateGuideDetails(details({ cta_url: "/events" })).ok, false, "destination without label");
  assert.equal(G.validateGuideDetails(details({ cta_label: "x".repeat(41), cta_url: "/events" })).ok, false);
  for (const key of ["hero_image_url", "og_image_url"]) {
    assert.equal(G.validateGuideDetails(details({ [key]: "http://x.com/a.jpg" })).ok, false, key);
    assert.equal(G.validateGuideDetails(details({ [key]: "javascript:x" })).ok, false, key);
    assert.equal(G.validateGuideDetails(details({ [key]: "https://abc.supabase.co/storage/v1/object/public/x.jpg" })).ok, true, key);
  }
  assert.equal(G.validateGuideDetails(details({ seo_title: "x".repeat(121) })).ok, false);
  assert.equal(G.validateGuideDetails(details({ seo_description: "x".repeat(301) })).ok, false);
});

test("12. coverage dates: valid calendar dates, end on or after start; formatted without time-zone drift", () => {
  assert.equal(G.validateGuideDetails(details({ starts_on: "2026-10-26", ends_on: "2026-11-02" })).ok, true);
  assert.equal(G.validateGuideDetails(details({ starts_on: "2026-10-26", ends_on: "2026-10-26" })).ok, true);
  assert.equal(G.validateGuideDetails(details({ starts_on: "2026-11-02", ends_on: "2026-10-26" })).ok, false);
  assert.equal(G.validateGuideDetails(details({ starts_on: "2026-02-30" })).ok, false);
  assert.equal(G.validateGuideDetails(details({ ends_on: "Nov 2" })).ok, false);
  assert.equal(G.formatCoverage("2026-10-26", "2026-11-02"), "Oct 26 – Nov 2, 2026");
  assert.equal(G.formatCoverage("2026-10-26", "2026-10-30"), "Oct 26 – 30, 2026");
  assert.equal(G.formatCoverage("2026-12-28", "2027-01-03"), "Dec 28, 2026 – Jan 3, 2027");
  assert.equal(G.formatCoverage("2026-10-26", null), "From Oct 26, 2026");
  assert.equal(G.formatCoverage(null, "2026-11-02"), "Through Nov 2, 2026");
  assert.equal(G.formatCoverage("2026-11-01", "2026-11-01"), "Nov 1, 2026");
  assert.equal(G.formatCoverage(null, null), null);
  assert.equal(G.coverageStatus("2026-10-26", "2026-11-02", "2026-10-27"), "current");
  assert.equal(G.coverageStatus("2026-10-26", "2026-11-02", "2026-10-20"), "upcoming");
  assert.equal(G.coverageStatus("2026-10-26", "2026-11-02", "2026-11-03"), "past");
  assert.equal(G.coverageStatus(null, null, "2026-11-03"), null);
  assert.match(VIEW, /Past Guide/, "a past Guide is labelled, not hidden");
});

// ------------------------------------------------------------ 14, 15. preview

test("14 + 15. Admin Preview renders drafts with the SAME renderer; the public route never does", () => {
  assert.match(PREVIEW, /getAdminDiscoveryPage\(id\)/);
  assert.match(PREVIEW, /getGuideSectionRows\(page\.id, getAdminSupabase\(\)\)/);
  assert.match(PREVIEW, /<GuideView page=\{page\} sections=\{sections\} today=\{todayIn\(\)\} \/>/);
  assert.match(PREVIEW, /robots: \{ index: false, follow: false \}/);
  // V1B compacted the bar to one line; same states, shorter copy.
  assert.match(PREVIEW, /Admin Preview · Published/);
  assert.match(PREVIEW, /Draft Preview · Not Public/);
  assert.match(PREVIEW, /Back To Editor/);
  assert.match(PREVIEW, /export const dynamic = "force-dynamic";/);
  assert.match(read("src/middleware.ts"), /\/admin/, "behind the Admin middleware gate");
  assert.match(read("src/app/robots.ts"), /disallow: \["\/admin"/);
  assert.match(EDITOR, /href=\{`\/admin\/site\/pages\/\$\{page\.id\}\/preview`\}/);
});

// ------------------------------------------------------------ 16. routing

test("16. 'guides' (and 'guide') can't be a username or entity handle; Guides never use a root-level slug", () => {
  assert.equal(U.validateUsername("guides").ok, false);
  assert.equal(U.validateUsername("Guides").ok, false);
  assert.equal(U.validateUsername("guide").ok, false);
  assert.match(read("src/lib/handles.ts"), /validateUsername/, "entity handles use the same reserved list");
  assert.ok(readdirSync(join(ROOT, "src/app/(public)/guides")).includes("[slug]"));
  assert.equal(G.guidePath("nyc-marathon-week-2026"), "/guides/nyc-marathon-week-2026");
});

// ------------------------------------------------------------ 17, 18. sitemap

test("17 + 18. sitemap: published Guides only (no drafts, no system Homepage), lastModified from updated_at", async () => {
  const db = fakeDb({ discovery_pages: PAGES.map((p) => ({ ...p })) });
  const slugs = await G.getPublishedGuideSlugs(db);
  assert.deepEqual(slugs.map((s) => s.slug).sort(), ["nyc-marathon-week-2026", "summer-2025"]);
  const entries = G.guideSitemapEntries(slugs, "https://findmi.app");
  assert.ok(entries.some((e) => e.url === "https://findmi.app/guides/nyc-marathon-week-2026" && e.lastModified instanceof Date));
  assert.ok(!entries.some((e) => e.url.includes("draft-guide") || e.url.endsWith("/home")));
  const sitemap = read("src/app/sitemap.ts");
  assert.match(sitemap, /getPublishedGuideSlugs\(supabase\)/);
  assert.match(sitemap, /\.\.\.guideSitemapEntries\(guides, siteUrl\)/);
});

// ------------------------------------------------------------ 19. metadata + JSON-LD

test("19. metadata: SEO fields fall back to Title / Description / hero; canonical /guides/[slug]; JSON-LD CollectionPage + ItemList", () => {
  const plain = G.guideMetadata(page(), "https://findmi.app");
  assert.equal(plain.title, "NYC Marathon Week 2026");
  assert.equal(plain.description, "Everything happening around the race.");
  assert.equal(plain.alternates.canonical, "https://findmi.app/guides/nyc-marathon-week-2026");
  assert.equal(plain.openGraph.url, "https://findmi.app/guides/nyc-marathon-week-2026");
  assert.equal(plain.openGraph.images, undefined);
  assert.equal(plain.twitter.card, "summary");
  const hero = G.guideMetadata(page({ hero_image_url: "https://x.supabase.co/h.jpg" }), "https://findmi.app");
  assert.deepEqual(hero.openGraph.images, ["https://x.supabase.co/h.jpg"]);
  assert.equal(hero.twitter.card, "summary_large_image");
  const full = G.guideMetadata(page({ seo_title: "Marathon Week NYC", seo_description: "The guide.", og_image_url: "https://x.supabase.co/og.jpg", hero_image_url: "https://x.supabase.co/h.jpg" }), "https://findmi.app");
  assert.equal(full.title, "Marathon Week NYC");
  assert.equal(full.description, "The guide.");
  assert.deepEqual(full.openGraph.images, ["https://x.supabase.co/og.jpg"]);
  assert.equal(G.guideMetadata(page({ description: null }), "https://findmi.app").description, undefined);

  const ld = G.guideJsonLd(page(), "https://findmi.app", [
    { name: "Expo", path: "/event/expo" },
    { name: "Nike", path: "/business/nike" },
    { name: "Expo", path: "/event/expo" },
  ]);
  assert.equal(ld["@type"], "CollectionPage");
  assert.equal(ld.url, "https://findmi.app/guides/nyc-marathon-week-2026");
  assert.equal(ld.mainEntity["@type"], "ItemList");
  assert.deepEqual(ld.mainEntity.itemListElement.map((i) => [i.position, i.url]), [[1, "https://findmi.app/event/expo"], [2, "https://findmi.app/business/nike"]], "render order, de-duplicated");
  assert.equal(G.guideJsonLd(page(), "https://findmi.app", []).mainEntity, undefined);
});

// ------------------------------------------------------------ 20. publication

test("20. publish / unpublish: explicit actions; published_at records the first publication; saving never publishes", () => {
  const now = "2026-10-28T00:00:00.000Z";
  assert.equal(G.nextPublishedAt(null, true, now), now, "first publish");
  assert.equal(G.nextPublishedAt(null, false, now), null);
  assert.equal(G.nextPublishedAt("2026-10-27T00:00:00.000Z", false, now), "2026-10-27T00:00:00.000Z", "kept on unpublish");
  assert.equal(G.nextPublishedAt("2026-10-27T00:00:00.000Z", true, now), "2026-10-27T00:00:00.000Z", "kept on re-publish");
  const save = ACTIONS.slice(ACTIONS.indexOf("export async function saveDiscoveryPage"), ACTIONS.indexOf("export async function setDiscoveryPagePublished"));
  assert.doesNotMatch(save, /is_published/, "the details form never changes publication");
  const pub = ACTIONS.slice(ACTIONS.indexOf("export async function setDiscoveryPagePublished"), ACTIONS.indexOf("export async function deleteDiscoveryPage"));
  assert.match(pub, /if \(page\.is_system\) redirect/, "the system Homepage is always published");
  assert.match(pub, /published_at: nextPublishedAt\(page\.published_at, publish, now\)/);
  assert.doesNotMatch(pub, /starts_on|ends_on/, "coverage dates never publish anything");
  assert.match(EDITOR, /setDiscoveryPagePublished\.bind\(null, page\.id, !page\.is_published\)/);
  assert.match(EDITOR, /\{page\.is_published \? "Unpublish" : "Publish"\}/);
  assert.doesNotMatch(EDITOR, /name="is_published"/, "no publish checkbox in the details form");
  assert.match(save, /validateGuideDetails\(/);
});

// ------------------------------------------------------------ 21, 22. audit

test("21 + 22. audit: every Page and Section change is recorded as the shared admin actor", () => {
  assert.match(ACTIONS, /import \{ recordAdminAudit \} from "@\/lib\/admin\/audit";/);
  assert.match(ACTIONS, /actor: \{ kind: "admin" \}, targetType: "discovery_page"/);
  assert.match(ACTIONS, /actor: \{ kind: "admin" \}, targetType: "page_section"/);
  for (const a of ["page_create", "page_update", "page_delete"]) assert.match(ACTIONS, new RegExp(`"${a}"`), a);
  assert.match(ACTIONS, /publish \? "page_publish" : "page_unpublish"/);
  for (const a of ["page_section_create", "page_section_update", "page_section_delete", "page_section_move"]) assert.match(ACTIONS, new RegExp(`"${a}"`), a);
  assert.match(ACTIONS, /fields\.is_visible \? "page_section_show" : "page_section_hide"/);
  // Every move path audits (within siblings and across a Group).
  assert.equal((ACTIONS.match(/reorderWithinSiblings\(id, pageId, \(ids\) => [^\n]+, "(up|down|top|bottom|before|after|position)"\)/g) ?? []).length, 7);
  assert.match(ACTIONS, /move: newParentId \? "into_group" : "to_top_level"/);
  // Actions names stay valid for recordAdminAudit (lower_snake).
  for (const m of ACTIONS.matchAll(/"(page_[a-z_]+)"/g)) assert.match(m[1], /^[a-z][a-z0-9_]{1,63}$/);
});

// ------------------------------------------------------------ migration

test("migration: additive discovery_pages columns with checks; no table, no data, no policy change", () => {
  const sql = read("supabase/migrations/20261119000000_discovery_pages_guides_v1a.sql");
  const body = sql.replace(/--.*$/gm, "");
  for (const col of ["hero_image_url text", "hero_image_alt text", "cta_label text", "cta_url text", "seo_title text", "seo_description text", "og_image_url text", "starts_on date", "ends_on date", "published_at timestamptz"]) {
    assert.match(body, new RegExp(`add column if not exists ${col}`), col);
  }
  assert.match(body, /ends_on >= starts_on/);
  assert.match(body, /\(cta_label is null\) = \(cta_url is null\)/);
  assert.match(body, /cta_url ~ '\^https:\/\/' or cta_url ~ '\^\/\(\[\^\/\]\|\$\)'/);
  assert.doesNotMatch(body, /create table|insert into|update public|delete from|drop table|policy|grant|rename/i);
  assert.match(body, /^\s*begin;/m);
});
