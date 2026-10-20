// Site configuration (lib/site.ts) + the SITE-dependent routing in
// next.config.mjs: Findmi stays exactly as it was; JerseyCity.guide is the
// same app locked to Jersey City, without accounts, commerce or admin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");

async function siteFor(value) {
  const prev = process.env.NEXT_PUBLIC_SITE;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE;
  else process.env.NEXT_PUBLIC_SITE = value;
  try {
    const { getSite } = await import(`../src/lib/site.ts?site=${value}`);
    return getSite();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE;
    else process.env.NEXT_PUBLIC_SITE = prev;
  }
}

async function configFor(site) {
  const prev = process.env.SITE;
  if (site === undefined) delete process.env.SITE;
  else process.env.SITE = site;
  try {
    return (await import(`../next.config.mjs?site=${site}`)).default;
  } finally {
    if (prev === undefined) delete process.env.SITE;
    else process.env.SITE = prev;
  }
}

test("Findmi is the default site and keeps its exact previous brand values", async () => {
  for (const v of [undefined, "", "findmi", "anything-else"]) assert.equal((await siteFor(v)).id, "findmi", String(v));
  const s = await siteFor(undefined);
  assert.equal(s.scope, null);
  assert.equal(s.nav, null, "Findmi keeps the founder-managed nav_items");
  assert.equal(s.discoveryPageSlug, null, "Findmi keeps the system editorial page");
  assert.equal(s.homeSectionsKey, "homepage");
  assert.deepEqual(s.homeSectionDefaults, {});
  assert.deepEqual(s.logo, { kind: "image", src: "/logo-lockup.png", alt: "Findmi" });
  assert.equal(s.metadata.defaultTitle, "Findmi: Find what you're looking for. And where it'll be next.");
  assert.equal(s.metadata.titleTemplate, "%s · Findmi");
  assert.ok(Object.values(s.features).every(Boolean), "every Findmi feature stays on");
  assert.equal(s.footer.legalName, "Findmi");
  assert.deepEqual(s.headingPrefix, { default: "Findmi" }, "BrandHeading still reads \"Findmi …\" on Findmi");
  assert.deepEqual(s.footer.columns.map((c) => c.title), ["Discover", "Business", "Legal"]);
  assert.equal(s.weather, null, "Findmi keeps the founder-configured weather city");
});

test("JerseyCity.guide is locked to the Jersey City Area with its own brand, nav and editorial page", async () => {
  const s = await siteFor("jc");
  assert.equal(s.id, "jc");
  assert.deepEqual(s.scope, { market: "north-jersey", area: "jersey-city", geoPlaceKey: "place:3436000" });
  assert.deepEqual(s.nav.map((n) => n.href), ["/discover", "/events", "/locations", "/businesses", "/moments"]);
  assert.equal(s.discoveryPageSlug, "jerseycity-guide");
  assert.equal(s.homeSectionsKey, "jc_homepage");
  assert.equal(s.logo.kind, "wordmark");
  for (const f of ["accounts", "business", "commerce", "bulletins", "indexable"]) assert.equal(s.features[f], false, f);
  assert.equal(s.features.moments, true, "Moments are shared with JC (scoped by site-scope.ts)");
  assert.ok(s.nav.some((n) => n.href === "/moments"));
  assert.equal(s.headingPrefix.default, "Jersey City");
  assert.equal(s.footer.legalName, "JerseyCity.guide");
  assert.ok(!JSON.stringify(s.footer).includes("Findmi\""), "no Findmi-branded footer labels on JC");
  assert.deepEqual(s.weather, { city: "Jersey City", label: "Jersey City, NJ" }, "JC weather is fixed to its own geography");
});

test("theme: Findmi tokens keep their exact values; JC re-skins only via html[data-site=jc]", () => {
  const css = read("src/app/globals.css");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  for (const v of ["--c-findmi: 20 176 188;", "--c-findmi-700: 12 111 119;", "--c-harbor: 20 176 188;", "--c-ink: 17 17 17;", "--c-paper: 248 248 246;"]) assert.ok(root.includes(v), v);
  const jc = css.slice(css.indexOf('html[data-site="jc"] {'), css.indexOf("}", css.indexOf('html[data-site="jc"] {')));
  for (const v of ["--c-findmi: 166 66 50;", "--c-findmi-700: 126 48 38;", "--c-harbor: 40 125 142;", "--c-ink: 32 41 45;", "--c-paper: 250 250 248;"]) assert.ok(jc.includes(v), v);
  assert.match(read("src/app/layout.tsx"), /data-site=\{site\.id\}/);
  assert.match(read("src/app/(public)/page.tsx"), /site\.weather \? getWeatherContext\(site\.weather\.city, site\.weather\.label\)/);
});

test("next.config: Findmi gets no site redirects or rewrites; NEXT_PUBLIC_SITE is inlined", async () => {
  const c = await configFor(undefined);
  assert.deepEqual(c.env, { NEXT_PUBLIC_SITE: "findmi" });
  assert.deepEqual(await c.redirects(), []);
  assert.deepEqual(await c.rewrites(), { beforeFiles: [] });
  const headers = await c.headers();
  assert.ok(!headers.some((h) => h.headers.some((x) => x.key === "X-Robots-Tag")), "no noindex header on Findmi");
});

test("next.config: JerseyCity.guide sends admin/account/commerce to findmi.app before middleware and 404s privileged APIs", async () => {
  const c = await configFor("jc");
  assert.deepEqual(c.env, { NEXT_PUBLIC_SITE: "jc" });
  const redirects = await c.redirects();
  for (const r of ["admin", "account", "my-world", "login", "join", "cart", "checkout", "marketplace", "q", "auth"]) {
    assert.ok(redirects.some((x) => x.source === `/${r}` && x.destination === `https://findmi.app/${r}`), r);
    assert.ok(redirects.some((x) => x.source === `/${r}/:path*` && x.destination === `https://findmi.app/${r}/:path*`), `${r}/*`);
  }
  // Moments live on JC: /moments and public Moment pages stay; only the
  // personal /journal index (exact) and the account composer leave.
  assert.ok(!redirects.some((x) => x.source.startsWith("/moments")));
  assert.ok(redirects.some((x) => x.source === "/journal") && !redirects.some((x) => x.source === "/journal/:path*"));
  const blocked = (await c.rewrites()).beforeFiles.filter((r) => r.destination === "/_site/blocked").map((r) => r.source);
  for (const a of ["account", "follow", "saved", "relationships", "membership-status", "analytics", "webhooks"]) {
    assert.ok(blocked.includes(`/api/${a}`) && blocked.includes(`/api/${a}/:path*`), a);
  }
  for (const open of ["search", "homepage-search", "homepage-events", "homepage-business-row"]) {
    assert.ok(!blocked.some((s) => s.startsWith(`/api/${open}`)), `${open} stays available`);
  }
  const headers = await c.headers();
  assert.ok(headers.some((h) => h.source === "/:path*" && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex, nofollow")));
});

test("listing pages confine their geo params; detail pages check entity scope; a non-account site skips session lookups", () => {
  for (const p of ["page.tsx", "discover/page.tsx", "events/page.tsx", "locations/page.tsx", "businesses/page.tsx"]) {
    assert.match(read(`src/app/(public)/${p}`), /await scopeGeoParams\(await searchParams\)/, p);
  }
  assert.match(read("src/app/(public)/event/[slug]/EventPublicView.tsx"), /assertEntityInSiteScope\("event", event,/);
  assert.match(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /assertEntityInSiteScope\("location", location,/);
  assert.match(read("src/app/(public)/business/[slug]/BusinessPublicView.tsx"), /assertEntityInSiteScope\("business", business,/);
  const scope = read("src/lib/site-scope.ts");
  assert.match(scope, /if \(!scope\) return params;/, "Findmi params pass through unchanged");
  assert.match(scope, /delete rest\.geo;/, "the canonical geo override is dropped on a scoped site");
  const layout = read("src/app/(public)/layout.tsx");
  assert.ok(layout.indexOf("if (!site.features.accounts)") < layout.indexOf("await isAdminSession()"), "no admin/session lookup before the non-account branch returns");
});
