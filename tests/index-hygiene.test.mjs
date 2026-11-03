// Google index hygiene (Nov 2026): what Findmi lets search engines index.
// INDEX = canonical public entity/editorial pages; NOINDEX, FOLLOW =
// account, creation/editing, transactional, internal search, filtered
// listings; PRIVATE = /admin. Pure rules + source checks; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const IDX = await import("../src/lib/seo/indexing.ts");
const SMP = await import("../src/lib/seo/sitemap-policy.ts");
const SITE = await import("../src/lib/site-identity.ts");
const CONFIG = (await import("../next.config.mjs")).default;
const { NOINDEX_PATH_SOURCES } = await import("../next.config.mjs");
const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp");
const read = (p) => readFileSync(p, "utf8");

const noindexed = (pathname) => NOINDEX_PATH_SOURCES.some((src) => pathToRegexp(src).test(pathname));

// ── Query state vs tracking ───────────────────────────────────────────────

test("tracking parameters never make a URL a filtered variant; real state does", () => {
  assert.equal(IDX.hasStateParams({}), false);
  assert.equal(IDX.hasStateParams({ utm_source: "ig", utm_campaign: "x", gclid: "1", fbclid: "2", qr: "abc" }), false);
  assert.equal(IDX.hasStateParams(new URLSearchParams("utm_medium=social")), false);
  for (const q of ["when=tomorrow", "category=bakery", "market=nyc", "page=2", "sort=new", "q=coffee", "view=list"]) {
    assert.equal(IDX.hasStateParams(new URLSearchParams(q)), true, q);
  }
  assert.equal(IDX.hasStateParams({ when: undefined }), false, "absent values don't count");
});

test("listing metadata: bare path is the canonical; filtered variants are noindex, follow", () => {
  const base = { title: "Events", description: "d" };
  const bare = IDX.listingMetadata(base, "/events", {});
  assert.deepEqual(bare.alternates, { canonical: "/events" });
  assert.equal(bare.robots, undefined, "the bare listing stays indexable");
  assert.equal(IDX.listingMetadata(base, "/events", { utm_source: "x" }).robots, undefined);
  const filtered = IDX.listingMetadata(base, "/events", { when: "tomorrow" });
  assert.deepEqual(filtered.robots, { index: false, follow: true });
  assert.deepEqual(filtered.alternates, { canonical: "/events" });
  assert.equal(filtered.title, "Events");
});

// ── NOINDEX families (header backstop + metadata) ─────────────────────────

test("known polluting URLs are noindex: Moment creation, internal search, account, checkout", () => {
  for (const p of [
    "/my-world/journal/new", // ?event= / ?location= / ?business= (path match covers every query)
    "/my-world/journal/abc/edit",
    "/search",
    "/find",
    "/journal",
    "/event/koom-haus-2026/journal",
    "/account",
    "/account/business/123/inbox",
    "/account/event/new",
    "/cart",
    "/checkout/success",
    "/saved",
    "/you",
    "/login",
    "/signup",
    "/signup/check-email",
    "/forgot-password",
    "/reset-password",
    "/redeem/CODE",
    "/upgrade/pro",
    "/join/start",
    "/join/success",
    "/privacy-choices",
    "/embed/business/x",
  ]) {
    assert.ok(noindexed(p), `${p} must be noindex`);
  }
});

test("canonical public pages are NOT swept into a noindex family", () => {
  for (const p of [
    "/",
    "/business/sephora",
    "/business/koom-week-2026-nyc",
    "/event/koom-haus-2026",
    "/location/magnolia-bakery-new-dorp-lane",
    "/product/some-product",
    "/journal/6a2f0c1e-0000-4000-8000-000000000000", // a single public Moment
    "/people/someone",
    "/user/someone",
    "/thenativeroseny", // handle vanity route
    "/guides/nyc-holiday-markets",
    "/explore/nyc/staten-island",
    "/businesses",
    "/events",
    "/locations",
    "/discover",
    "/moments",
    "/marketplace",
    "/map",
    "/join",
    "/join/business",
    "/about",
    "/privacy",
    "/terms",
  ]) {
    assert.ok(!noindexed(p), `${p} must stay indexable`);
  }
});

test("the header backstop is X-Robots-Tag noindex, follow on the Findmi host only; admin is noindex, nofollow", async () => {
  const blocks = await CONFIG.headers();
  for (const src of NOINDEX_PATH_SOURCES) {
    const b = blocks.find((x) => x.source === src);
    assert.ok(b, src);
    assert.deepEqual(b.headers, [{ key: "X-Robots-Tag", value: "noindex, follow" }]);
    assert.ok(b.missing?.some((m) => m.type === "host" && /jerseycity/.test(m.value)), `${src}: JerseyCity.guide untouched`);
  }
  const admin = blocks.find((x) => x.source === "/admin/:path*");
  assert.deepEqual(admin.headers, [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
});

test("robots.txt never blocks a noindex family Google already knows (it must crawl to see the noindex)", () => {
  const robots = read("src/app/robots.ts");
  const disallow = robots.match(/disallow:\s*\[([^\]]*)\]/)[1];
  for (const p of ["/my-world", "/search", "/account", "/journal", "/find", "/signup", "/login"]) {
    assert.ok(!disallow.includes(`"${p}`), `${p} is not disallowed`);
  }
});

test("pages without their own metadata inherit noindex + a real title from their family layout (never the homepage title)", () => {
  for (const [dir, title] of [["account", "Your Account"], ["my-world", "Add a Moment"], ["cart", "Cart"], ["saved", "Saved"], ["checkout", "Checkout"]]) {
    const src = read(`src/app/(public)/${dir}/layout.tsx`);
    assert.match(src, /robots: NOINDEX_FOLLOW/, dir);
    assert.ok(src.includes(`title: "${title}"`), dir);
    assert.match(src, /return children;/, `${dir}: pass-through, no UI change`);
  }
});

test("internal search / find / you / privacy choices are noindex with a clean canonical", () => {
  for (const [d, path] of [["search", "/search"], ["find", "/find"], ["you", "/you"], ["privacy-choices", "/privacy-choices"]]) {
    assert.match(read(`src/app/(public)/${d}/page.tsx`), new RegExp(`noindexMetadata\\([\\s\\S]*?"${path}"\\)`), d);
  }
  const m = IDX.noindexMetadata({ title: "Search" }, "/search");
  assert.deepEqual(m.robots, { index: false, follow: true });
  assert.deepEqual(m.alternates, { canonical: "/search" });
});

test("discovery listings use the listing rule with their own bare path", () => {
  for (const d of ["businesses", "events", "locations", "discover", "moments", "marketplace", "people"]) {
    const src = read(`src/app/(public)/${d}/page.tsx`);
    assert.ok(src.includes(`listingMetadata(BASE_METADATA, "/${d}", await searchParams)`), d);
    assert.doesNotMatch(src, /export const metadata: Metadata/, `${d}: one metadata source`);
  }
  const map = read("src/app/(public)/map/page.tsx");
  assert.match(map, /canonical: "\/map"/);
  assert.match(map, /hasStateParams\(params\)/);
});

test("Moments: single public Moments index with a self canonical; lists and non-public Moments are noindex", () => {
  const entry = read("src/app/(public)/journal/[id]/page.tsx");
  assert.match(entry, /visibility !== "public" \|\| result\.entry\.status !== "published"\) return \{ title: "Moment", robots: NOINDEX_FOLLOW \}/);
  assert.match(entry, /canonical: `\/journal\/\$\{result\.entry\.id\}`/);
  const list = read("src/app/(public)/journal/page.tsx");
  assert.equal(list.match(/robots: NOINDEX_FOLLOW/g)?.length, 3, "My Journal, unknown subject, subject lists");
});

test("entity pages declare a self-referencing canonical (query variants fold into it)", () => {
  assert.match(read("src/app/(public)/business/[slug]/BusinessPublicView.tsx"), /alternates: \{ canonical: url \}/);
  assert.match(read("src/app/(public)/event/[slug]/EventPublicView.tsx"), /alternates: \{ canonical: canonicalUrl \}/);
  assert.match(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /alternates: \{ canonical: canonicalUrl \}/);
  assert.match(read("src/app/(public)/product/[slug]/page.tsx"), /alternates: \{ canonical: url \}/);
  assert.match(read("src/app/(public)/people/[slug]/page.tsx"), /canonical: `\/people\/\$\{person\.slug\}`/);
  assert.match(read("src/app/(public)/user/[username]/page.tsx"), /canonical: `\/user\/\$\{profile\.username\}`/);
  assert.match(read("src/app/(public)/explore/[market]/[area]/page.tsx"), /canonical: `\/explore\/\$\{market\}\/\$\{area\}`/);  for (const [d, path] of [["about", "/about"], ["join", "/join"], ["join/business", "/join/business"], ["privacy", "/privacy"], ["terms", "/terms"]]) {
    assert.ok(read(`src/app/(public)/${d}/page.tsx`).includes(`alternates: { canonical: "${path}" }`), `${d} self canonical`);
  }
});

test("titles: one Findmi suffix — Business absolute, Event/Location via the template; homepage unchanged", () => {
  assert.equal(SITE.HOME_TITLE, "Findmi | The Find Me Here App");
  assert.deepEqual(SITE.HOME_METADATA.title, { absolute: "Findmi | The Find Me Here App" });
  assert.match(read("src/app/layout.tsx"), /template: "%s \| Findmi"/);
  assert.match(read("src/app/(public)/business/[slug]/BusinessPublicView.tsx"), /title: \{ absolute: `\$\{business\.name\} \| Findmi` \}/);
  assert.match(read("src/app/(public)/event/[slug]/EventPublicView.tsx"), /title: event\.name,/);
  assert.match(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /title: location\.name,/);
});

// ── Sitemap ───────────────────────────────────────────────────────────────

test("sitemap lists each entity at the SAME URL its page declares canonical (handle when present)", () => {
  assert.equal(SMP.canonicalEntityPath("business", "the-native-rose", "thenativeroseny"), "/thenativeroseny");
  assert.equal(SMP.canonicalEntityPath("business", "sephora", null), "/business/sephora");
  assert.equal(SMP.canonicalEntityPath("event", "koom-haus-2026", undefined), "/event/koom-haus-2026");
  for (const view of ["business/[slug]/BusinessPublicView.tsx"]) {
    assert.match(read(`src/app/(public)/${view}`), /\$\{handle \?\? `business\/\$\{slug\}`\}/, "page canonical uses the same handle rule");
  }
});

test("sitemap: indexable families in, noindex families out", () => {
  const src = read("src/app/sitemap.ts");
  for (const needle of ['from("businesses")', 'from("events")', 'from("locations")', 'from("products")', 'from("journal_entries")', 'from("public_handles")', "getPublishedGuideSlugs", "/explore/", "/product/", "/journal/"]) {
    assert.ok(src.includes(needle), needle);
  }
  assert.match(src, /\.eq\("visibility", "public"\)\.eq\("status", "published"\)/, "public Moments only");
  assert.match(src, /applyCatalogProductFilter/, "public Products only");
  assert.match(src, /from\("events"\)\.select\("id, slug"\)\.eq\("is_demo", false\)\.eq\("publication_status", "live"\)\.is\("archived_at", null\)\.is\("trashed_at", null\)/);
  for (const p of SMP.SITEMAP_STATIC_PATHS) {
    assert.ok(!noindexed(p || "/"), `static sitemap path ${p} is indexable`);
  }
  for (const banned of ["/search", "/find", "/account", "/my-world", "/cart", "/checkout", "/saved", "/you", "/login", "/signup", "/journal", "/map"]) {
    assert.ok(!SMP.SITEMAP_STATIC_PATHS.some((p) => p === banned || p.startsWith(`${banned}/`)), `${banned} never in the sitemap`);
  }

});
