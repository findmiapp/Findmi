// VCL A3 — Brand identity vs cover. Identity (logo) and cover are separate
// candidate pools; a cover never becomes the Business identity, and compact
// identity surfaces show the logo or the existing neutral fallback — never
// a wide cover. When no page logo verifies, the site's web app manifest
// icons are tried (failure path only). Social stays deterministic, first-
// party only: no search provider exists, so nothing is searched and no URL
// is ever generated. Synthetic sites, stub transports, locally generated
// images — no network, no database, no Anthropic. Not tied to any brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

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

const X = await import("../src/lib/brand-website-extract.ts");
const IMG = await import("../src/lib/brand-images.ts");
const B = await import("../src/lib/brand-candidate-builder.ts");
const F = await import("../src/lib/safe-fetch.ts");

const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const SITE = new URL("https://www.northwind.example/");
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const ORG = (extra = {}) => ld({ "@type": "Organization", name: "Northwind", url: SITE.href, ...extra });
const extract = (html) => X.extractBrandProfile(html, SITE);
const WEBSITE = { websiteUrl: "https://www.northwind.example", host: "northwind.example", fetchUrl: SITE };

// ── Image fixtures ────────────────────────────────────────────────────────
async function photo(w = 1200, h = 630) {
  let x = 7;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < w; c++) {
      const i = (y * w + c) * 3;
      data[i] = Math.min(255, (c / w) * 200 + rand() * 55);
      data[i + 1] = Math.min(255, (y / h) * 180 + rand() * 75);
      data[i + 2] = Math.min(255, 90 + rand() * 120);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
// A brand mark on a coloured field (a flat one-colour square is not a logo).
const squareIcon = (s = 512) =>
  sharp({ create: { width: s, height: s, channels: 3, background: "#1db954" } })
    .composite([{ input: { create: { width: Math.round(s / 2), height: Math.round(s / 2), channels: 3, background: "#ffffff" } }, left: Math.round(s / 4), top: Math.round(s / 4) }])
    .png()
    .toBuffer();
/** A legitimate horizontal wordmark: 4:1, transparent background. */
const wordmarkLogo = () =>
  sharp({ create: { width: 800, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 700, height: 120, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }, left: 50, top: 40 }])
    .png()
    .toBuffer();
/** A wide share graphic that is really a wordmark on a flat field. */
const promoGraphic = () =>
  sharp({ create: { width: 1200, height: 630, channels: 3, background: "#000000" } })
    .composite([{ input: { create: { width: 600, height: 160, channels: 3, background: "#1db954" } }, left: 300, top: 235 }])
    .png()
    .toBuffer();

/** Stub image fetcher: absolute URL → { body, type } (anything else fails). */
function images(map) {
  const calls = [];
  return {
    calls,
    fetchImage: async (url) => {
      calls.push(url);
      const hit = map[url];
      if (!hit) return { ok: false, code: "http_error" };
      return { ok: true, url: new URL(url), body: hit.body, contentType: hit.type, bytes: hit.body.length, redirects: 0 };
    },
  };
}
const verifierOf = (t) => async (url, role) => (await IMG.fetchVerifiedBrandImage(url, role, t)).ok;
const baseDeps = (t, extra = {}) => ({
  findMatches: async () => [],
  listCategories: async () => [],
  enrich: async () => ({ result: null, called: false, usage: null }),
  verifyImage: verifierOf(t),
  ...extra,
});
const build = (html, deps) => B.buildCandidateFromExtraction(WEBSITE, { profile: extract(html), finalUrl: SITE.href }, deps, { verifyImages: true });

// ── IDENTITY: candidate discovery ────────────────────────────────────────
test("1. an explicit structured (JSON-LD) logo is the preferred identity", () => {
  const p = extract(page(ORG({ logo: "https://cdn.northwind.example/brand/logo.png" }) + '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">'));
  assert.equal(p.logoCandidateUrl, "https://cdn.northwind.example/brand/logo.png");
});

test("2. a header / home-link brand-mark <img> becomes identity when trustworthy; a press strip logo never does", () => {
  const header = '<header><a href="/"><img src="/img/northwind-logo.png" alt="Northwind" width="240" height="60"></a></header>';
  assert.equal(extract(page("", header)).logoCandidateUrl, "https://www.northwind.example/img/northwind-logo.png");
  const press = '<section class="press"><img src="/img/vogue-logo.png" alt="Vogue" width="240" height="60"></section>';
  assert.equal(extract(page("", press)).logoCandidateUrl, null);
});

test("3. a suitably sized apple-touch-icon can become identity", async () => {
  const html = page('<link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">');
  const t = images({ "https://www.northwind.example/touch-180.png": { body: await squareIcon(180), type: "image/png" } });
  const built = await build(html, baseDeps(t));
  assert.equal(built.proposal.logoUrl, "https://www.northwind.example/touch-180.png");
  // A declared-too-small touch icon is not an identity candidate at all.
  assert.deepEqual(extract(page('<link rel="apple-touch-icon" sizes="76x76" href="/t76.png">')).logoCandidates, []);
});

test("4/6. og:image stays a COVER candidate; a wide promo graphic is never misclassified as a logo", () => {
  const p = extract(page('<meta property="og:image" content="https://cdn.northwind.example/share/summer.jpg">'));
  assert.deepEqual(p.coverCandidates, ["https://cdn.northwind.example/share/summer.jpg"]);
  assert.deepEqual(p.logoCandidates, [], "no identity is invented from the share image");
});

test("7. a legitimate horizontal wordmark is accepted as a logo (not rejected for being wide); only slivers are", async () => {
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 200), true, "4:1 wordmark");
  assert.equal(IMG.isSuitableBrandImage("logo", 1200, 240), true, "5:1 wordmark");
  assert.equal(IMG.isSuitableBrandImage("logo", 1400, 200), true, "7:1 wordmark (aspect is only a sanity bound since the media-acceptance pass)");
  assert.equal(IMG.isSuitableBrandImage("logo", 3000, 100), false, "30:1 sliver — a rule, not a mark");
  const U = "https://cdn.northwind.example/brand/wordmark.png";
  const t = images({ [U]: { body: await wordmarkLogo(), type: "image/png" } });
  assert.equal((await IMG.fetchVerifiedBrandImage(U, "logo", t)).ok, true);
});

// ── IDENTITY: the cover never becomes identity ───────────────────────────
test("5/26. cover-only site (wide share image, no identity evidence): cover populates, identity stays empty", async () => {
  const html = page(
    '<meta property="og:image" content="https://cdn.northwind.example/share/hero.jpg"><link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<header><a href="/" aria-label="Northwind"><svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></a></header>'
  );
  const t = images({ "https://cdn.northwind.example/share/hero.jpg": { body: await photo(), type: "image/jpeg" } });
  const built = await build(html, baseDeps(t));
  assert.equal(built.proposal.coverUrl, "https://cdn.northwind.example/share/hero.jpg");
  // The cover is never promoted to identity. (Since the modern-site
  // extraction pass the header's inline home-link brand mark IS identity
  // evidence — it is verified on its own, never derived from the cover.)
  assert.notEqual(built.proposal.logoUrl, built.proposal.coverUrl, "the cover is never promoted to identity");
  assert.ok(built.proposal.logoUrl === null || built.proposal.logoUrl.startsWith("data:image/svg+xml;base64,"), "identity only from the page's own brand mark");
});

test("a promo share graphic that fails the cover check is dropped — never turned into a logo", async () => {
  const html = page('<meta property="og:image" content="https://cdn.northwind.example/share/brand.png">');
  const t = images({ "https://cdn.northwind.example/share/brand.png": { body: await promoGraphic(), type: "image/png" } });
  const built = await build(html, baseDeps(t));
  assert.equal(built.proposal.coverUrl, null);
  assert.equal(built.proposal.logoUrl, null);
});

// ── IDENTITY: web app manifest icons (failure path only) ─────────────────
const MANIFEST = "https://www.northwind.example/site.webmanifest";
test("manifest icons: raster, 'any' purpose, ≥ 192 declared, largest first, resolved against the manifest URL", () => {
  const text = JSON.stringify({
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      { src: "/icons/mask-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/mono.png", sizes: "512x512", purpose: "monochrome" },
      { src: "/icons/vector.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
      { src: "http://www.northwind.example/insecure-512.png", sizes: "512x512" },
      { src: "/icons/legacy.ico", sizes: "256x256" },
    ],
  });
  assert.deepEqual(X.manifestIconCandidates(text, new URL(MANIFEST)), [
    "https://www.northwind.example/icons/icon-512.png",
    "https://www.northwind.example/icons/icon-192.png",
  ]);
  for (const bad of ["", "not json", "[]", "{\"icons\":\"x\"}", JSON.stringify({ icons: [null, 5, "x"] }), "x".repeat(70_000)]) {
    assert.deepEqual(X.manifestIconCandidates(bad, new URL(MANIFEST)), [], bad.slice(0, 20));
  }
  assert.equal(extract(page(`<link rel="manifest" href="/site.webmanifest">`)).manifestUrl, MANIFEST);
  assert.equal(extract(page(`<link rel="manifest" href="http://evil.example/m.json">`)).manifestUrl, null, "https only");
});

test("27. SVG-only page identity: a trustworthy compact first-party identity comes from the manifest", async () => {
  const html = page(
    '<link rel="manifest" href="/site.webmanifest"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta property="og:image" content="https://cdn.northwind.example/share/hero.jpg">',
    '<header><a href="/"><svg aria-label="Northwind"></svg></a></header>'
  );
  const t = images({
    "https://www.northwind.example/icons/icon-512.png": { body: await squareIcon(512), type: "image/png" },
    "https://cdn.northwind.example/share/hero.jpg": { body: await photo(), type: "image/jpeg" },
  });
  const manifestCalls = [];
  const built = await build(
    html,
    baseDeps(t, {
      fetchManifestIcons: async (u) => {
        manifestCalls.push(u);
        return X.manifestIconCandidates(JSON.stringify({ icons: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }] }), new URL(u));
      },
    })
  );
  assert.deepEqual(manifestCalls, [MANIFEST]);
  assert.equal(built.proposal.logoUrl, "https://www.northwind.example/icons/icon-512.png");
  assert.equal(built.proposal.coverUrl, "https://cdn.northwind.example/share/hero.jpg", "cover discovery unchanged");
});

test("10/25. strong identity site: page logo + cover + social populate; the manifest is never fetched", async () => {
  const html = page(
    ORG({ logo: "https://cdn.northwind.example/brand/logo.png", sameAs: ["https://www.instagram.com/northwind/"] }) +
      '<link rel="manifest" href="/site.webmanifest"><meta property="og:image" content="https://cdn.northwind.example/share/hero.jpg">'
  );
  const t = images({
    "https://cdn.northwind.example/brand/logo.png": { body: await wordmarkLogo(), type: "image/png" },
    "https://cdn.northwind.example/share/hero.jpg": { body: await photo(), type: "image/jpeg" },
  });
  let manifestFetched = false;
  const built = await build(html, baseDeps(t, { fetchManifestIcons: async () => ((manifestFetched = true), []) }));
  assert.equal(built.proposal.logoUrl, "https://cdn.northwind.example/brand/logo.png");
  assert.equal(built.proposal.coverUrl, "https://cdn.northwind.example/share/hero.jpg");
  assert.equal(built.proposal.instagramHandle, "northwind");
  assert.equal(manifestFetched, false, "no extra fetch when the page already supplied a usable identity");
});

test("20/21. manifest/enrichment failure (throw, timeout, junk) never blocks the candidate", async () => {
  const html = page('<link rel="manifest" href="/site.webmanifest">');
  for (const fetchManifestIcons of [async () => { throw new Error("timeout"); }, async () => ["https://www.northwind.example/missing.png"], async () => []]) {
    const built = await build(html, baseDeps(images({}), { fetchManifestIcons }));
    assert.equal(built.status, "candidate");
    assert.equal(built.proposal.logoUrl, null);
  }
});

test("manifest fetch: same SSRF rules, JSON types only, 64 KB declared cap", async () => {
  const route = (headers, body = Buffer.from("{}")) => async () => ({ status: 200, headers, body: (async function* () { yield body; })(), destroy() {} });
  assert.equal((await F.safeFetchManifest("https://127.0.0.1/m.json")).ok, false);
  assert.equal((await F.safeFetchManifest("http://www.northwind.example/m.json")).ok, false);
  const M = "https://www.northwind-brand.com/site.webmanifest";
  const ok = await F.safeFetchManifest(M, { transport: route({ "content-type": "application/manifest+json" }, Buffer.from('{"icons":[]}')) });
  assert.deepEqual(ok.ok && ok.text, '{"icons":[]}');
  assert.equal((await F.safeFetchManifest(M, { transport: route({ "content-type": "text/html" }) })).code, "unsupported_content");
  assert.equal((await F.safeFetchManifest(M, { transport: route({ "content-type": "application/json", "content-length": String(100 * 1024) }) })).code, "too_large");
  assert.equal(F.SAFE_FETCH_MANIFEST_MAX_BYTES, 64 * 1024);
  const real = code("src/lib/brand-website-analysis.ts");
  assert.match(real, /fetchManifestIcons: async \(manifestUrl\) => \{\s*const fetched = await safeFetchManifest\(manifestUrl\);\s*return fetched\.ok \? manifestIconCandidates\(fetched\.text, fetched\.url\) : \[\];/);
});

// ── IDENTITY: compact surfaces never use the cover ───────────────────────
test("8/9. Account Home identity tiles: logo only (contained), else the existing storefront fallback", () => {
  const home = code("src/app/(public)/account/page.tsx");
  assert.match(home, /imageUrl: b\.logoUrl,\s*\}\)/, "Managing: Business row");
  assert.match(home, /imageUrl: createdBusiness\.logoUrl,/, "A2 created card");
  assert.doesNotMatch(home, /b\.logoUrl \?\? b\.coverImageUrl|createdBusiness\.logoUrl \?\? createdBusiness\.coverImageUrl/);
  assert.match(home, /className=\{entity\.kind === "business" \? "bg-white object-contain p-0\.5" : "object-cover"\}/);
  assert.match(home, /<NavIcon name=\{MANAGED_ICON\[entity\.kind\]\} className="h-4 w-4" \/>/, "neutral fallback kept");
  const card = code("src/app/(public)/account/CreatedBusinessCard.tsx");
  assert.match(card, /<SupabaseImage src=\{business\.imageUrl\} alt="" fill sizes="48px" className="object-contain" \/>/);
  assert.match(card, /<NavIcon name="storefront" className="h-6 w-6 text-findmi-700" \/>/);
  // Workspace / switcher / Review were already logo-only + contained.
  assert.match(read("src/app/(public)/account/PersonalAppShell.tsx"), /logoUrl: b\.logoUrl \?\? null/);
  assert.match(read("src/app/(public)/account/business/new/BrandImageInput.tsx"), /className=\{role === "logo" \? "h-full w-full object-contain" : "h-full w-full object-cover"\}/);
});

// ── SOCIAL: deterministic, first-party only ──────────────────────────────
test("11/12. first-party social: JSON-LD sameAs and the page's own links (unchanged rules)", () => {
  assert.equal(extract(page(ORG({ sameAs: ["https://www.instagram.com/northwind"] }))).instagramHandle, "northwind");
  assert.equal(extract(page("", '<footer><a href="https://instagram.com/northwind.co/">IG</a></footer>')).instagramHandle, "northwind.co");
  assert.equal(X.chooseInstagramHandle(new Set(), new Set(["northwind", "otherbrand"]), "northwind.example"), "northwind", "several → the domain-label match");
  assert.equal(X.chooseInstagramHandle(new Set(), new Set(["alpha", "beta"]), "northwind.example"), null, "ambiguous → none");
});

test("22/23/24. malformed / wrong-platform / reserved Instagram URLs are rejected by the existing normalizer", () => {
  for (const href of ["https://instagram.com/p/abc123/", "https://instagram.com/explore/", "javascript:alert(1)", "https://evil.example/instagram.com/x", "https://instagram.com/bad handle"]) {
    assert.equal(extract(page("", `<footer><a href="${href}">x</a></footer>`)).instagramHandle, null, href);
  }
});

test("13/14/19/28. no Instagram URL is ever generated or AI-supplied; search (A3b) is a gated fallback only", () => {
  // AI enrichment's output schema has no social/URL fields.
  const ai = code("src/lib/brand-ai-enrichment.ts");
  assert.doesNotMatch(ai, /instagram|sameAs|url:\s*z\./i);
  // Deterministic Instagram wins; a searched one is used only at HIGH confidence (see A3b tests).
  const builder = code("src/lib/brand-candidate-builder.ts");
  assert.match(builder, /const instagramHandle = identity\.instagram \?\? profile\.instagramHandle;/);
  assert.match(builder, /const proposedInstagram = instagramHandle \?\? searchedHandle;/);
  // A site with no social evidence → no Instagram from extraction (missing beats invented).
  assert.equal(extract(page(ORG(), "<footer>Follow us</footer>")).instagramHandle, null);
});

// ── REGRESSION / SCOPE ───────────────────────────────────────────────────
test("29/30. Review stays editable and creation still re-validates logo/cover/Instagram server-side", () => {
  const review = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(review, /<BrandImageInput role="logo" label="Logo" foundPreview=\{logoPreview\} useName="use_logo" useDefault=\{useLogoDefault\} fileName="logo_file" \/>/);
  assert.match(review, /<BrandImageInput role="cover" label="Cover Image" foundPreview=\{coverPreview\} useName="use_cover" useDefault=\{useCoverDefault\} fileName="cover_file" \/>/);
  assert.match(read("src/app/(public)/account/business/new/BrandImageInput.tsx"), /<input type="checkbox" name=\{useName\} value="1" defaultChecked=\{useDefault\}/);
  assert.match(review, /name="instagram_url"\s+defaultValue=\{values\.instagramUrl\}/);
  const create = read("src/app/(public)/account/business/actions.ts");
  assert.match(create, /const verified = await fetchVerifiedBrandImage\(url, role\);/);
  assert.match(create, /redirect\(`\/account\?created=\$\{businessId\}`\);/);
});

test("no schema change in A3", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "20261108000000_commercial_inquiries.sql" /* later passes (… Event date/time precision, Identity & Authorship V1, Brand Audit V1, Brand Intelligence V1.1, Brand Intelligence V1.2, Discovery Intelligence V1, Canonical Entity Geography) */);
});
